-- Fixes Sprint History (Employee Details) showing duplicate/confusing rows
-- for the same calendar date. Root cause: 0032's design assumed "every
-- board's sprint currently starts on the same day" (see that migration's
-- comment), so person_sprint_summaries was keyed on (person_id,
-- sprint_start) alone and snapshot-sprint-summary.mjs inserted one row per
-- person for EVERY closed sprint on EVERY board, regardless of whether
-- that person had anything to do with that board -- in practice, boards
-- (TEAMSANK/TRG/Team/TEAM) run on staggered, unaligned cadences, so most
-- people got several rows per real sprint: one real one from their own
-- board, and one "Nothing assigned this sprint" per unrelated board that
-- happened to close around the same date.
--
-- sprint_name lets the UI show the board's own label ("TRG Sprint 8")
-- instead of a bare date, and the noise rows -- which carry no signal,
-- they only exist because every person was snapshotted against every
-- board -- are deleted outright. Going forward, the sync (updated
-- alongside this migration) stops inserting them.
alter table person_sprint_summaries add column sprint_name text;

update person_sprint_summaries pss
set sprint_name = s.name
from sprints s
where s.start_date = pss.sprint_start;

delete from person_sprint_summaries where jira_status_tag = 'Nothing assigned this sprint';
