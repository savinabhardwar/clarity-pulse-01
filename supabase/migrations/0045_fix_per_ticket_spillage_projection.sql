-- Spillage (v_projects_overview, v_exec_capacity) projected each
-- ticket's future logging individually: that ticket's own
-- sprint_logged_hours / elapsed_workdays * remaining_workdays. Since
-- people work tickets sequentially rather than all at once, ANY ticket
-- nobody has personally logged hours against yet -- completely normal
-- early in a sprint, or just not yet picked up -- has a per-ticket pace
-- of exactly 0/elapsed = 0, so its ENTIRE remaining estimate counted as
-- "spillage" regardless of how much time is actually left or how well
-- the project/team is pacing overall. Confirmed live: on day 2 of a
-- 9-workday sprint, "AVANI" showed spillage_hours (74.5) identical to
-- its full remaining_estimate_hours (74.5), despite 18h already logged
-- against the project that sprint -- just not against every individual
-- ticket yet.
--
-- Fix: aggregate remaining hours and logged hours at the project (or
-- team) level FIRST, across all its tickets in that sprint, then compute
-- ONE burn rate and ONE projected-spillage number per sprint -- not one
-- per ticket. A project/team's overall velocity is a far more stable
-- signal of whether its remaining work will land by sprint end than any
-- single not-yet-started ticket's individual (and often zero) pace.
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
  coalesce(inv_wl.hours_invested, 0) as hours_invested,
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
    count(*) filter (where tk.status_category != 'done') as open_tickets,
    count(*) filter (where tk.status_category = 'done') as closed_tickets,
    count(*) filter (where tk.is_blocked and tk.status_category != 'done') as blocked_tickets,
    round(sum(tk.remaining_estimate_seconds) filter (where tk.status_category != 'done') / 3600.0, 1) as remaining_estimate_hours
  from tickets tk
  join epics e on e.id = tk.epic_id
  where e.project_id = proj.id
) agg on true
left join lateral (
  select round(coalesce(sum(wl.seconds), 0) / 3600.0, 1) as hours_invested
  from tickets tk
  join epics e on e.id = tk.epic_id
  join worklogs wl on wl.ticket_id = tk.id
  join people p on p.id = wl.author_person_id and not p.excluded
  where e.project_id = proj.id
) inv_wl on true
left join lateral (
  select round(coalesce(sum(wl.seconds), 0) / 3600.0, 1) as hours_this_sprint
  from tickets tk
  join epics e on e.id = tk.epic_id
  join sprints s on s.id = tk.sprint_id and s.is_tracked and s.start_date is not null and s.end_date is not null
  join worklogs wl on wl.ticket_id = tk.id and wl.started_at >= s.start_date and wl.started_at <= s.end_date
  join people p on p.id = wl.author_person_id and not p.excluded
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
  -- Spillage projection, aggregated per sprint across ALL of this
  -- project's tickets in it (not per ticket -- see migration header).
  select round(coalesce(sum(
    greatest(
      sprint_totals.total_remaining_hours - case
        when sprint_totals.elapsed_workdays = 0 then 0
        else (sprint_totals.total_sprint_logged_hours / sprint_totals.elapsed_workdays) * sprint_totals.remaining_workdays
      end,
      0
    )
  ), 0)::numeric, 1) as spillage_hours
  from (
    select
      s.id as sprint_id,
      sum(case when tk.status_category != 'done' then coalesce(tk.remaining_estimate_seconds, 0) else 0 end) / 3600.0 as total_remaining_hours,
      sum(coalesce(tk_logged.seconds, 0)) / 3600.0 as total_sprint_logged_hours,
      workdays_between(s.start_date::date, current_date) as elapsed_workdays,
      workdays_between(current_date, s.end_date::date) as remaining_workdays
    from tickets tk
    join epics e on e.id = tk.epic_id
    join sprints s on s.id = tk.sprint_id
    left join lateral (
      select sum(wl.seconds) as seconds
      from worklogs wl
      join people p on p.id = wl.author_person_id and not p.excluded
      where wl.ticket_id = tk.id and wl.started_at >= s.start_date and wl.started_at <= s.end_date
    ) tk_logged on true
    where e.project_id = proj.id and s.is_tracked and s.start_date is not null and s.end_date is not null
      and (tk.original_estimate_seconds is null or tk.original_estimate_seconds <= 144000)
    group by s.id, s.start_date, s.end_date
  ) sprint_totals
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

-- v_exec_capacity's team-level spillage had the identical per-ticket bug.
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
    join people p on p.id = w.author_person_id and not p.excluded
    where w.ticket_id = tk.id and w.started_at >= s.start_date and w.started_at <= s.end_date
  ) sprint_wl on true
  where tk.original_estimate_seconds is null or tk.original_estimate_seconds <= 144000
  group by tb.team
),
-- Aggregated per (team, sprint) across all that team's tickets in it,
-- not per ticket -- same fix as v_projects_overview above.
team_sprint_totals as (
  select tb.team, s.id as sprint_id,
    sum(case when tk.status_category != 'done' then coalesce(tk.remaining_estimate_seconds, 0) else 0 end) / 3600.0 as total_remaining_hours,
    sum(coalesce(tk_logged.seconds, 0)) / 3600.0 as total_sprint_logged_hours,
    workdays_between(s.start_date::date, current_date) as elapsed_workdays,
    workdays_between(current_date, s.end_date::date) as remaining_workdays
  from tickets tk
  join sprints s on s.id = tk.sprint_id and s.is_tracked and s.start_date is not null and s.end_date is not null
  join team_bucket tb on tb.person_id = tk.assignee_person_id
  left join lateral (
    select sum(w.seconds) as seconds from worklogs w
    join people p on p.id = w.author_person_id and not p.excluded
    where w.ticket_id = tk.id and w.started_at >= s.start_date and w.started_at <= s.end_date
  ) tk_logged on true
  where tk.original_estimate_seconds is null or tk.original_estimate_seconds <= 144000
  group by tb.team, s.id, s.start_date, s.end_date
),
spillage as (
  select team,
    round(coalesce(sum(
      greatest(
        total_remaining_hours - case
          when elapsed_workdays = 0 then 0
          else (total_sprint_logged_hours / elapsed_workdays) * remaining_workdays
        end,
        0
      )
    ), 0)::numeric, 1) as spillage_hours
  from team_sprint_totals
  group by team
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
