// ────────────────────────────────────────────────────────────────
// terminalFocus — which shell the user last looked at, and what they selected.
//
// The composer's "Terminal output" capture lives on the Chat page, not inside
// the terminal pane, so it needs to know which of up to four shells to read
// and whether the user has a selection waiting. `TerminalView` reports both
// here; the composer reads them. Module state, not React context: the
// terminal pane and the composer are siblings under different pages of the
// pager, and the full-screen terminal route is another screen entirely.
//
// The selection is kept only briefly (SELECTION_TTL_MS) and only per
// workspace: a selection made ten minutes ago in another project is not what
// "attach my selection" means.
// ────────────────────────────────────────────────────────────────

export const SELECTION_TTL_MS = 10 * 60_000;

interface WorkspaceFocus {
  sessionId: string | null;
  selection: { sessionId: string; text: string; at: number } | null;
}

const byWorkspace = new Map<string, WorkspaceFocus>();

function entry(workspaceId: string): WorkspaceFocus {
  let e = byWorkspace.get(workspaceId);
  if (!e) {
    e = { sessionId: null, selection: null };
    byWorkspace.set(workspaceId, e);
  }
  return e;
}

/** A terminal became the visible one. */
export function noteActiveTerminal(workspaceId: string, sessionId: string): void {
  entry(workspaceId).sessionId = sessionId;
}

/** xterm reported its selection (an empty string clears it). */
export function noteTerminalSelection(workspaceId: string, sessionId: string, text: string, now = Date.now()): void {
  const e = entry(workspaceId);
  e.selection = text.trim().length > 0 ? { sessionId, text, at: now } : e.selection?.sessionId === sessionId ? null : e.selection;
}

/** A session went away — forget it so a capture never targets a dead shell. */
export function forgetTerminal(workspaceId: string, sessionId: string): void {
  const e = byWorkspace.get(workspaceId);
  if (!e) return;
  if (e.sessionId === sessionId) e.sessionId = null;
  if (e.selection?.sessionId === sessionId) e.selection = null;
}

/** The last-viewed shell, if it is still among `alive`; else the first alive one. */
export function pickCaptureSession(workspaceId: string, alive: readonly string[]): string | null {
  const last = byWorkspace.get(workspaceId)?.sessionId ?? null;
  if (last && alive.includes(last)) return last;
  return alive[0] ?? null;
}

/** A fresh, non-empty selection for this workspace. */
export function currentTerminalSelection(workspaceId: string, now = Date.now()): string | null {
  const sel = byWorkspace.get(workspaceId)?.selection;
  if (!sel || now - sel.at > SELECTION_TTL_MS) return null;
  return sel.text;
}

/** Test-only. */
export function _resetTerminalFocusForTests(): void {
  byWorkspace.clear();
}
