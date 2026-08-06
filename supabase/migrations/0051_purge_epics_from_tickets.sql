-- fetchInWindowIssues' JQL never excluded issuetype = Epic (unlike
-- fetchHistory, which always has), so an Epic that happened to sit in a
-- tracked sprint got ingested into `tickets` exactly like a regular
-- ticket -- and then wrongly counted as neglected WIP by
-- computeJiraUpdateStatus: an Epic assigned to someone (a common
-- ownership convention) has no worklog/comment of its own by design
-- (the real work happens on its child tickets), so it tripped the
-- dark-WIP check and penalized that person for something nobody would
-- ever actually do. Found live: 15 Epic rows across TI/TEAM/TEAMSANKYA
-- had leaked in this way, affecting several people's Jira Update
-- Status. fetch-jira-rest.mjs now excludes issuetype != Epic on that
-- same fetch; this one-time cleanup removes what already leaked in
-- before that fix. Cascades to worklogs/ticket_comments on the
-- (unlikely) chance any exist for these rows.
delete from tickets
where jira_key in (select jira_key from epics);
