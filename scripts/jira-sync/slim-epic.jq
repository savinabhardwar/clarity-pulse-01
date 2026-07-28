.issues.nodes[] | {
  key: .key,
  project: .fields.project.key,
  summary: .fields.summary,
  status: .fields.status.name,
  statusCategory: .fields.status.statusCategory.key,
  created: .fields.created,
  updated: .fields.updated,
  resolutiondate: (.fields.resolutiondate // null)
}
