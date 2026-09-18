// ────────────────────────────────────────────────────────────────
// paneModel — which session panes a chat gets, and in what order.
//
// Pure, so the rule ("Changes/Terminal/Browser need a workspace; Tasks needs
// an orchestrator or a spawned task; Computer needs computer use switched on;
// the strip order is fixed") is unit-tested without a renderer.
// ────────────────────────────────────────────────────────────────

import { checkFeature, type FeatureAvailability } from '../../../auth/featureGate';

export type PaneId = 'chat' | 'changes' | 'tasks' | 'terminal' | 'browser' | 'computer';

export interface PaneDescriptor {
  id: PaneId;
  label: string;
  /** Shown after the label — "Changes 3". */
  count?: number;
  /** A live dot after the label, for state with no useful number. */
  live?: boolean;
}

export const COMPUTER_SCOPE = 'exec:computer';

/**
 * The Computer pane: latest window frame, activity, consent answers and
 * standing grants (ComputerPane.tsx). Kept as a switch so the pane can be
 * withdrawn in one place if the server surface changes under it.
 */
export const COMPUTER_PANE_IMPLEMENTED = true;

/**
 * `exec:computer` as a feature check. Local rather than in featureGate.ts
 * (owned elsewhere) — same shape, so `LockedPane` renders it unchanged.
 * Grantable: it is a per-device opt-in, requested like terminal/browser.
 */
export function computerFeature(scopes: readonly string[]): FeatureAvailability {
  // Single source of truth for the requirement and its reason copy.
  return checkFeature('computer', scopes);
}

/**
 * Terminal and Browser are listed even without their scope — the pane
 * itself renders a locked page with the reason and a "Request access" route
 * (HIG: hiding a destination is worse than explaining it). Computer follows
 * web: it is offered once computer use is switched on for this server
 * (`GET /api/system/computer-use`), and then locked without `exec:computer`.
 */
export function availablePanes(input: {
  workspaceId: string | null;
  scopes: readonly string[];
  changesCount: number;
  /** Chromium is up for this workspace — the Browser tab gets a live dot. */
  browserLive?: boolean;
  /**
   * Background workers. The Tasks pane is offered to an orchestrator chat, or
   * to any chat that has spawned a task — web auto-opens its Background Tasks
   * tab in exactly those cases. `running` is the live count on the segment.
   */
  tasks?: { orchestrator: boolean; total: number; running: number };
  /** Computer use is enabled on the server (web shows its tab on the same rule). */
  computerUseEnabled?: boolean;
  /** A consent prompt is waiting — the Computer tab gets a live dot. */
  computerNeedsAnswer?: boolean;
}): PaneDescriptor[] {
  const out: PaneDescriptor[] = [{ id: 'chat', label: 'Chat' }];
  const tasks = input.tasks;
  const tasksPane: PaneDescriptor | null =
    tasks && (tasks.orchestrator || tasks.total > 0)
      ? { id: 'tasks', label: 'Tasks', ...(tasks.running > 0 ? { count: tasks.running } : {}) }
      : null;
  if (!input.workspaceId) {
    // Workers run in their own workspaces, so Tasks does not wait for this one.
    if (tasksPane) out.push(tasksPane);
    return out;
  }
  out.push({ id: 'changes', label: 'Changes', ...(input.changesCount > 0 ? { count: input.changesCount } : {}) });
  if (tasksPane) out.push(tasksPane);
  out.push({ id: 'terminal', label: 'Terminal' });
  out.push({ id: 'browser', label: 'Browser', ...(input.browserLive ? { live: true } : {}) });
  if (COMPUTER_PANE_IMPLEMENTED && input.computerUseEnabled) {
    out.push({ id: 'computer', label: 'Computer', ...(input.computerNeedsAnswer ? { live: true } : {}) });
  }
  return out;
}

/**
 * Where a composer slash-command section lands: a pane, the Workbench sheet,
 * or nowhere. `tasks` goes to the pane when the strip offers one (pass the
 * current panes), otherwise to the sheet.
 */
export function routeSection(
  section: string,
  panes: readonly PaneDescriptor[] = [],
): { pane: PaneId } | { more: 'files' | 'plan' | 'tasks' } | null {
  switch (section) {
    case 'changes':
    case 'terminal':
    case 'browser':
      return { pane: section };
    case 'tasks':
      return panes.some((p) => p.id === 'tasks') ? { pane: 'tasks' } : { more: 'tasks' };
    case 'files':
    case 'plan':
      return { more: section };
    default:
      return null;
  }
}
