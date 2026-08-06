-- get_project_detail's "delivered" (project_features) list had no time
-- bound at all -- every ticket resolved under this project's epic(s),
-- ever, stayed listed as "Recently shipped" forever (0016 explicitly
-- reverted an earlier attempt at date-scoping because it broke the
-- worklog-joined hours, but never revisited whether unbounded is right
-- for WHICH items show). Found live: a "Woven Daily Issues" project
-- still listed tickets resolved in an already-closed prior sprint.
--
-- Scope to the project's own board's CURRENT, not-yet-ended sprint (the
-- most recent sprint start among sprints sharing a jira_project_id with
-- any of this project's epics) -- not one global cutoff, since boards
-- run staggered sprint cadences (same root cause as the person-scoring
-- fix in eng-data.ts and sync.mjs's project_features rebuild). Falls
-- back to showing everything when no matching not-yet-ended sprint is
-- found, so a project without a currently tracked sprint doesn't go
-- silently empty. This is a read-time safety net alongside sync.mjs's
-- own filtering when project_features is rebuilt -- correct even if a
-- sync run is delayed.
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
      from project_features pf
      where pf.project_id = proj.id
        and pf.completion_date >= coalesce(
          (select max(s.start_date) from sprints s
           where s.jira_project_id in (select distinct e.jira_project_id from epics e where e.project_id = proj.id)
             and s.end_date >= now()),
          '-infinity'::timestamptz
        )
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
