-- Merges two Jira accounts that are actually the same human ("Pablo
-- Martinez" appeared twice with different jira_account_ids). Mirrors
-- project_overrides: a persistent correction table sync.mjs reads and
-- re-applies on top of the auto-derived personIdByAccount map every run,
-- so the merge survives indefinitely instead of being re-split by the
-- next sync (which upserts people 1:1 per Jira account by design).
create table person_account_aliases (
  alias_jira_account_id text primary key,
  canonical_person_id uuid not null references people (id),
  note text,
  created_at timestamptz not null default now()
);

-- Canonical: 09046bcf-b7c2-496a-922f-5edb65afef7d (more activity: 3
-- worklogs/1.5h logged vs. 0 on the other account).
insert into person_account_aliases (alias_jira_account_id, canonical_person_id, note)
values ('712020:865efd04-3d6d-46c5-b836-612680513748', '09046bcf-b7c2-496a-922f-5edb65afef7d', 'Same person as the other Pablo Martinez account, confirmed by user');

-- One-time backfill: repoint existing historical references from the
-- duplicate person to the canonical one. Tables that get fully replaced
-- every sync (project_contributors, standouts, risks) don't need this --
-- they'll naturally attribute to the canonical person from the next sync
-- once sync.mjs applies the alias above.
update tickets set assignee_person_id = '09046bcf-b7c2-496a-922f-5edb65afef7d' where assignee_person_id = '2b43a1e6-9958-4b89-a71c-9831dd325735';
update tickets set reporter_person_id = '09046bcf-b7c2-496a-922f-5edb65afef7d' where reporter_person_id = '2b43a1e6-9958-4b89-a71c-9831dd325735';
update worklogs set author_person_id = '09046bcf-b7c2-496a-922f-5edb65afef7d' where author_person_id = '2b43a1e6-9958-4b89-a71c-9831dd325735';
update ticket_comments set author_person_id = '09046bcf-b7c2-496a-922f-5edb65afef7d' where author_person_id = '2b43a1e6-9958-4b89-a71c-9831dd325735';
update projects set owner_person_id = '09046bcf-b7c2-496a-922f-5edb65afef7d' where owner_person_id = '2b43a1e6-9958-4b89-a71c-9831dd325735';

-- Hide the now-merged duplicate from every people-facing view/RPC
-- (v_people_overview and get_people_overview_asof both filter
-- excluded = false already). Never re-asserted by sync.mjs, same
-- protection pattern as team_guessed.
update people set excluded = true where id = '2b43a1e6-9958-4b89-a71c-9831dd325735';
