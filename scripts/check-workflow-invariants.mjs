#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Workflow-engine invariants (workflow overhaul P00 WP-0.6; README §2.2, R-4).
//
// Rule `no-direct-stage-status-write`: a stage run's `status` may only change
// through the repository's own transition methods. Flagged anywhere outside
// `packages/db/src/repositories/StageRunRepository.ts` and the v2 engine's CAS
// implementation behind it (`engineCas.ts`, and `RunStore.ts` which applies
// decision batches through it, P03 WP-3.1):
//   - `<x>stageRunRepo.updateStatus(` and `.batchUpdateStatus(` (any receiver
//     ending in stageRunRepo, including `this.stageRunRepo!.` and `?.`)
//   - `<x>stageRunRepo.update(<id>, { … status … })`
//   - `<x>stageRunRepo.update(<id>, <patch variable>)`: the patch cannot be
//     inspected statically, so it counts as a possible status write
//   - raw SQL `UPDATE stage_runs SET … status`
//
// MODE. P00 shipped this report-only with a baseline of 24 hits; PHASE-03
// deleted the v1 engine (the engine's compare-and-set `transition()` is the
// only status writer) and flipped `MODE` to 'fail': any hit fails `pnpm lint`.
//   node scripts/check-workflow-invariants.mjs [--json]
//
// A single line can be waived with a trailing `// workflow-invariant-ok: <reason>`.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globFiles } from './lib/globFiles.mjs';

/** A hard failure since the P03 cutover (WP-3.7). */
export const MODE = 'fail';

/** Direct writes tolerated: none since the P03 cutover (P00 recorded 24). */
export const BASELINE = 0;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['packages/*/src/**/*.{ts,tsx,mts}', 'apps/*/src/**/*.{ts,tsx,mts}'];
const ALLOW = new Set([
  'packages/db/src/repositories/StageRunRepository.ts',
  'packages/db/src/repositories/engineCas.ts',
  'packages/db/src/repositories/RunStore.ts',
]);
const WAIVER = /\/\/\s*workflow-invariant-ok:/;

const isTestFile = (f) => /(^|\/)(__tests__|__mocks__)\//.test(f) || /\.(test|spec)\.[cm]?tsx?$/.test(f);

/** Text of a call's argument list starting at the `(` at `open`, or null. */
function callArgs(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** The second top-level argument of an argument list (trimmed), or ''. */
export function secondArg(args) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return (parts[1] ?? '').trim();
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** @returns {Array<{ file: string, line: number, kind: string, text: string }>} */
export function scanSource(file, src) {
  const hits = [];
  const lines = src.split('\n');
  const push = (index, kind) => {
    const line = lineOf(src, index);
    const text = lines[line - 1] ?? '';
    if (WAIVER.test(text)) return;
    hits.push({ file, line, kind, text: text.trim() });
  };

  const call = /\b\w*stageRunRepo\s*!?\s*\??\.\s*(batchUpdateStatus|updateStatus|update)\s*\(/gi;
  for (let m; (m = call.exec(src)); ) {
    const open = m.index + m[0].length - 1;
    if (m[1] !== 'update') {
      push(m.index, m[1]);
      continue;
    }
    const patch = secondArg(callArgs(src, open) ?? '');
    if (patch.startsWith('{')) {
      // `status: …` or shorthand `status,` / `status }` inside the literal.
      if (/[{,]\s*(['"]?)status\1\s*[:,}]/.test(patch)) push(m.index, 'update({ status })');
    } else if (patch) {
      // A patch variable cannot be inspected statically: a possible status write.
      push(m.index, 'update(id, <patch variable>)');
    }
  }

  const sql = /UPDATE\s+stage_runs\s+SET\b[^;`'"]*\bstatus\b/gi;
  for (let m; (m = sql.exec(src)); ) push(m.index, 'SQL UPDATE stage_runs SET status');
  return hits;
}

export function scanRepo(root = repoRoot) {
  const files = new Set();
  for (const g of SCAN) for (const f of globFiles(g, root)) files.add(f.replace(/\\/g, '/'));
  const hits = [];
  for (const f of [...files].sort()) {
    if (ALLOW.has(f) || isTestFile(f)) continue;
    hits.push(...scanSource(f, readFileSync(resolve(root, f), 'utf8')));
  }
  return hits;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fail = MODE === 'fail' || process.argv.includes('--fail');
  const hits = scanRepo();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ rule: 'no-direct-stage-status-write', mode: fail ? 'fail' : 'report', count: hits.length, hits }, null, 2));
  } else {
    for (const h of hits) console.log(`  ${h.file}:${h.line}  [${h.kind}]  ${h.text.slice(0, 110)}`);
    console.log(
      `[workflow-invariants] no-direct-stage-status-write: ${hits.length} direct stage status write(s) ` +
        `outside the engine compare-and-set (${fail ? 'FAIL mode' : `report-only; baseline ${BASELINE}`})`,
    );
  }
  if (fail && hits.length > 0) process.exit(1);
  if (hits.length > BASELINE) {
    console.error(`[workflow-invariants] ${hits.length} > baseline ${BASELINE}: a new direct stage status write was added`);
    process.exit(1);
  }
}
