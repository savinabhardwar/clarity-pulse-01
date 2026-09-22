# QA rota — design notes

Per `CLAUDE.md` §8 and `docs/discovery.md` §0.4b: the human chose a
version-controlled config file over `CLAUDE.md` §8's Supabase-Studio
default, for git auditability of who's eligible for QA on each project.

**This is a deliberate split, not the whole rota in one place:**

| Lives in `qa-rota.json` (this dir, git-tracked) | Lives in Supabase (`qa_rota_state`, `qa_assignment_overrides`) |
| --- | --- |
| Who is eligible for QA, per project | The round-robin cursor (who's next) |
| Project Lead (config, rarely changes) | Per-project `paused` flag |
| Availability flag per person | Per-issue overrides + their consumed state |
| Edited by hand, reviewed via a normal PR | Written by the Automation Engine on every QA assignment |

**Why split:** the eligibility list changes rarely and benefits from git's
review/audit trail. The round-robin cursor and per-issue overrides change
on *every* issue entering Testing — writing those into a git file would
mean the Automation Engine committing and pushing to this repo on every
single QA assignment, which is slow, needs repo write credentials on the
automation side, and produces constant commit noise for state nobody needs
to review. Human-confirmed 2026-09-22.

## Person identity: email, not display name

`docs/discovery.md` §0.4b's original wording said "names." This file uses
**email** as the actual matching key instead (with an optional `name`
field for readability) — matched against `users.email`, which is `unique
not null` in the schema (migration 0001). Matching by free-text display
name risks typos and duplicate names; email is the more robust choice
while still being something a human can read and edit directly. This is an
implementation refinement of the original decision, not a reversal of it —
flagged here rather than applied silently.

## Round-robin resolution (not yet implemented)

This task (2.2b) only ships the config file schema and the Supabase state
tables. The actual resolution logic — read `qa-rota.json`, read
`qa_rota_state`/`qa_assignment_overrides`, pick the next eligible person,
surface an exception if the rota is empty/paused/all-unavailable — is task
4.4b's job (Phase 4, Automation Engine), once the Policy/Automation split
exists to run it in.

## Populating this file

`qa-rota.json` currently has an empty `"projects": {}` — **no QA people
have been enumerated yet** (`docs/discovery.md` §0.4b explicitly leaves
this open). Populate it per-project before task 4.4b can assign anything
for that project; an unconfigured project is not an error, it's simply not
in scope for automated QA assignment yet (per `CLAUDE.md` §8: an empty
rota surfaces as an exception when an issue actually reaches Testing, it
doesn't block anything before that).
