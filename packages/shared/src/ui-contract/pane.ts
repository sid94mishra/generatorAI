// ────────────────────────────────────────────────────────────────
// Dock (side pane) contract (08 M-11; D-27; 04 R-4).
//
// The tab types the chat / run dock can show, which of them are pinned, the
// per-type instance caps, the `?dock=` deep-link values and the persistence
// key scheme. Web renders them in `blocks/dock`; mobile (next pass) draws the
// same set. Types and constants only, dependency-free: never import the
// shared root (the Electron main bundle loads `@generatorai/shared/ui-contract`).
// ────────────────────────────────────────────────────────────────

/**
 * Every dock tab type. `file` is a file-viewer tab (one per opened file);
 * `files` is the single pinned tree.
 */
export const DOCK_TAB_TYPES = [
  'changes',
  'files',
  'terminal',
  'browser',
  'tasks',
  'computer',
  'plan',
  'widget',
  'file',
] as const;
export type DockTabType = (typeof DOCK_TAB_TYPES)[number];

/**
 * Always in the strip, in this order, never closable (D-27). Extra Terminal
 * and Browser instances come from the "+" menu and are closable.
 */
export const DOCK_PINNED_TABS = ['changes', 'files', 'terminal', 'browser'] as const satisfies readonly DockTabType[];

/**
 * Conditional tabs (D-27): Tasks only in orchestrator chats and Computer only
 * where computer use is enabled — both then pinned; Plan only once a plan has
 * been opened (closable). None is ever offered in the "+" menu.
 */
export const DOCK_CONDITIONAL_TABS = ['tasks', 'computer', 'plan'] as const satisfies readonly DockTabType[];

/** Per-type instance caps (D-27: the caps of the pre-redesign code). */
export const DOCK_TAB_CAPS = { browser: 5, terminal: 4, file: 8, widget: 6 } as const satisfies Partial<
  Record<DockTabType, number>
>;

/** `?dock=<tab>` values (04 R-4). */
export const DOCK_LINK_TABS = [
  'changes',
  'files',
  'terminal',
  'browser',
  'tasks',
  'computer',
  'plan',
] as const satisfies readonly DockTabType[];
export type DockLinkTab = (typeof DOCK_LINK_TABS)[number];

/** Parses a `?dock=` value; anything else is ignored (null). */
export function parseDockLinkTab(value: string | null | undefined): DockLinkTab | null {
  return (DOCK_LINK_TABS as readonly string[]).includes(value ?? '') ? (value as DockLinkTab) : null;
}

/** The query parameter name of R-4. */
export const DOCK_LINK_PARAM = 'dock';

/** Which page a dock belongs to: persistence is per page (D-27). */
export type DockScope = 'chat' | 'run';

/**
 * localStorage keys of one page's dock: `generatorai:dock:<scope>:open`
 * ('1' | '0', global to the page), `…:layout` (the split layout, global to the
 * page) and `…:<entityId>` (the tab list, per chat / run).
 */
export function dockStorageKeys(scope: DockScope): {
  open: string;
  layout: string;
  tabs: (entityId: string) => string;
} {
  const base = `generatorai:dock:${scope}`;
  return { open: `${base}:open`, layout: `${base}:layout`, tabs: (entityId) => `${base}:${entityId}` };
}

// ── Run pane (mobile MG-28) ──────────────────────────────────────────────
//
// The run page's pane on mobile: the run's own Output (the focused stage's
// output and files), Hooks and Variables, then the workspace tabs every
// pane shows. Additive; web's run dock keeps its Inspector / Usage panels.

/** Run-only tab types (mobile MG-28). */
export const RUN_PANE_TABS = ['output', 'hooks', 'variables'] as const;
export type RunPaneTab = (typeof RUN_PANE_TABS)[number];

/** The run pane's tabs, in order (MWorkflowRunPane). */
export const RUN_DOCK_TABS = ['output', 'files', 'hooks', 'variables', 'changes', 'terminal', 'browser'] as const satisfies readonly (
  | RunPaneTab
  | DockTabType
)[];
export type RunDockTab = (typeof RUN_DOCK_TABS)[number];

/** Parses a run's `?dock=` value (any run pane tab); anything else is ignored (null). */
export function parseRunDockLinkTab(value: string | null | undefined): RunDockTab | null {
  return (RUN_DOCK_TABS as readonly string[]).includes(value ?? '') ? (value as RunDockTab) : null;
}
