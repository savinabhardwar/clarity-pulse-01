-- Ticket-level Jira hygiene: which tickets in the current tracked sprint
-- (per Jira board) are missing an original estimate, an epic link,
-- comments, or a worklog entry. Complements the person-aggregate
-- "Jira Hygiene" stats already exposed via v_people_overview/person_metrics
-- with a ticket-level drill-down. Only returns tickets failing at least
-- one check (same "only the problem rows" shape as v_all_blockers), so the
-- frontend doesn't need to re-filter. Includes Done tickets on purpose --
-- a closed ticket missing its metadata still counts.

create view v_ticket_hygiene as
select
  tk.id as ticket_id,
  tk.jira_key,
  tk.summary,
  coalesce(sm.ui_bucket, tk.status) as status,
  tk.status_category,
  tk.updated_at,
  proj.id as project_id,
  proj.slug as project_slug,
  proj.name as project_name,
  assignee.id as person_id,
  assignee.name as person_name,
  s.name as sprint_name,
  (tk.original_estimate_seconds is null) as missing_estimate,
  (tk.epic_id is null) as missing_epic,
  (not exists (select 1 from ticket_comments c where c.ticket_id = tk.id)) as missing_comments,
  (not exists (select 1 from worklogs w where w.ticket_id = tk.id)) as missing_worklog
from tickets tk
join sprints s on s.id = tk.sprint_id and s.is_tracked
left join status_mapping sm on sm.jira_status = tk.status
left join epics e on e.id = tk.epic_id
left join projects proj on proj.id = e.project_id
left join people assignee on assignee.id = tk.assignee_person_id
where tk.original_estimate_seconds is null
   or tk.epic_id is null
   or not exists (select 1 from ticket_comments c where c.ticket_id = tk.id)
   or not exists (select 1 from worklogs w where w.ticket_id = tk.id);
