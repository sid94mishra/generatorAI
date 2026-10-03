// The pane's tabs for a scope (03 MB-42; MD-23): which tabs show, their counts and needs-you dots, from the facts
// the queries gathered. Pure, unit-tested; `usePaneTabs` (WorkspacePane.queries.ts) feeds it.
import type { PaneTab } from '../../ui/layout/PaneTabStrip';
import { PANE_TABS, paneTabTypes, type MobilePaneTab } from './paneRegistry';

/** Worker statuses that count as running (web Tasks panel's active set). */
export const ACTIVE_TASK_STATUSES: ReadonlySet<string> = new Set(['spawned', 'running', 'reviewing', 'queued', 'needs_review']);

export interface PaneTabInputs {
  kind: 'chat' | 'run';
  /** Changed files in the scope's workspace (the toggle count, MD-23). */
  changedFiles?: number;
  /** Orchestrator chat, or one that has background tasks. */
  tasks?: { orchestrator: boolean; total: number; running: number };
  /** The latest plan's status, when the chat has one. */
  planStatus?: string | null;
  /** Computer use is on on the server; a consent ask is waiting. */
  computer?: { enabled: boolean; needsAnswer: boolean };
  /** Run panes (MG-28): the focused stage's files, the configured hooks, the run's variables, a stage that needs you. */
  run?: { files?: number; hooks?: number; variables?: number; needsYou?: boolean };
}

export type PaneTabEntry = PaneTab & { type: MobilePaneTab };

export function paneTabs(input: PaneTabInputs): PaneTabEntry[] {
  const chat = input.kind === 'chat';
  const tasks = chat && Boolean(input.tasks && (input.tasks.orchestrator || input.tasks.total > 0));
  const plan = chat && Boolean(input.planStatus);
  const computer = Boolean(input.computer?.enabled);
  const run = input.run ?? {};
  return paneTabTypes({ tasks, plan, computer }, input.kind).map((type) => {
    const count =
      type === 'changes' ? input.changedFiles : type === 'tasks' ? input.tasks?.running : type === 'output' ? run.files : type === 'hooks' ? run.hooks : type === 'variables' ? run.variables : undefined;
    const attention = (type === 'plan' && input.planStatus === 'awaiting_review') || (type === 'computer' && input.computer?.needsAnswer === true) || (type === 'output' && run.needsYou === true);
    return {
      id: type,
      type,
      label: PANE_TABS[type].label,
      icon: PANE_TABS[type].icon,
      ...(count ? { count } : {}),
      ...(attention ? { attention: true } : {}),
    };
  });
}
