-- v_org_metrics.blocked_count was counting `risks` rows with
-- category = 'blocked_project', a category the sync pipeline never
-- inserts, so this KPI always read 0 regardless of real blocked tickets.
-- board_health.blocked_tickets (org scope) is the value sync.mjs actually
-- populates every run from orgBoardHealth.blockedTickets -- use that instead.
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
  (select board_health_score from board_health where scope_type = 'org' order by computed_at desc limit 1) as board_health_score;
