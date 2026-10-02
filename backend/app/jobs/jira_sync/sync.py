"""Atomic Jira cache ingestion. Scheduled entrypoint is switched after validation."""

from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path

from psycopg2.extras import execute_values

from app.jobs.jira_sync.core import cluster_ticket_titles, js_round, to_date
from app.jobs.jira_sync.fetch import JIRA_PROJECTS
from app.jobs.jira_sync.metrics import compute_metrics


def hash_sprint_id(project_key, name):
    encoded = f"{project_key}:{name}".encode("utf-16-le", errors="surrogatepass")
    value = 0
    for index in range(0, len(encoded), 2):
        value = (value * 31 + int.from_bytes(encoded[index:index + 2], "little")) & 0xffffffff
    if value >= 0x80000000:
        value -= 0x100000000
    return abs(value) % 2147483647


def remap_accounts(issues, history, team_seed, aliases):
    # Inputs are copied: rerunning with the same cached data is deterministic.
    issues, history, team_seed = deepcopy((issues, history, team_seed))
    def person(value):
        if value and value.get("accountId") in aliases:
            value["accountId"] = aliases[value["accountId"]]
    for issue in issues:
        person(issue.get("assignee"))
        person(issue.get("reporter"))
        for row in [*(issue.get("worklogs") or []), *(issue.get("comments") or [])]:
            if row.get("authorAccountId") in aliases:
                row["authorAccountId"] = aliases[row["authorAccountId"]]
    for row in history:
        person(row.get("assignee"))
    for row in team_seed:
        person(row)
    return issues, history, team_seed


def resolve_epic_id(ticket, issue_by_key, epic_ids):
    current = ticket
    for _ in range(4):
        if not current or not current.get("parent"):
            break
        parent = current["parent"]["key"]
        if parent in epic_ids:
            return epic_ids[parent]
        current = issue_by_key.get(parent)
    return None


def summarize_cluster(cluster):
    titles = list(dict.fromkeys(ticket["summary"].strip() for ticket in cluster["tickets"]))
    bullets = [f"• {title}" for title in titles[:3]]
    if len(titles) > 3:
        bullets.append(f"• +{len(titles) - 3} more")
    return "\n".join(bullets)


def lookup(database, table, key):
    # Only module-owned identifiers reach this helper.
    return {row[key]: row["id"] for row in database.rows(f"SELECT id, {key} FROM {table}")}


def write_people(database, rows):
    if not rows:
        return
    columns = list(rows[0])
    with database.cursor() as cursor:
        execute_values(cursor, """
            INSERT INTO people (jira_account_id, name, role, team_id, team_guessed,
                team_guess_reason, active, excluded, updated_at) VALUES %s
            ON CONFLICT (jira_account_id) DO UPDATE SET
                name = excluded.name,
                team_id = CASE WHEN people.team_guessed = false THEN people.team_id ELSE excluded.team_id END,
                team_guessed = CASE WHEN people.team_guessed = false THEN false ELSE excluded.team_guessed END,
                team_guess_reason = CASE WHEN people.team_guessed = false THEN people.team_guess_reason ELSE excluded.team_guess_reason END,
                excluded = CASE WHEN people.excluded = true THEN true ELSE excluded.excluded END,
                updated_at = excluded.updated_at
        """, [tuple(row[column] for column in columns) for row in rows], page_size=500)


def run_sync(database, *, issues, epics, history, team_seed, projects, tracked_sprints,
             sync_type="manual", as_of=None):
    as_of = to_date(as_of or datetime.now(timezone.utc))
    run_id = database.rows("INSERT INTO sync_runs (started_at, status, sync_type, watermark_before) VALUES (now(), 'running', %s, null) RETURNING id", [sync_type])[0]["id"]
    try:
        with database.transaction():
            records = ingest(database, run_id=run_id, issues=issues, epics=epics, history=history,
                             team_seed=team_seed, projects=projects, tracked_sprints=tracked_sprints, as_of=as_of)
            database.execute("UPDATE sync_runs SET finished_at = now(), status = 'success', records_processed = %s, watermark_after = %s WHERE id = %s", [records, as_of, run_id])
        return {"recordsProcessed": records, "syncRunId": str(run_id)}
    except Exception as error:
        # Avoid copying potentially sensitive provider responses into sync logs.
        database.execute("UPDATE sync_runs SET finished_at = now(), status = 'failed', error_message = %s WHERE id = %s", [f"Python sync failed ({type(error).__name__})", run_id])
        raise


def ingest(db, *, run_id, issues, epics, history, team_seed, projects, tracked_sprints, as_of):
    now = datetime.now(timezone.utc)
    aliases = {row["alias_jira_account_id"]: row["canonical_jira_account_id"] for row in db.rows("SELECT alias_jira_account_id, canonical_jira_account_id FROM person_account_aliases")}
    issues, history, team_seed = remap_accounts(issues, history, team_seed, aliases)
    db.upsert("jira_projects", [{"jira_key": row["key"], "name": row["name"]} for row in JIRA_PROJECTS], conflict_columns=["jira_key"])
    jira_ids = lookup(db, "jira_projects", "jira_key")
    db.upsert("teams", [{"name": name} for name in dict.fromkeys(row.get("team") for row in team_seed)], conflict_columns=["name"])
    team_ids = lookup(db, "teams", "name")
    people = {}
    for issue in issues:
        candidates = [issue.get("assignee"), issue.get("reporter"), issue.get("qaAssignee")]
        candidates.extend({"accountId": row.get("authorAccountId"), "name": row.get("authorName")} for row in [*(issue.get("worklogs") or []), *(issue.get("comments") or [])])
        for person in candidates:
            if person and person.get("accountId"):
                people[person["accountId"]] = person.get("name")
    for row in history:
        if row.get("assignee"):
            people[row["assignee"]["accountId"]] = row["assignee"].get("name")
    seed_by_account = {row["accountId"]: row for row in team_seed}
    people_rows = []
    for account_id, name in people.items():
        seed = seed_by_account.get(account_id)
        people_rows.append({"jira_account_id": account_id, "name": name, "role": None,
                            "team_id": team_ids.get(seed.get("team")) if seed else None,
                            "team_guessed": seed["guessed"] if seed else True,
                            "team_guess_reason": seed.get("guessReason") if seed else "No sprint ticket data for this person in the current tracked window",
                            "active": True, "excluded": False, "updated_at": now})
    write_people(db, people_rows)
    person_ids = lookup(db, "people", "jira_account_id")
    records = len(people_rows)
    sprint_rows = [{"jira_sprint_id": hash_sprint_id(row["jiraProjectKey"], row["name"]),
                    "jira_project_id": jira_ids[row["jiraProjectKey"]], "name": row["name"], "state": row["state"],
                    "start_date": row["startDate"], "end_date": row["endDate"], "complete_date": None,
                    "goal": row.get("goal"), "is_tracked": True, "updated_at": now} for row in tracked_sprints]
    if sprint_rows:
        db.execute("UPDATE sprints SET is_tracked = false WHERE is_tracked AND jira_project_id = ANY(%s::uuid[])", [[str(row["jira_project_id"]) for row in sprint_rows]])
    db.upsert("sprints", sprint_rows, conflict_columns=["jira_sprint_id"], update_columns=["name", "state", "start_date", "end_date", "goal", "is_tracked", "updated_at"])
    sprint_ids = {row["jira_key"]: row["id"] for row in db.rows("SELECT s.id, jp.jira_key FROM sprints s JOIN jira_projects jp ON jp.id = s.jira_project_id WHERE s.is_tracked")}
    project_rows = [{"slug": row["id"], "name": row["name"], "color": None, "purpose": None,
                     "sprint_goal": None, "health": "on_track", "progress": None, "owner_person_id": None,
                     "is_current": row["current"], "source": "epic_cluster", "roadmap_go_live": None,
                     "roadmap_status": None, "roadmap_tech_stack": None, "roadmap_key_benefit": None,
                     "updated_at": now} for row in projects]
    db.upsert("projects", project_rows, conflict_columns=["slug"], update_columns=["name", "is_current", "updated_at"])
    project_ids = lookup(db, "projects", "slug")
    records += len(project_rows)
    db.execute("DELETE FROM project_jira_projects")
    for project in projects:
        for key in project["jiraProjects"]:
            db.execute("INSERT INTO project_jira_projects (project_id, jira_project_id) VALUES (%s, %s) ON CONFLICT DO NOTHING", [project_ids[project["id"]], jira_ids[key]])
    epic_slugs = {epic["key"]: project["id"] for project in projects for epic in project["epics"]}
    for row in db.rows("SELECT epic_jira_key, forced_project_slug FROM project_overrides"):
        if row["forced_project_slug"] in project_ids:
            epic_slugs[row["epic_jira_key"]] = row["forced_project_slug"]
    epic_rows = [{"jira_key": row["key"], "jira_project_id": jira_ids[row["project"]],
                  "project_id": project_ids.get(epic_slugs.get(row["key"])), "summary": row["summary"],
                  "status": row["status"], "status_category": row["statusCategory"],
                  "resolved_at": row.get("resolutiondate"), "created_at": row["created"], "updated_at": row["updated"]} for row in epics]
    db.upsert("epics", epic_rows, conflict_columns=["jira_key"], update_columns=["project_id", "status", "status_category", "resolved_at", "updated_at"])
    epic_ids = lookup(db, "epics", "jira_key")
    records += len(epic_rows)
    keys_by_project = {}
    for ticket in issues:
        keys_by_project.setdefault(ticket["project"], set()).add(ticket["key"])
    for key, sprint_id in sprint_ids.items():
        removed = [row["jira_key"] for row in db.rows("SELECT jira_key FROM tickets WHERE sprint_id = %s", [sprint_id]) if row["jira_key"] not in keys_by_project.get(key, set())]
        if removed:
            db.execute("UPDATE tickets SET sprint_id = null WHERE jira_key = ANY(%s)", [removed])
    issue_by_key = {row["key"]: row for row in issues}
    def assigned(ticket, field):
        return person_ids.get((ticket.get(field) or {}).get("accountId"))
    tickets = []
    for ticket in issues:
        qa_hours = ticket.get("qaPlannedHours")
        tickets.append({"jira_key": ticket["key"], "jira_project_id": jira_ids[ticket["project"]],
                        "epic_id": resolve_epic_id(ticket, issue_by_key, epic_ids), "sprint_id": sprint_ids.get(ticket["project"]),
                        "summary": ticket["summary"], "issue_type": ticket["issuetype"], "status": ticket["status"],
                        "status_category": ticket["statusCategory"], "priority": ticket["priority"].lower() if ticket.get("priority") else None,
                        "assignee_person_id": assigned(ticket, "assignee"), "reporter_person_id": assigned(ticket, "reporter"),
                        "qa_assignee_person_id": assigned(ticket, "qaAssignee"),
                        "qa_planned_seconds": js_round(qa_hours * 3600) if isinstance(qa_hours, (int, float)) and not isinstance(qa_hours, bool) else None,
                        "original_estimate_seconds": ticket.get("estimateSeconds"), "remaining_estimate_seconds": ticket.get("remainingSeconds"),
                        "time_spent_seconds": ticket.get("spentSeconds") or 0, "labels": ticket.get("labels") or [],
                        "created_at": ticket["created"], "updated_at": ticket["updated"], "resolved_at": ticket.get("resolutiondate"),
                        "is_blocked": "block" in ticket["status"].lower(), "last_synced_at": now})
    db.upsert("tickets", tickets, conflict_columns=["jira_key"], update_columns=[key for key in tickets[0] if key not in {"jira_key", "jira_project_id", "issue_type", "created_at"}] if tickets else [])
    ticket_ids = lookup(db, "tickets", "jira_key")
    worklogs, comments = [], []
    for ticket in issues:
        for row in ticket.get("worklogs") or []:
            worklogs.append({"jira_worklog_id": row["id"], "ticket_id": ticket_ids[ticket["key"]], "author_person_id": person_ids.get(row["authorAccountId"]), "started_at": row["started"], "logged_at": row["created"], "seconds": row["seconds"]})
        for row in ticket.get("comments") or []:
            comments.append({"jira_comment_id": str(row.get("authorAccountId")) + "-" + row["created"], "ticket_id": ticket_ids[ticket["key"]], "author_person_id": person_ids.get(row.get("authorAccountId")), "created_at": row["created"], "body_excerpt": row.get("body")})
    db.upsert("worklogs", worklogs, conflict_columns=["jira_worklog_id"], update_columns=["started_at", "logged_at", "seconds"])
    db.upsert("ticket_comments", comments, conflict_columns=["jira_comment_id"], update_columns=["body_excerpt"])
    records += len(tickets) + len(worklogs) + len(comments)
    metrics = compute_metrics(as_of=as_of, tracked_sprints=tracked_sprints, issues=issues, epic_to_project_id={key: project_ids.get(slug) for key, slug in epic_slugs.items()}, team_seed=team_seed, adjustments={})
    metric_fields = "bandwidthHours utilisationPct pacePct paceTargetHours hoursLogged estimatedHours sprintTargetHours velocity estimateAccuracy estimateCoverage closedWithoutLogging worklogCount commentCount idleWorkdays darkWipCount avgLogLagDays health riskFlags targetHoursIsFallback overallocationReason".split()
    import re
    def snake(value):
        return re.sub(r"[A-Z]", lambda match: "_" + match[0].lower(), value)
    metric_rows = [{"person_id": person_ids[row["accountId"]], **{snake(key): row.get(key) for key in metric_fields}, "computed_at": now} for row in metrics["personMetrics"] if row["accountId"] in person_ids]
    db.upsert("person_metrics", metric_rows, conflict_columns=["person_id"])
    db.insert_many("person_metrics_history", [{**row, "sync_run_id": run_id} for row in metric_rows])
    records += len(metric_rows)
    risks = metrics["risks"]
    for sprint in tracked_sprints:
        overdue = js_round((as_of - to_date(sprint["endDate"])).total_seconds() / 86400)
        if overdue > 0:
            risks.append({"category": "sprint_overrun", "severity": "high" if overdue > 7 else "medium", "title": f"{sprint['name']} ({sprint['jiraProjectKey']}) is {overdue} day(s) past its planned end date and still open", "recommendation": "Close out or re-scope this sprint before planning the next one — utilisation and pace figures for this team are measured against the original window and will read as overrun until it's closed.", "identifiedAt": as_of})
    db.replace_computed("risks", [{"category": row["category"], "severity": row["severity"], "title": row["title"], "recommendation": row["recommendation"], "person_id": person_ids.get(row.get("accountId")), "project_id": project_ids.get(row.get("projectSlug")), "ticket_id": None, "identified_at": row["identifiedAt"], "status": "open", "computed_at": now} for row in risks], scope_column="status", scope_value="open")
    db.execute("DELETE FROM standouts")
    db.insert_many("standouts", [{"title": row["title"], "person_id": person_ids[row["accountId"]], "detail": row.get("detail"), "rank": row["rank"], "computed_at": now} for row in metrics["standouts"] if row["accountId"] in person_ids])
    board = metrics["orgBoardHealth"]
    db.insert_many("board_health", [{"scope_type": "org", "scope_id": None, **{snake(key): value for key, value in board.items()}}])
    rebuild_projects(db, issues, history, tracked_sprints, epic_slugs, project_ids, person_ids, ticket_ids, now)
    return records


def rebuild_projects(db, issues, history, sprints, epic_slugs, project_ids, person_ids, ticket_ids, now):
    db.execute("DELETE FROM project_contributors")
    db.execute("DELETE FROM project_updates")
    for slug, project_id in project_ids.items():
        tickets = [row for row in issues if epic_slugs.get((row.get("parent") or {}).get("key")) == slug]
        hours, by_epic = {}, {}
        for ticket in tickets:
            if ticket.get("assignee"):
                account = ticket["assignee"]["accountId"]
                hours[account] = hours.get(account, 0) + (ticket.get("spentSeconds") or 0) / 3600
            by_epic.setdefault(ticket["parent"]["key"], []).append(ticket)
        total = sum(hours.values()) or 1
        db.insert_many("project_contributors", [{"project_id": project_id, "person_id": person_ids[account], "pct": js_round(100 * value / total), "hours": js_round(value * 10) / 10, "computed_at": now} for account, value in hours.items() if account in person_ids])
        for epic_key, members in by_epic.items():
            update_id = db.rows("INSERT INTO project_updates (project_id, name, summary, progress) VALUES (%s,%s,%s,%s) RETURNING id", [project_id, members[0]["parent"].get("summary"), f"{len(members)} ticket(s) in {epic_key} this sprint", js_round(100 * sum(row["statusCategory"] == "done" for row in members) / len(members))])[0]["id"]
            for ticket in members:
                if ticket["key"] in ticket_ids:
                    db.execute("INSERT INTO project_update_tickets (project_update_id, ticket_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", [update_id, ticket_ids[ticket["key"]]])
    db.upsert("resolved_ticket_history", [{"jira_key": row["key"], "summary": row["summary"], "issuetype": row["issuetype"], "resolution_date": row.get("resolutiondate"), "spent_seconds": row.get("spentSeconds") or 0, "parent_epic_key": row["parent"]["key"], "assignee_person_id": person_ids.get((row.get("assignee") or {}).get("accountId")), "updated_at": now} for row in history if row.get("parent")], conflict_columns=["jira_key"])
    starts = {row["jiraProjectKey"]: row["startDate"] for row in sprints}
    by_project = {}
    for row in db.rows('SELECT jira_key AS key, summary, resolution_date AS resolutiondate, spent_seconds AS "spentSeconds", parent_epic_key FROM resolved_ticket_history'):
        start = starts.get(row["key"].split("-")[0])
        if start and row["resolutiondate"] and to_date(row["resolutiondate"]) < to_date(start):
            continue
        slug = epic_slugs.get(row["parent_epic_key"])
        if slug:
            by_project.setdefault(slug, []).append(row)
    db.execute("DELETE FROM project_features")
    for slug, tickets in by_project.items():
        clusters = cluster_ticket_titles([{"summary": row["summary"], "epicKey": row["parent_epic_key"], "key": row["key"]} for row in tickets])
        full = {row["key"]: row for row in tickets}
        for cluster in clusters:
            hours = sum((full[row["key"]]["spentSeconds"] or 0) / 3600 for row in cluster["tickets"])
            dates = [full[row["key"]]["resolutiondate"] for row in cluster["tickets"] if full[row["key"]]["resolutiondate"]]
            feature_id = db.rows("INSERT INTO project_features (project_id, name, description, completion_sprint, completion_date, hours) VALUES (%s,%s,%s,null,%s,%s) RETURNING id", [project_ids[slug], cluster["name"], summarize_cluster(cluster), max(dates) if dates else None, js_round(hours * 10) / 10])[0]["id"]
            for ticket in cluster["tickets"]:
                if ticket["key"] in ticket_ids:
                    db.execute("INSERT INTO project_feature_tickets (project_feature_id, ticket_id) VALUES (%s,%s) ON CONFLICT DO NOTHING", [feature_id, ticket_ids[ticket["key"]]])


def run_cached(database, cache_dir, generated_dir, **options):
    cache_dir, generated_dir = Path(cache_dir), Path(generated_dir)
    def jsonl(name):
        path = cache_dir / name
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()] if path.exists() else []
    return run_sync(database, issues=jsonl("issues.raw.jsonl"), epics=jsonl("epics.raw.jsonl"), history=jsonl("history.raw.jsonl"), team_seed=json.loads((generated_dir / "teams.seed.json").read_text())["people"], projects=json.loads((generated_dir / "projects.json").read_text())["projects"], tracked_sprints=json.loads((cache_dir / "tracked-sprints.json").read_text()), **options)
