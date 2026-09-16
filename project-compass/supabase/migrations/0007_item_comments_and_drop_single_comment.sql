-- Real multi-person comment threads, replacing the single free-text
-- "Comment" field. Each comment is permanently attributed to whoever wrote
-- it (self-declared name/email, same trust level as the rest of this app --
-- see identity-gate.tsx) and, once posted, is never edited or deleted --
-- same immutability principle as stakeholder_item_history.

create table stakeholder_item_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references stakeholder_items(id) on delete cascade,
  author_name text not null,
  author_email text not null,
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index on stakeholder_item_comments (item_id, created_at);

alter table stakeholder_item_comments enable row level security;
create policy stakeholder_item_comments_read_all on stakeholder_item_comments for select using (true);
-- Unlike stakeholder_items' writes, comments need no SECURITY DEFINER
-- wrapper -- there's no audit trigger depending on a session-local actor
-- setting to diff against, since a comment is already its own immutable
-- record of who/what/when. A plain RLS-gated anon insert is simplest.
create policy stakeholder_item_comments_insert_all on stakeholder_item_comments for insert with check (true);
-- No update/delete policy: comments are permanent once posted.

-- Carry forward existing single-comment text as each item's first thread
-- entry (attributed to whoever created the item) before the column is
-- dropped -- this is real data from the requirement-gathering workbook
-- import, not sample/test content, so it must not simply be discarded.
insert into stakeholder_item_comments (item_id, author_name, author_email, body, created_at)
select id, created_by, '', comment, created_at
from stakeholder_items
where trim(coalesce(comment, '')) != '';

-- stakeholder_items_create/update's parameter list is shrinking by one
-- (p_comment removed) -- that changes the function's signature/identity in
-- Postgres, so these must be dropped and recreated, not just replaced.
drop function stakeholder_items_create(
  text, item_kind, text, text, text, text, text, status_kind, priority, text, text, date, date, text
);
drop function stakeholder_items_update(
  uuid, text, text, text, text, text, status_kind, priority, text, text, date, date, text
);

create function stakeholder_items_create(
  p_project_id text,
  p_kind item_kind,
  p_summary text,
  p_description text,
  p_jira_url text,
  p_jira_key text,
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
    project_id, kind, summary, description, jira_url, jira_key,
    status, status_kind, priority, created_by, required_by, will_be_done_by
  ) values (
    p_project_id, p_kind, p_summary, p_description, p_jira_url, p_jira_key,
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
  p_jira_url text,
  p_jira_key text,
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
    jira_url = p_jira_url,
    jira_key = p_jira_key,
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
  text, item_kind, text, text, text, text, text, status_kind, priority, text, date, date, text
) to anon, authenticated;
grant execute on function stakeholder_items_update(
  uuid, text, text, text, text, text, status_kind, priority, text, date, date, text
) to anon, authenticated;

alter table stakeholder_items drop column comment;

-- Drop 'comment' from the audit trigger's tracked-columns array. The trigger
-- FUNCTION's own signature is unchanged, so create-or-replace (not a drop)
-- is fine here.
create or replace function stakeholder_items_audit() returns trigger
language plpgsql
as $$
declare
  cols text[] := array['summary','description','jira_url','jira_key','status','status_kind',
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
