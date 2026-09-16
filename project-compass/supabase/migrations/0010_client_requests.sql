-- Client Requests module.
--
-- Adds a `request_type` to stakeholder_items so items created through the new
-- global "Client Requests" intake module (Product Enhancement / Product Bug /
-- New Request / Client Onboarding onto Platforms) can be identified and
-- listed across all projects in one place, while remaining the exact same
-- row shown in that project's Features/Client Requests tab -- no duplication,
-- no separate table. `kind` (feature vs implementation) is still what
-- actually routes an item to its project tab; request_type is metadata about
-- *why* the item exists, plus the module's membership marker (null = created
-- directly in a project, not through this module, per product decision).
--
-- Also adds typed comments (`clarification` vs `updates`) so that posting a
-- "Clarification Needed" comment on a Features-tab item can atomically flip
-- the item's status, which the Client Requests module then surfaces (see
-- stakeholder_item_comments_add below).

create type request_type as enum (
  'product_enhancement',
  'product_bug',
  'new_request',
  'client_onboarding'
);

alter table stakeholder_items add column request_type request_type;
create index on stakeholder_items (request_type);

alter table stakeholder_item_comments
  add column comment_type text not null default 'updates'
  check (comment_type in ('clarification', 'updates'));

-- ---------------------------------------------------------------------------
-- stakeholder_items_create/update gain p_request_type -- signature change,
-- so drop + recreate (same convention as prior migrations in this file set).
-- ---------------------------------------------------------------------------

drop function stakeholder_items_create(
  text, item_kind, text, text, text, status_kind, priority, text, date, date, text
);
drop function stakeholder_items_update(
  uuid, text, text, text, status_kind, priority, text, date, date, text
);

create function stakeholder_items_create(
  p_project_id text,
  p_kind item_kind,
  p_summary text,
  p_description text,
  p_status text,
  p_status_kind status_kind,
  p_priority priority,
  p_created_by text,
  p_required_by date,
  p_will_be_done_by date,
  p_actor text,
  p_request_type request_type default null
) returns stakeholder_items
language plpgsql
security definer
set search_path = public
as $$
declare
  result stakeholder_items;
begin
  perform set_config('app.current_actor', p_actor, true);
  insert into stakeholder_items(
    project_id, kind, summary, description,
    status, status_kind, priority, created_by, required_by, will_be_done_by, request_type
  ) values (
    p_project_id, p_kind, p_summary, p_description,
    p_status, p_status_kind, p_priority, p_created_by, p_required_by, p_will_be_done_by, p_request_type
  )
  returning * into result;
  return result;
end;
$$;

create function stakeholder_items_update(
  p_id uuid,
  p_summary text,
  p_description text,
  p_status text,
  p_status_kind status_kind,
  p_priority priority,
  p_created_by text,
  p_required_by date,
  p_will_be_done_by date,
  p_actor text,
  p_request_type request_type default null
) returns stakeholder_items
language plpgsql
security definer
set search_path = public
as $$
declare
  result stakeholder_items;
begin
  perform set_config('app.current_actor', p_actor, true);
  update stakeholder_items set
    summary = p_summary,
    description = p_description,
    status = p_status,
    status_kind = p_status_kind,
    priority = p_priority,
    created_by = p_created_by,
    required_by = p_required_by,
    will_be_done_by = p_will_be_done_by,
    request_type = p_request_type,
    updated_at = now()
  where id = p_id and deleted_at is null
  returning * into result;
  if result.id is null then
    raise exception 'Item % not found or already deleted', p_id;
  end if;
  return result;
end;
$$;

grant execute on function stakeholder_items_create(
  text, item_kind, text, text, text, status_kind, priority, text, date, date, text, request_type
) to anon, authenticated;
grant execute on function stakeholder_items_update(
  uuid, text, text, text, status_kind, priority, text, date, date, text, request_type
) to anon, authenticated;

-- request_type joins the audit trigger's tracked columns.
create or replace function stakeholder_items_audit() returns trigger
language plpgsql
as $$
declare
  cols text[] := array['summary','description','status','status_kind',
                        'priority','created_by','required_by','will_be_done_by',
                        'deleted_at','request_type'];
  col text;
  old_v text;
  new_v text;
  actor text;
begin
  actor := coalesce(current_setting('app.current_actor', true), 'unknown');
  if tg_op = 'INSERT' then
    insert into stakeholder_item_history(item_id, event_type, changed_by)
      values (new.id, 'created', actor);
    return new;
  elsif tg_op = 'UPDATE' then
    foreach col in array cols loop
      execute format('select ($1).%I::text, ($2).%I::text', col, col) into old_v, new_v using old, new;
      if old_v is distinct from new_v then
        insert into stakeholder_item_history(item_id, event_type, field_name, old_value, new_value, changed_by)
          values (new.id, 'updated', col, old_v, new_v, actor);
      end if;
    end loop;
    return new;
  elsif tg_op = 'DELETE' then
    insert into stakeholder_item_history(item_id, event_type, changed_by)
      values (old.id, 'deleted', actor);
    return old;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Typed comment insert. Security-definer (unlike the plain RLS insert this
-- replaces) because a 'clarification' comment also needs to update
-- stakeholder_items.status -- a table anon has no direct write policy on.
-- ---------------------------------------------------------------------------

create function stakeholder_item_comments_add(
  p_item_id uuid,
  p_author_name text,
  p_author_email text,
  p_body text,
  p_comment_type text,
  p_actor text
) returns stakeholder_item_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  result stakeholder_item_comments;
begin
  if p_comment_type not in ('clarification', 'updates') then
    raise exception 'Invalid comment_type: %', p_comment_type;
  end if;

  insert into stakeholder_item_comments(item_id, author_name, author_email, body, comment_type)
  values (p_item_id, p_author_name, p_author_email, p_body, p_comment_type)
  returning * into result;

  if p_comment_type = 'clarification' then
    perform set_config('app.current_actor', p_actor, true);
    update stakeholder_items
      set status = 'Clarification Needed', status_kind = 'stakeholder', updated_at = now()
      where id = p_item_id and deleted_at is null;
  end if;

  return result;
end;
$$;

grant execute on function stakeholder_item_comments_add(
  uuid, text, text, text, text, text
) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client Requests module feed: every item created through that module
-- (request_type is not null), across all projects, with the project name/code
-- for display. Ordering (Clarification Needed first) is applied client-side
-- since it depends on the live `status` string, not a stored flag.
-- ---------------------------------------------------------------------------

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
where i.request_type is not null
  and i.deleted_at is null;

grant select on stakeholder_client_requests to anon, authenticated;
