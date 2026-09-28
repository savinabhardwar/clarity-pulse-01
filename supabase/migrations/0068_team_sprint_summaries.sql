-- Team/org-level capacity (v_exec_capacity, v_org_metrics: total_productive_hours,
-- allocated_hours, capacity_used_pct) is only ever computed LIVE, for
-- whichever sprint each board currently has is_tracked -- nothing persists
-- it, so "how did the Infrastructure team's utilisation look 3 sprints ago"
-- is unanswerable today. person_sprint_summaries (0032) and
-- project_sprint_summaries already solve this at the person/project level
-- via snapshot-sprint-summary.mjs; this adds the missing team-level trend.
--
-- Rather than a new table fed by a new snapshot-time write (more state to
-- keep in sync, another thing sync.mjs can drift from), this is a pure view
-- over person_sprint_summaries -- it's already the historical, append-only
-- record of every person's allocated/logged hours per sprint, so team
-- numbers just roll those up by the same Development/Infrastructure/
-- Telephony bucket v_exec_capacity/v_project_team_hours use, grouped by
-- calendar sprint-start day (same cross-board consolidation
-- v_person_sprint_summaries/0061 already does, since the org's 5 boards
-- run non-aligned sprints).
--
-- Two deliberate differences from v_exec_capacity's live version:
-- 1. `person_count` here is how many people actually HAD a summary row for
--    that sprint (i.e. were active/on a tracked board then), not today's
--    headcount -- so a past sprint's capacity ceiling reflects who was
--    really there, not who's on the team now.
-- 2. Team bucketing still uses people's CURRENT team_id (there's no
--    historical team assignment stored anywhere yet, and v_exec_capacity
--    has the same limitation live) -- someone who switched teams shows
--    their whole history under their current team. Good enough for a
--    trend line; revisit only if team moves turn out to be common enough
--    to matter.
--
-- QA hours (person_sprint_summaries.qa_allocated_hours/qa_logged_hours,
-- 0065) are deliberately left out -- 0065 hasn't been applied to
-- production yet, so referencing those columns here would break this view
-- until it lands. Add them once 0065 is live.
create or replace view v_team_sprint_summaries as
with bucketed as (
  select
    pss.*,
    case
      when t.name = 'Team - Infrastructure' then 'Infrastructure'
      when t.name = 'Team - Telephony' then 'Telephony'
      else 'Development'
    end as team
  from person_sprint_summaries pss
  join people p on p.id = pss.person_id
  left join teams t on t.id = p.team_id
  where not p.excluded
),
grouped as (
  select
    team,
    (sprint_start at time zone 'Asia/Kolkata')::date as group_day,
    min(sprint_start) as sprint_start,
    max(sprint_end) as sprint_end,
    count(distinct person_id) as person_count,
    round(sum(allocated_hours)::numeric, 1) as allocated_hours,
    round(sum(logged_hours)::numeric, 1) as logged_hours,
    round(avg(pace_score))::int as avg_pace_score,
    round(avg(estimate_score))::int as avg_estimate_score,
    round(avg(hygiene_score))::int as avg_hygiene_score,
    round(avg(overall_score))::int as avg_overall_score
  from bucketed
  group by team, (sprint_start at time zone 'Asia/Kolkata')::date
)
select
  g.team,
  g.sprint_start,
  g.sprint_end,
  g.person_count,
  workdays_between(g.sprint_start::date - 1, g.sprint_end::date) as sprint_workdays,
  round(7.0 * workdays_between(g.sprint_start::date - 1, g.sprint_end::date) * g.person_count, 1) as total_productive_hours,
  g.allocated_hours,
  g.logged_hours,
  case
    when g.person_count = 0 or workdays_between(g.sprint_start::date - 1, g.sprint_end::date) = 0 then 0
    else round(100 * g.allocated_hours / (7.0 * workdays_between(g.sprint_start::date - 1, g.sprint_end::date) * g.person_count))
  end as capacity_used_pct,
  case
    when g.person_count = 0 or workdays_between(g.sprint_start::date - 1, g.sprint_end::date) = 0 then 0
    else round(100 * g.logged_hours / (7.0 * workdays_between(g.sprint_start::date - 1, g.sprint_end::date) * g.person_count))
  end as utilisation_pct,
  g.avg_pace_score,
  g.avg_estimate_score,
  g.avg_hygiene_score,
  g.avg_overall_score,
  -- Exposed so consumers can bucket by the same "which org sprint is this"
  -- key the view itself groups by -- two teams' own min(sprint_start) for
  -- what's conceptually the same org sprint window can differ by minutes
  -- (non-aligned boards), so joining/charting across teams on raw
  -- sprint_start fragments what should be one column into several.
  g.group_day
from grouped g
order by g.sprint_start desc, g.team;

-- Org-wide rollup per sprint (summed, not averaged, matching
-- v_exec_capacity_org's own summed-not-averaged rationale) -- one row per
-- calendar sprint-start day across all three teams combined.
-- Grouped by calendar sprint-start day alone (not sprint_start/sprint_end
-- themselves) -- each team's own min/max sprint_start can differ slightly
-- within the same org sprint window, since they're independently
-- aggregated per team in v_team_sprint_summaries above.
create or replace view v_org_sprint_summaries as
select
  (sprint_start at time zone 'Asia/Kolkata')::date as group_day,
  min(sprint_start) as sprint_start,
  max(sprint_end) as sprint_end,
  sum(person_count) as person_count,
  max(sprint_workdays) as sprint_workdays,
  round(sum(total_productive_hours), 1) as total_productive_hours,
  round(sum(allocated_hours), 1) as allocated_hours,
  round(sum(logged_hours), 1) as logged_hours,
  case
    when sum(total_productive_hours) = 0 then 0
    else round(100 * sum(allocated_hours) / sum(total_productive_hours))
  end as capacity_used_pct,
  case
    when sum(total_productive_hours) = 0 then 0
    else round(100 * sum(logged_hours) / sum(total_productive_hours))
  end as utilisation_pct
from v_team_sprint_summaries
group by (sprint_start at time zone 'Asia/Kolkata')::date
order by sprint_start desc;
