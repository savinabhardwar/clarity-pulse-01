-- Adds logging_score to the sprint-history snapshot -- % of a person's
-- in-progress tickets that had a worklog logged against them during
-- that sprint. Complements pace/estimate/hygiene as the "logging
-- discipline" leg of the leaderboard's Overall score (see
-- computeOverallScore in eng-data.ts and the matching computation in
-- scripts/jira-sync/snapshot-sprint-summary.mjs).
alter table person_sprint_summaries add column logging_score integer;
