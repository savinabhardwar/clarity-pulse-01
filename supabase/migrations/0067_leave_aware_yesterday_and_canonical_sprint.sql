-- Two unrelated live bugs, fixed together because both are "a date-based
-- shortcut stopped matching reality" and both were found in the same pass.

-- ---------------------------------------------------------------------
-- 1. v_canonical_sprint still hid a still-open sprint once its calendar
--    end_date passed.
-- ---------------------------------------------------------------------
-- 0064 fixed get_person_detail/v_standup_tickets/get_project_detail to key
-- off `sprints.is_tracked` (Jira's own "is this sprint still open" signal)
-- instead of comparing end_date to today -- specifically so a sprint that
-- ran late (nobody clicked "Complete Sprint" in Jira yet) didn't silently
-- disappear from the app. 0064's own comment claimed v_canonical_sprint
-- "never used the date comparison to begin with" -- that was wrong.
-- v_canonical_sprint (0028_executive_compass_capacity.sql) still filtered
-- on `current_date between start_date and end_date`, so once a sprint ran
-- past its planned end_date, this view returned zero rows even with
-- is_tracked still true -- which zeroes out sprintStartIso/sprintEndIso on
-- the frontend (team-pulse-54/src/lib/emp-store.tsx), which in turn
-- disables useSprintWorklogs and blanks capacity/spillage/allocatedHours
-- everywhere they're read. Drop the date clause; is_tracked alone is
-- already exactly "which sprint is current", matching every sibling view.
-- `s.*` no longer matches this view's original (0028) column list --
-- sprints gained a `goal` column since (0054_sprint_goal.sql), which lands
-- in the middle of a `create or replace view`'s column set (Postgres only
-- allows appending new trailing columns, not inserting mid-list), and this
-- view is depended on by v_exec_capacity -> v_exec_capacity_org. Drop and
-- recreate the whole chain rather than fight column-position rules.
drop view if exists v_exec_capacity_org;
drop view if exists v_exec_capacity;
drop view if exists v_canonical_sprint;

create view v_canonical_sprint as
select
  s.*,
  workdays_between(s.start_date::date - 1, s.end_date::date) as total_workdays
from sprints s
where s.is_tracked
  and s.start_date is not null and s.end_date is not null
order by abs(workdays_between(s.start_date::date - 1, s.end_date::date) - 10) asc, s.end_date desc
limit 1;

create view v_exec_capacity as
with team_bucket as (
  select p.id as person_id,
    case
      when t.name = 'Team - Infrastructure' then 'Infrastructure'
      when t.name = 'Team - Telephony' then 'Telephony'
      else 'Development'
    end as team
  from people p
  left join teams t on t.id = p.team_id
  where p.active and not p.excluded
),
canonical as (
  select total_workdays from v_canonical_sprint limit 1
),
headcount as (
  select team, count(*) as person_count from team_bucket group by team
),
allocated as (
  select tb.team,
    round(sum(coalesce(tk.original_estimate_seconds, tk.time_spent_seconds)) / 3600.0, 1) as allocated_hours
  from tickets tk
  join sprints s on s.id = tk.sprint_id and s.is_tracked
  join team_bucket tb on tb.person_id = tk.assignee_person_id
  group by tb.team
),
spillage as (
  select tb.team,
    round(coalesce(sum(
      greatest(
        (tk.remaining_estimate_seconds / 3600.0) - case
          when workdays_between(s.start_date::date, current_date) = 0 then 0
          else (tk.time_spent_seconds / 3600.0 / workdays_between(s.start_date::date, current_date)) * workdays_between(current_date, s.end_date::date)
        end,
        0
      )
    ) filter (where tk.status_category != 'done'), 0)::numeric, 1) as spillage_hours
  from tickets tk
  join sprints s on s.id = tk.sprint_id and s.is_tracked and s.start_date is not null and s.end_date is not null
  join team_bucket tb on tb.person_id = tk.assignee_person_id
  group by tb.team
)
select
  h.team,
  h.person_count,
  (select total_workdays from canonical) as sprint_workdays,
  round(7.0 * (select total_workdays from canonical) * h.person_count, 1) as total_productive_hours,
  coalesce(a.allocated_hours, 0) as allocated_hours,
  round(7.0 * (select total_workdays from canonical) * h.person_count - coalesce(a.allocated_hours, 0), 1) as unallocated_hours,
  case when h.person_count = 0 or (select total_workdays from canonical) = 0 then 0
    else round(100 * coalesce(a.allocated_hours, 0) / (7.0 * (select total_workdays from canonical) * h.person_count))
  end as capacity_used_pct,
  coalesce(sp.spillage_hours, 0) as spillage_hours
from headcount h
left join allocated a on a.team = h.team
left join spillage sp on sp.team = h.team;

create view v_exec_capacity_org as
select
  sum(person_count) as person_count,
  max(sprint_workdays) as sprint_workdays,
  round(sum(total_productive_hours), 1) as total_productive_hours,
  round(sum(allocated_hours), 1) as allocated_hours,
  round(sum(unallocated_hours), 1) as unallocated_hours,
  case when sum(total_productive_hours) = 0 then 0
    else round(100 * sum(allocated_hours) / sum(total_productive_hours))
  end as capacity_used_pct,
  round(sum(spillage_hours), 1) as spillage_hours
from v_exec_capacity;

-- ---------------------------------------------------------------------
-- 2. "Logged yesterday" needs to skip a person's own leave days, not just
--    weekends.
-- ---------------------------------------------------------------------
-- last_business_day (0063) already turns Mon/Sun/Sat lookups into "the
-- prior Friday" so nobody's "yesterday" lands on a day nobody logs time
-- against -- but it had no idea a specific person was on leave. If someone
-- takes a multi-day leave (recorded in planning_availability, from_date to
-- to_date), the generic calendar-only version still landed on a leave day
-- (a day they also logged nothing against, for an unrelated reason), so
-- "Logged yesterday" read empty even though they genuinely worked right up
-- until the leave started.
--
-- Rule (requested): the day immediately before a person's leave started is
-- what "yesterday" should resolve to, for as long as today's naive
-- last-business-day lookup would otherwise land inside (or before, across
-- a weekend) that leave range. Adds a person_id parameter -- when given,
-- walk the result back past any planning_availability range covering it
-- (skipping weekends again after each jump), bounded to 60 hops so bad
-- data can't loop forever. Old 1-arg signature is replaced by a 2-arg one
-- with p_person_id defaulting to null (a plain drop-in for every existing
-- caller); can't keep both since a bare `last_business_day(d)` call would
-- then be ambiguous between them.
-- cascade: get_person_detail and v_standup_tickets both call the old
-- 1-arg signature -- both are fully recreated later in this same
-- migration, so dropping them here is safe.
drop function if exists last_business_day(date) cascade;

create or replace function last_business_day(d date, p_person_id uuid default null)
returns date
language plpgsql
stable
as $$
declare
  result date := case extract(dow from d)
    when 0 then d - 2 -- Sunday -> Friday
    when 1 then d - 3 -- Monday -> Friday
    else d - 1
  end;
  leave_start date;
  hops int := 0;
begin
  if p_person_id is null then
    return result;
  end if;

  loop
    hops := hops + 1;
    exit when hops > 60;

    select min(from_date) into leave_start
    from planning_availability
    where person_id = p_person_id
      and result between from_date and to_date;

    exit when leave_start is null;

    result := leave_start - 1;
    result := case extract(dow from result)
      when 0 then result - 2
      when 1 then result - 3
      else result
    end;
  end loop;

  return result;
end;
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
        'isAssignee', tk.assignee_person_id = p.id,
        'logged', round(coalesce((
          select sum(w.seconds) from worklogs w
          where w.ticket_id = tk.id
            and w.author_person_id = p.id
            and (p_sprint_start is null or w.started_at >= p_sprint_start)
        ), 0) / 3600.0, 1),
        'totalLogged', round(coalesce((
          select sum(w.seconds) from worklogs w where w.ticket_id = tk.id
        ), 0) / 3600.0, 1),
        'loggedYesterday', round(coalesce((
          select sum(w.seconds) from worklogs w
          where w.ticket_id = tk.id
            and (w.started_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date, p.id)
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
      where tk.status_category = 'indeterminate'
        and (
          tk.assignee_person_id = p.id
          or exists (
            select 1 from worklogs w
            where w.ticket_id = tk.id and w.author_person_id = p.id
              and (p_sprint_start is null or w.started_at >= p_sprint_start)
          )
        )
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', tk.jira_key, 'title', tk.summary, 'status', sm.ui_bucket,
        'projectId', proj.slug, 'projectName', proj.name,
        'priority', tk.priority, 'estimate', round(tk.original_estimate_seconds / 3600.0, 1),
        'remaining', round(tk.remaining_estimate_seconds / 3600.0, 1),
        'isAssignee', tk.assignee_person_id = p.id,
        'logged', round(coalesce((
          select sum(w.seconds) from worklogs w
          where w.ticket_id = tk.id
            and w.author_person_id = p.id
            and (p_sprint_start is null or w.started_at >= p_sprint_start)
        ), 0) / 3600.0, 1),
        'totalLogged', round(coalesce((
          select sum(w.seconds) from worklogs w where w.ticket_id = tk.id
        ), 0) / 3600.0, 1),
        'loggedYesterday', round(coalesce((
          select sum(w.seconds) from worklogs w
          where w.ticket_id = tk.id
            and (w.started_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date, p.id)
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
      where tk.status_category = 'new'
        and (
          tk.assignee_person_id = p.id
          or exists (
            select 1 from worklogs w
            where w.ticket_id = tk.id and w.author_person_id = p.id
              and (p_sprint_start is null or w.started_at >= p_sprint_start)
          )
        )
    ), '[]'::jsonb),
    'completedThisSprint', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', tk.jira_key, 'title', tk.summary, 'status', sm.ui_bucket,
        'projectId', proj.slug, 'projectName', coalesce(proj.name, jp.name),
        'priority', tk.priority, 'estimate', round(tk.original_estimate_seconds / 3600.0, 1),
        'remaining', round(tk.remaining_estimate_seconds / 3600.0, 1),
        'isAssignee', tk.assignee_person_id = p.id,
        'logged', round(coalesce((
          select sum(w.seconds) from worklogs w
          where w.ticket_id = tk.id
            and w.author_person_id = p.id
            and (p_sprint_start is null or w.started_at >= p_sprint_start)
        ), 0) / 3600.0, 1),
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
      where tk.status_category = 'done'
        and (
          tk.assignee_person_id = p.id
          or exists (
            select 1 from worklogs w
            where w.ticket_id = tk.id and w.author_person_id = p.id
              and (p_sprint_start is null or w.started_at >= p_sprint_start)
          )
        )
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

drop view if exists v_standup_tickets;

create view v_standup_tickets with (security_invoker = on) as
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
      and w.author_person_id = tk.assignee_person_id
      and (w.started_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date, tk.assignee_person_id)
  ), 0) / 3600.0, 1) as logged_yesterday_hours,
  true as is_assignee,
  (tk.status_category = 'done'
    and (tk.updated_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date, tk.assignee_person_id)
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
  and tk.status_category in ('new', 'indeterminate', 'done')

union all

select
  w.author_person_id as person_id,
  p.name as person_name,
  tk.jira_key,
  tk.summary,
  coalesce(sm.ui_bucket, tk.status) as status,
  tk.status_category,
  tk.priority,
  tk.is_blocked,
  round(tk.original_estimate_seconds / 3600.0, 1) as estimate_hours,
  round(tk.remaining_estimate_seconds / 3600.0, 1) as remaining_hours,
  round(sum(w.seconds) / 3600.0, 1) as logged_yesterday_hours,
  false as is_assignee,
  false as finished_yesterday,
  tk.updated_at,
  coalesce(proj.name, jp.name) as project_name
from worklogs w
join tickets tk on tk.id = w.ticket_id
join sprints s on s.id = tk.sprint_id and s.is_tracked
join people p on p.id = w.author_person_id
left join status_mapping sm on sm.jira_status = tk.status
left join epics e on e.id = tk.epic_id
left join projects proj on proj.id = e.project_id
left join jira_projects jp on jp.id = tk.jira_project_id
where w.author_person_id is not null
  and w.author_person_id is distinct from tk.assignee_person_id
  and (w.started_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date, w.author_person_id)
  and tk.status_category in ('new', 'indeterminate', 'done')
group by w.author_person_id, p.name, tk.jira_key, tk.summary, sm.ui_bucket, tk.status, tk.status_category,
  tk.priority, tk.is_blocked, tk.original_estimate_seconds, tk.remaining_estimate_seconds, tk.updated_at,
  proj.name, jp.name;
