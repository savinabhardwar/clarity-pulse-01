-- This dashboard names individuals and characterizes their delivery /
-- Jira hygiene. RLS here only gates table-level writes (anon read-only,
-- writes via service_role only, used by the sync job). It does NOT by
-- itself make the deployed site safe to expose publicly -- if the
-- Netlify site is reachable without auth, anyone with the URL + anon key
-- can read everyone's performance data. That needs an access-control
-- layer in front of the site itself (Netlify password/SSO, or wrapping
-- these reads behind Supabase Auth), which is out of scope for RLS.

alter table teams enable row level security;
alter table people enable row level security;
alter table jira_projects enable row level security;
alter table sprints enable row level security;
alter table status_mapping enable row level security;
alter table projects enable row level security;
alter table project_jira_projects enable row level security;
alter table epics enable row level security;
alter table project_overrides enable row level security;
alter table tickets enable row level security;
alter table worklogs enable row level security;
alter table ticket_comments enable row level security;
alter table adjustments enable row level security;
alter table project_contributors enable row level security;
alter table project_updates enable row level security;
alter table project_update_tickets enable row level security;
alter table project_features enable row level security;
alter table project_feature_tickets enable row level security;
alter table project_summaries enable row level security;
alter table activity_feed enable row level security;
alter table person_metrics enable row level security;
alter table board_health enable row level security;
alter table risks enable row level security;
alter table standouts enable row level security;
alter table sync_runs enable row level security;

-- Read-only for anon + authenticated; all writes go through the sync
-- script's service_role key, which bypasses RLS entirely.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'teams','people','jira_projects','sprints','status_mapping','projects',
      'project_jira_projects','epics','project_overrides','tickets','worklogs',
      'ticket_comments','adjustments','project_contributors','project_updates',
      'project_update_tickets','project_features','project_feature_tickets',
      'project_summaries','activity_feed','person_metrics','board_health',
      'risks','standouts','sync_runs'
    ])
  loop
    execute format('create policy %I on %I for select using (true);', t || '_read_all', t);
  end loop;
end $$;
