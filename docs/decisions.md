# decisions.md — Locked Product Decisions (D1–D30)

Extracted verbatim from `docs/spec.md` §3 ("Locked Product Decisions"). These
are locked per `CLAUDE.md` — do not silently revise one; if a decision
conflicts with what a real external system allows, stop and ask (see
`CLAUDE.md` §7).

| ID | Decision | Locked choice |
| --- | --- | --- |
| D1 | Requirement readiness | Context-aware LLM uses requirement + Project Twin + PM Brain + Jira/Epic context. |
| D2 | Requirement approval | Hybrid: high-confidence straightforward requirements may auto-proceed; uncertain cases require human review. |
| D3 | Project Configuration ownership | PM/Admin only. |
| D4 | Cross-project people | Yes; people may belong to multiple projects. |
| D5 | Blocked state | Yes; proper Blocked status/state. |
| D6 | In Progress trigger | A qualifying Jira comment OR Git activity. |
| D7 | Development progression | Event-driven, using the same activity/event principle; exact qualifying event finalized during integration design. |
| D8 | Git/Jira matching | Support issue key, branch, PR title, commit message, PR description and semantic/context matching; exact key strongest. |
| D9 | Testing trigger | Any associated PR merge for the ticket. |
| D10 | QA assignment | Automatic assignment with PM/Admin override. |
| D11 | QA PASS requirements | Test result, comments, test cases executed and evidence. |
| D12 | QA failure reason | Mandatory reason/category. |
| D13 | Bug blocking rules | Deferred/ignored for initial scope. |
| D14 | Epic linking | High-confidence automatic linking with human override. |
| D15 | Large requirement decomposition | AI recommends Epic + Stories; human approves initially. |
| D16 | Estimation unit | Hours. |
| D17 | Developer assignment | Human-controlled by Project Lead. |
| D18 | Sprint planning | AI recommends; human approves; no automatic active-sprint modification initially. |
| D19 | Project Configuration | Project, Requirements App project, Jira project, Git repository, DEV branch, Project Lead, Developers, QA Pool, workflow, QA, sprint, release and notification configuration. |
| D20 | Automation override | PM/Admin. |
| D21 | Backup/fallback people | No initially. |
| D22 | Source of truth | Requirements App for requirements; Jira/workflow for delivery status; Git for coding/PR state; QA/Jira for QA outcome; PM Brain for decisions/context; Project Twin for unified history/state. |
| D23 | Twin storage | User's own DB; compact structured model, not a full data dump. |
| D24 | Twin scope | Only configured projects. |
| D25 | PM Brain contents | Decisions, meeting notes, stakeholder context, risks, assumptions, hypotheses, important discussions, lessons learned and project context. |
| D26 | PM Brain ingestion | User provides/controls the data supplied to PM Brain. |
| D27 | Autonomy | Safe deterministic actions may be autonomous; consequential actions remain human-controlled. |
| D28 | Requirement changes | Human approval required; AI may suggest changes. |
| D29 | Control Centre priority | Needs attention, critical risks, blockers, decisions, what changed, project status, deadlines, AI recommendations. |
| D30 | Control Centre views | Global plus individual project views. |

## Notes on interpretation

- D10 (QA assignment) is deliberately reinterpreted in `CLAUDE.md` §3a as
  "automatic assignment from a human-curated rota," not "human assigns each
  ticket." That reinterpretation is recorded there, not here — this file is
  the unmodified source decision table.
- D7's "exact qualifying event" is explicitly left open by the spec itself and
  is the subject of `IMPLEMENTATION_PLAN.md` task 4.4's check (define the
  qualifying comment/event and get human sign-off before coding it).
