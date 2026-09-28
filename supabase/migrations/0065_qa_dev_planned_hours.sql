-- Same-ticket Dev+QA effort tracking (ACX, Sept 2026): Jira now carries a
-- "QA Assignee" (customfield_10690, user picker) and "QA Planned Hours"
-- (customfield_10691, number) on issues, alongside the existing Assignee
-- (dev) and Original Estimate (dev-planned hours). This lets one ticket
-- carry both roles' planned effort without a QA subtask/duplicate ticket.
--
-- qa_planned_seconds mirrors original_estimate_seconds's unit (seconds)
-- even though Jira's custom Number field returns plain hours -- converted
-- at ingestion in sync.mjs, same as every other *_seconds column here.
alter table tickets
  add column qa_assignee_person_id uuid references people (id),
  add column qa_planned_seconds integer;

create index idx_tickets_qa_assignee on tickets (qa_assignee_person_id);

-- Mirrors allocated_hours/logged_hours (dev, keyed off assignee_person_id)
-- with a QA-side pair keyed off qa_assignee_person_id -- see
-- snapshot-sprint-summary.mjs's computeForPerson. A person can carry both
-- in the same sprint (e.g. they QA'd someone else's ticket while also
-- owning their own dev tickets), so these are additive alongside the
-- existing columns, not a replacement.
alter table person_sprint_summaries
  add column qa_allocated_hours numeric not null default 0,
  add column qa_logged_hours numeric not null default 0;

-- Rebuilt with the same shape as 0062's version, plus qa_allocated_hours/
-- qa_logged_hours summed the same way as their dev counterparts.
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
    round(sum(qa_allocated_hours)::numeric, 1) as qa_allocated_hours,
    round(sum(qa_logged_hours)::numeric, 1) as qa_logged_hours,
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
  g.qa_allocated_hours,
  g.qa_logged_hours,
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
