-- Backing store for the "Executive Compass" dashboard (a separate,
-- Jira-jargon-free app for CEOs/leadership -- see summit-read repo).
-- That dashboard is explicitly NOT allowed to show tickets, statuses,
-- estimates or employee names, so it can't read the engineering-facing
-- tables directly. This migration adds the two tables that hold the
-- LLM-generated business-language narrative those pages need, plus the
-- small numeric extensions the Sprint Capacity Summary / Team
-- Utilisation widgets need that don't exist elsewhere.
--
-- project_narratives is upserted per project each sync (superseding the
-- never-populated project_summaries table). org_narrative is append-only
-- like person_metrics_history, so the frontend always reads the latest
-- row -- kept as history in case a past executive summary needs
-- revisiting.

create table project_narratives (
  project_id uuid primary key references projects (id) on delete cascade,
  benefit text not null,
  why text not null,
  problem text not null,
  delivered text not null,
  this_sprint text not null,
  next_milestone text not null,
  delivered_features_this_sprint text[] not null default '{}',
  delivery_history jsonb not null default '[]',
  timeline jsonb not null default '[]',
  exec_risks jsonb not null default '[]',
  generated_at timestamptz not null default now()
);

create table org_narrative (
  id uuid primary key default gen_random_uuid(),
  executive_summary text not null,
  top_risks jsonb not null default '[]',
  generated_at timestamptz not null default now()
);

alter table project_narratives enable row level security;
alter table org_narrative enable row level security;
create policy project_narratives_read_all on project_narratives for select using (true);
create policy org_narrative_read_all on org_narrative for select using (true);

-- v_org_metrics depends on v_projects_overview (total_spillage_hours),
-- so both must be dropped before either is recreated, and
-- v_projects_overview must be recreated first.
drop view if exists v_org_metrics;
drop view if exists v_projects_overview;

-- v_projects_overview: add started_at, the real Jira start of the
-- project's work -- min(created_at) across all its epics/tickets, not
-- projects.created_at (which is just when the sync first inserted the
-- row, often long after the underlying Jira work actually began).
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
  select
    min(least(e.created_at, tk.created_at)) as started_at,
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

-- Sprint Capacity Summary needs "Total Productive Hours" (hours actually
-- logged) and "Allocated Hours" (hours committed this sprint) alongside
-- the avg_utilisation/available_hours/total_spillage_hours this view
-- already has.
create view v_org_metrics as
select
  (select round(avg(utilisation_pct)) from person_metrics) as avg_utilisation,
  (select coalesce(sum(greatest(bandwidth_hours, 0)), 0) from person_metrics) as available_hours,
  (select coalesce(round(sum(hours_logged), 1), 0) from person_metrics) as total_productive_hours,
  (select coalesce(round(sum(sprint_target_hours), 1), 0) from person_metrics) as total_allocated_hours,
  (select count(*) from person_metrics where utilisation_pct > 100) as overallocated_count,
  (select count(*) from projects where is_current and health != 'on_track') as at_risk_projects,
  (select count(*) from projects where is_current) as active_projects,
  (select round(avg(estimate_coverage)) from person_metrics) as estimate_coverage,
  (select blocked_tickets::bigint from board_health where scope_type = 'org' order by computed_at desc limit 1) as blocked_count,
  (select coalesce(sum(dark_wip_count), 0) from person_metrics) as dark_wip,
  (select count(*) from tickets where status_category = 'done' and time_spent_seconds = 0 and original_estimate_seconds is not null) as closed_without_logs,
  (select board_health_score from board_health where scope_type = 'org' order by computed_at desc limit 1) as board_health_score,
  (select coalesce(round(sum(spillage_hours), 1), 0) from v_projects_overview where is_current and project_space != 'infra') as total_spillage_hours;

-- Team Utilisation widget: capacity used % and available hours, bucketed
-- into the same three business-facing groups v_projects_overview's
-- project_space already uses (0020_project_space_telephony.sql) --
-- Development / Infrastructure / Telephony -- rather than the 5 raw
-- `teams` rows, which are actually named after their originating Jira
-- board (e.g. "Team-PixelBlinders", "Team RUMA GPT") and would leak
-- Jira-facing names into an executive-only dashboard.
create view v_team_utilisation as
select
  case
    when t.name = 'Team - Infrastructure' then 'Infrastructure'
    when t.name = 'Team - Telephony' then 'Telephony'
    else 'Development'
  end as team,
  round(avg(pm.utilisation_pct)) as capacity_used,
  coalesce(sum(greatest(pm.bandwidth_hours, 0)), 0) as available_hours
from teams t
join people p on p.team_id = t.id and p.excluded = false
join person_metrics pm on pm.person_id = p.id
group by 1;
