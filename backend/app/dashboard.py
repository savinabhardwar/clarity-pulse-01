"""Dashboard reads preserve existing database views and RPC calculations."""

import asyncio
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(tags=["dashboard"])


def db(request: Request):
    return request.app.state.supabase


@router.get("/people")
async def people(request: Request, as_of: Annotated[datetime | None, Query(alias="asOf")] = None):
    service = db(request)
    if as_of is not None:
        return await service.rpc("get_people_overview_asof", {"p_asof": as_of.isoformat()}, order="utilisation_pct.desc")
    return await service.rows("v_people_overview", order="utilisation_pct.desc")


@router.get("/people/{person_id}")
async def person_detail(person_id: UUID, request: Request):
    return await db(request).rpc("get_person_detail", {"p_person_id": str(person_id)})


@router.get("/projects")
async def projects(request: Request):
    return await db(request).rows("v_projects_overview", order="hours_invested.desc")


@router.get("/projects/{slug}")
async def project_detail(slug: str, request: Request):
    return await db(request).rpc("get_project_detail", {"p_slug": slug})


@router.get("/allocations")
async def allocations(request: Request, person_id: Annotated[UUID | None, Query(alias="personId")] = None,
                      project_id: Annotated[UUID | None, Query(alias="projectId")] = None):
    filters = {}
    if person_id is not None:
        filters["person_id"] = f"eq.{person_id}"
    if project_id is not None:
        filters["project_id"] = f"eq.{project_id}"
    return await db(request).rows("v_person_allocations", **filters)


@router.get("/project-contributors")
async def contributors(request: Request):
    return await db(request).rows("v_person_allocations", select="person_id,project_id,pct,hours")


@router.get("/org-metrics")
async def org_metrics(request: Request):
    rows = await db(request).rows("v_org_metrics")
    if len(rows) != 1:
        raise HTTPException(502, "Expected one organization metrics record")
    return rows[0]


@router.get("/standouts")
async def standouts(request: Request):
    return await db(request).rows("v_standouts")


@router.get("/blockers")
async def blockers(request: Request):
    return await db(request).rows("v_all_blockers", order="days_blocked.desc")


@router.get("/ticket-hygiene")
async def hygiene(request: Request):
    return await db(request).rows("v_ticket_hygiene", order="person_name.asc")


@router.get("/recent-activity")
async def activity(request: Request, since: datetime | None = None):
    filters = {"occurred_at": f"gte.{since.isoformat()}"} if since is not None else {}
    return await db(request).rows("v_recent_activity", order="occurred_at.desc", limit=100 if since else 15, **filters)


@router.get("/top-risks")
async def risks(request: Request):
    return await db(request).rows("v_top_risks")


@router.get("/sprint-overrun-count")
async def sprint_overrun(request: Request):
    return await db(request).count("risks", category="eq.sprint_overrun", status="eq.open")


@router.get("/tracked-sprint-status")
async def sprint_status(request: Request):
    total, overrunning = await asyncio.gather(
        db(request).count("sprints", is_tracked="eq.true"),
        db(request).count("risks", category="eq.sprint_overrun", status="eq.open"),
    )
    return {"total": total, "overrunning": overrunning}


@router.get("/teams")
async def teams(request: Request):
    return await db(request).rows("teams", order="name.asc")
