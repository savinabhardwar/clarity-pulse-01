-- Executive Compass dashboard (summit-read) needs numbers this schema
-- doesn't yet expose cleanly: a single org-wide sprint capacity figure
-- (7h/day x working days x headcount) despite 5 non-aligned Jira board
-- sprints, lifetime engineering investment with a fallback for tickets
-- that were never estimated, per-project team-member names, and a
-- last-worked-on timestamp to sort "active" projects to the top. It also
-- fixes two spots where `people.excluded` was documented but not actually
-- enforced -- v_org_metrics summed straight from person_metrics with no
-- join back to people, and v_project_team_hours (0026) joined people but
-- never filtered on the flag.

-- ---------------------------------------------------------------------
-- 1. Fix: excluded people were leaking into v_org_metrics + team hours
-- ---------------------------------------------------------------------

create or replace view v_org_metrics as
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

create or replace view v_project_team_hours as
select
  e.project_id,
  case
    when t.name = 'Team - Infrastructure' then 'Infrastructure'
    when t.name = 'Team - Telephony' then 'Telephony'
    else 'Development'
  end as team,
  round(sum(w.seconds) / 3600.0, 1) as hours
from worklogs w
join tickets tk on tk.id = w.ticket_id
join epics e on e.id = tk.epic_id
join people p on p.id = w.author_person_id
left join teams t on t.id = p.team_id
where e.project_id is not null and not p.excluded
group by e.project_id, 2;

-- ---------------------------------------------------------------------
-- 2. Canonical org sprint window
-- ---------------------------------------------------------------------
-- The 5 Jira boards (TEAM/TI/TEAMSANKYA/TT/TRG) run independent,
-- non-aligned sprints, so there is no single "the sprint" to point at.
-- For an org-wide capacity number, pick the currently-active tracked
-- sprint whose length is closest to the org's actual policy -- a 2-week,
-- Monday-to-Friday, 10-workday sprint -- rather than an arbitrary board.
-- `workdays_between` (0019) counts strictly AFTER its `from_date`, so
-- start_date - 1 day makes the count inclusive of the sprint's own first
-- day (matching scripts/jira-sync/lib/workdays.mjs's workdaysInclusive).
create or replace view v_canonical_sprint as
select
  s.*,
  workdays_between(s.start_date::date - 1, s.end_date::date) as total_workdays
from sprints s
where s.is_tracked
  and s.start_date is not null and s.end_date is not null
  and current_date between s.start_date::date and s.end_date::date
order by abs(workdays_between(s.start_date::date - 1, s.end_date::date) - 10) asc, s.end_date desc
limit 1;

-- ---------------------------------------------------------------------
-- 3. Sprint capacity KPI cards, per business team and org-wide
-- ---------------------------------------------------------------------
-- Total Productive Hours is a capacity CEILING: 7h/day x the canonical
-- sprint's own workday count x headcount, per business team bucket
-- (same Development/Infrastructure/Telephony grouping v_team_utilisation
-- uses). Allocated/spillage are real committed work, so unlike the
-- ceiling they're pulled from EVERY board's own currently-tracked sprint
-- (not just the canonical one) -- work is genuinely happening on all 5
-- boards at once, the canonical window only supplies the day-count for
-- the ceiling. Excludes people.excluded=true throughout.
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
  -- Hours committed to tasks in whichever sprint each ticket's own board
  -- is currently tracking: original estimate, falling back to time
  -- already logged for tickets nobody ever estimated.
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

-- Org-wide rollup for the top-line KPI cards (summed, not averaged, so
-- capacity_used_pct reflects the combined total rather than 3 team %s).
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

-- ---------------------------------------------------------------------
-- 4. Lifetime Engineering Investment, with an estimate-fallback tag
-- ---------------------------------------------------------------------
-- Per ticket: original estimate where it exists; otherwise the actual
-- worklog hours logged against it (who worked on it, and for how long)
-- as the best available stand-in. `includes_estimated_hours` flags the
-- project whenever at least one of its tickets had no original estimate
-- and had to fall back, so the UI can show an "estimated" tag.
create or replace view v_project_investment_lifetime as
select
  proj.id as project_id,
  round(sum(coalesce(tk.original_estimate_seconds, fallback.logged_seconds, 0)) / 3600.0, 1) as investment_hours,
  bool_or(tk.original_estimate_seconds is null) as includes_estimated_hours
from projects proj
join epics e on e.project_id = proj.id
join tickets tk on tk.epic_id = e.id
left join lateral (
  select sum(w.seconds) as logged_seconds from worklogs w where w.ticket_id = tk.id
) fallback on true
group by proj.id;

-- ---------------------------------------------------------------------
-- 5. Per-project last-worked-on date + this-sprint activity flag
-- ---------------------------------------------------------------------
-- "Last worked on" = the most recent worklog OR comment timestamp across
-- any ticket under the project, so Project Portfolio can sort active
-- projects to the top by real recency rather than a static flag.
create or replace view v_project_activity as
select
  proj.id as project_id,
  greatest(
    (select max(w.started_at) from worklogs w join tickets tk on tk.id = w.ticket_id join epics e on e.id = tk.epic_id where e.project_id = proj.id),
    (select max(c.created_at) from ticket_comments c join tickets tk on tk.id = c.ticket_id join epics e on e.id = tk.epic_id where e.project_id = proj.id)
  ) as last_activity_at,
  exists (
    select 1 from tickets tk join epics e on e.id = tk.epic_id join sprints s on s.id = tk.sprint_id
    where e.project_id = proj.id and s.is_tracked
  ) as active_this_sprint
from projects proj;

-- ---------------------------------------------------------------------
-- 6. Team members working on each project (names only, per instruction
--    that the exec dashboard never shows ticket-level detail)
-- ---------------------------------------------------------------------
create or replace view v_project_team_members as
select pc.project_id, array_agg(distinct p.name order by p.name) as member_names
from project_contributors pc
join people p on p.id = pc.person_id
where not p.excluded and (pc.hours > 0 or pc.pct > 0)
group by pc.project_id;
