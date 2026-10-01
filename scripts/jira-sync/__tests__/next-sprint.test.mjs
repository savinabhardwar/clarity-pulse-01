import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNextSprintRows } from "../sync-next-sprint.mjs";

const FIELD = "customfield_10020";
const PROJECTS = [
  { key: "KH", name: "Knowledge Hub" },
  { key: "TT", name: "Team - Telephony" },
];

const issue = (key, project, sprints, extra = {}) => ({
  key,
  fields: {
    summary: `${key} summary`,
    project: { key: project },
    status: { name: "To Do" },
    issuetype: { name: "Task" },
    assignee: null,
    timeoriginalestimate: null,
    [FIELD]: sprints,
    ...extra,
  },
});
const future = (id, name, extra = {}) => ({ id, name, state: "future", ...extra });
const closed = (id, name) => ({ id, name, state: "closed" });

test("keeps only the earliest future sprint per board", () => {
  const rows = buildNextSprintRows(
    [
      issue("KH-1", "KH", [future(11, "KH Sprint 5")]),
      issue("KH-2", "KH", [future(11, "KH Sprint 5"), future(12, "KH Sprint 6")]),
      issue("KH-3", "KH", [future(12, "KH Sprint 6")]),
    ],
    PROJECTS,
    new Map(),
    FIELD,
  );
  assert.deepEqual(rows.map((r) => r.jira_key).sort(), ["KH-1", "KH-2"]);
  assert.ok(rows.every((r) => r.jira_sprint_id === 11 && r.sprint_name === "KH Sprint 5"));
});

test("a dated future sprint beats an undated one, regardless of id", () => {
  const rows = buildNextSprintRows(
    [
      issue("KH-1", "KH", [future(20, "Later id, dated", { startDate: "2026-10-12T00:00:00Z" })]),
      issue("KH-2", "KH", [future(10, "Earlier id, undated")]),
    ],
    PROJECTS,
    new Map(),
    FIELD,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].jira_key, "KH-1");
});

test("ignores closed sprints, boards outside the tracked list, and issues with no future sprint", () => {
  const rows = buildNextSprintRows(
    [
      issue("KH-1", "KH", [closed(1, "Old"), future(11, "KH Sprint 5")]),
      issue("KH-2", "KH", [closed(1, "Old")]),
      issue("SP-1", "SP", [future(99, "Team Sprint 23")]),
    ],
    PROJECTS,
    new Map(),
    FIELD,
  );
  assert.deepEqual(rows.map((r) => r.jira_key), ["KH-1"]);
});

test("each board gets its own next sprint", () => {
  const rows = buildNextSprintRows(
    [issue("KH-1", "KH", [future(11, "KH Sprint 5")]), issue("TT-1", "TT", [future(5, "TT Sprint 9")])],
    PROJECTS,
    new Map(),
    FIELD,
  );
  assert.deepEqual(
    rows.map((r) => [r.jira_key, r.board_name, r.jira_sprint_id]).sort(),
    [["KH-1", "Knowledge Hub", 11], ["TT-1", "Team - Telephony", 5]],
  );
});

test("resolves assignee to a person id, keeps the name when unknown, and maps empty goal to null", () => {
  const rows = buildNextSprintRows(
    [
      issue("KH-1", "KH", [future(11, "KH Sprint 5", { goal: "" })], {
        assignee: { accountId: "acc-1", displayName: "Known Person" },
        timeoriginalestimate: 7200,
      }),
      issue("KH-2", "KH", [future(11, "KH Sprint 5")], {
        assignee: { accountId: "acc-unknown", displayName: "Stranger" },
      }),
      issue("KH-3", "KH", [future(11, "KH Sprint 5")]),
    ],
    PROJECTS,
    new Map([["acc-1", "person-uuid-1"]]),
    FIELD,
  );
  const byKey = Object.fromEntries(rows.map((r) => [r.jira_key, r]));
  assert.equal(byKey["KH-1"].assignee_person_id, "person-uuid-1");
  assert.equal(byKey["KH-1"].original_estimate_seconds, 7200);
  assert.equal(byKey["KH-1"].sprint_goal, null);
  assert.equal(byKey["KH-2"].assignee_person_id, null);
  assert.equal(byKey["KH-2"].assignee_name, "Stranger");
  assert.equal(byKey["KH-3"].assignee_person_id, null);
  assert.equal(byKey["KH-3"].assignee_name, null);
});
