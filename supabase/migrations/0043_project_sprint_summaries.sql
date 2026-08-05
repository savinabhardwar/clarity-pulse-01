-- Project-level counterpart to person_sprint_summaries (0032) -- a
-- durable per-(project, sprint) snapshot taken once a sprint closes, so
-- the closed-sprint ticket purge (purge-closed-sprint-tickets.mjs) has
-- somewhere to preserve project-level history before it deletes the
-- underlying ticket rows.
create table if not exists project_sprint_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  sprint_start timestamptz not null,
  sprint_end timestamptz not null,
  tickets_total integer not null default 0,
  tickets_completed integer not null default 0,
  hours_estimated numeric not null default 0,
  hours_logged numeric not null default 0,
  spillover_tickets integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (project_id, sprint_start)
);

create index if not exists idx_project_sprint_summaries_project on project_sprint_summaries(project_id, sprint_start);
