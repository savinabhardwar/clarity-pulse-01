// Entrypoint for the GitHub Actions job (and for local manual/dry runs):
// finds any product whose Next Release Date is today in the Confluence
// Release Schedule page, pulls what it completed in Jira since its Last
// Release Date, summarizes it, publishes a new release-notes page under
// that product's folder, then advances the schedule row.
import { findDueReleases } from "./find-due-releases.mjs";
import { fetchCompletedIssues } from "./fetch-completed-issues.mjs";
import { summarize } from "./summarize.mjs";
import { publish } from "./publish.mjs";
import { readSchedule, updateScheduleRow } from "./lib/schedule-table.mjs";
import { SPACE_ID, productConfig } from "./lib/schedule-config.mjs";

function validateEnv() {
  const required = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "GEMINI_API_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[release-notes] missing required environment variable(s): ${missing.join(", ")}`,
    );
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const projectFlag = argv.indexOf("--project");
  const dateFlag = argv.indexOf("--date");
  return {
    dryRun,
    project: projectFlag !== -1 ? argv[projectFlag + 1] : null,
    date: dateFlag !== -1 ? argv[dateFlag + 1] : todayIso(),
  };
}

async function runOne({ product, parentPageId, jiraKey, lastReleaseDate }, until, dryRun) {
  console.log(
    `[release-notes] ${product}: fetching ${jiraKey} issues done ${lastReleaseDate} -> ${until}`,
  );
  const issues = await fetchCompletedIssues({ jiraKey, since: lastReleaseDate, until });
  console.log(`[release-notes] ${product}: ${issues.length} completed issue(s)`);

  const summaryMarkdown = await summarize({ product, issues });

  const result = await publish({
    spaceId: SPACE_ID,
    parentPageId,
    product,
    sinceIso: lastReleaseDate,
    untilIso: until,
    summaryMarkdown,
    dryRun,
  });

  if (!dryRun && !result.skipped) {
    await updateScheduleRow(product, { lastReleaseDate: until, nextReleaseDate: "" });
    console.log(`[release-notes] ${product}: schedule advanced (Last Release Date -> ${until})`);
  }
  return result;
}

async function main() {
  validateEnv();
  const { dryRun, project, date } = parseArgs(process.argv.slice(2));

  // --project bypasses the "Next Release Date == today" schedule check
  // entirely -- it's meant for manual/dry-run testing of a single
  // product against an arbitrary --date, not for real scheduled runs
  // (those always go through findDueReleases below).
  let due;
  if (project) {
    const rows = await readSchedule();
    const row = rows.find((r) => r.product === project || r.jiraKey === project);
    const config = productConfig(row?.product ?? project);
    if (!row || !config) throw new Error(`[release-notes] no schedule row/config for "${project}"`);
    if (!row.lastReleaseDate)
      throw new Error(`[release-notes] "${project}" has no Last Release Date seeded yet`);
    due = [{ ...config, lastReleaseDate: row.lastReleaseDate }];
  } else {
    due = await findDueReleases(date);
  }

  if (due.length === 0) {
    console.log(`[release-notes] no products due for ${date}`);
    return;
  }

  const failures = [];
  for (const entry of due) {
    try {
      await runOne(entry, date, dryRun);
    } catch (err) {
      console.error(`[release-notes] ${entry.product} FAILED (non-fatal, continuing):`, err);
      failures.push(entry.product);
    }
  }

  if (failures.length > 0) {
    throw new Error(`[release-notes] failed for: ${failures.join(", ")}`);
  }
  console.log("[release-notes] done");
}

main().catch((err) => {
  console.error("[release-notes] FAILED", err);
  process.exit(1);
});
