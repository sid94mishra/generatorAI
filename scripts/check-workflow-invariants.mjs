#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Workflow-engine invariants (workflow overhaul P00 WP-0.6; README §2.2, R-4).
//
// Rule `no-direct-stage-status-write`: a stage run's `status` may only change
// through the repository's own transition methods. Flagged anywhere outside
// `packages/db/src/repositories/StageRunRepository.ts`:
//   - `<x>stageRunRepo.updateStatus(`            (any receiver ending in stageRunRepo)
//   - `<x>stageRunRepo.update(<id>, { … status … })`
//   - raw SQL `UPDATE stage_runs SET … status`
//
// MODE. P00 ships this REPORT-ONLY: it prints every hit and the count and
// exits 0, so the baseline is visible without blocking. PHASE-03 (which
// introduces `transition()` with compare-and-set) flips `MODE` to 'fail'
// in this file; from then on any hit fails `pnpm lint`.
//   node scripts/check-workflow-invariants.mjs [--json] [--fail]
//
// A single line can be waived with a trailing `// workflow-invariant-ok: <reason>`.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globFiles } from './lib/globFiles.mjs';

/** 'report' until PHASE-03 WP-3.x flips it to 'fail'. */
export const MODE = 'report';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['packages/*/src/**/*.{ts,tsx,mts}', 'apps/*/src/**/*.{ts,tsx,mts}'];
const ALLOW = new Set(['packages/db/src/repositories/StageRunRepository.ts']);
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

  const call = /\b\w*stageRunRepo\??\.(updateStatus|update)\s*\(/gi;
  for (let m; (m = call.exec(src)); ) {
    const open = m.index + m[0].length - 1;
    if (m[1] === 'updateStatus') {
      push(m.index, 'updateStatus');
      continue;
    }
    const args = callArgs(src, open) ?? '';
    // `status: …` or shorthand `status,` / `status }` inside the patch object.
    if (/[{,]\s*(['"]?)status\1\s*[:,}]/.test(args)) push(m.index, 'update({ status })');
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
        `outside StageRunRepository (${fail ? 'FAIL mode' : 'report-only until PHASE-03'})`,
    );
  }
  if (fail && hits.length > 0) process.exit(1);
}
