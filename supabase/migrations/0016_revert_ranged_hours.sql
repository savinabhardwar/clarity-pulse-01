-- 0014's date-scoped "hours" for delivered items joined project_feature_tickets
-- to worklogs, but worklogs only has rows for tickets in the CURRENT
-- sprint window -- delivered/historical tickets (already resolved, often
-- from past sprints) never get a tickets/worklogs row at all in this
-- schema. That made the ranged hours silently return 0 for nearly every
-- delivered item once a range was set, which is worse than not scoping
-- it. The frontend never actually called this RPC with p_from/p_to, so
-- reverting the signature back to just p_slug rather than leave unused
-- params. Delivered-capability hours stays a lifetime total; the
-- frontend still filters WHICH items show by completion_date client-side.
drop function if exists get_project_detail(text, timestamptz, timestamptz);
drop function if exists get_project_detail(text);

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
