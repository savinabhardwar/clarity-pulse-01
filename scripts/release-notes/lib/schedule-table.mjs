// Minimal HTML table reader/writer for the "Release Schedule" Confluence
// page. Deliberately not a general HTML parser -- the page's body is
// entirely owned by this automation (one intro paragraph + one table),
// so a small regex-based reader/writer is enough and avoids a real HTML
// parsing dependency for a single, narrowly-shaped page.
import { getPage, updatePage } from "./confluence-rest.mjs";
import { RELEASE_SCHEDULE_PAGE_ID } from "./schedule-config.mjs";

const COLUMNS = ["product", "jiraKey", "lastReleaseDate", "nextReleaseDate"];

function cellText(cellHtml) {
  return cellHtml
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .trim();
}

function parseRows(bodyHtml) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(bodyHtml))) {
    const cells = [...rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) =>
      cellText(m[1]),
    );
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// Reads the Release Schedule table, skipping the header row, and returns
// one object per product row, keyed by COLUMNS.
export async function readSchedule() {
  const page = await getPage(RELEASE_SCHEDULE_PAGE_ID, { bodyFormat: "storage" });
  const bodyHtml = page.body.storage.value;
  const rows = parseRows(bodyHtml).slice(1); // drop header row
  return rows.map((cells) =>
    Object.fromEntries(
      COLUMNS.map((c, i) => {
        const v = (cells[i] ?? "").trim();
        return [c, v === "-" ? "" : v]; // "-" is the user's shorthand for "not set yet"
      }),
    ),
  );
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderTableHtml(rows) {
  const header =
    "<tr>" +
    ["Product", "Jira Key", "Last Release Date", "Next Release Date"]
      .map((h) => `<th><p>${h}</p></th>`)
      .join("") +
    "</tr>";
  const body = rows
    .map(
      (r) =>
        "<tr>" + COLUMNS.map((c) => `<td><p>${escapeHtml(r[c] ?? "")}</p></td>`).join("") + "</tr>",
    )
    .join("");
  return `<table data-layout="default"><tbody>${header}${body}</tbody></table>`;
}

// Rewrites the whole page body (intro paragraph + table) with the given
// rows, preserving everything outside the table verbatim.
export async function writeSchedule(rows) {
  const page = await getPage(RELEASE_SCHEDULE_PAGE_ID, { bodyFormat: "storage" });
  const bodyHtml = page.body.storage.value;
  const newBodyHtml = bodyHtml.replace(/<table[\s\S]*<\/table>/, renderTableHtml(rows));
  await updatePage(RELEASE_SCHEDULE_PAGE_ID, {
    title: page.title,
    bodyHtml: newBodyHtml,
    version: page.version.number + 1,
  });
}

// Updates a single product's row in place (used after a successful
// publish) without disturbing any other row or manual edit in flight.
export async function updateScheduleRow(product, patch) {
  const rows = await readSchedule();
  const idx = rows.findIndex((r) => r.product === product);
  if (idx === -1) throw new Error(`updateScheduleRow: no schedule row for product "${product}"`);
  rows[idx] = { ...rows[idx], ...patch };
  await writeSchedule(rows);
}
