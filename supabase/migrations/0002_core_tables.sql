-- Teams: hand-maintained, Jira has no team field.
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- People, keyed by Jira account id (stable across renames).
create table people (
  id uuid primary key default gen_random_uuid(),
  jira_account_id text not null unique,
  name text not null,
  role text,
  team_id uuid references teams (id),
  team_guessed boolean not null default false,
  team_guess_reason text,
  active boolean not null default true,
  excluded boolean not null default false, -- left the org; scrub from lists but keep historical joins intact
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_people_team on people (team_id);

-- The 5 real Jira projects being tracked (TEAM, TI, TEAMSANKYA, TT, TRG).
-- Deliberately distinct from `projects` below (the ~29-130 conceptual
-- products/workstreams people actually think in, grouped by epic).
create table jira_projects (
  id uuid primary key default gen_random_uuid(),
  jira_key text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

-- One row per real Jira sprint (a jira_project can have many over time).
-- Sprint = the JQL/board-level "current sprint", NOT the dashboard's
-- conceptual project — see the team's own note: several teams' nominal
-- "current" sprint runs past its planned end date without being closed.
create table sprints (
  id uuid primary key default gen_random_uuid(),
  jira_sprint_id integer not null unique,
  jira_project_id uuid not null references jira_projects (id),
  name text not null,
  state text not null, -- 'active' | 'closed' | 'future', straight from Jira
  start_date timestamptz,
  end_date timestamptz,
  complete_date timestamptz,
  is_tracked boolean not null default false, -- the sprint this dashboard is currently reporting on for this jira_project
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sprints_project on sprints (jira_project_id);
create unique index idx_sprints_one_tracked_per_project on sprints (jira_project_id) where is_tracked;

-- Jira's status names vary per project/board and don't line up 1:1 with
-- the UI's fixed ticket-status buckets. This is an editable mapping
-- (like projects.overrides) rather than a hardcoded case statement, so
-- new/renamed Jira statuses can be corrected without a code change.
create table status_mapping (
  jira_status text primary key,
  ui_bucket text not null check (ui_bucket in ('To Do', 'In Progress', 'In Review', 'QA', 'Blocked', 'Done'))
);

insert into status_mapping (jira_status, ui_bucket) values
  ('To Do', 'To Do'),
  ('In Progress', 'In Progress'),
  ('Review', 'In Review'),
  ('Testing', 'QA'),
  ('Blocked', 'Blocked'),
  ('Done', 'Done'),
  ('Cant Do', 'Done'),
  ('CAN''T DO', 'Done');
