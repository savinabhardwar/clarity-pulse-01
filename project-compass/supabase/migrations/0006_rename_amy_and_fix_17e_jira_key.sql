-- "17E Pro" (the requirement-gathering workbook's name for this product) is
-- the same product as what we seeded as "Amy" -- the real Jira project
-- literally named "Amy(17E Pro)" (key AMY) confirms this. Rename in place,
-- keep the id stable so existing rows/FKs are untouched.
update stakeholder_projects set name = '17E Pro' where id = 'amy';

-- Migration 0005 incorrectly gave plain "17e" the same jira_project_key
-- (AMY) as the Amy/17E Pro product -- but AMY's real Jira project IS
-- "Amy(17E Pro)", not base 17E. There is no separate real Jira project for
-- plain 17E in scripts/jira-sync/fetch-jira-rest.mjs's JIRA_PROJECTS list,
-- so it should have no Jira project key at all (Jira auto-match simply
-- won't scope to a project for it, same as call-analyser/crm/loneworker/etc).
update stakeholder_projects set jira_project_key = null where id = '17e';
