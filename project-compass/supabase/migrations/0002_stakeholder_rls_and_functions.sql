-- RLS + actor-aware RPC functions + the audit trigger.
--
-- No auth exists anywhere in this monorepo (confirmed across engineering-ethos,
-- team-pulse-54, summit-read), so there's no auth.uid() to attribute changes to.
-- Instead, every write goes through a SECURITY DEFINER function that takes an
-- explicit p_actor text param and stamps it via set_config() for the audit
-- trigger to read. These functions are owned by the migration-running role
-- (postgres), which also owns the tables, so -- per Postgres RLS semantics --
-- they bypass RLS on writes regardless of the calling (anon) role's own
-- policies. Anon therefore gets read access directly via policies below, but
-- write access only through these functions -- never a raw insert/update/delete.

alter table stakeholder_projects enable row level security;
create policy stakeholder_projects_read_all on stakeholder_projects for select using (true);

alter table stakeholder_items enable row level security;
create policy stakeholder_items_read_all on stakeholder_items for select using (true);
-- Deliberately no insert/update/delete policy here: anon has no direct write
-- path to this table, only via the RPC functions below.

alter table stakeholder_item_attachments enable row level security;
create policy stakeholder_item_attachments_read_all on stakeholder_item_attachments for select using (true);

alter table stakeholder_item_history enable row level security;
create policy stakeholder_item_history_read_all on stakeholder_item_history for select using (true);
-- No write policy at all on history -- not even the RPC functions "insert as
-- anon" here, they insert as their owning role. The app itself never
-- inserts/updates/deletes this table directly.

-- ---------------------------------------------------------------------------
-- Audit trigger: fires on every insert/update/delete of stakeholder_items.
-- This is the single source of truth for history -- it can't be skipped by a
-- bug in a future mutation path, and it fires even for a manual SQL fix.
-- ---------------------------------------------------------------------------

create or replace function stakeholder_items_audit() returns trigger
language plpgsql
as $$
declare
  cols text[] := array['summary','description','jira_url','jira_key','status','status_kind',
                        'priority','comment','created_by','required_by','will_be_done_by','deleted_at'];
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

create trigger trg_stakeholder_items_audit
  after insert or update or delete on stakeholder_items
  for each row execute function stakeholder_items_audit();

-- ---------------------------------------------------------------------------
-- Actor-aware RPC functions. The client only ever calls these via
-- supabase.rpc(...) for writes -- never a raw .insert()/.update()/.delete().
-- ---------------------------------------------------------------------------

create or replace function stakeholder_items_create(
  p_project_id text,
  p_kind item_kind,
  p_summary text,
  p_description text,
  p_jira_url text,
  p_jira_key text,
  p_status text,
  p_status_kind status_kind,
  p_priority priority,
  p_comment text,
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
    project_id, kind, summary, description, jira_url, jira_key,
    status, status_kind, priority, comment, created_by, required_by, will_be_done_by
  ) values (
    p_project_id, p_kind, p_summary, p_description, p_jira_url, p_jira_key,
    p_status, p_status_kind, p_priority, p_comment, p_created_by, p_required_by, p_will_be_done_by
  )
  returning * into result;
  return result;
end;
$$;

create or replace function stakeholder_items_update(
  p_id uuid,
  p_summary text,
  p_description text,
  p_jira_url text,
  p_jira_key text,
  p_status text,
  p_status_kind status_kind,
  p_priority priority,
  p_comment text,
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
    jira_url = p_jira_url,
    jira_key = p_jira_key,
    status = p_status,
    status_kind = p_status_kind,
    priority = p_priority,
    comment = p_comment,
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

create or replace function stakeholder_items_soft_delete(
  p_id uuid,
  p_actor text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.current_actor', p_actor, true);
  update stakeholder_items set deleted_at = now() where id = p_id and deleted_at is null;
end;
$$;

create or replace function stakeholder_item_attachments_add(
  p_item_id uuid,
  p_storage_path text,
  p_file_name text,
  p_file_type text,
  p_file_size bigint,
  p_actor text
) returns stakeholder_item_attachments
language plpgsql
security definer
set search_path = public
as $$
declare
  result stakeholder_item_attachments;
begin
  insert into stakeholder_item_attachments(item_id, storage_path, file_name, file_type, file_size, uploaded_by)
  values (p_item_id, p_storage_path, p_file_name, p_file_type, p_file_size, p_actor)
  returning * into result;
  insert into stakeholder_item_history(item_id, event_type, field_name, new_value, changed_by)
  values (p_item_id, 'updated', 'attachments', p_file_name, p_actor);
  return result;
end;
$$;

create or replace function stakeholder_item_attachments_remove(
  p_attachment_id uuid,
  p_actor text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
  v_file_name text;
begin
  select item_id, file_name into v_item_id, v_file_name
  from stakeholder_item_attachments where id = p_attachment_id;
  if v_item_id is null then
    return;
  end if;
  delete from stakeholder_item_attachments where id = p_attachment_id;
  insert into stakeholder_item_history(item_id, event_type, field_name, old_value, changed_by)
  values (v_item_id, 'updated', 'attachments', v_file_name, p_actor);
end;
$$;

-- Explicit per-function grants -- NOT a blanket "all functions in schema
-- public" grant, since this migration runs against the shared claritypulse
-- Supabase project (same one engineering-ethos/team-pulse-54/summit-read
-- use), which already has its own RPCs (get_person_detail, etc.) with their
-- own intended privilege posture. Scoping to exactly these 6 functions keeps
-- this app's "anon can write via a controlled surface" tradeoff (same one
-- already accepted in root supabase/migrations/0037_adjustments_anon_write.sql)
-- from silently touching anything unrelated.
grant execute on function stakeholder_items_create(
  text, item_kind, text, text, text, text, text, status_kind, priority, text, text, date, date, text
) to anon, authenticated;
grant execute on function stakeholder_items_update(
  uuid, text, text, text, text, text, status_kind, priority, text, text, date, date, text
) to anon, authenticated;
grant execute on function stakeholder_items_soft_delete(uuid, text) to anon, authenticated;
grant execute on function stakeholder_item_attachments_add(
  uuid, text, text, text, bigint, text
) to anon, authenticated;
grant execute on function stakeholder_item_attachments_remove(uuid, text) to anon, authenticated;
