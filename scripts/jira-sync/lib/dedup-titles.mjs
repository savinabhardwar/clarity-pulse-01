import { similarityRatio } from "./similarity.mjs";

const TOKEN_STRIP = new Set(["fe", "be", "ui", "api", "frontend", "backend", "front-end", "back-end"]);
const THRESHOLD = 0.72;

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((tok) => !TOKEN_STRIP.has(tok))
    .join(" ")
    .trim();
}

/**
 * Cluster ticket titles by similarity ACROSS a project's epics (the
 * redundancy this catches is exactly the Backend/Frontend/Design/Testing
 * epic split of one feature). Returns clusters of {tickets, epicKeys}.
 */
export function clusterTicketTitles(tickets) {
  const normalized = tickets.map((t) => ({ ...t, _norm: normalizeTitle(t.summary) || t.summary.toLowerCase() }));

  const parent = normalized.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (x, y) => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (find(i) === find(j)) continue;
      if (similarityRatio(normalized[i]._norm, normalized[j]._norm) >= THRESHOLD) union(i, j);
    }
  }

  const groups = new Map();
  normalized.forEach((t, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  });

  return [...groups.values()].map((members) => {
    const representative = [...members].sort((a, b) => a.summary.trim().length - b.summary.trim().length || a.summary.localeCompare(b.summary))[0];
    return {
      name: representative.summary.trim(),
      tickets: members,
      epicKeys: [...new Set(members.map((m) => m.epicKey).filter(Boolean))],
    };
  });
}
