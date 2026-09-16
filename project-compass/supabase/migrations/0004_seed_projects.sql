-- Same 4 projects as the prototype's hardcoded PROJECTS array, now with
-- jira_project_key mapped to the real Jira project keys tracked by
-- scripts/jira-sync/fetch-jira-rest.mjs's JIRA_PROJECTS list (same Jira org)
-- -- this is what scopes the summary-match search in find-jira-match.ts.
insert into stakeholder_projects (id, name, code, jira_project_key, owner, description) values
  ('cx-pass', 'CX Pass', 'CXP', 'CP',
   'Alex Moreno', 'Customer experience entitlement passes across support channels.'),
  ('agent-assist', 'Agent Assist', 'AGA', 'AA',
   'Sarah Whitfield', 'Realtime agent guidance, suggested replies and next-best actions.'),
  ('knowledge-hub', 'Knowledge Hub', 'KNH', 'KH',
   'Priya Nair', 'Central knowledge base authoring, review and publication workflow.'),
  ('forecasting', 'Forecasting', 'FCT', 'FR',
   'Daniel Okafor', 'Volume and staffing forecasts with scenario planning.')
on conflict (id) do nothing;
