// ────────────────────────────────────────────────────────────────
// Telling same-named rows apart.
//
// Two projects both called "V project" rendered as identical rows. The list
// payload carries no codebase count, so the subtitle for a duplicate falls
// back to facts that DO differ: the description when there is one, else the
// creation time plus a short id.
//
// Pure, tested in src/__tests__/disambiguate.test.ts.
// ────────────────────────────────────────────────────────────────

/** Normalised names that occur more than once. */
export function duplicateNames<T>(items: readonly T[], nameOf: (item: T) => string): Set<string> {
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = nameOf(item).trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [key, count] of seen) if (count > 1) dupes.add(key);
  return dupes;
}

/** A short, human-scannable id suffix: the last 6 alphanumerics. */
export function shortId(id: string): string {
  const clean = id.replace(/[^a-z0-9]/gi, '');
  return clean.slice(-6).toLowerCase();
}

export function isDuplicateName(dupes: Set<string>, name: string): boolean {
  return dupes.has(name.trim().toLowerCase());
}
