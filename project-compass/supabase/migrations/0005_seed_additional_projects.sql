-- Adds the remaining products tracked in Product Pulse
-- (https://product-pulse-15l.pages.dev/) as stakeholder_projects modules.
-- The 4 already seeded in 0004 (cx-pass, agent-assist, knowledge-hub,
-- forecasting) are untouched here. jira_project_key mappings are only set
-- where confident against scripts/jira-sync/fetch-jira-rest.mjs's
-- JIRA_PROJECTS list -- left null where no clear real-Jira-project
-- counterpart exists (call-analyser, post-call-automation, crm, loneworker),
-- so the Jira auto-match feature simply won't scope to a project for those
-- rather than silently searching the wrong one.
insert into stakeholder_projects (id, name, code, jira_project_key, owner, description) values
  ('17e', '17E', '17E', 'AMY', null,
   'AI receptionist product — a low-cost, always-on virtual receptionist that answers every inbound call instantly and either takes a message or escalates to a human.'),
  ('amy', 'Amy', 'AMY', 'AMY', null,
   'AI voice agent platform — lets a business stand up a phone-answering bot, teach it from real calls, and hand off to a human when it can''t help.'),
  ('cx-omni', 'CX Omni', 'CXO', 'CX', null,
   'Chat and messaging platform — an AI chatbot workflow builder plus a live agent console, running automated and human-assisted conversations across a website widget and WhatsApp from one place.'),
  ('keyboardless-agent', 'Keyboardless Agent', 'KBA', 'KA', null,
   'AI agent-assist for call-centre teams — live transcription, sentiment tracking, and reply suggestions that appear on screen while the agent is still on the call.'),
  ('call-analyser', 'Call Analyser', 'CAN', null, null,
   'The automated pipeline that runs AI prompts against call recordings to generate insights — transcription, sentiment, script-flow extraction, and more.'),
  ('qip', 'QIP', 'QIP', 'QIP', null,
   'Quality assurance and coaching platform for call and chat teams — scorecards, evaluations, disputes, coaching, gamified performance, and AI-simulated practice calls.'),
  ('avani', 'AVANI', 'AVN', 'AV', null,
   'All-in-one workforce management platform — employee records, teams, rota and shift scheduling, attendance, leave, documents, tasks, and reporting, rebuilt from the earlier Eledecks product.'),
  ('automated-mis', 'Automated MIS', 'MIS', 'MR', null,
   'Automated management information reporting — AI-generated summaries and reports rolled up across all clients, replacing manual report building.'),
  ('acx-improvements', 'ACX Improvements', 'ACX', 'ACX', null,
   'Ongoing reliability work on ACX, the core telephony platform underneath Amy, Keyboardless Agent, and PBX Manager.'),
  ('billing', 'Billing', 'BIL', 'BL', null,
   'Automated billing platform — consolidating billing processes across the group, replacing manual billing-report generation for individual clients.'),
  ('line-testing', 'Line Testing', 'LTS', 'LT', null,
   'Automated telephone line testing — proactively checking client phone lines are working correctly, without manual engineer checks.'),
  ('post-call-automation', 'Post Call Automation', 'PCA', null, null,
   'Automated post-call engineer callouts — automatically triggering engineer follow-up actions after a call, without manual intervention.'),
  ('pbx-manager', 'PBX Manager', 'PBX', 'PBX', null,
   'The admin console for the shared phone system (ACX) that Amy and Keyboardless Agent also connect to — routing, numbers, agents, and voice messages are configured here.'),
  ('usage-monitoring', 'Usage Monitoring', 'USM', 'UM', null,
   'The shared reporting platform other products (QIP, Knowledge Hub, and more) plug into as a data source — a drag-and-drop dashboard builder for centralized usage and quality reporting.'),
  ('crm', 'CRM', 'CRM', null, null,
   'Customer relationship management systems this platform integrates with for staff, client, and telephony data.'),
  ('loneworker', 'Loneworker', 'LWK', null, null,
   'A worker-safety monitoring system, live in production — checks in on employees working alone via scheduled and on-demand calls, verifies their wellbeing, and automatically escalates if a worker misses a check-in or needs help.')
on conflict (id) do nothing;
