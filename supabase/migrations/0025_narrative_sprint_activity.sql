-- generate-narratives.mjs now computes "hours this sprint" and "hours
-- remaining" itself, from worklog/comment activity on or after the
-- sprint start date, rather than each Jira board's own tracked-sprint
-- window -- and separately flags oversized tickets (>35h estimate) that
-- need breaking down instead of folding their raw estimate into the
-- total. These numbers supersede v_projects_overview's hours_this_sprint
-- for Executive Compass specifically; the main engineering dashboard
-- (People/Projects/Team Health) is untouched.
alter table project_narratives add column hours_logged_since_sprint_start numeric(8, 1) not null default 0;
alter table project_narratives add column hours_remaining_since_sprint_start numeric(8, 1) not null default 0;
alter table project_narratives add column needs_breakdown_count smallint not null default 0;
