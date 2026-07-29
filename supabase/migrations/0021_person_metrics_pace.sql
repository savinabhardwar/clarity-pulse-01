-- Splits "sprint target" into two numbers that answer different
-- questions: sprintTargetHours is the FULL sprint commitment (60h/person,
-- leave-adjusted) -- the headline utilisation %, "how much of my sprint
-- commitment is done". pace_pct/pace_target_hours prorate to elapsed
-- workdays so far -- "am I on pace right now", useful specifically
-- mid-sprint when the full target hasn't had time to be reached yet.
-- Previously sprintTargetHours itself was prorated by elapsed days, which
-- read as a confusing, unexpectedly-small target early in a sprint.
alter table person_metrics add column pace_pct smallint not null default 0;
alter table person_metrics add column pace_target_hours numeric(6, 1) not null default 0;
alter table person_metrics_history add column pace_pct smallint not null default 0;
alter table person_metrics_history add column pace_target_hours numeric(6, 1) not null default 0;

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
  pm.pace_pct,
  pm.pace_target_hours,
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

drop function if exists get_people_overview_asof(timestamptz);

create or replace function get_people_overview_asof(p_asof timestamptz)
returns table (
  id uuid,
  name text,
  role text,
  team text,
  team_guessed boolean,
  utilisation_pct smallint,
  bandwidth_hours numeric,
  pace_pct smallint,
  pace_target_hours numeric,
  hours_logged numeric,
  estimated_hours numeric,
  velocity smallint,
  estimate_accuracy smallint,
  estimate_coverage smallint,
  worklog_count smallint,
  comment_count smallint,
  idle_workdays smallint,
  dark_wip_count smallint,
  health health_status,
  risk_flags text[],
  target_hours_is_fallback boolean,
  overallocation_reason text,
  computed_at timestamptz
)
language sql
stable
as $$
  select
    p.id, p.name, p.role, t.name as team, p.team_guessed,
    pmh.utilisation_pct, pmh.bandwidth_hours, pmh.pace_pct, pmh.pace_target_hours,
    pmh.hours_logged, pmh.estimated_hours,
    pmh.velocity, pmh.estimate_accuracy, pmh.estimate_coverage, pmh.worklog_count,
    pmh.comment_count, pmh.idle_workdays, pmh.dark_wip_count, pmh.health, pmh.risk_flags,
    pmh.target_hours_is_fallback, pmh.overallocation_reason, pmh.computed_at
  from people p
  left join teams t on t.id = p.team_id
  join lateral (
    select * from person_metrics_history h
    where h.person_id = p.id and h.computed_at <= p_asof
    order by h.computed_at desc
    limit 1
  ) pmh on true
  where p.excluded = false;
$$;
