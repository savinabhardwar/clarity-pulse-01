-- Surfaces projects.source so the frontend can flag auto-clustered
-- project groupings ('epic_cluster') as unconfirmed, the same way
-- people.team_guessed already flags guessed team assignments. Identical
-- to v_projects_overview in 0007_views.sql except for the added column.
drop view if exists v_projects_overview;
create view v_projects_overview as
select
  proj.id,
  proj.slug,
  proj.name,
  proj.color,
  proj.purpose,
  proj.health,
  proj.progress,
  proj.sprint_goal,
  owner.name as owner_name,
  proj.is_current,
  proj.source,
  ps.summary_text,
  coalesce(agg.hours_invested, 0) as hours_invested,
  coalesce(agg.hours_this_sprint, 0) as hours_this_sprint,
  coalesce(agg.open_tickets, 0) as open_tickets,
  coalesce(agg.closed_tickets, 0) as closed_tickets,
  coalesce(agg.blocked_tickets, 0) as blocked_tickets,
  coalesce(agg.remaining_estimate_hours, 0) as remaining_estimate_hours,
  coalesce(contrib.contributor_count, 0) as contributor_count
from projects proj
left join people owner on owner.id = proj.owner_person_id
left join project_summaries ps on ps.project_id = proj.id
left join lateral (
  -- Lifetime totals from ALL tickets under this project's epics, not just
  -- the current sprint's assignee list -- otherwise a leaver's or a
  -- finished contributor's closed work silently vanishes from the total.
  select
    round(sum(tk.time_spent_seconds) / 3600.0, 1) as hours_invested,
    round(sum(tk.time_spent_seconds) filter (where tk.sprint_id is not null and s.is_tracked) / 3600.0, 1) as hours_this_sprint,
    count(*) filter (where tk.status_category != 'done') as open_tickets,
    count(*) filter (where tk.status_category = 'done') as closed_tickets,
    count(*) filter (where tk.is_blocked and tk.status_category != 'done') as blocked_tickets,
    round(sum(tk.remaining_estimate_seconds) filter (where tk.status_category != 'done') / 3600.0, 1) as remaining_estimate_hours
  from tickets tk
  join epics e on e.id = tk.epic_id
  left join sprints s on s.id = tk.sprint_id
  where e.project_id = proj.id
) agg on true
left join lateral (
  select count(*) as contributor_count from project_contributors pc where pc.project_id = proj.id
) contrib on true;
