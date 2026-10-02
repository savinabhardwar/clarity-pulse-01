import json
from pathlib import Path
from legacy_fixtures import reference_run
import unittest
from unittest.mock import AsyncMock, Mock

from app.jobs.jira_sync.next_sprint import build_next_sprint_rows, sync_next_sprint

FIELD = "customfield_10020"
PROJECTS = [{"key": "KH", "name": "Knowledge Hub"}, {"key": "TT", "name": "Team - Telephony"}]


def issue(key, project, sprints, **extra):
    return {"key": key, "fields": {"project": {"key": project}, "summary": key + " summary", "status": {"name": "To Do"},
                                   "issuetype": {"name": "Task"}, "assignee": None, "timeoriginalestimate": None, FIELD: sprints, **extra}}


def future(sprint_id, name, **extra):
    return {"id": sprint_id, "name": name, "state": "future", **extra}


class NextSprintTests(unittest.IsolatedAsyncioTestCase):
    def test_earliest_future_per_board_matches_existing_fixtures(self):
        fixtures = [
            [issue("KH-1", "KH", [future(11, "KH Sprint 5")]), issue("KH-2", "KH", [future(11, "KH Sprint 5"), future(12, "KH Sprint 6")]), issue("KH-3", "KH", [future(12, "KH Sprint 6")])],
            [issue("KH-1", "KH", [future(1, "Undated")]), issue("KH-2", "KH", [future(99, "Dated", startDate="2026-10-02")])],
            [issue("KH-1", "KH", [{"id": 11, "state": "closed", "name": "Old"}]), issue("OTHER-1", "OTHER", [future(1, "Unknown board")]), issue("KH-2", "KH", [])],
            [issue("KH-1", "KH", [future(11, "KH Sprint")]), issue("TT-1", "TT", [future(15, "TT Sprint")])],
            [issue("KH-1", "KH", [future(11, "KH Sprint", goal="")], assignee={"accountId": "alias", "displayName": "Alex"}, timeoriginalestimate=7200)],
        ]
        accounts = {"alias": "canonical-person"}
        cases = [{"operation": "next-sprint", "data": {"issues": rows, "projects": PROJECTS, "accounts": accounts, "field": FIELD}} for rows in fixtures]
        reference = reference_run("jira", input=json.dumps(cases), capture_output=True, text=True, encoding="utf-8", check=True)
        for rows, expected in zip(fixtures, json.loads(reference.stdout)):
            self.assertEqual(build_next_sprint_rows(rows, PROJECTS, accounts), expected)

    async def test_jira_failure_never_touches_database(self):
        database = Mock()
        fetcher = Mock()
        fetcher.settings.jira_sprint_field = FIELD
        fetcher.search = AsyncMock(side_effect=RuntimeError("Jira unavailable"))
        with self.assertRaisesRegex(RuntimeError, "Jira unavailable"):
            await sync_next_sprint(database, fetcher)
        database.rows.assert_not_called()
        database.execute.assert_not_called()

    async def test_success_resolves_aliases_and_replaces_in_one_transaction(self):
        from contextlib import contextmanager
        state = {"in_transaction": False}
        events = []

        @contextmanager
        def transaction():
            state["in_transaction"] = True
            events.append("begin")
            yield
            events.append("commit")
            state["in_transaction"] = False

        database = Mock()
        database.rows.side_effect = [[{"id": "person-1", "jira_account_id": "canonical"}], [{"alias_jira_account_id": "alias", "canonical_jira_account_id": "canonical"}]]
        database.transaction = transaction

        def execute(statement):
            self.assertTrue(state["in_transaction"])
            events.append("delete")

        def insert(table, rows):
            self.assertTrue(state["in_transaction"])
            self.assertEqual(rows[0]["assignee_person_id"], "person-1")
            events.append("insert")

        database.execute.side_effect = execute
        database.insert_many.side_effect = insert
        fetcher = Mock()
        fetcher.settings.jira_sprint_field = FIELD
        fetcher.search = AsyncMock(return_value=[issue("KH-1", "KH", [future(12, "KH Sprint")], assignee={"accountId": "alias", "displayName": "Alex"})])
        self.assertEqual(await sync_next_sprint(database, fetcher), {"tickets": 1, "sprints": 1})
        self.assertEqual(events, ["begin", "delete", "insert", "commit"])
