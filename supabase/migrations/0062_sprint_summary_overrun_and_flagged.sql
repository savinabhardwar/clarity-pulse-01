-- Adds two per-sprint detail arrays to person_sprint_summaries, computed
-- once at snapshot time (see snapshot-sprint-summary.mjs) alongside the
-- existing scores:
--   overrun_tickets: tickets this person owned that sprint whose
--     time_spent_seconds ended up above original_estimate_seconds.
--   flagged_comments: this person's own comments that sprint flagged as
--     empty/near-empty, an unfilled placeholder template, an exact
--     duplicate of a comment they left on a DIFFERENT ticket (copy-paste),
--     or sharing no keyword overlap with their own ticket's summary
--     ("possibly off-topic" -- a heuristic, not a semantic judgment).
--
-- Both default to '[]' and are NOT backfillable for sprints already
-- snapshotted before this migration: purge-closed-sprint-tickets.mjs
-- deletes a sprint's tickets (and their worklogs/comments cascade) once
-- it's no longer tracked, and confirmed live, every closed sprint here
-- except the most recent has already had its tickets purged -- the
-- estimate/comment data these two fields need simply no longer exists.
-- Only sprints closed AFTER this migration ships will have real detail;
-- older rows stay at the empty default, which the frontend must treat as
-- "not available" rather than "nothing to flag".
alter table person_sprint_summaries
  add column overrun_tickets jsonb not null default '[]'::jsonb,
  add column flagged_comments jsonb not null default '[]'::jsonb;

-- v_person_sprint_summaries consolidates per-board rows into one row per
-- org sprint (see 0061) via avg()/sum() aggregates, which don't work for
-- jsonb arrays -- these two need every board's array elements flattened
-- into one array instead. Rebuilt as a CTE so the correlated subqueries
-- below can re-join person_sprint_summaries by the same (person_id, IST
-- day) grouping key the main aggregate uses.
create or replace view v_person_sprint_summaries with (security_invoker = on) as
with grouped as (
  select
    person_id,
    (sprint_start at time zone 'Asia/Kolkata')::date as group_day,
    min(sprint_start) as sprint_start,
    max(sprint_end) as sprint_end,
    round(avg(pace_score))::int as pace_score,
    round(avg(estimate_score))::int as estimate_score,
    round(avg(hygiene_score))::int as hygiene_score,
    round(avg(logging_score))::int as logging_score,
    round(avg(overall_score))::int as overall_score,
    round(sum(allocated_hours)::numeric, 1) as allocated_hours,
    round(sum(logged_hours)::numeric, 1) as logged_hours,
    bool_and(jira_qualifies) as jira_qualifies,
    (array_agg(jira_status_tag order by overall_score asc) filter (where not jira_qualifies))[1] as jira_status_tag
  from person_sprint_summaries
  group by person_id, (sprint_start at time zone 'Asia/Kolkata')::date
)
select
  g.person_id,
  g.sprint_start,
  g.sprint_end,
  null::text as sprint_name,
  g.pace_score,
  g.estimate_score,
  g.hygiene_score,
  g.logging_score,
  g.overall_score,
  g.allocated_hours,
  g.logged_hours,
  g.jira_qualifies,
  g.jira_status_tag,
  coalesce(
    (select jsonb_agg(elem) from person_sprint_summaries pss, jsonb_array_elements(pss.overrun_tickets) elem
     where pss.person_id = g.person_id and (pss.sprint_start at time zone 'Asia/Kolkata')::date = g.group_day),
    '[]'::jsonb
  ) as overrun_tickets,
  coalesce(
    (select jsonb_agg(elem) from person_sprint_summaries pss, jsonb_array_elements(pss.flagged_comments) elem
     where pss.person_id = g.person_id and (pss.sprint_start at time zone 'Asia/Kolkata')::date = g.group_day),
    '[]'::jsonb
  ) as flagged_comments
from grouped g;
