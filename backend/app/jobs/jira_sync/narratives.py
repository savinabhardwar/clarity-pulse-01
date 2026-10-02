"""Deterministic executive narratives; no model calls or provider writes."""

from datetime import datetime, timedelta, timezone
import re

from psycopg2.extras import Json

from app.jobs.jira_sync.core import js_round, number, to_date

OVERSIZED_SECONDS = 35 * 3600


def clean_feature_name(summary):
    text = summary.strip()
    text = re.sub(r"^\[[^\]]+\]\s*", "", text)
    text = re.sub(r"^(fix|bug|task|story|issue|investigate|p\d issue)\s*[:\-]\s*", "", text, flags=re.I)
    text = re.sub(r"\s*\([^)]*\)\s*$", "", text)
    text = re.sub(r"\s*[-:]\s*(ui|api|backend|frontend|be|fe|db)$", "", text, flags=re.I)
    text = re.sub(r"\s{2,}", " ", text).strip() or summary.strip()
    return text[:1].upper() + text[1:]


def sprint_activity(tickets):
    logged, remaining, breakdown, delivered = 0, 0, [], []
    for ticket in tickets:
        # Preserve existing behavior: oversized work still counts as logged
        # investment; it is excluded from remaining hours and delivery names.
        logged += float(ticket["seconds_logged_since"]) / 3600
        if (ticket.get("original_estimate_seconds") or 0) > OVERSIZED_SECONDS:
            if ticket["status_category"] != "done":
                breakdown.append(ticket)
            continue
        touched = ticket["has_worklog_since"] or ticket["has_comment_since"]
        if ticket["status_category"] != "done" and touched:
            remaining += float(ticket.get("remaining_estimate_seconds") or 0) / 3600
        if ticket["status_category"] == "done" and touched and len(delivered) < 4:
            delivered.append(clean_feature_name(ticket["summary"]))
    return {"hoursLoggedSinceStart": logged, "hoursRemainingSinceStart": remaining,
            "needsBreakdown": breakdown, "deliveredThisSprint": delivered}


def build_timeline(project):
    timeline = []
    if project.get("started_at"):
        started = to_date(project["started_at"])
        month = "Jan Feb Mar Apr May Jun Jul Aug Sept Oct Nov Dec".split()[started.month - 1]
        timeline.append({"label": "Project Started", "date": f"{month} {started.year}", "kind": "start"})
    timeline.append({"label": "Current Sprint", "date": "In progress" if project.get("sprint_goal") else "Current sprint", "kind": "current"})
    if project.get("roadmap_go_live"):
        timeline.append({"label": "Expected Go Live", "date": project["roadmap_go_live"], "kind": "golive"})
    return timeline


def build_exec_risks(project, activity):
    risks = []
    name = project["name"]
    if project["health"] == "at_risk":
        risks.append({"text": f"{name} is currently off track against plan.", "severity": "high"})
    elif project["health"] == "needs_attention":
        risks.append({"text": f"{name} needs attention to stay on track this sprint.", "severity": "medium"})
    blocked = project["blocked_tickets"]
    if blocked > 0:
        risks.append({"text": f"{name} has {blocked} piece(s) of work blocked, slowing delivery.", "severity": "high" if blocked > 3 else "medium"})
    count = len(activity["needsBreakdown"])
    if count:
        risks.append({"text": f"{name} has {count} piece(s) of work too large to plan reliably and needs them broken down into smaller tasks.", "severity": "high" if count > 2 else "medium"})
    remaining = activity["hoursRemainingSinceStart"]
    if remaining > 0:
        risks.append({"text": f"{name} has {js_round(remaining)}h of work remaining on items active since the start of the sprint.", "severity": "high" if remaining > 60 else "medium"})
    return risks[:3]


def build_narrative(project, delivery_history, activity, generated_at=None):
    name = project["name"]
    return {"project_id": project["id"],
            "benefit": project.get("roadmap_key_benefit") or project.get("purpose") or f"Supports the {name} workstream.",
            "why": project.get("purpose") or f"{name} exists to move this workstream forward.",
            "problem": project.get("roadmap_status") or "Addressing an active business need.",
            "delivered": f"{project['closed_tickets']} item(s) of work delivered to date." if project["closed_tickets"] > 0 else "No work delivered yet.",
            "this_sprint": f"Active development this sprint ({js_round(activity['hoursLoggedSinceStart'])}h logged since the sprint started)." if activity["hoursLoggedSinceStart"] > 0 else "No active engineering investment this sprint.",
            "next_milestone": f"Targeting go-live: {project['roadmap_go_live']}." if project.get("roadmap_go_live") else "Next milestone not yet scheduled.",
            "delivered_features_this_sprint": activity["deliveredThisSprint"],
            "delivery_history": [{"sprint_name": name, "features": features} for name, features in delivery_history],
            "timeline": build_timeline(project), "exec_risks": build_exec_risks(project, activity),
            "hours_logged_since_sprint_start": js_round(activity["hoursLoggedSinceStart"] * 10) / 10,
            "hours_remaining_since_sprint_start": js_round(activity["hoursRemainingSinceStart"] * 10) / 10,
            "needs_breakdown_count": len(activity["needsBreakdown"]),
            "generated_at": generated_at or datetime.now(timezone.utc)}


def build_org_summary(metrics, projects):
    def display(value):
        return "null" if value is None else number(float(value))
    at_risk = sum(project["health"] != "on_track" for project in projects)
    sentences = [f"Engineering utilised {display(metrics['avg_utilisation'])}% of available capacity this period.",
                 f"{len(projects)} projects are currently active.",
                 f"{at_risk} project(s) require executive attention." if at_risk else "No projects currently require executive attention.",
                 f"{display(metrics['estimate_coverage'])}% of work has a documented estimate."]
    if metrics["total_spillage_hours"] > 0:
        sentences.append(f"{js_round(float(metrics['total_spillage_hours']))}h of committed work is projected to spill into the next sprint.")
    return " ".join(sentences)


def generate_narratives(database, now=None):
    now = now or datetime.now(timezone.utc)
    with database.transaction():
        projects = database.rows("SELECT v.*, p.roadmap_go_live, p.roadmap_status, p.roadmap_key_benefit FROM v_projects_overview v JOIN projects p ON p.id = v.id WHERE v.is_current AND v.project_space != 'infra' AND (v.open_tickets + v.closed_tickets) > 0")
        narratives = []
        for project in projects:
            starts = database.rows("SELECT min(s.start_date) AS sprint_start FROM tickets tk JOIN epics e ON e.id = tk.epic_id JOIN sprints s ON s.id = tk.sprint_id WHERE e.project_id = %s AND s.is_tracked AND s.start_date IS NOT NULL", [project["id"]])
            start = starts[0]["sprint_start"] or now - timedelta(days=14)
            delivery = database.rows("SELECT s.name AS sprint_name, s.end_date, tk.summary FROM tickets tk JOIN epics e ON e.id = tk.epic_id JOIN sprints s ON s.id = tk.sprint_id WHERE e.project_id = %s AND tk.status_category = 'done' AND s.end_date IS NOT NULL AND (tk.original_estimate_seconds IS NULL OR tk.original_estimate_seconds <= %s) ORDER BY s.end_date DESC, tk.resolved_at DESC LIMIT 200", [project["id"], OVERSIZED_SECONDS])
            history = {}
            for row in delivery:
                bucket = history.setdefault(row["sprint_name"], [])
                if len(bucket) < 4:
                    bucket.append(clean_feature_name(row["summary"]))
            activity_rows = database.rows("""
                SELECT tk.id, tk.jira_key, tk.summary, tk.status_category,
                    tk.original_estimate_seconds, tk.remaining_estimate_seconds,
                    coalesce((SELECT sum(w.seconds) FROM worklogs w WHERE w.ticket_id = tk.id AND w.started_at >= %s), 0) AS seconds_logged_since,
                    exists(SELECT 1 FROM worklogs w WHERE w.ticket_id = tk.id AND w.started_at >= %s) AS has_worklog_since,
                    exists(SELECT 1 FROM ticket_comments c WHERE c.ticket_id = tk.id AND c.created_at >= %s) AS has_comment_since
                FROM tickets tk JOIN epics e ON e.id = tk.epic_id WHERE e.project_id = %s
            """, [start, start, start, project["id"]])
            narratives.append(build_narrative(project, list(history.items())[:4], sprint_activity(activity_rows), now))
        json_columns = {"delivery_history", "timeline", "exec_risks"}
        database.upsert("project_narratives", [{key: Json(value) if key in json_columns else value for key, value in row.items()} for row in narratives], conflict_columns=["project_id"])
        metrics = database.rows("SELECT * FROM v_org_metrics")[0]
        names = {project["id"]: project["name"] for project in projects}
        risks = [{"project_name": names[row["project_id"]], "risk_text": risk["text"], "severity": risk["severity"]} for row in narratives for risk in row["exec_risks"]]
        risks.sort(key=lambda row: {"high": 0, "medium": 1, "low": 2}[row["severity"]])
        database.insert_many("org_narrative", [{"executive_summary": build_org_summary(metrics, projects), "top_risks": Json(risks[:5]), "generated_at": now}])
    return {"projects": len(narratives), "organizationRows": 1}
