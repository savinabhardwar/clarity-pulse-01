-- Reporting views: the frontend selects from these directly. All
-- business logic (dark WIP, clustering, pace, etc.) is precomputed by
-- the sync script into the base tables above; these views just shape
-- and join that already-computed data for consumption.

create view v_people_overview as
select
  p.id,
  p.name,
  p.role,
  t.name as team,
  p.team_guessed,
  pm.utilisation_pct,
  pm.bandwidth_hours,
  pm.hours_logged,
  pm.estimated_hours,
  pm.velocity,
  pm.estimate_accuracy,
  pm.estimate_coverage,
  pm.worklog_count,
  pm.comment_count,
  pm.idle_workdays,
  pm.dark_wip_count,
  pm.health,
  pm.risk_flags,
  pm.computed_at
from people p
join person_metrics pm on pm.person_id = p.id
left join teams t on t.id = p.team_id
where p.excluded = false;

create view v_person_allocations as
select
  pc.person_id,
  pc.project_id,
  proj.name as project_name,
  proj.color as project_color,
  pc.pct,
  pc.hours
from project_contributors pc
join projects proj on proj.id = pc.project_id;

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
  ps.summary_text,
  coalesce(agg.hours_invested, 0) as hours_invested,
  coalesce(agg.hours_this_sprint, 0) as hours_this_sprint,
  coalesce(agg.open_tickets, 0) as open_tickets,
  coalesce(agg.closed_tickets, 0) as closed_tickets,
  coalesce(agg.blocked_tickets, 0) as blocked_tickets,
  coalesce(agg.remaining_estimate_hours, 0) as remaining_estimate_hours,
  coalesce(contrib.contributor_count, 0) as contributor_count
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
) contrib on true;

create view v_org_metrics as
select
  (select round(avg(utilisation_pct)) from person_metrics) as avg_utilisation,
  (select coalesce(sum(greatest(bandwidth_hours, 0)), 0) from person_metrics) as available_hours,
  (select count(*) from person_metrics where utilisation_pct > 100) as overallocated_count,
  (select count(*) from projects where is_current and health != 'on_track') as at_risk_projects,
  (select count(*) from projects where is_current) as active_projects,
  (select round(avg(estimate_coverage)) from person_metrics) as estimate_coverage,
  (select count(*) from risks where category = 'blocked_project' and status = 'open') as blocked_count,
  (select coalesce(sum(dark_wip_count), 0) from person_metrics) as dark_wip,
  (select count(*) from tickets where status_category = 'done' and time_spent_seconds = 0 and original_estimate_seconds is not null) as closed_without_logs,
  (select board_health_score from board_health where scope_type = 'org' order by computed_at desc limit 1) as board_health_score;

create view v_all_blockers as
select
  tk.id as ticket_id,
  tk.jira_key,
  tk.summary,
  tk.priority,
  tk.updated_at,
  proj.id as project_id,
  proj.slug as project_slug,
  proj.name as project_name,
  assignee.name as owner_name,
  extract(day from now() - tk.updated_at)::int as days_blocked
from tickets tk
join epics e on e.id = tk.epic_id
join projects proj on proj.id = e.project_id
left join people assignee on assignee.id = tk.assignee_person_id
where tk.is_blocked and tk.status_category != 'done';

create view v_standouts as
select s.title, s.person_id, p.name as person_name, s.detail
from standouts s
join people p on p.id = s.person_id
order by s.rank;
