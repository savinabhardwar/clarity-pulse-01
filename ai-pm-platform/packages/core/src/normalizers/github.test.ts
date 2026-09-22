import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeGithubPush,
  normalizeGithubPullRequest,
  type GithubPushPayload,
  type GithubPullRequestPayload,
} from "./github.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pushFixture = JSON.parse(
  fs.readFileSync(path.join(here, "../../../../db/seed/fixtures/github-push.json"), "utf8"),
) as GithubPushPayload;
const prFixture = JSON.parse(
  fs.readFileSync(path.join(here, "../../../../db/seed/fixtures/github-pull-request.json"), "utf8"),
) as GithubPullRequestPayload;

test("normalizes a push payload into one event per commit", () => {
  const events = normalizeGithubPush(pushFixture, "delivery-123");

  assert.equal(events.length, pushFixture.commits.length);
  const [event] = events;
  assert.ok(event);
  assert.equal(event.source, "github");
  assert.equal(event.eventType, "commit.pushed");
  assert.equal(event.projectHint, "alldayPA/line-tester");
  assert.equal(event.entityType, "commit");
  assert.equal(event.entityId, pushFixture.commits[0]?.id);
  assert.equal(event.providerEventId, `delivery-123:${pushFixture.commits[0]?.id}`);
});

test("normalizes a merged pull_request payload", () => {
  const event = normalizeGithubPullRequest(prFixture, "delivery-456");

  assert.equal(event.source, "github");
  assert.equal(event.eventType, "pull_request.merged");
  assert.equal(event.entityType, "pull_request");
  assert.equal(event.entityId, String(prFixture.pull_request.number));
  assert.equal(event.actor?.id, prFixture.pull_request.user.login);
});

test("non-merge actions use the raw action in eventType", () => {
  const opened: GithubPullRequestPayload = {
    ...prFixture,
    action: "opened",
    pull_request: { ...prFixture.pull_request, merged: false, merged_at: null },
  };
  const event = normalizeGithubPullRequest(opened, "delivery-789");
  assert.equal(event.eventType, "pull_request.opened");
});
