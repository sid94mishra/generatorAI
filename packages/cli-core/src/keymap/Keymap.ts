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
  | 'terminal'
  | 'browser'
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

export const DEFAULT_KEYMAP: KeyBinding[] = [
  // ── Global ────────────────────────────────────────────────────
  { id: 'app.palette', context: 'global', keys: 'ctrl+k', alternates: ['ctrl+p'], description: 'Command palette', category: 'Global' },
  // `?` and `/` are printable, so they cannot live in `global`: the chat
  // composer would never receive them, and typing a question would open the
  // help sheet instead. `list` is every context that has no text input.
  { id: 'app.help', context: 'list', keys: '?', description: 'Toggle help', category: 'Global' },
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

  // ── Leader (tmux grammar, so muscle memory transfers) ─────────
  // The prefix itself is a global binding: without it nothing can switch the
  // resolver into the `leader` context and the whole grammar is unreachable.
  { id: 'pane.leader', context: 'global', keys: 'ctrl+b', description: 'Leader prefix (panes & tabs)', category: 'Panes' },
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
  // Named keys, so they still reach the keymap while the composer has focus.
  { id: 'chat.scrollUp', context: 'chat', keys: 'pageup', description: 'Scroll transcript back', category: 'Chat' },
  { id: 'chat.scrollDown', context: 'chat', keys: 'pagedown', description: 'Scroll transcript forward', category: 'Chat' },

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

  // ── Diff ──────────────────────────────────────────────────────
  { id: 'diff.nextFile', context: 'diff', keys: 'ctrl+n', alternates: [']'], description: 'Next file', category: 'Diff' },
  { id: 'diff.prevFile', context: 'diff', keys: 'ctrl+p', alternates: ['['], description: 'Previous file', category: 'Diff' },
  { id: 'diff.nextHunk', context: 'diff', keys: 'n', description: 'Next hunk', category: 'Diff' },
  { id: 'diff.prevHunk', context: 'diff', keys: 'N', description: 'Previous hunk', category: 'Diff' },
  { id: 'diff.toggleLayout', context: 'diff', keys: 'w', description: 'Unified / side-by-side', category: 'Diff' },
  { id: 'diff.comment', context: 'diff', keys: 'c', description: 'Comment on line', category: 'Diff' },
  { id: 'diff.resolve', context: 'diff', keys: 'o', description: 'Resolve thread', category: 'Diff' },
  // The only route to the terminal and browser surfaces: both are scoped to a
  // workspace, and the changes pane is where a workspace is already open.
  { id: 'diff.openTerminal', context: 'diff', keys: 't', description: 'Terminal for this workspace', category: 'Diff' },
  { id: 'diff.openBrowser', context: 'diff', keys: 'b', description: 'Browser for this workspace', category: 'Diff' },

  // ── Terminal ──────────────────────────────────────────────────
  { id: 'terminal.attach', context: 'terminal', keys: 'return', description: 'Attach (raw mode)', category: 'Terminal' },
  { id: 'terminal.new', context: 'terminal', keys: 'n', description: 'New terminal', category: 'Terminal' },
  { id: 'terminal.kill', context: 'terminal', keys: 'd', description: 'Kill terminal', category: 'Terminal' },

  // ── Browser ───────────────────────────────────────────────────
  { id: 'browser.navigate', context: 'browser', keys: 'o', description: 'Open URL', category: 'Browser' },
  { id: 'browser.back', context: 'browser', keys: 'H', description: 'Back', category: 'Browser' },
  { id: 'browser.forward', context: 'browser', keys: 'L', description: 'Forward', category: 'Browser' },
  { id: 'browser.reload', context: 'browser', keys: 'r', description: 'Reload', category: 'Browser' },
  { id: 'browser.screenshot', context: 'browser', keys: 's', description: 'Screenshot', category: 'Browser' },
  { id: 'browser.status', context: 'browser', keys: 'i', description: 'Session info', category: 'Browser' },
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
