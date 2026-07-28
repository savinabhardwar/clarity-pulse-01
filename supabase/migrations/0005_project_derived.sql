-- Booked leave / prorated sprint targets, and people who left the org.
-- Hand-maintained, same spirit as `teams` -- Jira has no equivalent field.
create table adjustments (
  person_id uuid primary key references people (id),
  leave_days_this_sprint smallint not null default 0,
  note text
);

-- Current-sprint allocation snapshot: how much of a person's time is
-- going to each conceptual project. Recomputed every sync, not
-- incrementally updated.
create table project_contributors (
  project_id uuid not null references projects (id) on delete cascade,
  person_id uuid not null references people (id),
  pct smallint not null check (pct between 0 and 100),
  hours numeric(6, 1) not null,
  computed_at timestamptz not null default now(),
  primary key (project_id, person_id)
);

-- "Current sprint work", grouped into meaningful initiatives rather than
-- raw tickets (e.g. "Billing Configuration", "WhatsApp Integration").
create table project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  summary text,
  progress smallint check (progress between 0 and 100),
  computed_at timestamptz not null default now()
);

create table project_update_tickets (
  project_update_id uuid not null references project_updates (id) on delete cascade,
  ticket_id uuid not null references tickets (id) on delete cascade,
  primary key (project_update_id, ticket_id)
);

create index idx_project_updates_project on project_updates (project_id);

-- Delivered capabilities: de-duplicated, human-meaningful features
-- (e.g. "Workflow Builder"), NOT raw closed tickets. A cluster of
-- Backend/Frontend/Design/Testing tickets for the same feature collapses
-- into one row here — see the sync script's title-similarity clustering.
create table project_features (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  description text,
  completion_sprint text,
  completion_date date,
  hours numeric(7, 1) not null default 0,
  computed_at timestamptz not null default now()
);

create table project_feature_tickets (
  project_feature_id uuid not null references project_features (id) on delete cascade,
  ticket_id uuid not null references tickets (id) on delete cascade,
  primary key (project_feature_id, ticket_id)
);

create index idx_project_features_project on project_features (project_id);

-- Auto-generated executive summary paragraph per project.
create table project_summaries (
  project_id uuid primary key references projects (id) on delete cascade,
  summary_text text not null,
  generated_at timestamptz not null default now()
);

create table activity_feed (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects (id) on delete cascade,
  kind activity_kind not null,
  text text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index idx_activity_project on activity_feed (project_id);
create index idx_activity_occurred on activity_feed (occurred_at desc);
