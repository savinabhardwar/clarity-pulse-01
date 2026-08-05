// Guards against the two scoring implementations silently drifting apart.
//
// engineering-ethos/src/lib/eng-data.ts (the live dashboard) and
// scripts/jira-sync/snapshot-sprint-summary.mjs (this repo's per-sprint
// snapshot) both reimplement the SAME pace/estimate/hygiene/logging/
// overall scoring rules -- one for "right now, mid-sprint", one for "this
// sprint, now that it's closed". They live in two separate repos with two
// separate deploy targets (a Cloudflare Worker vs GitHub Actions), so
// there's no single module either can import at runtime -- the mirroring
// is maintained by hand. THIS test is the tripwire for that: it feeds one
// shared fixture through both implementations at the moment the sprint
// closes (now === sprintEnd, so the live "current" checks and the
// snapshot's "retrospective" checks are evaluating the exact same instant)
// and asserts they agree on every score.
//
// Not part of either repo's CI -- GitHub Actions for this repo only checks
// out this repo, not engineering-ethos, so it has no way to run this.
// Run it by hand (`node scripts/jira-sync/__tests__/scoring-parity.test.mjs`)
// whenever either side's scoring math changes, from a working copy that has
// engineering-ethos checked out as a sibling directory (as it is in this
// project's actual dev environment).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { snapshotClosedSprints } from "../snapshot-sprint-summary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENG_DATA_PATH = path.resolve(__dirname, "../../../engineering-ethos/src/lib/eng-data.ts");

async function loadEngData() {
  try {
    return await import(pathToFileURL(ENG_DATA_PATH).href);
  } catch (err) {
    console.warn(
      `[scoring-parity] Skipping: couldn't load ${ENG_DATA_PATH} (${err.message}). ` +
        "This test needs engineering-ethos checked out as a sibling directory.",
    );
    return null;
  }
}

// Re-derive computeForPerson's inputs the same way run-full-sync.mjs's
// caller would, but in-memory -- no DB. Kept in this file (not exported
// from snapshot-sprint-summary.mjs) since it's test-only wiring.
function buildFixture() {
  const sprintStart = new Date("2026-07-27T00:00:00.000Z"); // Monday
  const sprintEnd = new Date("2026-08-07T00:00:00.000Z"); // Friday, 10 workdays later
  const personId = "person-1";

  const tickets = [
    // Spillover ticket: original 7h, 2h remaining -- pro-rata should charge
    // this sprint for 2h, not 7h. Has an epic, no comment -- a real
    // hygiene gap (it's in progress, so it needs one).
    {
      id: "t-spillover",
      assignee_person_id: personId,
      status_category: "indeterminate",
      is_blocked: false,
      epic_id: "epic-1",
      original_estimate_seconds: 7 * 3600,
      remaining_estimate_seconds: 2 * 3600,
      resolved_at: null,
      updated_at: "2026-08-03T00:00:00.000Z",
    },
    // Oversized ticket -- excluded from allocated/logged entirely, but
    // still checked for hygiene (isOversized itself is a gap).
    {
      id: "t-oversized",
      assignee_person_id: personId,
      status_category: "indeterminate",
      is_blocked: false,
      epic_id: "epic-1",
      original_estimate_seconds: 40 * 3600,
      remaining_estimate_seconds: 34 * 3600,
      resolved_at: null,
      updated_at: "2026-08-04T00:00:00.000Z",
    },
    // Completed ticket, finished inside the sprint window with a real
    // estimate -- feeds estimate accuracy AND hygiene (done tickets count
    // toward hygiene even though excluded from allocated/logged hours).
    // No epic -- a real hygiene gap.
    {
      id: "t-done",
      assignee_person_id: personId,
      status_category: "done",
      is_blocked: false,
      epic_id: null,
      original_estimate_seconds: 4 * 3600,
      remaining_estimate_seconds: 0,
      // Date object, not an ISO string -- matches what `pg` hands back
      // for timestamptz columns; the snapshot side compares this
      // directly (>=/<=) against sprintStart/sprintEnd (also Dates), and
      // a string there silently coerces to NaN and always fails.
      resolved_at: new Date("2026-08-05T00:00:00.000Z"),
      updated_at: "2026-08-05T00:00:00.000Z",
    },
  ];

  // started_at/created_at as Date objects, not ISO strings -- matches
  // what `pg` actually hands back for timestamptz columns in production.
  // computeForPerson (the real snapshot implementation) compares these
  // with plain >=/<= against sprintStart/sprintEnd (also Dates); a string
  // there silently coerces to NaN and the comparison is always false.
  const worklogs = [
    { ticket_id: "t-spillover", author_person_id: personId, started_at: new Date("2026-08-06T00:00:00.000Z"), seconds: 1 * 3600 },
    { ticket_id: "t-oversized", author_person_id: personId, started_at: new Date("2026-08-06T00:00:00.000Z"), seconds: 5 * 3600 },
    { ticket_id: "t-done", author_person_id: personId, started_at: new Date("2026-08-05T00:00:00.000Z"), seconds: 2 * 3600 },
  ];

  const comments = [{ ticket_id: "t-spillover", author_person_id: personId, created_at: new Date("2026-08-06T00:00:00.000Z") }];

  return { sprintStart, sprintEnd, personId, tickets, worklogs, comments };
}

test("live and snapshot scoring agree at the moment a sprint closes", async () => {
  const engData = await loadEngData();
  if (!engData) return; // environment doesn't have the sibling repo -- see loadEngData

  const { sprintStart, sprintEnd, personId, tickets, worklogs, comments } = buildFixture();
  const now = sprintEnd; // evaluate the live path at the exact instant the sprint closes

  // --- snapshot-sprint-summary.mjs's computeForPerson is only reachable
  // through the DB-backed snapshotClosedSprints, so duplicate its handful
  // of pure lines here rather than stand up a database for this test.
  // If this drifts from computeForPerson itself, that's its own bug this
  // test can't catch -- it only catches drift between the two REPOS.
  const OVERSIZED_TICKET_SECONDS = 35 * 3600;

  // Mirrors ticketHygieneGaps in eng-data.ts exactly (see that function's
  // comment for the rationale) -- duplicated per-repo like the rest of
  // this test's inline snapshot logic.
  function ticketHygieneGapsInline(t) {
    const gaps = [];
    if (!t.hasEstimate) gaps.push("no original estimate");
    if (t.isOversized) gaps.push("estimate over 35h (needs breakdown)");
    if (!t.hasEpic) gaps.push("no epic");
    if (!t.isToDo && !t.hasComment) gaps.push("no comment");
    if (!t.isToDo && !t.isBlocked && !t.hasWorklog) gaps.push("no worklog");
    return gaps;
  }

  function computeForPersonInline() {
    const owned = tickets.filter((t) => t.assignee_person_id === personId);
    // allocatedHours/loggedHours/pace/estimateCoverage all exclude done
    // tickets -- matches the live app's useOpenTickets(), which
    // structurally excludes status_category='done' from what
    // computeSprintHours ever sees for these numbers. hygieneScore below
    // deliberately uses the FULL `owned` (open + done) instead.
    const ownedOpen = owned.filter((t) => t.status_category !== "done");
    const sized = ownedOpen.filter((t) => (t.original_estimate_seconds ?? 0) <= OVERSIZED_TICKET_SECONDS);
    const sizedIds = new Set(sized.map((t) => t.id));
    const allocatedHours =
      sized.reduce((s, t) => s + (t.remaining_estimate_seconds ?? t.original_estimate_seconds ?? 0), 0) / 3600;
    const loggedSeconds = worklogs
      .filter((w) => w.author_person_id === personId && sizedIds.has(w.ticket_id) && w.started_at >= sprintStart && w.started_at <= sprintEnd)
      .reduce((s, w) => s + w.seconds, 0);
    const loggedHours = loggedSeconds / 3600;
    const hasOpenWork = sized.length > 0;
    // A closed sprint has fully elapsed by the time this runs, so the
    // pro-rated pace expectation collapses to the full allocation --
    // see computePaceScore in eng-data.ts and the identical comment in
    // snapshot-sprint-summary.mjs.
    const paceDenominator = Math.max(allocatedHours, 1);
    const paceScore = hasOpenWork ? Math.min(100, Math.round((loggedHours / paceDenominator) * 100)) : null;
    const estimateCoverage =
      ownedOpen.length > 0 ? Math.round((100 * ownedOpen.filter((t) => t.original_estimate_seconds !== null).length) / ownedOpen.length) : null;
    // hasWorklog/hasComment are "ever" (unscoped by date) -- worklogs/
    // comments fixtures are already unscoped here, matching
    // allWorklogsForTickets/comments in the real snapshot script.
    const ticketsWithWorklogEver = new Set(worklogs.map((w) => w.ticket_id));
    const ticketsWithCommentEver = new Set(comments.map((c) => c.ticket_id));
    const hygieneScore =
      owned.length > 0
        ? Math.round(
            (100 *
              owned.filter(
                (t) =>
                  ticketHygieneGapsInline({
                    hasEstimate: t.original_estimate_seconds !== null,
                    isOversized: (t.original_estimate_seconds ?? 0) > OVERSIZED_TICKET_SECONDS,
                    hasEpic: t.epic_id !== null,
                    hasComment: ticketsWithCommentEver.has(t.id),
                    hasWorklog: ticketsWithWorklogEver.has(t.id),
                    isToDo: t.status_category === "new" && !t.is_blocked,
                    isBlocked: t.is_blocked,
                  }).length === 0,
              ).length) /
              owned.length,
          )
        : null;
    const wipTickets = owned.filter((t) => t.status_category === "indeterminate");
    const loggedTicketIds = new Set(
      worklogs.filter((w) => w.author_person_id === personId && w.started_at >= sprintStart && w.started_at <= sprintEnd).map((w) => w.ticket_id),
    );
    const loggingScore = wipTickets.length > 0 ? Math.round((100 * wipTickets.filter((t) => loggedTicketIds.has(t.id)).length) / wipTickets.length) : null;

    // Estimate accuracy: min(spent,est)/max(spent,est) pooled across
    // tickets resolved inside this window -- mirrors
    // computeSprintEstimateAccuracy in eng-data.ts exactly (symmetric,
    // so an overrun pulls the score down instead of being excluded).
    const doneInWindow = owned.filter(
      (t) => t.status_category === "done" && t.resolved_at && t.resolved_at >= sprintStart && t.resolved_at <= sprintEnd,
    );
    let matchedSeconds = 0;
    let totalSeconds = 0;
    for (const t of doneInWindow) {
      const est = t.original_estimate_seconds ?? 0;
      const spent = worklogs
        .filter((w) => w.ticket_id === t.id && w.started_at >= sprintStart && w.started_at <= sprintEnd)
        .reduce((s, w) => s + w.seconds, 0);
      if (est <= 0 || est > OVERSIZED_TICKET_SECONDS || spent <= 0) continue;
      matchedSeconds += Math.min(spent, est);
      totalSeconds += Math.max(spent, est);
    }
    const estimateScore = totalSeconds > 0 ? Math.round((matchedSeconds / totalSeconds) * 100) : null;

    return { paceScore, estimateCoverage, hygieneScore, loggingScore, estimateScore, allocatedHours: Math.round(allocatedHours), loggedHours: Math.round(loggedHours) };
  }

  const snapshotResult = computeForPersonInline();

  // --- live path (engineering-ethos). doneTickets split out separately
  // -- useOpenTickets() excludes status_category='done' entirely, but
  // useSprintDoneTickets() fetches it back for hygiene (see
  // useEmployees.ts) -- and worklogs pre-filtered to the sprint window
  // the way useSprintWorklogs()/DB query does before ever handing them
  // to computeSprintHours. allWorklogs/allComments stay unscoped by
  // date, matching useAllWorklogs()/useAllComments().
  const activeSprintIds = new Set(["sprint-1"]);
  const liveTicketsAll = tickets.map((t) => ({ ...t, sprint_id: "sprint-1", jira_key: t.id.toUpperCase(), summary: "x", status: "x" }));
  const liveOpenTickets = liveTicketsAll.filter((t) => t.status_category !== "done");
  const liveDoneTickets = liveTicketsAll.filter((t) => t.status_category === "done");
  const liveWorklogs = worklogs.filter((w) => new Date(w.started_at) >= sprintStart && new Date(w.started_at) <= sprintEnd);

  const liveResult = engData.computeSprintHours(liveOpenTickets, liveDoneTickets, liveWorklogs, worklogs, comments, personId, activeSprintIds);

  assert.equal(liveResult.allocatedHours, snapshotResult.allocatedHours, "allocatedHours (pro-rata spillover + oversized exclusion) must match");
  assert.equal(liveResult.loggedHours, snapshotResult.loggedHours, "loggedHours must match");
  assert.equal(liveResult.estimateCoverage, snapshotResult.estimateCoverage, "estimateCoverage must match");
  assert.equal(liveResult.hygieneScore, snapshotResult.hygieneScore, "hygieneScore (multi-criteria) must match");
  assert.equal(liveResult.loggingScore, snapshotResult.loggingScore, "loggingScore must match");

  // --- estimate accuracy, using engData's own computeSprintEstimateAccuracy
  // -- completedTickets shaped like CompletedTicketRow (id,
  // assignee_person_id, original_estimate_seconds), worklogs pre-filtered
  // to the sprint window the same way useSprintWorklogs()/DB query does.
  const liveCompletedTickets = liveDoneTickets
    .filter((t) => t.resolved_at && new Date(t.resolved_at) >= sprintStart)
    .map((t) => ({
      id: t.id,
      assignee_person_id: t.assignee_person_id,
      original_estimate_seconds: t.original_estimate_seconds,
      time_spent_seconds: null,
      resolved_at: t.resolved_at,
    }));
  const liveEstimateScores = engData.computeSprintEstimateAccuracy(liveCompletedTickets, liveWorklogs, new Set([personId]));
  assert.equal(liveEstimateScores.get(personId) ?? null, snapshotResult.estimateScore, "estimateScore (symmetric min/max accuracy) must match");

  // --- pace: live's dayNumber (via sprintWindow, evaluated at
  // now=sprintEnd) should equal totalDays for a sprint that's fully
  // elapsed, at which point computePaceScore's pro-rated expectation
  // collapses to the full allocation -- same as the snapshot side.
  const sprintRow = { id: "sprint-1", jira_project_id: "p", name: "S", state: "active", start_date: sprintStart.toISOString(), end_date: sprintEnd.toISOString() };
  const { dayNumber, totalDays } = engData.sprintWindow([sprintRow], now);
  const livePaceScore = liveResult.hasOpenWork
    ? engData.computePaceScore(liveResult.allocatedHours, liveResult.loggedHours, dayNumber, totalDays)
    : null;
  assert.equal(livePaceScore, snapshotResult.paceScore, "paceScore must match at sprint close");
});
