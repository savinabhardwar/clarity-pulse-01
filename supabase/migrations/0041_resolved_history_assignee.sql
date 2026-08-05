-- resolved_ticket_history already persists resolved tickets durably
-- across cache wipes (used for project_features clustering), but has no
-- assignee -- get_person_detail's "Completed" panel instead reads
-- straight from the live `tickets` table, which the upcoming closed-
-- sprint purge (see purge-closed-sprint-tickets.mjs) will delete rows
-- from. Adding assignee here lets Completed be re-pointed at this durable
-- table (migration 0039) so a person's completed-work history survives
-- their old tickets being purged.
alter table resolved_ticket_history add column if not exists assignee_person_id uuid references people(id);
create index if not exists idx_resolved_ticket_history_assignee on resolved_ticket_history(assignee_person_id);

-- One-time backfill: existing rows predate this column and sync.mjs only
-- ever fetches NEW resolutions going forward (incremental watermark), so
-- without this they'd never get an assignee and Completed would show
-- nothing until fresh completions accumulate. `tickets` still has the
-- assignee for anything not yet purged -- this is the last point it's
-- guaranteed to.
update resolved_ticket_history rth
set assignee_person_id = tk.assignee_person_id
from tickets tk
where tk.jira_key = rth.jira_key and rth.assignee_person_id is null and tk.assignee_person_id is not null;
