"""Bounded Confluence REST access; provider errors never include secrets."""

import asyncio
from urllib.parse import parse_qs, quote, urlparse
import re

import httpx

from app.jobs.release_notes.schedule import (
    RELEASE_SCHEDULE_PAGE_ID, build_body_html, build_title, parse_schedule, render_table,
)


class ProviderError(RuntimeError):
    def __init__(self, provider, status, *, daily_quota=False):
        super().__init__(f"{provider} request failed (HTTP {status})")
        self.status = status
        self.daily_quota = daily_quota


class Confluence:
    def __init__(self, settings, client, sleep=asyncio.sleep):
        if not settings.jira_base_url or not settings.jira_email or not settings.jira_api_token:
            raise RuntimeError("JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN are required")
        self.base = settings.jira_base_url.rstrip("/") + "/wiki/api/v2"
        self.auth = httpx.BasicAuth(settings.jira_email, settings.jira_api_token.get_secret_value())
        self.client, self.sleep = client, sleep

    async def request(self, path, method="GET", body=None):
        for attempt in range(3):
            response = await self.client.request(method, self.base + path, auth=self.auth, json=body)
            if response.is_success:
                return None if response.status_code == 204 else response.json()
            if attempt == 2 or not (response.status_code == 429 or response.status_code >= 500):
                raise ProviderError("Confluence", response.status_code)
            await self.sleep(2 * 2 ** attempt)

    async def get_page(self, page_id):
        return await self.request(f"/pages/{quote(str(page_id), safe='')}?body-format=storage")

    async def children(self, page_id):
        result, cursor, seen = [], None, set()
        while True:
            query = "?limit=100" + ("&cursor=" + quote(cursor, safe="") if cursor else "")
            body = await self.request(f"/pages/{quote(str(page_id), safe='')}/children{query}")
            if not isinstance(body.get("results"), list):
                raise ValueError("Invalid Confluence children response")
            result.extend(body["results"])
            next_url = (body.get("_links") or {}).get("next")
            cursor = parse_qs(urlparse(next_url).query).get("cursor", [None])[0] if next_url else None
            if not cursor:
                return result
            if cursor in seen:
                raise ValueError("Confluence repeated a pagination cursor")
            seen.add(cursor)

    async def read_schedule(self):
        return parse_schedule((await self.get_page(RELEASE_SCHEDULE_PAGE_ID))["body"]["storage"]["value"])

    async def update_schedule_row(self, product, patch):
        # Parse and update one freshly-read version; optimistic versioning
        # prevents overwriting a manual edit made after this read.
        page = await self.get_page(RELEASE_SCHEDULE_PAGE_ID)
        body = page["body"]["storage"]["value"]
        rows = parse_schedule(body)
        row = next((row for row in rows if row["product"] == product), None)
        if row is None:
            raise ValueError("No schedule row for product")
        row.update(patch)
        updated, count = re.subn(r"<table[\s\S]*</table>", lambda _: render_table(rows), body, count=1)
        if count != 1:
            raise ValueError("Release schedule table is missing")
        return await self.request(f"/pages/{RELEASE_SCHEDULE_PAGE_ID}", "PUT", {
            "id": RELEASE_SCHEDULE_PAGE_ID, "status": "current", "title": page["title"],
            "body": {"representation": "storage", "value": updated},
            "version": {"number": page["version"]["number"] + 1, "message": "release-notes automation"},
        })

    async def publish(self, *, space_id, parent_page_id, product, since, until, markdown, dry_run=False):
        title, body = build_title(product, since, until), build_body_html(product, since, markdown)
        if dry_run:
            return {"title": title, "dryRun": True, "bodyHtml": body}
        if any(child["title"] == title for child in await self.children(parent_page_id)):
            return {"title": title, "skipped": True}
        page = await self.request("/pages", "POST", {
            "spaceId": space_id, "parentId": parent_page_id, "title": title, "status": "current",
            "body": {"representation": "storage", "value": body},
        })
        return {"title": title, "pageId": page["id"]}
