.issues.nodes[] | {
  key: .key,
  project: .fields.project.key,
  summary: .fields.summary,
  issuetype: .fields.issuetype.name,
  resolutiondate: .fields.resolutiondate,
  spentSeconds: (.fields.timespent // 0),
  assignee: (if .fields.assignee then {accountId: .fields.assignee.accountId, name: .fields.assignee.displayName} else null end),
  parent: (if .fields.parent then {key: .fields.parent.key, summary: .fields.parent.fields.summary} else null end)
}
