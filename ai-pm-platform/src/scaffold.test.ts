// Placeholder proving the workspace's test/lint/typecheck pipeline is wired
// up end to end. Delete once real tests exist under packages/ (Phase 3+).
import { test } from "node:test";
import assert from "node:assert/strict";

test("workspace scaffold runs", () => {
  assert.equal(1 + 1, 2);
});
