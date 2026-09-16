-- Multi-project client requests ("decisions").
--
-- The Client Requests intake form previously required exactly one Project.
-- Now a requester can select multiple candidate projects; when they do, the
-- item becomes a *decision*: it has no project yet (project_id is null), so
-- it does NOT show up in any project's module -- only in the global Client
-- Requests module, flagged as needing a destination. Once someone picks the
-- single destination project (stakeholder_items_assign_project), the item
-- gets that project_id and immediately starts showing in that project's
-- module too, while it keeps showing in Client Requests exactly as before --
-- nothing is ever deleted or moved out of that module, only assigned.

alter table stakeholder_items alter column project_id drop not null;

-- The set of projects a decision item was proposed for. Only populated when
-- an item was created with 2+ projects (project_id null at that point); a
-- directly-routed item (single project picked, or created straight from a
-- project's own module) has no rows here.
create table stakeholder_item_candidate_projects (
  item_id uuid not null references stakeholder_items(id) on delete cascade,
  project_id text not null references stakeholder_projects(id),
  created_at timestamptz not null default now(),
  primary key (item_id, project_id)
);
create index on stakeholder_item_candidate_projects (item_id);

alter table stakeholder_item_candidate_projects enable row level security;
create policy stakeholder_item_candidate_projects_read_all
  on stakeholder_item_candidate_projects for select using (true);
-- No write policy: only written by stakeholder_items_create_request below.

-- project_id joins the audit trigger's tracked columns, so assigning a
-- decision to a project shows up in that item's history.
create or replace function stakeholder_items_audit() returns trigger
language plpgsql
as $$
declare
  cols text[] := array['project_id','summary','description','status','status_kind',
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
-- stakeholder_items_create_request: the Client Requests intake module's
-- creation path (distinct from stakeholder_items_create, which is used by
-- a project's own Features/Client Requests tab and always has exactly one
-- known project up front). Takes an ARRAY of project ids:
--   * exactly 1  -> item is routed directly, project_id set immediately.
--   * 2 or more  -> item becomes a decision, project_id left null, and every
--                   selected project is recorded as a candidate.
-- ---------------------------------------------------------------------------

create function stakeholder_items_create_request(
  p_project_ids text[],
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
  v_project_id text;
  v_project_count int := coalesce(array_length(p_project_ids, 1), 0);
begin
  if v_project_count < 1 then
    raise exception 'At least one project must be selected';
  end if;

  perform set_config('app.current_actor', p_actor, true);

  v_project_id := case when v_project_count = 1 then p_project_ids[1] else null end;

  insert into stakeholder_items(
    project_id, kind, summary, description,
    status, status_kind, priority, created_by, required_by, will_be_done_by, request_type
  ) values (
    v_project_id, p_kind, p_summary, p_description,
    p_status, p_status_kind, p_priority, p_created_by, p_required_by, p_will_be_done_by, p_request_type
  )
  returning * into result;

  if v_project_id is null then
    insert into stakeholder_item_candidate_projects(item_id, project_id)
    select result.id, unnest(p_project_ids);
  end if;

  return result;
end;
$$;

grant execute on function stakeholder_items_create_request(
  text[], item_kind, text, text, text, status_kind, priority, text, date, date, text, request_type
) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- stakeholder_items_assign_project: resolves a decision by picking its one
-- destination project. Only applies to an item that's still unassigned
-- (project_id is null) -- once assigned, that's final; re-routing an item
-- afterwards goes through the normal item edit flow like any other item.
-- ---------------------------------------------------------------------------

create function stakeholder_items_assign_project(
  p_id uuid,
  p_project_id text,
  p_actor text
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
    project_id = p_project_id,
    updated_at = now()
  where id = p_id and deleted_at is null and project_id is null
  returning * into result;
  if result.id is null then
    raise exception 'Item % not found, already assigned to a project, or deleted', p_id;
  end if;
  return result;
end;
$$;

grant execute on function stakeholder_items_assign_project(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- stakeholder_client_requests: now LEFT JOINs the project (a decision has
-- none yet) and surfaces whether it's a decision plus its candidate
-- projects, so the module can render "Decision needed — pick a project"
-- instead of a dead project link. Column list only grows (appended at the
-- end) so this stays additive for any existing reader.
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
  i.updated_at,
  (i.project_id is null) as is_decision,
  coalesce(cp.candidate_project_ids, '{}') as candidate_project_ids,
  coalesce(cp.candidate_project_names, '{}') as candidate_project_names
from stakeholder_items i
left join stakeholder_projects p on p.id = i.project_id
left join lateral (
  select
    array_agg(c.project_id order by cpp.name) as candidate_project_ids,
    array_agg(cpp.name order by cpp.name) as candidate_project_names
  from stakeholder_item_candidate_projects c
  join stakeholder_projects cpp on cpp.id = c.project_id
  where c.item_id = i.id
) cp on true
where (i.request_type is not null or i.status = 'Clarification Needed')
  and i.deleted_at is null;

grant select on stakeholder_client_requests to anon, authenticated;
