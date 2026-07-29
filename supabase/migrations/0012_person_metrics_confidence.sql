-- Surfaces two things that were previously only inferable from reading
-- the sync script: whether this person's capacity target used the
-- 60h fallback (missing tracked-sprint dates -- lower confidence), and a
-- human-readable reason when utilisation exceeds 100% (e.g. concurrent
-- sprints vs. a single overloaded sprint), instead of leaving readers to
-- guess from risk_flags.
alter table person_metrics
  add column target_hours_is_fallback boolean not null default false,
  add column overallocation_reason text;

drop view if exists v_people_overview;
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
  pm.target_hours_is_fallback,
  pm.overallocation_reason,
  pm.computed_at
from people p
join person_metrics pm on pm.person_id = p.id
left join teams t on t.id = p.team_id
where p.excluded = false;
