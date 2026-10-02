"""Pure normalization and HMAC verification over the original bytes."""

import hashlib
import hmac
import re

from pydantic import BaseModel, ConfigDict, Field
from typing import Any, Literal
from uuid import UUID


class Actor(BaseModel):
    type: Literal["user", "system"]
    id: str


class QueuedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["jira", "github", "requirements-app"]
    eventType: str = Field(min_length=1)
    projectHint: str = Field(min_length=1)
    entityType: str = Field(min_length=1)
    entityId: str = Field(min_length=1)
    actor: Actor | None
    timestamp: str = Field(min_length=1)
    payload: Any
    correlationId: str | None
    providerEventId: str = Field(min_length=1)
    projectId: UUID


def verify_signature(body, secret, signature):
    if not secret or not signature or not re.fullmatch(r"[A-Za-z0-9]+=[0-9a-fA-F]+", signature):
        return False
    algorithm, hexadecimal = signature.lower().split("=", 1)
    if algorithm != "sha256" or len(hexadecimal) != 64:
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, hexadecimal)


def normalize_jira(issue):
    fields = issue["fields"]
    assignee = fields.get("assignee")
    return {"source": "jira", "eventType": "issue.observed", "projectHint": fields["project"]["key"],
            "entityType": "issue", "entityId": issue["key"],
            "actor": {"type": "user", "id": assignee["accountId"]} if assignee else None,
            "timestamp": fields["updated"], "payload": issue, "correlationId": None,
            "providerEventId": f"{issue['id']}:{fields['updated']}"}


def normalize_push(payload, delivery_id):
    return [{"source": "github", "eventType": "commit.pushed", "projectHint": payload["repository"]["full_name"],
             "entityType": "commit", "entityId": commit["id"], "actor": {"type": "user", "id": commit["author"]["username"]},
             "timestamp": commit["timestamp"], "payload": commit, "correlationId": delivery_id,
             "providerEventId": f"{delivery_id}:{commit['id']}"} for commit in payload["commits"]]


def normalize_pull_request(payload, delivery_id):
    pr = payload["pull_request"]
    return {"source": "github", "eventType": "pull_request.merged" if pr["merged"] else f"pull_request.{payload['action']}",
            "projectHint": payload["repository"]["full_name"], "entityType": "pull_request", "entityId": str(pr["number"]),
            "actor": {"type": "user", "id": pr["user"]["login"]}, "timestamp": pr["updated_at"], "payload": pr,
            "correlationId": delivery_id, "providerEventId": f"{delivery_id}:{pr['number']}:{payload['action']}"}


def normalize_requirement(item):
    if item["project_id"] is None:
        return None
    return {"source": "requirements-app", "eventType": "requirement.observed", "projectHint": item["project_id"],
            "entityType": "requirement", "entityId": item["id"],
            "actor": {"type": "user", "id": item["created_by"]} if item.get("created_by") else None,
            "timestamp": item["updated_at"], "payload": item, "correlationId": None,
            "providerEventId": f"{item['id']}:{item['updated_at']}"}
