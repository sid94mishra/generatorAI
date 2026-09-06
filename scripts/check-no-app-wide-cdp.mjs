#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// CI guard: fail the build if the app-wide `--remote-debugging-port`
// Chromium switch reappears under apps/desktop/src/**. That flag exposes
// EVERY webContents in the app (including the main SPA window and its
// privileged preload bridge) over one unauthenticated loopback port — see
// apps/desktop/src/main/cdp/ScopedCdpProxy.ts for the per-tab, authenticated
// replacement. Matches the actual dangerous call (`appendSwitch('remote-
// debugging-port', ...)`), not prose mentions of the string in comments
// explaining why it was removed.
//
// Run: node scripts/check-no-app-wide-cdp.mjs
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
// Not `globSync` from node:fs — it only landed in Node 22 and the engine floor was Node 20 when this was written, so
// every checker in the root `lint` chain died at import before its first rule.
import { globFiles } from './lib/globFiles.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = resolve(repoRoot, 'apps', 'desktop', 'src');

const DANGEROUS_PATTERN = /appendSwitch\(\s*['"]remote-debugging-(port|address)['"]/;

const files = globFiles('**/*.ts', targetDir).map((f) => resolve(targetDir, f));
const offenders = [];
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  if (DANGEROUS_PATTERN.test(content)) offenders.push(file);
}

if (offenders.length > 0) {
  console.error('❌ Found app-wide --remote-debugging-port/--remote-debugging-address usage:');
  for (const f of offenders) console.error(`   ${f}`);
  console.error(
    '\nThis switch exposes every webContents in the app (including the main\n' +
      'SPA window) over one unauthenticated loopback port. Use a per-tab\n' +
      'ScopedCdpProxy (apps/desktop/src/main/cdp/ScopedCdpProxy.ts) instead.',
  );
  process.exit(1);
}

console.log('✅ No app-wide CDP debugging switch found under apps/desktop/src/**');
