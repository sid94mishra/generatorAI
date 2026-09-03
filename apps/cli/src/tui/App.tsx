// ────────────────────────────────────────────────────────────────
// The workbench shell.
//
// Owns the frame (title bar, tabs, pane tree, composer, status bar), the
// global keymap, and the leader-key mode. Panes own their content; overlays
// replace the whole body when open.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useStdin, useStdout } from 'ink';
import * as nodePath from 'node:path';
import {
  ADMIN_VIEWS,
  adminViewColumns,
  CliError,
  commandPath,
  formatRelative,
  resolveAdminView,
  settingRows,
  shortId,
  validateSettingValue,
  type AdminView,
  type Api,
  type CliContext,
  type CommandRegistry,
  type GraphicsProtocol,
  type Keymap,
  type PaneContent,
  type PaneNode,
  type SettingRow,
  type Tab,
  type TerminalCapabilities,
} from '@generatorai/cli-core';
import { terminalThemeIds } from '@generatorai/design-tokens';
import {
  Composer,
  KeyHints,
  Panel,
  parseDiffLines,
  Screen,
  Split,
  StatusBar,
  Tabs,
  prettyChord,
  useAlternateScreen,
  useBreakpoint,
  useHiddenCursor,
  useKeymap,
  useSelection,
  useTerminalSize,
  useTerminalSuspension,
  useTheme,
  type StatusSegment,
} from '@generatorai/tui-kit';
import { findTranscriptMatch, Pane, terminalActivityLabel, type WorkspaceRow } from './panes.js';
import { OverlayHost, Toasts } from './overlays.js';
import {
  dataKeysFor,
  getStore,
  loadData,
  NO_ROWS,
  paneLeaves,
  selectActiveTab,
  useActions,
  useTui,
  streamStats,
  visibleLeafIds,
  type DataCache,
  type DataKey,
} from './store.js';
import { createCommandRunner, type CommandRunner } from './commandRunner.js';
import { findOpenPane, openEntity, openerFor, workflowPaneContent } from './open.js';
import { buildWorkspaceTree, collapseTargetFor, type TreeRow } from './workspaceTree.js';
import { anchorFor, firstAnchorableLine, moveLineCursor, scrollToShow } from './diffCursor.js';
import { parseComposerInput, queueAttachment } from './composerInput.js';
import { findTerminalMatch, renderTerminalText } from './terminalRender.js';
import {
  encodeInlineImage,
  externalOpenCommand,
  inlineImageLimitation,
  inlineImageSupported,
} from './imageRender.js';
import { attachToTerminal } from '../terminal/attachLoop.js';

export interface AppProps {
  registry: CommandRegistry;
  keymap: Keymap;
  api: Api;
  makeContext: () => Promise<CliContext>;
  refreshMs: number;
  /** Same 3-arg shape as `AuthenticatedClientRuntime.buildSocketUrl` — for the raw terminal takeover only. */
  socketUrl: (path: string, scope: string, id: string | null) => Promise<string>;
  /**
   * What this terminal can do (Phase 8 item 2) — specifically
   * `graphics`, which decides whether a screenshot is drawn inline or handed
   * to the platform viewer. Optional so the e2e mounts, which do not detect a
   * real terminal, keep working; the conservative default is the one that
   * degrades.
   */
  capabilities?: TerminalCapabilities;
}

/**
 * Completions offered after a leading `!`.
 *
 * Mirrors the server-side spawn allowlist, so the composer never suggests a
 * verb the agent would be refused for using.
 */
const SHELL_HINTS = [
  { value: 'git', label: 'git', detail: 'version control' },
  { value: 'node', label: 'node', detail: 'run a script' },
  { value: 'python', label: 'python', detail: 'run a script' },
  { value: 'bash', label: 'bash', detail: 'shell' },
  { value: 'pwsh', label: 'pwsh', detail: 'PowerShell' },
  { value: 'echo', label: 'echo', detail: 'print' },
];

/** OSC introducer and BEL terminator, spelled as codepoints so no formatter can eat them. */
const OSC = String.fromCharCode(0x1b, 0x5d);
const BEL = String.fromCharCode(0x07);

/** What `pane.close` should do for a given pane's content — see `closePaneWithTerminationChoice`. */
export type ClosePaneDecision =
  | { kind: 'closeOnly' }
  | { kind: 'confirmTerminate'; message: string; command: 'terminal.kill' | 'browser.stop'; args: Record<string, string> };

/**
 * Pure decision logic for `pane.close` (Phase 4 item 6), pulled out of the
 * component so it's directly unit-testable without mounting anything —
 * closing a pane used to only ever remove local UI state, silently
 * orphaning a terminal/browser pane's live server-side resource.
 */
export function decideClosePane(content: PaneContent | undefined): ClosePaneDecision {
  const terminalId =
    content?.kind === 'terminal'
      ? String((content?.state as { terminalId?: string } | undefined)?.terminalId ?? '')
      : '';
  if (terminalId) {
    return {
      kind: 'confirmTerminate',
      message: 'Also terminate this terminal session? Closing the pane alone leaves it running.',
      command: 'terminal.kill',
      args: { workspace: content?.entityId ?? '', terminal: terminalId },
    };
  }
  // A browser session is bound to the WORKSPACE, not to this specific pane
  // — there's no local "is it actually live" flag to check the way
  // `terminalId` gates the terminal case above, so any browser pane bound
  // to a workspace is treated as "might have a live session worth asking
  // about," matching how `browser.stop` itself only needs the workspace
  // id, not anything pane-local.
  if (content?.kind === 'browser' && content.entityId) {
    return {
      kind: 'confirmTerminate',
      message: 'Also stop the browser session? Closing the pane alone leaves it running.',
      command: 'browser.stop',
      args: { workspace: content.entityId },
    };
  }
  return { kind: 'closeOnly' };
}

/** Pure cycle order for `run.verbosity` (Phase 6 item 4) — pulled out for the same reason `decideClosePane` was. */
export function nextVerbosity(
  current: 'minimal' | 'normal' | 'verbose',
): 'minimal' | 'normal' | 'verbose' {
  return current === 'minimal' ? 'normal' : current === 'normal' ? 'verbose' : 'minimal';
}

/**
 * Phase 7 item 1 — combines the two real sources a workspace-tree pane
 * needs into one flat, tagged row list: `workspaces.tree()`'s `repos`
 * (git-TRACKED files, already grouped by repo alias) and
 * `workspaces.files()`'s `artifactFiles` (the one route that walks the
 * filesystem directly, so it is the only one that sees generated
 * artifacts — never git-tracked, and therefore invisible to `tree()`).
 * Pulled out so `openWorkspaceTree`'s initial fetch and
 * `editWorkspaceFile`'s post-edit refresh don't duplicate this, and so it's
 * unit-testable without mounting the whole shell.
 */
export function combineWorkspaceRows(
  tree: { repos: Array<{ alias: string; paths: string[] }> } | null,
  files: { artifactFiles: string[] } | null,
): WorkspaceRow[] {
  const fileRows: WorkspaceRow[] = (tree?.repos ?? []).flatMap((repo) =>
    repo.paths.map((relPath) => ({ alias: repo.alias, relPath, kind: 'file' as const })),
  );
  const artifactRows: WorkspaceRow[] = (files?.artifactFiles ?? []).map((relPath) => ({
    alias: 'artifacts',
    relPath,
    kind: 'artifact' as const,
  }));
  return [...fileRows, ...artifactRows];
}

/**
 * Phase 7 item 3 — resolves a workspace row to the real absolute LOCAL path
 * the SERVER itself reads/writes, so `$EDITOR` can open it directly with no
 * upload/download round-trip (see `editWorkspaceFile`'s own doc comment for
 * why). Pulled out of that callback so the path-reconstruction rules —
 * genuinely coupled to `RepoDiscovery.ts`'s repo-discovery scheme, not
 * exposed as a dedicated "resolve this path" endpoint anywhere — are
 * unit-testable on their own.
 */
export function resolveWorkspaceLocalPath(
  row: WorkspaceRow,
  workspace: { rootPath?: string; workingDirectory?: string; worktrees?: Array<{ alias: string; worktreePath: string }> },
): string | null {
  if (row.kind === 'artifact') {
    if (!workspace.rootPath) return null;
    return nodePath.join(workspace.rootPath, 'artifacts', row.relPath);
  }
  if (row.alias === '.') {
    return workspace.workingDirectory ? nodePath.join(workspace.workingDirectory, row.relPath) : null;
  }
  const wt = workspace.worktrees?.find((w) => w.alias === row.alias);
  if (!wt || !workspace.rootPath) return null;
  return nodePath.join(workspace.rootPath, wt.worktreePath, row.relPath);
}

/**
 * The rows the focused pane's cursor moves over — what `useSelection` is
 * sized against, and therefore the bound `list.down`/`list.up` and
 * `diff.nextFile`/`.prevFile` clamp to.
 *
 * Most pane kinds read the shared list cache keyed by `dataKeysFor`. Two do
 * NOT, and getting either one wrong makes rows unreachable rather than
 * merely mis-rendered:
 *
 * - `workspace` (the file-tree pane) has its own fetched `state.rows`;
 *   `dataKeysFor('workspace')` is `'workspaces'`, a completely different and
 *   differently-sized array belonging to the plural LIST pane.
 * - `changes` (the diff pane) has its own `state.files`, and mapped to that
 *   SAME `'workspaces'` cache — so file navigation was sized against how
 *   many workspaces exist rather than how many files the diff has. A shorter
 *   workspace list left later files unreachable; a longer one let the cursor
 *   run past the end of the diff.
 *
 * Pure and exported so both branches are testable without mounting the
 * shell — `useSelection`'s clamping is the only thing standing between a
 * wrong bound here and a cursor that silently cannot reach half a diff.
 */
export function paneListRows(
  content: PaneContent | undefined,
  data: DataCache,
): Array<Record<string, unknown>> {
  if (content?.kind === 'workspace') {
    const state = content.state as
      | { rows?: WorkspaceRow[]; view?: 'tree' | 'flat'; collapsed?: string[]; search?: string }
      | undefined;
    // The cursor is sized against what is DRAWN. In tree mode that is the
    // tree's rows (directories included), which is a different and longer
    // array than the flat file list — sizing against the latter would leave
    // the bottom of a deep tree unreachable, the same class of bug the
    // `changes` pane had.
    if ((state?.view ?? 'tree') === 'tree') {
      return buildWorkspaceTree(state?.rows ?? [], new Set(state?.collapsed ?? [])) as unknown as Array<
        Record<string, unknown>
      >;
    }
    return (state?.rows as unknown as Array<Record<string, unknown>> | undefined) ?? NO_ROWS;
  }
  if (content?.kind === 'changes') {
    return (content.state as { files?: Array<Record<string, unknown>> } | undefined)?.files ?? NO_ROWS;
  }
  // An administration view's rows came from running its command — there is
  // no shared cache for them at all, so without this the cursor is sized
  // against nothing and `command.inspect` can never find a row.
  if (content?.kind === 'command' || content?.kind === 'settings') {
    return (content.state as { rows?: Array<Record<string, unknown>> } | undefined)?.rows ?? NO_ROWS;
  }
  // The computer pane's cursor moves over whichever SECTION is showing —
  // sizing it against one fixed list would leave rows of the other two
  // unreachable, the same failure the `changes` pane had.
  if (content?.kind === 'computer') {
    const state = content.state as
      | {
          section?: 'pending' | 'grants' | 'activity';
          pending?: Array<Record<string, unknown>>;
          grants?: Array<Record<string, unknown>>;
          activity?: Array<Record<string, unknown>>;
        }
      | undefined;
    const section = state?.section ?? 'pending';
    return state?.[section] ?? NO_ROWS;
  }
  const key = content ? (dataKeysFor(content.kind)[0] as DataKey | undefined) : undefined;
  return key ? (data[key] ?? NO_ROWS) : NO_ROWS;
}

/**
 * Rejects if a request outlives `ms`.
 *
 * A hung endpoint is indistinguishable from a key that did nothing, so every
 * fetch that gates an overlay needs a deadline to report against.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Registry commands behind the generic `n` / `d` list bindings.
 *
 * Keyed by pane kind rather than branched inside the handler so that a list
 * with no create or delete command simply has no entry, and the binding says
 * so instead of failing validation on a command that was never going to fit.
 */
const LIST_COMMANDS: Partial<
  Record<PaneContent['kind'], { create?: { id: string; arg: string }; remove?: { id: string; arg: string } }>
> = {
  chats: { create: { id: 'chat.create', arg: 'name' }, remove: { id: 'chat.delete', arg: 'chat' } },
  workflows: {
    create: { id: 'workflow.create', arg: 'name' },
    remove: { id: 'workflow.delete', arg: 'workflow' },
  },
  projects: {
    create: { id: 'project.create', arg: 'name' },
    remove: { id: 'project.delete', arg: 'project' },
  },
  automations: { remove: { id: 'automation.delete', arg: 'automation' } },
  workspaces: { remove: { id: 'workspace.delete', arg: 'workspace' } },
  agents: { remove: { id: 'agent.delete', arg: 'agent' } },
  runs: { remove: { id: 'run.delete', arg: 'run' } },
};

/** Columns a table can be ordered by, in the order `s` cycles them. */
const SORT_KEYS = ['updatedAt', 'createdAt', 'name', 'status'];

/**
 * Every keymap action this shell actually handles (Phase 0 item 2).
 *
 * Declared as data, and the handler map below is TYPED against it — so a
 * handler added without listing it here, or listed here without a handler,
 * is a compile error rather than a key that silently does nothing when
 * pressed. This session has already found three of exactly that:
 * `run.stageDetail` and `run.verbosity` were bound in the keymap with no
 * handler at all, and `chat.editor`'s handler was a stale toast firing over
 * the editor Composer had already opened.
 *
 * It is also what the committed surface snapshot reads to record which
 * bindings have a handler — the audit's Phase 0 exit gate is that no
 * feature is called full on registry presence alone, and a bound key that
 * does nothing is the keymap's version of that claim.
 */
export const HANDLED_ACTIONS = [
  'app.palette',
  'app.help',
  'app.refresh',
  'app.back',
  'app.focusNext',
  'app.focusPrev',
  'app.toggleRightPane',
  'app.search',
  'goto.dashboard',
  'goto.chats',
  'goto.workflows',
  'goto.runs',
  'goto.automations',
  'goto.projects',
  'goto.workspaces',
  'goto.agents',
  'goto.scripts',
  'goto.extensions',
  'goto.settings',
  'goto.admin',
  'command.switch',
  'command.rerun',
  'command.inspect',
  'pane.newTab',
  'pane.nextTab',
  'pane.prevTab',
  'pane.splitVertical',
  'pane.splitHorizontal',
  'pane.focusLeft',
  'pane.focusRight',
  'pane.focusUp',
  'pane.focusDown',
  'pane.growSplit',
  'pane.shrinkSplit',
  'pane.moveTabLeft',
  'pane.moveTabRight',
  'pane.tabNavigator',
  'pane.notifications',
  'pane.diagnostics',
  'pane.lastTab',
  'pane.zoom',
  'pane.close',
  'pane.rename',
  'pane.detach',
  'pane.help',
  'pane.scrollMode',
  'list.down',
  'list.up',
  'list.pageDown',
  'list.pageUp',
  'list.top',
  'list.bottom',
  'list.open',
  'list.new',
  'list.edit',
  'list.delete',
  'list.filter',
  'list.sort',
  'list.select',
  'list.yankId',
  'chat.editor',
  'chat.model',
  'chat.agent',
  'chat.permission',
  'chat.stop',
  'chat.clear',
  'chat.toggleThinking',
  'chat.respond',
  'chat.scrollUp',
  'chat.scrollDown',
  'chat.search',
  'diff.nextFile',
  'diff.prevFile',
  'diff.nextHunk',
  'diff.prevHunk',
  'diff.toggleLayout',
  'diff.nextLine',
  'diff.prevLine',
  'diff.comment',
  'diff.resolve',
  'diff.openTerminal',
  'diff.openBrowser',
  'diff.checkpoints',
  'diff.commit',
  'diff.pullRequest',
  'diff.threads',
  'diff.submitReview',
  'diff.refresh',
  'workflow.nextStage',
  'workflow.prevStage',
  'workflow.addStage',
  'workflow.editStage',
  'workflow.deleteStage',
  'workflow.addEdge',
  'workflow.deleteEdge',
  'workflow.variables',
  'workflow.hooks',
  'workflow.validate',
  'workflow.run',
  'workflow.reload',
  'terminal.new',
  'terminal.attach',
  'terminal.list',
  'terminal.scrollUp',
  'terminal.scrollDown',
  'terminal.follow',
  'terminal.search',
  'terminal.yank',
  'terminal.kill',
  'automation.nextExecution',
  'automation.prevExecution',
  'automation.openRun',
  'automation.cancelExecution',
  'browser.navigate',
  'browser.back',
  'browser.forward',
  'browser.reload',
  'browser.screenshot',
  'browser.inspect',
  'browser.computer',
  'browser.status',
  'browser.stop',
  'workspace.edit',
  'workspace.download',
  'workspace.upload',
  'workspace.refresh',
  'workspace.toggleTree',
  'workspace.collapse',
  'workspace.expand',
  'computer.refresh',
  'computer.nextSection',
  'computer.answer',
  'computer.revoke',
  'computer.runtime',
  'run.pause',
  'run.resume',
  'run.cancel',
  'run.retry',
  'run.approve',
  'run.reject',
  'run.stageDetail',
  'run.verbosity',
  'app.theme',
  'app.quit',
] as const;

export type HandledAction = (typeof HANDLED_ACTIONS)[number];

export function App({
  registry,
  keymap,
  api,
  makeContext,
  refreshMs,
  socketUrl,
  capabilities,
}: AppProps): React.JSX.Element {
  /** `'ascii'` is the honest default when nothing detected a terminal — it degrades rather than claiming. */
  const graphicsProtocol: GraphicsProtocol = capabilities?.graphics ?? 'ascii';
  const theme = useTheme();
  const actions = useActions();
  const { rows, columns } = useTerminalSize();
  const breakpoint = useBreakpoint();

  const workbench = useTui((s) => s.workbench);
  const unseen = useTui((s) => s.unseen);
  /**
   * Phase 6 item 5 — a joined-string primitive, not `s.timelines` itself:
   * `timelines` gets a new object identity on every single streamed token in
   * ANY pane (`reduceEvent` always returns a fresh object), so subscribing
   * to it directly here would re-render the whole app shell per-token. A
   * string primitive compares by VALUE under `useSyncExternalStore`'s
   * `Object.is` check — this selector still reruns on every store update
   * (cheap: one pass over open panes), but only actually triggers a
   * re-render on the rare event that the blocked SET changes, not on every
   * token.
   */
  const blockedPaneIdsKey = useTui((s) => {
    let out = '';
    for (const paneId in s.timelines) {
      const tl = s.timelines[paneId];
      if (tl?.pendingApproval || tl?.pendingInteraction) out += (out ? ',' : '') + paneId;
    }
    return out;
  });
  const blockedPaneIds = useMemo(
    () => new Set(blockedPaneIdsKey ? blockedPaneIdsKey.split(',') : []),
    [blockedPaneIdsKey],
  );
  const overlay = useTui((s) => s.overlay);
  const connection = useTui((s) => s.connection);
  const suspended = useTui((s) => s.suspended);
  const history = useTui((s) => s.history);
  // Toasts occupy real rows above the status bar, so the body must give them
  // back or the fixed-height pane tree runs past the bottom of the screen.
  const toastRows = useTui((s) =>
    s.toasts.length === 0 ? 0 : Math.min(3, s.toasts.length) + (s.toasts.length > 3 ? 1 : 0),
  );

  const tab = selectActiveTab(workbench);
  const focusedPane = useMemo(
    () => paneLeaves(tab.root).find((leaf) => leaf.id === tab.focusedPaneId),
    [tab],
  );
  const content = focusedPane?.content;

  const [leaderArmed, setLeaderArmed] = useState(false);
  const [rightPaneVisible, setRightPaneVisible] = useState(breakpoint === 'wide' || breakpoint === 'standard');

  // Reports exactly which leaves `PaneTree` (below) is about to paint, so
  // the unseen-output indicator (store.ts's `isPaneInActiveTab`) knows when
  // zoom or a narrow breakpoint has collapsed a split down to fewer panes
  // than the tab's tree actually has — without this, a background half of a
  // collapsed split was wrongly treated as "on screen" and never flagged.
  useEffect(() => {
    actions.setVisiblePaneIds(visibleLeafIds(tab, { showRight: rightPaneVisible, breakpoint }));
  }, [actions, tab, rightPaneVisible, breakpoint]);

  useAlternateScreen(!suspended);
  useHiddenCursor(!suspended && content?.kind !== 'chat');

  const runner: CommandRunner = useMemo(
    () => createCommandRunner({ registry, makeContext, actions }),
    [registry, makeContext, actions],
  );

  // ── Data loading ────────────────────────────────────────────────
  const neededKeys = useMemo<DataKey[]>(
    () => [...new Set(paneLeaves(tab.root).flatMap((leaf) => dataKeysFor(leaf.content.kind)))],
    [tab],
  );

  useEffect(() => {
    if (neededKeys.length === 0) return;
    void loadData(getStoreApi(), api, neededKeys);
    if (refreshMs <= 0) return;
    // A slow backstop only. Anything live is driven by the event stream; this
    // catches entities with no SSE coverage and repairs a missed reconnect.
    const timer = setInterval(() => void loadData(getStoreApi(), api, neededKeys), refreshMs);
    return () => clearInterval(timer);
  }, [neededKeys.join(','), api, refreshMs]);

  // ── Selection for the focused list pane ─────────────────────────
  const listRows = useTui((s) => paneListRows(content, s.data));
  const selection = useSelection(listRows.length, 0);

  useEffect(() => {
    if (focusedPane) actions.setSelection(focusedPane.id, selection.index);
  }, [selection.index, focusedPane?.id]);

  const open = useCallback(
    (
      paneContent: PaneContent,
      mode?: 'tab' | 'split-v' | 'split-h' | 'replace',
      targetPaneId?: string,
    ): string => actions.openPane(paneContent, mode, targetPaneId),
    [actions],
  );

  const openSelected = useCallback(() => {
    if (!content) return;
    const row = listRows[selection.index];
    if (!row) return;
    const opener = openerFor(content.kind);
    if (!opener) return;

    // Open question #1 — pressing Enter on a row whose pane is ALREADY open
    // focuses it rather than opening a second copy, wherever that pane is
    // (another tab, the other half of a split). This is what every editor
    // and every resource browser does; the alternative accumulates duplicate
    // tabs of the same chat over a long session.
    //
    // Matched on `(kind, entityId)`, so a workspace's `changes` pane and its
    // `workspace` file-tree pane still coexist — they are different views of
    // the same entity, not duplicates.
    //
    // The decision lives HERE rather than inside `openEntity` because that
    // function takes its dependencies explicitly (`open`, `actions`) and
    // reads no global; reaching for the module-level store inside it would
    // have made it untestable without one, which is exactly what its own
    // race-condition tests rely on not being true.
    const existing = findOpenPane(workbench, opener.kind, String(row['id'] ?? ''));
    if (existing) {
      actions.jumpToPane(existing);
      return;
    }

    void openEntity({ opener, row, api, open, actions });
  }, [content, listRows, selection.index, api, open, actions, workbench]);

  // ── Composer wiring ─────────────────────────────────────────────
  //
  // Declared above the keymap because the keymap's handlers call into it:
  // Ctrl+O and Alt+A are the same pickers the `/model` and `/agent` slash
  // commands open.

  /** Slash commands, so the chat surface is usable without leaving it. */
  const slashCommands = useMemo(
    () => [
      { value: 'model', label: 'model', detail: 'Switch the model for this chat' },
      { value: 'mode', label: 'mode', detail: 'Permission mode' },
      { value: 'agent', label: 'agent', detail: 'Bind an agent to this chat' },
      { value: 'attach', label: 'attach', detail: 'Attach a file to the next message' },
      { value: 'clear', label: 'clear', detail: 'Clear the transcript view' },
      { value: 'stop', label: 'stop', detail: 'Stop the current turn' },
      { value: 'editor', label: 'editor', detail: 'Compose in $EDITOR' },
      { value: 'copy', label: 'copy', detail: 'Copy the last reply' },
      { value: 'thinking', label: 'thinking', detail: 'Show or hide reasoning blocks' },
      { value: 'help', label: 'help', detail: 'Keyboard shortcuts' },
    ],
    [],
  );

  const requestCompletions = useCallback(
    (trigger: '@' | '/' | '!', query: string) => {
      const q = query.toLowerCase();
      if (trigger === '/') {
        return slashCommands.filter((c) => c.value.startsWith(q));
      }
      if (trigger === '!') {
        // Shell mode: the prompt is handed to the agent as a command to run,
        // so the useful completions are the verbs it is allowed to use.
        return SHELL_HINTS.filter((c) => c.value.startsWith(q));
      }
      // `@` addresses agents and codebases, mirroring the web composer.
      const store = getStore().getState();
      const agents = (store.data.agents ?? []).map((row) => ({
        value: String(row['name'] ?? row['id']),
        label: String(row['name'] ?? row['id']),
        detail: 'agent',
      }));
      const projects = (store.data.projects ?? []).map((row) => ({
        value: String(row['name'] ?? row['id']),
        label: String(row['name'] ?? row['id']),
        detail: 'project',
      }));
      return [...agents, ...projects].filter((c) => c.value.toLowerCase().startsWith(q)).slice(0, 8);
    },
    [slashCommands],
  );

  const editPromptExternally = useCallback(
    async (draft: string) => {
      const editor = process.env['VISUAL'] ?? process.env['EDITOR'];
      if (!editor) {
        actions.toast('Set $EDITOR to compose externally.', 'warning');
        return draft;
      }
      const { promises: fs } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const { spawn } = await import('node:child_process');
      const file = join(tmpdir(), `generatorai-prompt-${Date.now()}.md`);
      await fs.writeFile(file, draft, 'utf8');
      await new Promise<void>((resolve) => {
        const child = spawn(editor, [file], { stdio: 'inherit' });
        child.on('close', () => resolve());
        child.on('error', () => resolve());
      });
      const edited = await fs.readFile(file, 'utf8').catch(() => draft);
      await fs.rm(file, { force: true }).catch(() => {});
      return edited.trim();
    },
    [actions],
  );

  const pickModel = useCallback(
    async (chatId: string, preset: string) => {
      // `model` is a flag on `chat update`, not an argument; the runner keeps
      // the two apart and a flag sent as an argument is silently dropped.
      if (preset) {
        await runner.run('chat.update', { chat: chatId }, { model: preset });
        return;
      }
      // The list comes from the server. Without this the composer just empties
      // and nothing happens for as long as the round trip takes, which reads
      // as the command having been ignored.
      actions.toast('Loading models…', 'info');
      const models = await withTimeout(api.copilot.models(), 8000).catch(() => null);
      if (models === null) {
        actions.toast('Could not reach the server for the model list.', 'error');
        return;
      }
      const options = (Array.isArray(models) ? models : []).map((m) => {
        const model = m as unknown as { id?: string; name?: string };
        return { value: String(model.id ?? model.name), label: String(model.name ?? model.id) };
      });
      if (options.length === 0) {
        actions.toast('The server returned no models.', 'warning');
        return;
      }
      actions.showOverlay({
        kind: 'select',
        message: 'Model for this chat',
        options,
        onSelect: (value) => void runner.run('chat.update', { chat: chatId }, { model: value }),
      });
    },
    [api, runner, actions],
  );

  const pickPermissionMode = useCallback(
    async (chatId: string, preset: string) => {
      const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
      // Both `chat` and `mode` are positional arguments here.
      if (preset && modes.includes(preset)) {
        await runner.run('chat.permissionMode', { chat: chatId, mode: preset });
        return;
      }
      actions.showOverlay({
        kind: 'select',
        message: 'Permission mode',
        options: modes.map((m) => ({ value: m, label: m })),
        onSelect: (value) => void runner.run('chat.permissionMode', { chat: chatId, mode: value }),
      });
    },
    [runner, actions],
  );

  const pickAgent = useCallback(
    async (chatId: string, preset: string) => {
      if (preset) {
        await runner.run('chat.update', { chat: chatId }, { agent: preset });
        return;
      }
      const agents = getStore().getState().data.agents;
      if (agents.length === 0) {
        actions.toast('No agents are defined on this server.', 'warning');
        return;
      }
      actions.showOverlay({
        kind: 'select',
        message: 'Agent for this chat',
        options: agents.map((row) => ({
          value: String(row['id']),
          label: String(row['name'] ?? row['id']),
        })),
        onSelect: (value) => void runner.run('chat.update', { chat: chatId }, { agent: value }),
      });
    },
    [runner, actions],
  );

  const { write, stdout } = useStdout();
  const { stdin } = useStdin();
  const suspendTerminal = useTerminalSuspension();

  /**
   * Copies through OSC 52.
   *
   * Shelling out to `clip`/`pbcopy`/`xclip` would need a child process per
   * platform and still fail over SSH, which is exactly where a TUI is used.
   * The escape reaches whichever terminal the user is actually looking at.
   */
  /**
   * OSC 52, so a copy reaches whichever terminal the user is actually
   * looking at — including over SSH, where shelling out to `clip`/`pbcopy`/
   * `xclip` would copy on the wrong machine or not exist at all.
   *
   * One helper rather than the sequence written at each call site: an OSC
   * introducer or terminator dropped by a formatter is invisible in review
   * and silently copies nothing.
   */
  const copyToClipboard = useCallback(
    (text: string, label: string): void => {
      if (!text.trim()) {
        actions.toast('Nothing to copy yet.', 'warning');
        return;
      }
      write(OSC + '52;c;' + Buffer.from(text, 'utf8').toString('base64') + BEL);
      actions.toast(`Copied ${label}.`, 'success');
    },
    [actions, write],
  );

  const copyLastReply = useCallback(() => {
    const items = getStore().getState().timelines[focusedPane?.id ?? '']?.items ?? [];
    const last = [...items].reverse().find((item) => item.kind === 'assistant');
    copyToClipboard(last?.text ?? '', 'the last reply');
  }, [focusedPane?.id, copyToClipboard]);

  // ── Pane-local state helpers ────────────────────────────────────

  /** Merges into `content.state`; `patchPane` replaces the whole object. */
  const patchState = useCallback(
    (patch: Record<string, unknown>) => {
      if (!focusedPane || !content) return;
      actions.patchPane(focusedPane.id, { state: { ...(content.state ?? {}), ...patch } });
    },
    [focusedPane, content, actions],
  );

  /**
   * Routes `/command` input to an action instead of sending it as a prompt.
   *
   * Phase 6 item 2 — `/attach <path>` queues a file for the NEXT message
   * rather than sending immediately: a terminal app has no drag/drop or a
   * native file picker, so typing/pasting a path is the natural equivalent,
   * matching how every other slash command here reads as "set something up
   * for the chat," not "do it right now." Reuses the exact server call
   * `chat.send --attach` already validates and sends through
   * (`ctx.api.chats.sendWithAttachments`, via the SAME `chat.send` command
   * — `flags.attach` — rather than a second, parallel upload path).
   */
  const submitComposer = useCallback(
    async (text: string) => {
      const chatId = content?.entityId ?? '';
      // The DECISION lives in `composerInput.ts` (open question #19) so it
      // can be tested without mounting the workbench; the effects stay here.
      const intent = parseComposerInput(
        text,
        (content?.state as { pendingAttachments?: string[] } | undefined)?.pendingAttachments ?? [],
      );

      if (intent.kind === 'send') {
        await runner.run(
          'chat.send',
          { chat: chatId, prompt: intent.prompt },
          intent.attachments.length ? { attach: intent.attachments } : {},
        );
        if (intent.attachments.length) patchState({ pendingAttachments: undefined });
        return;
      }

      if (intent.kind === 'unknown-slash') {
        actions.toast(`Unknown command "/${intent.command}".`, 'warning');
        return;
      }

      const { command, argument } = intent;

      switch (command) {
        case 'model':
          return pickModel(chatId, argument);
        case 'mode':
          return pickPermissionMode(chatId, argument);
        case 'agent':
          return pickAgent(chatId, argument);
        case 'attach': {
          const filePath = argument;
          if (!filePath) {
            actions.toast('Usage: /attach <path>', 'warning');
            return;
          }
          // Fast feedback on a bad path now — `chat.send --attach`'s own
          // `readAttachments` will validate again for real at send time
          // (it does the actual read), so this is a UX check, not a
          // second copy of that validation logic.
          const { promises: fsCheck } = await import('node:fs');
          try {
            await fsCheck.access(filePath);
          } catch {
            actions.toast(`Cannot read "${filePath}" — check the path.`, 'error');
            return;
          }
          const current =
            (content?.state as { pendingAttachments?: string[] } | undefined)?.pendingAttachments ??
            [];
          patchState({ pendingAttachments: queueAttachment(current, filePath) });
          actions.toast(`Attached ${filePath} — sent with your next message.`, 'success');
          return;
        }
        case 'clear':
          if (focusedPane) actions.resetTimeline(focusedPane.id);
          return;
        case 'stop':
          await runner.run('chat.cancel', { chat: chatId });
          return;
        case 'copy':
          return copyLastReply();
        case 'thinking':
          actions.toggleThinking();
          return;
        case 'editor':
          actions.toast(
            `Press ${prettyChord(keymap.chordFor('chat.editor'))} to compose in $EDITOR.`,
            'info',
          );
          return;
        case 'help':
          actions.showOverlay({ kind: 'help' });
          return;
      }
    },
    [
      content?.entityId,
      content?.state,
      runner,
      actions,
      focusedPane,
      keymap,
      pickModel,
      pickPermissionMode,
      pickAgent,
      copyLastReply,
      patchState,
    ],
  );

  const scrollBack = Math.max(
    0,
    Number((content?.state as { scrollBack?: number } | undefined)?.scrollBack ?? 0),
  );

  /**
   * The terminal pane's scrollback offset (open question #10).
   *
   * The same `state.scrollBack` field a chat pane uses — deliberately, since
   * both mean "rows above the live tail" — read through its own accessor so
   * the terminal handlers are not silently reading a chat pane's value when
   * the focus is elsewhere.
   */
  const terminalScrollBack = (): number =>
    content?.kind === 'terminal'
      ? Math.max(0, Number((content.state as { scrollBack?: number } | undefined)?.scrollBack ?? 0))
      : 0;

  const diffLineIndexes = useCallback(() => {
    const patch = String((content?.state as { patch?: string } | undefined)?.patch ?? '');
    const out: number[] = [];
    patch.split('\n').forEach((line, index) => {
      if (line.startsWith('@@')) out.push(index);
    });
    return out;
  }, [content?.state]);

  /**
   * Moves the diff's line cursor and scrolls only as far as it must (open
   * question #21).
   *
   * The viewport figure mirrors `ChangesPane`'s own budget (`height -
   * listHeight - 5`); it is approximate on purpose — `scrollToShow` only
   * uses it to decide whether the cursor has left the window, and being a
   * row out means one extra scroll at the very edge, not a wrong position.
   */
  const moveDiffCursor = useCallback(
    (delta: 1 | -1) => {
      const state = (content?.state ?? {}) as {
        patch?: string;
        lineCursor?: number;
        scrollTop?: number;
      };
      const lines = parseDiffLines(String(state.patch ?? ''));
      if (lines.length === 0) return;
      const from = state.lineCursor ?? firstAnchorableLine(lines);
      const next = moveLineCursor(lines, from, delta);
      patchState({
        lineCursor: next,
        scrollTop: scrollToShow(next, state.scrollTop ?? 0, Math.max(1, rows - 14)),
      });
    },
    [content?.state, patchState, rows],
  );

  const seekHunk = useCallback(
    (direction: 1 | -1) => {
      const hunks = diffLineIndexes();
      if (hunks.length === 0) return;
      const at = Number((content?.state as { scrollTop?: number } | undefined)?.scrollTop ?? 0);
      const next =
        direction === 1
          ? (hunks.find((line) => line > at) ?? hunks[0]!)
          : ([...hunks].reverse().find((line) => line < at) ?? hunks.at(-1)!);
      patchState({ scrollTop: next });
    },
    [diffLineIndexes, content?.state, patchState],
  );

  /** Loads the selected file's patch into the pane. */
  const showDiffFor = useCallback(
    async (index: number) => {
      const state = (content?.state ?? {}) as { files?: Array<{ path?: string }> };
      const file = state.files?.[index];
      if (!file?.path || !content?.entityId) return;
      const response = await api.workspaces
        .filePatch(content.entityId, { path: file.path })
        .catch(() => null);
      const patch = String((response as { patch?: string } | null)?.patch ?? '');
      // The line cursor starts on the first row that can actually be
      // commented on — a cursor parked on a `@@` header would refuse the
      // very next keypress, which reads as the key being broken.
      patchState({
        patch,
        scrollTop: 0,
        lineCursor: firstAnchorableLine(parseDiffLines(patch)),
      });
    },
    [content?.state, content?.entityId, api, patchState],
  );

  const resolveThread = useCallback(async () => {
    if (!content?.entityId) return;
    const threads = await runner.run('review.list', { workspace: content.entityId });
    const open = (Array.isArray(threads) ? threads : []).filter(
      (t) => (t as { status?: string }).status !== 'resolved',
    );
    if (open.length === 0) {
      actions.toast('No open threads.', 'info');
      return;
    }
    actions.showOverlay({
      kind: 'select',
      message: 'Resolve which thread?',
      options: open.map((t) => {
        const thread = t as { id?: string; path?: string; body?: string };
        return {
          value: String(thread.id),
          label: String(thread.path ?? thread.id),
          ...(thread.body ? { detail: thread.body.slice(0, 40) } : {}),
        };
      }),
      onSelect: (value) =>
        void runner.run('review.resolve', { workspace: content.entityId ?? '', thread: value }),
    });
  }, [content?.entityId, runner, actions]);

  const openTerminalPane = useCallback(() => {
    if (!content?.entityId) return;
    open(
      {
        kind: 'terminal',
        entityId: content.entityId,
        title: `terminal ${content.entityId.slice(0, 8)}`,
      },
      'split-h',
    );
  }, [content?.entityId, open]);

  const openBrowserPane = useCallback(() => {
    if (!content?.entityId) return;
    open(
      {
        kind: 'browser',
        entityId: content.entityId,
        title: `browser ${content.entityId.slice(0, 8)}`,
      },
      'split-h',
    );
  }, [content?.entityId, open]);

  /**
   * Phase 7 item 1 — opens the workspace tree/artifacts/worktree browser
   * from a `workspaces` LIST row (`list.edit`, repurposed below — its
   * previous behavior was a byte-for-byte duplicate of `list.open`/Enter,
   * which already opens the correctly-fixed `changes` pane; this gives it a
   * real, distinct purpose instead of removing an inert duplicate).
   *
   * Built as an ad-hoc `Opener` passed straight to `openEntity` rather than
   * registered in `open.ts`'s `OPENERS` — that registry is one opener per
   * LIST-pane kind, and `workspaces` already has one (the `changes` pane).
   * `openEntity` doesn't require its opener to be pre-registered; this reuses
   * its exact placeholder-then-resolve, race-safe pane handling instead of
   * re-deriving it.
   *
   * Combines two real, separately-verified sources rather than one nested
   * tree fetch: `workspaces.tree()` (git-TRACKED files, already grouped by
   * repo alias — main + every worktree) and `workspaces.files()`'s
   * `artifactFiles` (the one route that walks the filesystem directly, so
   * it is the only one that sees generated artifacts, which are never
   * git-tracked and so invisible to `tree()`).
   */
  const openWorkspaceTree = useCallback(() => {
    if (!content) return;
    const row = listRows[selection.index];
    if (!row?.['id']) return;
    void openEntity({
      opener: {
        kind: 'workspace',
        async build(entityRow, entityApi) {
          const id = String(entityRow['id']);
          const [workspace, worktrees, tree, files] = await Promise.all([
            entityApi.workspaces.get(id),
            entityApi.workspaces.worktrees(id).catch(() => []),
            entityApi.workspaces.tree(id).catch(() => null),
            entityApi.workspaces.files(id).catch(() => null),
          ]);
          return {
            kind: 'workspace',
            entityId: id,
            title: `workspace ${shortId(id)}`,
            state: {
              rootPath: workspace.rootPath,
              workingDirectory: workspace.workingDirectory,
              worktrees,
              rows: combineWorkspaceRows(tree, files),
            },
          };
        },
      },
      row,
      api,
      open,
      actions,
    });
  }, [content, listRows, selection.index, api, open, actions]);

  /**
   * The workspace pane's rows in whichever view is showing (open question
   * #26) — the tree's rows when it is a tree, the flat list otherwise.
   *
   * `paneListRows` deliberately returns `state.rows` (the flat list) for
   * this pane kind: the CURSOR is sized against what is drawn, and in tree
   * mode that is a different, longer array. Actions therefore resolve their
   * target through this, not through `listRows`.
   */
  const workspaceViewRows = useCallback((): { tree: TreeRow[]; row: WorkspaceRow | undefined } => {
    if (content?.kind !== 'workspace') return { tree: [], row: undefined };
    const state = (content.state ?? {}) as {
      rows?: WorkspaceRow[];
      view?: 'tree' | 'flat';
      collapsed?: string[];
    };
    if ((state.view ?? 'tree') !== 'tree' || getStore().getState().search[focusedPane?.id ?? ''] ) {
      return { tree: [], row: listRows[selection.index] as unknown as WorkspaceRow | undefined };
    }
    const tree = buildWorkspaceTree(state.rows ?? [], new Set(state.collapsed ?? []));
    return { tree, row: tree[selection.index]?.row };
  }, [content, focusedPane?.id, listRows, selection.index]);

  /**
   * $EDITOR handoff for a real workspace file (Phase 7 item 3) — distinct
   * from `editPromptExternally` above, which round-trips a chat DRAFT
   * through a throwaway temp file because a draft is not a real file to
   * begin with. This one has a real file already on disk; there is nothing
   * to upload back, because nothing ever left disk.
   *
   * When the path cannot be resolved locally (a repo kind
   * `resolveWorkspaceLocalPath` declines, or the CLI/server genuinely do
   * not share a filesystem), this fails honestly with a toast rather than
   * silently no-op-ing. A workspace file-write route DOES now exist (open
   * question #24) and backs `workspace.upload`; this path stays direct-to-disk
   * because editing a file the server can already see needs no round trip.
   */
  const editWorkspaceFile = useCallback(() => {
    if (content?.kind !== 'workspace' || !focusedPane) return;
    const row = workspaceViewRows().row;
    if (!row) return;
    const workspaceState = (content.state ?? {}) as {
      rootPath?: string;
      workingDirectory?: string;
      worktrees?: Array<{ alias: string; worktreePath: string }>;
    };
    const absolutePath = resolveWorkspaceLocalPath(row, workspaceState);
    if (!absolutePath) {
      actions.toast(
        'Cannot resolve a local path for this entry — the CLI and server may not share a filesystem.',
        'warning',
      );
      return;
    }
    const editor = process.env['VISUAL'] ?? process.env['EDITOR'];
    if (!editor) {
      actions.toast('Set $EDITOR to edit workspace files.', 'warning');
      return;
    }
    const paneId = focusedPane.id;
    const entityId = content.entityId ?? '';
    const priorState = content.state ?? {};
    actions.setSuspended(true);
    void suspendTerminal(async () => {
      try {
        const { promises: fsCheck } = await import('node:fs');
        try {
          await fsCheck.access(absolutePath);
        } catch {
          actions.toast(`Cannot read "${absolutePath}" — not reachable on this machine.`, 'error');
          return;
        }
        const { spawn } = await import('node:child_process');
        await new Promise<void>((resolve) => {
          const child = spawn(editor, [absolutePath], { stdio: 'inherit' });
          child.on('close', () => resolve());
          child.on('error', () => resolve());
        });
        // Refresh: re-fetch the tree so a rename/delete/add is reflected;
        // the file's own row otherwise never changes shape (no size/mtime
        // is tracked here to diff against).
        const [tree, files] = await Promise.all([
          api.workspaces.tree(entityId).catch(() => null),
          api.workspaces.files(entityId).catch(() => null),
        ]);
        actions.patchPane(paneId, { state: { ...priorState, rows: combineWorkspaceRows(tree, files) } });
        actions.toast('Saved.', 'success');
      } finally {
        actions.setSuspended(false);
      }
    });
  }, [content, focusedPane, workspaceViewRows, actions, suspendTerminal, api]);

  /**
   * Download (Phase 7 item 1) — reuses whichever content-fetch route
   * already correctly serves this row's kind: `treeFile` for a tracked
   * file (aliased to its real repo), `fileContent` with `source: 'artifacts'`
   * for an artifact (never git-tracked, so `treeFile`'s `git`-backed read
   * would 404 it) — the same two, real, wire-verified routes `workspace get
   * --out`/the artifacts browser above already rely on, not a third path.
   */
  const downloadWorkspaceRow = useCallback(() => {
    if (content?.kind !== 'workspace') return;
    const row = workspaceViewRows().row;
    if (!row || !content.entityId) return;
    const entityId = content.entityId;
    const basename = row.relPath.split('/').pop() ?? row.relPath;
    actions.showOverlay({
      kind: 'input',
      message: `Save "${row.relPath}" to…`,
      initial: basename,
      onSubmit: (destination) => {
        if (!destination.trim()) return;
        void (async () => {
          try {
            const text =
              row.kind === 'artifact'
                ? (await api.workspaces.fileContent(entityId, row.relPath, { source: 'artifacts' })).content
                : (await api.workspaces.treeFile(entityId, { path: row.relPath, alias: row.alias })).contents;
            if (text === null || text === undefined) {
              actions.toast(`"${row.relPath}" is binary or too large to download this way.`, 'warning');
              return;
            }
            const { promises: fsWrite } = await import('node:fs');
            const out = nodePath.resolve(destination.trim());
            await fsWrite.mkdir(nodePath.dirname(out), { recursive: true });
            await fsWrite.writeFile(out, text, 'utf8');
            actions.toast(`Wrote ${out}`, 'success');
          } catch (err) {
            actions.toast(err instanceof Error ? err.message : String(err), 'error');
          }
        })();
      },
    });
  }, [content, workspaceViewRows, api, actions]);


  /** Re-reads the two sources a workspace pane combines, by pane id. */
  const refreshWorkspacePaneById = useCallback(
    async (paneId: string, workspaceId: string) => {
      const [tree, files] = await Promise.all([
        api.workspaces.tree(workspaceId).catch(() => null),
        api.workspaces.files(workspaceId).catch(() => null),
      ]);
      const pane = getStoreApi()
        .getState()
        .workbench.tabs.flatMap((tab) => paneLeaves(tab.root))
        .find((leaf) => leaf.id === paneId);
      actions.patchPane(paneId, {
        state: { ...(pane?.content.state ?? {}), rows: combineWorkspaceRows(tree, files) },
      });
    },
    [api, actions],
  );

  const uploadWorkspaceFile = useCallback(() => {
    if (content?.kind !== 'workspace' || !content.entityId || !focusedPane) return;
    const workspaceId = content.entityId;
    const paneId = focusedPane.id;
    // Open question #24 — there was no write route at all, so this action
    // could not exist. `PUT /workspaces/:id/files/content` now backs it.
    actions.showOverlay({
      kind: 'input',
      message: 'Local file to upload',
      initial: '',
      onSubmit: (localPath) => {
        if (!localPath.trim()) return;
        actions.showOverlay({
          kind: 'input',
          message: 'Destination path inside the workspace',
          initial: nodePath.basename(localPath.trim()),
          onSubmit: (destination) => {
            if (!destination.trim()) return;
            void (async () => {
              const result = await runner.run(
                'workspace.put',
                { workspace: workspaceId, path: destination.trim() },
                { file: localPath.trim(), source: 'workspace' },
              );
              if (result !== undefined) await refreshWorkspacePaneById(paneId, workspaceId);
            })();
          },
        });
      },
    });
  }, [content, focusedPane, actions, runner, refreshWorkspacePaneById]);


  const refreshWorkspacePane = useCallback(async () => {
    if (content?.kind !== 'workspace' || !content.entityId || !focusedPane) return;
    await refreshWorkspacePaneById(focusedPane.id, content.entityId);
  }, [content, focusedPane, refreshWorkspacePaneById]);

  /** `←`/`→` on the tree — folds the directory the cursor is in, or on. */
  const foldWorkspaceDirectory = useCallback(
    (collapse: boolean) => {
      if (content?.kind !== 'workspace') return;
      const { tree } = workspaceViewRows();
      if (tree.length === 0) return;
      const target = collapseTargetFor(tree, selection.index);
      if (!target) return;
      const state = (content.state ?? {}) as { collapsed?: string[] };
      const current = new Set(state.collapsed ?? []);
      // Expanding the row the cursor is ON when it is a closed directory is
      // the useful reading of `→`; on an open one it does nothing, which is
      // what every file browser does too.
      if (collapse) current.add(target);
      else current.delete(tree[selection.index]?.id ?? target);
      patchState({ collapsed: [...current] });
    },
    [content, workspaceViewRows, selection.index, patchState],
  );

  /**
   * `pane.close` (Phase 4 item 6) — closing a pane only ever removed LOCAL
   * UI state; for a terminal or browser pane that silently orphaned the
   * live PTY/browser session server-side, since neither `terminal.kill` nor
   * `browser.stop` ever got called. Mirrors this app's own existing
   * confirm-before-a-real-server-effect convention (`run.cancel`) instead
   * of a passive toast: the user gets an actual choice at the moment it
   * matters, not just a "by the way" after the fact. "No"/Escape still
   * closes the pane — the question is only whether to ALSO terminate the
   * resource, not whether to close at all (matching `Confirm`'s own
   * "n / Esc cancel" wording as "cancel the optional part", the same
   * reading `run.cancel`'s confirm already relies on).
   */
  const closePaneWithTerminationChoice = useCallback((): void => {
    const decision = decideClosePane(content);
    if (decision.kind === 'closeOnly') return actions.closeActivePane();
    actions.showOverlay({
      kind: 'confirm',
      message: decision.message,
      danger: true,
      onAnswer: (yes) => {
        if (!yes) return actions.closeActivePane();
        void runner.run(decision.command, decision.args).finally(() => actions.closeActivePane());
      },
    });
  }, [content, actions, runner]);

  /** Pulls the PTY buffer into the pane — the passive view `terminal.attach` falls back to once it ends. */
  const refreshTerminal = useCallback(
    async (terminalId: string) => {
      if (!content?.entityId) return;
      const workspaceId = content.entityId;
      // Idle-state (Phase 5 item 6) rides along on the same refresh rather
      // than its own poll loop — this only runs on an explicit user action
      // (attach, create, switch), never on a timer, so a second request
      // here is proportionate, not a new background cost.
      const [buffer, descriptor] = await Promise.all([
        api.terminals.scrollback(workspaceId, terminalId).catch(() => null),
        api.terminals.get(workspaceId, terminalId).catch(() => null),
      ]);
      patchState({
        terminalId,
        scrollback: String((buffer as { data?: unknown } | null)?.data ?? buffer ?? ''),
        exitCode: descriptor?.exitCode ?? null,
        ...(descriptor?.lastActivityAt !== undefined
          ? { lastActivityAt: descriptor.lastActivityAt }
          : {}),
      });
    },
    [content?.entityId, api, patchState],
  );

  /**
   * Session chooser (Phase 5 item 6) — `terminal.list`'s REST endpoint and
   * wire types were already real; no client anywhere (web, mobile, or
   * here) had ever put a picker UI in front of them. Selecting a terminal
   * switches the pane's PASSIVE view (same as `terminal.new`'s own
   * behavior) rather than immediately taking over the keyboard — jumping
   * straight into a raw takeover from a list pick would be a surprising
   * side effect for what reads as a "look at this one" action; the user
   * can still press the attach key afterward.
   */
  const pickTerminal = useCallback(async () => {
    if (!content?.entityId) {
      actions.toast('Open a terminal pane first.', 'warning');
      return;
    }
    const workspaceId = content.entityId;
    actions.toast('Loading terminals…', 'info');
    const terminals = await withTimeout(api.terminals.list(workspaceId), 8000).catch(() => null);
    if (terminals === null) {
      actions.toast('Could not reach the server for the terminal list.', 'error');
      return;
    }
    if (terminals.length === 0) {
      actions.toast('No terminals in this workspace yet — press n to start one.', 'warning');
      return;
    }
    actions.showOverlay({
      kind: 'select',
      message: 'Switch to which terminal?',
      options: terminals.map((t) => ({
        value: t.id,
        label: `#${t.id.slice(0, 8)} · ${t.shell} · ${terminalActivityLabel(t)}`,
      })),
      onSelect: (value) => void refreshTerminal(value),
    });
  }, [content?.entityId, actions, api, refreshTerminal]);

  /**
   * Raw takeover for the terminal pane (Phase 5 item 1/2).
   *
   * Ink owns the keyboard, so this cannot just proxy stdin/stdout the way
   * the binary `terminal.attach` command does (`terminal/attachLoop.ts`,
   * shared with this function) — it first has to get Ink OUT of the way.
   * `useTerminalSuspension` hands back the real terminal (alt-screen off,
   * raw mode off, cursor visible); `actions.setSuspended(true)` is the
   * companion half of that handoff, standing down this component's own
   * `useKeymap` registrations (both are gated on `!suspended` already) so
   * they do not also react to the very bytes this function is about to
   * forward to the PTY.
   */
  const attachRawTerminal = useCallback(
    (terminalId: string | undefined) => {
      if (!content?.entityId) {
        actions.toast('Open a terminal pane first.', 'warning');
        return;
      }
      const workspaceId = content.entityId;
      actions.setSuspended(true);
      void suspendTerminal(async () => {
        try {
          const outcome = await attachToTerminal({
            workspaceId,
            ...(terminalId ? { terminalId } : {}),
            api: api.terminals,
            socketUrl,
            stdin,
            stdout,
          });
          if (outcome.reason === 'error') {
            actions.toast(outcome.message ?? 'Terminal connection error.', 'error');
          } else if (outcome.reason === 'exited') {
            const code = outcome.exitCode;
            actions.toast(
              `Terminal exited${code !== null && code !== undefined ? ` (code ${code})` : ''}.`,
              'info',
            );
          } else {
            actions.toast('Detached — the session keeps running.', 'info');
          }
          // Falls back to the passive scrollback view either way — including
          // picking up the id of a terminal this call itself just created.
          await refreshTerminal(outcome.terminalId);
        } catch (err) {
          actions.toast(err instanceof Error ? err.message : String(err), 'error');
        } finally {
          actions.setSuspended(false);
        }
      });
    },
    [content?.entityId, actions, suspendTerminal, api.terminals, socketUrl, stdin, stdout, refreshTerminal],
  );

  /**
   * Automation execution fan-out and nested run navigation (Phase 6 item 6).
   *
   * The execution list lives in `content.state.executions` (fetched once by
   * `open.ts`'s `build()`) with a local `selectedExecutionIndex` for
   * ctrl+n/p navigation — there is no per-pane list-selection primitive in
   * this file that fits a detail pane's own internal list (the generic
   * `selection`/`listRows` a few lines up is for the FOCUSED-pane preload
   * cache keyed by `dataKeysFor`, a different concern), so this follows the
   * same plain-`patchState`-field pattern already used for `diff.toggleLayout`/
   * `list.sort` elsewhere in this file.
   */
  const moveExecutionSelection = useCallback(
    (delta: 1 | -1) => {
      const st = content?.state as
        | { executions?: Array<Record<string, unknown>>; selectedExecutionIndex?: number }
        | undefined;
      const count = st?.executions?.length ?? 0;
      if (count === 0) return;
      const current = st?.selectedExecutionIndex ?? 0;
      patchState({ selectedExecutionIndex: (current + delta + count) % count });
    },
    [content?.state, patchState],
  );

  const selectedExecution = useCallback((): Record<string, unknown> | undefined => {
    const st = content?.state as
      | { executions?: Array<Record<string, unknown>>; selectedExecutionIndex?: number }
      | undefined;
    return st?.executions?.[st?.selectedExecutionIndex ?? 0];
  }, [content?.state]);

  const refreshAutomationExecutions = useCallback(async () => {
    if (!content?.entityId) return;
    const executions = await api.automations.executions(content.entityId).catch(() => null);
    if (executions === null) return;
    const list = (Array.isArray(executions) ? executions : []) as unknown as Array<Record<string, unknown>>;
    patchState({
      executions: list,
      selectedExecutionIndex: Math.min(
        (content.state as { selectedExecutionIndex?: number } | undefined)?.selectedExecutionIndex ?? 0,
        Math.max(0, list.length - 1),
      ),
    });
  }, [content?.entityId, content?.state, api, patchState]);

  /**
   * The one place `automation_execution.iteration_completed`'s `workflowRunId`
   * would have been useful, if the server ever actually sent that event —
   * grepped every real emitter in `AutomationService.ts`, it never does
   * (`AgentEvent.ts` declares it, nothing produces it). `automation.execution.show`
   * (real, tested command) is the only reliable source for which workflow
   * run(s) an execution actually spawned.
   */
  const openAutomationExecutionRun = useCallback(async () => {
    const execution = selectedExecution();
    if (!execution || !content?.entityId) {
      actions.toast('No execution selected.', 'warning');
      return;
    }
    // `runner.run` never rejects — a thrown `CliError` is already caught and
    // surfaced as an error overlay inside `commandRunner.ts`'s `execute()`,
    // resolving to `undefined` here instead. Nothing further to catch.
    const detail = await runner.run('automation.execution.show', {
      automation: content.entityId,
      execution: String(execution['id']),
    });
    // `undefined` means the command already failed and told the user why
    // (an error overlay, from `commandRunner.ts`) — nothing more to say.
    if (detail === undefined) return;
    const runs = (detail as { runs?: Array<Record<string, unknown>> }).runs ?? [];
    if (runs.length === 0) {
      actions.toast('This execution has not started a workflow run yet.', 'warning');
      return;
    }
    const openRun = (run: Record<string, unknown>): void => {
      const workflowRunId = String(run['workflowRunId'] ?? '');
      if (!workflowRunId) return;
      open(
        {
          kind: 'run',
          entityId: workflowRunId,
          title: `run ${shortId(workflowRunId)}`,
          attachment: { scope: 'run', id: workflowRunId },
          state: { status: run['status'] },
        },
        'tab',
      );
    };
    if (runs.length === 1) {
      openRun(runs[0]!);
      return;
    }
    actions.showOverlay({
      kind: 'select',
      message: 'Which run?',
      options: runs.map((run, index) => ({
        value: String(index),
        label: `#${run['iterationIndex'] ?? index} · ${String(run['status'] ?? '')} · ${
          run['iterationLabel'] ? String(run['iterationLabel']) : shortId(String(run['workflowRunId'] ?? ''))
        }`,
      })),
      onSelect: (value) => {
        const run = runs[Number(value)];
        if (run) openRun(run);
      },
    });
  }, [selectedExecution, content?.entityId, runner, actions, open]);

  const cancelSelectedExecution = useCallback(async () => {
    const execution = selectedExecution();
    if (!execution || !content?.entityId) {
      actions.toast('No execution selected.', 'warning');
      return;
    }
    // `automation.execution.cancel` is `destructive: true` — the runner's
    // own confirm gate (`commandRunner.ts`) already asks before this
    // resolves; no second confirm needed here.
    const result = await runner.run('automation.execution.cancel', {
      automation: content.entityId,
      execution: String(execution['id']),
    });
    if (result === undefined) return; // Declined the confirm, or errored (already toasted).
    await refreshAutomationExecutions();
  }, [selectedExecution, content?.entityId, runner, actions, refreshAutomationExecutions]);

  // ── Changes / SCM workbench (Phase 7 item 2) ────────────────────
  //
  // Every command below was already real, tested, and reachable from the
  // binary — and bound to nothing here. A user could read a diff in the TUI
  // but had to leave it to take a checkpoint, restore one, commit, open a
  // PR, or answer a review thread.

  /** Re-fetches the changed-file list — after a restore/commit, and on a live `workspace.changed`. */
  /** Re-fetches one changes pane's file list, by pane id rather than "the focused one". */
  const refreshChangesPane = useCallback(
    async (paneId: string) => {
      // Across every tab: a background changes pane is exactly the case this
      // exists for, and it is by definition not in the active one.
      const pane = getStoreApi()
        .getState()
        .workbench.tabs.flatMap((tab) => paneLeaves(tab.root))
        .find((leaf) => leaf.id === paneId);
      const target = pane?.content;
      if (target?.kind !== 'changes' || !target.entityId) return;
      const changes = await api.workspaces.changes(target.entityId).catch(() => null);
      if (!changes) return;
      const files = changes.repos.flatMap((repo) =>
        repo.files.map((file) => ({ alias: repo.alias, ...file })),
      );
      actions.patchPane(paneId, { state: { ...(target.state ?? {}), files } });
    },
    [api, actions],
  );

  const refreshChanges = useCallback(async () => {
    if (content?.kind !== 'changes' || !focusedPane) return;
    await refreshChangesPane(focusedPane.id);
  }, [content?.kind, focusedPane, refreshChangesPane]);

  /**
   * Live refresh, driven by the `'workspace'` stream scope — for EVERY open
   * changes pane, not only the focused one (open question #39).
   *
   * Subscribes to a joined string of "paneId:revision" for the changes panes
   * rather than to `timelines` itself: that object gets a new identity on
   * every streamed token in any pane, so watching it directly would refetch
   * a file list on every character of an unrelated chat. A string primitive
   * compares by VALUE under `useSyncExternalStore`, so this selector reruns
   * cheaply on every store update but only re-renders when a workspace
   * revision actually moves — the same technique `blockedPaneIdsKey` uses.
   */
  const changesRevisionKey = useTui((s) => {
    let out = '';
    for (const tab of s.workbench.tabs) {
      for (const leaf of paneLeaves(tab.root)) {
        if (leaf.content.kind !== 'changes') continue;
        const revision = s.timelines[leaf.id]?.workspaceRevision ?? 0;
        if (revision > 0) out += `${out ? ',' : ''}${leaf.id}:${revision}`;
      }
    }
    return out;
  });
  // Last revision each pane was refetched at, so one pane's event does not
  // refetch every other changes pane's file list as well.
  const refetchedAt = React.useRef<Record<string, string>>({});
  useEffect(() => {
    if (!changesRevisionKey) return;
    for (const entry of changesRevisionKey.split(',')) {
      const [paneId, revision] = entry.split(':');
      if (!paneId || !revision) continue;
      if (refetchedAt.current[paneId] === revision) continue;
      refetchedAt.current[paneId] = revision;
      void refreshChangesPane(paneId);
    }
  }, [changesRevisionKey, refreshChangesPane]);

  const showCheckpoints = useCallback(async () => {
    if (!content?.entityId) return;
    const rows = await runner.run('workspace.checkpoints', { workspace: content.entityId });
    const checkpoints = (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>;
    if (checkpoints.length === 0) {
      actions.toast('No checkpoints in this workspace yet.', 'info');
      return;
    }
    const workspaceId = content.entityId;
    actions.showOverlay({
      kind: 'select',
      message: 'Restore which checkpoint?',
      options: checkpoints.map((cp) => ({
        value: String(cp['id']),
        label: `${String(cp['label'] ?? cp['kind'] ?? shortId(String(cp['id'])))}`,
        detail: cp['createdAt'] ? formatRelative(cp['createdAt'] as string) : '',
      })),
      // `workspace.restore` is `destructive: true`, so the runner's own
      // confirm gate asks before anything is overwritten — no second
      // confirm here, matching `cancelSelectedExecution` above.
      onSelect: (value) =>
        void runner
          .run('workspace.restore', { workspace: workspaceId, checkpoint: value })
          .then((result) => {
            if (result !== undefined) void refreshChanges();
          }),
    });
  }, [content?.entityId, runner, actions, refreshChanges]);

  const showThreads = useCallback(async () => {
    if (!content?.entityId) return;
    const workspaceId = content.entityId;
    const rows = await runner.run('review.list', { workspace: workspaceId });
    const threads = (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>;
    if (threads.length === 0) {
      actions.toast('No review threads in this workspace.', 'info');
      return;
    }
    actions.showOverlay({
      kind: 'select',
      message: 'Reply on which thread?',
      options: threads.map((thread) => ({
        value: String(thread['id']),
        label: `${String(thread['path'] ?? thread['id'])}:${String(thread['line'] ?? '?')} · ${String(thread['status'] ?? '')}`,
        ...(thread['body'] ? { detail: String(thread['body']).slice(0, 60) } : {}),
      })),
      onSelect: (threadId) =>
        actions.showOverlay({
          kind: 'input',
          message: 'Reply',
          initial: '',
          onSubmit: (body) => {
            if (body.trim()) {
              void runner.run('review.reply', { workspace: workspaceId, thread: threadId, body: body.trim() });
            }
          },
        }),
    });
  }, [content?.entityId, runner, actions]);

  // ── Workflow authoring (Phase 7 items 4/5/6) ────────────────────
  //
  // The workflow pane painted a DAG and did nothing else — no cursor, so
  // none of the real `workflow stage`/`workflow edge` commands had any
  // terminal surface at all. Each action below runs the same registry
  // command the binary does, collected through the spec's own
  // schema-driven form rather than a bespoke dialog per command.

  const workflowState = (content?.kind === 'workflow' ? (content.state ?? {}) : {}) as {
    stages?: Array<{ id: string; name: string }>;
    edges?: Array<{ id?: string; fromStageId: string; toStageId: string; edgeType?: string }>;
    variables?: Record<string, unknown>;
    selectedStageId?: string | null;
  };

  const selectedStage = useCallback(() => {
    const stages = workflowState.stages ?? [];
    return stages.find((stage) => stage.id === workflowState.selectedStageId) ?? stages[0];
  }, [workflowState.stages, workflowState.selectedStageId]);

  const moveStageSelection = useCallback(
    (delta: 1 | -1) => {
      const stages = workflowState.stages ?? [];
      if (stages.length === 0) return;
      const at = Math.max(0, stages.findIndex((stage) => stage.id === workflowState.selectedStageId));
      patchState({ selectedStageId: stages[(at + delta + stages.length) % stages.length]!.id });
    },
    [workflowState.stages, workflowState.selectedStageId, patchState],
  );

  /** Rebuilds the pane from the server after any authoring command changed it. */
  const reloadWorkflow = useCallback(async () => {
    if (content?.kind !== 'workflow' || !content.entityId || !focusedPane) return;
    const rebuilt = await workflowPaneContent(
      content.entityId,
      content.title,
      api,
      workflowState.selectedStageId ?? undefined,
    ).catch(() => null);
    if (rebuilt) open(rebuilt, 'replace', focusedPane.id);
  }, [content, focusedPane, api, workflowState.selectedStageId, open]);

  /**
   * Runs an authoring command through the schema-driven form and reloads
   * the pane if it actually changed anything. One helper rather than the
   * same three lines in eight handlers — and it means every authoring action
   * has identical cancel/failure behaviour (`runWithForm` resolves
   * `undefined` for both, and neither should trigger a reload).
   */
  const authorThen = useCallback(
    async (id: string, presets: Record<string, unknown>, title?: string) => {
      const result = await runner.runWithForm(id, presets, title ? { title } : {});
      if (result !== undefined) await reloadWorkflow();
    },
    [runner, reloadWorkflow],
  );

  const validateWorkflow = useCallback(async () => {
    if (content?.kind !== 'workflow' || !content.entityId) return;
    // Called through the API rather than `runner.run('workflow.validate')`:
    // that command deliberately THROWS on an invalid definition (so the
    // binary exits non-zero), which the runner would surface as an error
    // modal — losing the structured `issues` this overlay navigates by.
    const result = await withTimeout(api.definitions.validate(content.entityId), 8000).catch(
      () => null,
    );
    if (!result) {
      actions.toast('Could not reach the server to validate.', 'error');
      return;
    }
    const issues = result.issues ?? [
      // An older server sends only the flat strings. Showing them without
      // navigation beats showing nothing, so they are lifted into the same
      // shape with no stage attached.
      ...(result.errors ?? []).map((message) => ({
        severity: 'error' as const,
        code: 'error',
        message,
        stageIds: [],
      })),
      ...(result.warnings ?? []).map((message) => ({
        severity: 'warning' as const,
        code: 'warning',
        message,
        stageIds: [],
      })),
    ];
    if (result.valid && issues.length === 0) {
      actions.toast('Workflow is valid.', 'success');
      return;
    }
    actions.showOverlay({
      kind: 'validation',
      title: `Validation — ${content.title}`,
      valid: result.valid,
      issues,
      onNavigate: (stageId) => patchState({ selectedStageId: stageId }),
    });
  }, [content, api, actions, patchState]);

  // ── Browser and computer inspectors (Phase 8 items 1/2/3) ───────
  //
  // The browser pane rendered `state.snapshot` — which nothing anywhere ever
  // set, so that branch had never once been reached and every browser pane
  // showed the same "this terminal cannot display images" empty state
  // forever. `readPage()` (the accessibility tree) is the representation a
  // terminal actually wants, and it now has a route.

  const inspectBrowserPage = useCallback(async () => {
    if (!content?.entityId) return;
    actions.toast('Reading the page…', 'info');
    const page = await withTimeout(api.browser.readPage(content.entityId), 15000).catch(
      (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    );
    if (page instanceof Error) {
      actions.toast(page.message, 'error');
      return;
    }
    patchState({ url: page.url, title: page.title, snapshot: page.snapshot, snapshotAt: Date.now() });
  }, [content?.entityId, api, actions, patchState]);

  /**
   * Screenshot, drawn inline when the terminal can and handed to the system
   * viewer when it cannot (Phase 8 item 2).
   *
   * Inline drawing suspends Ink first. An image escape written into a
   * live-rendered frame is overwritten by the next redraw and, on kitty,
   * leaves the placement anchored to a cell Ink then reuses — the picture
   * ends up torn across whatever the app repaints. Handing the terminal over
   * is the same primitive the raw terminal attach and the `$EDITOR` handoff
   * already use.
   */
  const captureScreenshot = useCallback(() => {
    if (!content?.entityId) return;
    const workspaceId = content.entityId;
    const protocol = graphicsProtocol;

    void (async () => {
      actions.toast('Capturing…', 'info');
      const outcome = await api.browser
        .actions(workspaceId, { kind: 'screenshot' })
        .catch(() => null);
      const artifactPath = typeof outcome?.['artifactPath'] === 'string' ? outcome['artifactPath'] : '';
      if (!artifactPath) {
        actions.toast('The browser did not produce a screenshot.', 'error');
        return;
      }
      const bytes = await api.browser.file(workspaceId, artifactPath).catch(() => null);
      if (!bytes) {
        actions.toast('Could not read the screenshot back from the server.', 'error');
        return;
      }

      // Written to disk either way: it is what makes the external-open
      // fallback possible, and it is what the user keeps once the escape
      // sequence has scrolled away.
      const { promises: fsWrite } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const file = nodePath.join(tmpdir(), `generatorai-shot-${Date.now()}.png`);
      await fsWrite.writeFile(file, bytes);

      const escape = inlineImageSupported(protocol)
        ? encodeInlineImage(protocol, bytes, {
            name: nodePath.basename(file),
            // The pixel protocols need the cell grid to fit into; kitty and
            // iTerm2 ignore these and scale themselves.
            columns,
            rows: Math.max(4, rows - 4),
          })
        : null;

      if (!escape) {
        // Reached only when the decoder cannot read the file at all (16-bit
        // samples, interlacing, corruption) — every protocol can now DRAW.
        // Explicit degradation, not a silent one: say why, then offer the
        // platform viewer.
        actions.showOverlay({
          kind: 'confirm',
          message: `That screenshot could not be decoded for inline display.\n\nSaved to ${file}\n\nOpen it in the system viewer?`,
          danger: false,
          onAnswer: (yes) => {
            if (!yes) return;
            void (async () => {
              const { spawn } = await import('node:child_process');
              const { command, args } = externalOpenCommand(process.platform, file);
              const child = spawn(command, args, { detached: true, stdio: 'ignore' });
              child.on('error', () => actions.toast(`Could not run ${command}.`, 'error'));
              child.unref();
            })();
          },
        });
        return;
      }

      actions.setSuspended(true);
      await suspendTerminal(async () => {
        try {
          const caveat = inlineImageLimitation(protocol);
          stdout.write(
            `\n${escape}\n\n${caveat ? `${caveat}\n` : ''}Saved to ${file}\nPress Enter to return.\n`,
          );
          await new Promise<void>((resolve) => {
            const onData = (): void => {
              stdin.off('data', onData);
              resolve();
            };
            stdin.on('data', onData);
          });
        } finally {
          actions.setSuspended(false);
        }
      });
    })();
  }, [content?.entityId, api, actions, graphicsProtocol, suspendTerminal, stdout, stdin]);

  /** The three reads a computer pane needs, in one place — used by both the opener and the refresh. */
  const readComputerState = useCallback(
    async (workspaceId: string) => {
      // Every one of these list routes answers an envelope the client used to
      // mis-type as a bare array, so all three rendered empty before this
      // phase — see `admin.ts`'s computer namespace.
      const [runtime, consent, grants, activity] = await Promise.all([
        api.computer.runtime(workspaceId).catch(() => null),
        api.computer.consent(workspaceId).catch(() => null),
        api.computer.grants(workspaceId).catch(() => []),
        api.computer.activity(workspaceId).catch(() => []),
      ]);
      return {
        runtime,
        pending: (consent as { pending?: Array<Record<string, unknown>> } | null)?.pending ?? [],
        grants,
        activity,
      };
    },
    [api],
  );

  const refreshComputer = useCallback(async () => {
    if (content?.kind !== 'computer' || !content.entityId || !focusedPane) return;
    const next = await readComputerState(content.entityId);
    actions.patchPane(focusedPane.id, { state: { ...(content.state ?? {}), ...next } });
  }, [content, focusedPane, readComputerState, actions]);

  const openComputerPane = useCallback(async () => {
    if (!content?.entityId) return;
    const workspaceId = content.entityId;
    open(
      {
        kind: 'computer',
        entityId: workspaceId,
        title: `computer ${shortId(workspaceId)}`,
        state: { ...(await readComputerState(workspaceId)), section: 'pending' },
      },
      'split-h',
    );
  }, [content?.entityId, readComputerState, open]);

  // ── Settings (Phase 8 item 6) ───────────────────────────────────
  //
  // The pane was read-only and ended by telling the user to leave and run
  // `generatorai config set`. Reads through the SAME `config.show` command
  // the binary uses, and writes through `config.set`/`config.unset` — so
  // the TUI can never offer a key those commands cannot write.

  const loadSettings = useCallback(
    async (paneId: string) => {
      actions.patchPane(paneId, { kind: 'settings', title: 'Settings', state: { loading: true } });
      const config = await runner.run('config.show', {}, {});
      if (config === undefined || typeof config !== 'object') {
        actions.patchPane(paneId, {
          kind: 'settings',
          title: 'Settings',
          state: { error: 'config show returned no configuration.' },
        });
        return;
      }
      actions.patchPane(paneId, {
        kind: 'settings',
        title: 'Settings',
        state: { rows: settingRows(config as Record<string, unknown>) },
      });
    },
    [runner, actions],
  );

  const openSettings = useCallback(() => {
    const paneId = open({ kind: 'settings', title: 'Settings', state: { loading: true } }, 'replace');
    void loadSettings(paneId);
  }, [open, loadSettings]);

  const editSetting = useCallback(() => {
    if (content?.kind !== 'settings' || !focusedPane) return;
    const row = listRows[selection.index] as unknown as SettingRow | undefined;
    if (!row) return;
    const paneId = focusedPane.id;

    const apply = (value: string): void => {
      // Validated against the real schema BEFORE writing: `config set`
      // writes first and the schema only rejects on the NEXT load, by which
      // point the file on disk is already wrong.
      const problem = validateSettingValue(row.key, value);
      if (problem) {
        actions.toast(problem, 'error');
        return;
      }
      void runner.run('config.set', { key: row.key, value }).then((result) => {
        if (result === undefined) return;
        // `tui.theme` is one of the two settings the running app re-reads —
        // applying it here is what makes `effect: 'live'` true rather than a
        // claim.
        if (row.key === 'tui.theme') actions.setTheme(value);
        if (row.effect === 'restart') {
          actions.toast(`${row.key} saved — restart the TUI to apply it.`, 'warning');
        }
        void loadSettings(paneId);
      });
    };

    if (row.type === 'boolean') {
      // A two-value setting does not need a text field; toggling is the
      // whole interaction.
      apply(row.value === 'true' ? 'false' : 'true');
      return;
    }
    if (row.choices) {
      actions.showOverlay({
        kind: 'select',
        message: row.key,
        options: row.choices.map((choice) => ({ value: choice, label: choice })),
        onSelect: apply,
      });
      return;
    }
    actions.showOverlay({
      kind: 'input',
      message: `${row.key} (default: ${row.defaultValue || 'none'})`,
      initial: row.value,
      onSubmit: apply,
    });
  }, [content?.kind, focusedPane, listRows, selection.index, actions, runner, loadSettings]);

  const resetSetting = useCallback(() => {
    if (content?.kind !== 'settings' || !focusedPane) return;
    const row = listRows[selection.index] as unknown as SettingRow | undefined;
    if (!row) return;
    if (!row.overridden) {
      actions.toast(`${row.key} is already at its default.`, 'info');
      return;
    }
    const paneId = focusedPane.id;
    void runner.run('config.unset', { key: row.key }).then((result) => {
      if (result === undefined) return;
      if (row.key === 'tui.theme') actions.setTheme(row.defaultValue || 'auto');
      void loadSettings(paneId);
    });
  }, [content?.kind, focusedPane, listRows, selection.index, actions, runner, loadSettings]);

  // ── Administration views (Phase 8 item 5) ───────────────────────
  //
  // Twelve surfaces, one pane, driven by `adminViews.ts` over the command
  // registry — see that file for why this is declared rather than built.
  // Everything here is about GETTING the rows into a pane; the pane itself
  // (`CommandPane`) knows nothing about admin views.

  const runAdminView = useCallback(
    async (view: AdminView, paneId: string, promptedArgs: Record<string, string> = {}) => {
      const spec = registry.get(view.command);
      const title = view.title;
      actions.patchPane(paneId, {
        kind: 'command',
        title,
        entityId: view.id,
        state: { commandId: view.command, shape: view.shape ?? 'list', loading: true, description: view.description },
      });

      // A prompted value goes into whichever half the view names — some
      // commands scope positionally (`hook list <session>`), others by flag
      // (`widget list --chat`), and putting it in the wrong one is silently
      // dropped by `validate()`.
      const promptToFlag = view.prompt?.target === 'flag';
      const data = await runner.run(
        view.command,
        { ...(view.args ?? {}), ...(promptToFlag ? {} : promptedArgs) },
        { ...(view.flags ?? {}), ...(promptToFlag ? promptedArgs : {}) },
      );

      const base = {
        commandId: view.command,
        shape: view.shape ?? 'list',
        description: view.description,
        viewArgs: promptedArgs,
      };
      // `runner.run` resolves `undefined` for a failure it has ALREADY
      // reported (an error overlay) and for a declined confirm — so the pane
      // says the run produced nothing rather than claiming an empty result
      // set, which would read as "there are no devices".
      if (data === undefined) {
        actions.patchPane(paneId, {
          kind: 'command',
          title,
          entityId: view.id,
          state: { ...base, error: 'The command did not return a result.' },
        });
        return;
      }

      actions.patchPane(paneId, {
        kind: 'command',
        title,
        entityId: view.id,
        state:
          (view.shape ?? 'list') === 'record'
            ? { ...base, record: data }
            : {
                ...base,
                rows: (Array.isArray(data) ? data : [data]) as Array<Record<string, unknown>>,
                columns: adminViewColumns(spec),
              },
      });
    },
    [registry, runner, actions],
  );

  const openAdminView = useCallback(
    (view: AdminView, mode: 'tab' | 'replace' = 'tab') => {
      // Placeholder first, exactly as `openEntity` does — the pane must
      // appear before its request resolves, or a slow link reads as the key
      // having done nothing and the user presses it again.
      const paneId = open(
        { kind: 'command', entityId: view.id, title: view.title, state: { loading: true } },
        mode,
      );
      const start = (promptedArgs: Record<string, string>): void => {
        void runAdminView(view, paneId, promptedArgs);
      };
      if (!view.prompt) return start({});
      // A view whose command needs a value it cannot know asks, rather than
      // firing blind and surfacing a schema error the user did not cause.
      actions.showOverlay({
        kind: 'input',
        message: view.prompt.message,
        initial: '',
        onSubmit: (value) => {
          if (!value.trim()) {
            actions.toast('Cancelled — that view needs a value.', 'warning');
            return;
          }
          start({ [view.prompt!.arg]: value.trim() });
        },
      });
    },
    [open, runAdminView, actions],
  );

  const pickAdminView = useCallback(
    (mode: 'tab' | 'replace' = 'tab') => {
      actions.showOverlay({
        kind: 'select',
        message: 'Administration view',
        options: ADMIN_VIEWS.map((view) => ({
          value: view.id,
          label: view.title,
          detail: view.description,
        })),
        onSelect: (id) => {
          const view = resolveAdminView(id);
          if (view) openAdminView(view, mode);
        },
      });
    },
    [actions, openAdminView],
  );

  // ── Keymap ──────────────────────────────────────────────────────
  const contexts = useMemo(() => {
    if (leaderArmed) return ['leader' as const];
    if (overlay.kind !== 'none') return ['overlay' as const];
    switch (content?.kind) {
      case 'chat':
        // `composer` first: the prompt owns Ctrl+E and friends, and a global
        // binding on one of them would fire while the user edits a line.
        return ['composer', 'chat', 'global'] as const;
      case 'run':
        return ['run', 'global'] as const;
      case 'changes':
        return ['diff', 'global'] as const;
      case 'workflow':
        return ['workflow', 'global'] as const;
      // `command` BEFORE `list`, not instead of it: an admin view is a list
      // pane with two extra verbs, so it inherits list navigation, filter,
      // help and search rather than redeclaring them.
      case 'command':
        return ['command', 'list', 'global'] as const;
      case 'terminal':
        return ['terminal', 'global'] as const;
      case 'browser':
        return ['browser', 'global'] as const;
      case 'computer':
        // `list` as a fallback, same reasoning as the `command` pane: the
        // consent/grants/activity tables are lists, and redeclaring their
        // navigation here would be six bindings to keep in step with `list`'s.
        return ['computer', 'list', 'global'] as const;
      case 'workspace':
        return ['workspace', 'list', 'global'] as const;
      case 'automation':
        return ['automation', 'global'] as const;
      default:
        return ['list', 'global'] as const;
    }
  }, [leaderArmed, overlay.kind, content?.kind]);

  const keymapHandlers = useMemo<Record<HandledAction, () => void>>(
    () => ({
      // Global
      'app.palette': () => actions.showOverlay({ kind: 'palette' }),
      'app.help': () => actions.showOverlay({ kind: 'help' }),
      'app.refresh': () => void loadData(getStoreApi(), api, neededKeys),
      'app.back': () => {
        if (overlay.kind !== 'none') return actions.closeOverlay();
        // Leaving scrollback first: closing the pane because the user wanted
        // to return to the live tail loses the whole conversation view.
        if (scrollBack > 0) return patchState({ scrollBack: 0 });
        // Open question #9 — Escape used to close a pane outright, bypassing
        // the terminate-on-close confirm `pane.close` (leader x) added, so a
        // mashed Escape could silently orphan a live PTY or browser session.
        // It now goes through the SAME decision.
        //
        // The "naggy" worry that kept them apart does not apply:
        // `decideClosePane` returns `closeOnly` for every pane that owns no
        // terminable resource — which is every pane except a terminal or
        // browser one — so the overwhelmingly common Escape is byte-for-byte
        // unchanged, and the confirm appears exactly where something would
        // otherwise be left running.
        closePaneWithTerminationChoice();
      },
      'app.focusNext': () => actions.nextPane(),
      'app.focusPrev': () => actions.prevPane(),
      'app.toggleRightPane': () => setRightPaneVisible((v) => !v),
      'app.search': () =>
        actions.showOverlay({
          kind: 'input',
          message: 'Filter',
          initial: '',
          onSubmit: (value) => focusedPane && actions.setSearch(focusedPane.id, value),
        }),

      // Navigate
      'goto.dashboard': () => open({ kind: 'dashboard', title: 'Dashboard' }, 'replace'),
      'goto.chats': () => open({ kind: 'chats', title: 'Chats' }, 'replace'),
      'goto.workflows': () => open({ kind: 'workflows', title: 'Workflows' }, 'replace'),
      'goto.runs': () => open({ kind: 'runs', title: 'Runs' }, 'replace'),
      'goto.automations': () => open({ kind: 'automations', title: 'Automations' }, 'replace'),
      'goto.projects': () => open({ kind: 'projects', title: 'Projects' }, 'replace'),
      'goto.workspaces': () => open({ kind: 'workspaces', title: 'Workspaces' }, 'replace'),
      'goto.agents': () => open({ kind: 'agents', title: 'Agents' }, 'replace'),
      'goto.scripts': () => open({ kind: 'scripts', title: 'Scripts' }, 'replace'),
      'goto.extensions': () => open({ kind: 'extensions', title: 'Extensions' }, 'replace'),
      'goto.settings': () => openSettings(),
      'goto.admin': () => pickAdminView('replace'),

      // Administration views (Phase 8 item 5)
      'command.switch': () => pickAdminView('replace'),
      'command.rerun': () => {
        const view = resolveAdminView(content?.entityId ?? '');
        if (!view || !focusedPane) return;
        const previous = (content?.state as { viewArgs?: Record<string, string> } | undefined)?.viewArgs;
        // Re-runs with the SAME prompted arguments — asking again for a
        // session id on every refresh would make the hooks view unusable.
        void runAdminView(view, focusedPane.id, previous ?? {});
      },
      'command.inspect': () => {
        const row = listRows[selection.index];
        if (!row) {
          actions.toast('Nothing selected.', 'warning');
          return;
        }
        open(
          {
            kind: 'inspector',
            ...(row['id'] ? { entityId: String(row['id']) } : {}),
            title: String(row['name'] ?? row['id'] ?? content?.title ?? 'row'),
            state: row,
          },
          'split-h',
        );
      },

      // Panes (leader)
      'pane.newTab': () => leaderThen(() => open({ kind: 'dashboard', title: 'Dashboard' }, 'tab')),
      'pane.nextTab': () => leaderThen(() => actions.nextTab()),
      'pane.prevTab': () => leaderThen(() => actions.prevTab()),
      'pane.splitVertical': () =>
        leaderThen(() => open(content ?? { kind: 'dashboard', title: 'Dashboard' }, 'split-v')),
      'pane.splitHorizontal': () =>
        leaderThen(() => open(content ?? { kind: 'dashboard', title: 'Dashboard' }, 'split-h')),
      // Real geometric movement (Phase 4 item 3) — `columns`/`rows` are the
      // full terminal size, not the exact sub-region the pane tree renders
      // into (tabs/status/composer chrome also take rows), but every pane's
      // rectangle scales by the same factor either way, so their relative
      // positions — which is all nearest-neighbor selection looks at — come
      // out identical without threading the exact body height through here.
      'pane.focusLeft': () => leaderThen(() => actions.focusPaneDirection('left', columns, rows)),
      'pane.focusRight': () => leaderThen(() => actions.focusPaneDirection('right', columns, rows)),
      'pane.focusUp': () => leaderThen(() => actions.focusPaneDirection('up', columns, rows)),
      'pane.focusDown': () => leaderThen(() => actions.focusPaneDirection('down', columns, rows)),
      'pane.growSplit': () => leaderThen(() => actions.resizePane('grow')),
      'pane.shrinkSplit': () => leaderThen(() => actions.resizePane('shrink')),
      'pane.moveTabLeft': () => leaderThen(() => actions.moveTab(-1)),
      'pane.moveTabRight': () => leaderThen(() => actions.moveTab(1)),
      'pane.tabNavigator': () => leaderThen(() => actions.showOverlay({ kind: 'tabs' })),
      'pane.notifications': () => leaderThen(() => actions.showOverlay({ kind: 'notifications' })),
      // Open question #6 — client-side stream health had nowhere to surface.
      // `system doctor` is a SERVER command and can see none of it, yet
      // "why does this feel slow or stale?" is a question about the client.
      'pane.diagnostics': () =>
        leaderThen(() =>
          open(
            {
              kind: 'inspector',
              title: 'Client diagnostics',
              state: {
                stream: streamStats() ?? 'the reconciler is not running',
                terminal: capabilities
                  ? {
                      emulator: capabilities.emulator,
                      size: `${capabilities.columns}x${capabilities.rows}`,
                      colorDepth: capabilities.colorDepth,
                      graphics: capabilities.graphics,
                      kittyKeyboard: capabilities.kittyKeyboard,
                      unicode: capabilities.unicode,
                      screenReader: capabilities.screenReader,
                    }
                  : 'not detected',
                connection,
                tabs: workbench.tabs.length,
                openPanes: workbench.tabs.reduce((n, t) => n + paneLeaves(t.root).length, 0),
              },
            },
            'tab',
          ),
        ),
      'pane.lastTab': () => leaderThen(() => actions.lastTab()),
      'pane.zoom': () => leaderThen(() => actions.zoom()),
      'pane.close': () => leaderThen(() => closePaneWithTerminationChoice()),
      'pane.rename': () =>
        leaderThen(() =>
          actions.showOverlay({
            kind: 'input',
            message: 'Rename tab',
            initial: tab.title,
            onSubmit: (value) => actions.rename(value),
          }),
        ),
      'pane.detach': () =>
        leaderThen(() => {
          if (!focusedPane || !content) return;
          // Chat/run panes own a real SSE subscription (`attachment`) —
          // "detach" genuinely means "stop listening, the run/chat keeps
          // going server-side." Terminal/browser panes have no equivalent:
          // their connection to the live resource is periodic polling
          // (`refreshTerminal`) or an explicit action (`browser.navigate`),
          // never a subscription — there is nothing to "detach" from, and
          // clearing `state.terminalId`/`state.url` would just make the
          // pane forget which resource it was showing, with no reattach
          // mechanism to get it back (raw terminal attach isn't
          // implemented at all yet). Rather than silently no-op or
          // misleadingly pretend this did something, say so and point at
          // the real analog.
          if (content.attachment) {
            actions.patchPane(focusedPane.id, { attachment: undefined });
            actions.toast('Detached — the run keeps going on the server.', 'info');
            return;
          }
          if (content.kind === 'terminal' || content.kind === 'browser') {
            actions.toast(
              'Detach only applies to chat/run panes. Use close (leader x) to leave a terminal/browser pane.',
              'info',
            );
            return;
          }
          actions.toast('Nothing attached to detach from.', 'info');
        }),
      'pane.help': () => leaderThen(() => actions.showOverlay({ kind: 'help' })),
      'pane.scrollMode': () => leaderThen(() => patchState({ scrollBack: scrollBack + 5 })),

      // Lists
      'list.down': () => selection.move(1),
      'list.up': () => selection.move(-1),
      'list.pageDown': () => selection.move(10, false),
      'list.pageUp': () => selection.move(-10, false),
      'list.top': () => selection.first(),
      'list.bottom': () => selection.last(),
      'list.open': () => openSelected(),
      'list.new': () => {
        if (content?.kind === 'command') {
          const view = resolveAdminView(content.entityId ?? '');
          if (!view?.createCommand) {
            actions.toast('Nothing to create from this view.', 'warning');
            return;
          }
          const paneId = focusedPane?.id;
          void runner.runWithForm(view.createCommand).then((result) => {
            if (result !== undefined && paneId) void runAdminView(view, paneId);
          });
          return;
        }
        const create = content ? LIST_COMMANDS[content.kind]?.create : undefined;
        if (!create) {
          actions.toast('Nothing to create from this view.', 'warning');
          return;
        }
        actions.showOverlay({
          kind: 'input',
          message: `${create.id.split('.')[0]} name`,
          initial: '',
          onSubmit: (value) => {
            if (value.trim()) void runner.run(create.id, { [create.arg]: value.trim() });
          },
        });
      },
      // Phase 7 item 1 — `e` on the `workspaces` LIST pane now opens the
      // tree/artifacts/worktree browser instead of duplicating `list.open`
      // (its previous behavior, byte-for-byte); `e` on the browser PANE
      // itself (kind `workspace`, singular) is a real, new action —
      // $EDITOR handoff for the selected entry. Every other kind's existing
      // `openSelected()` behavior is unchanged.
      'list.edit': () => {
        if (content?.kind === 'workspaces') return openWorkspaceTree();
        if (content?.kind === 'workspace') return editWorkspaceFile();
        // Phase 8 item 6 — `e` on the settings pane edits the selected
        // setting in place. Gated on the kind, so every other pane's
        // existing behaviour is unchanged.
        if (content?.kind === 'settings') return editSetting();
        openSelected();
      },
      // `d` on the browser pane downloads the selected entry instead of
      // (harmlessly, since no `LIST_COMMANDS['workspace']` entry exists)
      // no-op-ing with a toast. Every other kind's existing delete
      // behavior is unchanged.
      'list.delete': () => {
        if (content?.kind === 'workspace') return downloadWorkspaceRow();
        if (content?.kind === 'settings') return resetSetting();
        // An administration view deletes through the command its own
        // declaration names (`adminViews.ts`), not through `LIST_COMMANDS` —
        // which is keyed by pane KIND, and every admin view shares the one
        // `command` kind.
        if (content?.kind === 'command') {
          const view = resolveAdminView(content.entityId ?? '');
          const row = listRows[selection.index];
          if (!view?.removeCommand || !row?.['id']) {
            actions.toast('Nothing to delete from this view.', 'warning');
            return;
          }
          const paneId = focusedPane?.id;
          void runner
            .run(view.removeCommand.id, { [view.removeCommand.arg]: String(row['id']) })
            .then((result) => {
              if (result !== undefined && paneId) void runAdminView(view, paneId);
            });
          return;
        }
        const remove = content ? LIST_COMMANDS[content.kind]?.remove : undefined;
        const row = listRows[selection.index];
        if (!remove || !row?.['id']) {
          actions.toast('Nothing to delete from this view.', 'warning');
          return;
        }
        // No confirm here: every one of these specs is `destructive`, and the
        // runner already gates those. Asking twice trains people to hit y.
        void runner.run(remove.id, { [remove.arg]: String(row['id']) });
      },
      'list.filter': () =>
        actions.showOverlay({
          kind: 'input',
          message: 'Filter',
          initial: focusedPane ? (getStore().getState().search[focusedPane.id] ?? '') : '',
          onSubmit: (value) => focusedPane && actions.setSearch(focusedPane.id, value),
        }),
      'list.sort': () => {
        const current = String((content?.state as { sortBy?: string } | undefined)?.sortBy ?? '');
        const next = SORT_KEYS[(SORT_KEYS.indexOf(current) + 1) % SORT_KEYS.length]!;
        patchState({ sortBy: next });
        actions.toast(`Sorted by ${next}.`, 'info');
      },
      'list.select': () => {
        const row = listRows[selection.index];
        if (row?.['id']) actions.toast(`Selected ${String(row['id'])}`, 'info');
      },
      'list.yankId': () => {
        const row = listRows[selection.index];
        if (row?.['id']) actions.toast(`id: ${String(row['id'])}`, 'info');
      },

      // Chat
      //
      // `chat.editor` is a real double-fire bug, same class as the
      // leader/composer conflict item 2 of Phase 4 already fixed:
      // `alt+e` contains `+`, so `isPrintableChord` (`hooks.ts:337`) never
      // suppresses it while the composer owns the keyboard — Composer's OWN
      // `useInput` (`tui-kit/src/input.tsx`) already spawns `$EDITOR` for
      // real on this exact chord, and `contexts` always includes
      // `'composer'` whenever a chat is focused, so this handler fired
      // alongside it on every press, popping a stale "here's how" toast
      // over the editor it just opened. A genuine no-op now — kept in this
      // map (rather than deleted) only so `chat.editor` still counts as
      // "implemented" for the help overlay (`implementedActions` below is
      // built from this object's keys).
      'chat.editor': () => {},
      'chat.model': () => void pickModel(content?.entityId ?? '', ''),
      'chat.agent': () => void pickAgent(content?.entityId ?? '', ''),
      'chat.permission': () => void pickPermissionMode(content?.entityId ?? '', ''),
      'chat.stop': () => void runner.run('chat.cancel', { chat: content?.entityId ?? '' }),
      'chat.clear': () => focusedPane && actions.resetTimeline(focusedPane.id),
      'chat.toggleThinking': () => actions.toggleThinking(),
      'chat.respond': () => respondToChatGate(),
      'chat.scrollUp': () => patchState({ scrollBack: scrollBack + 5 }),
      'chat.scrollDown': () => patchState({ scrollBack: Math.max(0, scrollBack - 5) }),
      // Real search WITHIN the transcript (Phase 4 item 7) — jumps
      // `scrollBack` to a match, unlike `app.search`'s row-filter for list
      // panes. Repeated searches (same query) walk backward through
      // matches one at a time (`findTranscriptMatch`'s own wrap-around).
      'chat.search': () =>
        actions.showOverlay({
          kind: 'input',
          message: 'Search transcript',
          initial: '',
          onSubmit: (query) => {
            if (!focusedPane || !query.trim()) return;
            const items = getStoreApi().getState().timelines[focusedPane.id]?.items ?? [];
            const match = findTranscriptMatch(items, query, scrollBack);
            if (match === null) {
              actions.toast(`No match for "${query.trim()}".`, 'warning');
              return;
            }
            patchState({ scrollBack: match });
          },
        }),

      // Diff
      'diff.nextFile': () => {
        selection.move(1);
        void showDiffFor(selection.index + 1);
      },
      'diff.prevFile': () => {
        selection.move(-1);
        void showDiffFor(selection.index - 1);
      },
      'diff.nextHunk': () => seekHunk(1),
      'diff.prevHunk': () => seekHunk(-1),
      'diff.toggleLayout': () =>
        patchState({
          layout:
            (content?.state as { layout?: string } | undefined)?.layout === 'split'
              ? 'unified'
              : 'split',
        }),
      // Open question #21 — a real line cursor. `parseDiffLines` already
      // produces `oldLine`/`newLine` per row, so this needed no new data,
      // only somewhere to put the position.
      'diff.nextLine': () => moveDiffCursor(1),
      'diff.prevLine': () => moveDiffCursor(-1),
      'diff.comment': () => {
        const state = (content?.state ?? {}) as {
          files?: Array<{ path?: string }>;
          patch?: string;
          lineCursor?: number;
        };
        const file = state.files?.[selection.index];
        if (!file?.path || !content?.entityId) {
          actions.toast('Select a file first.', 'warning');
          return;
        }
        const lines = parseDiffLines(String(state.patch ?? ''));
        // The cursor supplies `startLine` AND `side` — more than the old
        // "which line?" prompt could, since a typed number never said
        // whether it meant the old file or the new one, and `review create`
        // needs both to anchor the comment where the reviewer is looking.
        const anchor = anchorFor(lines, state.lineCursor ?? -1);
        if (!anchor) {
          actions.toast('Move to a line in the diff first (↑/↓).', 'warning');
          return;
        }
        const path = file.path;
        const entityId = content.entityId;
        actions.showOverlay({
          kind: 'input',
          message: `Comment on ${path}:${anchor.startLine} (${anchor.side})`,
          initial: '',
          onSubmit: (body) => {
            if (!body.trim()) return;
            void runner.run(
              'review.create',
              { workspace: entityId, path, body: body.trim() },
              {
                startLine: anchor.startLine,
                side: anchor.side,
                // Lets the server detect that the line moved since the
                // comment was written, which it cannot do from a number.
                ...(anchor.anchorText ? { anchorText: anchor.anchorText } : {}),
              },
            );
          },
        });
      },
      'diff.resolve': () => void resolveThread(),
      'diff.openTerminal': () => openTerminalPane(),
      'diff.openBrowser': () => openBrowserPane(),

      // SCM workbench (Phase 7 item 2)
      'diff.checkpoints': () => void showCheckpoints(),
      'diff.commit': () =>
        actions.showOverlay({
          kind: 'input',
          message: 'Commit message',
          initial: '',
          onSubmit: (message) => {
            if (!message.trim()) {
              actions.toast('A commit needs a message.', 'warning');
              return;
            }
            void runner
              .run('workspace.commit', { workspace: content?.entityId ?? '' }, { message: message.trim() })
              .then((result) => {
                if (result !== undefined) void refreshChanges();
              });
          },
        }),
      // `workspace pr` is one command with two behaviours — it LISTS when
      // `--title` is absent and CREATES when it is present. The form makes
      // that visible (leave the title blank to list) rather than hiding it
      // behind two separate keys that both call the same command.
      'diff.pullRequest': () =>
        void runner.runWithForm(
          'workspace.pr',
          { workspace: content?.entityId ?? '' },
          { title: 'Pull request — leave title blank to list existing ones' },
        ),
      'diff.threads': () => void showThreads(),
      'diff.submitReview': () =>
        void runner.runWithForm('review.submit', { workspace: content?.entityId ?? '' }),
      'diff.refresh': () => void refreshChanges(),

      // Workflow authoring (Phase 7 items 4/5/6)
      'workflow.nextStage': () => moveStageSelection(1),
      'workflow.prevStage': () => moveStageSelection(-1),
      'workflow.addStage': () =>
        void authorThen('workflow.stage.add', { workflow: content?.entityId ?? '' }),
      'workflow.editStage': () => {
        const stage = selectedStage();
        if (!stage) return actions.toast('This workflow has no stages yet — press n.', 'warning');
        void authorThen(
          'workflow.stage.update',
          { workflow: content?.entityId ?? '', stage: stage.id, name: stage.name },
          `Edit stage — ${stage.name}`,
        );
      },
      'workflow.deleteStage': () => {
        const stage = selectedStage();
        if (!stage) return actions.toast('No stage selected.', 'warning');
        // `workflow.stage.delete` is `destructive: true`; the runner's own
        // gate asks. Run directly rather than through a form — both its
        // arguments are already known, so a form would be an empty
        // confirmation dialog stacked on top of a real one.
        void runner
          .run('workflow.stage.delete', { workflow: content?.entityId ?? '', stage: stage.id })
          .then((result) => {
            if (result !== undefined) void reloadWorkflow();
          });
      },
      'workflow.addEdge': () => {
        const stage = selectedStage();
        if (!stage) return actions.toast('No stage selected.', 'warning');
        void authorThen(
          'workflow.edge.add',
          { workflow: content?.entityId ?? '', from: stage.id },
          `Connect ${stage.name} to…`,
        );
      },
      'workflow.deleteEdge': () => {
        const stage = selectedStage();
        const edges = (workflowState.edges ?? []).filter(
          (edge) => edge.fromStageId === stage?.id || edge.toStageId === stage?.id,
        );
        if (edges.length === 0) {
          actions.toast('This stage has no edges.', 'warning');
          return;
        }
        const nameOf = (id: string): string =>
          (workflowState.stages ?? []).find((s) => s.id === id)?.name ?? shortId(id);
        actions.showOverlay({
          kind: 'select',
          message: 'Delete which edge?',
          options: edges.map((edge) => ({
            value: String(edge.id ?? ''),
            label: `${nameOf(edge.fromStageId)} → ${nameOf(edge.toStageId)}`,
            detail: edge.edgeType ?? 'on_success',
          })),
          onSelect: (edgeId) =>
            void runner
              .run('workflow.edge.delete', { workflow: content?.entityId ?? '', edge: edgeId })
              .then((result) => {
                if (result !== undefined) void reloadWorkflow();
              }),
        });
      },
      'workflow.variables': () => {
        const stage = selectedStage();
        if (!stage) return actions.toast('No stage selected.', 'warning');
        // `--var name=value` (repeatable) is the whole variables surface, so
        // the form's own variadic field IS the variable editor — no second
        // key-value UI to keep in step with the command's semantics.
        void authorThen(
          'workflow.stage.update',
          { workflow: content?.entityId ?? '', stage: stage.id },
          `Variables — ${stage.name} (--var name=value, comma separated)`,
        );
      },
      'workflow.hooks': () => {
        const stage = selectedStage();
        if (!stage) return actions.toast('No stage selected.', 'warning');
        const workflowId = content?.entityId ?? '';
        actions.showOverlay({
          kind: 'select',
          message: `Hooks — ${stage.name}`,
          options: [
            { value: 'list', label: 'List this stage\'s hooks' },
            { value: 'add', label: 'Attach a hook…' },
            { value: 'remove', label: 'Detach a hook…' },
          ],
          onSelect: (choice) => {
            if (choice === 'list') {
              void runner
                .run('workflow.stage.hook.list', { workflow: workflowId, stage: stage.id })
                .then((rows) => {
                  const hooks = (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>;
                  if (hooks.length === 0) {
                    actions.toast('This stage has no hooks.', 'info');
                    return;
                  }
                  open(
                    {
                      kind: 'inspector',
                      entityId: stage.id,
                      title: `hooks ${stage.name}`,
                      state: { hooks },
                    },
                    'split-h',
                  );
                });
              return;
            }
            void authorThen(
              choice === 'add' ? 'workflow.stage.hook.add' : 'workflow.stage.hook.remove',
              { workflow: workflowId, stage: stage.id },
            );
          },
        });
      },
      'workflow.validate': () => void validateWorkflow(),
      'workflow.run': () =>
        void runner.runWithForm('run.start', { workflow: content?.entityId ?? '' }),
      'workflow.reload': () => void reloadWorkflow(),

      // Terminal
      'terminal.new': () =>
        void runner
          .run('terminal.create', { workspace: content?.entityId ?? '' })
          .then((created) => {
            const id = (created as { id?: string } | undefined)?.id;
            if (id) void refreshTerminal(id);
          }),
      'terminal.attach': () => {
        const id = String((content?.state as { terminalId?: string } | undefined)?.terminalId ?? '');
        if (!id) {
          actions.toast('Press n to start a terminal first.', 'warning');
          return;
        }
        attachRawTerminal(id);
      },
      'terminal.list': () => void pickTerminal(),

      // Open questions #10/#11 — a terminal pane had no scroll offset at
      // all, which is why search could not be built (a match had nowhere to
      // jump TO) and why copy had no defined region. The headless emulator
      // keeps a real scrollback buffer now.
      'terminal.scrollUp': () => patchState({ scrollBack: terminalScrollBack() + 10 }),
      'terminal.scrollDown': () =>
        patchState({ scrollBack: Math.max(0, terminalScrollBack() - 10) }),
      'terminal.follow': () => patchState({ scrollBack: 0 }),
      'terminal.search': () =>
        actions.showOverlay({
          kind: 'input',
          message: 'Search scrollback',
          initial: '',
          onSubmit: (query) => {
            const state = (content?.state ?? {}) as { scrollback?: string };
            if (!query.trim() || !state.scrollback) return;
            void findTerminalMatch(
              state.scrollback,
              Math.max(20, columns - 6),
              Math.max(3, rows - 9),
              query,
              terminalScrollBack(),
            ).then((offset) => {
              if (offset === null) {
                actions.toast(`No match for "${query.trim()}".`, 'warning');
                return;
              }
              patchState({ scrollBack: offset });
            });
          },
        }),
      // Not a selection model — "copy what is on screen" is the operation a
      // terminal pane actually needs, and OSC 52 reaches the terminal the
      // user is looking at even over SSH, where a clipboard binary would not.
      'terminal.yank': () => {
        const state = (content?.state ?? {}) as { scrollback?: string };
        if (!state.scrollback) {
          actions.toast('Nothing to copy yet.', 'warning');
          return;
        }
        void renderTerminalText(
          state.scrollback,
          Math.max(20, columns - 6),
          Math.max(3, rows - 9),
          terminalScrollBack(),
        ).then((text) => copyToClipboard(text, 'the visible screen'));
      },
      // Phase 5 item 6 — killing a terminal is immediate and irreversible
      // (the PTY exits, its scrollback is gone) with no confirmation
      // anywhere in the product before this; matches the confirm-before-
      // terminate UX `pane.close`'s `closePaneWithTerminationChoice`
      // already established for the same underlying action.
      'terminal.kill': () => {
        const id = String((content?.state as { terminalId?: string } | undefined)?.terminalId ?? '');
        if (!id) return;
        actions.showOverlay({
          kind: 'confirm',
          message: 'Kill this terminal? The session ends immediately.',
          danger: true,
          onAnswer: (yes) => {
            if (!yes) return;
            void runner
              .run('terminal.kill', { workspace: content?.entityId ?? '', terminal: id })
              .then(() =>
                patchState({
                  terminalId: undefined,
                  scrollback: undefined,
                  exitCode: undefined,
                  lastActivityAt: undefined,
                }),
              );
          },
        });
      },

      // Automation (Phase 6 item 6)
      'automation.nextExecution': () => moveExecutionSelection(1),
      'automation.prevExecution': () => moveExecutionSelection(-1),
      'automation.openRun': () => void openAutomationExecutionRun(),
      'automation.cancelExecution': () => void cancelSelectedExecution(),

      // Browser
      'browser.navigate': () =>
        actions.showOverlay({
          kind: 'input',
          message: 'Open URL',
          initial: String((content?.state as { url?: string } | undefined)?.url ?? 'https://'),
          onSubmit: (url) => {
            if (!url.trim()) return;
            void runner
              .run('browser.navigate', { workspace: content?.entityId ?? '', url: url.trim() })
              .then(() => patchState({ url: url.trim() }));
          },
        }),
      'browser.back': () => void runner.run('browser.back', { workspace: content?.entityId ?? '' }),
      'browser.forward': () =>
        void runner.run('browser.forward', { workspace: content?.entityId ?? '' }),
      'browser.reload': () =>
        void runner.run('browser.reload', { workspace: content?.entityId ?? '' }),
      // Phase 8 item 2 — drawn inline where the terminal supports it, handed
      // to the system viewer where it does not. The old handler only ever
      // asked for a path and shelled the (then-broken) command at it.
      'browser.screenshot': () => captureScreenshot(),
      'browser.inspect': () => void inspectBrowserPage(),
      'browser.computer': () => void openComputerPane(),
      'browser.status': () =>
        void runner.run('browser.status', { workspace: content?.entityId ?? '' }).then((status) => {
          const descriptor = status as { url?: string; title?: string } | undefined;
          if (descriptor) patchState(descriptor as Record<string, unknown>);
        }),
      // Phase 4 item 6 — previously no user-reachable way to terminate a
      // browser session from the TUI existed at all; this is the pane-
      // scoped equivalent of `terminal.kill`, distinct from `pane.close`'s
      // NEW terminate-on-close confirm (leader x) — this one stops the
      // session while KEEPING the pane open, for "free the resource but
      // keep looking at the last screenshot/state" without losing the pane.
      'browser.stop': () =>
        actions.showOverlay({
          kind: 'confirm',
          message: 'Stop this browser session?',
          danger: true,
          onAnswer: (yes) => {
            if (yes) void runner.run('browser.stop', { workspace: content?.entityId ?? '' });
          },
        }),

      // Workspace file browser (Phase 7 item 1, open questions #24/#26)
      //
      // Its own context now, rather than more overloading of `list.edit` /
      // `list.delete` — "Delete" meaning "download" was a real, logged
      // UX-clarity problem, and upload and fold have no `list` equivalent.
      'workspace.edit': () => editWorkspaceFile(),
      'workspace.download': () => downloadWorkspaceRow(),
      'workspace.upload': () => uploadWorkspaceFile(),
      'workspace.refresh': () => void refreshWorkspacePane(),
      'workspace.toggleTree': () => {
        const view = (content?.state as { view?: string } | undefined)?.view ?? 'tree';
        patchState({ view: view === 'tree' ? 'flat' : 'tree' });
        // The two views have different row counts, so a cursor kept across
        // the switch would point somewhere unrelated.
        selection.first();
      },
      'workspace.collapse': () => foldWorkspaceDirectory(true),
      'workspace.expand': () => foldWorkspaceDirectory(false),

      // Computer use (Phase 8 items 1/3)
      'computer.refresh': () => void refreshComputer(),
      'computer.nextSection': () => {
        const order = ['pending', 'grants', 'activity'] as const;
        const current = (content?.state as { section?: (typeof order)[number] } | undefined)?.section ?? 'pending';
        patchState({ section: order[(order.indexOf(current) + 1) % order.length] });
        // The cursor is sized against the section that is showing, so it has
        // to go back to the top or it can point past the end of a shorter one.
        selection.first();
      },
      'computer.answer': () => {
        const section = (content?.state as { section?: string } | undefined)?.section ?? 'pending';
        if (section !== 'pending') {
          actions.toast('Switch to the pending section (s) to answer a prompt.', 'warning');
          return;
        }
        const row = listRows[selection.index];
        if (!row?.['requestId']) {
          actions.toast('Nothing is waiting for a decision.', 'info');
          return;
        }
        const workspaceId = content?.entityId ?? '';
        const requestId = String(row['requestId']);
        const app = String(row['appIdentity'] ?? '');
        actions.showOverlay({
          kind: 'select',
          message: `${app} — ${String(row['reason'] ?? 'wants access')}`,
          options: [
            { value: 'allow_once', label: 'Allow once', detail: 'This action only' },
            { value: 'allow_run', label: 'Allow for this run', detail: 'Until the run ends' },
            { value: 'always_allow', label: 'Always allow this app', detail: 'Records a standing grant' },
            { value: 'deny', label: 'Deny', detail: 'Refuse this action' },
          ],
          onSelect: (decision) =>
            void runner
              .run(
                'computer.answer',
                { workspace: workspaceId, request: requestId, decision },
                { app },
              )
              .then((result) => {
                if (result !== undefined) void refreshComputer();
              }),
        });
      },
      'computer.revoke': () => {
        const section = (content?.state as { section?: string } | undefined)?.section ?? 'pending';
        if (section !== 'grants') {
          actions.toast('Switch to the grants section (s) to revoke one.', 'warning');
          return;
        }
        const row = listRows[selection.index];
        if (!row?.['appIdentity']) return;
        void runner
          .run('computer.revoke', {
            workspace: content?.entityId ?? '',
            app: String(row['appIdentity']),
          })
          .then((result) => {
            if (result !== undefined) void refreshComputer();
          });
      },
      'computer.runtime': () =>
        actions.showOverlay({
          kind: 'select',
          message: 'Computer Use driver',
          options: [
            { value: 'start', label: 'Start', detail: 'Hands the agent control of this desktop' },
            { value: 'restart', label: 'Restart' },
            { value: 'stop', label: 'Stop', detail: 'Ends any live desktop-control session' },
          ],
          onSelect: (action) =>
            void runner
              .run('computer.runtime', { workspace: content?.entityId ?? '', action })
              .then((result) => {
                if (result !== undefined) void refreshComputer();
              }),
        }),

      // Runs
      'run.pause': () => void runner.run('run.pause', { run: content?.entityId ?? '' }),
      'run.resume': () => void runner.run('run.resume', { run: content?.entityId ?? '' }),
      'run.cancel': () =>
        actions.showOverlay({
          kind: 'confirm',
          message: 'Cancel this run?',
          danger: true,
          onAnswer: (yes) => {
            if (yes) void runner.run('run.cancel', { run: content?.entityId ?? '' }, { yes: true });
          },
        }),
      'run.retry': () => void runner.run('run.retry', { run: content?.entityId ?? '' }),
      'run.approve': () => approveGate(true),
      'run.reject': () => approveGate(false),
      // Phase 6 item 4 — both were registered in the keymap with zero
      // handler before this: pressing `s`/`v` on a run pane did nothing.
      'run.stageDetail': () => void openStageDetail(),
      'run.verbosity': () => cycleVerbosity(),

      'app.theme': () =>
        actions.showOverlay({
          kind: 'select',
          message: 'Theme',
          options: terminalThemeIds().map((t) => ({
            value: t.id,
            label: t.label,
            detail: t.description,
          })),
          onSelect: (value) => actions.setTheme(value),
        }),
      'app.quit': () => process.kill(process.pid, 'SIGINT'),
    }),
    // Rebuilt per render on purpose: the closures read `content`, `selection`
    // and `overlay`, and `useKeymap` reads them through a ref. `columns`/
    // `rows` are real deps, not an omission — the 4 directional-focus
    // handlers close over them for geometric focus math (Phase 4 item 3),
    // and a resize genuinely needs to be picked up, unlike this list's
    // other deliberately-omitted values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, api, runner, content, listRows, selection, overlay.kind, neededKeys, columns, rows],
  );

  // A focused text field owns bare keystrokes; only modified chords and named
  // keys may still act as shortcuts while one is up.
  const textInputActive = content?.kind === 'chat' || overlay.kind === 'input';

  useKeymap(keymap, [...contexts], keymapHandlers, {
    isActive: !suspended,
    textInputActive,
  });

  // The help sheet lists only what is wired up here.
  const implementedActions = useMemo(
    () => new Set([...Object.keys(keymapHandlers), 'pane.leader']),
    [keymapHandlers],
  );

  function leaderThen(action: () => void): void {
    setLeaderArmed(false);
    action();
  }

  function approveGate(approve: boolean): void {
    const pending = getStoreApi().getState().timelines[focusedPane?.id ?? '']?.pendingApproval;
    if (!pending || !content?.entityId) {
      actions.toast('No gate is waiting.', 'warning');
      return;
    }
    void runner.run(approve ? 'run.hitl.approve' : 'run.hitl.reject', {
      run: content.entityId,
      stage: pending.stageId,
    });
  }

  /**
   * Answers whichever chat-scoped HITL gate is pending (Phase 6 item 3) —
   * a plan review or a clarifying question. Distinct from `approveGate`
   * above, which answers a WORKFLOW STAGE gate; these are two genuinely
   * separate subsystems (`AgentInteractionService` vs `HitlService`) with
   * different backing commands.
   *
   * Plan review reuses the existing, tested `chat.plan` command's
   * `--approve`/`--reject` flags rather than the full 3-way
   * `implement_interactive`/`implement_autopilot`/`exit_only` choice —
   * that command already omits `action` on a bare approve, and the server
   * itself then defaults to the plan's own `recommendedAction`
   * (`ChatManagementService.ts`'s `buildPlanReviewHandler`), so this loses
   * no real capability the CLI's own command doesn't already forgo.
   *
   * A clarifying question has no wrapping registry command at all (only
   * `ctx.api.chats.respond` exists) — answered directly through the `api`
   * prop, the same way `pickModel` reaches for `api.copilot.models()`
   * directly when no command wraps a lookup either.
   */
  function respondToChatGate(): void {
    const pending = getStoreApi().getState().timelines[focusedPane?.id ?? '']?.pendingInteraction;
    if (!pending || !content?.entityId) {
      actions.toast('Nothing is waiting for an answer.', 'warning');
      return;
    }
    const chatId = content.entityId;

    if (pending.kind === 'plan') {
      const { planId, title, summary } = pending;
      actions.showOverlay({
        kind: 'confirm',
        message: `${title}\n\n${summary}`,
        danger: false,
        onAnswer: (approve) => {
          if (approve) {
            void runner.run('chat.plan', { chat: chatId, planId }, { approve: true });
            return;
          }
          actions.showOverlay({
            kind: 'input',
            message: 'Why? (optional feedback, Enter to skip)',
            initial: '',
            onSubmit: (note) =>
              void runner.run(
                'chat.plan',
                { chat: chatId, planId },
                { reject: true, ...(note.trim() ? { note: note.trim() } : {}) },
              ),
          });
        },
      });
      return;
    }

    // A question gate can carry more than one question — asked one at a
    // time via the palette-style sequential-collection pattern
    // `runFromPalette` already uses for a command's required args.
    // `multiSelect` questions are answered as a single choice here — a
    // real, documented scope-down (see the tracker), not an oversight: the
    // generic `select` overlay this reuses has no multi-pick mode, and
    // adding one is its own separate piece of work.
    const { interactionId, questions } = pending;
    const askNext = (index: number, answers: Record<string, string[]>): void => {
      const q = questions[index];
      if (!q) {
        void api.chats.respond(chatId, interactionId, { answers });
        return;
      }
      const finish = (value: string) => askNext(index + 1, { ...answers, [q.id]: [value] });
      if (q.options.length > 0) {
        actions.showOverlay({
          kind: 'select',
          message: q.question,
          options: [
            ...q.options.map((o) => ({
              value: o.label,
              label: o.label,
              ...(o.description ? { detail: o.description } : {}),
            })),
            ...(q.allowFreeform ? [{ value: '__other__', label: 'Other…' }] : []),
          ],
          onSelect: (value) => {
            if (value === '__other__') {
              actions.showOverlay({ kind: 'input', message: q.question, initial: '', onSubmit: finish });
              return;
            }
            finish(value);
          },
        });
      } else {
        actions.showOverlay({ kind: 'input', message: q.question, initial: '', onSubmit: finish });
      }
    };
    askNext(0, {});
  }

  /**
   * Stage detail (Phase 6 item 4) — a point-in-time fetch, same pattern as
   * `pickTerminal`: `ctx.api.runs.stages`/`.get` are already real and
   * already used for history seeding (`open.ts`), just never re-fetched
   * live or shown as anything but a flat timeline entry.
   */
  async function openStageDetail(): Promise<void> {
    if (!content?.entityId || content.kind !== 'run') {
      actions.toast('Open a run pane first.', 'warning');
      return;
    }
    const runId = content.entityId;
    actions.toast('Loading stage detail…', 'info');
    const [stages, run] = await Promise.all([
      withTimeout(api.runs.stages(runId), 8000).catch(() => null),
      withTimeout(api.runs.get(runId), 8000).catch(() => null),
    ]);
    if (stages === null) {
      actions.toast('Could not reach the server for stage detail.', 'error');
      return;
    }
    if (stages.length === 0) {
      actions.toast('This run has no stages yet.', 'warning');
      return;
    }
    actions.showOverlay({
      kind: 'stageDetail',
      runId,
      paneId: focusedPane?.id ?? '',
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        startedAt: s.startedAt ? String(s.startedAt) : null,
        completedAt: s.completedAt ? String(s.completedAt) : null,
        error: s.error ?? null,
        retryCount: s.retryCount,
      })),
      variables: run?.variables ?? {},
    });
  }

  /**
   * Per-pane (not per-run-definition) log verbosity — a pane instance is
   * what a user is looking at and wants quieter/noisier, and there is
   * nowhere server-side this preference could persist across panes anyway.
   */
  function cycleVerbosity(): void {
    if (!focusedPane) return;
    const current = getStoreApi().getState().verbosity[focusedPane.id] ?? 'normal';
    const next = nextVerbosity(current);
    actions.setVerbosity(focusedPane.id, next);
    actions.toast(`Verbosity: ${next}`, 'info');
  }

  // Arm the leader on its own chord. Handled outside `useKeymap` because it
  // switches which context the NEXT key is resolved in.
  useKeymap(
    keymap,
    ['global'],
    { 'pane.leader': () => setLeaderArmed(true) },
    { isActive: !suspended && !leaderArmed && overlay.kind === 'none' },
  );

  // A stray leader press must not swallow the next keystroke minutes later.
  useEffect(() => {
    if (!leaderArmed) return;
    const timer = setTimeout(() => setLeaderArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [leaderArmed]);

  // ── Frame ───────────────────────────────────────────────────────
  const tabItems = workbench.tabs.map((t) => {
    // "Unseen output" (Phase 4 item 7) — distinct from `tone: 'running'`
    // above, which only means "this tab has a live subscription," true
    // for a focused, fully-caught-up tab just as much as a neglected one.
    // A badge means new content specifically arrived while this tab was
    // NOT the one on screen.
    const unseenCount = paneLeaves(t.root).filter((l) => l.id in unseen).length;
    // Phase 6 item 5 — a pane with a pending approval/question makes its
    // WHOLE tab worth noticing at a glance (not the structured
    // `blockedWorkItems()` list the notification-queue overlay uses — this
    // only needs a boolean per tab; see `blockedPaneIdsKey` above for why
    // it isn't a direct `timelines` subscription). `'warning'` wins over
    // `'running'`: a blocked run is more urgent than a merely-still-going
    // one.
    const blocked = paneLeaves(t.root).some((l) => blockedPaneIds.has(l.id));
    return {
      id: t.id,
      label: t.title,
      ...(blocked
        ? { tone: 'warning' as const }
        : paneLeaves(t.root).some((l) => l.content.attachment)
          ? { tone: 'running' as const }
          : {}),
      ...(unseenCount > 0 ? { badge: unseenCount } : {}),
    };
  });

  const showComposer = content?.kind === 'chat';

  // The composer grows with the draft and with the completion menu. Assuming a
  // fixed height overflows the screen and paints the menu over the chrome.
  const [composerRows, setComposerRows] = useState(4);
  const chromeRows = 2 /* title + tabs */ + 1 /* status */ + (rows > 24 ? 1 : 0) /* key hints */;
  const bodyHeight = Math.max(
    3,
    rows - chromeRows - toastRows - (showComposer ? composerRows : 0),
  );
  const maxMenuRows = Math.max(1, Math.min(8, rows - chromeRows - 3 - 3));

  const left: StatusSegment[] = [
    {
      text: connection ? `${theme.glyphs.bullet} ${connection.label}` : 'not connected',
      tone: connection?.state === 'authenticated' ? 'success' : 'warning',
      priority: 0,
    },
    { text: connection?.endpoint ?? '', tone: 'idle', priority: 4 },
  ];

  const right: StatusSegment[] = [
    ...(leaderArmed ? [{ text: 'LEADER', tone: 'primary' as const, priority: 0 }] : []),
    { text: `${prettyChord(keymap.chordFor('app.palette'))} palette`, tone: 'idle', priority: 2 },
    { text: '? help', tone: 'idle', priority: 1 },
    { text: `${prettyChord(keymap.chordFor('app.quit'))} quit`, tone: 'idle', priority: 3 },
  ];

  const overlayOpen = overlay.kind !== 'none';

  return (
    <Screen>
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color={theme.c('primary')}>
          GeneratorAI
        </Text>
        <Text color={theme.c('muted')}>
          {connection?.deviceId ? `device ${connection.deviceId.slice(0, 8)}` : ''}
          {'  '}
          {theme.label}
        </Text>
      </Box>

      <Box paddingX={1}>
        <Tabs items={tabItems} activeId={workbench.activeTabId} />
      </Box>

      <Box flexGrow={1} overflow="hidden">
        {overlayOpen ? (
          <OverlayHost
            registry={registry}
            keymap={keymap}
            implemented={implementedActions}
            onRunCommand={(entry) => void runner.runFromPalette(entry)}
          />
        ) : (
          <PaneTree
            tab={tab}
            height={bodyHeight}
            showRight={rightPaneVisible}
            breakpoint={breakpoint}
          />
        )}
      </Box>

      {showComposer && content && !overlayOpen ? (
        <Box flexShrink={0}>
          <Composer
            history={history}
            onHeightChange={setComposerRows}
            maxMenuRows={maxMenuRows}
            // Must stand down when an overlay opens, or the palette's search
            // field and this one both receive every keystroke.
            isActive={overlay.kind === 'none'}
            onSubmit={(text) => {
              actions.pushHistory(text);
              void submitComposer(text);
            }}
            onRequestCompletions={requestCompletions}
            onOpenEditor={editPromptExternally}
            status={
              <Text color={theme.c('muted')} wrap="truncate-end">
                {String((content.state as { model?: string } | undefined)?.model ?? 'default model')}
              </Text>
            }
          />
        </Box>
      ) : null}

      <Toasts />

      <StatusBar left={left} right={right} />
      {rows > 24 ? (
        <Box paddingX={1}>
          <KeyHints
            // The hints must describe the focused surface. Showing "⏎ open"
            // over a chat, where Enter sends, teaches the wrong thing.
            hints={
              showComposer
                ? [
                    { keys: keymap.chordFor('app.palette'), label: 'palette' },
                    { keys: `${prettyChord(keymap.chordFor('pane.leader'))} c`, label: 'new tab' },
                    { keys: keymap.chordFor('app.back'), label: 'close chat' },
                    { keys: keymap.chordFor('app.quit'), label: 'quit' },
                  ]
                : [
                    { keys: keymap.chordFor('list.open'), label: 'open' },
                    { keys: keymap.chordFor('app.palette'), label: 'palette' },
                    { keys: `${prettyChord(keymap.chordFor('pane.leader'))} c`, label: 'new tab' },
                    { keys: '?', label: 'help' },
                  ]
            }
          />
        </Box>
      ) : null}
    </Screen>
  );
}

// ── Pane tree ─────────────────────────────────────────────────────

function PaneTree({
  tab,
  height,
  showRight,
  breakpoint,
}: {
  tab: Tab;
  height: number;
  showRight: boolean;
  breakpoint: string;
}): React.JSX.Element {
  // A zoomed pane fills the tab; that is the whole point of zoom, and
  // rendering the siblings underneath it would just cost a layout pass.
  if (tab.zoomedPaneId) {
    const zoomed = paneLeaves(tab.root).find((leaf) => leaf.id === tab.zoomedPaneId);
    if (zoomed) {
      return <Pane paneId={zoomed.id} content={zoomed.content} focused height={height} />;
    }
  }

  return renderNode(tab.root, tab.focusedPaneId, height, showRight, breakpoint);
}

function renderNode(
  node: PaneNode,
  focusedId: string,
  height: number,
  showRight: boolean,
  breakpoint: string,
): React.JSX.Element {
  if (node.type === 'leaf') {
    return (
      <Pane
        paneId={node.id}
        content={node.content}
        focused={node.id === focusedId}
        height={height}
      />
    );
  }

  // Below the standard breakpoint a split is not readable; collapse to the
  // focused side rather than showing two unusable ribbons.
  if (!showRight || breakpoint === 'tiny' || breakpoint === 'compact') {
    const containsFocus = (n: PaneNode): boolean =>
      n.type === 'leaf' ? n.id === focusedId : containsFocus(n.first) || containsFocus(n.second);
    const chosen = containsFocus(node.first) ? node.first : node.second;
    return renderNode(chosen, focusedId, height, showRight, breakpoint);
  }

  const half = node.direction === 'horizontal' ? Math.floor(height * node.ratio) : height;
  return (
    <Split
      direction={node.direction}
      ratio={node.ratio}
      first={renderNode(node.first, focusedId, half, showRight, breakpoint)}
      second={renderNode(
        node.second,
        focusedId,
        node.direction === 'horizontal' ? height - half : height,
        showRight,
        breakpoint,
      )}
    />
  );
}

// The store handle, read through the module's accessor so components and the
// non-React callers (stream reconciler, signal handlers) share one instance.
function getStoreApi() {
  return getStore();
}

export { CliError, commandPath, formatRelative, Panel };
