import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { similarityRatio } from "./lib/similarity.mjs";

const EPICS_PATH = new URL("./cache/epics.raw.jsonl", import.meta.url);
const OUT_PATH = new URL("../../src/data/generated/projects.json", import.meta.url);

const SIMILARITY_THRESHOLD = 0.72;

// Pure workstream-discipline modifiers: stripping these lets e.g.
// "QIP Frontend" / "QIP Backend" / "QIP Design" / "QIP Bugs" / "QIP Testing"
// collapse to one "QIP" project. Deliberately does NOT include words like
// "migration" / "infrastructure" / "cleanup" that can carry real product
// identity (e.g. "WAAC" vs "WAAC migration" are left as separate epics
// rather than risk silently merging unrelated work).
const MODIFIER_TOKENS = new Set([
  "frontend", "front-end", "front", "backend", "back-end", "back",
  "fe", "be", "ui", "api", "design", "bugs", "bug", "testing", "tests",
  "test", "cases", "improvement", "improvements",
]);

// Generic catch-all epic names that exist independently per team and should
// NOT be merged across the 5 Jira projects even if their names match.
const GENERIC_PATTERNS = [
  /^support tickets?$/i,
  /^support ticket requests?$/i,
  /^backlog\b/i,
];

function normalize(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((tok) => !MODIFIER_TOKENS.has(tok));
  return cleaned.join(" ").trim();
}

function isGeneric(coreName) {
  return GENERIC_PATTERNS.some((re) => re.test(coreName));
}

const lines = readFileSync(EPICS_PATH, "utf8").trim().split("\n");
const epics = lines.map((l) => JSON.parse(l));

for (const e of epics) {
  e.core = normalize(e.summary) || e.summary.toLowerCase().trim();
  e.generic = isGeneric(e.core);
  // Generic epics are namespaced per Jira project so they don't merge
  // across teams (e.g. TI's "Backlog - DevOps" stays separate from
  // TEAM's "Support Tickets").
  e.clusterKey = e.generic ? `${e.project}::${e.core}` : e.core;
}

// Union-find clustering: exact clusterKey match, OR fuzzy similarity above
// threshold between non-generic core names (generic ones only ever match
// their own exact per-project key, never fuzzy-merged).
const parent = epics.map((_, i) => i);
function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
function union(x, y) { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; }

const byExactKey = new Map();
epics.forEach((e, i) => {
  if (!byExactKey.has(e.clusterKey)) byExactKey.set(e.clusterKey, []);
  byExactKey.get(e.clusterKey).push(i);
});
for (const idxs of byExactKey.values()) {
  for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k]);
}

for (let i = 0; i < epics.length; i++) {
  if (epics[i].generic) continue;
  for (let j = i + 1; j < epics.length; j++) {
    if (epics[j].generic) continue;
    if (find(i) === find(j)) continue;
    if (similarityRatio(epics[i].core, epics[j].core) >= SIMILARITY_THRESHOLD) {
      union(i, j);
    }
  }
}

const clusters = new Map();
epics.forEach((e, i) => {
  const root = find(i);
  if (!clusters.has(root)) clusters.set(root, []);
  clusters.get(root).push(e);
});

function pickDisplayName(members) {
  // If every member reduces to the exact same modifier-stripped core (the
  // QIP Frontend/Backend/Design/Bugs/Testing case), reconstruct a clean
  // display name from that shared core rather than picking whichever
  // member's raw summary happens to be shortest (which can misleadingly
  // read like "QIP Bugs" for a project that is not primarily about bugs).
  const cores = new Set(members.map((m) => m.core));
  if (cores.size === 1 && members.length > 1) {
    const coreTokens = members[0].core.split(" ").filter(Boolean);
    const casingVotes = coreTokens.map(() => new Map());
    for (const m of members) {
      const rawTokens = m.summary.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
      const originalTokens = m.summary.split(/\s+/).filter(Boolean);
      coreTokens.forEach((tok, ti) => {
        const idx = rawTokens.indexOf(tok);
        if (idx !== -1 && originalTokens[idx]) {
          const votes = casingVotes[ti];
          votes.set(originalTokens[idx], (votes.get(originalTokens[idx]) || 0) + 1);
        }
      });
    }
    const reconstructed = coreTokens.map((tok, ti) => {
      const votes = casingVotes[ti];
      if (!votes.size) return tok[0].toUpperCase() + tok.slice(1);
      return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    });
    return reconstructed.join(" ");
  }

  // Otherwise (fuzzy-matched cluster of genuinely differently-worded
  // epics, or a singleton) prefer the shortest, plainest original summary.
  const sorted = [...members].sort((a, b) => {
    const la = a.summary.trim().length, lb = b.summary.trim().length;
    if (la !== lb) return la - lb;
    return a.summary.localeCompare(b.summary);
  });
  return sorted[0].summary.trim().replace(/\s+/g, " ");
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const projects = [];
const usedIds = new Set();
for (const members of clusters.values()) {
  const displayName = pickDisplayName(members);
  let id = slugify(displayName) || "project";
  let suffix = 2;
  while (usedIds.has(id)) { id = `${slugify(displayName)}-${suffix++}`; }
  usedIds.add(id);

  const recentCutoff = Date.parse("2026-06-01T00:00:00Z");
  const hasRecentActivity = members.some((m) => Date.parse(m.updated) >= recentCutoff);

  projects.push({
    id,
    name: displayName,
    current: hasRecentActivity,
    jiraProjects: [...new Set(members.map((m) => m.project))].sort(),
    epics: members
      .map((m) => ({ key: m.key, summary: m.summary, status: m.status, updated: m.updated }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  });
}

projects.sort((a, b) => b.epics.length - a.epics.length || a.name.localeCompare(b.name));

const output = {
  generatedAt: new Date().toISOString(),
  similarityThreshold: SIMILARITY_THRESHOLD,
  overrides: {},
  projects,
};

mkdirSync(new URL(".", OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + "\n");
console.log(`Clustered ${epics.length} epics into ${projects.length} projects.`);
console.log(`Current (recently active) projects: ${projects.filter((p) => p.current).length}`);
