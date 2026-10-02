"""Closed-sprint scores, including leave, QA effort and Jira hygiene."""

from datetime import timedelta
import re

from app.jobs.jira_sync.core import js_round, to_date, workdays_between

OVERSIZED_SECONDS = 35 * 3600
STOPWORDS = set("the a an and or to of in on for is are this that with has have been be it as by at from was were will your you please github url pr link com https http".split())


def build_leave_by_person_day(rows):
    result = {}
    for row in rows:
        current = to_date(row["from_date"]).date()
        end = to_date(row["to_date"]).date()
        if end < current:
            continue
        days = result.setdefault(row["person_id"], {})
        while current <= end:
            days[current] = days.get(current, 0) + float(row["hours"])
            current += timedelta(days=1)
    return result


def expected_hours(sprint_start, sprint_end, leave_days=None):
    current, end = to_date(sprint_start).date(), to_date(sprint_end).date()
    hours = 0
    while current <= end:
        if current.weekday() < 5:
            hours += max(7 - (leave_days or {}).get(current, 0), 0)
        current += timedelta(days=1)
    return hours


def flagged_comments(person_id, comments, ticket_meta):
    seen, flagged = {}, []
    def keywords(text):
        return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 2 and word not in STOPWORDS}
    for comment in comments:
        if comment["author_person_id"] != person_id or comment["ticket_id"] not in ticket_meta:
            continue
        meta = ticket_meta[comment["ticket_id"]]
        text = comment.get("body_excerpt") or ""
        normalized = text.strip().lower()
        reason = None
        if not normalized:
            reason = "empty comment"
        elif len(re.sub(r"@\S+", "", text).strip().split()) < 4:
            reason = "near-empty comment"
        elif re.search(r"\[add your .*here\]|\btbd\b|\blorem ipsum\b|\btodo\b", text, re.I):
            reason = "unfilled placeholder text left in"
        elif len(normalized) > 20:
            previous = seen.get(normalized)
            if previous and previous != meta["jiraKey"]:
                reason = f"identical to their own comment on {previous} (likely copy-pasted)"
            else:
                seen[normalized] = meta["jiraKey"]
        if not reason and len(text.split()) >= 8:
            comment_words, summary_words = keywords(text), keywords(meta.get("summary") or "")
            if comment_words and summary_words and not comment_words.intersection(summary_words):
                reason = "shares no keywords with this ticket's summary (possibly off-topic)"
        if reason:
            # JavaScript slice limits UTF-16 code units rather than code points.
            excerpt = text.encode("utf-16-le", errors="surrogatepass")[:320].decode("utf-16-le", errors="surrogatepass")
            flagged.append({"ticketKey": meta["jiraKey"], "reason": reason, "excerpt": excerpt})
    return flagged[:10]


def compute_for_person(*, person_id, tickets, worklogs, all_worklogs_for_tickets,
                       comments, comments_in_window, ticket_meta_by_id,
                       sprint_start, sprint_end, name_by_sprint_id, leave_by_person_day):
    start, end = to_date(sprint_start), to_date(sprint_end)
    owned = [ticket for ticket in tickets if ticket.get("assignee_person_id") == person_id]
    sized = [ticket for ticket in owned if (ticket.get("original_estimate_seconds") or 0) <= OVERSIZED_SECONDS and not ticket.get("is_blocked")]
    sized_ids = {ticket["id"] for ticket in sized}
    all_logged, window_logged = {}, {}
    for row in all_worklogs_for_tickets:
        all_logged[row["ticket_id"]] = all_logged.get(row["ticket_id"], 0) + row["seconds"]
    for row in worklogs:
        window_logged[row["ticket_id"]] = window_logged.get(row["ticket_id"], 0) + row["seconds"]
    allocated = sum((ticket.get("original_estimate_seconds") or 0) if ticket["status_category"] == "done" else max((ticket.get("original_estimate_seconds") or 0) - max(all_logged.get(ticket["id"], 0) - window_logged.get(ticket["id"], 0), 0), 0) for ticket in sized) / 3600
    own_logs = [row for row in worklogs if row.get("author_person_id") == person_id and start <= to_date(row["started_at"]) <= end]
    logged = sum(row["seconds"] for row in own_logs if row["ticket_id"] in sized_ids) / 3600
    qa_owned = [ticket for ticket in tickets if ticket.get("qa_assignee_person_id") == person_id and not ticket.get("is_blocked")]
    qa_ids = {ticket["id"] for ticket in qa_owned}
    qa_allocated = sum(ticket.get("qa_planned_seconds") or 0 for ticket in qa_owned) / 3600
    qa_logged = sum(row["seconds"] for row in own_logs if row["ticket_id"] in qa_ids) / 3600
    pace = min(100, js_round(logged / max(expected_hours(start, end, leave_by_person_day.get(person_id)), 1) * 100))
    logged_ever = {row["ticket_id"] for row in all_worklogs_for_tickets}
    commented_ever = {row["ticket_id"] for row in comments}
    def clean(ticket):
        todo = ticket["status_category"] == "new" and not ticket.get("is_blocked")
        return (ticket.get("original_estimate_seconds") is not None and
                (ticket.get("original_estimate_seconds") or 0) <= OVERSIZED_SECONDS and
                ticket.get("epic_id") is not None and
                (todo or ticket["id"] in commented_ever) and
                (todo or ticket.get("is_blocked") or ticket["id"] in logged_ever))
    hygiene = js_round(100 * sum(clean(ticket) for ticket in owned) / len(owned)) if owned else None
    wip = [ticket for ticket in owned if ticket["status_category"] == "indeterminate"]
    personally_logged = {row["ticket_id"] for row in own_logs}
    logging = js_round(100 * sum(ticket["id"] in personally_logged for ticket in wip) / len(wip)) if wip else None
    matched, total = 0, 0
    for ticket in owned:
        estimate, spent = ticket.get("original_estimate_seconds") or 0, ticket.get("time_spent_seconds") or 0
        if ticket["status_category"] != "done" or not ticket.get("resolved_at") or not start <= to_date(ticket["resolved_at"]) <= end:
            continue
        if estimate <= 0 or estimate > OVERSIZED_SECONDS or spent <= 0:
            continue
        matched += min(estimate, spent)
        total += max(estimate, spent)
    accuracy = js_round(100 * matched / total) if total else None
    terms = [value for value in [pace, accuracy, hygiene, logging] if value is not None]
    overall = js_round(sum(terms) / len(terms))
    qualifies, tag = False, None
    if not owned and not qa_owned:
        tag = "Nothing assigned this sprint"
    else:
        logged_in_window = {row["ticket_id"] for row in worklogs}
        pending = [ticket for ticket in wip if ticket["id"] not in logged_in_window and ticket["id"] not in commented_ever]
        if pending:
            days = max(workdays_between(ticket["updated_at"], end) for ticket in pending)
            tag = f"Pending updates on {len(pending)} ticket{'' if len(pending) == 1 else 's'} ({days} working day{'' if days == 1 else 's'} since last touched)"
        else:
            activity = [to_date(row["started_at"]) for row in worklogs if row.get("author_person_id") == person_id]
            activity.extend(to_date(row["created_at"]) for row in comments if row.get("author_person_id") == person_id)
            idle = workdays_between(max(activity), end) if activity else None
            if idle is None:
                tag = "No Jira updates"
            elif idle > 1:
                tag = f"No Jira updates in {idle} working days"
            else:
                qualifies = True
    overrun = []
    for ticket in owned:
        estimate, spent = ticket.get("original_estimate_seconds") or 0, ticket.get("time_spent_seconds") or 0
        if estimate > 0 and spent > estimate:
            overrun.append({"ticketKey": ticket["jira_key"], "summary": ticket["summary"], "estimateHours": js_round(estimate / 3600 * 10) / 10, "spentHours": js_round(spent / 3600 * 10) / 10, "overrunHours": js_round((spent - estimate) / 3600 * 10) / 10})
    return {"paceScore": pace, "estimateScore": accuracy, "hygieneScore": hygiene, "loggingScore": logging,
            "overallScore": overall if qualifies else js_round(overall * 0.5),
            "allocatedHours": js_round(allocated * 10) / 10, "loggedHours": js_round(logged * 10) / 10,
            "qaAllocatedHours": js_round(qa_allocated * 10) / 10, "qaLoggedHours": js_round(qa_logged * 10) / 10,
            "jiraQualifies": qualifies, "jiraStatusTag": tag,
            "sprintName": name_by_sprint_id.get(owned[0].get("sprint_id")) if owned else None,
            "overrunTickets": overrun, "flaggedComments": flagged_comments(person_id, comments_in_window, ticket_meta_by_id)}


def compute_for_project(*, tickets, sprint_start, sprint_end):
    start, end = to_date(sprint_start), to_date(sprint_end)
    sized = [ticket for ticket in tickets if (ticket.get("original_estimate_seconds") or 0) <= OVERSIZED_SECONDS]
    return {"ticketsTotal": len(tickets),
            "ticketsCompleted": sum(ticket["status_category"] == "done" and bool(ticket.get("resolved_at")) and start <= to_date(ticket["resolved_at"]) <= end for ticket in tickets),
            "hoursEstimated": js_round(sum(ticket.get("original_estimate_seconds") or 0 for ticket in sized) / 3600 * 10) / 10,
            "hoursLogged": js_round(sum(ticket.get("time_spent_seconds") or 0 for ticket in sized) / 3600 * 10) / 10,
            "spilloverTickets": sum(bool(ticket.get("created_at")) and to_date(ticket["created_at"]) < start for ticket in tickets)}


def snapshot_closed_sprints(database):
    # Snapshot both sides atomically before any ticket/leave cleanup can run.
    with database.transaction():
        closed = database.rows("""
            SELECT s.start_date, max(s.end_date) AS end_date FROM sprints s
            WHERE s.end_date < now() GROUP BY s.start_date
            HAVING NOT EXISTS (SELECT 1 FROM person_sprint_summaries p WHERE p.sprint_start = s.start_date)
                OR NOT EXISTS (SELECT 1 FROM project_sprint_summaries p WHERE p.sprint_start = s.start_date)
            ORDER BY s.start_date
        """)
        people = database.rows("SELECT id FROM people WHERE active AND NOT excluded") if closed else []
        person_count, project_count = 0, 0
        def snake(value):
            return re.sub(r"[A-Z]", lambda match: "_" + match[0].lower(), value)
        for sprint in closed:
            start, end = sprint["start_date"], sprint["end_date"]
            tickets = database.rows("SELECT * FROM tickets WHERE sprint_id IN (SELECT id FROM sprints WHERE start_date = %s)", [start])
            names = {row["id"]: row["name"] for row in database.rows("SELECT id, name FROM sprints WHERE start_date = %s", [start])}
            worklogs = database.rows("SELECT ticket_id, author_person_id, started_at, seconds FROM worklogs WHERE started_at >= %s AND started_at <= %s", [start, end])
            all_logs = database.rows("SELECT w.ticket_id, w.seconds FROM worklogs w JOIN tickets tk ON tk.id = w.ticket_id WHERE tk.sprint_id IN (SELECT id FROM sprints WHERE start_date = %s)", [start])
            comments = database.rows("SELECT ticket_id, author_person_id, created_at FROM ticket_comments")
            window_comments = database.rows("SELECT tc.ticket_id, tc.author_person_id, tc.created_at, tc.body_excerpt FROM ticket_comments tc JOIN tickets tk ON tk.id = tc.ticket_id WHERE tk.sprint_id IN (SELECT id FROM sprints WHERE start_date = %s) AND tc.created_at >= %s AND tc.created_at <= %s", [start, start, end])
            leave = build_leave_by_person_day(database.rows("SELECT person_id, from_date, to_date, hours FROM planning_availability WHERE to_date >= %s::date AND from_date <= %s::date", [start, end]))
            meta = {ticket["id"]: {"jiraKey": ticket["jira_key"], "summary": ticket["summary"]} for ticket in tickets}
            for person in people:
                scores = compute_for_person(person_id=person["id"], tickets=tickets, worklogs=worklogs, all_worklogs_for_tickets=all_logs, comments=comments, comments_in_window=window_comments, ticket_meta_by_id=meta, sprint_start=start, sprint_end=end, name_by_sprint_id=names, leave_by_person_day=leave)
                if scores["jiraStatusTag"] == "Nothing assigned this sprint":
                    continue
                # JSON arrays are explicit Json values, rather than PG arrays.
                from psycopg2.extras import Json
                row = {"person_id": person["id"], "sprint_start": start, "sprint_end": end, **{snake(key): Json(value) if key in {"overrunTickets", "flaggedComments"} else value for key, value in scores.items()}}
                database.insert_many("person_sprint_summaries", [row], conflict_columns=["person_id", "sprint_start"], update_columns=[])
                person_count += 1
            epic_projects = {row["id"]: row["project_id"] for row in database.rows("SELECT id, project_id FROM epics WHERE project_id IS NOT NULL")}
            by_project = {}
            for ticket in tickets:
                project_id = epic_projects.get(ticket.get("epic_id"))
                if project_id:
                    by_project.setdefault(project_id, []).append(ticket)
            for project_id, members in by_project.items():
                scores = compute_for_project(tickets=members, sprint_start=start, sprint_end=end)
                row = {"project_id": project_id, "sprint_start": start, "sprint_end": end, **{snake(key): value for key, value in scores.items()}}
                database.insert_many("project_sprint_summaries", [row], conflict_columns=["project_id", "sprint_start"], update_columns=[])
                project_count += 1
        return {"sprintsSnapshotted": len(closed), "rowsInserted": person_count, "projectRowsInserted": project_count}


def backfill_pace_scores(database):
    with database.transaction():
        rows = database.rows("SELECT person_id, sprint_start, sprint_end, pace_score, estimate_score, hygiene_score, logging_score, overall_score, logged_hours, jira_qualifies FROM person_sprint_summaries")
        leave = build_leave_by_person_day(database.rows("SELECT person_id, from_date, to_date, hours FROM planning_availability"))
        updated = 0
        for row in rows:
            pace = min(100, js_round(float(row["logged_hours"]) / max(expected_hours(row["sprint_start"], row["sprint_end"], leave.get(row["person_id"])), 1) * 100))
            terms = [pace, *(row[key] for key in ["estimate_score", "hygiene_score", "logging_score"] if row[key] is not None)]
            overall = js_round(sum(terms) / len(terms))
            if not row["jira_qualifies"]:
                overall = js_round(overall * 0.5)
            if pace != row["pace_score"] or overall != row["overall_score"]:
                database.execute("UPDATE person_sprint_summaries SET pace_score = %s, overall_score = %s WHERE person_id = %s AND sprint_start = %s", [pace, overall, row["person_id"], row["sprint_start"]])
                updated += 1
    return {"total": len(rows), "updated": updated, "alreadyCorrect": len(rows) - updated}
