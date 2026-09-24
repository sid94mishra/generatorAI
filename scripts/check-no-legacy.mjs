#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// No-legacy guard for the workflow overhaul (P00 WP-0.6; README §7 step 6,
// rules R-1/R-2).
//
// Every phase that deletes a legacy path appends the identifiers it removed
// to `scripts/no-legacy.json`. This script greps packages/** and apps/**
// (source only: tests, dist and node_modules excluded) and FAILS on any hit,
// so a deleted shim, alias, route or column name cannot creep back in.
// The list is cumulative: every entry applies from the phase that added it on.
//
// Entry shape: { "phase": "01", "pattern": "<regex source>",
//                "paths"?: ["packages/core/src/"], "reason": "…" }
//
//   node scripts/check-no-legacy.mjs [--config <file>]
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globFiles } from './lib/globFiles.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = [
  'packages/**/*.{ts,tsx,mts,cts,js,mjs,cjs,json,sql}',
  'apps/**/*.{ts,tsx,mts,cts,js,mjs,cjs,json,sql}',
];

const isExcluded = (f) =>
  /(^|\/)(node_modules|dist|dist-bundle|dist-electron|coverage|\.turbo)\//.test(f) ||
  /(^|\/)(__tests__|__mocks__|__snapshots__|__benchmarks__)\//.test(f) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) ||
  /(^|\/)package-lock\.json$/.test(f);

/** @returns {Array<{ file: string, line: number, phase: string, pattern: string, text: string }>} */
export function findLegacy(banned, files, read) {
  const compiled = banned.map((b) => ({ ...b, re: new RegExp(b.pattern) }));
  const hits = [];
  if (compiled.length === 0) return hits;
  for (const file of files) {
    const rules = compiled.filter((b) => !b.paths || b.paths.some((p) => file.startsWith(p)));
    if (rules.length === 0) continue;
    const lines = read(file).split('\n');
    lines.forEach((text, i) => {
      for (const b of rules) {
        if (b.re.test(text)) hits.push({ file, line: i + 1, phase: b.phase, pattern: b.pattern, text: text.trim() });
      }
    });
  }
  return hits;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ci = process.argv.indexOf('--config');
  const configPath = ci === -1 ? resolve(repoRoot, 'scripts', 'no-legacy.json') : resolve(process.argv[ci + 1]);
  const { banned = [] } = JSON.parse(readFileSync(configPath, 'utf8'));
  const files = new Set();
  if (banned.length > 0) {
    for (const g of SCAN) for (const f of globFiles(g, repoRoot)) files.add(f.replace(/\\/g, '/'));
  }
  const scanned = [...files].filter((f) => !isExcluded(f)).sort();
  const hits = findLegacy(banned, scanned, (f) => readFileSync(resolve(repoRoot, f), 'utf8'));
  for (const h of hits) console.log(`  ${h.file}:${h.line}  [P${h.phase} /${h.pattern}/]  ${h.text.slice(0, 110)}`);
  console.log(
    `[no-legacy] ${banned.length} banned pattern(s), ${scanned.length} file(s) scanned, ${hits.length} hit(s)`,
  );
  if (hits.length > 0) process.exit(1);
}
