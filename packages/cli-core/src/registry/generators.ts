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
  usageLine,
  type CommandSpec,
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
        .map((f) => `\`${flagToCli(f.name)}\``)
        .join(' ');
      tables.push(
        `| \`${usageLine(spec)}\` | ${escapePipes(spec.summary)} | ${flags || '—'} |`,
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
