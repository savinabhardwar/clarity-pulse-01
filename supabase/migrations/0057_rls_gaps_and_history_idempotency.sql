-- Closes two gaps left by earlier migrations:
--
-- 1) RLS was enabled on the original 25 tables in 0008_rls.sql, but four
--    tables added later were never covered -- with RLS disabled they were
--    fully readable AND writable by anon via PostgREST:
--      resolved_ticket_history (0015), person_metrics_history (0018),
--      person_account_aliases (0023), project_sprint_summaries (0043).
--    Same policy shape as 0008: read-only for anon/authenticated; all
--    writes go through the sync job's service_role key, which bypasses
--    RLS entirely.
--
-- 2) All v_* views are owned by the table owner and therefore run with
--    owner privileges (implicit SECURITY DEFINER), bypassing table RLS.
--    Setting security_invoker = on makes each view re-check the caller's
--    policies against the underlying tables, so tightening 0008's
--    read policies later can't be silently defeated by a view.

alter table resolved_ticket_history enable row level security;
alter table person_metrics_history enable row level security;
alter table person_account_aliases enable row level security;
alter table project_sprint_summaries enable row level security;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'resolved_ticket_history',
      'person_metrics_history',
      'person_account_aliases',
      'project_sprint_summaries'
    ])
  loop
    execute format('create policy %I on %I for select using (true);', t || '_read_all', t);
  end loop;
end $$;

do $$
declare
  v text;
begin
  for v in
    select viewname from pg_views
    where schemaname = 'public' and viewname like 'v_%'
  loop
    execute format('alter view public.%I set (security_invoker = on);', v);
  end loop;
end $$;

-- person_metrics_history is append-only with no uniqueness guard: a sync
-- that fails partway and reruns (or insertMany chunk retry logic) inserts
-- a second copy of the same snapshot. Tag each row with the sync run that
-- produced it and make (person_id, sync_run_id) unique, so per-run inserts
-- are idempotent. Rows written before this migration have NULL
-- sync_run_id and are exempted from the constraint.
alter table person_metrics_history
  add column sync_run_id uuid references sync_runs (id);

create unique index uq_person_metrics_history_person_run
  on person_metrics_history (person_id, sync_run_id)
  where sync_run_id is not null;
