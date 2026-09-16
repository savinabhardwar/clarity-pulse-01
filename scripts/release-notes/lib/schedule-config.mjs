// Static map of each Confluence "Release Notes" product folder -> its
// parent page id -> the Jira project key it draws completed work from.
// Confirmed by hand against getVisibleJiraProjects and the Confluence
// space tree on 2026-09-11 (see the plan this shipped from). Call
// Analyser and 17E are deliberately absent -- Call Analyser has no
// matching Jira project, and 17E is treated as folded into Amy.
export const RELEASE_SCHEDULE_PAGE_ID = "529104897";
export const RELEASE_NOTES_ROOT_PAGE_ID = "523730946";
// Numeric id of the "Group IT Project" personal space (key
// ~7120202dfd483b836541bdb0895deed4dba6c2) -- the REST v2 create-page
// endpoint requires the numeric id, unlike the MCP tool which resolves
// the key automatically.
export const SPACE_ID = "73072653";

export const PRODUCTS = [
  { product: "QIP", parentPageId: "523894786", jiraKey: "QIP" },
  { product: "Amy", parentPageId: "524451841", jiraKey: "AMY" },
  { product: "CX Omni", parentPageId: "524484609", jiraKey: "CX" },
  { product: "Knowledge Hub", parentPageId: "523927555", jiraKey: "KH" },
  { product: "Agent Assist", parentPageId: "524288002", jiraKey: "AA" },
  { product: "Keyboardless Agent", parentPageId: "524550145", jiraKey: "KA" },
  { product: "AVANI", parentPageId: "523763714", jiraKey: "AV" },
  { product: "Forecasting", parentPageId: "524615681", jiraKey: "FR" },
  { product: "Automated MIS", parentPageId: "524386306", jiraKey: "MR" },
  { product: "ACX Improvements", parentPageId: "523960322", jiraKey: "ACX" },
  { product: "CX Pass", parentPageId: "523763734", jiraKey: "CP" },
  { product: "PBX Manager", parentPageId: "524681217", jiraKey: "PBX" },
];

export function productConfig(name) {
  return PRODUCTS.find((p) => p.product === name);
}
