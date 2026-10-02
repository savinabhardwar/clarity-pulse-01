from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, Mock, patch

import psycopg2

from app.jobs.config import JobSettings
from app.jobs.jira_sync.runner import connect_database, derive_cache, last_watermark, run_pipeline, validate_settings


class ConnectionRetryTests(IsolatedAsyncioTestCase):
    async def test_connection_retries_are_bounded_before_any_pipeline_write(self):
        database = Mock()
        connect = Mock(side_effect=[psycopg2.OperationalError(), psycopg2.OperationalError(), database])
        sleep = AsyncMock()
        self.assertIs(await connect_database(None, connect, sleep), database)
        self.assertEqual(connect.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [2, 4])
        connect = Mock(side_effect=psycopg2.OperationalError())
        with self.assertRaises(psycopg2.OperationalError):
            await connect_database(None, connect, AsyncMock())
        self.assertEqual(connect.call_count, 3)

    async def test_failed_read_closes_connection_and_schema_errors_are_not_retried(self):
        failed, healthy = Mock(), Mock()
        failed.rows.side_effect = psycopg2.OperationalError()
        self.assertIs(await connect_database(None, Mock(side_effect=[failed, healthy]), AsyncMock()), healthy)
        failed.close.assert_called_once()
        connect = Mock(side_effect=psycopg2.errors.UndefinedTable())
        with self.assertRaises(psycopg2.errors.UndefinedTable):
            await connect_database(None, connect, AsyncMock())
        connect.assert_called_once()


class RunnerUnitTests(TestCase):
    def test_validation_reports_all_missing_variable_names(self):
        settings = JobSettings(jira_base_url=None, jira_email=None, jira_api_token=None, database_url=None, _env_file=None)
        with self.assertRaisesRegex(RuntimeError, "JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, DATABASE_URL"):
            validate_settings(settings)

    def test_watermark_only_absent_table_falls_back(self):
        database = Mock()
        database.rows.return_value = [{"watermark_after": datetime(2026, 10, 1, tzinfo=timezone.utc)}]
        self.assertEqual(last_watermark(database), "2026-10-01T00:00:00.000Z")
        database.rows.side_effect = psycopg2.errors.UndefinedTable()
        self.assertIsNone(last_watermark(database))
        database.rows.side_effect = psycopg2.OperationalError("connection failed")
        with self.assertRaises(psycopg2.OperationalError):
            last_watermark(database)

    def test_empty_derivation_produces_valid_backend_cache(self):
        import json
        with TemporaryDirectory() as folder:
            cache = Path(folder) / "cache"
            generated = Path(folder) / "generated"
            cache.mkdir()
            for name in ["issues.raw.jsonl", "epics.raw.jsonl"]:
                (cache / name).write_text("")
            derive_cache(cache, generated)
            self.assertEqual(json.loads((generated / "projects.json").read_text())["projects"], [])
            self.assertEqual(json.loads((generated / "teams.seed.json").read_text())["people"], [])


class RunnerOrderingTests(IsolatedAsyncioTestCase):
    def stage_patches(self, stack, order, snapshot_error=None):
        prefix = "app.jobs.jira_sync.runner."
        for name in ["derive_cache", "run_cached", "generate_narratives", "snapshot_closed_sprints", "flag_inactive_people", "purge_closed_sprint_tickets", "purge_old_planning_availability", "smoke_test"]:
            def stage(*args, name=name, **kwargs):
                order.append(name)
                if name == "snapshot_closed_sprints" and snapshot_error:
                    raise snapshot_error
                return {"ok": True, "flagged": []}
            stack.enter_context(patch(prefix + name, side_effect=stage))

    async def test_fetch_failure_cannot_start_any_database_stage(self):
        fetcher, database = AsyncMock(), Mock()
        fetcher.fetch_all.side_effect = RuntimeError("provider unavailable")
        order = []
        with ExitStack() as stack:
            self.stage_patches(stack, order)
            with self.assertRaises(RuntimeError):
                await run_pipeline(database, fetcher, "cache", "generated")
        self.assertEqual(order, [])
        database.rows.assert_not_called()

    async def test_snapshot_failure_prevents_ticket_and_leave_cleanup(self):
        order = []
        fetcher = AsyncMock()
        fetcher.fetch_all.return_value = {"issueCount": 0}
        with ExitStack() as stack:
            self.stage_patches(stack, order, RuntimeError("snapshot failed"))
            with self.assertRaises(RuntimeError):
                await run_pipeline(Mock(), fetcher, "cache", "generated")
        self.assertEqual(order, ["derive_cache", "run_cached", "generate_narratives", "snapshot_closed_sprints"])

    async def test_independent_refresh_failures_still_check_main_sync_health(self):
        order = []
        fetcher = AsyncMock()
        fetcher.fetch_all.return_value = {"issueCount": 1, "trackedSprints": []}
        with ExitStack() as stack:
            self.stage_patches(stack, order)
            stack.enter_context(patch("app.jobs.jira_sync.runner.sync_stakeholder_status", side_effect=RuntimeError("private payload")))
            stack.enter_context(patch("app.jobs.jira_sync.runner.sync_next_sprint", return_value={"tickets": 1}))
            stages = await run_pipeline(Mock(), fetcher, "cache", "generated")
        self.assertEqual(stages["stakeholders"], {"failed": True, "errorType": "RuntimeError"})
        self.assertEqual(stages["nextSprint"], {"tickets": 1})
        self.assertEqual(order[-1], "smoke_test")
        self.assertLess(order.index("snapshot_closed_sprints"), order.index("purge_closed_sprint_tickets"))
