// ────────────────────────────────────────────────────────────────
// Small text helpers for diagnostics.
// ────────────────────────────────────────────────────────────────

/** Levenshtein distance, bounded: returns `max + 1` as soon as it is exceeded. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** The candidate closest to `name` (case-insensitive), if it is close enough to be a typo. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  const lower = name.toLowerCase();
  const limit = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  let best: string | undefined;
  let bestD = limit + 1;
  for (const c of candidates) {
    if (c === name) continue;
    const d = editDistance(lower, c.toLowerCase(), limit);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
