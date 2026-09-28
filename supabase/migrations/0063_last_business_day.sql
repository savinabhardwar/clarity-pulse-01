-- "Yesterday" across the pipeline (loggedYesterday, logged_yesterday_hours,
-- finished_yesterday) was always `today - 1`, so opening the boards on a
-- Monday showed Sunday -- a day nobody logs anything against -- instead of
-- Friday, the last day anyone actually worked. Weekends aren't tracked at
-- all, so "yesterday" needs to mean "the last business day", not a raw
-- 24h lookback: Monday -> Friday, Sunday -> Friday, Saturday -> Friday,
-- every other day -> the calendar day before.
create or replace function last_business_day(d date)
returns date
language sql
immutable
as $$
  select case extract(dow from d)
    when 0 then d - 2 -- Sunday -> Friday
    when 1 then d - 3 -- Monday -> Friday
    else d - 1
  end
$$;

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
      join sprints s on s.id = tk.sprint_id
        and (s.end_date at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date
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
            (select max(s.start_date) from sprints s
             join jira_projects jp on jp.id = s.jira_project_id
             where jp.jira_key = split_part(rth.jira_key, '-', 1)
               and (s.end_date at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date),
            (select max(s.start_date) from sprints s
             join jira_projects jp on jp.id = s.jira_project_id
             where jp.jira_key = split_part(rth.jira_key, '-', 1)),
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
join sprints s on s.id = tk.sprint_id
  and (s.end_date at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date
join people p on p.id = tk.assignee_person_id
left join status_mapping sm on sm.jira_status = tk.status
left join epics e on e.id = tk.epic_id
left join projects proj on proj.id = e.project_id
left join jira_projects jp on jp.id = tk.jira_project_id
where tk.assignee_person_id is not null
  and tk.status_category in ('new', 'indeterminate', 'done');
