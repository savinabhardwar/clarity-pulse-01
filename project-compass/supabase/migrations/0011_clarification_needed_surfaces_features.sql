-- The 0010 migration's own comment claimed that posting a "Clarification
-- Needed" comment on a Features-tab item (request_type is null -- it wasn't
-- created through the Client Requests intake module) would surface it in
-- the Client Requests module. The comment/status flip in
-- stakeholder_item_comments_add already did its half correctly, but the
-- view below never actually implemented the other half: its `where
-- i.request_type is not null` clause silently excluded every such item
-- regardless of status. Widen it to also admit any item currently in
-- Clarification Needed, whatever module it was created through.
create or replace view stakeholder_client_requests as
select
  i.id,
  i.project_id,
  p.name as project_name,
  p.code as project_code,
  i.kind,
  i.request_type,
  i.summary,
  i.description,
  i.status,
  i.status_kind,
  i.priority,
  i.created_by,
  i.required_by,
  i.will_be_done_by,
  i.created_at,
  i.updated_at
from stakeholder_items i
join stakeholder_projects p on p.id = i.project_id
where (i.request_type is not null or i.status = 'Clarification Needed')
  and i.deleted_at is null;
