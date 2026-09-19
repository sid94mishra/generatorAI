// ────────────────────────────────────────────────────────────────
// runTitle — the name of a workflow run, as a person should read it.
//
// The server mints run names as `<definition> - Run <epoch-ms>` so they are
// unique and sortable. That suffix is machine bookkeeping: "Code Review -
// Run 1789753968513" tells a reader nothing the surrounding UI does not
// already say, and it crowds out the part that matters in breadcrumbs, cards
// and titles. Stripped at display time rather than changed at the source so
// runs created before this — and anything that still matches names — keeps
// working.
// ────────────────────────────────────────────────────────────────

/** Ten or more digits: a millisecond epoch, never a version or a count. */
const EPOCH_SUFFIX = /\s*[-–—]\s*Run\s+\d{10,}\s*$/i;

export function runTitle(name: string | null | undefined, fallback = 'Workflow run'): string {
  if (!name) return fallback;
  const stripped = name.replace(EPOCH_SUFFIX, '').trim();
  return stripped.length > 0 ? stripped : name;
}
