// Difflib-style SequenceMatcher ratio (Ratcliff/Obershelp), matching Python's
// difflib.SequenceMatcher(None, a, b).ratio() closely enough for clustering thresholds.
function matchBlocks(a, b) {
  const b2j = new Map();
  for (let j = 0; j < b.length; j++) {
    const ch = b[j];
    if (!b2j.has(ch)) b2j.set(ch, []);
    b2j.get(ch).push(j);
  }

  function findLongestMatch(alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      const indices = b2j.get(a[i]) || [];
      for (const j of indices) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    return [besti, bestj, bestsize];
  }

  const queue = [[0, a.length, 0, b.length]];
  const matches = [];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
    if (k) {
      matches.push([i, j, k]);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  matches.sort((x, y) => x[0] - y[0]);
  return matches;
}

export function similarityRatio(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const matches = matchBlocks(a, b);
  const matched = matches.reduce((s, m) => s + m[2], 0);
  return (2 * matched) / (a.length + b.length);
}
