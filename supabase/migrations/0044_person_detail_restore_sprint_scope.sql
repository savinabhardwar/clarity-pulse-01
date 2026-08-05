-- Fixes a regression introduced by 0039: rewriting get_person_detail to
-- source Completed from resolved_ticket_history was based on an earlier
-- copy of this function (from before 0033/0036) and silently DROPPED the
-- `join sprints s on s.id = tk.sprint_id and s.end_date >= now()` clause
-- 0033 added to current/upcoming. Without it, Current Work showed EVERY
-- ticket ever assigned to a person regardless of sprint -- including
-- tickets purge-closed-sprint-tickets.mjs's untrack step had already set
-- sprint_id = null on (a ticket with sprint_id null still matches
-- `tk.assignee_person_id = p.id and tk.status_category = ...` with no
-- sprint join to exclude it). Restoring 0033/0036's join brings back the
-- original fix on top of 0039/0042's resolved_ticket_history change.
create or replace function get_person_detail(p_person_id uuid, p_sprint_start timestamptz default null)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'role', p.role,
    'team', t.name,
    'teamGuessed', p.team_guessed,
    'metrics', to_jsonb(pm) - 'person_id',
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'projectId', proj.slug, 'projectName', proj.name, 'color', proj.color,
        'pct', pc.pct, 'hours', pc.hours
      ) order by pc.pct desc)
      from project_contributors pc join projects proj on proj.id = pc.project_id
      where pc.person_id = p.id
    ), '[]'::jsonb),
    'current', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', tk.jira_key, 'title', tk.summary, 'status', sm.ui_bucket,
        'projectId', proj.slug, 'projectName', proj.name,
        'priority', tk.priority, 'estimate', round(tk.original_estimate_seconds / 3600.0, 1),
        'remaining', round(tk.remaining_estimate_seconds / 3600.0, 1),
        'logged', round(coalesce((
          select sum(w.seconds) from worklogs w
          where w.ticket_id = tk.id
            and (p_sprint_start is null or w.started_at >= p_sprint_start)
        ), 0) / 3600.0, 1),
        'updated', tk.updated_at,
        'hasWorklog', exists(select 1 from worklogs w where w.ticket_id = tk.id),
        'hasComment', exists(select 1 from ticket_comments tc where tc.ticket_id = tk.id),
        'hasEpic', tk.epic_id is not null
      ) order by tk.updated_at desc)
      from tickets tk
      join sprints s on s.id = tk.sprint_id and s.end_date >= now()
      left join status_mapping sm on sm.jira_status = tk.status
      left join epics e on e.id = tk.epic_id
      left join projects proj on proj.id = e.project_id
      where tk.assignee_person_id = p.id and tk.status_category = 'indeterminate'
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', tk.jira_key, 'title', tk.summary, 'status', sm.ui_bucket,
        'projectId', proj.slug, 'projectName', proj.name,
        'priority', tk.priority, 'estimate', round(tk.original_estimate_seconds / 3600.0, 1),
        'remaining', round(tk.remaining_estimate_seconds / 3600.0, 1),
        'updated', tk.updated_at,
        'hasWorklog', exists(select 1 from worklogs w where w.ticket_id = tk.id),
        'hasComment', exists(select 1 from ticket_comments tc where tc.ticket_id = tk.id),
        'hasEpic', tk.epic_id is not null
      ))
      from tickets tk
      join sprints s on s.id = tk.sprint_id and s.end_date >= now()
      left join status_mapping sm on sm.jira_status = tk.status
      left join epics e on e.id = tk.epic_id
      left join projects proj on proj.id = e.project_id
      where tk.assignee_person_id = p.id and tk.status_category = 'new'
    ), '[]'::jsonb),
    'completed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', jira_key, 'title', summary, 'projectId', project_slug, 'projectName', project_name,
        'estimate', null,
        'logged', round(spent_seconds / 3600.0, 1), 'updated', resolution_date
      ))
      from (
        select rth.*, proj.slug as project_slug, proj.name as project_name
        from resolved_ticket_history rth
        left join epics e on e.jira_key = rth.parent_epic_key
        left join projects proj on proj.id = e.project_id
        where rth.assignee_person_id = p.id
        order by rth.resolution_date desc limit 10
      ) recent
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object('ticket', jira_key, 'text', body_excerpt, 'when', created_at))
      from (
        select tc.body_excerpt, tc.created_at, tk.jira_key
        from ticket_comments tc join tickets tk on tk.id = tc.ticket_id
        where tc.author_person_id = p.id
        order by tc.created_at desc limit 10
      ) recent
    ), '[]'::jsonb)
  )
  from people p
  left join teams t on t.id = p.team_id
  left join person_metrics pm on pm.person_id = p.id
  where p.id = p_person_id;
$$;
