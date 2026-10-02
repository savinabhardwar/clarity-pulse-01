-- 0002_delivery_tables.sql
-- Phase 2 task 2.2 — Delivery tables (spec.md §6). `bugs` deferred (D13).
-- QA rota tables are task 2.2b, not here.

-- ============================================================
-- assignments
-- ============================================================
create table assignments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id),
  user_id uuid not null references users(id),
  assignment_type text not null check (assignment_type in ('dev', 'qa')),
  assigned_by uuid references users(id), -- null when system-assigned (task 4.4b rota)
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  active boolean not null default true
);

-- task 4.4b idempotency: "if the issue already has an active QA
-- assignment, skip" -- enforced at the DB level, not just trusted to
-- application logic. Applies to both assignment_type values, since the
-- same invariant (one active assignment of a given type per issue) holds
-- for dev assignment too.
create unique index assignments_one_active_per_type_idx
  on assignments (issue_id, assignment_type)
  where active;

alter table assignments enable row level security; -- policies: task 2.5

-- ============================================================
-- dependencies
-- ============================================================
create table dependencies (
  id uuid primary key default gen_random_uuid(),
  source_issue_id uuid not null references issues(id),
  target_issue_id uuid not null references issues(id),
  dependency_type text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (source_issue_id <> target_issue_id),
  unique (source_issue_id, target_issue_id, dependency_type)
);

alter table dependencies enable row level security; -- policies: task 2.5

-- ============================================================
-- branches
-- ============================================================
-- Deviation from spec.md: added a unique (repository, branch_name)
-- constraint. Not in the spec's column list, but branches have no other
-- natural external identifier and task 2.4 requires idempotent upserts
-- for everything on an event path (CLAUDE.md hard rule 4) -- same
-- reasoning applied to events.provider_event_id in migration 0001.
create table branches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  repository text not null,
  branch_name text not null,
  issue_id uuid references issues(id), -- nullable: matched via task 4.3, not guaranteed at ingestion
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz,
  unique (repository, branch_name)
);

alter table branches enable row level security; -- policies: task 2.5

-- ============================================================
-- commits
-- ============================================================
create table commits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  issue_id uuid references issues(id), -- nullable: matched via task 4.3
  repository text not null,
  commit_hash text not null,
  author_id uuid references users(id),
  message text,
  committed_at timestamptz not null,
  unique (repository, commit_hash) -- explicit in task 2.4's own wording
);

alter table commits enable row level security; -- policies: task 2.5

-- ============================================================
-- pull_requests
-- ============================================================
create table pull_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  issue_id uuid references issues(id), -- nullable: matched via task 4.3
  repository text not null,
  external_pr_id text not null,
  title text not null,
  url text,
  author_id uuid references users(id),
  source_branch text,
  target_branch text,
  status text,
  created_at timestamptz not null default now(),
  merged_at timestamptz,
  unique (repository, external_pr_id) -- explicit in task 2.4's own wording
);

alter table pull_requests enable row level security; -- policies: task 2.5

-- ============================================================
-- qa_runs
-- ============================================================
-- Evidence stored as jsonb, not a single text/url column: discovery.md
-- §0.4's human decision is that evidence accepts ANY of a file upload
-- (Supabase Storage reference), a URL/link, or freeform text -- not
-- either/or, and potentially more than one. A jsonb array of
-- {type, value} entries supports that without a schema migration later.
--
-- Two check constraints encode locked decisions at the DB level rather
-- than trusting the Automation Engine alone (IMPLEMENTATION_PLAN.md task
-- 4.4's own wording: "PASS validation must be server-side and
-- unbypassable"):
--   - D11: PASS requires test_result, comments, test_cases_executed, and
--     at least one evidence entry.
--   - D12: FAIL requires a failure_reason, from the fixed category list
--     task 4.5 already enumerates.
create table qa_runs (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id),
  cycle_number int not null,
  qa_user_id uuid references users(id),
  status text not null default 'in_progress' check (status in ('in_progress', 'pass', 'fail')),
  test_result text,
  comments text,
  test_cases_executed text,
  evidence jsonb not null default '[]'::jsonb,
  failure_reason text check (
    failure_reason is null or failure_reason in (
      'developer_defect', 'requirement_issue', 'requirement_change',
      'dependency', 'environment', 'test_data', 'qa_issue', 'other'
    )
  ),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (issue_id, cycle_number),
  check (
    status <> 'pass'
    or (
      test_result is not null
      and comments is not null
      and test_cases_executed is not null
      and jsonb_array_length(evidence) > 0
    )
  ),
  check (status <> 'fail' or failure_reason is not null)
);

alter table qa_runs enable row level security; -- policies: task 2.5
