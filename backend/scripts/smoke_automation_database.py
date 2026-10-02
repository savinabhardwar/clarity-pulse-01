"""Verify automation migrations and atomic event processing in a test schema."""

import argparse
import json
from pathlib import Path
import sys
from uuid import uuid4
from datetime import datetime, timezone
from tempfile import TemporaryDirectory

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "automation/src"))

from app.jobs.config import JobSettings
from app.jobs.database import Database
from ai_pm.events import normalize_jira, normalize_push, normalize_pull_request, normalize_requirement
from ai_pm.database import migrate, seed


class ScopedConnection:
    """Keep every setup-command transaction inside the disposable schema."""
    def __init__(self, database):
        self.database = database

    def cursor(self):
        return self.database.connection.cursor()

    def __enter__(self):
        self.database.connection.autocommit = False
        with self.cursor() as cursor:
            cursor.execute("SELECT set_config('search_path', %s, true)", [self.database.schema])
        return self

    def __exit__(self, kind, value, traceback):
        try:
            if kind is None:
                self.database.connection.commit()
            else:
                self.database.connection.rollback()
        finally:
            self.database.connection.autocommit = True


def run():
    schema = "clarity_automation_test_" + uuid4().hex
    db = Database.connect(JobSettings(database_schema=schema))
    checks = []
    try:
        db.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        with TemporaryDirectory() as directory:
            for path in sorted((ROOT / "automation/db/migrations").glob("*.sql")):
                source = path.read_text(encoding="utf-8")
                # This security-definer lookup normally targets the automation
                # database's public schema. Retarget it only in this fixture.
                source = source.replace("set search_path = public", "set search_path = " + schema)
                (Path(directory) / path.name).write_text(source, encoding="utf-8")
            connection = ScopedConnection(db)
            assert len(migrate(connection, directory)) == 7
            assert migrate(connection, directory) == []
            failed = Path(directory) / "0008_failure_fixture.sql"
            failed.write_text("CREATE TABLE failure_fixture (id int); SELECT missing_fixture_function();", encoding="utf-8")
            try:
                migrate(connection, directory)
            except psycopg2.errors.UndefinedFunction:
                pass
            else:
                raise AssertionError("Invalid migration should fail")
            assert db.rows("SELECT to_regclass(%s) AS fixture", [schema + ".failure_fixture"])[0]["fixture"] is None
            assert db.rows("SELECT count(*) AS count FROM _migrations")[0]["count"] == 7
        checks.append("Python migration runner applies all seven migrations, skips repeats, and rolls back failures")
        assert seed(connection) == seed(connection) == {"project": "DEMO", "members": 4}
        assert db.rows("SELECT count(*) AS count FROM project_members")[0]["count"] == 4
        assert db.rows("SELECT count(*) AS count FROM users")[0]["count"] == 4
        checks.append("Python development seed is atomic and idempotent")
        project_id = db.rows("INSERT INTO projects (name, code, jira_project_key, git_repository, requirements_project_id) VALUES ('Fixture', 'FIXTURE', 'LT', 'fixture/repo', 'fixture-project') RETURNING id")[0]["id"]
        fixtures = ROOT / "automation/db/seed/fixtures"
        def fixture(name):
            return json.loads((fixtures / name).read_text(encoding="utf-8"))
        events = [normalize_jira(fixture("jira-issue.json")), *normalize_push(fixture("github-push.json"), "test-push"),
                  normalize_pull_request(fixture("github-pull-request.json"), "test-pr"),
                  normalize_requirement(fixture("requirements-app-item.json"))]
        for event in events:
            event["projectId"] = str(project_id)
            assert db.rows("SELECT process_queued_event(%s::jsonb) AS processed", [Json(event)])[0]["processed"] is True
            assert db.rows("SELECT process_queued_event(%s::jsonb) AS processed", [Json(event)])[0]["processed"] is False
        assert db.rows("SELECT count(*) AS count FROM events")[0]["count"] == len(events)
        for table in ["issues", "commits", "pull_requests", "requirements"]:
            assert db.rows(sql.SQL("SELECT count(*) AS count FROM {}").format(sql.Identifier(table)))[0]["count"] > 0
        checks.append("all provider event types persist compact state and deduplicate redelivery")

        jira = events[0]
        bad = {**jira, "providerEventId": "rollback-fixture", "payload": {**jira["payload"], "fields": {**jira["payload"]["fields"], "summary": None}}}
        before = db.rows("SELECT title FROM issues WHERE jira_issue_key = %s", [jira["entityId"]])[0]
        try:
            db.rows("SELECT process_queued_event(%s::jsonb)", [Json(bad)])
        except psycopg2.IntegrityError:
            pass
        else:
            raise AssertionError("State constraint failure should abort processing")
        assert db.rows("SELECT count(*) AS count FROM events WHERE provider_event_id = 'rollback-fixture'")[0]["count"] == 0
        assert db.rows("SELECT title FROM issues WHERE jira_issue_key = %s", [jira["entityId"]])[0] == before
        repaired = {**jira, "providerEventId": "rollback-fixture"}
        assert db.rows("SELECT process_queued_event(%s::jsonb) AS processed", [Json(repaired)])[0]["processed"] is True
        checks.append("state failure rolls back the dedup marker; repaired retry succeeds")

        unknown = {**jira, "eventType": "future.unknown", "providerEventId": "unknown-fixture"}
        assert db.rows("SELECT process_queued_event(%s::jsonb) AS processed", [Json(unknown)])[0]["processed"] is True
        assert db.rows("SELECT title FROM issues WHERE jira_issue_key = %s", [jira["entityId"]])[0] == before
        checks.append("unknown events are recorded without guessing a compact-state mutation")
        for role in ["anon", "authenticated"]:
            allowed = db.rows("SELECT has_function_privilege(%s, %s, 'EXECUTE') AS allowed", [role, schema + ".process_queued_event(jsonb)"])[0]["allowed"]
            assert allowed is False
        assert db.rows("SELECT has_function_privilege('service_role', %s, 'EXECUTE') AS allowed", [schema + ".process_queued_event(jsonb)"])[0]["allowed"] is True
        checks.append("atomic RPC execution is restricted to service_role")
    finally:
        try:
            if not schema.startswith("clarity_automation_test_") or len(schema) != len("clarity_automation_test_") + 32:
                raise RuntimeError("Refusing unsafe schema cleanup")
            db.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        finally:
            db.close()
    return {"completed": True, "checked_at": datetime.now(timezone.utc).isoformat(), "passed": checks,
            "application_rows_written": 0, "temporary_schema_removed": True,
            "limitations": ["Tests use a disposable schema on the configured dashboard database, not an automation production deployment.",
                            "The role-lookup migration's public search path is retargeted to the fixture schema only during this test."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = json.dumps(run(), indent=2)
    if args.report:
        args.report.write_text(report + "\n", encoding="utf-8")
    print(report)
