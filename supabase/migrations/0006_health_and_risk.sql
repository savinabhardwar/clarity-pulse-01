-- Precomputed per-person metrics snapshot. These are NOT simple SQL
-- aggregates -- dark WIP, idle days in *working* days (weekends
-- excluded), log lag, and pace-vs-elapsed-workdays all need procedural
-- logic, so the sync script computes and upserts this table rather than
-- a live view recalculating it on every request.
create table person_metrics (
  person_id uuid primary key references people (id),
  bandwidth_hours numeric(6, 1) not null,
  utilisation_pct smallint not null,
  hours_logged numeric(6, 1) not null,
  estimated_hours numeric(6, 1) not null,
  sprint_target_hours numeric(6, 1) not null, -- 60h prorated for leave
  velocity smallint not null default 0, -- tickets closed, in-window
  estimate_accuracy smallint, -- null when no tickets have both an estimate AND logged time
  estimate_coverage smallint not null,
  closed_without_logging smallint not null default 0,
  worklog_count smallint not null default 0,
  comment_count smallint not null default 0,
  idle_workdays smallint not null default 0,
  dark_wip_count smallint not null default 0,
  avg_log_lag_days numeric(4, 1),
  health health_status not null default 'on_track',
  risk_flags text[] not null default '{}',
  computed_at timestamptz not null default now()
);

-- Org/project/person-scoped hygiene rollups ("is Jira healthy enough to
-- trust?"). One row per scope per sync, so trend-over-time is queryable.
create table board_health (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('org', 'project', 'person')),
  scope_id uuid, -- null for scope_type = 'org'
  estimate_coverage_pct smallint not null,
  blocked_tickets smallint not null default 0,
  dark_wip smallint not null default 0,
  missing_estimates smallint not null default 0,
  closed_without_logs smallint not null default 0,
  idle_engineers smallint not null default 0,
  avg_log_lag_days numeric(4, 1),
  stale_tickets smallint not null default 0,
  board_health_score smallint not null,
  computed_at timestamptz not null default now()
);

create index idx_board_health_scope on board_health (scope_type, scope_id, computed_at desc);

create table risks (
  id uuid primary key default gen_random_uuid(),
  category risk_category not null,
  severity risk_severity not null,
  title text not null,
  recommendation text,
  person_id uuid references people (id),
  project_id uuid references projects (id),
  ticket_id uuid references tickets (id),
  identified_at date not null,
  status risk_status not null default 'open',
  computed_at timestamptz not null default now()
);

create index idx_risks_status on risks (status);
create index idx_risks_project on risks (project_id);
create index idx_risks_person on risks (person_id);

-- Named strengths per person, deliberately NOT collapsed into one
-- leaderboard score (ranking purely by hours logged rewards time-spent
-- over value-delivered and is gameable). Recomputed each sync.
create table standouts (
  id uuid primary key default gen_random_uuid(),
  title text not null, -- e.g. 'Highest Delivery', 'Best Estimate Accuracy', 'Cleanest Jira'
  person_id uuid not null references people (id),
  detail text not null,
  rank smallint not null default 1,
  computed_at timestamptz not null default now()
);

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status sync_status not null default 'running',
  sync_type text not null check (sync_type in ('full', 'incremental', 'manual')),
  records_processed integer not null default 0,
  error_message text,
  watermark_before timestamptz,
  watermark_after timestamptz
);

create index idx_sync_runs_started on sync_runs (started_at desc);
