// ────────────────────────────────────────────────────────────────
// The workbench shell.
//
// Owns the frame (title bar, tabs, pane tree, composer, status bar), the
// global keymap, and the leader-key mode. Panes own their content; overlays
// replace the whole body when open.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import {
  CliError,
  commandPath,
  formatRelative,
  type Api,
  type CliContext,
  type CommandRegistry,
  type Keymap,
  type PaneContent,
  type PaneNode,
  type Tab,
} from '@generatorai/cli-core';
import { terminalThemeIds } from '@generatorai/design-tokens';
import {
  Composer,
  KeyHints,
  Panel,
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
  useTheme,
  type StatusSegment,
} from '@generatorai/tui-kit';
import { Pane } from './panes.js';
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
  type DataKey,
} from './store.js';
import { createCommandRunner, type CommandRunner } from './commandRunner.js';
import { openEntity, openerFor } from './open.js';

export interface AppProps {
  registry: CommandRegistry;
  keymap: Keymap;
  api: Api;
  makeContext: () => Promise<CliContext>;
  refreshMs: number;
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

export function App({ registry, keymap, api, makeContext, refreshMs }: AppProps): React.JSX.Element {
  const theme = useTheme();
  const actions = useActions();
  const { rows } = useTerminalSize();
  const breakpoint = useBreakpoint();

  const workbench = useTui((s) => s.workbench);
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
  const listRows = useTui((s) => {
    const key = content ? (dataKeysFor(content.kind)[0] as DataKey | undefined) : undefined;
    return key ? s.data[key] : NO_ROWS;
  });
  const selection = useSelection(listRows.length, 0);

  useEffect(() => {
    if (focusedPane) actions.setSelection(focusedPane.id, selection.index);
  }, [selection.index, focusedPane?.id]);

  const open = useCallback(
    (paneContent: PaneContent, mode?: 'tab' | 'split-v' | 'split-h' | 'replace') => {
      actions.openPane(paneContent, mode);
    },
    [actions],
  );

  const openSelected = useCallback(() => {
    if (!content) return;
    const row = listRows[selection.index];
    if (!row) return;
    const opener = openerFor(content.kind);
    if (!opener) return;
    void openEntity({ opener, row, api, open, actions });
  }, [content, listRows, selection.index, api, open, actions]);

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

  const { write } = useStdout();

  /**
   * Copies through OSC 52.
   *
   * Shelling out to `clip`/`pbcopy`/`xclip` would need a child process per
   * platform and still fail over SSH, which is exactly where a TUI is used.
   * The escape reaches whichever terminal the user is actually looking at.
   */
  const copyLastReply = useCallback(() => {
    const items = getStore().getState().timelines[focusedPane?.id ?? '']?.items ?? [];
    const last = [...items].reverse().find((item) => item.kind === 'assistant');
    if (!last?.text) {
      actions.toast('Nothing to copy yet.', 'warning');
      return;
    }
    write(`\u001B]52;c;${Buffer.from(last.text, 'utf8').toString('base64')}\u0007`);
    actions.toast('Copied the last reply.', 'success');
  }, [focusedPane?.id, actions, write]);

  /** Routes `/command` input to an action instead of sending it as a prompt. */
  const submitComposer = useCallback(
    async (text: string) => {
      const chatId = content?.entityId ?? '';
      if (!text.startsWith('/')) {
        await runner.run('chat.send', { chat: chatId, prompt: text });
        return;
      }

      const [command, ...rest] = text.slice(1).split(/\s+/);
      const argument = rest.join(' ').trim();

      switch (command) {
        case 'model':
          return pickModel(chatId, argument);
        case 'mode':
          return pickPermissionMode(chatId, argument);
        case 'agent':
          return pickAgent(chatId, argument);
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
        default:
          actions.toast(`Unknown command "/${command}".`, 'warning');
      }
    },
    [
      content?.entityId,
      runner,
      actions,
      focusedPane,
      keymap,
      pickModel,
      pickPermissionMode,
      pickAgent,
      copyLastReply,
    ],
  );

  // ── Pane-local state helpers ────────────────────────────────────

  /** Merges into `content.state`; `patchPane` replaces the whole object. */
  const patchState = useCallback(
    (patch: Record<string, unknown>) => {
      if (!focusedPane || !content) return;
      actions.patchPane(focusedPane.id, { state: { ...(content.state ?? {}), ...patch } });
    },
    [focusedPane, content, actions],
  );

  const scrollBack = Math.max(
    0,
    Number((content?.state as { scrollBack?: number } | undefined)?.scrollBack ?? 0),
  );

  const diffLineIndexes = useCallback(() => {
    const patch = String((content?.state as { patch?: string } | undefined)?.patch ?? '');
    const out: number[] = [];
    patch.split('\n').forEach((line, index) => {
      if (line.startsWith('@@')) out.push(index);
    });
    return out;
  }, [content?.state]);

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
      patchState({ patch: String((response as { patch?: string } | null)?.patch ?? ''), scrollTop: 0 });
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

  /** Pulls the PTY buffer into the pane; raw attach needs a plain shell. */
  const refreshTerminal = useCallback(
    async (terminalId: string) => {
      if (!content?.entityId) return;
      const buffer = await api.terminals
        .scrollback(content.entityId, terminalId)
        .catch(() => null);
      patchState({
        terminalId,
        scrollback: String((buffer as { data?: unknown } | null)?.data ?? buffer ?? ''),
      });
    },
    [content?.entityId, api, patchState],
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
      case 'terminal':
        return ['terminal', 'global'] as const;
      case 'browser':
        return ['browser', 'global'] as const;
      default:
        return ['list', 'global'] as const;
    }
  }, [leaderArmed, overlay.kind, content?.kind]);

  const keymapHandlers = useMemo(
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
        actions.closeActivePane();
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
      'goto.settings': () => open({ kind: 'settings', title: 'Settings' }, 'replace'),

      // Panes (leader)
      'pane.newTab': () => leaderThen(() => open({ kind: 'dashboard', title: 'Dashboard' }, 'tab')),
      'pane.nextTab': () => leaderThen(() => actions.nextTab()),
      'pane.prevTab': () => leaderThen(() => actions.prevTab()),
      'pane.splitVertical': () =>
        leaderThen(() => open(content ?? { kind: 'dashboard', title: 'Dashboard' }, 'split-v')),
      'pane.splitHorizontal': () =>
        leaderThen(() => open(content ?? { kind: 'dashboard', title: 'Dashboard' }, 'split-h')),
      'pane.focusLeft': () => leaderThen(() => actions.prevPane()),
      'pane.focusRight': () => leaderThen(() => actions.nextPane()),
      'pane.focusUp': () => leaderThen(() => actions.prevPane()),
      'pane.focusDown': () => leaderThen(() => actions.nextPane()),
      'pane.zoom': () => leaderThen(() => actions.zoom()),
      'pane.close': () => leaderThen(() => actions.closeActivePane()),
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
          if (focusedPane) {
            actions.patchPane(focusedPane.id, { attachment: undefined });
            actions.toast('Detached — the run keeps going on the server.', 'info');
          }
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
      'list.edit': () => openSelected(),
      'list.delete': () => {
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
      'chat.editor': () => actions.toast('Alt+E opens $EDITOR from the prompt.', 'info'),
      'chat.model': () => void pickModel(content?.entityId ?? '', ''),
      'chat.agent': () => void pickAgent(content?.entityId ?? '', ''),
      'chat.permission': () => void pickPermissionMode(content?.entityId ?? '', ''),
      'chat.stop': () => void runner.run('chat.cancel', { chat: content?.entityId ?? '' }),
      'chat.clear': () => focusedPane && actions.resetTimeline(focusedPane.id),
      'chat.toggleThinking': () => actions.toggleThinking(),
      'chat.scrollUp': () => patchState({ scrollBack: scrollBack + 5 }),
      'chat.scrollDown': () => patchState({ scrollBack: Math.max(0, scrollBack - 5) }),

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
      'diff.comment': () => {
        const state = (content?.state ?? {}) as { files?: Array<{ path?: string }> };
        const file = state.files?.[selection.index];
        if (!file?.path || !content?.entityId) {
          actions.toast('Select a file first.', 'warning');
          return;
        }
        actions.showOverlay({
          kind: 'input',
          message: `Comment on ${file.path}`,
          initial: '',
          onSubmit: (body) => {
            if (body.trim()) {
              void runner.run('review.create', {
                workspace: content.entityId ?? '',
                path: file.path ?? '',
                body: body.trim(),
              });
            }
          },
        });
      },
      'diff.resolve': () => void resolveThread(),
      'diff.openTerminal': () => openTerminalPane(),
      'diff.openBrowser': () => openBrowserPane(),

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
        // Reading the buffer rather than taking over stdin: Ink owns the
        // keyboard here, and a raw attach needs the plain binary surface.
        void refreshTerminal(id);
      },
      'terminal.kill': () => {
        const id = String((content?.state as { terminalId?: string } | undefined)?.terminalId ?? '');
        if (!id) return;
        void runner
          .run('terminal.kill', { workspace: content?.entityId ?? '', terminal: id })
          .then(() => patchState({ terminalId: undefined, scrollback: undefined }));
      },

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
      'browser.screenshot': () =>
        actions.showOverlay({
          kind: 'input',
          message: 'Write the PNG where?',
          initial: `screenshot-${Date.now()}.png`,
          onSubmit: (out) =>
            void runner.run(
              'browser.screenshot',
              { workspace: content?.entityId ?? '' },
              { out: out.trim() },
            ),
        }),
      'browser.status': () =>
        void runner.run('browser.status', { workspace: content?.entityId ?? '' }).then((status) => {
          const descriptor = status as { url?: string; title?: string } | undefined;
          if (descriptor) patchState(descriptor as Record<string, unknown>);
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
    // and `overlay`, and `useKeymap` reads them through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, api, runner, content, listRows, selection, overlay.kind, neededKeys],
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
  const tabItems = workbench.tabs.map((t) => ({
    id: t.id,
    label: t.title,
    ...(paneLeaves(t.root).some((l) => l.content.attachment) ? { tone: 'running' as const } : {}),
  }));

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
