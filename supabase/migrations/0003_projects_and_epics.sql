-- Conceptual products/workstreams (QIP, Sophie, CX Pass, AVANI, ...).
-- NOT the same thing as a Jira project: each row here is an auto-derived
-- (or roadmap-sourced) cluster of one or more Jira epics, since teams
-- routinely split one feature into Backend/Frontend/Design/Testing epics.
create table projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  color text,
  purpose text,
  sprint_goal text,
  health health_status not null default 'on_track',
  progress smallint check (progress between 0 and 100),
  owner_person_id uuid references people (id),
  is_current boolean not null default false, -- has recent epic activity
  source text not null default 'epic_cluster' check (source in ('epic_cluster', 'roadmap', 'manual')),
  roadmap_go_live text,
  roadmap_status text,
  roadmap_tech_stack text,
  roadmap_key_benefit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_projects_current on projects (is_current);

-- A conceptual project can span more than one real Jira project
-- (e.g. "Agent Assist" has epics under TEAM, TEAMSANKYA, TRG and TT).
create table project_jira_projects (
  project_id uuid not null references projects (id) on delete cascade,
  jira_project_id uuid not null references jira_projects (id),
  primary key (project_id, jira_project_id)
);

-- Epics, mapped to a conceptual project. The mapping is auto-derived by
-- name-similarity clustering and is expected to need human correction
-- over time -- see `project_overrides`.
create table epics (
  id uuid primary key default gen_random_uuid(),
  jira_key text not null unique,
  jira_project_id uuid not null references jira_projects (id),
  project_id uuid references projects (id),
  summary text not null,
  status text not null,
  status_category text not null,
  resolved_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index idx_epics_project on epics (project_id);
create index idx_epics_jira_project on epics (jira_project_id);

-- Manual corrections to the auto-clustering, keyed by epic so they
-- survive re-running the clustering algorithm on a later sync.
create table project_overrides (
  epic_jira_key text primary key references epics (jira_key),
  forced_project_slug text not null,
  note text,
  created_at timestamptz not null default now()
);
