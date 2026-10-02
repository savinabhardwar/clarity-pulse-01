import json
from pathlib import Path
from legacy_fixtures import reference_run
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock

import httpx

from app.jobs.config import JobSettings
from app.jobs.jira_sync.fetch import JiraFetcher
from app.jobs.release_notes.confluence import Confluence, ProviderError
from app.jobs.release_notes.runner import fetch_completed_issues, run_one, run_releases
from app.jobs.release_notes.schedule import (
    build_body_html, build_title, completeness_note, find_due_releases, parse_schedule, product_config, render_table,
)
from app.jobs.release_notes.summarize import GEMINI_MODELS, Summarizer, build_prompt


def settings(**overrides):
    return JobSettings(_env_file=None, jira_base_url="https://jira.example", jira_email="fixture@example.com",
                       jira_api_token="fixture-token", gemini_api_key="fixture-gemini", **overrides)


class ReleaseFormatTests(TestCase):
    def test_formats_completeness_and_prompt_match_original(self):
        rows = [{"product": "QIP & Portal", "jiraKey": "QIP", "lastReleaseDate": "2026-09-01", "nextReleaseDate": ""}]
        html = render_table(rows)
        markdown = "## Portal & clients\n- **Customer <portal>** — A & B can log in.\n* Plain <bullet>\n### Another area\n- **Feature**: More work."
        issue = {"key": "QIP-1", "fields": {"subtasks": [{"key": "QIP-2", "fields": {"status": {"statusCategory": {"key": "new"}}}}],
                   "issuelinks": [{"type": {"name": "Relates", "outward": "relates to"}, "outwardIssue": {"key": "QIP-3", "fields": {}}},
                                  {"type": {"name": "Duplicate"}, "outwardIssue": {"key": "QIP-4", "fields": {}}}]}}
        prompt_issues = [{"key": "QIP-1", "issuetype": "Story", "summary": "Customer portal", "completenessNote": completeness_note(issue)}]
        cases = [{"operation": "format", "data": {"dates": ["QIP", "2026-08-24", "2026-09-30"], "body": ["QIP & Portal", "2026-08-24", markdown], "rows": rows, "html": html}},
                 {"operation": "completeness", "data": issue}, {"operation": "prompt", "data": {"product": "QIP", "issues": prompt_issues}}]
        result = reference_run("release", input=json.dumps(cases), capture_output=True, text=True, encoding="utf-8", check=True)
        original = json.loads(result.stdout)
        self.assertEqual(original[0]["title"], build_title("QIP", "2026-08-24", "2026-09-30"))
        self.assertEqual(original[0]["body"], build_body_html("QIP & Portal", "2026-08-24", markdown))
        self.assertEqual(original[0]["rendered"], html)
        self.assertEqual(parse_schedule(html), rows)
        self.assertEqual(original[1], completeness_note(issue))
        self.assertEqual(original[2], build_prompt("QIP", prompt_issues))

    def test_due_dates_include_overdue_but_require_seed_and_known_product(self):
        rows = [{"product": name, "jiraKey": "QIP", "lastReleaseDate": last, "nextReleaseDate": next_date}
                for name, last, next_date in [("QIP", "2026-08-01", "2026-09-01"), ("Amy", "2026-08-01", "2026-10-02"),
                                              ("Billing", "", "2026-09-01"), ("Unknown", "2026-08-01", "2026-09-01")]]
        self.assertEqual(find_due_releases(rows, "2026-10-01"), [{**product_config("QIP"), "lastReleaseDate": "2026-08-01"}])
        self.assertEqual(parse_schedule('<table><tr><th>Header</th></tr><tr><td>A</td><td>QIP</td><td>-</td></tr></table>')[0]["lastReleaseDate"], "")


class ConfluenceTests(IsolatedAsyncioTestCase):
    async def test_children_paginate_and_publish_deduplicates(self):
        requests = []
        title = build_title("QIP", "2026-09-01", "2026-10-01")
        def handler(request):
            requests.append(request)
            if "cursor" not in request.url.params:
                return httpx.Response(200, json={"results": [], "_links": {"next": "/wiki/api/v2/pages/parent/children?cursor=a%2Bb"}})
            self.assertEqual(request.url.params["cursor"], "a+b")
            return httpx.Response(200, json={"results": [{"title": title}], "_links": {}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await Confluence(settings(), client).publish(space_id="space", parent_page_id="parent", product="QIP", since="2026-09-01", until="2026-10-01", markdown="- Feature")
        self.assertTrue(result["skipped"])
        self.assertTrue(all(request.method == "GET" for request in requests))

    async def test_dry_run_does_not_even_read_confluence(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: self.fail("dry run sent request"))) as client:
            result = await Confluence(settings(), client).publish(space_id="s", parent_page_id="p", product="QIP", since="2026-09-01", until="2026-10-01", markdown="- **Portal** — Works", dry_run=True)
        self.assertTrue(result["dryRun"])
        self.assertIn("<strong>Portal</strong>", result["bodyHtml"])

    async def test_schedule_update_uses_fresh_version_and_preserves_surrounding_body(self):
        rows = [{"product": "QIP", "jiraKey": "QIP", "lastReleaseDate": "2026-09-01", "nextReleaseDate": "2026-10-01"}]
        writes = []
        def handler(request):
            if request.method == "GET":
                return httpx.Response(200, json={"title": "Schedule", "version": {"number": 7}, "body": {"storage": {"value": "<p>Before</p>" + render_table(rows) + "<p>After</p>"}}})
            writes.append(json.loads(request.content))
            return httpx.Response(200, json={"id": "schedule"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await Confluence(settings(), client).update_schedule_row("QIP", {"lastReleaseDate": "2026-10-01", "nextReleaseDate": ""})
        self.assertEqual(writes[0]["version"]["number"], 8)
        body = writes[0]["body"]["value"]
        self.assertTrue(body.startswith("<p>Before</p>"))
        self.assertTrue(body.endswith("<p>After</p>"))
        self.assertEqual(parse_schedule(body)[0]["nextReleaseDate"], "")

    async def test_provider_retries_only_transient_errors_and_sanitizes_failure(self):
        sleep = AsyncMock()
        statuses = iter([503, 429, 403])
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(next(statuses), text="secret-provider-payload"))) as client:
            with self.assertRaises(ProviderError) as error:
                await Confluence(settings(), client, sleep).get_page("id")
        self.assertEqual(sleep.await_count, 2)
        self.assertNotIn("secret", str(error.exception))


class SummaryTests(IsolatedAsyncioTestCase):
    async def test_empty_batch_avoids_model_calls(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: self.fail("empty batch called model"))) as client:
            self.assertIn("No tickets", await Summarizer(settings(), client).summarize("QIP", []))

    async def test_daily_quota_is_skipped_for_later_products_and_falls_through_models(self):
        calls = []
        def handler(request):
            self.assertEqual(request.headers["x-goog-api-key"], "fixture-gemini")
            self.assertNotIn("fixture-gemini", str(request.url))
            calls.append(request.url.path)
            if GEMINI_MODELS[0][0] in request.url.path:
                return httpx.Response(429, text="GenerateRequestsPerDayPerProject")
            return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "- **Portal** — Works"}]}}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            summary = Summarizer(settings(), client, AsyncMock())
            for product in ["QIP", "Amy"]:
                await summary.summarize(product, [{"key": "QIP-1", "summary": "Portal", "issuetype": "Story"}])
        self.assertEqual(sum(GEMINI_MODELS[0][0] in path for path in calls), 1)
        self.assertEqual(len(calls), 3)

    async def test_bad_key_does_not_walk_every_gemini_model(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(401, text="private")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(ProviderError):
                await Summarizer(settings(), client).summarize("QIP", [{"key": "QIP-1", "summary": "Portal"}])
        self.assertEqual(len(requests), 1)

    async def test_workers_fallback_and_truncated_outputs(self):
        requests = []
        def handler(request):
            requests.append(request)
            if request.url.host == "generativelanguage.googleapis.com":
                return httpx.Response(503, text="unavailable")
            self.assertEqual(json.loads(request.content)["max_tokens"], 4096)
            return httpx.Response(200, json={"success": True, "result": {"response": "- **Portal** — Works", "choices": [{"finish_reason": "stop"}]}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await Summarizer(settings(cloudflare_account_id="account", cloudflare_api_token="token"), client, AsyncMock()).summarize("QIP", [{"key": "QIP-1", "summary": "Portal"}])
        self.assertEqual(result, "- **Portal** — Works")
        self.assertEqual(len(requests), sum(attempts for _, attempts in GEMINI_MODELS) + 1)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"success": True, "result": {"response": "cut off", "choices": [{"finish_reason": "length"}]}}))) as client:
            with self.assertRaisesRegex(ValueError, "truncated"):
                await Summarizer(settings(cloudflare_account_id="account", cloudflare_api_token="token"), client).workers_ai("prompt")


class ReleaseRunnerTests(IsolatedAsyncioTestCase):
    async def test_jira_completion_query_and_link_notes(self):
        fetcher = AsyncMock()
        fetcher.search.return_value = [{"key": "QIP-1", "fields": {"summary": "Portal", "updated": "2026-10-01", "subtasks": [{"key": "QIP-2", "fields": {}}]}}]
        result = await fetch_completed_issues(fetcher, "QIP", "2026-09-01", "2026-10-01")
        self.assertIn('issuetype != "QAlity Test"', fetcher.search.call_args.args[0])
        self.assertEqual(result[0]["completenessNote"], "pending subtask(s): QIP-2")
        with self.assertRaises(ValueError):
            await fetch_completed_issues(fetcher, 'QIP OR 1=1', "2026-09-01", "2026-10-01")

    async def test_dry_run_never_advances_schedule_but_duplicate_recovers_it(self):
        fetcher, summarizer, confluence = AsyncMock(), AsyncMock(), AsyncMock()
        fetcher.search.return_value = []
        summarizer.summarize.return_value = "- Feature"
        entry = {**product_config("QIP"), "lastReleaseDate": "2026-09-01"}
        await run_one(entry, "2026-10-01", True, fetcher=fetcher, summarizer=summarizer, confluence=confluence)
        confluence.update_schedule_row.assert_not_awaited()
        confluence.publish.return_value = {"skipped": True}
        await run_one(entry, "2026-10-01", False, fetcher=fetcher, summarizer=summarizer, confluence=confluence)
        confluence.update_schedule_row.assert_awaited_once_with("QIP", {"lastReleaseDate": "2026-10-01", "nextReleaseDate": ""})

    async def test_publish_failure_does_not_advance_schedule_and_other_products_continue(self):
        fetcher, summarizer, confluence = AsyncMock(), AsyncMock(), AsyncMock()
        fetcher.search.return_value = []
        summarizer.summarize.return_value = "- Feature"
        confluence.read_schedule.return_value = [{"product": product, "jiraKey": key, "lastReleaseDate": "2026-09-01", "nextReleaseDate": "2026-10-01"} for product, key in [("QIP", "QIP"), ("Amy", "AMY")]]
        confluence.publish.side_effect = [RuntimeError("failed"), {"pageId": "new-page"}]
        with self.assertRaisesRegex(RuntimeError, "QIP"):
            await run_releases("2026-10-01", False, fetcher=fetcher, summarizer=summarizer, confluence=confluence)
        confluence.update_schedule_row.assert_awaited_once_with("Amy", {"lastReleaseDate": "2026-10-01", "nextReleaseDate": ""})
