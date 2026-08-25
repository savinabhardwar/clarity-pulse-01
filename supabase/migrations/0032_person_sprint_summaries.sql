-- Persists each person's engineering-ethos leaderboard scores (pace,
-- estimate accuracy, Jira hygiene/estimate coverage, overall, and
-- whether they qualified for ranking) at the moment a sprint closes, so
-- sprint-over-sprint improvement can be tracked over time. Populated by
-- scripts/jira-sync/snapshot-sprint-summary.mjs, wired into
-- run-full-sync.mjs -- it runs on every sync, but only inserts rows for
-- a sprint the first time it's found closed (idempotent via the unique
-- constraint below), never overwrites an existing snapshot.
--
-- Keyed on (person_id, sprint_start) rather than a specific sprints.id --
-- every board's sprint currently starts on the same day, and this app's
-- own scoring already treats "the current sprint" as one shared window
-- across boards (see currentSprintStart in eng-data.ts), not a
-- per-board concept.
--
-- Known limitation: tickets.sprint_id only ever points at the most
-- recent sprint a ticket sat in (see 0004_tickets.sql), so a spillover
-- ticket that's already rolled into the NEXT sprint by the time this
-- runs is invisible to that next day's snapshot of the sprint it just
-- left. The snapshot script mitigates this by running on every sync and
-- only needing to catch a newly-closed sprint once, but a person whose
-- work was entirely spillover-heavy may show a thinner picture for a
-- closed sprint than they would have mid-sprint.
create table person_sprint_summaries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id) on delete cascade,
  sprint_start timestamptz not null,
  sprint_end timestamptz not null,
  pace_score integer,
  estimate_score integer,
  hygiene_score integer,
  overall_score integer not null,
  allocated_hours numeric not null default 0,
  logged_hours numeric not null default 0,
  jira_qualifies boolean not null,
  jira_status_tag text,
  computed_at timestamptz not null default now(),
  unique (person_id, sprint_start)
);

create index idx_person_sprint_summaries_person on person_sprint_summaries (person_id, sprint_start);

alter table person_sprint_summaries enable row level security;
create policy person_sprint_summaries_read_all on person_sprint_summaries for select using (true);
