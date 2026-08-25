-- get_project_detail's "sprintGoal" read from projects.sprint_goal, a
-- column the sync has always hardcoded to null on every upsert and never
-- included in its updateColumns -- a dead stub that could never surface a
-- real Jira sprint goal even once one gets filled in. Jira's own sprint
-- object does carry a "goal" field (confirmed live: currently empty on
-- every tracked board, but the field exists) -- fetch-jira-rest.mjs and
-- sync.mjs now carry it through onto the per-board `sprints` row, where it
-- belongs (a goal is a property of a specific board's sprint, not of a
-- project, which can span multiple boards/epics).
alter table sprints add column if not exists goal text;

-- Pull the goal from the project's own currently-tracked sprint, same
-- board-matching approach 0049 already uses for scoping "delivered" --
-- most recent tracked sprint among boards backing any of this project's
-- epics, not projects.sprint_goal (kept in place but no longer read here).
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
    'sprintGoal', (
      select s.goal from sprints s
      where s.is_tracked
        and s.jira_project_id in (select distinct e.jira_project_id from epics e where e.project_id = proj.id)
      order by s.start_date desc
      limit 1
    ),
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
