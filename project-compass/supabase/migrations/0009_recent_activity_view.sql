-- Global "Recent Activity" feed: a read-only view joining
-- stakeholder_item_history to its item + project, so the whole dashboard's
-- activity (creates, edits, and soft-deletes -- which today show up as an
-- 'updated' event on the deleted_at field, since items are never hard
-- deleted) can be surfaced without opening a specific item. A soft-deleted
-- item still passes deleted_at is null filters elsewhere and disappears from
-- every list, but its history rows remain, and this view (LEFT JOIN, no
-- deleted_at filter) still surfaces them -- that's the whole point.
--
-- LEFT JOINs throughout: a history row for a hard-deleted item (never
-- happens today, but the schema doesn't forbid it) or an orphaned project
-- reference must still show up, just with null item/project columns.

create or replace view stakeholder_recent_activity as
select
  h.id,
  h.item_id,
  h.event_type,
  h.field_name,
  h.old_value,
  h.new_value,
  h.changed_by,
  h.changed_at,
  i.summary as item_summary,
  i.kind,
  i.project_id,
  p.name as project_name,
  p.code as project_code
from stakeholder_item_history h
left join stakeholder_items i on i.id = h.item_id
left join stakeholder_projects p on p.id = i.project_id;

-- Views run with the querying role's privileges by default in Postgres
-- (i.e. NOT security definer/invoker owner-only), but to be explicit and
-- consistent with this app's existing "anon can read everything" posture
-- (the *_read_all policies in 0002_stakeholder_rls_and_functions.sql), grant
-- select on the view directly rather than relying on implicit inheritance.
grant select on stakeholder_recent_activity to anon, authenticated;
