"""Conservative maintenance gates preserved from the existing sync jobs."""

GRACE_DAYS = 2


def flag_inactive_people(database):
    with database.transaction():
        candidates = database.rows("""
            SELECT p.id, p.name FROM people p
            WHERE p.active AND NOT p.excluded AND p.team_guessed = true
              AND NOT EXISTS (SELECT 1 FROM tickets tk WHERE tk.assignee_person_id = p.id)
              AND EXISTS (SELECT 1 FROM person_sprint_summaries pss WHERE pss.person_id = p.id)
              AND NOT EXISTS (SELECT 1 FROM person_sprint_summaries pss
                  WHERE pss.person_id = p.id AND (pss.allocated_hours > 0 OR pss.logged_hours > 0))
        """)
        if candidates:
            database.execute("UPDATE people SET excluded = true WHERE id = ANY(%s::uuid[]) AND team_guessed = true", [[row["id"] for row in candidates]])
    return {"flagged": [row["name"] for row in candidates]}


def purge_closed_sprint_tickets(database):
    with database.transaction():
        eligible = database.rows("""
            SELECT DISTINCT s.id, s.name, s.start_date, s.end_date FROM sprints s
            WHERE s.end_date < now() - make_interval(days => %s)
              AND s.is_tracked = false
              AND EXISTS (SELECT 1 FROM person_sprint_summaries pss WHERE pss.sprint_start = s.start_date)
              AND EXISTS (SELECT 1 FROM project_sprint_summaries pjs WHERE pjs.sprint_start = s.start_date)
              AND EXISTS (SELECT 1 FROM tickets tk WHERE tk.sprint_id = s.id)
        """, [GRACE_DAYS])
        deleted = sum(database.execute("DELETE FROM tickets WHERE sprint_id = %s", [sprint["id"]]) for sprint in eligible)
        deleted += database.execute("DELETE FROM tickets WHERE sprint_id IS NULL AND last_synced_at < now() - make_interval(days => %s)", [GRACE_DAYS])
    return {"sprintsPurged": len(eligible), "ticketsDeleted": deleted}


def purge_old_planning_availability(database):
    with database.transaction():
        count = database.execute("""
            DELETE FROM planning_availability pa
            WHERE pa.to_date < now() - make_interval(days => %s)
              AND NOT EXISTS (
                SELECT 1 FROM sprints s WHERE s.is_tracked
                  AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL
                  AND s.start_date::date <= pa.to_date AND s.end_date::date >= pa.from_date
              )
              AND NOT EXISTS (
                SELECT 1 FROM sprints s WHERE NOT s.is_tracked AND s.end_date < now()
                  AND s.start_date::date <= pa.to_date AND s.end_date::date >= pa.from_date
                  AND NOT EXISTS (SELECT 1 FROM person_sprint_summaries pss WHERE pss.sprint_start = s.start_date)
              )
        """, [GRACE_DAYS])
    return {"entriesDeleted": count}


def smoke_test(database):
    problems = []
    fresh = database.rows("SELECT count(*)::int AS count FROM tickets WHERE last_synced_at >= now() - make_interval(mins => %s)", [30])[0]["count"]
    if fresh == 0:
        problems.append("no ticket has last_synced_at within the last 30 minutes -- the sync ran but wrote nothing")
    if database.rows("SELECT count(*)::int AS count FROM tickets")[0]["count"] == 0:
        problems.append("tickets table is empty")
    runs = database.rows("SELECT status FROM sync_runs ORDER BY started_at DESC LIMIT 1")
    status = runs[0]["status"] if runs else "none"
    if status != "success":
        problems.append(f'most recent sync_runs row has status "{status}", not "success"')
    return {"ok": not problems, "problems": problems}
