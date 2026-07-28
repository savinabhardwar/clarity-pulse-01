.issues.nodes[] | {
  key: .key,
  project: .fields.project.key,
  summary: .fields.summary,
  issuetype: .fields.issuetype.name,
  status: .fields.status.name,
  statusCategory: .fields.status.statusCategory.key,
  priority: (.fields.priority.name // null),
  assignee: (if .fields.assignee then {accountId: .fields.assignee.accountId, name: .fields.assignee.displayName} else null end),
  reporter: (if .fields.reporter then {accountId: .fields.reporter.accountId, name: .fields.reporter.displayName} else null end),
  created: .fields.created,
  updated: .fields.updated,
  resolutiondate: (.fields.resolutiondate // null),
  estimateSeconds: (.fields.timeoriginalestimate // null),
  remainingSeconds: (.fields.timeestimate // null),
  spentSeconds: (.fields.timespent // 0),
  parent: (if .fields.parent then {key: .fields.parent.key, summary: .fields.parent.fields.summary, issuetype: .fields.parent.fields.issuetype.name} else null end),
  labels: (.fields.labels // []),
  worklogTotal: (.fields.worklog.total // 0),
  worklogReturned: (.fields.worklog.worklogs | length),
  worklogs: [(.fields.worklog.worklogs // [])[] | {
    id: .id,
    authorAccountId: .author.accountId,
    authorName: .author.displayName,
    started: .started,
    created: .created,
    seconds: .timeSpentSeconds
  }],
  commentTotal: (.fields.comment.total // 0),
  comments: [(.fields.comment.comments // [])[] | {
    authorAccountId: .author.accountId,
    authorName: .author.displayName,
    created: .created,
    body: (.body // "" | if (type == "string") then .[0:200] else "" end)
  }]
}
