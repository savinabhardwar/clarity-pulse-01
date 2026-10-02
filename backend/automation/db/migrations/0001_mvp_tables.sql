-- 0001_mvp_tables.sql
-- Phase 2 task 2.1 — MVP tables (spec.md §6), adjusted where discovery.md
-- or CLAUDE.md found the spec's column list incomplete. Deviations are
-- called out inline rather than applied silently (IMPLEMENTATION_PLAN.md
-- "How to use this document").
--
-- Deliberately NOT created here: pm_brain_entries, pm_brain_links (moved to
-- task 7.0, PM Brain deferred — see IMPLEMENTATION_PLAN.md's 2026-09-18
-- sequencing decision). bugs (D13 defers bug automation). assignments,
-- dependencies, branches, commits, pull_requests, qa_runs (task 2.2). QA
-- rota tables (task 2.2b).

create extension if not exists pgcrypto; -- gen_random_uuid()

-- Shared trigger: keeps updated_at accurate without relying on app code.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================
-- users
-- ============================================================
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null default 'member',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

alter table users enable row level security; -- policies: task 2.5

-- ============================================================
-- projects
-- ============================================================
-- Note: `projects` and `project_configurations` share several columns
-- (jira_project_key, git_repository, dev_branch) per spec.md's own column
-- lists — kept verbatim, not collapsed. Read this as: `projects` is the
-- lightweight identity/summary row; `project_configurations` is the
-- PM/Admin-owned editable config (D3/D19/D20), one-to-one with a project.
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  description text,
  status text not null default 'active',
  -- project-compass's stakeholder_projects.id — a different Supabase
  -- project entirely (docs/discovery.md §0.3), so no FK, just the value.
  requirements_project_id uuid,
  jira_project_key text unique,
  git_repository text,
  dev_branch text default 'development', -- verified convention, discovery.md §0.4
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger projects_set_updated_at
  before update on projects
  for each row execute function set_updated_at();

alter table projects enable row level security; -- policies: task 2.5

-- ============================================================
-- project_configurations
-- ============================================================
create table project_configurations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id),
  jira_project_key text,
  git_repository text,
  dev_branch text,
  project_lead_id uuid references users(id), -- CLAUDE.md §3a: config, not a scheduled-job read
  workflow_config jsonb not null default '{}'::jsonb,
  qa_config jsonb not null default '{}'::jsonb,
  sprint_config jsonb not null default '{}'::jsonb,
  release_config jsonb not null default '{}'::jsonb,
  notification_config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger project_configurations_set_updated_at
  before update on project_configurations
  for each row execute function set_updated_at();

alter table project_configurations enable row level security; -- PM/Admin-only write, task 2.5

-- ============================================================
-- project_members
-- ============================================================
create table project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  user_id uuid not null references users(id),
  role text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id) -- D4: a person may belong to many projects, one role per project
);

create trigger project_members_set_updated_at
  before update on project_members
  for each row execute function set_updated_at();

alter table project_members enable row level security; -- policies: task 2.5

-- ============================================================
-- requirements
-- ============================================================
create table requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id), -- resolved by the time it lands here; D24
  title text not null,
  description text,
  -- project-compass stakeholder_items.id (uuid, cross-database — see
  -- projects.requirements_project_id above). Unique: this is the
  -- polling dedup key per event-contracts.md.
  source_reference uuid not null unique,
  source_url text,
  status text not null default 'new',
  ai_readiness_status text,
  ai_readiness_confidence numeric,
  ai_readiness_reason text,
  jira_issue_id text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger requirements_set_updated_at
  before update on requirements
  for each row execute function set_updated_at();

alter table requirements enable row level security; -- policies: task 2.5

-- ============================================================
-- requirement_assessments
-- ============================================================
-- Deviation from spec.md's column list: added `model` and `prompt_version`.
-- CLAUDE.md §5 requires them explicitly ("record the model name and prompt
-- version on the assessment row so decisions stay auditable when models
-- change") but spec.md's own column list omits them — a real gap, not a
-- silent addition. No updated_at: each re-assessment is a new
-- assessment_version row, never a mutation of an existing one.
create table requirement_assessments (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references requirements(id),
  assessment_version int not null,
  decision text not null,
  confidence numeric,
  makes_sense boolean,
  information_sufficient boolean,
  missing_information jsonb,
  ambiguities jsonb,
  contradictions jsonb,
  related_work jsonb,
  duplicate_candidates jsonb,
  dependencies jsonb,
  scope_concerns jsonb,
  reasoning_summary text,
  model text, -- CLAUDE.md §5 — stamped from the API response, not the request
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (requirement_id, assessment_version)
);

alter table requirement_assessments enable row level security; -- policies: task 2.5

-- ============================================================
-- epics
-- ============================================================
create table epics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  jira_issue_id text,
  jira_issue_key text unique, -- globally unique across the Jira instance
  title text not null,
  description text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger epics_set_updated_at
  before update on epics
  for each row execute function set_updated_at();

alter table epics enable row level security; -- policies: task 2.5

-- ============================================================
-- sprints
-- ============================================================
create table sprints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  jira_sprint_id text,
  name text not null,
  start_date date,
  end_date date,
  status text,
  capacity_hours numeric,
  planned_hours numeric,
  completed_hours numeric,
  -- Not in spec.md's column list; field-mapping.md §"Sprint payload" flags
  -- Jira returns this and recommends keeping it. Jira sends "" not omitted
  -- when unset — normalize to null at the ingestion layer, not here.
  goal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, jira_sprint_id)
);

create trigger sprints_set_updated_at
  before update on sprints
  for each row execute function set_updated_at();

alter table sprints enable row level security; -- policies: task 2.5

-- ============================================================
-- issues
-- ============================================================
-- QA Assignee/QA Planned Hours (customfield_10690/10691, field-mapping.md)
-- deliberately NOT added as issues columns here — QA assignment is owned
-- by the assignments table (task 2.2) and the rota (task 2.2b/4.4b), not
-- a column mirrored onto issues.
create table issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  jira_issue_key text unique,
  jira_issue_id text,
  title text not null,
  issue_type text,
  status text,
  priority text,
  estimate_hours numeric, -- D16: hours, converted from Jira's native seconds at ingestion
  lead_estimate_hours numeric,
  actual_hours numeric,
  assignee_id uuid references users(id),
  sprint_id uuid references sprints(id),
  epic_id uuid references epics(id),
  requirement_id uuid references requirements(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger issues_set_updated_at
  before update on issues
  for each row execute function set_updated_at();

alter table issues enable row level security; -- policies: task 2.5

-- ============================================================
-- events (append-only)
-- ============================================================
-- Deviation from spec.md's column list: added `provider_event_id`.
-- spec.md's events columns don't include a dedup key, but
-- event-contracts.md's normalized shape and IMPLEMENTATION_PLAN.md task
-- 2.4 both require one ("a unique constraint supporting event
-- deduplication (source + provider event ID)") and CLAUDE.md hard rule 4
-- makes idempotent ingestion non-negotiable. An events table without this
-- column would be wrong from the moment it's created, not just incomplete
-- pending task 2.4 — so it's included now rather than bolted on later.
-- No updated_at: append-only by design, enforced below.
create table events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_type text not null,
  project_id uuid references projects(id),
  entity_type text,
  entity_id text,
  actor_type text,
  actor_id text,
  "timestamp" timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id text,
  provider_event_id text not null,
  created_at timestamptz not null default now(),
  unique (source, provider_event_id)
);

create index events_project_timestamp_idx on events (project_id, "timestamp");

-- CLAUDE.md hard rule 8 / task 2.1 Check: events must be append-only.
-- A trigger, not just table GRANTs, so this holds regardless of which
-- role executes the statement.
create or replace function forbid_events_mutation()
returns trigger as $$
begin
  raise exception 'events is append-only: % is not permitted', tg_op;
end;
$$ language plpgsql;

create trigger events_forbid_update
  before update on events
  for each row execute function forbid_events_mutation();

create trigger events_forbid_delete
  before delete on events
  for each row execute function forbid_events_mutation();

alter table events enable row level security; -- policies: task 2.5
