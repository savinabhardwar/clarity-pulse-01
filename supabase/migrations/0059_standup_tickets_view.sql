-- Powers a new "Daily Standup" view in team-pulse-54: per person, what they
-- worked on yesterday (hours + tickets), what they're doing today (in
-- progress + queued), and what's blocked -- built for scanning the whole
-- team fast during a live scrum, not clicking into 24 separate Person
-- Cards. One bulk view queried once and grouped by person_id client-side,
-- same idiom as v_ticket_hygiene (0029_ticket_hygiene.sql), rather than N+1
-- calls to get_person_detail.
--
-- Reuses the day-boundary-safe "sprint hasn't ended yet" join condition
-- from 0056/0057/0058 (IST calendar day, not a raw end_date instant) and
-- the same yesterday/logged-hours computation as 0058's loggedYesterday --
-- do not re-derive either of these in client-side JS.
create view v_standup_tickets with (security_invoker = on) as
select
  tk.assignee_person_id as person_id,
  p.name as person_name,
  tk.jira_key,
  tk.summary,
  coalesce(sm.ui_bucket, tk.status) as status,
  tk.status_category,
  tk.priority,
  tk.is_blocked,
  round(tk.original_estimate_seconds / 3600.0, 1) as estimate_hours,
  round(tk.remaining_estimate_seconds / 3600.0, 1) as remaining_hours,
  round(coalesce((
    select sum(w.seconds) from worklogs w
    where w.ticket_id = tk.id
      and (w.started_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date - 1
  ), 0) / 3600.0, 1) as logged_yesterday_hours,
  -- A ticket finished outright yesterday never shows up under
  -- logged_yesterday_hours once it's Done (that field only sums worklogs,
  -- and someone can close a ticket without logging fresh time against it
  -- that same day) -- this flags it separately so "yesterday" still
  -- reads as complete for standup purposes.
  (tk.status_category = 'done'
    and (tk.updated_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date - 1
  ) as finished_yesterday,
  tk.updated_at,
  -- Same epic-clustered-project-with-raw-board-fallback pattern as 0057 --
  -- a ticket whose Jira "parent" isn't really an Epic still gets a real
  -- project label instead of a blank one.
  coalesce(proj.name, jp.name) as project_name
from tickets tk
join sprints s on s.id = tk.sprint_id
  and (s.end_date at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date
join people p on p.id = tk.assignee_person_id
left join status_mapping sm on sm.jira_status = tk.status
left join epics e on e.id = tk.epic_id
left join projects proj on proj.id = e.project_id
left join jira_projects jp on jp.id = tk.jira_project_id
where tk.assignee_person_id is not null
  and tk.status_category in ('new', 'indeterminate', 'done');
