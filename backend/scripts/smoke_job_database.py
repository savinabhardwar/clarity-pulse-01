"""Exercise Python jobs in disposable tables; never update application rows.

Run from backend: python scripts/smoke_job_database.py
Requires DATABASE_URL from backend/.env.local. The only writes are in a unique
clarity_job_test_* schema, removed in finally even when a check fails.
"""

import asyncio
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from unittest.mock import AsyncMock

import psycopg2
from psycopg2 import sql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.jobs.config import JobSettings
from app.jobs.jira_sync.core import to_date
from app.jobs.database import Database
from app.jobs.jira_sync.maintenance import (
    flag_inactive_people, purge_closed_sprint_tickets,
    purge_old_planning_availability, smoke_test,
)
from app.jobs.jira_sync.next_sprint import sync_next_sprint
from app.jobs.jira_sync.stakeholders import sync_stakeholder_status
from app.jobs.jira_sync.sync import run_sync
from app.jobs.jira_sync.snapshots import snapshot_closed_sprints, backfill_pace_scores
from app.jobs.jira_sync.narratives import generate_narratives


async def run():
    schema = "clarity_job_test_" + uuid4().hex
    database = Database.connect(JobSettings(database_schema=schema))
    checks = []
    tables = [
        "people", "person_account_aliases", "sprints", "tickets",
        "person_sprint_summaries", "project_sprint_summaries",
        "planning_availability", "next_sprint_tickets", "sync_runs",
        "stakeholder_items", "stakeholder_item_jira_links",
        "jira_projects", "teams", "projects", "project_jira_projects",
        "project_overrides", "epics", "worklogs", "ticket_comments",
        "person_metrics", "person_metrics_history", "risks", "standouts",
        "board_health", "project_contributors", "project_updates",
        "project_update_tickets", "resolved_ticket_history", "project_features",
        "project_feature_tickets",
        "project_narratives", "org_narrative",
    ]
    try:
        database.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        for table in tables:
            database.execute(sql.SQL("CREATE TABLE {}.{} (LIKE public.{} INCLUDING ALL)").format(
                sql.Identifier(schema), sql.Identifier(table), sql.Identifier(table),
            ))
        assert database.rows("SELECT current_schema() AS name")[0]["name"] == schema
        # LIKE does not copy foreign keys. Restore the two cascading links used
        # by derived-table replacement so reruns exercise the real lifecycle.
        for child, column, parent in [
            ("project_update_tickets", "project_update_id", "project_updates"),
            ("project_feature_tickets", "project_feature_id", "project_features"),
        ]:
            database.execute(sql.SQL("ALTER TABLE {} ADD FOREIGN KEY ({}) REFERENCES {} (id) ON DELETE CASCADE").format(
                sql.Identifier(child), sql.Identifier(column), sql.Identifier(parent),
            ))

        person_id = str(uuid4())
        database.upsert("people", [{"id": person_id, "jira_account_id": "test-person", "name": "Before"}], conflict_columns=["jira_account_id"])
        database.upsert("people", [{"id": person_id, "jira_account_id": "test-person", "name": "After"}], conflict_columns=["jira_account_id"])
        database.insert_many("people", [{"jira_account_id": "test-person", "name": "Ignored"}], conflict_columns=["jira_account_id"], update_columns=[])
        assert database.rows("SELECT name FROM people")[0]["name"] == "After"
        try:
            with database.transaction():
                database.execute("DELETE FROM people")
                database.insert_many("people", [{"jira_account_id": None, "name": "Invalid"}])
        except psycopg2.IntegrityError:
            pass
        else:
            raise AssertionError("Expected database constraint failure")
        assert database.rows("SELECT count(*) AS count FROM people")[0]["count"] == 1
        checks.append("bulk upsert, conflict no-op and failed replacement rollback")

        database.insert_many("person_account_aliases", [{"alias_jira_account_id": "alias-person", "canonical_jira_account_id": "test-person"}])
        fetcher = AsyncMock()
        fetcher.settings = JobSettings()
        future = {"id": 900001, "name": "Future fixture", "state": "future"}
        fetcher.search.return_value = [{"key": "KH-900001", "fields": {
            "project": {"key": "KH"}, "summary": "Planning fixture", "status": {"name": "Open"},
            "assignee": {"accountId": "alias-person", "displayName": "Fixture"},
            fetcher.settings.jira_sprint_field: [future],
        }}]
        result = await sync_next_sprint(database, fetcher)
        assert result == {"tickets": 1, "sprints": 1}, result
        assert str(database.rows("SELECT assignee_person_id FROM next_sprint_tickets")[0]["assignee_person_id"]) == person_id
        fetcher.search.side_effect = RuntimeError("Jira unavailable")
        try:
            await sync_next_sprint(database, fetcher)
        except RuntimeError:
            pass
        assert database.rows("SELECT count(*) AS count FROM next_sprint_tickets")[0]["count"] == 1
        checks.append("next sprint alias resolution and outage preservation")

        now = datetime.now(timezone.utc)
        start = now - timedelta(days=20)
        end = now - timedelta(days=10)
        project_id = str(uuid4())
        sprint_ids = [str(uuid4()) for _ in range(3)]
        for index, sprint_id in enumerate(sprint_ids):
            database.insert_many("sprints", [{
                "id": sprint_id, "jira_sprint_id": 900010 + index, "jira_project_id": project_id,
                "name": f"Fixture {index}", "state": "closed", "is_tracked": index == 1,
                "start_date": start + timedelta(days=index), "end_date": end + timedelta(days=index),
            }])
        database.insert_many("person_sprint_summaries", [{
            "person_id": person_id, "sprint_start": start, "sprint_end": end,
            "overall_score": 0, "jira_qualifies": False, "allocated_hours": 0, "logged_hours": 0,
        }])
        database.insert_many("project_sprint_summaries", [{"project_id": project_id, "sprint_start": start, "sprint_end": end}])
        for index, sprint_id in enumerate([*sprint_ids, None, None]):
            database.insert_many("tickets", [{
                "jira_key": f"KH-{900010 + index}", "jira_project_id": project_id, "summary": "Fixture",
                "issue_type": "Task", "status": "Done", "status_category": "done", "sprint_id": sprint_id,
                "created_at": start, "updated_at": end, "last_synced_at": now if index == 4 else end,
            }])
        result = purge_closed_sprint_tickets(database)
        assert result == {"sprintsPurged": 1, "ticketsDeleted": 2}, result
        assert database.rows("SELECT count(*) AS count FROM tickets")[0]["count"] == 3
        checks.append("ticket cleanup requires both snapshots, respects tracked sprints and grace")

        # Older leave with no protected overlap can be removed; tracked and
        # unsnapshotted sprint overlaps must survive.
        database.insert_many("planning_availability", [
            {"person_id": person_id, "from_date": (now - timedelta(days=60)).date(), "to_date": (now - timedelta(days=50)).date(), "hours": 7},
            {"person_id": person_id, "from_date": start.date(), "to_date": end.date(), "hours": 7},
        ])
        assert purge_old_planning_availability(database) == {"entriesDeleted": 1}
        checks.append("leave cleanup preserves sprint overlaps")

        database.execute("UPDATE people SET team_guessed = true, active = true, excluded = false")
        assert flag_inactive_people(database) == {"flagged": ["After"]}
        database.execute("UPDATE people SET excluded = false, team_guessed = false")
        assert flag_inactive_people(database) == {"flagged": []}
        database.execute("UPDATE people SET team_guessed = true")
        database.execute("UPDATE person_sprint_summaries SET logged_hours = 1")
        assert flag_inactive_people(database) == {"flagged": []}
        checks.append("inactive flagging preserves reviewed people and historical work")

        database.insert_many("sync_runs", [{"sync_type": "manual", "status": "success"}])
        assert smoke_test(database)["ok"]
        database.execute("UPDATE tickets SET last_synced_at = %s", [end])
        assert not smoke_test(database)["ok"]
        checks.append("sync health detects stale writes")

        # Minimal isolated link fixtures still use the deployed column types
        # and constraints copied above; no production item is changed.
        item_id = str(uuid4())
        database.insert_many("stakeholder_items", [{"id": item_id, "project_id": project_id, "summary": "Fixture", "kind": "feature", "status": "Open", "status_kind": "stakeholder", "created_by": "test"}])
        database.insert_many("stakeholder_item_jira_links", [{"item_id": item_id, "jira_key": "KH-900001", "jira_url": "https://example.invalid/KH-900001", "added_by": "test"}])
        fetcher.search.side_effect = None
        fetcher.search.return_value = [{"key": "KH-900001", "fields": {"status": {"name": "Done"}}}]
        assert await sync_stakeholder_status(database, fetcher) == {"updated": 1, "missing": []}
        assert await sync_stakeholder_status(database, fetcher) == {"updated": 0, "missing": []}
        assert database.rows("SELECT status, status_kind FROM stakeholder_items")[0] == {"status": "Done", "status_kind": "jira"}
        checks.append("linked status refresh is idempotent")

        stamp = now.isoformat()
        sprint = {"jiraProjectKey": "KH", "name": "Integration sprint", "state": "active", "startDate": (now - timedelta(days=4)).isoformat(), "endDate": (now + timedelta(days=5)).isoformat()}
        epic = {"key": "KH-900100", "project": "KH", "summary": "Integration epic", "status": "Open", "statusCategory": "new", "created": stamp, "updated": stamp}
        issue = {"key": "KH-900101", "project": "KH", "summary": "Integration feature", "issuetype": "Task", "status": "Done", "statusCategory": "done", "created": stamp, "updated": stamp, "resolutiondate": stamp, "parent": {"key": epic["key"], "summary": epic["summary"]}, "assignee": {"accountId": "alias-person", "name": "After"}, "estimateSeconds": 3600, "remainingSeconds": 0, "spentSeconds": 3600, "labels": [], "worklogs": [{"id": "test-log", "authorAccountId": "alias-person", "authorName": "After", "seconds": 3600, "started": stamp, "created": stamp}], "comments": []}
        options = {"issues": [issue], "epics": [epic], "history": [issue], "team_seed": [{"accountId": "alias-person", "team": "Fixture team", "guessed": True, "guessReason": "Test"}], "projects": [{"id": "integration-project", "name": "Integration", "current": True, "jiraProjects": ["KH"], "epics": [epic]}], "tracked_sprints": [sprint], "as_of": now}
        first = run_sync(database, **options)
        metric_count = database.rows("SELECT count(*) AS count FROM person_metrics_history")[0]["count"]
        database.execute("UPDATE people SET team_guessed = false, excluded = true, team_guess_reason = 'Human correction' WHERE id = %s", [person_id])
        second = run_sync(database, **options)
        assert first["recordsProcessed"] == second["recordsProcessed"]
        corrected = database.rows("SELECT team_guessed, excluded, team_guess_reason FROM people WHERE id = %s", [person_id])[0]
        assert corrected == {"team_guessed": False, "excluded": True, "team_guess_reason": "Human correction"}
        assert database.rows("SELECT count(*) AS count FROM person_metrics_history")[0]["count"] == 2 * metric_count
        assert database.rows("SELECT count(*) AS count FROM project_features")[0]["count"] == 1
        assert database.rows("SELECT count(*) AS count FROM project_updates")[0]["count"] == 1
        before = database.rows("SELECT last_synced_at FROM tickets WHERE jira_key = %s", [issue["key"]])[0]
        bad = {**options, "issues": [{**issue, "summary": None}]}
        try:
            run_sync(database, **bad)
        except psycopg2.IntegrityError:
            pass
        else:
            raise AssertionError("Invalid sync should roll back")
        assert database.rows("SELECT last_synced_at FROM tickets WHERE jira_key = %s", [issue["key"]])[0] == before
        assert database.rows("SELECT status FROM sync_runs ORDER BY started_at DESC LIMIT 1")[0]["status"] == "failed"
        checks.append("atomic main sync, repeat refresh, historical metrics, manual corrections and failure rollback")

        closed_end = now - timedelta(days=1)
        worked_at = now - timedelta(days=2)
        database.execute("UPDATE people SET excluded = false WHERE id = %s", [person_id])
        database.execute("UPDATE sprints SET end_date = %s, state = 'closed' WHERE name = 'Integration sprint'", [closed_end])
        database.execute("UPDATE tickets SET resolved_at = %s WHERE jira_key = %s", [worked_at, issue["key"]])
        database.execute("UPDATE worklogs SET started_at = %s WHERE jira_worklog_id = 'test-log'", [worked_at])
        snapshot_closed_sprints(database)
        snapshot = database.rows("SELECT * FROM person_sprint_summaries WHERE person_id = %s AND sprint_start = %s", [person_id, to_date(sprint["startDate"])])
        assert len(snapshot) == 1
        assert snapshot[0]["logged_hours"] == 1
        assert snapshot[0]["overrun_tickets"] == []
        snapshot_closed_sprints(database)
        assert database.rows("SELECT * FROM person_sprint_summaries WHERE person_id = %s AND sprint_start = %s", [person_id, to_date(sprint["startDate"])]) == snapshot
        assert database.rows("SELECT count(*) AS count FROM project_sprint_summaries WHERE sprint_start = %s", [to_date(sprint["startDate"])])[0]["count"] == 1
        backfill_pace_scores(database)
        assert backfill_pace_scores(database)["updated"] == 0
        checks.append("closed sprint person/project snapshots, JSON diagnostics and idempotent pace backfill")

        # Local fixture views deliberately reference only local cloned tables.
        # Public views can embed public-qualified names, so they are not copied.
        database.execute("""
            CREATE VIEW v_projects_overview AS
            SELECT p.id, p.name, p.health, p.purpose, p.sprint_goal, p.is_current,
                'product'::text AS project_space, now() AS started_at,
                (SELECT count(*)::int FROM tickets tk JOIN epics e ON e.id = tk.epic_id WHERE e.project_id = p.id AND tk.status_category != 'done') AS open_tickets,
                (SELECT count(*)::int FROM tickets tk JOIN epics e ON e.id = tk.epic_id WHERE e.project_id = p.id AND tk.status_category = 'done') AS closed_tickets,
                0::int AS blocked_tickets
            FROM projects p
        """)
        database.execute("CREATE VIEW v_org_metrics AS SELECT 72.5::numeric AS avg_utilisation, 80::numeric AS estimate_coverage, 0::numeric AS total_spillage_hours")
        assert generate_narratives(database, now) == {"projects": 1, "organizationRows": 1}
        assert generate_narratives(database, now) == {"projects": 1, "organizationRows": 1}
        assert database.rows("SELECT count(*) AS count FROM project_narratives")[0]["count"] == 1
        assert database.rows("SELECT count(*) AS count FROM org_narrative")[0]["count"] == 2
        checks.append("executive narrative refresh, JSON fields and append-only organization history")
    finally:
        try:
            if not schema.startswith("clarity_job_test_") or len(schema) != len("clarity_job_test_") + 32:
                raise RuntimeError("Refusing unsafe schema cleanup")
            database.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        finally:
            database.close()
    return {"completed": True, "checked_at": datetime.now(timezone.utc).isoformat(),
            "passed": checks, "application_rows_written": 0, "temporary_schema_removed": True,
            "limitations": ["Fixture tables copy deployed types, constraints and indexes, but not public triggers or all foreign keys.",
                            "Narrative views are isolated fixtures; the scheduled pipeline was not run against application data."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = asyncio.run(run())
    rendered = json.dumps(result, indent=2)
    if args.report:
        args.report.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
