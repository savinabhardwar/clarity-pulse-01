# AI PM Automation

Master Implementation Plan — Product Decisions, Architecture, Database & Build Roadmap

Version 1.0 | September 2026

> **Conversion note (task 0.1):** §6 "Core Database Model" defines **19** table
> definitions (`users`, `projects`, `project_configurations`, `project_members`,
> `requirements`, `requirement_assessments`, `epics`, `issues`, `sprints`,
> `assignments`, `dependencies`, `branches`, `commits`, `pull_requests`,
> `qa_runs`, `bugs`, `pm_brain_entries`, `pm_brain_links`, `events`) — not 26 as
> `IMPLEMENTATION_PLAN.md` task 0.1 expected. Verified by direct extraction from
> the source `.docx` (each is a `###` heading immediately followed by a
> comma-separated field list, counted programmatically). No additional table
> definitions exist elsewhere in the source document — confirmed by scanning
> the full converted text for the same `id, ...` field-list pattern (19 matches,
> all inside §6) and by reviewing every other table/section in the document.
> The human confirmed no other source document exists to check. Tables
> introduced later by `IMPLEMENTATION_PLAN.md` itself but absent from the
> original spec (`qa_rota`, `qa_rota_overrides`, `failed_events`, `action_log`)
> are new platform infrastructure, not part of this count — they get defined in
> their own tasks (2.2b, 3.5, 5.1), not invented here.

# 1. Executive Summary

The system will automate the user's end-to-end project-management workflow around the existing Requirements Gathering App, Jira, Git and QA process. It will add two intelligence foundations: Project Twin for structured operational state/history and PM Brain for controlled contextual memory. An AI PM layer reasons across both, while a deterministic policy/automation engine performs only permitted actions. Human approval remains for consequential decisions.

# 2. Final Target Workflow

Requirement submitted → context-aware LLM assessment → ready or clarification → Jira creation → Project Lead review/estimate/developer assignment → sprint → developer activity → In Progress → PR → merge → Testing → automatic QA assignment → QA → Pass/Done or Fail/Rework → developer cycle → Testing → Done.

# 3. Locked Product Decisions

<!-- table 1 -->

| ID  | Decision                        | Locked choice                                                                                                                                                                                  |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Requirement readiness           | Context-aware LLM uses requirement + Project Twin + PM Brain + Jira/Epic context.                                                                                                              |
| D2  | Requirement approval            | Hybrid: high-confidence straightforward requirements may auto-proceed; uncertain cases require human review.                                                                                   |
| D3  | Project Configuration ownership | PM/Admin only.                                                                                                                                                                                 |
| D4  | Cross-project people            | Yes; people may belong to multiple projects.                                                                                                                                                   |
| D5  | Blocked state                   | Yes; proper Blocked status/state.                                                                                                                                                              |
| D6  | In Progress trigger             | A qualifying Jira comment OR Git activity.                                                                                                                                                     |
| D7  | Development progression         | Event-driven, using the same activity/event principle; exact qualifying event finalized during integration design.                                                                             |
| D8  | Git/Jira matching               | Support issue key, branch, PR title, commit message, PR description and semantic/context matching; exact key strongest.                                                                        |
| D9  | Testing trigger                 | Any associated PR merge for the ticket.                                                                                                                                                        |
| D10 | QA assignment                   | Automatic assignment with PM/Admin override.                                                                                                                                                   |
| D11 | QA PASS requirements            | Test result, comments, test cases executed and evidence.                                                                                                                                       |
| D12 | QA failure reason               | Mandatory reason/category.                                                                                                                                                                     |
| D13 | Bug blocking rules              | Deferred/ignored for initial scope.                                                                                                                                                            |
| D14 | Epic linking                    | High-confidence automatic linking with human override.                                                                                                                                         |
| D15 | Large requirement decomposition | AI recommends Epic + Stories; human approves initially.                                                                                                                                        |
| D16 | Estimation unit                 | Hours.                                                                                                                                                                                         |
| D17 | Developer assignment            | Human-controlled by Project Lead.                                                                                                                                                              |
| D18 | Sprint planning                 | AI recommends; human approves; no automatic active-sprint modification initially.                                                                                                              |
| D19 | Project Configuration           | Project, Requirements App project, Jira project, Git repository, DEV branch, Project Lead, Developers, QA Pool, workflow, QA, sprint, release and notification configuration.                  |
| D20 | Automation override             | PM/Admin.                                                                                                                                                                                      |
| D21 | Backup/fallback people          | No initially.                                                                                                                                                                                  |
| D22 | Source of truth                 | Requirements App for requirements; Jira/workflow for delivery status; Git for coding/PR state; QA/Jira for QA outcome; PM Brain for decisions/context; Project Twin for unified history/state. |
| D23 | Twin storage                    | User's own DB; compact structured model, not a full data dump.                                                                                                                                 |
| D24 | Twin scope                      | Only configured projects.                                                                                                                                                                      |
| D25 | PM Brain contents               | Decisions, meeting notes, stakeholder context, risks, assumptions, hypotheses, important discussions, lessons learned and project context.                                                     |
| D26 | PM Brain ingestion              | User provides/controls the data supplied to PM Brain.                                                                                                                                          |
| D27 | Autonomy                        | Safe deterministic actions may be autonomous; consequential actions remain human-controlled.                                                                                                   |
| D28 | Requirement changes             | Human approval required; AI may suggest changes.                                                                                                                                               |
| D29 | Control Centre priority         | Needs attention, critical risks, blockers, decisions, what changed, project status, deadlines, AI recommendations.                                                                             |
| D30 | Control Centre views            | Global plus individual project views.                                                                                                                                                          |

# 4. System Principles

- Requirements App is the source of truth for incoming requirements.

- Jira is the delivery/workflow system of record.

- Git is the source of truth for development and PR activity.

- QA is the source of truth for testing outcomes.

- Project Twin is a compact, connected operational model, not a replacement for source systems.

- PM Brain stores controlled context and reasoning, not operational ticket state.

- LLM reasons over retrieved context; it is not the database and does not directly execute arbitrary actions.

- Policy Engine decides whether an AI-proposed action is allowed.

- Automation Engine executes permitted actions and records the result.

- Human approval is required for consequential decisions.

# 5. Architecture

Recommended flow: external systems emit webhooks/API events into an Event Ingestion layer. Events are validated, normalized and stored. The current Project Twin state is updated. AI services retrieve only relevant Twin and PM Brain context. AI returns structured decisions. A Policy Engine checks permissions and rules, then the Automation Engine performs allowed actions back into Jira/Git/QA/Requirements App.

Conceptual chain: Requirements App / Jira / Git / QA → Event Engine → Your PostgreSQL DB → Project Twin + PM Brain → AI Engine → Policy Engine → Automation Engine → source systems.

# 6. Core Database Model

Use PostgreSQL as the initial core database. Keep source-system payloads out of the core model except where required for traceability.

### users

id, name, email, role, active, created_at, updated_at

### projects

id, name, code, description, status, requirements_project_id, jira_project_key, git_repository, dev_branch, created_at, updated_at

### project_configurations

id, project_id, jira_project_key, git_repository, dev_branch, project_lead_id, workflow_config, qa_config, sprint_config, release_config, notification_config, is_active, created_at, updated_at

### project_members

id, project_id, user_id, role, active, created_at, updated_at

### requirements

id, project_id, title, description, source_reference, source_url, status, ai_readiness_status, ai_readiness_confidence, ai_readiness_reason, jira_issue_id, created_by, created_at, updated_at

### requirement_assessments

id, requirement_id, assessment_version, decision, confidence, makes_sense, information_sufficient, missing_information, ambiguities, contradictions, related_work, duplicate_candidates, dependencies, scope_concerns, reasoning_summary, created_at

### epics

id, project_id, jira_issue_id, jira_issue_key, title, description, status, created_at, updated_at

### issues

id, project_id, jira_issue_key, jira_issue_id, title, issue_type, status, priority, estimate_hours, lead_estimate_hours, actual_hours, assignee_id, sprint_id, epic_id, requirement_id, created_at, updated_at

### sprints

id, project_id, jira_sprint_id, name, start_date, end_date, status, capacity_hours, planned_hours, completed_hours, created_at, updated_at

### assignments

id, issue_id, user_id, assignment_type, assigned_by, assigned_at, unassigned_at, active

### dependencies

id, source_issue_id, target_issue_id, dependency_type, status, created_at, resolved_at

### branches

id, project_id, repository, branch_name, issue_id, created_by, created_at, last_activity_at

### commits

id, project_id, issue_id, repository, commit_hash, author_id, message, committed_at

### pull_requests

id, project_id, issue_id, repository, external_pr_id, title, url, author_id, source_branch, target_branch, status, created_at, merged_at

### qa_runs

id, issue_id, cycle_number, qa_user_id, status, test_result, comments, test_cases_executed, evidence, failure_reason, started_at, completed_at

### bugs

id, project_id, jira_issue_id, jira_issue_key, parent_issue_id, severity, status, created_at, resolved_at

### pm_brain_entries

id, project_id, type, title, content, source, source_reference, created_by, created_at, updated_at

### pm_brain_links

id, brain_entry_id, entity_type, entity_id, relationship_type

### events

id, source, event_type, project_id, entity_type, entity_id, actor_type, actor_id, timestamp, payload, correlation_id, created_at

# 7. Database Relationships

- projects 1→1 project_configurations

- projects 1→N project_members

- projects 1→N requirements, epics, issues, sprints, branches, commits, pull_requests, qa_runs, bugs, PM Brain entries and events

- requirements 1→N requirement_assessments and 0/1 primary Jira issue link

- epics 1→N issues

- sprints 1→N issues

- issues 1→N assignments, dependencies, branches/commits/PRs as applicable, QA runs and bugs

- PM Brain entries N↔N operational entities through pm_brain_links

- events reference the affected entity and project but remain immutable history.

# 8. Event Architecture

The event store is the Project Flight Recorder. Every meaningful state change should be captured as a normalized event.

<!-- table 2 -->

| Source       | Initial event vocabulary                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Requirements | REQUIREMENT_CREATED, REQUIREMENT_UPDATED, REQUIREMENT_ANALYSIS_COMPLETED, REQUIREMENT_CLARIFICATION_REQUESTED, REQUIREMENT_APPROVED |
| Jira         | ISSUE_CREATED, ISSUE_UPDATED, ISSUE_STATUS_CHANGED, ISSUE_ASSIGNED, ISSUE_ESTIMATE_CHANGED, ISSUE_ADDED_TO_SPRINT                   |
| Git          | BRANCH_CREATED, COMMIT_CREATED, PR_CREATED, PR_UPDATED, PR_APPROVED, PR_MERGED, PR_CLOSED                                           |
| QA           | QA_ASSIGNED, QA_STARTED, QA_FAILED, QA_PASSED, REWORK_CREATED                                                                       |
| Project      | DEPENDENCY_CREATED, DEPENDENCY_RESOLVED, RISK_CREATED, RISK_RESOLVED, RELEASE_CREATED, RELEASE_UPDATED                              |
| PM Brain     | DECISION_CREATED, MEETING_ADDED, RISK_ADDED, CONTEXT_UPDATED                                                                        |

# 9. Event Processing Pipeline

- Receive webhook/API event.

- Authenticate and validate the source.

- Normalize provider-specific payload into the internal event schema.

- Deduplicate using provider event ID/correlation data where available.

- Persist immutable event.

- Resolve project and entity.

- Update current-state tables.

- Evaluate deterministic policies.

- Invoke AI only when reasoning is needed.

- Execute permitted action.

- Record the automation action and result.

- Expose exceptions in the PM Control Centre.

# 10. AI Requirement Intelligence

For each new or updated requirement, retrieve relevant project context rather than sending the entire database to the LLM.

- Requirement content and metadata.

- Relevant Project Twin state and history.

- PM Brain entries explicitly relevant to the project/requirement.

- Existing Jira/Epics and related work.

- Dependencies and potentially conflicting scope.

- Historical similar requirements where useful.

The LLM should return structured output including readiness decision, confidence, missing information, ambiguity, contradictions, related work, duplicate candidates, dependencies, scope concerns and a concise reason.

Possible outcomes: READY, NEEDS_CLARIFICATION, POSSIBLE_DUPLICATE, HUMAN_REVIEW. The policy layer determines whether an outcome can automatically advance the workflow.

# 11. Git ↔ Jira Matching

Use multiple signals, ranked by confidence:

- Explicit Jira issue key.

- Jira key in branch name.

- Jira key in PR title.

- Jira key in commit message.

- Jira key or strong reference in PR description.

- Semantic/contextual matching against issue title, description and project context.

Exact identifiers can be auto-linked. Ambiguous semantic matches should be flagged rather than silently attached to the wrong issue.

# 12. Automation Rules

<!-- table 3 -->

| Trigger                                 | Action                                                            |
| --------------------------------------- | ----------------------------------------------------------------- |
| Requirement ready                       | Create Jira issue and preserve Requirement ↔ Jira link.           |
| High-confidence existing Epic           | Link issue to Epic; allow PM/Admin override.                      |
| Qualifying Jira comment or Git activity | Transition To Do → In Progress.                                   |
| Associated PR merged                    | Transition issue → Testing.                                       |
| Testing entered                         | Automatically assign eligible QA.                                 |
| QA PASS + mandatory fields complete     | Testing → Done.                                                   |
| QA FAIL                                 | Testing → Rework; require failure reason.                         |
| Rework + new developer activity         | Re-enter In Progress and follow the normal Git/DEV/Testing cycle. |

# 13. AI/Policy Safety Model

The LLM must never directly call arbitrary external actions. The safe execution pattern is:

LLM → structured recommendation → Policy Engine → permission/rule check → Automation Engine → external system → event/action log.

- PM/Admin can override AI-driven project automation.

- Requirement changes require human approval.

- Developer assignment remains human-controlled.

- Sprint commitment remains human-approved.

- Major scope/priority/resource decisions remain human-controlled.

- Release decisions remain human-controlled.

- Safe deterministic workflow transitions and reporting may run autonomously.

# 14. PM Brain

PM Brain is a controlled contextual-memory module, not a second Jira.

- Decisions

- Meeting notes

- Stakeholder context

- Risks

- Assumptions

- Hypotheses

- Important discussions

- Lessons learned

- Project context

The user controls the data supplied to PM Brain. PM Brain entries can be linked to requirements, Epics, issues, risks, releases and other Project Twin entities.

# 15. Project Twin

Project Twin represents current operational reality plus historical events and relationships for configured projects only.

- Current state of requirements, Jira work, Git/PRs, QA, dependencies, sprints and releases.

- Event history / project flight recorder.

- Relationships between requirements, Epics, issues, people, code, QA and releases.

- Contradiction detection between systems.

- Stale-work detection.

- Dependency graph.

- Scope-drift detection.

- Risk and bottleneck signals.

- Evidence-backed answers to 'what changed?', 'why is this late?' and similar questions.

The Twin should be compact: store normalized state, IDs, timestamps, relationships and selected metadata; retain source references instead of duplicating complete source-system payloads.

# 16. Project Twin + PM Brain + AI PM

<!-- table 4 -->

| Layer             | Question answered                            | Primary content                                                    |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Project Twin      | What is happening?                           | Structured operational state, relationships and history.           |
| PM Brain          | Why / what context matters?                  | Decisions, meetings, stakeholder context, assumptions and lessons. |
| AI PM             | What does it mean / what should happen next? | Reasoning, prediction, recommendations and controlled actions.     |
| Policy Engine     | Is the action allowed?                       | Rules, permissions and autonomy boundaries.                        |
| Automation Engine | How do we execute it?                        | Jira/Git/QA/Requirements App actions.                              |

# 17. QA and Rework Model

Each QA attempt is a separate qa_runs record. This preserves the complete testing cycle.

PASS requires: test result + comments + test cases executed + evidence. FAIL requires a reason category.

Initial failure categories: developer defect, requirement issue, requirement change, dependency, environment, test data, QA issue, other.

Bug severity/blocking automation is explicitly deferred from the initial implementation.

# 18. Reporting & PM Control Centre

- Global Control Centre plus project-specific views.

- Needs My Attention.

- Critical Risks.

- Blockers.

- Decisions Required.

- What Changed.

- Project Status.

- Upcoming Deadlines.

- AI Recommendations.

The interface should focus on exceptions and decisions rather than flooding the PM with every event.

# 19. Predictive Intelligence — Later Phase

- Schedule/delivery risk.

- Capacity risk.

- QA bottleneck prediction.

- Dependency risk.

- Scope drift.

- Estimate-vs-actual learning.

- PR/review bottlenecks.

- Next-best-action recommendations.

- What-if simulations.

# 20. Implementation Roadmap

<!-- table 5 -->

| Phase    | Focus                       | Deliverables                                                                                        |
| -------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| Phase 1  | Core DB                     | users, projects, project configuration, project members, requirements, issues, events.              |
| Phase 2  | Delivery entities           | Epics, sprints, assignments, dependencies, branches, commits, PRs, QA runs, bugs.                   |
| Phase 3  | Event engine                | Webhook/API ingestion, validation, normalization, deduplication and state updates.                  |
| Phase 4  | Deterministic automation    | Requirement→Jira, activity→In Progress, PR merge→Testing, QA assignment, QA PASS→Done, FAIL→Rework. |
| Phase 5  | PM Brain                    | Controlled context/decision storage and links.                                                      |
| Phase 6  | Project Twin                | Current-state model, event history, relationships and contradiction detection.                      |
| Phase 7  | AI Requirement Intelligence | Context-aware readiness, related work, duplicates, Epic intelligence.                               |
| Phase 8  | AI delivery intelligence    | Estimation, risk, scope, dependency and reporting intelligence.                                     |
| Phase 9  | PM Control Centre           | Global/project views, exceptions, decisions, what changed and Ask AI PM.                            |
| Phase 10 | Predictive + autonomy       | Forecasting, bottleneck prediction, next-best-action and progressive autonomous actions.            |

# 21. Build Order — What to Do First

- Finalize exact Jira status names and allowed transitions against the existing Jira configuration.

- Confirm the exact Requirements App fields and API/webhook capabilities.

- Confirm Jira integration method and available webhooks/APIs.

- Confirm Git provider and webhook/event capabilities.

- Confirm QA data location/API and how QA results are currently recorded.

- Implement PostgreSQL schema and migrations.

- Implement Project Configuration CRUD with PM/Admin permissions.

- Implement the normalized event model and event ingestion service.

- Connect Requirements App first, then Jira, Git and QA.

- Implement deterministic workflow automation before adding autonomous AI.

- Add PM Brain storage/retrieval.

- Build Project Twin current state and event history.

- Implement the first AI feature: requirement readiness.

- Add Epic intelligence, risk, scope, reporting and other agents incrementally.

- Add governance, action logs, shadow mode and kill switch before expanding autonomy.

# 22. Open Technical Decisions to Resolve Before Coding

<!-- table 6 -->

| Decision                                           | Why it matters                                               | Status                        |
| -------------------------------------------------- | ------------------------------------------------------------ | ----------------------------- |
| Exact Jira status names and transition IDs         | Automation must target the real workflow.                    | Need verification in Jira.    |
| Requirements App API/webhooks                      | Determines event ingestion and Jira creation implementation. | Need technical details.       |
| Jira deployment/API model                          | Determines authentication and webhook approach.              | Need technical details.       |
| Git provider                                       | Determines PR/commit webhook contracts.                      | Need confirmation.            |
| QA system/data source                              | Determines QA event ingestion and PASS/FAIL enforcement.     | Need confirmation.            |
| Authentication/authorization model                 | Determines PM/Admin permissions and service credentials.     | Need design.                  |
| Event deduplication strategy                       | Prevents duplicate actions.                                  | Design during implementation. |
| Idempotency strategy                               | Prevents repeated Jira transitions/assignments.              | Design during implementation. |
| LLM provider/model and structured-output mechanism | Determines AI implementation details and cost/latency.       | Select during AI phase.       |
| Observability/logging                              | Required to debug automation safely.                         | Required before production.   |

# 23. Non-Goals for Initial Version

- Do not replace Jira.

- Do not replace Git.

- Do not build a full PM Brain knowledge product separate from the platform.

- Do not automatically assign developers.

- Do not automatically commit active sprint changes.

- Do not automatically change approved requirements.

- Do not implement bug severity/blocking automation initially.

- Do not ingest every company project; only configured projects.

- Do not copy complete source-system payloads into the Project Twin.

# 24. Definition of Success

- A complete requirement can move from Requirements App to Jira without PM ticket creation work.

- Unclear requirements are routed back with specific missing information.

- Developer activity is reflected in Jira automatically.

- PRs are reliably associated with Jira.

- Merged work automatically enters Testing.

- QA is automatically assigned and PASS cannot bypass required QA data.

- QA failures become measurable rework cycles.

- Project Twin can reconstruct project state and history.

- PM Brain provides controlled context to AI reasoning.

- PM Control Centre surfaces exceptions rather than routine activity.

- Every autonomous action is traceable and reversible/overridable where applicable.

- AI accuracy is measurable against real outcomes.

# 25. Immediate Next Deliverable

The next engineering artifact should be the concrete PostgreSQL ERD/schema and migration plan, followed by the exact event contracts for Requirements App, Jira, Git and QA. After those are validated against the real systems, implementation can begin with the core database and event engine.

# 26. Detailed Implementation Plan

This section converts the product decisions into an execution plan. The implementation should proceed from deterministic foundations to intelligence and then controlled autonomy. Each phase has a clear objective, dependencies, outputs and acceptance criteria.

## Phase 0 — Discovery & System Verification

- Map the current Requirements App workflow and APIs.

- Map the current Jira projects, issue types, statuses, transitions, fields and permissions.

- Identify the Git provider, repositories, DEV branches and webhook capabilities.

- Map the existing QA process, fields, evidence storage and result mechanism.

- Confirm authentication, service accounts, webhook security and environments.

- Create a source-to-source field mapping document.

Output: integration inventory, field mapping, workflow map and technical constraints.

Exit criteria: all source systems and required events are technically understood before core implementation begins.

## Phase 1 — Core Platform & PostgreSQL

- Create the PostgreSQL database and migrations.

- Implement users, projects, project configurations and project members.

- Implement requirements, requirement assessments, Epics, issues and sprints.

- Implement assignments, dependencies, branches, commits, pull requests, QA runs and bugs.

- Implement PM Brain entries and links.

- Implement the immutable events table.

- Add foreign keys, unique constraints, indexes and audit timestamps.

Output: working database schema and seed/configuration mechanism.

Exit criteria: records can be created, related and queried without depending on AI.

## Phase 2 — Project Configuration

- Build PM/Admin-only configuration screens/API.

- Configure Jira project, Requirements App project, Git repository and DEV branch.

- Configure Project Lead, developers and QA pool.

- Configure workflow, QA, sprint, release and notification settings.

- Support people belonging to multiple projects.

- Validate configuration before a project can be activated.

Output: reusable project configuration layer.

Exit criteria: a new configured project can be onboarded without changing application code.

## Phase 3 — Event Engine

- Build webhook/API ingestion.

- Authenticate and validate inbound events.

- Normalize provider-specific events into internal event types.

- Add idempotency and duplicate-event handling.

- Persist every accepted event.

- Resolve the project and affected entity.

- Update current-state tables.

- Create correlation IDs for multi-step workflows.

- Add retry and dead-letter handling for failed processing.

Output: reliable internal event bus/processing layer.

Exit criteria: source-system events can be replayed safely and produce the same intended state without duplicate actions.

## Phase 4 — Deterministic Workflow Automation

- Requirement ready → create Jira and preserve the requirement link.

- Qualifying Jira comment or Git activity → In Progress.

- Associate Git activity with Jira using ranked matching signals.

- Any associated PR merge → Testing.

- Testing → automatic QA assignment.

- QA PASS with required fields → Done.

- QA FAIL → Rework with mandatory failure reason.

- Rework + new work → In Progress and repeat the normal delivery cycle.

- Record every automated action and outcome.

Output: end-to-end automated delivery workflow.

Exit criteria: the core workflow works reliably without AI being required for deterministic transitions.

## Phase 5 — PM Brain

- Implement controlled ingestion of user-provided project context.

- Store decisions, meeting notes, stakeholder context, risks, assumptions, hypotheses, important discussions, lessons and project context.

- Link PM Brain entries to operational entities.

- Implement search/retrieval by project and linked entity.

- Add version/history for context updates where required.

Output: contextual memory layer.

Exit criteria: relevant project context can be retrieved alongside operational state.

## Phase 6 — Project Twin

- Build current-state views across Requirements App, Jira, Git and QA.

- Build the project event timeline/flight recorder.

- Build relationships between requirements, Epics, issues, people, code, QA, dependencies and releases.

- Detect contradictions between source systems.

- Detect stale work and missing relationships.

- Expose evidence-backed project state to the AI layer.

Output: live Project Twin for configured projects.

Exit criteria: the system can answer what is happening, what changed and how entities are connected.

## Phase 7 — AI Requirement Intelligence

- Retrieve requirement, Project Twin, PM Brain and relevant Jira context.

- Assess whether the requirement makes sense.

- Assess whether information is sufficient.

- Identify ambiguity, missing information, contradictions, related work and possible duplicates.

- Return structured readiness decisions and confidence.

- Auto-proceed only for configured high-confidence cases.

- Route uncertain cases for human review.

- Re-run assessment automatically when the requester updates the requirement.

Output: context-aware requirement gate.

Exit criteria: requirements can be consistently routed to Ready, Clarification or Review with explainable evidence.

## Phase 8 — Epic, Estimation & Delivery Intelligence

- Find and link high-confidence existing Epics.

- Recommend decomposition of large requirements into Epic + Stories.

- Compare AI estimates with Project Lead estimates and actual hours.

- Build historical estimate calibration.

- Detect scope changes and potential scope creep.

- Identify dependencies and delivery risks.

- Generate recommendations without taking over human-controlled developer assignment.

Output: intelligence that improves planning quality.

Exit criteria: recommendations are traceable to project/historical evidence and can be overridden.

## Phase 9 — PM Control Centre

- Build global and project-specific views.

- Show Needs My Attention, Critical Risks, Blockers, Decisions Required, What Changed, Project Status, Upcoming Deadlines and AI Recommendations.

- Provide evidence behind each alert.

- Provide Ask AI PM using Project Twin + PM Brain context.

- Allow PM/Admin overrides.

- Surface automation failures and unresolved exceptions.

Output: single PM operating interface.

Exit criteria: routine workflow activity is largely invisible while exceptions and decisions are surfaced clearly.

## Phase 10 — Predictive Intelligence

- Forecast delivery and schedule risk.

- Predict QA bottlenecks and capacity constraints.

- Detect dependency risk.

- Predict likely sprint carry-forward.

- Identify recurring estimate/rework patterns.

- Build what-if analysis for staffing, dates, scope and dependencies.

- Measure prediction accuracy against outcomes.

Output: predictive Project Twin/AI PM.

Exit criteria: predictions have measurable accuracy and show supporting evidence/confidence.

## Phase 11 — Governance & Progressive Autonomy

- Implement AI Action Log.

- Implement shadow mode before expanding autonomous actions.

- Implement PM/Admin override.

- Implement global automation kill switch.

- Define policy checks for every executable AI action.

- Allow autonomous execution only for approved low-risk deterministic actions.

- Measure AI estimate accuracy, recommendation acceptance, assignment accuracy, false alerts, reversals and automation failures.

- Gradually expand autonomy only where reliability is demonstrated.

Output: governed autonomous PM system.

Exit criteria: every autonomous action is attributable, policy-checked, observable and controllable.

# 27. Implementation Workstreams

<!-- table 7 -->

| Workstream      | Owns                                             | Depends On             | Primary Deliverable |
| --------------- | ------------------------------------------------ | ---------------------- | ------------------- |
| Backend / DB    | PostgreSQL, APIs, entities, migrations           | Phase 0                | Core platform       |
| Integrations    | Requirements App, Jira, Git, QA adapters         | Phase 0                | Source connectivity |
| Event Platform  | Webhooks, normalization, idempotency, retries    | Backend + Integrations | Event engine        |
| Workflow Engine | Deterministic policies and actions               | Event Platform         | Automated lifecycle |
| PM Brain        | Context storage/retrieval                        | Backend + Project Twin | Context layer       |
| Project Twin    | State, relationships, history, contradictions    | Event Platform         | Operational model   |
| AI Platform     | LLM orchestration, retrieval, structured outputs | Twin + PM Brain        | AI PM capabilities  |
| Control Centre  | Global/project UI, exceptions, Ask AI PM         | AI + Twin              | PM interface        |
| Governance      | Action log, approvals, policies, kill switch     | Workflow + AI          | Safe autonomy       |

# 28. MVP Definition

The first production-capable MVP should stop after the deterministic workflow plus the first Project Twin/AI requirement capability.

- Project Configuration works.

- Requirements can be ingested and tracked.

- Requirement readiness can be assessed.

- Ready requirements create Jira tickets and preserve links.

- Developer activity can transition work to In Progress.

- Git/Jira association works using exact and supported contextual signals.

- Associated PR merge moves work to Testing.

- QA is automatically assigned.

- QA PASS requires the four mandatory QA fields.

- QA FAIL creates Rework with a mandatory reason.

- All important events are stored.

- Project Twin can show current state and history.

- PM Brain can store and retrieve user-provided context.

- AI actions are structured, logged and policy-checked.

# 29. Testing Strategy

- Unit-test all state transitions and policy rules.

- Integration-test every source-system event against expected Project Twin state.

- Test duplicate and out-of-order events.

- Test webhook retries and partial failures.

- Test incorrect or ambiguous Jira/Git matching.

- Test permission boundaries for PM/Admin overrides.

- Test QA PASS validation and FAIL/rework cycles.

- Test AI structured-output validation and fallback behaviour.

- Use synthetic/sandbox projects before production.

- Run shadow mode for new autonomous actions before enabling them.

# 30. Production Readiness Checklist

- Authentication and secrets management configured.

- Webhook signatures validated.

- Database backups and recovery tested.

- Audit/event retention defined.

- Idempotency implemented.

- Retries and dead-letter handling implemented.

- Monitoring and alerting implemented.

- AI costs and rate limits monitored.

- AI action log available.

- PM/Admin override tested.

- Global kill switch tested.

- Source-system permissions follow least privilege.

- Failure modes documented.

- Rollback/recovery procedures documented.

# 31. Immediate Next Step

The next engineering session should produce the exact PostgreSQL ERD and SQL migration specification. After that, produce the event contract specification for Requirements App, Jira, Git and QA. Only then begin implementation of the database and event engine.
