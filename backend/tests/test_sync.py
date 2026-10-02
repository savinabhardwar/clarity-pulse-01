from copy import deepcopy
from unittest import TestCase
from unittest.mock import MagicMock, patch

from app.jobs.database import Database
from app.jobs.jira_sync.sync import (
    remap_accounts, resolve_epic_id, run_sync, summarize_cluster,
)


class SyncTests(TestCase):
    def test_account_merges_precede_grouping_without_mutating_cache(self):
        issues = [{"assignee": {"accountId": "old"}, "reporter": {"accountId": "old"},
                   "worklogs": [{"authorAccountId": "old"}], "comments": [{"authorAccountId": "old"}]}]
        original = deepcopy(issues)
        history = [{"assignee": {"accountId": "old"}}]
        seed = [{"accountId": "old"}]
        remapped, historical, teams = remap_accounts(issues, history, seed, {"old": "canonical"})
        self.assertEqual(issues, original)
        self.assertEqual(remapped[0]["assignee"]["accountId"], "canonical")
        self.assertEqual(remapped[0]["reporter"]["accountId"], "canonical")
        self.assertEqual(remapped[0]["worklogs"][0]["authorAccountId"], "canonical")
        self.assertEqual(remapped[0]["comments"][0]["authorAccountId"], "canonical")
        self.assertEqual(historical[0]["assignee"]["accountId"], "canonical")
        self.assertEqual(teams[0]["accountId"], "canonical")

    def test_subtask_epic_resolution_and_cycle_bound(self):
        subtask = {"key": "KH-3", "parent": {"key": "KH-2"}}
        story = {"key": "KH-2", "parent": {"key": "KH-1"}}
        self.assertEqual(resolve_epic_id(subtask, {"KH-2": story}, {"KH-1": "epic-id"}), "epic-id")
        cycle = {"key": "KH-2", "parent": {"key": "KH-3"}}
        self.assertIsNone(resolve_epic_id(subtask, {"KH-2": cycle, "KH-3": subtask}, {}))
        self.assertIsNone(resolve_epic_id(subtask, {}, {}))

    def test_summary_deduplicates_and_limits_bullets(self):
        cluster = {"tickets": [{"summary": title} for title in [" A ", "A", "B", "C", "D"]]}
        self.assertEqual(summarize_cluster(cluster), "• A\n• B\n• C\n• +1 more")

    def test_sync_run_survives_data_rollback_and_records_sanitized_failure(self):
        connection = MagicMock()
        database = Database(connection)
        database.rows = MagicMock(return_value=[{"id": "run-id"}])
        database.execute = MagicMock()
        with patch("app.jobs.jira_sync.sync.ingest", side_effect=ValueError("private provider payload")):
            with self.assertRaises(ValueError):
                run_sync(database, issues=[], epics=[], history=[], team_seed=[], projects=[], tracked_sprints=[])
        connection.rollback.assert_called_once()
        connection.commit.assert_not_called()
        message = database.execute.call_args.args[1][0]
        self.assertEqual(message, "Python sync failed (ValueError)")
        self.assertNotIn("private", message)

    def test_sync_success_updates_watermark_before_commit(self):
        connection = MagicMock()
        database = Database(connection)
        database.rows = MagicMock(return_value=[{"id": "run-id"}])
        database.execute = MagicMock()
        with patch("app.jobs.jira_sync.sync.ingest", return_value=12):
            result = run_sync(database, issues=[], epics=[], history=[], team_seed=[], projects=[], tracked_sprints=[], as_of="2026-10-01T00:00:00Z")
        self.assertEqual(result, {"recordsProcessed": 12, "syncRunId": "run-id"})
        self.assertEqual(database.execute.call_args.args[1][0], 12)
        self.assertEqual(database.execute.call_args.args[1][1].isoformat(), "2026-10-01T00:00:00+00:00")
        connection.commit.assert_called_once()


class PoolerSchemaTests(TestCase):
    def test_every_standalone_operation_sets_local_schema(self):
        connection = MagicMock()
        database = Database(connection, "isolated_test")
        database.execute("DELETE FROM example")
        database.execute("INSERT INTO example DEFAULT VALUES")
        calls = connection.cursor.return_value.__enter__.return_value.execute.call_args_list
        self.assertEqual([call.args for call in calls], [
            ("SELECT set_config('search_path', %s, true)", ["isolated_test"]),
            ("DELETE FROM example", None),
            ("SELECT set_config('search_path', %s, true)", ["isolated_test"]),
            ("INSERT INTO example DEFAULT VALUES", None),
        ])
        self.assertEqual(connection.commit.call_count, 2)

    def test_explicit_batch_keeps_one_schema_and_one_commit(self):
        connection = MagicMock()
        database = Database(connection, "isolated_test")
        with database.transaction():
            database.execute("DELETE FROM example")
            database.execute("INSERT INTO example DEFAULT VALUES")
        calls = connection.cursor.return_value.__enter__.return_value.execute.call_args_list
        self.assertEqual(sum("set_config" in call.args[0] for call in calls), 1)
        connection.commit.assert_called_once()
