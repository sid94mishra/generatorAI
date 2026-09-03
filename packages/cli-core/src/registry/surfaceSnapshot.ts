// ────────────────────────────────────────────────────────────────
// The CLI/TUI surface, as data (Phase 0 item 2).
//
// The audit's Phase 0 asks to "snapshot the current registry, keymap,
// OpenAPI, route inventory, and parity matrix", and its exit gate is the
// sharper version of the same idea: **"no feature is called full based only
// on registry presence."**
//
// A prose snapshot cannot enforce that. This one is generated from the live
// registry and keymap and committed, so a diff is what a reviewer reads —
// and it deliberately records, per command and per binding, the things that
// a "present in the registry" claim hides:
//
//   - a command that reaches no server (`requiresServer: false`) is a very
//     different promise from one that does;
//   - a command hidden from the palette cannot be run from the TUI at all;
//   - a keymap binding with no handler does nothing when pressed — this
//     session has already found several (`chat.editor` fired a stale toast,
//     `run.stageDetail` and `run.verbosity` were bound to nothing);
//   - an administration view naming a command that no longer exists is an
//     empty pane nobody opens.
//
// Pure: it reads the registry and returns a structure. The generator writes
// it; a test regenerates it and diffs.
// ────────────────────────────────────────────────────────────────

import type { Keymap } from '../keymap/Keymap.js';
import { ADMIN_VIEWS } from './adminViews.js';
import type { CommandRegistry } from './registry.js';

export interface CommandSurfaceEntry {
  id: string;
  path: string;
  summary: string;
  requiresServer: boolean;
  destructive: boolean;
  /** Reachable from the TUI's command palette. */
  inPalette: boolean;
  /** Reachable over companion RPC. */
  inRpc: boolean;
  argCount: number;
  requiredArgs: string[];
  flagCount: number;
  requiredFlags: string[];
  sinceVersion: string;
}

export interface BindingSurfaceEntry {
  id: string;
  context: string;
  keys: string;
  category: string;
  /**
   * Who executes this action.
   *
   * `shell` — the workbench's keymap handler map (`HANDLED_ACTIONS`).
   *
   * `component` — a component owns it directly, and the keymap entry exists
   * only so the binding appears in help and can be remapped. Two real cases,
   * both with a reason the keymap itself documents: every `composer` binding
   * is executed inside `Composer` (an edit has to read the caret position the
   * PREVIOUS keystroke wrote, and a keymap dispatch only ever sees
   * render-old state, so typing faster than React re-renders would scramble
   * the line); and `pane.leader` is armed by its own separate registration,
   * because it changes which context the NEXT key resolves in.
   *
   * `none` — nothing executes it. The key does nothing when pressed. This is
   * the number Phase 0's exit gate is actually about, and collapsing it with
   * `component` would have reported 21 phantom failures while hiding a real
   * one among them.
   */
  handledBy: 'shell' | 'component' | 'none';
}

/**
 * Bindings a component executes rather than the shell.
 *
 * Derived from the CONTEXT plus one named exception rather than listed by
 * id, so a new composer binding is classified correctly the day it is added
 * instead of showing up as a false "does nothing".
 */
export function bindingOwner(
  binding: { id: string; context: string },
  shellActions: ReadonlySet<string>,
): BindingSurfaceEntry['handledBy'] {
  if (shellActions.has(binding.id)) return 'shell';
  // `chat.send`/`chat.newline`/`chat.mention`/`chat.slash`/`chat.history*`
  // are declared in the `composer` context and handled by the composer too.
  if (binding.context === 'composer') return 'component';
  if (binding.id === 'pane.leader') return 'component';
  return 'none';
}

export interface SurfaceSnapshot {
  commands: CommandSurfaceEntry[];
  bindings: BindingSurfaceEntry[];
  adminViews: Array<{ id: string; command: string; shape: string }>;
  totals: {
    commands: number;
    groups: number;
    serverBacked: number;
    destructive: number;
    hiddenFromPalette: number;
    bindings: number;
    componentOwnedBindings: number;
    /** Bindings nothing executes — the number Phase 0's exit gate is about. */
    unhandledBindings: number;
    adminViews: number;
  };
}

export function buildSurfaceSnapshot(
  registry: CommandRegistry,
  keymap: Keymap,
  implementedActions: ReadonlySet<string>,
): SurfaceSnapshot {
  const commands: CommandSurfaceEntry[] = registry
    .all()
    .map((spec) => ({
      id: spec.id,
      path: [spec.group, spec.verb].filter(Boolean).join(' '),
      summary: spec.summary,
      requiresServer: spec.requiresServer,
      destructive: Boolean(spec.destructive),
      // Both default to true for a non-hidden command, matching the
      // registry's own reading of the field.
      inPalette: spec.inPalette ?? !spec.hidden,
      inRpc: spec.inRpc ?? !spec.hidden,
      argCount: spec.args.length,
      requiredArgs: spec.args.filter((arg) => arg.required).map((arg) => arg.name),
      flagCount: spec.flags.filter((flag) => !flag.hidden).length,
      requiredFlags: spec.flags.filter((flag) => flag.required && !flag.hidden).map((f) => f.name),
      sinceVersion: spec.sinceVersion,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const bindings: BindingSurfaceEntry[] = keymap
    .all()
    .map((binding) => ({
      id: binding.id,
      context: binding.context,
      keys: binding.keys,
      category: binding.category,
      handledBy: bindingOwner(binding, implementedActions),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    commands,
    bindings,
    adminViews: ADMIN_VIEWS.map((view) => ({
      id: view.id,
      command: view.command,
      shape: view.shape ?? 'list',
    })).sort((a, b) => a.id.localeCompare(b.id)),
    totals: {
      commands: commands.length,
      groups: registry.groupList().length,
      serverBacked: commands.filter((c) => c.requiresServer).length,
      destructive: commands.filter((c) => c.destructive).length,
      hiddenFromPalette: commands.filter((c) => !c.inPalette).length,
      bindings: bindings.length,
      componentOwnedBindings: bindings.filter((b) => b.handledBy === 'component').length,
      unhandledBindings: bindings.filter((b) => b.handledBy === 'none').length,
      adminViews: ADMIN_VIEWS.length,
    },
  };
}

/** Stable, diff-friendly rendering — the committed artifact a reviewer reads. */
export function renderSurfaceSnapshot(snapshot: SurfaceSnapshot): string {
  const lines: string[] = [];
  lines.push('# CLI / TUI surface snapshot');
  lines.push('');
  lines.push(
    'Generated from the live registry and keymap — do not edit by hand. Run',
    '`pnpm --filter @generatorai/cli surface` and commit the result.',
    '',
    'Phase 0 of the parity audit asks for a snapshot whose exit gate is "no',
    'feature is called full based only on registry presence". The columns are',
    'chosen to make that claim checkable: a command that reaches no server, is',
    'hidden from the palette, or needs input the caller must supply is not the',
    'same promise as one that does not.',
    '',
  );

  const t = snapshot.totals;
  lines.push('## Totals');
  lines.push('');
  lines.push('| Measure | Count |');
  lines.push('|---|---:|');
  lines.push(`| Commands | ${t.commands} |`);
  lines.push(`| Groups | ${t.groups} |`);
  lines.push(`| Server-backed commands | ${t.serverBacked} |`);
  lines.push(`| Destructive commands | ${t.destructive} |`);
  lines.push(`| Commands hidden from the palette | ${t.hiddenFromPalette} |`);
  lines.push(`| Key bindings | ${t.bindings} |`);
  lines.push(`| Bindings executed by a component | ${t.componentOwnedBindings} |`);
  lines.push(`| Bindings nothing executes | ${t.unhandledBindings} |`);
  lines.push(`| Administration views | ${t.adminViews} |`);
  lines.push('');

  lines.push('## Commands');
  lines.push('');
  lines.push('| ID | Path | Server | Destructive | Palette | RPC | Required args | Required flags |');
  lines.push('|---|---|:-:|:-:|:-:|:-:|---|---|');
  for (const c of snapshot.commands) {
    lines.push(
      `| \`${c.id}\` | \`${c.path}\` | ${mark(c.requiresServer)} | ${mark(c.destructive)} | ` +
        `${mark(c.inPalette)} | ${mark(c.inRpc)} | ${c.requiredArgs.join(', ') || '—'} | ` +
        `${c.requiredFlags.map((f) => `--${f}`).join(', ') || '—'} |`,
    );
  }
  lines.push('');

  lines.push('## Key bindings');
  lines.push('');
  lines.push('| ID | Context | Keys | Category | Handled by |');
  lines.push('|---|---|---|---|:-:|');
  for (const b of snapshot.bindings) {
    lines.push(`| \`${b.id}\` | ${b.context} | \`${b.keys}\` | ${b.category} | ${b.handledBy} |`);
  }
  lines.push('');

  lines.push('## Administration views');
  lines.push('');
  lines.push('| ID | Command | Shape |');
  lines.push('|---|---|---|');
  for (const v of snapshot.adminViews) {
    lines.push(`| ${v.id} | \`${v.command}\` | ${v.shape} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function mark(value: boolean): string {
  return value ? 'yes' : 'no';
}
