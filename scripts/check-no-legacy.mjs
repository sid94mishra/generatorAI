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
//    packages/** and apps/** source (tests, dist and node_modules excluded),
//    plus the E2E suites and scripts that call the product (agent-tests/**,
//    whose specs ARE the scanned code, and scripts/**) and the feature docs
//    (.github/docs/**, against the entries marked `docs` only: the deleted
//    routes a reader could still call).
//    Entry shape: { "phase": "01", "pattern": "<regex source>",
//                   "paths"?: ["packages/core/src/"], "docs"?: true, "reason": "…" }
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
// The config itself is checked first (`configErrors`): a pattern with a
// control character — `"\b"` in JSON is U+0008, not a word boundary — or one
// that does not compile never matches anything, so it fails the check.
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
  'agent-tests/**/*.{ts,tsx,mts,cts,js,mjs,cjs,json}',
  'scripts/**/*.{ts,tsx,mts,cts,js,mjs,cjs,json}',
  '.github/docs/**/*.md',
];
const DOCS = '.github/docs/';

export const isExcluded = (f) =>
  /(^|\/)(node_modules|dist|dist-bundle|dist-electron|coverage|\.turbo|test-results|playwright-report)\//.test(f) ||
  /(^|\/)(__tests__|__mocks__|__snapshots__|__benchmarks__)\//.test(f) ||
  // agent-tests/ is end-to-end test code throughout: its specs are what the scan is for.
  (!f.startsWith('agent-tests/') && /\.(test|spec)\.[cm]?[jt]sx?$/.test(f)) ||
  /(^|\/)package-lock\.json$/.test(f) ||
  // The guard's own config and source name every banned identifier; E2E outputs are git-ignored.
  /^scripts\/(no-legacy\.json|check-no-legacy\.mjs)$/.test(f) ||
  /^scripts\/workflow-e2e\/out\//.test(f);

const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;

/** Problems with the config itself: a pattern that cannot match as intended. */
export function configErrors(config) {
  const errors = [];
  const check = (where, source) => {
    if (typeof source !== 'string' || source === '') return errors.push(`${where}: not a non-empty string`);
    if (CONTROL_CHAR.test(source)) {
      const ch = source.match(CONTROL_CHAR)[0].charCodeAt(0).toString(16).padStart(4, '0');
      return errors.push(`${where}: contains the control character U+${ch} (write a regex \\b as "\\\\b" in JSON)`);
    }
    try {
      new RegExp(source);
    } catch (err) {
      errors.push(`${where}: ${err.message}`);
    }
  };
  (config.banned ?? []).forEach((b, i) => check(`banned[${i}] (phase ${b.phase}) pattern`, b.pattern));
  (config.comments?.paths ?? []).forEach((p, i) => check(`comments.paths[${i}]`, p));
  return errors;
}

/** @returns {Array<{ file: string, line: number, phase: string, pattern: string, text: string }>} */
export function findLegacy(banned, files, read) {
  const compiled = banned.map((b) => ({ ...b, re: new RegExp(b.pattern) }));
  const hits = [];
  if (compiled.length === 0) return hits;
  for (const file of files) {
    // Docs are prose about the whole product: only the entries marked `docs` (deleted routes) apply there.
    const rules = file.startsWith(DOCS)
      ? compiled.filter((b) => b.docs === true)
      : compiled.filter((b) => !b.paths || b.paths.some((p) => file.startsWith(p)));
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
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const problems = configErrors(config);
  if (problems.length > 0) {
    for (const p of problems) console.error(`[no-legacy] config ${p}`);
    process.exit(1);
  }
  const { banned = [], comments } = config;
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
