-- Bug (reported live): if person A logs time on a ticket, then it gets
-- reassigned to person B who also logs time, the People board showed the
-- ticket ONCE -- under B, the current assignee -- with 'logged' equal to
-- the SUM of every author's worklog seconds on that ticket (A's hours
-- silently folded into B's card). A's own contribution disappeared
-- entirely once they were no longer the assignee.
--
-- Root cause: get_person_detail's 'current'/'upcoming'/'completedThisSprint'
-- blocks filter tickets by `tk.assignee_person_id = p.id` (correct -- that's
-- "whose board is this"), but then sum 'logged' with
-- `where w.ticket_id = tk.id` only -- no `w.author_person_id = p.id` filter.
-- That's the one field on this RPC that's supposed to be personal (contrast
-- 'totalLogged', which is deliberately ticket-wide -- Jira's own lifetime
-- total -- and 'loggedYesterday', which is deliberately author-agnostic per
-- its comment in queries.ts, both left untouched here).
--
-- Fix, two parts:
-- 1. 'logged' now sums only worklogs authored by this person (matches how
--    person_metrics/v_person_sprint_summaries already attribute hours --
--    see 0030_exclude_worklog_authors.sql).
-- 2. A ticket now also appears on a person's board if THEY logged time on
--    it this sprint, even if they're no longer the assignee -- so a
--    handed-off ticket shows up on both A's and B's board, each showing
--    only their own hours. 'isAssignee' flags which one currently owns it
--    in Jira, so the UI can label the other as a handoff instead of
--    implying they still own it.
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

-- Same fix for the Daily Standup view's per-ticket "yesterday" number --
-- v_standup_tickets only ever emitted one row per ticket (keyed off
-- assignee_person_id), summing ALL authors' worklog seconds into it. Now
-- it's a union: the assignee's own row (is_assignee = true, hours scoped to
-- their own worklogs) plus one extra row per OTHER person who also logged
-- time on that ticket yesterday (is_assignee = false), so a handoff shows
-- up under both people with their own hours instead of one inflated row
-- under whoever holds the ticket right now.
-- Column order changes (new is_assignee column inserted before
-- finished_yesterday) -- `create or replace view` can't reorder/insert
-- columns in place, so drop and recreate. No frontend reads this view yet
-- (grepped team-pulse-54/src), so there's nothing to break.
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
      and (w.started_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date)
  ), 0) / 3600.0, 1) as logged_yesterday_hours,
  true as is_assignee,
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
  and (w.started_at at time zone 'Asia/Kolkata')::date = last_business_day((now() at time zone 'Asia/Kolkata')::date)
  and tk.status_category in ('new', 'indeterminate', 'done')
group by w.author_person_id, p.name, tk.jira_key, tk.summary, sm.ui_bucket, tk.status, tk.status_category,
  tk.priority, tk.is_blocked, tk.original_estimate_seconds, tk.remaining_estimate_seconds, tk.updated_at,
  proj.name, jp.name;
