-- Jira has no single "activity feed" API without extra webhook plumbing.
-- Rather than leave the Overview page's activity section empty (or fake
-- it), derive it from data already synced: recently resolved tickets and
-- recent comments are real activity signals we already have.
create view v_recent_activity as
select * from (
  select tk.resolved_at as occurred_at, (tk.summary || ' completed') as text, 'completed'::text as kind,
    proj.slug as project_id, proj.name as project_name
  from tickets tk
  join epics e on e.id = tk.epic_id
  join projects proj on proj.id = e.project_id
  where tk.status_category = 'done' and tk.resolved_at is not null

  union all

  select tc.created_at as occurred_at, (ap.name || ' commented on ' || tk.jira_key) as text, 'update'::text as kind,
    proj.slug as project_id, proj.name as project_name
  from ticket_comments tc
  join tickets tk on tk.id = tc.ticket_id
  join epics e on e.id = tk.epic_id
  join projects proj on proj.id = e.project_id
  left join people ap on ap.id = tc.author_person_id

  union all

  select tk.updated_at as occurred_at, (tk.summary || ' blocked') as text, 'blocked'::text as kind,
    proj.slug as project_id, proj.name as project_name
  from tickets tk
  join epics e on e.id = tk.epic_id
  join projects proj on proj.id = e.project_id
  where tk.is_blocked and tk.status_category != 'done'
) combined
order by occurred_at desc;

create view v_top_risks as
select category, severity, title, recommendation, person_id, project_id, identified_at
from risks
where status = 'open'
order by
  case severity when 'high' then 1 when 'medium' then 2 else 3 end,
  identified_at desc
limit 5;
