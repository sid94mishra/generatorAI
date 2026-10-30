// ────────────────────────────────────────────────────────────────
// The keymap, declared as data.
//
// Bindings live here rather than inside the components that consume them so
// that the help overlay, the palette's shortcut hints, the docs and the
// user's remapping all read one table. A binding invented inside a component
// is invisible to all four.
// ────────────────────────────────────────────────────────────────

import { CliError } from '../errors/CliError.js';

/**
 * Where a binding applies. Contexts are checked innermost-first, so a list
 * binding shadows a global one while a list has focus.
 */
export type KeyContext =
  | 'global'
  | 'leader'
  | 'list'
  | 'chat'
  | 'composer'
  | 'run'
  | 'diff'
  /** Workflow DEFINITION authoring (Phase 7 items 4/5/6) — distinct from `run`, which watches an execution. */
  | 'workflow'
  /**
   * A registry-command-backed administration view (Phase 8 item 5). Resolved
   * BEFORE `list`, not instead of it — a command pane is a list pane with two
   * extra verbs, so it inherits `list`'s navigation, filter, help and search
   * rather than redeclaring six bindings that would then have to be kept in
   * step with them.
   */
  | 'command'
  | 'terminal'
  | 'browser'
  /** Computer-use consent, grants and audit (Phase 8 items 1/3). */
  | 'computer'
  /**
   * The workspace file browser (Phase 7 item 1). Resolved BEFORE `list`,
   * which stays its fallback — `e` meaning "open $EDITOR" and `d` meaning
   * "download" were already a stretch on the generic Edit/Delete labels, and
   * upload and fold have no plausible `list` equivalent at all.
   */
  | 'workspace'
  | 'automation'
  | 'form'
  | 'overlay';

export interface KeyBinding {
  /** Stable id, also the remapping key in config. */
  id: string;
  context: KeyContext;
  /** Canonical chord, e.g. `ctrl+k`, `shift+enter`, `g d`, `?`. */
  keys: string;
  /** Alternates that do the same thing (vim-style `j`/`down`). */
  alternates?: string[];
  description: string;
  /** Shown in the help overlay under this heading. */
  category: string;
  /** Hidden from help but still bound. */
  hidden?: boolean;
  /** Requires the terminal to report distinct modifier keys. */
  requiresKittyKeyboard?: boolean;
}

/** Arms independently of context shadowing (see `Keymap.checkLeaderConflicts`) — must never share a chord with anything else. */
const LEADER_BINDING_ID = 'pane.leader';

export const DEFAULT_KEYMAP: KeyBinding[] = [
  // ── Global ────────────────────────────────────────────────────
  { id: 'app.palette', context: 'global', keys: 'ctrl+k', alternates: ['ctrl+p'], description: 'Command palette', category: 'Global' },
  // `?` and `/` are printable, so a keymap that saw them unconditionally
  // would swallow a question typed into the chat composer. `useKeymap` now
  // makes that impossible on its own: while a text field owns the keyboard
  // it drops every printable chord before lookup, and while an overlay is up
  // the resolver is handed `['overlay']` alone.
  //
  // So `app.help` is global — bound to `list` it was unreachable on a run,
  // diff, workflow, automation or browser pane, every one of which shows a
  // "? help" hint in the status bar and did nothing when you pressed it.
  // `app.search` stays on `list`: only a list pane reads `search[paneId]`,
  // so a global `/` would open a filter box that filters nothing.
  { id: 'app.help', context: 'global', keys: '?', description: 'Toggle help', category: 'Global' },
  { id: 'app.quit', context: 'global', keys: 'ctrl+c', description: 'Quit', category: 'Global' },
  { id: 'app.refresh', context: 'global', keys: 'ctrl+r', description: 'Refresh current view', category: 'Global' },
  { id: 'app.search', context: 'list', keys: '/', description: 'Search in view', category: 'Global' },
  { id: 'app.back', context: 'global', keys: 'escape', description: 'Back / close overlay', category: 'Global' },
  { id: 'app.focusNext', context: 'global', keys: 'tab', description: 'Focus next region', category: 'Global' },
  { id: 'app.focusPrev', context: 'global', keys: 'shift+tab', description: 'Focus previous region', category: 'Global' },
  { id: 'app.toggleRightPane', context: 'global', keys: 'ctrl+g', description: 'Toggle right pane', category: 'Global' },
  { id: 'app.theme', context: 'global', keys: 'ctrl+t', description: 'Cycle theme', category: 'Global' },

  // ── Go-to (two-key sequences) ─────────────────────────────────
  { id: 'goto.dashboard', context: 'global', keys: 'g d', description: 'Dashboard', category: 'Navigate' },
  { id: 'goto.chats', context: 'global', keys: 'g c', description: 'Chats', category: 'Navigate' },
  { id: 'goto.workflows', context: 'global', keys: 'g w', description: 'Workflows', category: 'Navigate' },
  { id: 'goto.runs', context: 'global', keys: 'g r', description: 'Runs', category: 'Navigate' },
  { id: 'goto.automations', context: 'global', keys: 'g a', description: 'Automations', category: 'Navigate' },
  { id: 'goto.projects', context: 'global', keys: 'g p', description: 'Projects', category: 'Navigate' },
  { id: 'goto.workspaces', context: 'global', keys: 'g o', description: 'Workspaces', category: 'Navigate' },
  { id: 'goto.agents', context: 'global', keys: 'g e', description: 'Agents', category: 'Navigate' },
  { id: 'goto.scripts', context: 'global', keys: 'g s', description: 'Scripts', category: 'Navigate' },
  { id: 'goto.extensions', context: 'global', keys: 'g x', description: 'Extensions', category: 'Navigate' },
  { id: 'goto.settings', context: 'global', keys: 'g ,', description: 'Settings', category: 'Navigate' },
  // Phase 8 item 5 — one entry point to every administration surface
  // (extensions, agents, skills, prompts, MCP, hooks, webhooks, providers,
  // connections, devices, security, diagnostics). A `goto.*` binding each
  // would need twelve free letters in a sequence space that has five left.
  { id: 'goto.admin', context: 'global', keys: 'g m', description: 'Administration views…', category: 'Navigate' },

  // ── Leader (tmux grammar, so muscle memory transfers) ─────────
  // The prefix itself is a global binding: without it nothing can switch the
  // resolver into the `leader` context and the whole grammar is unreachable.
  // Not `ctrl+b`: that's both tmux's own default prefix (collides for
  // anyone running this inside a real tmux pane) AND, in this exact
  // keymap, `composer.charLeft` — since the leader arms independently of
  // context shadowing (see `checkLeaderConflicts`), that collision meant
  // pressing it while composing moved the cursor AND armed the leader at
  // once, not one or the other. `alt+l` ("L" for Leader) isn't bound to
  // anything else here and shares a chord family (`alt+`) already proven
  // to parse correctly elsewhere in this keymap (`alt+a/b/d/e/f/r`).
  { id: 'pane.leader', context: 'global', keys: 'alt+l', description: 'Leader prefix (panes & tabs)', category: 'Panes' },
  { id: 'pane.newTab', context: 'leader', keys: 'c', description: 'New tab', category: 'Panes' },
  { id: 'pane.nextTab', context: 'leader', keys: 'n', description: 'Next tab', category: 'Panes' },
  { id: 'pane.prevTab', context: 'leader', keys: 'p', description: 'Previous tab', category: 'Panes' },
  { id: 'pane.splitVertical', context: 'leader', keys: '%', description: 'Split vertically', category: 'Panes' },
  { id: 'pane.splitHorizontal', context: 'leader', keys: '"', description: 'Split horizontally', category: 'Panes' },
  { id: 'pane.focusLeft', context: 'leader', keys: 'left', alternates: ['h'], description: 'Focus pane left', category: 'Panes' },
  { id: 'pane.focusRight', context: 'leader', keys: 'right', alternates: ['l'], description: 'Focus pane right', category: 'Panes' },
  { id: 'pane.focusUp', context: 'leader', keys: 'up', alternates: ['k'], description: 'Focus pane up', category: 'Panes' },
  { id: 'pane.focusDown', context: 'leader', keys: 'down', alternates: ['j'], description: 'Focus pane down', category: 'Panes' },
  { id: 'pane.zoom', context: 'leader', keys: 'z', description: 'Zoom / unzoom pane', category: 'Panes' },
  { id: 'pane.close', context: 'leader', keys: 'x', description: 'Close pane', category: 'Panes' },
  { id: 'pane.rename', context: 'leader', keys: ',', description: 'Rename tab', category: 'Panes' },
  { id: 'pane.detach', context: 'leader', keys: 'd', description: 'Detach stream (run keeps going)', category: 'Panes' },
  { id: 'pane.scrollMode', context: 'leader', keys: '[', description: 'Scrollback mode', category: 'Panes' },
  { id: 'pane.help', context: 'leader', keys: '?', description: 'Leader key help', category: 'Panes' },
  // Not `+`/`-`: `normalise()` treats a literal hyphen as the `ctrl-k`-style
  // modifier separator (`.replace(/-/g, '+')` before splitting), so a bare
  // `-` chord collapses to the same empty key as a bare `+` — the two would
  // silently collide with EACH OTHER, not just look confusingly similar.
  // Bare ASCII rather than shift+arrow either way: this app's `shift+return`
  // binding already needs `requiresKittyKeyboard: true` to distinguish
  // reliably, and resize should work in every terminal, not just
  // kitty-protocol ones.
  { id: 'pane.growSplit', context: 'leader', keys: '}', description: 'Grow focused pane', category: 'Panes' },
  { id: 'pane.shrinkSplit', context: 'leader', keys: '{', description: 'Shrink focused pane', category: 'Panes' },
  // `<`/`>` (shift+comma/period): a common convention for "move this thing
  // left/right" (browser tab reorder extensions, tmux-adjacent tools).
  { id: 'pane.moveTabLeft', context: 'leader', keys: '<', description: 'Move tab left', category: 'Panes' },
  { id: 'pane.moveTabRight', context: 'leader', keys: '>', description: 'Move tab right', category: 'Panes' },
  { id: 'pane.tabNavigator', context: 'leader', keys: 't', description: 'Jump to tab…', category: 'Panes' },
  // Not `l`: already `pane.focusRight`'s alternate. Backtick is tmux's own
  // spelling for a couple of alternate prefix bindings and is otherwise
  // free in this table.
  { id: 'pane.lastTab', context: 'leader', keys: '`', description: 'Toggle last tab', category: 'Panes' },
  // Phase 6 item 5 — global blocked-work/notification queue. No design
  // precedent existed anywhere in this codebase (or `apps/web`) for one; this
  // deliberately mirrors `pane.tabNavigator` (same overlay shape: a filtered
  // list, Enter jumps) rather than inventing a new interaction pattern for
  // "find the thing that needs me" versus "find the thing I'm looking for."
  // `b` ("blocked") is free in this table.
  { id: 'pane.notifications', context: 'leader', keys: 'b', description: 'Blocked work / notifications…', category: 'Panes' },
  // Open question #6 — client-side stream health (queue depth, applied vs
  // received, reconnects) had nowhere to surface. `system doctor` is a
  // SERVER command and cannot see any of it, so this is its own pane:
  // "why does this feel slow / stale" is a question about the client.
  { id: 'pane.diagnostics', context: 'leader', keys: 'i', description: 'Client diagnostics (stream health)', category: 'Panes' },

  // ── Lists ─────────────────────────────────────────────────────
  { id: 'list.down', context: 'list', keys: 'down', alternates: ['j'], description: 'Move down', category: 'List' },
  { id: 'list.up', context: 'list', keys: 'up', alternates: ['k'], description: 'Move up', category: 'List' },
  { id: 'list.pageDown', context: 'list', keys: 'pagedown', alternates: ['ctrl+f'], description: 'Page down', category: 'List' },
  // No `ctrl+b` alternate: that chord is the leader prefix, and binding it
  // here made every leader press also scroll the list.
  { id: 'list.pageUp', context: 'list', keys: 'pageup', description: 'Page up', category: 'List' },
  { id: 'list.top', context: 'list', keys: 'home', alternates: ['g g'], description: 'First item', category: 'List' },
  { id: 'list.bottom', context: 'list', keys: 'end', alternates: ['G'], description: 'Last item', category: 'List' },
  { id: 'list.open', context: 'list', keys: 'return', description: 'Open', category: 'List' },
  { id: 'list.new', context: 'list', keys: 'n', description: 'New', category: 'List' },
  { id: 'list.edit', context: 'list', keys: 'e', description: 'Edit', category: 'List' },
  { id: 'list.delete', context: 'list', keys: 'd', description: 'Delete', category: 'List' },
  { id: 'list.select', context: 'list', keys: 'space', description: 'Toggle selection', category: 'List' },
  { id: 'list.filter', context: 'list', keys: 'f', description: 'Filter', category: 'List' },
  { id: 'list.sort', context: 'list', keys: 's', description: 'Sort', category: 'List' },
  { id: 'list.yankId', context: 'list', keys: 'y', description: 'Copy id', category: 'List' },

  // ── Workspace file browser (Phase 7 item 1, open questions #24/#26) ──
  //
  // Its own context rather than more overloaded `list` bindings: `e` meaning
  // "open $EDITOR" and `d` meaning "download" were already a stretch on the
  // generic Edit/Delete labels, and upload and tree-collapse have no
  // plausible `list` equivalent at all. `list` stays as the fallback so
  // navigation, filter, help and search are inherited rather than restated.
  { id: 'workspace.edit', context: 'workspace', keys: 'e', description: 'Edit in $EDITOR', category: 'Workspace' },
  { id: 'workspace.download', context: 'workspace', keys: 'd', description: 'Download to a local path', category: 'Workspace' },
  { id: 'workspace.upload', context: 'workspace', keys: 'u', description: 'Upload a local file here', category: 'Workspace' },
  { id: 'workspace.toggleTree', context: 'workspace', keys: 't', description: 'Tree / flat list', category: 'Workspace' },
  { id: 'workspace.collapse', context: 'workspace', keys: 'left', alternates: ['h'], description: 'Collapse directory', category: 'Workspace' },
  { id: 'workspace.expand', context: 'workspace', keys: 'right', alternates: ['l'], description: 'Expand directory', category: 'Workspace' },
  { id: 'workspace.refresh', context: 'workspace', keys: 'R', description: 'Re-read the workspace', category: 'Workspace' },

  // ── Chat ──────────────────────────────────────────────────────
  { id: 'chat.send', context: 'composer', keys: 'return', description: 'Send', category: 'Chat' },
  { id: 'chat.newline', context: 'composer', keys: 'shift+return', description: 'New line', category: 'Chat', requiresKittyKeyboard: true },
  // Alt rather than Ctrl for the four composer commands below: every free
  // Ctrl letter is already an emacs motion, and shadowing one of those is how
  // a prompt stops feeling like a prompt.
  { id: 'chat.editor', context: 'composer', keys: 'alt+e', description: 'Compose in $EDITOR', category: 'Chat' },
  { id: 'chat.model', context: 'composer', keys: 'ctrl+o', description: 'Change model', category: 'Chat' },
  { id: 'chat.agent', context: 'composer', keys: 'alt+a', description: 'Change agent', category: 'Chat' },
  { id: 'chat.permission', context: 'composer', keys: 'ctrl+p', description: 'Cycle permission mode', category: 'Chat' },
  { id: 'chat.stop', context: 'chat', keys: 'ctrl+x', description: 'Stop generating', category: 'Chat' },
  { id: 'chat.clear', context: 'chat', keys: 'ctrl+l', description: 'Clear view', category: 'Chat' },
  { id: 'chat.historyPrev', context: 'composer', keys: 'up', description: 'Previous prompt', category: 'Chat' },
  { id: 'chat.historyNext', context: 'composer', keys: 'down', description: 'Next prompt', category: 'Chat' },
  { id: 'chat.mention', context: 'composer', keys: '@', description: 'Mention agent / file / codebase', category: 'Chat' },
  { id: 'chat.slash', context: 'composer', keys: '/', description: 'Slash command', category: 'Chat' },
  { id: 'chat.toggleThinking', context: 'chat', keys: 'alt+r', description: 'Toggle reasoning blocks', category: 'Chat' },
  // Phase 6 item 3 — answers whichever chat-scoped HITL gate is pending
  // (a plan review or a clarifying question — `AgentInteractionService`,
  // distinct from a workflow stage's `run.approve`/`run.reject`). A
  // modifier chord, matching why `chat.stop`/`chat.clear`/`chat.toggleThinking`
  // are already modifier-based: a bare key would never reach this context,
  // since `composer` (nested inside it) swallows printable characters as
  // typed text.
  { id: 'chat.respond', context: 'chat', keys: 'alt+g', description: 'Answer pending question / plan review', category: 'Chat' },
  // Named keys, so they still reach the keymap while the composer has focus.
  { id: 'chat.scrollUp', context: 'chat', keys: 'pageup', description: 'Scroll transcript back', category: 'Chat' },
  { id: 'chat.scrollDown', context: 'chat', keys: 'pagedown', description: 'Scroll transcript forward', category: 'Chat' },
  // Phase 4 item 7 — real search WITHIN the transcript (jumps scroll
  // position to a match), distinct from `app.search`'s row-FILTER
  // behavior for list panes. Not `/`: `chat` nests under `composer` while
  // a chat pane is focused, and any bare/printable chord in that context
  // would never fire anyway — `textInputActive` skips it so it can be
  // typed as message text instead (see `useKeymap`'s own text-input
  // guard). `alt+s` (mnemonic: Search) isn't bound to anything in
  // `composer`, `chat`, or `global`.
  { id: 'chat.search', context: 'chat', keys: 'alt+s', description: 'Search transcript', category: 'Chat' },

  // ── Composer editing ──────────────────────────────────────────
  //
  // Declared here for the help sheet and for remapping, but executed inside
  // the Composer itself: an edit has to read the caret position that the
  // previous keystroke wrote, and a keymap dispatch only sees render-old
  // state. Typing faster than React re-renders would otherwise scramble the
  // line.
  { id: 'composer.lineStart', context: 'composer', keys: 'ctrl+a', description: 'Start of line', category: 'Composer' },
  { id: 'composer.lineEnd', context: 'composer', keys: 'ctrl+e', description: 'End of line', category: 'Composer' },
  { id: 'composer.charLeft', context: 'composer', keys: 'ctrl+b', description: 'Back one character', category: 'Composer' },
  { id: 'composer.charRight', context: 'composer', keys: 'ctrl+f', description: 'Forward one character', category: 'Composer' },
  { id: 'composer.wordLeft', context: 'composer', keys: 'alt+b', description: 'Back one word', category: 'Composer' },
  { id: 'composer.wordRight', context: 'composer', keys: 'alt+f', description: 'Forward one word', category: 'Composer' },
  { id: 'composer.killLine', context: 'composer', keys: 'ctrl+k', description: 'Kill to end of line', category: 'Composer' },
  { id: 'composer.killToStart', context: 'composer', keys: 'ctrl+u', description: 'Kill to start of line', category: 'Composer' },
  { id: 'composer.killWordBack', context: 'composer', keys: 'ctrl+w', description: 'Kill word before caret', category: 'Composer' },
  { id: 'composer.killWordForward', context: 'composer', keys: 'alt+d', description: 'Kill word after caret', category: 'Composer' },
  { id: 'composer.yank', context: 'composer', keys: 'ctrl+y', description: 'Paste last kill', category: 'Composer' },
  { id: 'composer.deleteForward', context: 'composer', keys: 'ctrl+d', description: 'Delete character ahead', category: 'Composer' },
  { id: 'composer.newline', context: 'composer', keys: 'ctrl+j', description: 'New line (works everywhere)', category: 'Composer' },
  { id: 'composer.undo', context: 'composer', keys: 'ctrl+_', description: 'Undo edit', category: 'Composer' },

  // ── Runs ──────────────────────────────────────────────────────
  { id: 'run.pause', context: 'run', keys: 'p', description: 'Pause run', category: 'Run' },
  { id: 'run.resume', context: 'run', keys: 'r', description: 'Resume run', category: 'Run' },
  { id: 'run.cancel', context: 'run', keys: 'c', description: 'Cancel run', category: 'Run' },
  { id: 'run.retry', context: 'run', keys: 'R', description: 'Retry run', category: 'Run' },
  { id: 'run.approve', context: 'run', keys: 'a', description: 'Approve pending gate', category: 'Run' },
  { id: 'run.reject', context: 'run', keys: 'x', description: 'Reject pending gate', category: 'Run' },
  { id: 'run.stageDetail', context: 'run', keys: 's', description: 'Stage detail', category: 'Run' },
  { id: 'run.verbosity', context: 'run', keys: 'v', description: 'Cycle log verbosity', category: 'Run' },

  // ── Command-backed administration view (Phase 8 item 5) ────────
  { id: 'command.inspect', context: 'command', keys: 'return', description: 'Inspect the selected row', category: 'Admin' },
  { id: 'command.rerun', context: 'command', keys: 'R', description: 'Re-run the view\'s command', category: 'Admin' },
  { id: 'command.switch', context: 'command', keys: 'v', description: 'Switch to another administration view', category: 'Admin' },

  // ── Workflow authoring (Phase 7 items 4/5/6) ───────────────────
  //
  // The workflow pane was read-only: it painted the DAG and nothing else,
  // with no cursor, so none of the real `workflow stage`/`workflow edge`
  // commands had any terminal-native surface. Every action here runs the
  // same registry command the binary does, through the schema-driven form
  // (`toForm.ts`) rather than a bespoke dialog per command.
  { id: 'workflow.nextStage', context: 'workflow', keys: 'ctrl+n', alternates: [']', 'j'], description: 'Next stage', category: 'Workflow' },
  { id: 'workflow.prevStage', context: 'workflow', keys: 'ctrl+p', alternates: ['[', 'k'], description: 'Previous stage', category: 'Workflow' },
  { id: 'workflow.addStage', context: 'workflow', keys: 'n', description: 'Add a stage', category: 'Workflow' },
  { id: 'workflow.editStage', context: 'workflow', keys: 'e', description: 'Edit the selected stage', category: 'Workflow' },
  { id: 'workflow.deleteStage', context: 'workflow', keys: 'd', description: 'Delete the selected stage', category: 'Workflow' },
  // Shifted letters for the edge pair: an edge is the rarer operation and
  // shares its mnemonic with the stage it connects.
  { id: 'workflow.addEdge', context: 'workflow', keys: 'E', description: 'Connect this stage to another', category: 'Workflow' },
  { id: 'workflow.deleteEdge', context: 'workflow', keys: 'D', description: 'Delete an edge on this stage', category: 'Workflow' },
  { id: 'workflow.variables', context: 'workflow', keys: 'v', description: "Show the workflow's input variables", category: 'Workflow' },
  { id: 'workflow.hooks', context: 'workflow', keys: 'h', description: "Manage the stage's hooks", category: 'Workflow' },
  { id: 'workflow.validate', context: 'workflow', keys: 'V', description: 'Validate — jump from a finding to its stage', category: 'Workflow' },
  { id: 'workflow.run', context: 'workflow', keys: 'r', description: 'Start a run of this workflow', category: 'Workflow' },
  { id: 'workflow.reload', context: 'workflow', keys: 'R', description: 'Reload the definition', category: 'Workflow' },

  // ── Diff ──────────────────────────────────────────────────────
  { id: 'diff.nextFile', context: 'diff', keys: 'ctrl+n', alternates: [']'], description: 'Next file', category: 'Diff' },
  { id: 'diff.prevFile', context: 'diff', keys: 'ctrl+p', alternates: ['['], description: 'Previous file', category: 'Diff' },
  { id: 'diff.nextHunk', context: 'diff', keys: 'n', description: 'Next hunk', category: 'Diff' },
  { id: 'diff.prevHunk', context: 'diff', keys: 'N', description: 'Previous hunk', category: 'Diff' },
  // Open question #21 — a real line cursor, so `diff.comment` reads the line
  // it is pointing at instead of asking the user to type a number while
  // looking at a diff that already shows line numbers.
  { id: 'diff.nextLine', context: 'diff', keys: 'down', alternates: ['j'], description: 'Next line', category: 'Diff' },
  { id: 'diff.prevLine', context: 'diff', keys: 'up', alternates: ['k'], description: 'Previous line', category: 'Diff' },
  { id: 'diff.toggleLayout', context: 'diff', keys: 'w', description: 'Unified / side-by-side', category: 'Diff' },
  { id: 'diff.comment', context: 'diff', keys: 'c', description: 'Comment on line', category: 'Diff' },
  { id: 'diff.resolve', context: 'diff', keys: 'o', description: 'Resolve thread', category: 'Diff' },
  // The only route to the terminal and browser surfaces: both are scoped to a
  // workspace, and the changes pane is where a workspace is already open.
  { id: 'diff.openTerminal', context: 'diff', keys: 't', description: 'Terminal for this workspace', category: 'Diff' },
  { id: 'diff.openBrowser', context: 'diff', keys: 'b', description: 'Browser for this workspace', category: 'Diff' },
  // Phase 7 item 2 — the SCM half of the changes workbench. Every one of
  // these commands (`workspace checkpoints`/`restore`/`commit`/`pr`,
  // `review list`/`reply`/`submit`) was already real and tested on the
  // binary surface with nothing bound to it here: a user could see a diff
  // in the TUI but had to leave it to checkpoint, commit or open a PR.
  { id: 'diff.checkpoints', context: 'diff', keys: 'p', description: 'Checkpoints — restore one', category: 'Diff' },
  { id: 'diff.commit', context: 'diff', keys: 'C', description: 'Commit the worktrees', category: 'Diff' },
  { id: 'diff.pullRequest', context: 'diff', keys: 'P', description: 'Pull requests — list or open one', category: 'Diff' },
  { id: 'diff.threads', context: 'diff', keys: 'T', description: 'Review threads — read and reply', category: 'Diff' },
  { id: 'diff.submitReview', context: 'diff', keys: 'S', description: 'Hand the open threads to the agent', category: 'Diff' },
  { id: 'diff.refresh', context: 'diff', keys: 'R', description: 'Re-fetch the changed-file list', category: 'Diff' },

  // ── Terminal ──────────────────────────────────────────────────
  // Phase 5 items 1/2: this is now a real raw takeover (Ink hands the
  // terminal to `useTerminalSuspension` + `attachToTerminal`), not the
  // scrollback-refresh stub it used to be — description updated to match.
  { id: 'terminal.attach', context: 'terminal', keys: 'return', description: 'Attach (raw takeover, Ctrl+] detaches)', category: 'Terminal' },
  { id: 'terminal.new', context: 'terminal', keys: 'n', description: 'New terminal', category: 'Terminal' },
  { id: 'terminal.kill', context: 'terminal', keys: 'd', description: 'Kill terminal', category: 'Terminal' },
  // Phase 5 item 6 — session chooser: `terminal.list`'s REST endpoint and
  // the wire types were already real; no client anywhere (web, mobile, or
  // here) had ever put a picker UI in front of it.
  { id: 'terminal.list', context: 'terminal', keys: 'l', description: 'List / switch terminal', category: 'Terminal' },
  // Open questions #10/#11 — a terminal pane had no scroll offset at all, so
  // search had nowhere to jump a match TO and copy had no defined region.
  // The headless emulator keeps a real scrollback buffer now.
  { id: 'terminal.scrollUp', context: 'terminal', keys: 'pageup', description: 'Scroll back', category: 'Terminal' },
  { id: 'terminal.scrollDown', context: 'terminal', keys: 'pagedown', description: 'Scroll forward', category: 'Terminal' },
  { id: 'terminal.follow', context: 'terminal', keys: 'end', description: 'Jump to the live tail', category: 'Terminal' },
  { id: 'terminal.search', context: 'terminal', keys: 'alt+s', description: 'Search scrollback', category: 'Terminal' },
  // Not a selection model — "copy what is on screen" is the operation a
  // terminal pane actually needs, and OSC 52 reaches the terminal the user
  // is looking at even over SSH, where a clipboard binary would not.
  { id: 'terminal.yank', context: 'terminal', keys: 'y', description: 'Copy the visible screen', category: 'Terminal' },
  // Phase 4 item 7 — deliberately NOT added here: unlike a chat pane
  // (which already has a numeric `scrollBack` window to jump), a terminal
  // pane has no scroll-offset concept at all — `TerminalPane` (now backed
  // by a real headless-terminal render, Phase 5 item 3) still only ever
  // shows the tail of the buffer, full stop. "Search scrollback" would
  // have nowhere to jump a match TO without first building a real
  // scroll-offset mechanism for terminal panes, which is its own,
  // separate piece of work — see the tracker.

  // ── Automation (Phase 6 item 6) ─────────────────────────────────
  // The automation pane used to be a static JSON dump with no live
  // stream and no way to reach the workflow runs an execution actually
  // spawned — this is the first user-reachable path to either.
  { id: 'automation.nextExecution', context: 'automation', keys: 'ctrl+n', alternates: [']'], description: 'Next execution', category: 'Automation' },
  { id: 'automation.prevExecution', context: 'automation', keys: 'ctrl+p', alternates: ['['], description: 'Previous execution', category: 'Automation' },
  { id: 'automation.openRun', context: 'automation', keys: 'return', description: 'Open the selected execution\'s run', category: 'Automation' },
  { id: 'automation.cancelExecution', context: 'automation', keys: 'c', description: 'Cancel the selected execution', category: 'Automation' },

  // ── Browser ───────────────────────────────────────────────────
  { id: 'browser.navigate', context: 'browser', keys: 'o', description: 'Open URL', category: 'Browser' },
  { id: 'browser.back', context: 'browser', keys: 'H', description: 'Back', category: 'Browser' },
  { id: 'browser.forward', context: 'browser', keys: 'L', description: 'Forward', category: 'Browser' },
  { id: 'browser.reload', context: 'browser', keys: 'r', description: 'Reload', category: 'Browser' },
  { id: 'browser.screenshot', context: 'browser', keys: 's', description: 'Screenshot', category: 'Browser' },
  { id: 'browser.status', context: 'browser', keys: 'i', description: 'Session info', category: 'Browser' },
  // Phase 4 item 6 — there was previously no user-reachable way to
  // terminate a browser session from the TUI at all (the real
  // `browser.stop` command existed server-side with nothing bound to it).
  { id: 'browser.stop', context: 'browser', keys: 'k', description: 'Stop browser session', category: 'Browser' },
  // Phase 8 item 1 — the SEMANTIC view, ahead of any image. A terminal reads
  // the accessibility tree far better than it renders a screenshot, and
  // `BrowserService.readPage()` had no HTTP route at all before this phase,
  // so no client could ask for it.
  { id: 'browser.inspect', context: 'browser', keys: 'a', description: 'Read the page (accessibility tree)', category: 'Browser' },
  { id: 'browser.computer', context: 'browser', keys: 'c', description: 'Computer-use consent, grants and activity', category: 'Browser' },

  // ── Computer use (Phase 8 items 1/3) ───────────────────────────
  { id: 'computer.refresh', context: 'computer', keys: 'r', description: 'Refresh runtime, consent and activity', category: 'Computer' },
  { id: 'computer.answer', context: 'computer', keys: 'a', description: 'Answer the selected consent prompt', category: 'Computer' },
  { id: 'computer.revoke', context: 'computer', keys: 'x', description: 'Revoke the selected standing grant', category: 'Computer' },
  { id: 'computer.runtime', context: 'computer', keys: 'R', description: 'Start / restart / stop the driver', category: 'Computer' },
  // Not `tab`: that is `app.focusNext` in `global`, and a context binding on
  // the same chord shadows it — taking pane cycling away inside this one
  // pane, which reads as the key having broken.
  { id: 'computer.nextSection', context: 'computer', keys: 's', description: 'Next section (prompts / grants / activity)', category: 'Computer' },
];

export interface ResolvedBinding extends KeyBinding {
  /** True when the user remapped this in config. */
  customised: boolean;
}

export class Keymap {
  private readonly byId = new Map<string, ResolvedBinding>();
  /** `context\0chord` → binding id. */
  private readonly byChord = new Map<string, string>();

  constructor(overrides: Record<string, string> = {}, bindings: KeyBinding[] = DEFAULT_KEYMAP) {
    for (const binding of bindings) {
      const override = overrides[binding.id];
      const resolved: ResolvedBinding = override
        ? { ...binding, keys: normalise(override), alternates: [], customised: true }
        : { ...binding, keys: normalise(binding.keys), customised: false };
      this.byId.set(binding.id, resolved);
    }

    // Unknown ids in the override map are almost always typos, and a typo
    // that silently does nothing is worse than one that says so.
    const unknown = Object.keys(overrides).filter((id) => !this.byId.has(id));
    if (unknown.length) {
      throw new CliError('VALIDATION', `Unknown keymap binding id(s): ${unknown.join(', ')}`, {
        hint: 'Run `generatorai config keymap list` to see valid ids.',
      });
    }

    this.index();
  }

  private index(): void {
    this.byChord.clear();
    const conflicts: string[] = [];
    for (const binding of this.byId.values()) {
      for (const chord of [binding.keys, ...(binding.alternates ?? []).map(normalise)]) {
        const key = `${binding.context}\0${chord}`;
        const existing = this.byChord.get(key);
        if (existing && existing !== binding.id) {
          conflicts.push(`${chord} in ${binding.context}: ${existing} vs ${binding.id}`);
          continue;
        }
        this.byChord.set(key, binding.id);
      }
    }
    if (conflicts.length) {
      throw new CliError('VALIDATION', `Conflicting key bindings:\n  ${conflicts.join('\n  ')}`, {
        hint: 'Remap one of them under `keymap` in your config.',
      });
    }

    // The leader is armed by its OWN independent `useKeymap(['global'], ...)`
    // registration (App.tsx), which — unlike normal `lookup()` dispatch —
    // does not go through per-context innermost-first shadowing: it fires
    // whenever its chord is pressed, in parallel with whatever ELSE also
    // handles that same raw keypress in the currently-active context (Ink
    // does not stop propagation between independent `useInput` hooks). A
    // context binding that happens to reuse the leader's chord therefore
    // doesn't "correctly shadow" it the way normal per-context bindings
    // shadow each other — both fire. This bit GeneratorAI directly: the
    // shipped default leader (`ctrl+b`) collided with `composer.charLeft`,
    // so pressing it while composing moved the cursor AND armed the leader
    // at once. Every other context/global overlap in this file (`ctrl+k`
    // as both `app.palette` and `composer.killLine`, etc.) is fine — that's
    // ordinary, intentional shadowing through `lookup()`. Only the leader's
    // OWN chord needs this narrower, unconditional check.
    this.checkLeaderConflicts();
  }

  private checkLeaderConflicts(): void {
    const leader = this.byId.get(LEADER_BINDING_ID);
    if (!leader) return; // a caller supplying a custom binding set with no leader at all is fine

    const leaderChords = new Set([leader.keys, ...(leader.alternates ?? []).map(normalise)]);
    const collisions: string[] = [];
    for (const binding of this.byId.values()) {
      if (binding.id === LEADER_BINDING_ID) continue;
      for (const chord of [binding.keys, ...(binding.alternates ?? []).map(normalise)]) {
        if (leaderChords.has(chord)) {
          collisions.push(`${chord}: ${binding.id} (${binding.context}) also fires whenever the leader (pane.leader) does`);
        }
      }
    }
    if (collisions.length) {
      throw new CliError('VALIDATION', `The leader's chord collides with another binding:\n  ${collisions.join('\n  ')}`, {
        hint: 'The leader arms independently of context shadowing, so any other binding on the same chord fires alongside it, not instead of it. Remap one of them under `keymap` in your config.',
      });
    }
  }

  /** The action bound to a chord, searching contexts innermost-first. */
  lookup(chord: string, contexts: KeyContext[]): string | undefined {
    const normalised = normalise(chord);
    for (const context of contexts) {
      const id = this.byChord.get(`${context}\0${normalised}`);
      if (id) return id;
    }
    return undefined;
  }

  binding(id: string): ResolvedBinding | undefined {
    return this.byId.get(id);
  }

  /** Display chord for an action, for hints and the help overlay. */
  chordFor(id: string): string {
    return this.byId.get(id)?.keys ?? '';
  }

  all(): ResolvedBinding[] {
    return [...this.byId.values()];
  }

  /** Help-overlay sections, filtered by what the terminal can report. */
  byCategory(options: { kittyKeyboard?: boolean } = {}): Array<{ category: string; bindings: ResolvedBinding[] }> {
    const groups = new Map<string, ResolvedBinding[]>();
    for (const binding of this.byId.values()) {
      if (binding.hidden) continue;
      if (binding.requiresKittyKeyboard && !options.kittyKeyboard) continue;
      const list = groups.get(binding.category) ?? [];
      list.push(binding);
      groups.set(binding.category, list);
    }
    return [...groups.entries()].map(([category, bindings]) => ({ category, bindings }));
  }
}

/**
 * Canonical chord form.
 *
 * `Ctrl+Shift+K`, `ctrl-shift-k` and `SHIFT+CTRL+k` are the same binding;
 * without normalisation a user's remap silently fails to match because they
 * capitalised it differently from the table.
 */
export function normalise(chord: string): string {
  // A sequence (`g d`) is normalised part by part.
  if (chord.includes(' ')) {
    return chord.trim().split(/\s+/).map(normalise).join(' ');
  }
  // A bare capital is the shifted key: `R` and `r` are different bindings, so
  // this has to happen before the lowercasing that makes `Ctrl+K` == `ctrl+k`.
  if (/^[A-Z]$/.test(chord)) return `shift+${chord.toLowerCase()}`;

  const parts = chord.toLowerCase().replace(/-/g, '+').split('+').filter(Boolean);
  const key = parts.pop() ?? '';
  const modifiers = new Set(parts);
  const order = ['ctrl', 'alt', 'shift', 'meta', 'super'];
  const prefix = order.filter((m) => modifiers.has(m));
  const canonicalKey = KEY_ALIASES[key] ?? key;
  return [...prefix, canonicalKey].join('+');
}

const KEY_ALIASES: Record<string, string> = {
  enter: 'return',
  esc: 'escape',
  del: 'delete',
  bs: 'backspace',
  pgup: 'pageup',
  pgdn: 'pagedown',
  spc: 'space',
  ' ': 'space',
};
