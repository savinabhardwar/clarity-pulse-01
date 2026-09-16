-- Core schema for the Stakeholder Management Dashboard.
-- One shared `stakeholder_items` table for both Features and Implementation
-- (distinguished by `kind`) -- identical fields/CRUD/filters/history for both,
-- so two tables would just duplicate everything for no benefit.

-- Named stakeholder_projects (not "projects") -- this shared Supabase project
-- already has a conceptual `projects` table (epic-clustered workstreams, see
-- root supabase/migrations/0003_projects_and_epics.sql) with a different
-- shape/meaning; this app's 4 stakeholder-management projects are separate.
create table stakeholder_projects (
  id text primary key,               -- e.g. 'cx-pass' (kept as text to match the app's own ids/URLs)
  name text not null,
  code text not null,                -- e.g. 'CXP' (cosmetic, from the original prototype)
  jira_project_key text,             -- e.g. 'CP' -- the REAL Jira project key this project's
                                      -- items should be matched against (see find-jira-match)
  owner text,
  description text,
  created_at timestamptz not null default now()
);

create type item_kind as enum ('feature', 'implementation');
create type status_kind as enum ('stakeholder', 'jira');
create type priority as enum ('High', 'Medium', 'Low');

create table stakeholder_items (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references stakeholder_projects(id),
  kind item_kind not null,
  summary text not null check (char_length(trim(summary)) > 0),
  description text not null default '',
  jira_url text not null default '',
  jira_key text not null default '',
  status text not null,
  status_kind status_kind not null,
  priority priority not null default 'Medium',
  comment text not null default '',
  created_by text not null,
  required_by date,
  will_be_done_by date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz             -- soft delete: never hard-deleted by the app,
                                      -- so history in stakeholder_item_history is never orphaned
);
create index on stakeholder_items (project_id, kind);
create index on stakeholder_items (status);
create index on stakeholder_items (required_by);

create table stakeholder_item_attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references stakeholder_items(id) on delete cascade,
  storage_path text not null,        -- '{project_id}/{item_id}/{attachment_id}-{original_filename}'
  file_name text not null,
  file_type text not null,           -- extension, upper-cased for display (e.g. 'PDF')
  file_size bigint not null,
  uploaded_by text not null,
  created_at timestamptz not null default now()
);
create index on stakeholder_item_attachments (item_id);

-- Immutable audit trail. Only ever inserted into, exclusively by the trigger in
-- 0002_stakeholder_rls_and_functions.sql -- no application code writes here directly,
-- so history can't be bypassed or forgotten by a future code change.
create table stakeholder_item_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,             -- deliberately not an FK-cascade: history must
                                      -- outlive the item even if it's ever hard-deleted
  event_type text not null,          -- 'created' | 'updated' | 'deleted'
  field_name text,                   -- null for the 'created' event
  old_value text,
  new_value text,
  changed_by text not null,
  changed_at timestamptz not null default now()
);
create index on stakeholder_item_history (item_id, changed_at);
