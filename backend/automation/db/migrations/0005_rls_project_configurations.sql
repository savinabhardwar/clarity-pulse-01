-- 0005_rls_project_configurations.sql
-- Phase 2 task 2.5 — RLS for project_configurations (D3/D20: PM/Admin
-- only). Minimal auth wiring, not speculative: links `users` to Supabase
-- Auth via `auth_user_id` so these policies are real and testable now,
-- even though Phase 8's Control Centre (the actual human-facing consumer)
-- doesn't exist yet. `service_role` bypasses RLS entirely (Supabase
-- built-in) -- that's what Workers use per CLAUDE.md, no policy needed
-- for them. This migration only covers what task 2.5 actually asks for;
-- broader per-table access policies for a future Control Centre are not
-- built here.

alter table users add column auth_user_id uuid unique references auth.users(id);

-- 'member' stays the existing default. 'pm' and 'admin' are the two
-- values D3/D20's "PM/Admin only" phrase actually means -- constrained
-- now so the RLS check below can't silently no-op on a typo'd role string.
alter table users add constraint users_role_check check (role in ('member', 'pm', 'admin'));

-- security definer: RLS is already enabled on `users` with no policies
-- (default-deny), so a plain lookup here would be blocked by the very
-- table it's trying to read, for the same non-privileged role the policy
-- below is trying to check. Runs as the function owner instead, bypassing
-- that -- the standard Supabase pattern for this exact situation.
create or replace function current_app_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from users where auth_user_id = auth.uid()
$$;

create policy project_configurations_admin_select
  on project_configurations for select
  using (current_app_user_role() in ('pm', 'admin'));

create policy project_configurations_admin_insert
  on project_configurations for insert
  with check (current_app_user_role() in ('pm', 'admin'));

create policy project_configurations_admin_update
  on project_configurations for update
  using (current_app_user_role() in ('pm', 'admin'))
  with check (current_app_user_role() in ('pm', 'admin'));

create policy project_configurations_admin_delete
  on project_configurations for delete
  using (current_app_user_role() in ('pm', 'admin'));
