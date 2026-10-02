"""Resolve configured projects, poll snapshots, enqueue, and process events."""

import base64
from datetime import datetime, timedelta, timezone
import re

from ai_pm.events import QueuedEvent, normalize_jira, normalize_requirement

HINT_COLUMNS = {"jira": "jira_project_key", "github": "git_repository", "requirements-app": "requirements_project_id"}


class ProviderFailure(RuntimeError):
    pass


class Unconfigured(RuntimeError):
    pass


class Service:
    def __init__(self, config, client, queue, clock=None):
        self.config, self.client, self.queue = config, client, queue
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def headers(self, requirements=False):
        key = self.config.requirements_app_supabase_key if requirements else self.config.supabase_service_role_key
        url = self.config.requirements_app_supabase_url if requirements else self.config.supabase_url
        if not key or not url:
            raise Unconfigured("Supabase connection is not configured")
        return {"apikey": key, "Authorization": "Bearer " + key}

    async def rest(self, resource, params, requirements=False, method="GET", body=None):
        base = self.config.requirements_app_supabase_url if requirements else self.config.supabase_url
        headers = self.headers(requirements)
        response = await self.client.request(method, base.rstrip("/") + "/rest/v1/" + resource,
                                             params=params, headers=headers, json=body)
        if not response.is_success:
            raise ProviderFailure(f"Supabase operation failed (HTTP {response.status_code})")
        return response.json()

    async def resolve_project(self, source, hint):
        column = HINT_COLUMNS.get(source)
        if not column:
            return None
        rows = await self.rest("projects", {"select": "id", column: "eq." + hint, "limit": "1"})
        if not isinstance(rows, list):
            raise ProviderFailure("Invalid project resolution response")
        return rows[0]["id"] if rows else None

    async def enqueue(self, event, project_id):
        if self.queue is None:
            raise Unconfigured("Event queue is not configured")
        queued = QueuedEvent.model_validate({**event, "projectId": project_id})
        await self.queue.send(queued.model_dump(mode="json"))

    async def poll_jira(self, window_minutes=10):
        projects = await self.rest("projects", {"select": "id,jira_project_key", "jira_project_key": "not.is.null"})
        by_key = {row["jira_project_key"]: row["id"] for row in projects}
        if not by_key:
            return {"enqueued": 0}
        if any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", key) for key in by_key):
            raise ValueError("Invalid configured Jira project key")
        config = self.config
        if not config.jira_base_url or not config.jira_email or not config.jira_api_token:
            raise Unconfigured("Jira polling is not configured")
        auth = base64.b64encode(f"{config.jira_email}:{config.jira_api_token}".encode()).decode()
        jql = f"project in ({','.join(by_key)}) AND updated >= -{window_minutes}m ORDER BY updated ASC"
        cursor, seen, issues = None, set(), []
        while True:
            params = {"jql": jql, "fields": "project,summary,status,issuetype,updated,created,assignee", "maxResults": "100"}
            if cursor:
                params["nextPageToken"] = cursor
            response = await self.client.request("GET", config.jira_base_url.rstrip("/") + "/rest/api/3/search/jql",
                                                 params=params, headers={"Authorization": "Basic " + auth, "Accept": "application/json"})
            if not response.is_success:
                raise ProviderFailure(f"Jira polling failed (HTTP {response.status_code})")
            body = response.json()
            if not isinstance(body.get("issues"), list):
                raise ProviderFailure("Invalid Jira polling response")
            issues.extend(body["issues"])
            cursor = body.get("nextPageToken")
            if not cursor:
                break
            if not isinstance(cursor, str) or cursor in seen:
                raise ProviderFailure("Invalid Jira polling pagination token")
            seen.add(cursor)
        count = 0
        for issue in issues:
            project_id = by_key.get(issue["fields"]["project"]["key"])
            if project_id:
                await self.enqueue(normalize_jira(issue), project_id)
                count += 1
        return {"enqueued": count}

    async def poll_requirements(self, window_minutes=10):
        projects = await self.rest("projects", {"select": "id,requirements_project_id", "requirements_project_id": "not.is.null"})
        by_id = {row["requirements_project_id"]: row["id"] for row in projects}
        if not by_id:
            return {"enqueued": 0}
        # Quote the PostgREST in-list and escape user-configured identifiers.
        identifiers = ",".join('"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"' for value in by_id)
        since = (self.clock() - timedelta(minutes=window_minutes)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        items, offset = [], 0
        while True:
            batch = await self.rest("stakeholder_items", {"select": "id,project_id,summary,status,created_by,updated_at",
                                    "project_id": "in.(" + identifiers + ")", "updated_at": "gte." + since,
                                    "order": "id.asc", "limit": "1000", "offset": str(offset)}, requirements=True)
            if not isinstance(batch, list):
                raise ProviderFailure("Invalid requirements polling response")
            items.extend(batch)
            if len(batch) < 1000:
                break
            offset += len(batch)
        count = 0
        for item in items:
            project_id = by_id.get(item.get("project_id"))
            event = normalize_requirement(item) if project_id else None
            if event:
                await self.enqueue(event, project_id)
                count += 1
        return {"enqueued": count}

    async def process(self, event):
        event = QueuedEvent.model_validate(event).model_dump(mode="json")
        # One transaction on the server covers both the immutable log and
        # compact state. A state failure rolls back the dedup marker too.
        result = await self.rest("rpc/process_queued_event", {}, method="POST", body={"p_event": event})
        if not isinstance(result, bool):
            raise ProviderFailure("Invalid event processing response")
        return {"processed": result}


def backoff_seconds(attempts):
    return min(30 * 2 ** max(int(attempts) - 1, 0), 900)


async def process_batch(messages, service):
    outcomes = []
    for message in messages:
        try:
            await service.process(message.body)
            message.ack()
            outcomes.append({"id": message.id, "acknowledged": True})
        except Exception:
            delay = backoff_seconds(message.attempts)
            message.retry(delay)
            outcomes.append({"id": message.id, "acknowledged": False, "retryDelaySeconds": delay})
    return outcomes
