-- Items can now link to MULTIPLE Jira tickets, not just one. Replaces the
-- single jira_url/jira_key scalar columns on stakeholder_items with a proper
-- one-to-many table, same shape as attachments/comments.

create table stakeholder_item_jira_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references stakeholder_items(id) on delete cascade,
  jira_key text not null,
  jira_url text not null,
  added_by text not null,
  created_at timestamptz not null default now(),
  unique (item_id, jira_key)
);
create index on stakeholder_item_jira_links (item_id);

alter table stakeholder_item_jira_links enable row level security;
create policy stakeholder_item_jira_links_read_all on stakeholder_item_jira_links for select using (true);
-- No direct insert/delete policy: writes go through the RPC functions below,
-- same convention as stakeholder_items itself, so each add/remove also logs
-- a stakeholder_item_history entry.

-- Carry forward each item's existing single link as its first jira_links row.
insert into stakeholder_item_jira_links (item_id, jira_key, jira_url, added_by, created_at)
select id, jira_key, jira_url, created_by, updated_at
from stakeholder_items
where trim(coalesce(jira_key, '')) != '';

create or replace function stakeholder_item_jira_links_add(
  p_item_id uuid,
  p_jira_key text,
  p_jira_url text,
  p_actor text
) returns stakeholder_item_jira_links
language plpgsql
security definer
set search_path = public
as $$
declare
  result stakeholder_item_jira_links;
begin
  insert into stakeholder_item_jira_links (item_id, jira_key, jira_url, added_by)
  values (p_item_id, p_jira_key, p_jira_url, p_actor)
  on conflict (item_id, jira_key) do nothing
  returning * into result;
  if result.id is null then
    select * into result from stakeholder_item_jira_links
    where item_id = p_item_id and jira_key = p_jira_key;
    return result;
  end if;
  insert into stakeholder_item_history (item_id, event_type, field_name, new_value, changed_by)
  values (p_item_id, 'updated', 'jira_links', p_jira_key, p_actor);
  return result;
end;
$$;

create or replace function stakeholder_item_jira_links_remove(
  p_link_id uuid,
  p_actor text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_jira_key text;
begin
  delete from stakeholder_item_jira_links where id = p_link_id
  returning item_id, jira_key into v_item_id, v_jira_key;
  if v_item_id is null then
    return;
  end if;
  insert into stakeholder_item_history (item_id, event_type, field_name, old_value, changed_by)
  values (v_item_id, 'updated', 'jira_links', v_jira_key, p_actor);
end;
$$;

grant execute on function stakeholder_item_jira_links_add(uuid, text, text, text) to anon, authenticated;
grant execute on function stakeholder_item_jira_links_remove(uuid, text) to anon, authenticated;

-- stakeholder_items_create/update's parameter list is shrinking by two
-- (p_jira_url/p_jira_key removed) -- signature change requires drop+recreate.
drop function stakeholder_items_create(
  text, item_kind, text, text, text, text, text, status_kind, priority, text, date, date, text
);
drop function stakeholder_items_update(
  uuid, text, text, text, text, text, status_kind, priority, text, date, date, text
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
  insert into stakeholder_items(
    project_id, kind, summary, description,
    status, status_kind, priority, created_by, required_by, will_be_done_by
  ) values (
    p_project_id, p_kind, p_summary, p_description,
    p_status, p_status_kind, p_priority, p_created_by, p_required_by, p_will_be_done_by
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
    summary = p_summary,
    description = p_description,
    status = p_status,
    status_kind = p_status_kind,
    priority = p_priority,
    created_by = p_created_by,
    required_by = p_required_by,
    will_be_done_by = p_will_be_done_by,
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
  text, item_kind, text, text, text, status_kind, priority, text, date, date, text
) to anon, authenticated;
grant execute on function stakeholder_items_update(
  uuid, text, text, text, status_kind, priority, text, date, date, text
) to anon, authenticated;

alter table stakeholder_items drop column jira_url;
alter table stakeholder_items drop column jira_key;

create or replace function stakeholder_items_audit() returns trigger
language plpgsql
as $$
declare
  cols text[] := array['summary','description','status','status_kind',
                        'priority','created_by','required_by','will_be_done_by','deleted_at'];
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
