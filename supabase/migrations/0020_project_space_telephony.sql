-- Replaces the two-way `is_infra` boolean on v_projects_overview with a
-- three-way `project_space` text bucket so the Projects page can offer a
-- third "Telephony" tab alongside Development and Infra.
--
-- A dashboard "project" is a cluster of Jira epics that can span more than
-- one Jira board, so the bucket is decided by which boards ALL of its
-- linked jira_projects belong to:
--   'infra'      -- every linked jira_project is Team - Infrastructure (TI):
--                   individual network/hardware/ops tickets auto-clustered
--                   into their own "project" each, not product initiatives.
--   'telephony'  -- every linked jira_project is Team - Telephony (TT).
--   'development'-- everything else: projects spanning boards, projects on
--                   TEAM / TEAMSANKYA / TRG, and projects with no
--                   jira_project link at all (source = 'roadmap', manually
--                   inserted).
-- The three buckets are mutually exclusive and total by construction --
-- a single case expression assigns exactly one value per row, so no
-- project can land in zero or two tabs (the failure mode a parallel
-- is_infra / is_telephony pair of booleans would have allowed).
--
-- `is_infra` is dropped rather than kept alongside, so there is only one
-- source of truth for the classification.
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
-- currently active sprint-tracked projects. Infra clusters stay excluded
-- (they're not sprint-tracked product work in the same sense); telephony
-- projects ARE real board-tracked product work, so they keep counting
-- towards the KPI exactly as they did before this migration split them
-- out into their own tab -- the number must not move just because the UI
-- gained a tab.
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
  (select coalesce(round(sum(spillage_hours), 1), 0) from v_projects_overview where is_current and project_space != 'infra') as total_spillage_hours;
