// The pane's tab registry (03 MB-42; MD-23, MD-96; MG-28; packages/shared ui-contract pane.ts): label, glyph and order
// per DockTabType and run pane tab. Chat panes show the pinned four always and Tasks / Computer / Plan only when they apply; `widget`
// and `file` are not used on mobile (MD-96: no Widget tab; files open as a pushed screen). Pure, unit-tested.
import type { MobileIconConcept } from '@generatorai/design-tokens';
import { DOCK_CONDITIONAL_TABS, DOCK_PINNED_TABS, RUN_DOCK_TABS, type DockTabType, type RunPaneTab } from '@generatorai/shared/ui-contract';

/** Chat tabs (D-27) plus the run pane's own Output / Hooks / Variables (MG-28). */
export type MobilePaneTab = Exclude<DockTabType, 'widget' | 'file'> | RunPaneTab;

export const PANE_TABS: Record<MobilePaneTab, { label: string; icon: MobileIconConcept }> = {
  changes: { label: 'Changes', icon: 'changes' },
  files: { label: 'Files', icon: 'files' },
  terminal: { label: 'Terminal', icon: 'terminal' },
  browser: { label: 'Browser', icon: 'browser' },
  tasks: { label: 'Tasks', icon: 'tasks' },
  computer: { label: 'Computer', icon: 'computer' },
  plan: { label: 'Plan', icon: 'plan' },
  output: { label: 'Output', icon: 'file-text' },
  hooks: { label: 'Hooks', icon: 'hook' },
  variables: { label: 'Variables', icon: 'variable' },
};

export interface PaneTabFacts {
  /** An orchestrator chat (or one with background tasks). */
  tasks?: boolean;
  /** Computer use is enabled on the server. */
  computer?: boolean;
  /** A plan exists in this chat. */
  plan?: boolean;
}

/**
 * The tab types a pane shows: a chat pane in the D-27 order (pinned first, then the conditional tabs that apply);
 * a run pane in the MG-28 order (Output, Files, Hooks, Variables, Changes, Terminal, Browser; Computer when on).
 */
export function paneTabTypes(facts: PaneTabFacts, kind: 'chat' | 'run' = 'chat'): MobilePaneTab[] {
  if (kind === 'run') return [...RUN_DOCK_TABS, ...(facts.computer ? (['computer'] as const) : [])];
  const conditional = DOCK_CONDITIONAL_TABS.filter((t) => facts[t] === true);
  return [...DOCK_PINNED_TABS, ...conditional];
}

export function isMobilePaneTab(value: unknown): value is MobilePaneTab {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PANE_TABS, value);
}
