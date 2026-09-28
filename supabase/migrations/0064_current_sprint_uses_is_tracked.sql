-- The "is this sprint still current?" check across get_person_detail,
-- v_standup_tickets and get_project_detail compared end_date to today's IST
-- calendar day. That's a calendar guess, and it's wrong on two counts:
--
-- 1. A sprint that ran Mon-Fri but wasn't closed in Jira over the weekend
--    dropped out of "current" the moment its end_date's calendar day
--    passed -- so opening the People/Standup boards on Saturday, Sunday,
--    or even Monday morning (before someone clicks Complete Sprint) showed
--    NO current-sprint tickets at all, even though Jira still has the
--    sprint open and nothing new has started.
-- 2. The pipeline already has a real signal for "which sprint is current":
--    `sprints.is_tracked`, set by sync.mjs from Jira's own openSprints()/
--    active-state query (fetch-jira-rest.mjs's fetchTrackedSprints). That
--    flag only moves to a new sprint once Jira actually reports a new
--    active sprint for the board -- it does NOT flip on a date crossing,
--    and it does NOT flip just because the old sprint's end_date passed.
--    So `is_tracked` already means exactly "still current until a human
--    starts the next sprint in Jira", which end_date-comparison was only
--    ever an approximation of. Switch every one of these reads to use it
--    directly, matching v_projects_overview/v_exec_capacity/
--    v_canonical_sprint, which never used the date comparison to begin
--    with.
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
        'totalLogged', round(coalesce((
          select sum(w.seconds) from worklogs w where w.ticket_id = tk.id
        ), 0) / 3600.0, 1),
        'loggedYesterday', round(coalesce((
          select sum(w.seconds) from worklogs w
          where w.ticket_id = tk.id
            and (w.started_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date)
        ), 0) / 3600.0, 1),
        'updated', tk.updated_at,
        'hasWorklog', exists(select 1 from worklogs w where w.ticket_id = tk.id),
        'hasComment', exists(select 1 from ticket_comments tc where tc.ticket_id = tk.id),
        'hasEpic', tk.epic_id is not null,
        'lastTouchedAt', greatest(
          (select max(w.started_at) from worklogs w where w.ticket_id = tk.id),
          (select max(tc.created_at) from ticket_comments tc where tc.ticket_id = tk.id)
        )
      ) order by tk.updated_at desc)
      from tickets tk
      join sprints s on s.id = tk.sprint_id and s.is_tracked
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
        'logged', round(coalesce((
          select sum(w.seconds) from worklogs w
          where w.ticket_id = tk.id
            and (p_sprint_start is null or w.started_at >= p_sprint_start)
        ), 0) / 3600.0, 1),
        'totalLogged', round(coalesce((
          select sum(w.seconds) from worklogs w where w.ticket_id = tk.id
        ), 0) / 3600.0, 1),
        'loggedYesterday', round(coalesce((
          select sum(w.seconds) from worklogs w
          where w.ticket_id = tk.id
            and (w.started_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date)
        ), 0) / 3600.0, 1),
        'updated', tk.updated_at,
        'hasWorklog', exists(select 1 from worklogs w where w.ticket_id = tk.id),
        'hasComment', exists(select 1 from ticket_comments tc where tc.ticket_id = tk.id),
        'hasEpic', tk.epic_id is not null
      ))
      from tickets tk
      join sprints s on s.id = tk.sprint_id and s.is_tracked
      left join status_mapping sm on sm.jira_status = tk.status
      left join epics e on e.id = tk.epic_id
      left join projects proj on proj.id = e.project_id
      where tk.assignee_person_id = p.id and tk.status_category = 'new'
    ), '[]'::jsonb),
    'completedThisSprint', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', tk.jira_key, 'title', tk.summary, 'status', sm.ui_bucket,
        'projectId', proj.slug, 'projectName', coalesce(proj.name, jp.name),
        'priority', tk.priority, 'estimate', round(tk.original_estimate_seconds / 3600.0, 1),
        'remaining', round(tk.remaining_estimate_seconds / 3600.0, 1),
        'totalLogged', round(coalesce((
          select sum(w.seconds) from worklogs w where w.ticket_id = tk.id
        ), 0) / 3600.0, 1),
        'updated', tk.updated_at,
        'hasWorklog', exists(select 1 from worklogs w where w.ticket_id = tk.id),
        'hasComment', exists(select 1 from ticket_comments tc where tc.ticket_id = tk.id),
        'hasEpic', tk.epic_id is not null
      ))
      from tickets tk
      join sprints s on s.id = tk.sprint_id and s.is_tracked
      left join status_mapping sm on sm.jira_status = tk.status
      left join epics e on e.id = tk.epic_id
      left join projects proj on proj.id = e.project_id
      left join jira_projects jp on jp.id = tk.jira_project_id
      where tk.assignee_person_id = p.id and tk.status_category = 'done'
    ), '[]'::jsonb),
    'completed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', jira_key, 'title', summary, 'projectId', project_slug, 'projectName', project_name,
        'estimate', null,
        'logged', round(spent_seconds / 3600.0, 1), 'updated', resolution_date
      ))
      from (
        select rth.*, proj.slug as project_slug, coalesce(proj.name, jp2.name) as project_name
        from resolved_ticket_history rth
        left join epics e on e.jira_key = rth.parent_epic_key
        left join projects proj on proj.id = e.project_id
        left join jira_projects jp2 on jp2.jira_key = split_part(rth.jira_key, '-', 1)
        where rth.assignee_person_id = p.id
          and rth.resolution_date >= coalesce(
            -- 1. This board's currently tracked sprint, if one exists.
            (select max(s.start_date) from sprints s
             join jira_projects jp on jp.id = s.jira_project_id
             where jp.jira_key = split_part(rth.jira_key, '-', 1)
               and s.is_tracked),
            -- 2. Otherwise, this board's most recently started sprint of
            --    ANY state -- covers the normal "between sprints" gap
            --    (last one ended, next one not yet tracked) without
            --    reopening completions from sprints before that.
            (select max(s.start_date) from sprints s
             join jira_projects jp on jp.id = s.jira_project_id
             where jp.jira_key = split_part(rth.jira_key, '-', 1)),
            -- 3. Only a board with NO sprint rows at all (genuinely
            --    outside sync coverage) falls all the way back to no cutoff.
            '-infinity'::timestamptz
          )
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

create or replace view v_standup_tickets with (security_invoker = on) as
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
      and (w.started_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date)
  ), 0) / 3600.0, 1) as logged_yesterday_hours,
  (tk.status_category = 'done'
    and (tk.updated_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date)
  ) as finished_yesterday,
  tk.updated_at,
  coalesce(proj.name, jp.name) as project_name
from tickets tk
join sprints s on s.id = tk.sprint_id and s.is_tracked
join people p on p.id = tk.assignee_person_id
left join status_mapping sm on sm.jira_status = tk.status
left join epics e on e.id = tk.epic_id
left join projects proj on proj.id = e.project_id
left join jira_projects jp on jp.id = tk.jira_project_id
where tk.assignee_person_id is not null
  and tk.status_category in ('new', 'indeterminate', 'done');

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
    'currentSprintTickets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', tk.jira_key, 'title', tk.summary, 'status', sm.ui_bucket,
        'assignee', ap.name, 'estimate', round(tk.original_estimate_seconds / 3600.0, 1)
      ) order by tk.status_category, tk.jira_key)
      from tickets tk
      join epics e on e.id = tk.epic_id
      left join status_mapping sm on sm.jira_status = tk.status
      left join people ap on ap.id = tk.assignee_person_id
      where e.project_id = proj.id
        and tk.sprint_id in (
          select s.id from sprints s
          where s.is_tracked
            and s.jira_project_id in (select distinct e2.jira_project_id from epics e2 where e2.project_id = proj.id)
        )
    ), '[]'::jsonb),
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
             and s.is_tracked),
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
