// ────────────────────────────────────────────────────────────────
// The config, as an editable list of dotted keys.
//
// `config show` prints a nested object and `config set` takes a dotted key —
// so anything that wants to EDIT settings (Phase 8 item 6: "make settings
// editable and prove each setting changes behaviour") needs the bridge
// between the two, and needs it to be the same bridge the commands use or
// the TUI would offer keys `config set` cannot write.
//
// Pure, so the whole thing is testable without a filesystem or a terminal.
// ────────────────────────────────────────────────────────────────

import { CliConfigSchema, DEFAULT_CONFIG } from './schema.js';

export interface SettingRow {
  /** Dotted key, exactly what `config set`/`config get`/`config unset` take. */
  key: string;
  /** Current value, rendered for display. */
  value: string;
  /** The schema's own default, rendered the same way — empty when there is none. */
  defaultValue: string;
  /** True when the current value differs from the default. */
  overridden: boolean;
  /** What kind of input the editor should offer. */
  type: 'string' | 'number' | 'boolean' | 'enum';
  /** Present for `enum`. */
  choices?: readonly string[];
  /** When this setting starts affecting behaviour. See `SETTING_EFFECT`. */
  effect: SettingEffect;
}

/**
 * When a change takes effect — the honest answer to "did that do anything?".
 *
 * A settings screen that silently requires a restart for half its rows
 * teaches users that settings do not work. Each key is classified once, here,
 * next to the code that knows.
 */
export type SettingEffect =
  /** Applied by the running TUI as soon as it is written. */
  | 'live'
  /** Read when the next command runs; no restart needed. */
  | 'next-command'
  /** Read once at startup — needs a restart of the TUI to apply. */
  | 'restart';

/**
 * Keys whose effect is not `next-command`.
 *
 * `next-command` is the default because most settings are read by the command
 * layer on each invocation (`cli.*`, `server.*`). Only the TUI's own startup-
 * read values need a restart, and only the two the running app re-reads are
 * live.
 */
const SETTING_EFFECT: Record<string, SettingEffect> = {
  // Applied by the running app: the theme picker writes `tui.theme` and the
  // store's `setTheme` repaints without a restart; `showThinking` is toggled
  // live by `chat.toggleThinking`.
  'tui.theme': 'live',
  'tui.showThinking': 'live',
  // Read once when the workbench mounts.
  'tui.alternateScreen': 'restart',
  'tui.restoreLayout': 'restart',
  'tui.refreshMs': 'restart',
  'tui.maxFps': 'restart',
  'tui.mouse': 'restart',
  'tui.incrementalRendering': 'restart',
  'tui.graphics': 'restart',
  'tui.appearance': 'restart',
  'tui.accent': 'restart',
  'tui.collapseTools': 'restart',
};

/** Sub-trees that are not settings and must never be offered as editable rows. */
const NOT_SETTINGS = new Set(['sources', 'connections', 'profiles', 'keymap', 'configVersion']);

/**
 * Every editable setting, as dotted key/value rows.
 *
 * `connections`/`profiles`/`keymap` are excluded deliberately: they are
 * managed by their own commands (`connect *`, `config profile *`,
 * `config keymap set`), and flattening an array of connections into
 * `connections.0.endpoint` would offer keys `config set` writes as a plain
 * string into what must stay a structured entry.
 */
export function settingRows(config: Record<string, unknown>): SettingRow[] {
  const rows: SettingRow[] = [];
  const defaults = DEFAULT_CONFIG as unknown as Record<string, unknown>;

  const walk = (node: unknown, defaultNode: unknown, prefix: string): void => {
    if (!isPlainObject(node)) return;
    for (const [name, value] of Object.entries(node)) {
      const key = prefix ? `${prefix}.${name}` : name;
      if (!prefix && NOT_SETTINGS.has(name)) continue;
      const defaultValue = isPlainObject(defaultNode) ? defaultNode[name] : undefined;
      if (isPlainObject(value)) {
        walk(value, defaultValue, key);
        continue;
      }
      const choices = enumChoicesFor(key);
      rows.push({
        key,
        value: renderValue(value),
        defaultValue: renderValue(defaultValue),
        overridden: renderValue(value) !== renderValue(defaultValue),
        type: choices ? 'enum' : typeOf(value),
        ...(choices ? { choices } : {}),
        effect: SETTING_EFFECT[key] ?? 'next-command',
      });
    }
  };

  walk(config, defaults, '');
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Whether a value would survive `config set` — checked BEFORE writing, so a
 * bad value is reported against the field the user was editing rather than
 * failing schema validation on the next load, by which point the file is
 * already wrong.
 *
 * Returns `null` when it is fine, or the reason it is not.
 */
export function validateSettingValue(key: string, value: string): string | null {
  const candidate = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>;
  const parts = key.split('.');
  let node = candidate;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (!isPlainObject(next)) return `"${key}" is not a setting.`;
    node = next;
  }
  const leaf = parts.at(-1)!;
  if (!(leaf in node)) return `"${key}" is not a setting.`;

  // Same coercion `config set` performs, so this validates what will actually
  // be written rather than a differently-typed stand-in.
  node[leaf] = coerce(value, node[leaf]);
  const parsed = CliConfigSchema.safeParse(candidate);
  if (parsed.success) return null;
  const issue = parsed.error.issues.find((i) => i.path.join('.') === key) ?? parsed.error.issues[0];
  return issue ? `${issue.path.join('.') || key}: ${issue.message}` : 'Invalid value.';
}

/** `config set` writes strings; the schema wants the original type back. */
function coerce(value: string, previous: unknown): unknown {
  if (typeof previous === 'boolean') return value === 'true';
  if (typeof previous === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

function enumChoicesFor(key: string): readonly string[] | undefined {
  switch (key) {
    case 'cli.output':
      return ['auto', 'json', 'ndjson', 'yaml', 'quiet'];
    case 'cli.color':
      return ['auto', 'always', 'never'];
    case 'tui.appearance':
      return ['auto', 'light', 'dark'];
    case 'tui.accent':
      return ['blue', 'violet', 'green', 'orange', 'rose', 'teal'];
    case 'tui.graphics':
      return ['auto', 'kitty', 'iterm2', 'sixel', 'halfblock', 'ascii'];
    default:
      return undefined;
  }
}

function typeOf(value: unknown): 'string' | 'number' | 'boolean' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

function renderValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
