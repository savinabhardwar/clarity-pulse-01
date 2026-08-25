-- get_person_detail's Current Work panel showed EVERY open ticket ever
-- assigned to a person, regardless of which sprint it sits in -- for
-- someone with a large backlog, that surfaced 40+ tickets spanning many
-- long-closed sprints, not just this sprint's work plus genuine
-- spillover. The fix isn't as simple as "filter by the ticket's tracked
-- sprint being state='active'" -- Jira sprints don't auto-close, so a
-- board can have SEVERAL sprints marked state='active' at once when
-- nobody clicked "Complete Sprint" on the old one before starting the
-- new one (confirmed: e.g. "TRG Sprint 8" ended 2026-07-30 but is still
-- state='active' in Jira, alongside the real current "TRG Sprint 10").
-- The only reliable signal that a sprint is genuinely still current is
-- that it HASN'T ENDED YET (end_date >= now()) -- that's what actually
-- distinguishes this sprint + real spillover from a stale sprint someone
-- forgot to close. Mirrors the identical activeSprintIds filter added
-- client-side in eng-data.ts's computeSprintHours/computeJiraUpdateStatus.
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
        'hasComment', exists(select 1 from ticket_comments tc where tc.ticket_id = tk.id)
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
        'hasComment', exists(select 1 from ticket_comments tc where tc.ticket_id = tk.id)
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
        'estimate', round(original_estimate_seconds / 3600.0, 1),
        'logged', round(time_spent_seconds / 3600.0, 1), 'updated', resolved_at
      ))
      from (
        select tk.*, proj.slug as project_slug, proj.name as project_name
        from tickets tk
        left join epics e on e.id = tk.epic_id
        left join projects proj on proj.id = e.project_id
        where tk.assignee_person_id = p.id and tk.status_category = 'done'
        order by tk.resolved_at desc limit 10
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
