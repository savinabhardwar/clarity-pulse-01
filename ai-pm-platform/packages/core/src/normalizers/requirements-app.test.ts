import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeStakeholderItem, type StakeholderItem } from "./requirements-app.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "../../../../db/seed/fixtures/requirements-app-item.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as StakeholderItem;

test("normalizes a stakeholder_items row into the internal event shape", () => {
  const event = normalizeStakeholderItem(fixture);

  assert.ok(event);
  assert.equal(event.source, "requirements-app");
  assert.equal(event.eventType, "requirement.observed");
  assert.equal(event.projectHint, fixture.project_id);
  assert.equal(event.entityType, "requirement");
  assert.equal(event.entityId, fixture.id);
  assert.equal(event.providerEventId, `${fixture.id}:${fixture.updated_at}`);
});

test("returns null for a multi-candidate item with no project_id yet (D24: not our scope until resolved)", () => {
  const decisionItem: StakeholderItem = { ...fixture, project_id: null };
  assert.equal(normalizeStakeholderItem(decisionItem), null);
});
