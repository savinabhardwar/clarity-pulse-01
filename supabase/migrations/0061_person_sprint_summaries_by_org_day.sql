-- Employee Details' "Sprint History" showed one row per BOARD's sprint,
-- not one per org-wide sprint window -- scripts/jira-sync/snapshot-
-- sprint-summary.mjs groups by sprints.start_date via exact-timestamp
-- equality, but different boards create their sprint objects seconds to
-- minutes apart even when they're all really "this sprint" (e.g. one
-- person's Aug 17 window recorded as five separate rows: "KH Sprint 1"
-- 10:51:42, "AV Sprint 1" 10:52:11, "AA Sprint 1" 10:53:08, "CXO Sprint 1"
-- 10:55:33, "AMY Sprint 1" 10:56:26 -- all the same org sprint). Confirmed
-- live: 24 people, 116 raw rows, 37 same-week duplicate pairs.
--
-- Consolidates by (person, IST calendar day of sprint_start) -- the same
-- day-bucketing convention as every other cross-board fix this session
-- (0056-0060) -- rather than changing the ingestion script or touching
-- existing rows: purely additive, reversible, and the raw per-board data
-- stays intact underneath for anyone who needs it.
--
-- Aggregation choices: sprint_start/sprint_end span the group's earliest
-- start to latest end -- the real org-sprint date range. sprint_name is
-- dropped (null) rather than concatenating N board names together; the
-- frontend already falls back to formatUtcMonthDay(sprint_start) when
-- sprint_name is null (see SprintHistory in employees.tsx), which is
-- exactly "write dates" per the request. Scores are a plain average
-- across the person's boards that org sprint (ignoring nulls, Postgres
-- avg()'s default) -- simple and transparent over an hours-weighted
-- average, which would obscure a zero-hour board's real "nothing done
-- here" signal. allocated/logged hours are summed (additive across
-- boards). jira_qualifies is true only if the person qualified on EVERY
-- board that sprint; when any board didn't, jira_status_tag surfaces the
-- reason from whichever board scored lowest, so the worst signal isn't
-- silently averaged away.
create view v_person_sprint_summaries with (security_invoker = on) as
select
  person_id,
  min(sprint_start) as sprint_start,
  max(sprint_end) as sprint_end,
  null::text as sprint_name,
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
group by person_id, (sprint_start at time zone 'Asia/Kolkata')::date;
