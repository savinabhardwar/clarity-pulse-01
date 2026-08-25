-- "Hours this sprint" and "Allocated hours" were both counting a
-- spilled-over ticket's WHOLE lifetime logged time (or its whole original
-- estimate) against the CURRENT sprint, even when most of that time was
-- actually logged weeks ago in an earlier sprint the ticket carried over
-- from. Two corrections, applied everywhere a "this sprint" figure is
-- computed:
--
-- 1. Hours actually logged this sprint = worklogs whose OWN started_at
--    falls inside the sprint's [start_date, end_date] window, not the
--    ticket's all-time time_spent_seconds. A ticket sitting in Sprint 10
--    that was worked on in Sprint 8 and 9 only counts the Sprint-10-dated
--    worklog seconds.
-- 2. Hours committed (allocated) this sprint = the ticket's REMAINING
--    estimate, not its original estimate -- a 2-day ticket that's 50%
--    done should only count as 1 day of remaining commitment, which is
--    exactly what remaining_estimate_seconds already tracks (Jira
--    decrements it as work is logged / the assignee updates it).
--
-- Both apply only to tickets with original_estimate_seconds <= 144000
-- (5 workdays at Jira's standard 8h/day estimate convention -- NOT this
-- org's 7h/day capacity policy, since original_estimate was entered by
-- estimators against Jira's own day length, not the KPI cards' policy
-- constant). Anything estimated bigger than that is a multi-sprint effort
-- that shouldn't be judged against a single sprint's capacity, so it's
-- excluded from these calculations entirely -- not zeroed, dropped.
-- Tickets with NO estimate are never excluded by this rule (there's
-- nothing to compare against 5 days), they just use the worklog-date
-- fallback.

drop view if exists v_org_metrics;
drop view if exists v_projects_overview;

create view v_projects_overview as
select
  proj.id,
  proj.slug,
  proj.name,
  proj.color,
  proj.purpose,
  proj.health,
  proj.progress,
  proj.sprint_goal,
  owner.name as owner_name,
  proj.is_current,
  proj.source,
  coalesce(space.project_space, 'development') as project_space,
  ps.summary_text,
  agg.started_at,
  coalesce(agg.hours_invested, 0) as hours_invested,
  coalesce(sprint_hrs.hours_this_sprint, 0) as hours_this_sprint,
  coalesce(agg.open_tickets, 0) as open_tickets,
  coalesce(agg.closed_tickets, 0) as closed_tickets,
  coalesce(agg.blocked_tickets, 0) as blocked_tickets,
  coalesce(agg.remaining_estimate_hours, 0) as remaining_estimate_hours,
  coalesce(contrib.contributor_count, 0) as contributor_count,
  coalesce(spill.spillage_hours, 0) as spillage_hours
from projects proj
left join people owner on owner.id = proj.owner_person_id
left join project_summaries ps on ps.project_id = proj.id
left join lateral (
  select
    min(least(e.created_at, tk.created_at)) as started_at,
    round(sum(tk.time_spent_seconds) / 3600.0, 1) as hours_invested,
    count(*) filter (where tk.status_category != 'done') as open_tickets,
    count(*) filter (where tk.status_category = 'done') as closed_tickets,
    count(*) filter (where tk.is_blocked and tk.status_category != 'done') as blocked_tickets,
    round(sum(tk.remaining_estimate_seconds) filter (where tk.status_category != 'done') / 3600.0, 1) as remaining_estimate_hours
  from tickets tk
  join epics e on e.id = tk.epic_id
  where e.project_id = proj.id
) agg on true
left join lateral (
  -- Actual hours logged DURING the tracked sprint's own date window, for
  -- tickets currently sitting in it -- excludes worklogs the ticket
  -- accumulated in earlier sprints before it spilled over.
  select round(coalesce(sum(wl.seconds), 0) / 3600.0, 1) as hours_this_sprint
  from tickets tk
  join epics e on e.id = tk.epic_id
  join sprints s on s.id = tk.sprint_id and s.is_tracked and s.start_date is not null and s.end_date is not null
  join worklogs wl on wl.ticket_id = tk.id and wl.started_at >= s.start_date and wl.started_at <= s.end_date
  where e.project_id = proj.id
    and (tk.original_estimate_seconds is null or tk.original_estimate_seconds <= 144000)
) sprint_hrs on true
left join lateral (
  select count(*) as contributor_count from project_contributors pc where pc.project_id = proj.id
) contrib on true
left join lateral (
  select case
    when count(*) = 0 then 'development'
    when count(*) filter (where jp.jira_key != 'TI') = 0 then 'infra'
    when count(*) filter (where jp.jira_key != 'TT') = 0 then 'telephony'
    else 'development'
  end as project_space
  from project_jira_projects pjp
  join jira_projects jp on jp.id = pjp.jira_project_id
  where pjp.project_id = proj.id
) space on true
left join lateral (
  -- Spillage projection, using the same sprint-window-scoped burn rate
  -- (not lifetime time_spent) and excluding >5-workday-estimated tickets.
  select round(coalesce(sum(
    greatest(
      (per_sprint.remaining_hours) - case
        when per_sprint.elapsed_workdays = 0 then 0
        else (per_sprint.sprint_logged_hours / per_sprint.elapsed_workdays) * per_sprint.remaining_workdays
      end,
      0
    )
  ), 0)::numeric, 1) as spillage_hours
  from (
    select
      tk.id,
      s.id as sprint_id,
      sum(tk.remaining_estimate_seconds) filter (where tk.status_category != 'done') / 3600.0 as remaining_hours,
      coalesce((
        select sum(wl.seconds) from worklogs wl
        where wl.ticket_id = tk.id and wl.started_at >= s.start_date and wl.started_at <= s.end_date
      ), 0) / 3600.0 as sprint_logged_hours,
      workdays_between(s.start_date::date, current_date) as elapsed_workdays,
      workdays_between(current_date, s.end_date::date) as remaining_workdays
    from tickets tk
    join epics e on e.id = tk.epic_id
    join sprints s on s.id = tk.sprint_id
    where e.project_id = proj.id and s.is_tracked and s.start_date is not null and s.end_date is not null
      and (tk.original_estimate_seconds is null or tk.original_estimate_seconds <= 144000)
    group by tk.id, s.id, s.start_date, s.end_date
  ) per_sprint
) spill on true;

create view v_org_metrics as
select
  (select round(avg(pm.utilisation_pct)) from person_metrics pm join people p on p.id = pm.person_id where not p.excluded) as avg_utilisation,
  (select coalesce(sum(greatest(pm.bandwidth_hours, 0)), 0) from person_metrics pm join people p on p.id = pm.person_id where not p.excluded) as available_hours,
  (select coalesce(round(sum(pm.hours_logged), 1), 0) from person_metrics pm join people p on p.id = pm.person_id where not p.excluded) as total_productive_hours,
  (select coalesce(round(sum(pm.sprint_target_hours), 1), 0) from person_metrics pm join people p on p.id = pm.person_id where not p.excluded) as total_allocated_hours,
  (select count(*) from person_metrics pm join people p on p.id = pm.person_id where not p.excluded and pm.utilisation_pct > 100) as overallocated_count,
  (select count(*) from projects where is_current and health != 'on_track') as at_risk_projects,
  (select count(*) from projects where is_current) as active_projects,
  (select round(avg(pm.estimate_coverage)) from person_metrics pm join people p on p.id = pm.person_id where not p.excluded) as estimate_coverage,
  (select blocked_tickets::bigint from board_health where scope_type = 'org' order by computed_at desc limit 1) as blocked_count,
  (select coalesce(sum(pm.dark_wip_count), 0) from person_metrics pm join people p on p.id = pm.person_id where not p.excluded) as dark_wip,
  (select count(*) from tickets where status_category = 'done' and time_spent_seconds = 0 and original_estimate_seconds is not null) as closed_without_logs,
  (select board_health_score from board_health where scope_type = 'org' order by computed_at desc limit 1) as board_health_score,
  (select coalesce(round(sum(spillage_hours), 1), 0) from v_projects_overview where is_current and project_space != 'infra') as total_spillage_hours;

-- v_exec_capacity: allocated = remaining estimate (pro-rated for partially
-- done work) where an estimate exists, else worklog seconds actually dated
-- within the sprint window. Excludes >5-workday-estimated tickets outright.
create or replace view v_exec_capacity as
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
    round(sum(
      case
        when tk.original_estimate_seconds is not null then
          case when tk.status_category = 'done' then 0 else coalesce(tk.remaining_estimate_seconds, 0) end
        else coalesce(sprint_wl.seconds, 0)
      end
    ) / 3600.0, 1) as allocated_hours
  from tickets tk
  join sprints s on s.id = tk.sprint_id and s.is_tracked and s.start_date is not null and s.end_date is not null
  join team_bucket tb on tb.person_id = tk.assignee_person_id
  left join lateral (
    select sum(w.seconds) as seconds from worklogs w
    where w.ticket_id = tk.id and w.started_at >= s.start_date and w.started_at <= s.end_date
  ) sprint_wl on true
  where tk.original_estimate_seconds is null or tk.original_estimate_seconds <= 144000
  group by tb.team
),
spillage as (
  select tb.team,
    round(coalesce(sum(
      greatest(
        (tk.remaining_estimate_seconds / 3600.0) - case
          when workdays_between(s.start_date::date, current_date) = 0 then 0
          else (coalesce(sprint_wl2.seconds, 0) / 3600.0 / workdays_between(s.start_date::date, current_date)) * workdays_between(current_date, s.end_date::date)
        end,
        0
      )
    ) filter (where tk.status_category != 'done'), 0)::numeric, 1) as spillage_hours
  from tickets tk
  join sprints s on s.id = tk.sprint_id and s.is_tracked and s.start_date is not null and s.end_date is not null
  join team_bucket tb on tb.person_id = tk.assignee_person_id
  left join lateral (
    select sum(w.seconds) as seconds from worklogs w
    where w.ticket_id = tk.id and w.started_at >= s.start_date and w.started_at <= s.end_date
  ) sprint_wl2 on true
  where tk.original_estimate_seconds is null or tk.original_estimate_seconds <= 144000
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

create or replace view v_exec_capacity_org as
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
