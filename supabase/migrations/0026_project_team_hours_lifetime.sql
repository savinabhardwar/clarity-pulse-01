-- Executive Compass's per-project "Hours by Development/Infrastructure/
-- Telephony" breakdown was sourced from project_contributors.hours,
-- which is a current-sprint-only allocation snapshot (see sync.mjs's
-- "current-sprint allocation" comment on that table) -- inconsistent
-- with investmentHours (v_projects_overview.hours_invested), which is
-- already lifetime. This view sums worklogs.seconds with no date
-- filter, bucketed the same way v_team_utilisation buckets raw team
-- names into the three business-facing groups, so both figures agree.
create view v_project_team_hours as
select
  e.project_id,
  case
    when t.name = 'Team - Infrastructure' then 'Infrastructure'
    when t.name = 'Team - Telephony' then 'Telephony'
    else 'Development'
  end as team,
  round(sum(w.seconds) / 3600.0, 1) as hours
from worklogs w
join tickets tk on tk.id = w.ticket_id
join epics e on e.id = tk.epic_id
join people p on p.id = w.author_person_id
left join teams t on t.id = p.team_id
where e.project_id is not null
group by e.project_id, 2;
