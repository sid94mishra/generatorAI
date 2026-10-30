// ────────────────────────────────────────────────────────────────
// The executable bit on native helper binaries that ship inside dependency
// tarballs — shared by the root `postinstall` (scripts/fix-native-exec-bits.mjs)
// and the desktop server-runtime staging (apps/desktop/scripts/
// stage-server-runtime.mjs), which installs its own copy of node-pty next to
// the server bundle and so never gets the postinstall's fix.
//
// node-pty does not spawn a shell directly on POSIX: it exec's a small
// `spawn-helper` binary that sets up the controlling terminal first. The
// packed archive does not reliably carry that file's mode to disk — installs
// can land it as 0644 — and nothing fails until the first terminal opens, as
// an opaque `posix_spawnp failed`. Windows needs no helper (ConPTY), so every
// function here is a no-op there.
// ────────────────────────────────────────────────────────────────

import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXEC_BITS = 0o111;

/** Every location a node-pty install can leave a helper binary (existing or not). */
export function nodePtyHelperCandidates(pkgDir) {
  const out = [];
  // Prebuilt path: prebuilds/<platform>-<arch>/spawn-helper
  const prebuilds = join(pkgDir, 'prebuilds');
  if (existsSync(prebuilds)) {
    for (const entry of readdirSync(prebuilds)) out.push(join(prebuilds, entry, 'spawn-helper'));
  }
  // Source-build path (node-gyp rebuild), used when no prebuild matches.
  out.push(join(pkgDir, 'build', 'Release', 'spawn-helper'));
  return out;
}

/**
 * The node-pty package directories under one `node_modules`: pnpm's store
 * (`.pnpm/node-pty@<ver>/node_modules/node-pty`) and the flat/hoisted layout.
 */
export function nodePtyDirs(nodeModulesDir) {
  const dirs = [];
  const store = join(nodeModulesDir, '.pnpm');
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('node-pty@')) continue;
      const dir = join(store, entry, 'node_modules', 'node-pty');
      if (existsSync(dir)) dirs.push(dir);
    }
  }
  const flat = join(nodeModulesDir, 'node-pty');
  if (existsSync(flat) && !dirs.includes(flat)) dirs.push(flat);
  return dirs;
}

/**
 * Give each existing file the exec bit wherever it has the read bit (a 0600
 * file becomes 0700, never world-executable). Returns the files changed.
 */
export function restoreExecBits(files, { platform = process.platform, warn = console.warn } = {}) {
  if (platform === 'win32') return [];
  const fixed = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const mode = statSync(file).mode;
    if ((mode & EXEC_BITS) === EXEC_BITS) continue;
    try {
      chmodSync(file, mode | ((mode & 0o444) >> 2));
      fixed.push(file);
    } catch (err) {
      warn(`[exec-bits] could not chmod ${file}: ${err.message}`);
    }
  }
  return fixed;
}

/** The node-pty helpers under `nodeModulesDir` that are present but not executable after the fix. */
export function restoreNodePtyExecBits(nodeModulesDir, options = {}) {
  const helpers = nodePtyDirs(nodeModulesDir).flatMap(nodePtyHelperCandidates);
  return restoreExecBits(helpers, options);
}

/** Helpers that exist and still lack an exec bit (always empty on Windows). */
export function nonExecutableNodePtyHelpers(nodeModulesDir, { platform = process.platform } = {}) {
  if (platform === 'win32') return [];
  return nodePtyDirs(nodeModulesDir)
    .flatMap(nodePtyHelperCandidates)
    .filter((file) => existsSync(file) && (statSync(file).mode & EXEC_BITS) !== EXEC_BITS);
}
