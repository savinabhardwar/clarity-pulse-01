"""Jira read transport: rollover safety, field shapes, cursors and retries."""

import asyncio
import json
from pathlib import Path
import tempfile
import unittest

import httpx

from app.jobs.config import JobSettings
from app.jobs.jira_sync.fetch import JiraFetcher, slim_issue


class JiraFetchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests, self.responses, self.delays = [], [], []
        self.settings = JobSettings(_env_file=None, jira_base_url="https://jira.example", jira_email="alex@example.invalid", jira_api_token="test-token")

        def handle(request):
            self.requests.append(request)
            response = self.responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

        async def sleep(delay):
            self.delays.append(delay)

        self.client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        self.fetcher = JiraFetcher(self.settings, self.client, sleep=sleep)

    async def asyncTearDown(self):
        await self.client.aclose()

    def page(self, issues, token=None):
        self.responses.append(httpx.Response(200, json={"issues": issues, **({"nextPageToken": token} if token else {})}))

    def body(self, index=-1):
        return json.loads(self.requests[index].content)

    async def test_pagination_keeps_fields_and_token(self):
        self.page([{"key": "TEAM-1"}], "page-2")
        self.page([{"key": "TEAM-2"}])
        result = await self.fetcher.search("project = TEAM", ["summary"])
        self.assertEqual([row["key"] for row in result], ["TEAM-1", "TEAM-2"])
        self.assertNotIn("nextPageToken", self.body(0))
        self.assertEqual(self.body()["nextPageToken"], "page-2")
        self.assertEqual(self.body()["fields"], ["summary"])
        self.assertEqual(self.requests[0].url.path, "/rest/api/3/search/jql")

    async def test_repeated_token_fails_instead_of_looping(self):
        self.page([], "same")
        self.page([], "same")
        with self.assertRaisesRegex(ValueError, "pagination"):
            await self.fetcher.search("project = TEAM", [])
        self.assertEqual(len(self.requests), 2)

    async def test_rate_limit_and_server_errors_retry_but_auth_fails_fast(self):
        self.responses.extend([httpx.Response(429), httpx.Response(503)])
        self.page([])
        self.assertEqual(await self.fetcher.search("project = TEAM", []), [])
        self.assertEqual(self.delays, [2, 4])
        self.responses.append(httpx.Response(401, text="sensitive upstream body"))
        with self.assertRaisesRegex(RuntimeError, "HTTP 401") as caught:
            await self.fetcher.search("project = TEAM", [])
        self.assertNotIn("sensitive", str(caught.exception))
        self.assertEqual(len(self.requests), 4)

    async def test_no_active_sprint_never_falls_back_to_closed(self):
        field = self.settings.jira_sprint_field
        self.page([{"fields": {field: [{"id": 1, "name": "Old", "state": "closed"}]}}])
        self.assertEqual(await self.fetcher.tracked_sprints([{"key": "TEAM", "name": "Team"}]), [])

    async def test_active_sprint_normalizes_goal_and_stops_after_first_issue(self):
        field = self.settings.jira_sprint_field
        self.page([{"fields": {field: [{"id": 1, "name": "Old", "state": "closed"},
                                               {"id": 2, "name": 'Sprint "New"', "state": "active", "startDate": "2026-09-21", "endDate": "2026-10-02", "goal": ""}]}}], "unused-next-page")
        result = await self.fetcher.tracked_sprints([{"key": "TEAM", "name": 'Team "A"'}])
        self.assertEqual(result[0]["name"], 'Sprint "New"')
        self.assertIsNone(result[0]["goal"])
        self.assertEqual(len(self.requests), 1)
        self.assertIn('project = "Team \\"A\\""', self.body()["jql"])

    async def test_empty_tracked_set_makes_no_request(self):
        self.assertEqual(await self.fetcher.in_window_issues([]), [])
        self.assertEqual(self.requests, [])

    async def test_in_window_query_excludes_epics_and_requests_qa_fields(self):
        self.page([])
        await self.fetcher.in_window_issues([{"jiraProjectKey": "TEAM", "name": 'Sprint "quoted"'}])
        body = self.body()
        self.assertIn("issuetype != Epic", body["jql"])
        self.assertIn('Sprint = "Sprint \\"quoted\\""', body["jql"])
        self.assertIn(self.settings.jira_qa_assignee_field, body["fields"])
        self.assertIn(self.settings.jira_qa_planned_hours_field, body["fields"])

    def test_slim_issue_keeps_author_credit_qa_hours_and_adf_comment_policy(self):
        issue = {"key": "TEAM-1", "fields": {
            "project": {"key": "TEAM"}, "summary": "Portal", "status": {"name": "Testing", "statusCategory": {"key": "indeterminate"}},
            "assignee": {"accountId": "alex", "displayName": "Alex"}, "reporter": None,
            self.settings.jira_qa_assignee_field: {"accountId": "qa", "displayName": "QA"},
            self.settings.jira_qa_planned_hours_field: 2.5,
            "worklog": {"worklogs": [{"id": "1", "author": {"accountId": "sam", "displayName": "Sam"}, "started": "2026-10-01", "created": "2026-10-02", "timeSpentSeconds": 3600}]},
            "comment": {"comments": [{"author": {"accountId": "sam", "displayName": "Sam"}, "created": "2026-10-01", "body": "x" * 250},
                                      {"author": None, "created": "2026-10-02", "body": {"type": "doc"}}]},
        }}
        result = slim_issue(issue, self.settings)
        self.assertEqual(result["qaPlannedHours"], 2.5)
        self.assertEqual(result["qaAssignee"]["accountId"], "qa")
        self.assertEqual(result["worklogs"][0]["authorAccountId"], "sam")
        self.assertEqual(len(result["comments"][0]["body"]), 200)
        self.assertEqual(result["comments"][1]["body"], "")
        self.assertEqual(result["spentSeconds"], 0)
        issue["fields"][self.settings.jira_qa_planned_hours_field] = True
        self.assertIsNone(slim_issue(issue, self.settings)["qaPlannedHours"])

    async def test_history_uses_done_and_updated_cursor_with_resolution_fallback(self):
        self.page([{"key": "TEAM-1", "fields": {"project": {"key": "TEAM"}, "summary": "Done", "issuetype": {"name": "Task"}, "updated": "2026-10-01T09:00:00Z", "resolutiondate": None}}])
        result = await self.fetcher.history("2026-10-01T08:12:45Z")
        self.assertEqual(result[0]["resolutiondate"], "2026-10-01T09:00:00Z")
        self.assertIn('updated > "2026-10-01 08:12"', self.body()["jql"])
        self.assertIn("statusCategory = Done", self.body()["jql"])
        self.assertNotIn("resolution is not EMPTY", self.body()["jql"])
        self.assertIn("ORDER BY updated ASC", self.body()["jql"])

    async def test_full_history_stops_at_limit_without_losing_order(self):
        self.page([{"key": f"TEAM-{index}", "fields": {"project": {"key": "TEAM"}, "summary": "Done", "issuetype": {"name": "Task"}, "updated": "2026-10-01"}} for index in range(3)], "unused")
        result = await self.fetcher.history(limit=2)
        self.assertEqual([row["key"] for row in result], ["TEAM-0", "TEAM-1"])
        self.assertEqual(len(self.requests), 1)

    async def test_invalid_provider_shape_is_rejected(self):
        self.responses.append(httpx.Response(200, json={"issues": {}}))
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            await self.fetcher.search("project = TEAM", [])


if __name__ == "__main__":
    unittest.main()
