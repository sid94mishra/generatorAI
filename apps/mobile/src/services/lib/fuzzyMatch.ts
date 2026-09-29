// ────────────────────────────────────────────────────────────────
// fuzzyMatch — the search behind the model picker and other pickers.
//
// The web app filters with a plain `String.includes`, which means a single
// dropped or transposed letter returns "No models found." Typing "sonet" for
// "Sonnet 4.6" finds nothing there. On a phone — thumb typing, autocorrect
// fighting model names — that failure rate is not acceptable, so this does
// what web does and then two things more:
//
//   1. Punctuation is ignored on both sides, so "gpt4" reaches "GPT-4.1".
//   2. The query may match as a SUBSEQUENCE, so "sonet" reaches "sonnet"
//      (s-o-n-·-e-t) and "clsonnet" reaches "Claude Sonnet".
//
// Results are scored so exact and prefix hits still sort above loose ones —
// subsequence matching alone would bury the obvious answer.
// ────────────────────────────────────────────────────────────────

/** Lowercase and drop everything that is not a letter or digit. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True when every character of `query` appears in `text` in order.
 * Also returns how tightly they were packed, which is what separates
 * "sonet"→"sonnet" from "sonet"→"some other network thing".
 */
function subsequenceSpan(text: string, query: string): number | null {
  let ti = 0;
  let first = -1;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi]!;
    let found = -1;
    while (ti < text.length) {
      if (text[ti] === ch) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found === -1) return null;
    if (first === -1) first = found;
  }
  return ti - first;
}

/**
 * Score one candidate against a query. Higher is better; `null` means no
 * match at all. Callers sort descending and drop the nulls.
 */
export function fuzzyScore(query: string, ...fields: Array<string | undefined | null>): number | null {
  const q = normalize(query);
  if (!q) return 0;

  let best: number | null = null;
  for (let i = 0; i < fields.length; i++) {
    const raw = fields[i];
    if (!raw) continue;
    const text = normalize(raw);
    if (!text) continue;

    // Earlier fields are more authoritative — a hit on the display name
    // should outrank the same hit on an opaque id.
    const fieldWeight = 100 - i * 10;

    let score: number | null = null;
    if (text === q) score = 1000 + fieldWeight;
    else if (text.startsWith(q)) score = 800 + fieldWeight;
    else if (text.includes(q)) score = 600 + fieldWeight;
    else {
      const span = subsequenceSpan(text, q);
      // The letters have to be nearly contiguous to count as a typo. The
      // slack scales with the query so a long query can absorb a couple of
      // dropped characters, while a 3-letter query cannot sprawl across a
      // whole name and call itself a match.
      const slack = q.length + Math.max(1, Math.floor(q.length / 2));
      if (span !== null && span <= slack) {
        score = 300 + fieldWeight - (span - q.length) * 10;
      }
    }

    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}

/**
 * Filter and rank a list. Stable for equal scores, so a catalog's own
 * ordering survives when the query does not discriminate.
 */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => Array<string | undefined | null>,
): T[] {
  if (!query.trim()) return [...items];
  const scored: Array<{ item: T; score: number; index: number }> = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const score = fuzzyScore(query, ...fields(item));
    if (score !== null) scored.push({ item, score, index });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.map((s) => s.item);
}
