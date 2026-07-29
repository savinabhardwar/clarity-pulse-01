-- Predicts how many hours of a project's currently-open work won't be
-- finished by the tracked sprint's end date and will spill into the next
-- one: remaining estimate hours minus a projected capacity for the days
-- left, where projected capacity is the team's OWN observed burn rate
-- this sprint (hours actually logged so far / elapsed workdays),
-- projected forward over the remaining workdays -- not a flat assumed
-- rate, since actual pace is more predictive of what really gets done.
-- Rolled up per dashboard project across each of its real tracked
-- sprints (a project can span more than one Jira board/sprint).

create or replace function workdays_between(from_date date, to_date date)
returns integer
language sql
immutable
as $$
  select coalesce(count(*), 0)::integer
  from generate_series(from_date + 1, to_date, interval '1 day') d
  where extract(dow from d) not in (0, 6)
$$;

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
  coalesce(infra.is_infra, false) as is_infra,
  ps.summary_text,
  coalesce(agg.hours_invested, 0) as hours_invested,
  coalesce(agg.hours_this_sprint, 0) as hours_this_sprint,
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
  -- Lifetime totals from ALL tickets under this project's epics, not just
  -- the current sprint's assignee list -- otherwise a leaver's or a
  -- finished contributor's closed work silently vanishes from the total.
  select
    round(sum(tk.time_spent_seconds) / 3600.0, 1) as hours_invested,
    round(sum(tk.time_spent_seconds) filter (where tk.sprint_id is not null and s.is_tracked) / 3600.0, 1) as hours_this_sprint,
    count(*) filter (where tk.status_category != 'done') as open_tickets,
    count(*) filter (where tk.status_category = 'done') as closed_tickets,
    count(*) filter (where tk.is_blocked and tk.status_category != 'done') as blocked_tickets,
    round(sum(tk.remaining_estimate_seconds) filter (where tk.status_category != 'done') / 3600.0, 1) as remaining_estimate_hours
  from tickets tk
  join epics e on e.id = tk.epic_id
  left join sprints s on s.id = tk.sprint_id
  where e.project_id = proj.id
) agg on true
left join lateral (
  select count(*) as contributor_count from project_contributors pc where pc.project_id = proj.id
) contrib on true
left join lateral (
  select
    count(*) > 0 and count(*) filter (where jp.jira_key != 'TI') = 0 as is_infra
  from project_jira_projects pjp
  join jira_projects jp on jp.id = pjp.jira_project_id
  where pjp.project_id = proj.id
) infra on true
left join lateral (
  select round(coalesce(sum(
    greatest(
      per_sprint.remaining_hours - case
        when per_sprint.elapsed_workdays = 0 then 0
        else (per_sprint.logged_hours / per_sprint.elapsed_workdays) * per_sprint.remaining_workdays
      end,
      0
    )
  ), 0)::numeric, 1) as spillage_hours
  from (
    select
      s.id,
      sum(tk.remaining_estimate_seconds) filter (where tk.status_category != 'done') / 3600.0 as remaining_hours,
      sum(tk.time_spent_seconds) / 3600.0 as logged_hours,
      workdays_between(s.start_date::date, current_date) as elapsed_workdays,
      workdays_between(current_date, s.end_date::date) as remaining_workdays
    from tickets tk
    join epics e on e.id = tk.epic_id
    join sprints s on s.id = tk.sprint_id
    where e.project_id = proj.id and s.is_tracked and s.start_date is not null and s.end_date is not null
    group by s.id
  ) per_sprint
) spill on true;

-- Org-wide total for the Overview KPI: sum of spillage across all
-- currently active Development-tab projects (infra clusters excluded --
-- they're not sprint-tracked product work in the same sense).
create or replace view v_org_metrics as
select
  (select round(avg(utilisation_pct)) from person_metrics) as avg_utilisation,
  (select coalesce(sum(greatest(bandwidth_hours, 0)), 0) from person_metrics) as available_hours,
  (select count(*) from person_metrics where utilisation_pct > 100) as overallocated_count,
  (select count(*) from projects where is_current and health != 'on_track') as at_risk_projects,
  (select count(*) from projects where is_current) as active_projects,
  (select round(avg(estimate_coverage)) from person_metrics) as estimate_coverage,
  (select blocked_tickets::bigint from board_health where scope_type = 'org' order by computed_at desc limit 1) as blocked_count,
  (select coalesce(sum(dark_wip_count), 0) from person_metrics) as dark_wip,
  (select count(*) from tickets where status_category = 'done' and time_spent_seconds = 0 and original_estimate_seconds is not null) as closed_without_logs,
  (select board_health_score from board_health where scope_type = 'org' order by computed_at desc limit 1) as board_health_score,
  (select coalesce(round(sum(spillage_hours), 1), 0) from v_projects_overview where is_current and not is_infra) as total_spillage_hours;
