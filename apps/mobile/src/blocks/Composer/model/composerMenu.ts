// ────────────────────────────────────────────────────────────────
// Composer menu — slash commands and @-file mentions.
//
// Pure logic, separated from the view so the trigger rules are testable. The
// rules match the web composer exactly:
//
//   `/`  only at the very start of the text, caret still inside the token
//   `@`  preceded by whitespace or start, token contains no space
//
// A phone has no hover and no arrow keys, so the surfaced result is a
// horizontally scrolling strip of tappable chips rather than a dropdown with
// a keyboard-driven selection index.
// ────────────────────────────────────────────────────────────────

export type MenuKind = 'slash' | 'mention';

export interface MenuState {
  kind: MenuKind;
  /** The characters after the trigger, used to filter. */
  query: string;
  /** Index of the trigger character in the source text. */
  start: number;
  /** Index one past the end of the token. */
  end: number;
}

/**
 * Detects an open menu for `text` with the caret at `caret`.
 *
 * Returns null when no trigger is active — which is the common case on every
 * keystroke, so this stays allocation-free on that path.
 */
export function detectMenu(text: string, caret: number): MenuState | null {
  if (caret < 0 || caret > text.length) return null;

  // Slash: only a command that starts the message. Anywhere else a slash is
  // just a path separator, and offering commands there is noise.
  if (text.startsWith('/')) {
    const end = text.indexOf(' ');
    const tokenEnd = end === -1 ? text.length : end;
    if (caret <= tokenEnd) {
      return { kind: 'slash', query: text.slice(1, tokenEnd), start: 0, end: tokenEnd };
    }
  }

  // Mention: scan back from the caret to the nearest '@' with no whitespace
  // in between.
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) break;
    if (ch === '@') {
      const before = i === 0 ? '' : text[i - 1];
      if (before !== undefined && before !== '' && !/\s/.test(before)) break;
      return { kind: 'mention', query: text.slice(i + 1, caret), start: i, end: caret };
    }
  }

  return null;
}

/** Replaces the menu's token with `replacement`, returning text + new caret. */
export function applyMenuSelection(
  text: string,
  menu: MenuState,
  replacement: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, menu.start)}${replacement}${text.slice(menu.end)}`;
  return { text: next, caret: menu.start + replacement.length };
}

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  /** Which Workbench section it reveals, if any. */
  section?: string;
}

/**
 * Built-in commands.
 *
 * On web these open right-pane tabs. On mobile the right pane is the
 * Workbench sheet, so each one reveals a section of it. `/browser` and
 * `/terminal` are listed even when the device lacks the scope: the command
 * then explains why rather than silently not existing, which is the HIG rule
 * about never hiding a destination.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'changes', label: '/changes', description: 'Review file changes', section: 'changes' },
  { id: 'files', label: '/files', description: 'Browse workspace files', section: 'files' },
  { id: 'plan', label: '/plan', description: 'Open the plan document', section: 'plan' },
  { id: 'tasks', label: '/tasks', description: 'Background tasks', section: 'tasks' },
  { id: 'terminal', label: '/terminal', description: 'Open the terminal', section: 'terminal' },
  { id: 'browser', label: '/browser', description: 'Open the browser preview', section: 'browser' },
];

export function filterCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.id.includes(q) || c.description.toLowerCase().includes(q),
  );
}

/**
 * Ranks paths for an @-mention.
 *
 * Four tiers, because "the basename contains it" is not a strong enough
 * signal on its own: `@button` matches both `ui/Button.tsx` and
 * `docs/button-notes.md` on the basename, and the component is almost always
 * what was meant.
 *
 *   0. basename without its extension EQUALS the query
 *   1. basename starts with it
 *   2. basename contains it
 *   3. only the directory contains it
 *
 * Ties break on path length, favouring the shallower file.
 */
export function filterPaths(paths: readonly string[], query: string, limit = 20): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths.slice(0, limit);

  const scored: Array<{ path: string; tier: number }> = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (!lower.includes(q)) continue;

    const base = lower.slice(lower.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;

    const tier = stem === q ? 0 : base.startsWith(q) ? 1 : base.includes(q) ? 2 : 3;
    scored.push({ path, tier });
  }

  scored.sort((a, b) => a.tier - b.tier || a.path.length - b.path.length);
  return scored.slice(0, limit).map((s) => s.path);
}
