-- 0004_fk_indexes.sql
-- Phase 2 task 2.4 — indexes on every FK. Postgres does NOT auto-index
-- foreign key columns (only primary keys get one automatically), so this
-- is real, necessary work, not defensive boilerplate. Skips columns
-- already covered by a leftmost-prefix-matching unique constraint from
-- migrations 0001-0003 (noted inline); adds one for every FK that isn't.
--
-- Partial unique indexes (assignments, qa_assignment_overrides) don't
-- count as coverage here -- they only index the subset of rows matching
-- their WHERE clause, so a query touching non-active/consumed rows would
-- still scan the whole table without a plain index alongside them.

-- projects: no FK columns of its own (requirements_project_id is
-- cross-database, not a real FK).

-- project_configurations
create index project_configurations_project_lead_id_idx on project_configurations (project_lead_id);
-- project_id already covered: unique constraint IS the index.

-- project_members
create index project_members_user_id_idx on project_members (user_id);
-- project_id covered by leftmost prefix of unique(project_id, user_id).

-- requirements
create index requirements_project_id_idx on requirements (project_id);
create index requirements_created_by_idx on requirements (created_by);

-- requirement_assessments
-- requirement_id covered by leftmost prefix of unique(requirement_id, assessment_version).

-- epics
create index epics_project_id_idx on epics (project_id);
-- jira_issue_key already covered: unique constraint IS the index.

-- sprints
-- project_id covered by leftmost prefix of unique(project_id, jira_sprint_id).

-- issues
create index issues_project_id_idx on issues (project_id);
create index issues_assignee_id_idx on issues (assignee_id);
create index issues_sprint_id_idx on issues (sprint_id);
create index issues_epic_id_idx on issues (epic_id);
create index issues_requirement_id_idx on issues (requirement_id);
-- jira_issue_key already covered: unique constraint IS the index.

-- assignments
create index assignments_issue_id_idx on assignments (issue_id); -- partial unique index doesn't cover non-active rows
create index assignments_user_id_idx on assignments (user_id);
create index assignments_assigned_by_idx on assignments (assigned_by);

-- dependencies
-- source_issue_id covered by leftmost prefix of unique(source_issue_id, target_issue_id, dependency_type).
create index dependencies_target_issue_id_idx on dependencies (target_issue_id);

-- branches
create index branches_project_id_idx on branches (project_id);
create index branches_issue_id_idx on branches (issue_id);
create index branches_created_by_idx on branches (created_by);
-- (repository, branch_name) already covered: unique constraint IS the index.

-- commits
create index commits_project_id_idx on commits (project_id);
create index commits_issue_id_idx on commits (issue_id);
create index commits_author_id_idx on commits (author_id);
-- (repository, commit_hash) already covered: unique constraint IS the index.

-- pull_requests
create index pull_requests_project_id_idx on pull_requests (project_id);
create index pull_requests_issue_id_idx on pull_requests (issue_id);
create index pull_requests_author_id_idx on pull_requests (author_id);
-- (repository, external_pr_id) already covered: unique constraint IS the index.

-- qa_runs
-- issue_id covered by leftmost prefix of unique(issue_id, cycle_number).
create index qa_runs_qa_user_id_idx on qa_runs (qa_user_id);

-- qa_rota_state
create index qa_rota_state_last_assigned_user_id_idx on qa_rota_state (last_assigned_user_id);
create index qa_rota_state_updated_by_idx on qa_rota_state (updated_by);
-- project_id already covered: unique constraint IS the index.

-- qa_assignment_overrides
create index qa_assignment_overrides_issue_id_idx on qa_assignment_overrides (issue_id); -- partial unique index doesn't cover consumed rows
create index qa_assignment_overrides_qa_user_id_idx on qa_assignment_overrides (qa_user_id);
create index qa_assignment_overrides_created_by_idx on qa_assignment_overrides (created_by);

-- events.project_id already covered: leftmost prefix of events_project_timestamp_idx (0001).
