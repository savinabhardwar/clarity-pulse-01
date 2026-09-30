-- Adds the "Support Ticket" module to the sidebar (stakeholder_projects).
-- Follows the 0005 seeding convention: kebab-case text id, 3-char uppercase
-- code (STK; unique among existing codes), owner null (no per-project owner
-- has been assigned since 0004), and jira_project_key null because there is
-- no confirmed Jira project counterpart yet -- Jira auto-match simply won't
-- scope to a project until one is set (update jira_project_key later).
-- Idempotent via on conflict (id) do nothing.
insert into stakeholder_projects (id, name, code, jira_project_key, owner, description) values
  ('support-ticket', 'Support Ticket', 'STK', null, null,
   'Support ticket tracking module — capture and follow customer support tickets and the feature requests and implementation work they raise.')
on conflict (id) do nothing;
