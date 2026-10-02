-- 0003_qa_rota_state.sql
-- Phase 2 task 2.2b — QA rota state (the automation-writable half; the
-- human-curated eligibility list lives in
-- ai-pm-platform/config/qa-rota.json instead, per the 2026-09-22 decision
-- recorded there and in IMPLEMENTATION_PLAN.md task 2.2b).

-- ============================================================
-- qa_rota_state
-- ============================================================
-- One row per project. Tracks only what changes automatically on every
-- QA assignment (the round-robin cursor) plus the pause toggle -- never
-- who is eligible, which stays in the git file.
create table qa_rota_state (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id),
  last_assigned_user_id uuid references users(id),
  paused boolean not null default false,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create trigger qa_rota_state_set_updated_at
  before update on qa_rota_state
  for each row execute function set_updated_at();

alter table qa_rota_state enable row level security; -- PM/Admin write, automation write; task 2.5

-- ============================================================
-- qa_assignment_overrides
-- ============================================================
-- Per-issue override, consumed once applied (CLAUDE.md §8: "Overrides are
-- consumed, not persistent -- once applied to an issue, the automation
-- must not keep re-applying them"). The partial unique index below
-- prevents stacking more than one *unconsumed* override on the same
-- issue at a time -- not in spec.md (this table isn't from spec.md at
-- all, it's CLAUDE.md's own design), but a direct encoding of that
-- sentence rather than trusting application logic alone.
create table qa_assignment_overrides (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id),
  qa_user_id uuid not null references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create unique index qa_assignment_overrides_one_pending_per_issue_idx
  on qa_assignment_overrides (issue_id)
  where consumed_at is null;

alter table qa_assignment_overrides enable row level security; -- PM/Admin write; task 2.5
