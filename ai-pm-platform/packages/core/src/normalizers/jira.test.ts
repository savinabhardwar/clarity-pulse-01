import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeJiraIssue, type JiraIssue } from "./jira.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "../../../../db/seed/fixtures/jira-issue.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as JiraIssue;

test("normalizes a real Jira issue snapshot (LT-43 fixture) into the internal event shape", () => {
  const event = normalizeJiraIssue(fixture);

  assert.equal(event.source, "jira");
  assert.equal(event.eventType, "issue.observed");
  assert.equal(event.projectHint, "LT");
  assert.equal(event.entityType, "issue");
  assert.equal(event.entityId, "LT-43");
  assert.equal(event.timestamp, fixture.fields.updated);
  assert.equal(event.providerEventId, `${fixture.id}:${fixture.fields.updated}`);
  assert.deepEqual(event.actor, { type: "user", id: fixture.fields.assignee?.accountId });
  assert.equal(event.correlationId, null);
});

test("is a pure function: same input twice produces identical output", () => {
  const a = normalizeJiraIssue(fixture);
  const b = normalizeJiraIssue(fixture);
  assert.deepEqual(a, b);
});

test("handles an unassigned issue (assignee null) without throwing", () => {
  const unassigned: JiraIssue = {
    ...fixture,
    fields: { ...fixture.fields, assignee: null },
  };
  const event = normalizeJiraIssue(unassigned);
  assert.equal(event.actor, null);
});
