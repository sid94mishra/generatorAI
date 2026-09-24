#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// No-legacy guard for the workflow overhaul (P00 WP-0.6; README §7 step 6,
// rules R-1/R-2).
//
// Two rules, both configured in `scripts/no-legacy.json`:
//
// 1. BANNED IDENTIFIERS (`banned`, always fails). Every phase that deletes a
//    legacy path appends the identifiers it removed, so a deleted shim, alias,
//    route or column name cannot creep back in. Cumulative. Greps
//    packages/** and apps/** source (tests, dist and node_modules excluded).
//    Entry shape: { "phase": "01", "pattern": "<regex source>",
//                   "paths"?: ["packages/core/src/"], "reason": "…" }
//
// 2. LEGACY COMMENTS in the workflow module (`comments`): `@deprecated`,
//    `legacy`, `backward compat`, `fallback for old` inside a COMMENT of a
//    file matched by `comments.paths` (regex sources). Report-only until the
//    configured `phase` reaches `failFromPhase`; while report-only it still
//    fails when the count GROWS past `baseline` (a ratchet), so no phase can
//    add new legacy-flavoured code while the old is being removed. The phase
//    that clears the module sets `failFromPhase` to itself; every phase bumps
//    `phase` and lowers `baseline` as comments go.
//
//   node scripts/check-no-legacy.mjs [--config <file>] [--json]
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

export const isExcluded = (f) =>
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

/**
 * The comment part of a source line: the whole line for block-comment
 * lines (`/*`, ` *`) and line comments, else what follows the first `//`
 * that is not part of a URL scheme. Deliberately simple — it errs towards
 * reading a string's `//` as a comment, never towards missing a comment.
 */
export function commentText(line) {
  const t = line.trimStart();
  if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return t;
  const m = /(?<![:\w])\/\/|\/\*/.exec(line);
  return m ? line.slice(m.index) : '';
}

export const LEGACY_COMMENT = /@deprecated|\blegacy\b|backward[- ]?compat|fallback for old/i;

/** @returns {Array<{ file: string, line: number, text: string }>} */
export function findLegacyComments(files, pathPatterns, read) {
  const scopes = pathPatterns.map((p) => new RegExp(p));
  const hits = [];
  for (const file of files) {
    if (!scopes.some((re) => re.test(file))) continue;
    read(file)
      .split('\n')
      .forEach((line, i) => {
        if (LEGACY_COMMENT.test(commentText(line))) hits.push({ file, line: i + 1, text: line.trim() });
      });
  }
  return hits;
}

/** Report-only until `phase` >= `failFromPhase`; always fails above `baseline`. */
export function commentVerdict(comments, count) {
  const failMode = comments.failFromPhase != null && String(comments.phase) >= String(comments.failFromPhase);
  if (failMode) return { mode: 'fail', fail: count > 0 };
  return { mode: 'report', fail: typeof comments.baseline === 'number' && count > comments.baseline };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ci = process.argv.indexOf('--config');
  const configPath = ci === -1 ? resolve(repoRoot, 'scripts', 'no-legacy.json') : resolve(process.argv[ci + 1]);
  const { banned = [], comments } = JSON.parse(readFileSync(configPath, 'utf8'));
  const files = new Set();
  for (const g of SCAN) for (const f of globFiles(g, repoRoot)) files.add(f.replace(/\\/g, '/'));
  const scanned = [...files].filter((f) => !isExcluded(f)).sort();
  const read = (f) => readFileSync(resolve(repoRoot, f), 'utf8');

  const hits = findLegacy(banned, scanned, read);
  const commentHits = comments ? findLegacyComments(scanned, comments.paths ?? [], read) : [];
  const verdict = comments ? commentVerdict(comments, commentHits.length) : { mode: 'off', fail: false };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ banned: hits, comments: { ...verdict, count: commentHits.length, hits: commentHits } }, null, 2));
  } else {
    for (const h of hits) console.log(`  ${h.file}:${h.line}  [P${h.phase} /${h.pattern}/]  ${h.text.slice(0, 110)}`);
    for (const h of commentHits) console.log(`  ${h.file}:${h.line}  [legacy comment]  ${h.text.slice(0, 110)}`);
  }
  if (!process.argv.includes('--json')) console.log(`[no-legacy] ${banned.length} banned pattern(s), ${scanned.length} file(s) scanned, ${hits.length} hit(s)`);
  if (comments && !process.argv.includes('--json')) {
    console.log(
      `[no-legacy] legacy comments in the workflow module: ${commentHits.length} ` +
        `(baseline ${comments.baseline}, ${verdict.mode === 'fail' ? 'FAIL mode' : `report-only until phase ${comments.failFromPhase ?? '(not set)'}`})`,
    );
  }
  if (hits.length > 0 || verdict.fail) process.exit(1);
}
