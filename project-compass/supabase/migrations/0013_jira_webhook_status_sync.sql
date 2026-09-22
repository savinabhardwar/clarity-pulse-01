-- Support the Jira webhook (src/routes/api.jira-webhook.ts): looking up which
-- stakeholder_items are linked to a given Jira key, and updating just their
-- status/status_kind, without requiring every other field like
-- stakeholder_items_update does.

create index on stakeholder_item_jira_links (jira_key);

create or replace function stakeholder_items_update_status_from_jira(
  p_jira_key text,
  p_status text
) returns setof stakeholder_items
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.current_actor', 'jira-webhook', true);
  return query
    update stakeholder_items
    set status = p_status,
        status_kind = 'jira',
        updated_at = now()
    where deleted_at is null
      and id in (
        select item_id from stakeholder_item_jira_links where jira_key = p_jira_key
      )
    returning *;
end;
$$;

grant execute on function stakeholder_items_update_status_from_jira(text, text) to anon, authenticated;
