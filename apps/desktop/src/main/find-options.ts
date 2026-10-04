// ────────────────────────────────────────────────────────────────
// The renderer's find request → Electron's `FindInPageOptions`.
//
// The renderer says `findNext: true` for "step to the next/previous match of the current query". Electron's
// `findNext` means the opposite — "begin a new find session" (true for the first request of a query,
// false/omitted for follow-ups). Passed straight through, every Enter restarted the search at match 1 and
// Shift+Enter jumped to the last match. A new query sends `findNext: true`; a step omits it (Electron 42
// does not answer an explicit `false` with `found-in-page`).
// ────────────────────────────────────────────────────────────────

import type { FindInPageOptions } from 'electron';

export function findInPageOptions(arg: { forward?: unknown; findNext?: unknown }): FindInPageOptions {
  const options: FindInPageOptions = { forward: arg.forward !== false };
  if (arg.findNext !== true) options.findNext = true;
  return options;
}
