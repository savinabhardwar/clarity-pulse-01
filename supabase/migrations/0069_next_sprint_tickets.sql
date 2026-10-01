-- Next-sprint planning data for team-pulse-54's "Next Sprint Planning" page.
--
-- Everything else in this schema is scoped to each board's TRACKED (active)
-- sprint -- fetchTrackedSprints only ever ingests `state = 'active'`, and
-- `tickets`/the scoring views/the closed-sprint purge all assume the table
-- holds nothing but tracked-sprint work. Putting future-sprint issues into
-- `tickets` would risk counting next sprint's planned work as this sprint's
-- (and the other two dashboards read those same views), so this is a
-- deliberately separate, self-contained table, populated by
-- scripts/jira-sync/sync-next-sprint.mjs.
--
-- One row per issue in each board's NEXT sprint (the earliest `future` sprint
-- that board has issues in). It's a snapshot, not history: every sync run
-- replaces the whole table, so a sprint that starts (and becomes tracked)
-- drops out on the next run with nothing to clean up.
--
-- Sprint columns are denormalized onto each ticket rather than joined to
-- `sprints`: a future sprint has no row there (and shouldn't -- see above).
-- Jira usually leaves a future sprint's dates empty until it's started, so
-- sprint_start_date/sprint_end_date are nullable and the UI estimates a
-- window when they're missing.
create table next_sprint_tickets (
  jira_key text primary key,
  jira_project_key text not null,
  board_name text not null,
  jira_sprint_id integer not null,
  sprint_name text not null,
  sprint_start_date timestamptz,
  sprint_end_date timestamptz,
  sprint_goal text,
  summary text not null,
  issue_type text,
  status text not null,
  priority text,
  -- Null for unassigned tickets, and for an assignee not (yet) in `people`.
  assignee_person_id uuid references people (id) on delete set null,
  assignee_name text,
  original_estimate_seconds integer,
  last_synced_at timestamptz not null default now()
);

create index idx_next_sprint_tickets_person on next_sprint_tickets (assignee_person_id);
create index idx_next_sprint_tickets_sprint on next_sprint_tickets (jira_sprint_id);

alter table next_sprint_tickets enable row level security;
-- Read-only for anon + authenticated; the sync job writes with the
-- service_role/direct connection, which bypasses RLS (same as 0008).
create policy next_sprint_tickets_read_all on next_sprint_tickets for select using (true);
