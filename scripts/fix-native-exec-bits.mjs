#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Restore the executable bit on native helper binaries that ship
// inside dependency tarballs.
//
// node-pty does not spawn a shell directly on POSIX: it exec's a small
// `spawn-helper` binary that sets up the controlling terminal first. That
// helper is shipped prebuilt inside the npm tarball, and the packed archive
// does not reliably carry its mode through to disk — installs land it as
// 0644. The Mach-O/ELF image itself is perfectly valid, so nothing fails at
// install or require time; it fails much later, the first time a user opens a
// terminal pane, as an opaque `posix_spawnp failed` from inside the native
// addon with no mention of permissions.
//
// This is NOT a macOS quirk, even though macOS is where it is usually seen
// first: any POSIX platform that consumes a prebuilt `spawn-helper` hits it.
// Windows is genuinely unaffected — ConPTY/winpty need no helper binary and
// there is no exec bit to lose — so this script no-ops there rather than
// pretending to fix something.
//
// Wired to the root `postinstall` so a plain `pnpm install` leaves a working
// tree. Safe to re-run: it only touches files that are missing the bit.
// ────────────────────────────────────────────────────────────────

import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Every location a node-pty install can leave a helper binary. */
function helperCandidates(pkgDir) {
  const out = [];

  // Prebuilt path: prebuilds/<platform>-<arch>/spawn-helper
  const prebuilds = join(pkgDir, 'prebuilds');
  if (existsSync(prebuilds)) {
    for (const entry of readdirSync(prebuilds)) {
      out.push(join(prebuilds, entry, 'spawn-helper'));
    }
  }

  // Source-build path (node-gyp rebuild), used when no prebuild matches.
  out.push(join(pkgDir, 'build', 'Release', 'spawn-helper'));

  return out;
}

/**
 * pnpm stores every real package under `node_modules/.pnpm/<name>@<ver>/node_modules/<name>`,
 * so a single hoisted lookup would miss copies. Walk the store instead, and
 * fall back to the plain layout for npm/yarn installs.
 */
function nodePtyDirs() {
  const dirs = [];

  const store = join(repoRoot, 'node_modules', '.pnpm');
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('node-pty@')) continue;
      const dir = join(store, entry, 'node_modules', 'node-pty');
      if (existsSync(dir)) dirs.push(dir);
    }
  }

  const flat = join(repoRoot, 'node_modules', 'node-pty');
  if (existsSync(flat) && !dirs.includes(flat)) dirs.push(flat);

  return dirs;
}

function main() {
  if (process.platform === 'win32') return;

  const fixed = [];
  const EXEC_BITS = 0o111;

  for (const pkgDir of nodePtyDirs()) {
    for (const helper of helperCandidates(pkgDir)) {
      if (!existsSync(helper)) continue;

      const mode = statSync(helper).mode;
      if ((mode & EXEC_BITS) === EXEC_BITS) continue;

      // Mirror the read bits into exec so a 0600 file does not become
      // world-executable just because we fixed the owner bit.
      const next = mode | ((mode & 0o444) >> 2);
      try {
        chmodSync(helper, next);
        fixed.push(helper.slice(repoRoot.length));
      } catch (err) {
        console.warn(`[fix-native-exec-bits] could not chmod ${helper}: ${err.message}`);
      }
    }
  }

  if (fixed.length > 0) {
    console.log(`[fix-native-exec-bits] restored exec bit on ${fixed.length} helper binary(ies):`);
    for (const f of fixed) console.log(`  ${f}`);
  }
}

main();
