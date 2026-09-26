// ────────────────────────────────────────────────────────────────
// fileTabId — a right-pane tab id that *is* the file reference
// ────────────────────────────────────────────────────────────────
//
// Opening a file in its own tab needs a tabId → file mapping. Rather than
// keeping that in a store, the reference is encoded straight into the id.
// Three things then come for free:
//
//   • dedupe   — re-opening a file yields the same id, so RightPane focuses
//                the tab already showing it instead of adding a duplicate
//   • reload   — the tab strip is persisted in localStorage, so a restored
//                tab already knows its file; no parallel store to rehydrate
//   • close    — nothing to clean up when the tab goes away
//
// The alias is percent-encoded so a `:` in a repo alias can never be
// mistaken for the separator. Paths are left readable, which makes the
// persisted state and the DOM easy to inspect.

const PREFIX = 'file:';

export interface FileTabRef {
  /** Repo alias — `.` for the workspace root. */
  alias: string;
  /** Repo-relative path. */
  path: string;
}

export function fileTabId({ alias, path }: FileTabRef): string {
  return `${PREFIX}${encodeURIComponent(alias)}:${path}`;
}

/** Parse a tab id back into its file reference, or null if it isn't one. */
export function parseFileTabId(id: string): FileTabRef | null {
  if (!id.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep === -1) return null;
  const path = rest.slice(sep + 1);
  if (!path) return null;
  return { alias: decodeURIComponent(rest.slice(0, sep)), path };
}

/** Basename, for the tab label. */
export function fileTabLabel(id: string): string | null {
  const ref = parseFileTabId(id);
  if (!ref) return null;
  return ref.path.split('/').pop() ?? ref.path;
}
