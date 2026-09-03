// ────────────────────────────────────────────────────────────────
// The committed surface snapshot, kept honest (Phase 0 items 2/3).
//
// Phase 0's exit gate is "no feature is called full based only on registry
// presence". These are the checks that make that enforceable rather than
// aspirational:
//
//   1. Every keymap binding has an owner. A bound key nobody executes is the
//      keymap's version of a false parity claim — and this session found
//      three of exactly that (`run.stageDetail`, `run.verbosity`, and
//      `chat.editor`'s stale toast).
//   2. Every action the shell handles is a binding that exists. A handler for
//      a removed binding is dead code that reads as coverage.
//   3. The committed snapshot matches what the code actually exposes, so the
//      diff a reviewer reads is real.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildRegistry,
  buildSurfaceSnapshot,
  Keymap,
  renderSurfaceSnapshot,
} from '@generatorai/cli-core';
import { HANDLED_ACTIONS } from '../tui/App.js';

const keymap = new Keymap();
const registry = buildRegistry();
const handled = new Set<string>(HANDLED_ACTIONS);
const snapshot = buildSurfaceSnapshot(registry, keymap, handled);

describe('key bindings', () => {
  it('has an owner for every binding — no key that silently does nothing', () => {
    const orphans = snapshot.bindings.filter((b) => b.handledBy === 'none');
    expect(
      orphans.map((b) => `${b.id} (${b.context} ${b.keys})`),
      'these bindings are in the keymap but nothing executes them',
    ).toEqual([]);
  });

  it('handles no action that is not a real binding', () => {
    // A handler whose binding was renamed or removed can never fire, and it
    // still counts itself as "implemented" in the help overlay.
    const unknown = [...handled].filter((id) => !keymap.binding(id));
    expect(unknown, 'the shell handles actions with no keymap binding').toEqual([]);
  });

  it('declares each handled action exactly once', () => {
    expect(new Set(HANDLED_ACTIONS).size).toBe(HANDLED_ACTIONS.length);
  });
});

describe('administration views', () => {
  it('names only commands that exist, with the shape their output declares', () => {
    for (const view of snapshot.adminViews) {
      const spec = registry.get(view.command);
      expect(spec, `${view.id} points at a command that does not exist`).toBeDefined();
      // A `record` view renders a key/value inspector; forcing a single
      // object into a one-row table is how "diagnostics" becomes an
      // unreadable horizontal scroll.
      if (view.shape === 'list') {
        expect(
          spec!.output.kind === 'list' || spec!.output.kind === 'record',
          `${view.id} lists a command whose output is ${spec!.output.kind}`,
        ).toBe(true);
      }
    }
  });
});

describe('committed snapshot', () => {
  it('matches what the registry and keymap actually expose', () => {
    // The generator and this test build the snapshot the same way, so a
    // failure here means the committed file is stale — not that the two
    // disagree about how to build it.
    const here = dirname(fileURLToPath(import.meta.url));
    const target = resolve(here, '../../../../docs/CLI_SURFACE_SNAPSHOT.md');
    const committed = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    const current = renderSurfaceSnapshot(snapshot).replace(/\r\n/g, '\n');

    expect(
      committed === current,
      'docs/CLI_SURFACE_SNAPSHOT.md is stale — run `pnpm --filter @generatorai/cli surface`',
    ).toBe(true);
  });

  it('reports totals that agree with the live registry', () => {
    expect(snapshot.totals.commands).toBe(registry.all().length);
    expect(snapshot.totals.bindings).toBe(keymap.all().length);
    expect(snapshot.totals.unhandledBindings).toBe(0);
  });
});
