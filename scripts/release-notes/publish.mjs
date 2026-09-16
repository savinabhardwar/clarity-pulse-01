import { createPage, getPageChildren } from "./lib/confluence-rest.mjs";

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatLongDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// "24 August" -- matches the existing QIP example's title, which omits
// the year (the page's own creation date disambiguates it).
function formatShortDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

// Converts the "* **Theme:** sentence" markdown bullet list from
// summarize.mjs into Confluence storage HTML, matching the structure of
// the manually-authored QIP example (page id 528908289).
function bulletsToHtml(markdown) {
  const items = markdown
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^\*\s+\*\*(.+?):\*\*\s*(.*)$/);
      if (m) return `<li><p><strong>${escapeHtml(m[1])}:</strong> ${escapeHtml(m[2])}</p></li>`;
      return `<li><p>${escapeHtml(line.replace(/^\*\s*/, ""))}</p></li>`;
    })
    .join("");
  return `<ul>${items}</ul>`;
}

export function buildTitle(product, sinceIso, untilIso) {
  return `${product} Release Notes: ${formatShortDate(sinceIso)} - ${formatShortDate(untilIso)}`;
}

export function buildBodyHtml(product, sinceIso, summaryMarkdown) {
  return (
    `<h1>${escapeHtml(product)} Release Notes</h1>` +
    `<h3>Since ${escapeHtml(formatLongDate(sinceIso))}</h3>` +
    bulletsToHtml(summaryMarkdown)
  );
}

// Guards against a duplicate post if the Action retries within the same
// day -- checks the product's parent folder for a child page with this
// exact title before creating a new one.
export async function publish({ spaceId, parentPageId, product, sinceIso, untilIso, summaryMarkdown, dryRun }) {
  const title = buildTitle(product, sinceIso, untilIso);
  const bodyHtml = buildBodyHtml(product, sinceIso, summaryMarkdown);

  if (dryRun) {
    console.log(`\n[dry-run] would publish "${title}" under parent ${parentPageId}:\n${bodyHtml}\n`);
    return { title, dryRun: true };
  }

  const existingChildren = await getPageChildren(parentPageId);
  if (existingChildren.some((c) => c.title === title)) {
    console.warn(`[release-notes] "${title}" already exists under ${parentPageId} -- skipping publish`);
    return { title, skipped: true };
  }

  const page = await createPage({ spaceId, parentId: parentPageId, title, bodyHtml });
  console.log(`[release-notes] published "${title}" (page ${page.id})`);
  return { title, pageId: page.id };
}
