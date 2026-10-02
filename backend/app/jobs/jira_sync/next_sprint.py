"""Future-sprint planning stays separate from active-sprint scoring."""

from app.jobs.jira_sync.core import to_date
from app.jobs.jira_sync.fetch import JIRA_PROJECTS, quoted


def build_next_sprint_rows(issues, projects, person_id_by_account, sprint_field="customfield_10020"):
    name_by_key = {project["key"]: project["name"] for project in projects}
    grouped = {}
    for issue in issues:
        key = ((issue.get("fields") or {}).get("project") or {}).get("key")
        if key in name_by_key:
            grouped.setdefault(key, []).append(issue)
    rows = []
    for project_key, project_issues in grouped.items():
        def future_sprints(issue):
            return [sprint for sprint in (issue.get("fields") or {}).get(sprint_field) or [] if sprint and sprint.get("state") == "future"]

        candidates = {sprint["id"]: sprint for issue in project_issues for sprint in future_sprints(issue)}
        if not candidates:
            continue
        selected = min(candidates.values(), key=lambda sprint: (to_date(sprint["startDate"]).timestamp() if sprint.get("startDate") else float("inf"), sprint["id"]))
        for issue in project_issues:
            if not any(sprint["id"] == selected["id"] for sprint in future_sprints(issue)):
                continue
            fields = issue["fields"]
            assignee = fields.get("assignee") or {}
            rows.append({
                "jira_key": issue["key"], "jira_project_key": project_key, "board_name": name_by_key[project_key],
                "jira_sprint_id": selected["id"], "sprint_name": selected["name"],
                "sprint_start_date": selected.get("startDate"), "sprint_end_date": selected.get("endDate"),
                "sprint_goal": selected.get("goal") or None, "summary": fields.get("summary") or "",
                "issue_type": (fields.get("issuetype") or {}).get("name"), "status": (fields.get("status") or {}).get("name") or "Unknown",
                "priority": (fields.get("priority") or {}).get("name"),
                "assignee_person_id": person_id_by_account.get(assignee.get("accountId")),
                "assignee_name": assignee.get("displayName"), "original_estimate_seconds": fields.get("timeoriginalestimate"),
            })
    return rows


async def sync_next_sprint(database, fetcher):
    project_clause = ", ".join(quoted(project["name"]) for project in JIRA_PROJECTS)
    field = fetcher.settings.jira_sprint_field
    issues = await fetcher.search(
        f"project in ({project_clause}) AND Sprint in futureSprints() AND issuetype != Epic AND statusCategory != Done",
        ["summary", "status", "issuetype", "priority", "assignee", "timeoriginalestimate", "project", field],
    )
    # A Jira outage above cannot erase the last successful planning refresh.
    people = database.rows("SELECT id, jira_account_id FROM people")
    aliases = database.rows("SELECT alias_jira_account_id, canonical_jira_account_id FROM person_account_aliases")
    ids = {person["jira_account_id"]: person["id"] for person in people}
    for alias in aliases:
        canonical = ids.get(alias["canonical_jira_account_id"])
        if canonical:
            ids[alias["alias_jira_account_id"]] = canonical
    rows = build_next_sprint_rows(issues, JIRA_PROJECTS, ids, field)
    with database.transaction():
        database.execute("DELETE FROM next_sprint_tickets")
        database.insert_many("next_sprint_tickets", rows)
    return {"tickets": len(rows), "sprints": len({row["jira_sprint_id"] for row in rows})}
