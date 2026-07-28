import { readFileSync, writeFileSync } from "node:fs";

/** Pure-JS replacement for the jq one-liner used during development --
 * production (GitHub Actions) shouldn't depend on jq being installed. */
export function computeAssigneeProjectCounts(issuesJsonlPath, outPath) {
  const issues = readFileSync(issuesJsonlPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const byAccount = new Map();
  for (const issue of issues) {
    if (!issue.assignee) continue;
    const { accountId, name } = issue.assignee;
    if (!byAccount.has(accountId)) byAccount.set(accountId, { accountId, name, counts: new Map() });
    const entry = byAccount.get(accountId);
    entry.counts.set(issue.project, (entry.counts.get(issue.project) || 0) + 1);
  }
  const result = [...byAccount.values()].map((e) => ({
    accountId: e.accountId,
    name: e.name,
    projectCounts: [...e.counts.entries()].map(([project, count]) => ({ project, count })).sort((a, b) => b.count - a.count),
  }));
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  return result;
}
