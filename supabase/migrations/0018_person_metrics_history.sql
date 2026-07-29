-- Append-only history of person_metrics, mirroring how board_health
-- already accumulates a real timeline (plain INSERT, no upsert-per-scope).
-- person_metrics itself stays as the fast "latest snapshot" table used by
-- v_people_overview and every page's default (no date range) view;
-- this is what makes the date-range filter on People/Team Health/
-- Resource Planning able to show numbers "as of" a past sync instead of
-- only ever the current one. History starts accumulating from the first
-- sync after this migration -- there's no way to retroactively
-- reconstruct utilisation that was previously only ever overwritten.
create table person_metrics_history (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id),
  bandwidth_hours numeric(6, 1) not null,
  utilisation_pct smallint not null,
  hours_logged numeric(6, 1) not null,
  estimated_hours numeric(6, 1) not null,
  sprint_target_hours numeric(6, 1) not null,
  velocity smallint not null default 0,
  estimate_accuracy smallint,
  estimate_coverage smallint not null,
  closed_without_logging smallint not null default 0,
  worklog_count smallint not null default 0,
  comment_count smallint not null default 0,
  idle_workdays smallint not null default 0,
  dark_wip_count smallint not null default 0,
  avg_log_lag_days numeric(4, 1),
  health health_status not null default 'on_track',
  risk_flags text[] not null default '{}',
  target_hours_is_fallback boolean not null default false,
  overallocation_reason text,
  computed_at timestamptz not null default now()
);

create index idx_person_metrics_history_person_time on person_metrics_history (person_id, computed_at desc);

-- Returns the same shape as v_people_overview, but each person's most
-- recent history snapshot with computed_at <= p_asof (nearest state
-- "as of" that date), instead of always the live latest.
create or replace function get_people_overview_asof(p_asof timestamptz)
returns table (
  id uuid,
  name text,
  role text,
  team text,
  team_guessed boolean,
  utilisation_pct smallint,
  bandwidth_hours numeric,
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
    pmh.utilisation_pct, pmh.bandwidth_hours, pmh.hours_logged, pmh.estimated_hours,
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
