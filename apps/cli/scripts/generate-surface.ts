// ────────────────────────────────────────────────────────────────
// Regenerates docs/CLI_SURFACE_SNAPSHOT.md from the live registry, keymap
// and administration-view table (Phase 0 item 2).
//
//   pnpm --filter @generatorai/cli surface           # write
//   pnpm --filter @generatorai/cli surface --check   # fail if stale (CI)
//
// The snapshot exists so that Phase 0's exit gate — "no feature is called
// full based only on registry presence" — is something a reviewer can read
// in a diff. Adding a command, binding a key with no handler, or pointing an
// administration view at a command that no longer exists all show up here as
// a line that changed.
// ────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildRegistry, buildSurfaceSnapshot, Keymap, renderSurfaceSnapshot } from '@generatorai/cli-core';
import { HANDLED_ACTIONS } from '../src/tui/App.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../../../docs/CLI_SURFACE_SNAPSHOT.md');

const snapshot = buildSurfaceSnapshot(
  buildRegistry(),
  new Keymap(),
  new Set<string>(HANDLED_ACTIONS),
);
const next = `${renderSurfaceSnapshot(snapshot)}`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    process.stderr.write(
      'docs/CLI_SURFACE_SNAPSHOT.md does not exist.\n' +
        'Run `pnpm --filter @generatorai/cli surface` and commit the result.\n',
    );
    process.exit(1);
  }
  // Normalised: a checkout with `core.autocrlf` on rewrites line endings, and
  // failing CI over that would teach people to ignore this check.
  if (current.replace(/\r\n/g, '\n') !== next.replace(/\r\n/g, '\n')) {
    process.stderr.write(
      'docs/CLI_SURFACE_SNAPSHOT.md is out of date with the registry/keymap.\n' +
        'Run `pnpm --filter @generatorai/cli surface` and commit the result.\n',
    );
    process.exit(1);
  }
  process.stdout.write('CLI_SURFACE_SNAPSHOT.md is up to date.\n');
  process.exit(0);
}

writeFileSync(target, next, 'utf8');
process.stdout.write(
  `CLI_SURFACE_SNAPSHOT.md updated — ${snapshot.totals.commands} commands, ` +
    `${snapshot.totals.bindings} bindings ` +
    `(${snapshot.totals.componentOwnedBindings} component-owned, ` +
    `${snapshot.totals.unhandledBindings} unhandled), ` +
    `${snapshot.totals.adminViews} administration views.\n`,
);
