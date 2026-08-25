-- adjustments previously allowed anon/authenticated read-only (0008_rls.sql),
-- like every other table -- writes went exclusively through the sync
-- script's service_role key. The Planning page's Availability form
-- (team-pulse-54 frontend) needs to write real leave records here using
-- only the public anon key, so this opens insert/update/delete to anon too.
-- Deliberately permissive: no ownership check, anyone with the anon key can
-- create/edit/delete any person's leave row. Accepted tradeoff for this
-- table (a day-count + note, not sensitive) to avoid standing up a
-- separate authenticated write path.
create policy adjustments_insert_all on adjustments for insert with check (true);
create policy adjustments_update_all on adjustments for update using (true) with check (true);
create policy adjustments_delete_all on adjustments for delete using (true);
