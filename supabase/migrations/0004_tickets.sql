create table tickets (
  id uuid primary key default gen_random_uuid(),
  jira_key text not null unique,
  jira_project_id uuid not null references jira_projects (id),
  epic_id uuid references epics (id),
  sprint_id uuid references sprints (id), -- most recent/current sprint this ticket sat in
  summary text not null,
  issue_type text not null,
  status text not null,
  status_category text not null,
  priority ticket_priority,
  assignee_person_id uuid references people (id),
  reporter_person_id uuid references people (id),
  original_estimate_seconds integer,
  remaining_estimate_seconds integer,
  time_spent_seconds integer not null default 0,
  labels text[] not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  resolved_at timestamptz,
  is_blocked boolean not null default false, -- status name contains "block"
  last_synced_at timestamptz not null default now()
);

create index idx_tickets_epic on tickets (epic_id);
create index idx_tickets_assignee on tickets (assignee_person_id);
create index idx_tickets_sprint on tickets (sprint_id);
create index idx_tickets_updated on tickets (updated_at);
create index idx_tickets_resolved on tickets (resolved_at);

-- Full worklog entries for in-window tickets. `started_at` is when the
-- work happened; `logged_at` is when it was recorded — the gap between
-- them is "log lag". Hours are credited to the worklog AUTHOR, not the
-- ticket assignee.
create table worklogs (
  id uuid primary key default gen_random_uuid(),
  jira_worklog_id text not null unique,
  ticket_id uuid not null references tickets (id) on delete cascade,
  author_person_id uuid not null references people (id),
  started_at timestamptz not null,
  logged_at timestamptz not null,
  seconds integer not null
);

create index idx_worklogs_ticket on worklogs (ticket_id);
create index idx_worklogs_author on worklogs (author_person_id);
create index idx_worklogs_started on worklogs (started_at);

create table ticket_comments (
  id uuid primary key default gen_random_uuid(),
  jira_comment_id text not null unique,
  ticket_id uuid not null references tickets (id) on delete cascade,
  author_person_id uuid references people (id),
  created_at timestamptz not null,
  body_excerpt text
);

create index idx_comments_ticket on ticket_comments (ticket_id);
create index idx_comments_created on ticket_comments (created_at);
