// ────────────────────────────────────────────────────────────────
// CommandSpec[] → the TUI command palette, companion RPC table, and the
// command tables in .github/docs/usage-cli.md.
//
// Three small generators kept together because they are three views of the
// same list and are easiest to keep consistent when they are read together.
// ────────────────────────────────────────────────────────────────

import {
  commandPath,
  flagToCli,
  shellOnlyHint,
  usageLine,
  type CommandSpec,
  type ShellOnlyRequirement,
} from './CommandSpec.js';
import type { CommandRegistry } from './registry.js';

// ── Palette ───────────────────────────────────────────────────────

export interface PaletteEntry {
  id: string;
  /** `Run › Start` — grouped for display. */
  title: string;
  subtitle: string;
  group: string;
  keywords: string[];
  /** Shortcut hint, filled in by the TUI from the keymap. */
  shortcut?: string;
  destructive: boolean;
  requiresServer: boolean;
  /** True when the command needs arguments and must open a form first. */
  needsInput: boolean;
  /** Mirrors `CommandSpec.requires`; empty for the ordinary case. */
  requires: ReadonlyArray<ShellOnlyRequirement>;
  /**
   * Set when `requires` is non-empty: the row is shown disabled with this
   * text in place of the summary, and selecting it surfaces the same text
   * rather than running the handler.
   */
  shellOnlyHint?: string;
}

function titleCase(text: string): string {
  return text
    .split(/[\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function toPalette(registry: CommandRegistry): PaletteEntry[] {
  return registry
    .visible()
    .filter((spec) => spec.inPalette !== false)
    .map((spec) => ({
      id: spec.id,
      title: spec.verb
        ? `${titleCase(spec.group)} › ${titleCase(spec.verb)}`
        : titleCase(spec.group),
      subtitle: spec.summary,
      group: spec.group,
      keywords: [
        commandPath(spec),
        spec.id,
        ...(spec.aliases ?? []),
        ...spec.summary.toLowerCase().split(/\s+/),
      ],
      destructive: Boolean(spec.destructive),
      requiresServer: spec.requiresServer,
      needsInput: spec.args.some((a) => a.required) || spec.flags.some((f) => f.required),
      requires: spec.requires ?? [],
      ...(spec.requires && spec.requires.length > 0
        ? { shellOnlyHint: shellOnlyHint(commandPath(spec)) }
        : {}),
    }));
}

// ── Companion RPC ─────────────────────────────────────────────────

export interface RpcMethodDescriptor {
  method: string;
  summary: string;
  params: {
    args: Array<{ name: string; required: boolean; variadic: boolean; description: string }>;
    flags: Array<{
      name: string;
      type: string;
      required: boolean;
      variadic: boolean;
      description: string;
      choices?: readonly string[];
    }>;
  };
  /** `stream` methods emit `{ id, event }` frames before their result. */
  streaming: boolean;
  destructive: boolean;
  scopes: string[];
  sinceVersion: string;
}

export function toRpcMethods(registry: CommandRegistry): RpcMethodDescriptor[] {
  return registry
    .all()
    .filter((spec) => spec.inRpc !== false && !spec.hidden)
    .map((spec) => ({
      method: spec.id,
      summary: spec.summary,
      params: {
        args: spec.args.map((a) => ({
          name: a.name,
          required: a.required,
          variadic: Boolean(a.variadic),
          description: a.description,
        })),
        flags: spec.flags
          .filter((f) => !f.hidden)
          .map((f) => ({
            name: f.name,
            type: f.type,
            required: Boolean(f.required),
            variadic: Boolean(f.variadic),
            description: f.description,
            ...(f.choices ? { choices: f.choices } : {}),
            // Phase 0 item 1 — an RPC caller must be able to see that an
            // option it may pass is accepted and discarded, exactly as
            // `--help` and the docs do.
            ...(f.unsupported ? { unsupported: f.unsupported } : {}),
          })),
      },
      streaming: spec.output.kind === 'stream',
      destructive: Boolean(spec.destructive),
      scopes: spec.scopes ?? [],
      sinceVersion: spec.sinceVersion,
    }));
}

// ── Docs ──────────────────────────────────────────────────────────

export const DOCS_START = '<!-- @generated-commands:start — regenerate with `pnpm cli:docs`; do not edit by hand -->';
export const DOCS_END = '<!-- @generated-commands:end -->';

/** The command-tree block and the per-group tables for usage-cli.md. */
export function toDocs(registry: CommandRegistry): string {
  const groups = registry.groupList();

  const tree: string[] = ['```', 'generatorai'];
  groups.forEach((group, groupIndex) => {
    const isLastGroup = groupIndex === groups.length - 1;
    const groupPrefix = isLastGroup ? '└── ' : '├── ';
    const label = group.aliases.length ? `${group.name} (${group.aliases.join(', ')})` : group.name;
    tree.push(`${groupPrefix}${label.padEnd(22)}# ${group.summary}`);
    const verbs = group.commands.map((c) => c.verb).filter(Boolean);
    if (verbs.length) {
      const continuation = isLastGroup ? '    ' : '│   ';
      // Wrap the verb list rather than emitting one line per verb: a 25-group
      // tree with one line per verb runs to 300 lines and stops being a map.
      const wrapped = wrap(verbs.join(' · '), 68);
      wrapped.forEach((line, i) => {
        tree.push(`${continuation}${i === 0 ? '  ' : '  '}${line}`);
      });
    }
  });
  tree.push('```');

  const tables: string[] = [];
  for (const group of groups) {
    tables.push(`### \`${group.name}\`${group.aliases.length ? ` (alias: \`${group.aliases.join('`, `')}\`)` : ''}`);
    tables.push('');
    if (group.summary) tables.push(`${group.summary}`, '');
    tables.push('| Command | What | Flags |');
    tables.push('|---|---|---|');
    for (const spec of group.commands) {
      const flags = spec.flags
        .filter((f) => !f.hidden)
        // Phase 0 item 1 — an accepted-but-inert option is marked in the
        // docs too, not only in `--help`. The docs are what someone reads
        // BEFORE typing the command, which is the moment it matters most.
        .map((f) => `\`${flagToCli(f.name)}\`${f.unsupported ? ' ⚠️' : ''}`)
        .join(' ');
      const caveats = spec.flags
        .filter((f) => !f.hidden && f.unsupported)
        .map((f) => `⚠️ \`${flagToCli(f.name)}\` — ${escapePipes(f.unsupported!)}`)
        .join('<br>');
      tables.push(
        `| \`${usageLine(spec)}\` | ${escapePipes(spec.summary)}${caveats ? `<br>${caveats}` : ''} | ${flags || '—'} |`,
      );
    }
    tables.push('');
  }

  return [DOCS_START, '', ...tree, '', ...tables, DOCS_END].join('\n');
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function wrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && `${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Splices the generated block into an existing document.
 *
 * Returns the document unchanged when the markers are missing, so a
 * regeneration cannot silently blow away a hand-written file.
 */
export function spliceDocs(document: string, generated: string): string {
  const start = document.indexOf(DOCS_START);
  const end = document.indexOf(DOCS_END);
  if (start === -1 || end === -1 || end < start) return document;
  return document.slice(0, start) + generated + document.slice(end + DOCS_END.length);
}

// ── Keymap docs (open question #8) ─────────────────────────────────
//
// `.github/docs/usage-cli.md` described a defunct pre-rewrite TUI: five
// numbered views, `1`–`5` to switch, `Esc`/`Ctrl+B` for "back". None of that
// has existed since the workbench rewrite, and the tracker deferred fixing
// it as "a real doc-writing task".
//
// Hand-writing it is the reason it drifted. The command tables are generated
// from the registry and cannot go stale; the keymap has exactly the same
// property available to it, and the drift check in CI then covers both.

export const KEYMAP_DOCS_START =
  '<!-- @generated-keymap:start — regenerate with `pnpm cli:docs`; do not edit by hand -->';
export const KEYMAP_DOCS_END = '<!-- @generated-keymap:end -->';

/** Human-facing name for each key context, in the order they are documented. */
const CONTEXT_ORDER: Array<{ context: string; title: string; note: string }> = [
  { context: 'global', title: 'Anywhere', note: 'Active in every pane.' },
  {
    context: 'leader',
    title: 'Leader (after the prefix)',
    note: 'Press the leader prefix first; the next key is resolved here. tmux grammar, so muscle memory transfers.',
  },
  { context: 'list', title: 'Lists', note: 'Any pane with rows, and the fallback for several others.' },
  { context: 'chat', title: 'Chat', note: 'A chat pane, outside the prompt.' },
  { context: 'composer', title: 'The prompt', note: 'Executed by the composer itself, so an edit reads the caret the previous keystroke wrote.' },
  { context: 'run', title: 'Runs', note: 'Watching a workflow run.' },
  { context: 'workflow', title: 'Workflow authoring', note: 'Editing a workflow definition.' },
  { context: 'diff', title: 'Changes and review', note: 'A workspace diff, its checkpoints and its review threads.' },
  { context: 'workspace', title: 'Workspace files', note: 'The workspace file browser.' },
  { context: 'terminal', title: 'Terminal', note: 'An embedded terminal pane.' },
  { context: 'browser', title: 'Browser', note: 'An integrated-browser pane.' },
  { context: 'computer', title: 'Computer use', note: 'Consent, grants and the audit trail.' },
  { context: 'automation', title: 'Automations', note: 'An automation and its executions.' },
  { context: 'command', title: 'Administration views', note: 'A registry-command-backed admin pane.' },
];

/**
 * The keymap as markdown, grouped by context.
 *
 * Reads the same `Keymap` the app resolves keystrokes through, so a binding
 * cannot exist without appearing here and a remap in config is reflected
 * automatically.
 */
export function toKeymapDocs(bindings: ReadonlyArray<{
  id: string;
  context: string;
  keys: string;
  alternates?: string[];
  description: string;
  hidden?: boolean;
}>): string {
  const out: string[] = [KEYMAP_DOCS_START, ''];
  const seen = new Set<string>();

  for (const { context, title, note } of CONTEXT_ORDER) {
    const inContext = bindings.filter((b) => b.context === context && !b.hidden);
    if (inContext.length === 0) continue;
    inContext.forEach((b) => seen.add(b.id));

    out.push(`#### ${title}`, '', note, '', '| Key | Action |', '|---|---|');
    for (const binding of inContext) {
      const keys = [binding.keys, ...(binding.alternates ?? [])]
        .map((chord) => `\`${chord}\``)
        .join(' / ');
      out.push(`| ${keys} | ${binding.description} |`);
    }
    out.push('');
  }

  // Anything in a context this list does not name still gets documented —
  // otherwise adding a context would silently hide its whole section.
  const rest = bindings.filter((b) => !b.hidden && !seen.has(b.id));
  if (rest.length > 0) {
    out.push('#### Other', '', '| Key | Context | Action |', '|---|---|---|');
    for (const binding of rest) {
      out.push(`| \`${binding.keys}\` | ${binding.context} | ${binding.description} |`);
    }
    out.push('');
  }

  out.push(KEYMAP_DOCS_END);
  return out.join('\n');
}

/** Splices generated keymap docs into a document, like `applyDocs` does for commands. */
export function applyKeymapDocs(document: string, generated: string): string {
  const start = document.indexOf(KEYMAP_DOCS_START);
  const end = document.indexOf(KEYMAP_DOCS_END);
  if (start === -1 || end === -1) return document;
  return document.slice(0, start) + generated + document.slice(end + KEYMAP_DOCS_END.length);
}
