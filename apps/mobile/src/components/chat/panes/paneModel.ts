// ────────────────────────────────────────────────────────────────
// paneModel — which session panes a chat gets, and in what order.
//
// Pure, so the rule ("Changes/Terminal/Browser need a workspace; Computer
// needs `exec:computer`; the strip order is fixed") is unit-tested without
// a renderer.
// ────────────────────────────────────────────────────────────────

export type PaneId = 'chat' | 'changes' | 'terminal' | 'browser' | 'computer';

export interface PaneDescriptor {
  id: PaneId;
  label: string;
  /** Shown after the label — "Changes 3". */
  count?: number;
}

export const COMPUTER_SCOPE = 'exec:computer';

/**
 * Terminal and Browser are listed even without their scope — the pane
 * itself renders a locked page with the reason and a "Request access" route
 * (HIG: hiding a destination is worse than explaining it). Computer is the
 * exception: it is omitted until the scope is held.
 */
export function availablePanes(input: {
  workspaceId: string | null;
  scopes: readonly string[];
  changesCount: number;
}): PaneDescriptor[] {
  const out: PaneDescriptor[] = [{ id: 'chat', label: 'Chat' }];
  if (!input.workspaceId) return out;
  out.push({ id: 'changes', label: 'Changes', ...(input.changesCount > 0 ? { count: input.changesCount } : {}) });
  out.push({ id: 'terminal', label: 'Terminal' });
  out.push({ id: 'browser', label: 'Browser' });
  if (input.scopes.includes(COMPUTER_SCOPE)) out.push({ id: 'computer', label: 'Computer' });
  return out;
}

/** Where a composer slash-command section lands: a pane, the More sheet, or nowhere. */
export function routeSection(section: string): { pane: PaneId } | { more: 'files' | 'plan' | 'tasks' } | null {
  switch (section) {
    case 'changes':
    case 'terminal':
    case 'browser':
      return { pane: section };
    case 'files':
    case 'plan':
    case 'tasks':
      return { more: section };
    default:
      return null;
  }
}
