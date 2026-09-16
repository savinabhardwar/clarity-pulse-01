// Dependency-free string similarity helpers used to suggest a matching
// real Jira ticket for a user-typed Feature/Implementation summary.
// Deliberately simple (Jaccard over word sets) rather than pulling in a
// fuzzy-match library -- mirrors this codebase's convention of writing
// small bespoke matching logic (see the sync pipeline's own lightweight
// fuzzy clustering for project_features) instead of a dependency.

/** Lowercase, trim, collapse internal whitespace, strip leading/trailing punctuation. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * Jaccard similarity over the set of whitespace-separated words in each
 * (already-normalized-by-caller-or-not) string. Returns 0..1; two strings
 * that normalize identically always score exactly 1.
 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const wordsA = na.split(" ").filter(Boolean);
  const wordsB = nb.split(" ").filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
