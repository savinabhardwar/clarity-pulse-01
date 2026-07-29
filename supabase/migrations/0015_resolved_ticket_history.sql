-- Persists the "history" resolved-ticket feed (used to build
-- project_features / delivered capabilities) across sync runs.
--
-- Previously this data only lived in a gitignored local file
-- (scripts/jira-sync/cache/history.raw.jsonl) that each incremental sync
-- tried to "append to the existing file" -- which silently did nothing
-- on every real CI run, since GitHub Actions checks out a fresh working
-- tree every time and that file never actually existed. Every
-- incremental sync was rebuilding project_features from just its own
-- tiny delta, wiping out the full backfill from the original full sync.
create table resolved_ticket_history (
  jira_key text primary key,
  summary text not null,
  issuetype text not null,
  resolution_date timestamptz,
  spent_seconds integer not null default 0,
  parent_epic_key text,
  updated_at timestamptz not null default now()
);

create index idx_resolved_ticket_history_parent on resolved_ticket_history (parent_epic_key);
