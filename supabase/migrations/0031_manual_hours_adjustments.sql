-- One-off manual corrections to lifetime Engineering Investment for work
-- that happened in Jira projects the sync pipeline doesn't track (only 5
-- of 15 real Jira projects are wired in -- see fetch-jira-rest.mjs). This
-- table holds hand-verified additions so they survive every future
-- resync untouched (sync.mjs never writes here), rather than a one-time
-- UPDATE that the next sync's fresh investment calc would silently
-- overwrite.
create table project_manual_hours_adjustments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  hours numeric not null,
  note text not null,
  created_at timestamptz not null default now()
);

alter table project_manual_hours_adjustments enable row level security;
create policy project_manual_hours_adjustments_read_all on project_manual_hours_adjustments for select using (true);

create or replace view v_project_investment_lifetime as
select
  proj.id as project_id,
  round(sum(coalesce(tk.original_estimate_seconds, fallback.logged_seconds, 0)) / 3600.0, 1)
    + coalesce(adj.extra_hours, 0) as investment_hours,
  bool_or(tk.original_estimate_seconds is null) or coalesce(adj.extra_hours, 0) > 0 as includes_estimated_hours
from projects proj
join epics e on e.project_id = proj.id
join tickets tk on tk.epic_id = e.id
left join lateral (
  select sum(w.seconds) as logged_seconds
  from worklogs w
  join people p on p.id = w.author_person_id and not p.excluded
  where w.ticket_id = tk.id
) fallback on true
left join lateral (
  select sum(hours) as extra_hours from project_manual_hours_adjustments where project_id = proj.id
) adj on true
group by proj.id, adj.extra_hours;
