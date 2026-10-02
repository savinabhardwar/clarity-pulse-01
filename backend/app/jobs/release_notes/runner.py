"""Generate releases from the schedule; supports a write-free dry run."""

import argparse
import asyncio
from datetime import date, datetime, timezone
import json
import re

import httpx

from app.jobs.config import JobSettings
from app.jobs.jira_sync.fetch import JiraFetcher, quoted
from app.jobs.release_notes.confluence import Confluence
from app.jobs.release_notes.schedule import SPACE_ID, completeness_note, find_due_releases, product_config
from app.jobs.release_notes.summarize import Summarizer


async def fetch_completed_issues(fetcher, jira_key, since, until):
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", jira_key):
        raise ValueError("Invalid Jira project key")
    date.fromisoformat(since)
    date.fromisoformat(until)
    issues = await fetcher.search(f'project = {jira_key} AND statusCategory = Done AND issuetype != "QAlity Test" AND updated >= {quoted(since)} AND updated <= {quoted(until)} ORDER BY updated ASC',
                                 ["summary", "issuetype", "assignee", "updated", "subtasks", "issuelinks"])
    return [{"key": issue["key"], "issuetype": (issue["fields"].get("issuetype") or {}).get("name"),
             "summary": issue["fields"]["summary"], "assignee": (issue["fields"].get("assignee") or {}).get("displayName"),
             "updated": issue["fields"]["updated"], "completenessNote": completeness_note(issue)} for issue in issues]


async def run_one(entry, until, dry_run, *, fetcher, summarizer, confluence):
    issues = await fetch_completed_issues(fetcher, entry["jiraKey"], entry["lastReleaseDate"], until)
    markdown = await summarizer.summarize(entry["product"], issues)
    result = await confluence.publish(space_id=SPACE_ID, parent_page_id=entry["parentPageId"], product=entry["product"],
                                      since=entry["lastReleaseDate"], until=until, markdown=markdown, dry_run=dry_run)
    if not dry_run:
        # Also recover a previous run which published its page but failed
        # before advancing the schedule. Exact-title dedup proves this period
        # already exists and prevents posting a duplicate during recovery.
        await confluence.update_schedule_row(entry["product"], {"lastReleaseDate": until, "nextReleaseDate": ""})
    return result


async def run_releases(today, dry_run, *, fetcher, summarizer, confluence, project=None):
    date.fromisoformat(today)
    rows = await confluence.read_schedule()
    if project:
        row = next((row for row in rows if row["product"] == project or row["jiraKey"] == project), None)
        config = product_config(row["product"] if row else project)
        if row is None or config is None or not row["lastReleaseDate"]:
            raise ValueError("Product schedule/config or last release date is missing")
        due = [{**config, "lastReleaseDate": row["lastReleaseDate"]}]
    else:
        due = find_due_releases(rows, today)
    results, failures = [], []
    for entry in due:
        try:
            results.append(await run_one(entry, today, dry_run, fetcher=fetcher, summarizer=summarizer, confluence=confluence))
        except Exception as error:
            failures.append({"product": entry["product"], "errorType": type(error).__name__})
    if failures:
        raise RuntimeError("Release notes failed for: " + ", ".join(row["product"] for row in failures))
    return results


async def main(args):
    settings = JobSettings()
    missing = [name.upper() for name in ["jira_base_url", "jira_email", "jira_api_token", "gemini_api_key"] if not getattr(settings, name)]
    if missing:
        raise RuntimeError("Missing required environment variable(s): " + ", ".join(missing))
    async with httpx.AsyncClient(timeout=90) as client:
        results = await run_releases(args.date, args.dry_run, fetcher=JiraFetcher(settings, client),
                                     summarizer=Summarizer(settings, client), confluence=Confluence(settings, client), project=args.project)
    print(json.dumps(results))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--project")
    parser.add_argument("--date", default=datetime.now(timezone.utc).date().isoformat())
    asyncio.run(main(parser.parse_args()))
