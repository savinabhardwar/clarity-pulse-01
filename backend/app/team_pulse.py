"""Team Pulse's additional data contract and availability operations."""
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.dashboard import db

router = APIRouter(tags=["team-pulse"])
TICKET_FIELDS = "id,jira_key,summary,assignee_person_id,original_estimate_seconds,time_spent_seconds,sprint_id,is_blocked,status"


@router.get("/tracked-sprints")
async def tracked_sprints(request: Request):
    return await db(request).rows("sprints", select="id,start_date", is_tracked="eq.true")


@router.get("/adjustments")
async def adjustments(request: Request):
    return await db(request).rows("adjustments", select="person_id,leave_days_this_sprint,note")


@router.get("/open-tickets")
async def open_tickets(request: Request):
    return await db(request).rows("tickets", select=TICKET_FIELDS, status_category="neq.done")


@router.get("/sprint-done-tickets")
async def done_tickets(request: Request, sprint_ids: Annotated[str, Query(alias="sprintIds", max_length=4000)]):
    try:
        ids = [str(UUID(value)) for value in sprint_ids.split(",")]
        if not 1 <= len(ids) <= 100:
            raise ValueError
    except ValueError:
        raise HTTPException(422, "sprintIds must contain 1 to 100 UUIDs") from None
    return await db(request).rows("tickets", select=TICKET_FIELDS, status_category="eq.done", sprint_id="in.(" + ",".join(ids) + ")")


@router.get("/worklog-ticket-ids")
async def worklog_ids(request: Request):
    return await db(request).rows("worklogs", select="ticket_id")


@router.get("/sprint-worklogs")
async def sprint_worklogs(request: Request, since: datetime):
    return await db(request).rows("worklogs", select="ticket_id,author_person_id,seconds", started_at="gte." + since.isoformat())


@router.get("/all-worklogs")
async def all_worklogs(request: Request):
    return await db(request).rows("worklogs", select="ticket_id,author_person_id,started_at,seconds")


@router.get("/person-history/{person_id}")
async def person_history(person_id: UUID, request: Request):
    return await db(request).rows("person_metrics_history", select="computed_at,pace_pct,bandwidth_hours,estimate_accuracy",
                                 person_id="eq." + str(person_id), order="computed_at.desc", limit=4)


@router.get("/planning-availability")
async def availability(request: Request):
    return await db(request).rows("planning_availability", select="id,person_id,from_date,to_date,hours,notes", order="from_date.desc")


class AvailabilityInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    person_id: UUID
    from_date: date
    to_date: date
    hours: Decimal = Field(gt=0, le=99999.9, max_digits=6, decimal_places=1)
    notes: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def valid_range(self):
        if self.to_date < self.from_date:
            raise ValueError("To date cannot precede from date")
        return self


async def mutate(request, method, payload=None, row_id=None):
    parameters = {"select": "*"}
    if row_id is not None:
        parameters["id"] = "eq." + str(row_id)
    body = payload.model_dump(mode="json") if payload is not None else None
    if body is not None:
        body["hours"] = float(payload.hours)
    response = await db(request).request(method, "planning_availability", params=parameters, json=body,
                                         headers={"Prefer": "return=representation"})
    rows = db(request).json(response)
    if not isinstance(rows, list):
        raise HTTPException(502, "Unexpected availability response")
    if row_id is not None and not rows:
        raise HTTPException(404, "Availability entry not found")
    return rows


@router.post("/planning-availability", status_code=201)
async def add_availability(payload: AvailabilityInput, request: Request):
    return await mutate(request, "POST", payload)


@router.patch("/planning-availability/{row_id}")
async def update_availability(row_id: UUID, payload: AvailabilityInput, request: Request):
    return await mutate(request, "PATCH", payload, row_id)


@router.delete("/planning-availability/{row_id}", status_code=204)
async def delete_availability(row_id: UUID, request: Request):
    await mutate(request, "DELETE", row_id=row_id)
    return Response(status_code=204)


@router.get("/next-sprint-tickets")
async def next_sprint(request: Request):
    return await db(request).rows("next_sprint_tickets", select="jira_key,jira_project_key,board_name,jira_sprint_id,sprint_name,sprint_start_date,sprint_end_date,sprint_goal,summary,issue_type,status,priority,assignee_person_id,assignee_name,original_estimate_seconds", order="jira_key.asc")


@router.get("/canonical-sprint")
async def canonical_sprint(request: Request):
    return await db(request).rows("v_canonical_sprint", select="name,start_date,end_date", limit=1)


@router.get("/team-sprint-summaries")
async def team_summaries(request: Request):
    return await db(request).rows("v_team_sprint_summaries", order="sprint_start.asc")


@router.get("/org-sprint-summaries")
async def org_summaries(request: Request):
    return await db(request).rows("v_org_sprint_summaries", order="sprint_start.asc")


@router.post("/jira-sync")
async def trigger_sync(request: Request):
    settings = db(request).settings
    if not settings.github_actions_token:
        raise HTTPException(503, "GitHub sync trigger is not configured")
    try:
        response = await db(request).client.post(
            "https://api.github.com/repos/savinabhardwar/clarity-pulse-01/actions/workflows/jira-sync.yml/dispatches",
            headers={"Authorization": "Bearer " + settings.github_actions_token.get_secret_value(), "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "clarity-pulse-team-pulse"},
            json={"ref": settings.github_actions_ref, "inputs": {"sync_type": "incremental"}})
    except httpx.HTTPError:
        raise HTTPException(502, "GitHub is unavailable") from None
    if response.status_code != 204:
        raise HTTPException(502, "GitHub sync dispatch failed")
    return {"triggeredAt": datetime.now(timezone.utc).isoformat()}
