-- 0022's person_account_aliases mapped an alias account directly to a
-- canonical PERSON id, applied only at insert time (personIdByAccount).
-- That let both raw Jira accounts still flow through computeMetrics as
-- two separate people, both resolving to the same person_id at the very
-- end -- a single multi-row upsert can't update the same target row
-- twice, so every sync now fails with "ON CONFLICT DO UPDATE command
-- cannot affect row a second time".
--
-- Correct fix: map alias account -> canonical Jira ACCOUNT ID (a plain
-- string, not a person id), so sync.mjs can canonicalize every raw
-- issue/worklog/comment accountId immediately after loading -- before
-- any grouping happens. After that, the alias account never appears
-- again in this run's data at all, and the existing 1:1
-- account->person machinery just works, with no duplicate to collide.
drop table if exists person_account_aliases;

create table person_account_aliases (
  alias_jira_account_id text primary key,
  canonical_jira_account_id text not null,
  note text,
  created_at timestamptz not null default now()
);

insert into person_account_aliases (alias_jira_account_id, canonical_jira_account_id, note)
values (
  '712020:865efd04-3d6d-46c5-b836-612680513748',
  '712020:48d96922-0b66-49b5-92c8-52e1fb26aee8',
  'Same person as the other Pablo Martinez account, confirmed by user'
);
