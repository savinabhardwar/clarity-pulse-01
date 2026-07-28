-- RPC functions: used where the frontend genuinely needs nested JSON in
-- one round trip (a person or project's full detail page). List-style
-- pages (Overview, People list, Resource Planning, Team Health) read
-- straight from the v_* views instead -- no RPC needed for a flat select.

create or replace function get_person_detail(p_person_id uuid)
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
        'logged', round(tk.time_spent_seconds / 3600.0, 1), 'updated', tk.updated_at
      ) order by tk.updated_at desc)
      from tickets tk
      left join status_mapping sm on sm.jira_status = tk.status
      left join epics e on e.id = tk.epic_id
      left join projects proj on proj.id = e.project_id
      where tk.assignee_person_id = p.id and tk.status_category = 'indeterminate'
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', tk.jira_key, 'title', tk.summary, 'status', sm.ui_bucket,
        'projectId', proj.slug, 'projectName', proj.name,
        'priority', tk.priority, 'estimate', round(tk.original_estimate_seconds / 3600.0, 1)
      ))
      from tickets tk
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

create or replace function get_project_detail(p_slug text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', proj.slug,
    'name', proj.name,
    'color', proj.color,
    'purpose', proj.purpose,
    'health', proj.health,
    'progress', proj.progress,
    'sprintGoal', proj.sprint_goal,
    'summary', ps.summary_text,
    'initiatives', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', pu.name, 'summary', pu.summary, 'progress', pu.progress,
        'issues', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'key', tk.jira_key, 'title', tk.summary, 'status', sm.ui_bucket,
            'assignee', ap.name, 'estimate', round(tk.original_estimate_seconds / 3600.0, 1)
          )), '[]'::jsonb)
          from project_update_tickets put
          join tickets tk on tk.id = put.ticket_id
          left join status_mapping sm on sm.jira_status = tk.status
          left join people ap on ap.id = tk.assignee_person_id
          where put.project_update_id = pu.id
        )
      ) order by pu.name)
      from project_updates pu where pu.project_id = proj.id
    ), '[]'::jsonb),
    'delivered', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', pf.name, 'description', pf.description, 'date', pf.completion_date,
        'hours', pf.hours,
        'tickets', (
          select coalesce(jsonb_agg(tk.jira_key), '[]'::jsonb)
          from project_feature_tickets pft join tickets tk on tk.id = pft.ticket_id
          where pft.project_feature_id = pf.id
        )
      ) order by pf.completion_date desc nulls last)
      from project_features pf where pf.project_id = proj.id
    ), '[]'::jsonb),
    'risks', jsonb_build_object(
      'blockers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'ticket', tk.jira_key, 'title', tk.summary, 'since', tk.updated_at,
          'owner', ap.name, 'priority', tk.priority
        ))
        from tickets tk
        join epics e on e.id = tk.epic_id
        left join people ap on ap.id = tk.assignee_person_id
        where e.project_id = proj.id and tk.is_blocked and tk.status_category != 'done'
      ), '[]'::jsonb),
      'missingEstimates', (
        select count(*) from tickets tk join epics e on e.id = tk.epic_id
        where e.project_id = proj.id and tk.original_estimate_seconds is null and tk.status_category != 'done'
      )
    ),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('when', occurred_at, 'text', text, 'kind', kind))
      from (
        select occurred_at, text, kind from activity_feed af
        where af.project_id = proj.id
        order by af.occurred_at desc limit 20
      ) recent
    ), '[]'::jsonb)
  )
  from projects proj
  left join project_summaries ps on ps.project_id = proj.id
  where proj.slug = p_slug;
$$;
