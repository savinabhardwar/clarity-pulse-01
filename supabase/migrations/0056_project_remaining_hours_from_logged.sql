-- v_projects_overview.remaining_estimate_hours (shown on the Projects page
-- as "Planned this sprint") and spillage_hours's per-ticket remaining both
-- summed tk.remaining_estimate_seconds directly -- the same Jira field
-- computeSprintHours (emp-engine.ts) deliberately avoids at the person
-- level, because it only reflects reality if the assignee keeps it
-- up to date as they work. Switch both to the same GREATEST(original -
-- time_spent, 0) computation computeSprintHours already uses, so a
-- project's "planned" number can't drift from an assignee's stale
-- remaining-estimate field the way a person's already can't.
--
-- remaining_estimate_hours was also missing the is_tracked sprint scope
-- entirely -- it summed every open ticket under the project's epics,
-- backlog included, while hours_this_sprint/spillage_hours right next to
-- it already scope to the tracked sprint. Add the same scope here so
-- "Planned this sprint" can't include work that isn't in this sprint.
create or replace view v_projects_overview as
 SELECT proj.id,
    proj.slug,
    proj.name,
    proj.color,
    proj.purpose,
    proj.health,
    proj.progress,
    proj.sprint_goal,
    owner.name AS owner_name,
    proj.is_current,
    proj.source,
    COALESCE(space.project_space, 'development'::text) AS project_space,
    ps.summary_text,
    agg.started_at,
    COALESCE(inv_wl.hours_invested, 0::numeric) AS hours_invested,
    COALESCE(sprint_hrs.hours_this_sprint, 0::numeric) AS hours_this_sprint,
    COALESCE(agg.open_tickets, 0::bigint) AS open_tickets,
    COALESCE(agg.closed_tickets, 0::bigint) AS closed_tickets,
    COALESCE(agg.blocked_tickets, 0::bigint) AS blocked_tickets,
    COALESCE(remaining.remaining_estimate_hours, 0::numeric) AS remaining_estimate_hours,
    COALESCE(contrib.contributor_count, 0::bigint) AS contributor_count,
    COALESCE(spill.spillage_hours, 0::numeric) AS spillage_hours
   FROM projects proj
     LEFT JOIN people owner ON owner.id = proj.owner_person_id
     LEFT JOIN project_summaries ps ON ps.project_id = proj.id
     LEFT JOIN LATERAL ( SELECT min(LEAST(e.created_at, tk.created_at)) AS started_at,
            count(*) FILTER (WHERE tk.status_category <> 'done'::text) AS open_tickets,
            count(*) FILTER (WHERE tk.status_category = 'done'::text) AS closed_tickets,
            count(*) FILTER (WHERE tk.is_blocked AND tk.status_category <> 'done'::text) AS blocked_tickets
           FROM tickets tk
             JOIN epics e ON e.id = tk.epic_id
          WHERE e.project_id = proj.id) agg ON true
     LEFT JOIN LATERAL ( SELECT round(GREATEST(sum(GREATEST(COALESCE(tk.original_estimate_seconds, 0) - COALESCE(tk.time_spent_seconds, 0), 0)) FILTER (WHERE tk.status_category <> 'done'::text), 0)::numeric / 3600.0, 1) AS remaining_estimate_hours
           FROM tickets tk
             JOIN epics e ON e.id = tk.epic_id
             JOIN sprints s ON s.id = tk.sprint_id AND s.is_tracked
          WHERE e.project_id = proj.id AND (tk.original_estimate_seconds IS NULL OR tk.original_estimate_seconds <= 144000)) remaining ON true
     LEFT JOIN LATERAL ( SELECT round(COALESCE(sum(wl.seconds), 0::bigint)::numeric / 3600.0, 1) AS hours_invested
           FROM tickets tk
             JOIN epics e ON e.id = tk.epic_id
             JOIN worklogs wl ON wl.ticket_id = tk.id
             JOIN people p ON p.id = wl.author_person_id AND NOT p.excluded
          WHERE e.project_id = proj.id) inv_wl ON true
     LEFT JOIN LATERAL ( SELECT round(COALESCE(sum(wl.seconds), 0::bigint)::numeric / 3600.0, 1) AS hours_this_sprint
           FROM tickets tk
             JOIN epics e ON e.id = tk.epic_id
             JOIN sprints s ON s.id = tk.sprint_id AND s.is_tracked AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL
             JOIN worklogs wl ON wl.ticket_id = tk.id AND wl.started_at >= s.start_date AND wl.started_at <= s.end_date
             JOIN people p ON p.id = wl.author_person_id AND NOT p.excluded
          WHERE e.project_id = proj.id AND (tk.original_estimate_seconds IS NULL OR tk.original_estimate_seconds <= 144000)) sprint_hrs ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS contributor_count
           FROM project_contributors pc
          WHERE pc.project_id = proj.id) contrib ON true
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN count(*) = 0 THEN 'development'::text
                    WHEN count(*) FILTER (WHERE jp.jira_key <> 'TI'::text) = 0 THEN 'infra'::text
                    WHEN count(*) FILTER (WHERE jp.jira_key <> 'TT'::text) = 0 THEN 'telephony'::text
                    ELSE 'development'::text
                END AS project_space
           FROM project_jira_projects pjp
             JOIN jira_projects jp ON jp.id = pjp.jira_project_id
          WHERE pjp.project_id = proj.id) space ON true
     LEFT JOIN LATERAL ( SELECT round(COALESCE(sum(GREATEST(sprint_totals.total_remaining_hours -
                CASE
                    WHEN sprint_totals.elapsed_workdays = 0 THEN 0::numeric
                    ELSE sprint_totals.total_sprint_logged_hours / sprint_totals.elapsed_workdays::numeric * sprint_totals.remaining_workdays::numeric
                END, 0::numeric)), 0::numeric), 1) AS spillage_hours
           FROM ( SELECT s.id AS sprint_id,
                    sum(
                        CASE
                            WHEN tk.status_category <> 'done'::text THEN GREATEST(COALESCE(tk.original_estimate_seconds, 0) - COALESCE(tk.time_spent_seconds, 0), 0)
                            ELSE 0
                        END)::numeric / 3600.0 AS total_remaining_hours,
                    sum(COALESCE(tk_logged.seconds, 0::bigint)) / 3600.0 AS total_sprint_logged_hours,
                    workdays_between(s.start_date::date, CURRENT_DATE) AS elapsed_workdays,
                    workdays_between(CURRENT_DATE, s.end_date::date) AS remaining_workdays
                   FROM tickets tk
                     JOIN epics e ON e.id = tk.epic_id
                     JOIN sprints s ON s.id = tk.sprint_id
                     LEFT JOIN LATERAL ( SELECT sum(wl.seconds) AS seconds
                           FROM worklogs wl
                             JOIN people p ON p.id = wl.author_person_id AND NOT p.excluded
                          WHERE wl.ticket_id = tk.id AND wl.started_at >= s.start_date AND wl.started_at <= s.end_date) tk_logged ON true
                  WHERE e.project_id = proj.id AND s.is_tracked AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL AND (tk.original_estimate_seconds IS NULL OR tk.original_estimate_seconds <= 144000)
                  GROUP BY s.id, s.start_date, s.end_date) sprint_totals) spill ON true;
