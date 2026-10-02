"""Read-only Jira ingestion with pagination, transient retries and stable shapes."""

import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path

import httpx

from app.jobs.config import JobSettings
from app.jobs.jira_sync.core import PROJECT_NAMES, to_date

JIRA_PROJECTS = [{"key": key, "name": key if key in {"BL", "MR"} else name} for key, name in PROJECT_NAMES.items()]


def quoted(value):
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def account(value):
    return {"accountId": value["accountId"], "name": value.get("displayName")} if value else None


def slim_issue(issue, settings):
    fields = issue["fields"]
    status, parent = fields.get("status") or {}, fields.get("parent")
    result = {
        "key": issue["key"], "project": fields["project"]["key"], "summary": fields["summary"],
        "issuetype": (fields.get("issuetype") or {}).get("name"), "status": status.get("name"),
        "statusCategory": (status.get("statusCategory") or {}).get("key"),
        "priority": (fields.get("priority") or {}).get("name"), "assignee": account(fields.get("assignee")),
        "reporter": account(fields.get("reporter")), "created": fields.get("created"), "updated": fields.get("updated"),
        "resolutiondate": fields.get("resolutiondate"), "estimateSeconds": fields.get("timeoriginalestimate"),
        "remainingSeconds": fields.get("timeestimate"), "spentSeconds": fields.get("timespent") or 0,
        "qaAssignee": account(fields.get(settings.jira_qa_assignee_field)),
        "qaPlannedHours": None, "parent": None, "labels": fields.get("labels") or [],
        "worklogs": [{"id": log["id"], "authorAccountId": log["author"]["accountId"],
                      "authorName": log["author"].get("displayName"), "started": log["started"],
                      "created": log["created"], "seconds": log["timeSpentSeconds"]}
                     for log in (fields.get("worklog") or {}).get("worklogs") or []],
        "comments": [{"authorAccountId": (comment.get("author") or {}).get("accountId"),
                      "authorName": (comment.get("author") or {}).get("displayName"), "created": comment["created"],
                      "body": comment["body"][:200] if isinstance(comment.get("body"), str) else ""}
                     for comment in (fields.get("comment") or {}).get("comments") or []],
    }
    hours = fields.get(settings.jira_qa_planned_hours_field)
    if isinstance(hours, (int, float)) and not isinstance(hours, bool):
        result["qaPlannedHours"] = hours
    if parent:
        parent_fields = parent.get("fields") or {}
        result["parent"] = {"key": parent["key"], "summary": parent_fields.get("summary"), "issuetype": (parent_fields.get("issuetype") or {}).get("name")}
    return result


class JiraFetcher:
    def __init__(self, settings: JobSettings, client: httpx.AsyncClient, *, sleep=asyncio.sleep):
        self.settings, self.client, self.sleep = settings, client, sleep

    async def page(self, body):
        settings = self.settings
        if not settings.jira_base_url or not settings.jira_email or not settings.jira_api_token:
            raise RuntimeError("JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN are required")
        for attempt in range(3):
            response = await self.client.post(
                f"{settings.jira_base_url.rstrip('/')}/rest/api/3/search/jql",
                auth=httpx.BasicAuth(settings.jira_email, settings.jira_api_token.get_secret_value()), json=body,
            )
            if (response.status_code == 429 or response.status_code >= 500) and attempt < 2:
                await self.sleep(2 * 2 ** attempt)
                continue
            # Avoid logging provider response bodies or the credential-bearing URL.
            if not response.is_success:
                raise RuntimeError(f"Jira search failed (HTTP {response.status_code})")
            data = response.json()
            if not isinstance(data, dict) or not isinstance(data.get("issues"), list):
                raise ValueError("Unexpected Jira search response")
            return data

    async def search(self, jql, fields, *, max_results=100, limit=None):
        rows, token, seen = [], None, set()
        while True:
            body = {"jql": jql, "fields": fields, "maxResults": max_results}
            if token:
                body["nextPageToken"] = token
            data = await self.page(body)
            rows.extend(data["issues"])
            if limit is not None and len(rows) >= limit:
                return rows[:limit]
            token = data.get("nextPageToken")
            if not token:
                return rows
            if not isinstance(token, str) or token in seen:
                raise ValueError("Jira returned a repeated or invalid pagination token")
            seen.add(token)

    async def tracked_sprints(self, projects=None):
        result = []
        field = self.settings.jira_sprint_field
        for project in projects if projects is not None else JIRA_PROJECTS:
            issues = await self.search(f"project = {quoted(project['name'])} AND Sprint in openSprints()", [field], max_results=1, limit=1)
            if not issues:
                continue
            active = next((sprint for sprint in issues[0]["fields"].get(field) or [] if sprint.get("state") == "active"), None)
            if active:
                result.append({"jiraProjectKey": project["key"], "name": active["name"],
                               "startDate": active.get("startDate"), "endDate": active.get("endDate"),
                               "state": active["state"], "goal": active.get("goal") or None})
        return result

    async def in_window_issues(self, tracked):
        by_key = {project["key"]: project for project in JIRA_PROJECTS}
        clauses = [f"(project = {quoted(by_key[sprint['jiraProjectKey']]['name'])} AND Sprint = {quoted(sprint['name'])} AND issuetype != Epic)"
                   for sprint in tracked if sprint["jiraProjectKey"] in by_key]
        if not clauses:
            return []
        fields = ["summary", "status", "issuetype", "priority", "assignee", "reporter", "created", "updated",
                  "resolutiondate", "timeoriginalestimate", "timeestimate", "timespent", "parent", "project", "worklog", "comment", "labels",
                  self.settings.jira_qa_assignee_field, self.settings.jira_qa_planned_hours_field]
        issues = await self.search(" OR ".join(clauses), fields)
        return [slim_issue(issue, self.settings) for issue in issues]

    async def epics(self):
        clause = ", ".join(quoted(project["name"]) for project in JIRA_PROJECTS)
        issues = await self.search(f"project in ({clause}) AND issuetype = Epic ORDER BY project ASC, key ASC",
                                   ["summary", "status", "project", "created", "updated", "resolutiondate"])
        result = []
        for issue in issues:
            fields = issue["fields"]
            result.append({"key": issue["key"], "project": fields["project"]["key"], "summary": fields["summary"],
                           "status": fields["status"]["name"], "statusCategory": fields["status"]["statusCategory"]["key"],
                           "created": fields["created"], "updated": fields["updated"], "resolutiondate": fields.get("resolutiondate")})
        return result

    async def history(self, since=None, limit=500):
        clause = ", ".join(quoted(project["name"]) for project in JIRA_PROJECTS)
        jql = f"project in ({clause}) AND issuetype != Epic AND statusCategory = Done AND parent is not EMPTY"
        if since:
            instant = to_date(since).strftime("%Y-%m-%d %H:%M")
            jql += f" AND updated > {quoted(instant)} ORDER BY updated ASC"
        else:
            jql += " ORDER BY updated DESC"
        issues = await self.search(jql, ["summary", "issuetype", "resolutiondate", "updated", "timespent", "assignee", "parent", "project"],
                                   max_results=100 if since else min(limit, 100), limit=None if since else limit)
        return [{"key": issue["key"], "project": issue["fields"]["project"]["key"], "summary": issue["fields"]["summary"],
                 "issuetype": issue["fields"]["issuetype"]["name"], "resolutiondate": issue["fields"].get("resolutiondate") or issue["fields"].get("updated"),
                 "spentSeconds": issue["fields"].get("timespent") or 0, "assignee": account(issue["fields"].get("assignee")),
                 "parent": {"key": issue["fields"]["parent"]["key"], "summary": (issue["fields"]["parent"].get("fields") or {}).get("summary")} if issue["fields"].get("parent") else None}
                for issue in issues]

    async def fetch_all(self, cache_dir, history_watermark=None):
        cache = Path(cache_dir)
        cache.mkdir(parents=True, exist_ok=True)
        tracked = await self.tracked_sprints()
        issues = await self.in_window_issues(tracked)
        epics = await self.epics()
        history = await self.history(history_watermark)
        # Only publish the cache after every fetch succeeded.
        (cache / "tracked-sprints.json").write_text(json.dumps(tracked, indent=2), encoding="utf-8")
        for filename, rows in [("issues.raw.jsonl", issues), ("epics.raw.jsonl", epics), ("history.raw.jsonl", history)]:
            (cache / filename).write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
        return {"trackedSprints": tracked, "issueCount": len(issues), "epicCount": len(epics), "historyCount": len(history)}


async def main(args):
    async with httpx.AsyncClient(timeout=60) as client:
        result = await JiraFetcher(JobSettings(), client).fetch_all(args.cache_dir, args.history_watermark)
    print(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=Path(__file__).resolve().parents[3] / "jobs/jira-sync/cache")
    parser.add_argument("--history-watermark")
    asyncio.run(main(parser.parse_args()))
