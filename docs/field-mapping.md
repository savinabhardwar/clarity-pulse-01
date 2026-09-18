# field-mapping.md — Source system field → internal field

Per `IMPLEMENTATION_PLAN.md` task 0.6. For each source, map its real payload
fields to the internal model defined in `docs/spec.md` §6 and
`docs/event-contracts.md`. No row may be filled in until the real payload
shape has been observed (`CLAUDE.md` §3 rule 2).

---

## Jira

Verified live against the LT project (see `docs/discovery.md` §0.2) plus
existing production code in `scripts/jira-sync/fetch-jira-rest.mjs`. Not yet
confirmed for any project beyond LT.

### Issue payload → `issues` / `epics` / `bugs`

| Jira field                              | Internal field                                 | Notes                                                                                                |
| --------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `key`                                   | `jira_issue_key`                               | e.g. `LT-27`                                                                                         |
| `id`                                    | `jira_issue_id`                                |                                                                                                      |
| `fields.project.key`                    | (resolves `project_id` via config)             |                                                                                                      |
| `fields.summary`                        | `title`                                        |                                                                                                      |
| `fields.issuetype.name`                 | `issue_type`                                   | LT has Epic, Story, Task, Sub-task, Bug, QAlity Test, Change Control — last two not in original spec |
| `fields.status.name` / `.id`            | `status`                                       | per-project vocabulary, see discovery.md mismatch list                                               |
| `fields.priority.name`                  | `priority`                                     |                                                                                                      |
| `fields.assignee.accountId`             | `assignee_id` (resolve to internal `users.id`) |                                                                                                      |
| `fields.timeoriginalestimate` (seconds) | `estimate_hours` (convert)                     | native Jira field, not a custom field                                                                |
| `fields.timespent` (seconds)            | `actual_hours` (convert)                       |                                                                                                      |
| `fields.parent.key`                     | `epic_id` (resolve)                            | only present when parented                                                                           |
| `fields.created` / `fields.updated`     | `created_at` / `updated_at`                    |                                                                                                      |

### Sprint payload → `sprints`

| Jira field                                        | Internal field                                        | Notes                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| sprint object's `id` (inside `customfield_10020`) | `jira_sprint_id`                                      | not a separate REST resource in current usage — read off the issue's sprint custom field |
| `name`                                            | `name`                                                |                                                                                          |
| `startDate` / `endDate`                           | `start_date` / `end_date`                             |                                                                                          |
| `state` (`active`/`closed`/`future`)              | `status`                                              | existing pipeline only uses `active`                                                     |
| `goal`                                            | (not in spec's `sprints` columns — optional addition) | Jira returns `""` not omitted when unset; normalize to `null`                            |

### Custom fields (estimate hours, QA-related)

| Jira custom field ID | Internal field                                                         | Notes                                                                              |
| -------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `customfield_10020`  | (sprint resolution, not a stored column)                               | instance-wide Sprint field                                                         |
| `customfield_10690`  | `qa_user_id` (candidate) on `assignments`/`issues`                     | "QA Assignee" — instance-global, added for ACX, may appear on any project's issues |
| `customfield_10691`  | (QA planned hours — not in original spec's `qa_runs`/`issues` columns) | returns plain hours as a number, not seconds                                       |

**No field exists yet** for D11's four mandatory QA PASS fields (test result,
comments, test cases executed, evidence) — see `docs/discovery.md` §0.4.

---

## Requirements Gathering App (project-compass)

Verified against `project-compass/supabase/migrations/0001_stakeholder_schema.sql`,
`0010_client_requests.sql`, `0012_client_request_decisions.sql`. See
`docs/discovery.md` §0.3 for the full schema notes.

### Requirement payload → `requirements`

| project-compass field (`stakeholder_items`) | Internal field                                                                                                           | Notes                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `id`                                        | `source_reference`                                                                                                       | uuid                                                                                  |
| `project_id`                                | (resolve to internal `project_id` via `jira_project_key` on `stakeholder_projects`)                                      | project-compass only has ~4 configured projects today                                 |
| `summary`                                   | `title`                                                                                                                  |                                                                                       |
| `description`                               | `description`                                                                                                            |                                                                                       |
| `jira_url`                                  | `source_url` (or the reverse — this app currently uses Jira as ONE OF its own fields, not as the pure downstream target) | see discovery.md — write-back path doesn't exist automated yet                        |
| `jira_key`                                  | `jira_issue_id`/`jira_issue_key` (once resolved)                                                                         | populated today via manual human-assisted match (`find-jira-match.ts`), not automatic |
| `status` + `status_kind`                    | `status` (needs its own mapping table — two parallel vocabularies)                                                       | see discovery.md's stakeholder status list                                            |
| `created_by`                                | `created_by` (resolve to internal `users.id`)                                                                            | currently free text, not a user FK                                                    |
| `created_at` / `updated_at`                 | `created_at` / `updated_at`                                                                                              | `updated_at` is the natural polling cursor, see event-contracts.md                    |

No field maps to `ai_readiness_status` / `ai_readiness_confidence` /
`ai_readiness_reason` — those are populated by our own Phase 6 assessment,
not sourced from project-compass.

---

## Git provider

### Branch payload → `branches`

| Git field | Internal field | Notes |
| --------- | -------------- | ----- |
|           |                |       |

### Commit payload → `commits`

| Git field | Internal field | Notes |
| --------- | -------------- | ----- |
|           |                |       |

### Pull request payload → `pull_requests`

| Git field | Internal field | Notes |
| --------- | -------------- | ----- |
|           |                |       |

---

## QA source

### QA result payload → `qa_runs`

| QA field | Internal field | Notes |
| -------- | -------------- | ----- |
|          |                |       |
