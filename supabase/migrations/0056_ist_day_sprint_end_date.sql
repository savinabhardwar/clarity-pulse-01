-- get_person_detail's current/upcoming/completedThisSprint panels (and
-- get_project_detail's delivered-features cutoff) all scope to "a sprint
-- that hasn't ended yet" via `s.end_date >= now()`. That compares against
-- the raw stored instant, which carries whatever time-of-day the sprint
-- was originally started in Jira (e.g. 10:30 IST) -- not midnight or
-- end-of-day. So on a sprint's own actual last calendar day, the moment
-- that time-of-day passes, every ticket in it drops out of scope hours
-- before anyone has clicked "Complete Sprint" -- Employee Details reads
-- as "Nothing assigned this sprint" for everyone, the exact "board looks
-- empty" failure this whole scoping convention exists to prevent.
--
-- Reported live: on Aug 28 (Sprint 10/10's real last day, "ends today"),
-- Team Overview's Recognition panel showed most people with "Nothing
-- assigned this sprint" / N/A metrics -- see [[0055_project_detail_current_sprint_tickets]]'s
-- sibling client-side fix (useEmployees.ts's activeSprintIds, now
-- sprintNotYetEnded-based) for the matching frontend half of this bug.
--
-- Fix: compare calendar days in the org's real timezone (IST, UTC+5:30 --
-- see engineering-ethos/src/lib/eng-data.ts's own toIst rationale) instead
-- of raw instants, so a sprint stays in scope through the END of its
-- actual last day, not just until the clock hits its original start time.
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
      join sprints s on s.id = tk.sprint_id
        and (s.end_date at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date
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
        'totalLogged', round(coalesce((
          select sum(w.seconds) from worklogs w where w.ticket_id = tk.id
        ), 0) / 3600.0, 1),
        'updated', tk.updated_at,
        'hasWorklog', exists(select 1 from worklogs w where w.ticket_id = tk.id),
        'hasComment', exists(select 1 from ticket_comments tc where tc.ticket_id = tk.id),
        'hasEpic', tk.epic_id is not null
      ))
      from tickets tk
      join sprints s on s.id = tk.sprint_id
        and (s.end_date at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date
      left join status_mapping sm on sm.jira_status = tk.status
      left join epics e on e.id = tk.epic_id
      left join projects proj on proj.id = e.project_id
      where tk.assignee_person_id = p.id and tk.status_category = 'new'
    ), '[]'::jsonb),
    'completedThisSprint', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', tk.jira_key, 'title', tk.summary, 'status', sm.ui_bucket,
        'projectId', proj.slug, 'projectName', proj.name,
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
      join sprints s on s.id = tk.sprint_id
        and (s.end_date at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date
      left join status_mapping sm on sm.jira_status = tk.status
      left join epics e on e.id = tk.epic_id
      left join projects proj on proj.id = e.project_id
      where tk.assignee_person_id = p.id and tk.status_category = 'done'
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
          and rth.resolution_date >= coalesce(
            -- 1. This board's currently not-yet-ended sprint, if one exists.
            (select max(s.start_date) from sprints s
             join jira_projects jp on jp.id = s.jira_project_id
             where jp.jira_key = split_part(rth.jira_key, '-', 1)
               and (s.end_date at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date),
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

-- Same day-boundary fix for the Projects page's "delivered features" cutoff.
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
             and (s.end_date at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date),
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
