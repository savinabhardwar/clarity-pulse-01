import { readSchedule } from "./lib/schedule-table.mjs";
import { productConfig } from "./lib/schedule-config.mjs";

// Returns the schedule rows that are due to fire today: Next Release
// Date == today AND Last Release Date is already seeded. A row with an
// empty Last Release Date is skipped (logged, not an error) -- the user
// hasn't seeded a starting cutoff for that product yet.
export async function findDueReleases(today) {
  const rows = await readSchedule();
  const due = [];
  for (const row of rows) {
    if (row.nextReleaseDate !== today) continue;
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
