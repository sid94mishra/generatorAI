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
// The logic lives in scripts/lib/nativeExecBits.mjs (the desktop runtime
// staging uses it too).
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

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreNodePtyExecBits } from './lib/nativeExecBits.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const fixed = restoreNodePtyExecBits(join(repoRoot, 'node_modules'));
if (fixed.length > 0) {
  console.log(`[fix-native-exec-bits] restored exec bit on ${fixed.length} helper binary(ies):`);
  for (const f of fixed) console.log(`  ${f.slice(repoRoot.length)}`);
}
