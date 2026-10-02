-- The previous consumer committed the dedup marker before the compact state.
-- If state persistence failed, the retry skipped the event and lost the update.
-- This service-role-only RPC records both in a single PostgreSQL transaction.
create or replace function process_queued_event(p_event jsonb)
returns boolean
language plpgsql
security invoker
as $$
declare
  event_id uuid;
  data jsonb := p_event->'payload';
  internal_project uuid := (p_event->>'projectId')::uuid;
  source_name text := p_event->>'source';
  event_name text := p_event->>'eventType';
begin
  insert into events (source, event_type, project_id, entity_type, entity_id,
      actor_type, actor_id, timestamp, payload, correlation_id, provider_event_id)
  values (source_name, event_name, internal_project, p_event->>'entityType',
      p_event->>'entityId', p_event->'actor'->>'type', p_event->'actor'->>'id',
      (p_event->>'timestamp')::timestamptz, data, p_event->>'correlationId',
      p_event->>'providerEventId')
  on conflict (source, provider_event_id) do nothing returning id into event_id;
  if event_id is null then return false; end if;

  if source_name = 'jira' and event_name = 'issue.observed' then
    insert into issues (project_id, jira_issue_key, jira_issue_id, title, issue_type, status)
    values (internal_project, data->>'key', data->>'id', data->'fields'->>'summary',
        data->'fields'->'issuetype'->>'name', data->'fields'->'status'->>'name')
    on conflict (jira_issue_key) do update set project_id = excluded.project_id,
        jira_issue_id = excluded.jira_issue_id, title = excluded.title,
        issue_type = excluded.issue_type, status = excluded.status;
  elsif source_name = 'github' and event_name = 'commit.pushed' then
    insert into commits (project_id, repository, commit_hash, message, committed_at)
    values (internal_project, p_event->>'projectHint', data->>'id', data->>'message',
        (data->>'timestamp')::timestamptz)
    on conflict (repository, commit_hash) do update set project_id = excluded.project_id,
        message = excluded.message, committed_at = excluded.committed_at;
  elsif source_name = 'github' and event_name like 'pull_request.%' then
    insert into pull_requests (project_id, repository, external_pr_id, title, status, created_at, merged_at)
    values (internal_project, p_event->>'projectHint', data->>'number', data->>'title',
        case when (data->>'merged')::boolean then 'merged' else 'open' end,
        (data->>'created_at')::timestamptz, (data->>'merged_at')::timestamptz)
    on conflict (repository, external_pr_id) do update set project_id = excluded.project_id,
        title = excluded.title, status = excluded.status, created_at = excluded.created_at,
        merged_at = excluded.merged_at;
  elsif source_name = 'requirements-app' and event_name = 'requirement.observed' then
    insert into requirements (project_id, source_reference, title, status)
    values (internal_project, (data->>'id')::uuid, data->>'summary', data->>'status')
    on conflict (source_reference) do update set project_id = excluded.project_id,
        title = excluded.title, status = excluded.status;
  end if;
  return true;
end;
$$;

revoke all on function process_queued_event(jsonb) from public, anon, authenticated;
grant execute on function process_queued_event(jsonb) to service_role;
