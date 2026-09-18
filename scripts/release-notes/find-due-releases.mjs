import { readSchedule } from "./lib/schedule-table.mjs";
import { productConfig } from "./lib/schedule-config.mjs";

// Returns the schedule rows that are due to fire: Next Release Date is
// set and <= today (due today, or overdue from a missed/delayed run) AND
// Last Release Date is already seeded. A row with an empty Last Release
// Date is skipped (logged, not an error) -- the user hasn't seeded a
// starting cutoff for that product yet. Dates are ISO (YYYY-MM-DD), so
// lexicographic comparison is correct.
//
// This must stay "due or overdue," not "== today": GitHub's schedule
// queue delay can push a run past midnight UTC, and the workflow can
// simply not exist yet or not run on a given day. An exact-match check
// makes a missed date vanish permanently instead of catching up on the
// next run -- see CX Omni/PBX Manager/Forecasting, which all missed
// their exact-date window this way before this fix.
export async function findDueReleases(today) {
  const rows = await readSchedule();
  const due = [];
  for (const row of rows) {
    if (!row.nextReleaseDate || row.nextReleaseDate > today) continue;
    if (!row.lastReleaseDate) {
      console.warn(
        `[release-notes] skipping "${row.product}": Next Release Date is set but Last Release Date is empty`,
      );
      continue;
    }
    const config = productConfig(row.product);
    if (!config) {
      console.warn(`[release-notes] skipping "${row.product}": no schedule-config entry`);
      continue;
    }
    due.push({ ...config, lastReleaseDate: row.lastReleaseDate });
  }
  return due;
}
