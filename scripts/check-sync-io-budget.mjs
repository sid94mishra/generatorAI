#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Sync-IO budget — PART 11.1: "No new synchronous filesystem or process call
// on the event loop · Lint tripwire with a **shrink-only allowance**."
//
// The allowance is the whole point. There are already ~30 synchronous call
// sites in boot paths, and most are defensible: reading a config file before
// the server listens blocks nothing that exists yet. Turning the rule into a
// hard error on day one would have failed the build immediately, and the
// realistic outcome of that is the rule gets deleted, not the calls.
//
// So the ESLint rule is a `warn` (visible in every lint run, never blocking)
// and this script supplies the teeth: it counts the warnings and fails when
// the count goes UP. New synchronous IO is rejected; existing sites can be
// paid down whenever someone is in the file anyway, and the baseline ratchets
// down with them.
//
// To pay one down: convert it to the promises API, then run this with
// `--update` to lower the baseline.
//
// Run: node scripts/check-sync-io-budget.mjs [--update]
// ────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselineFile = join(repoRoot, 'scripts', 'sync-io-baseline.json');

/** The two messages this budget ratchets, matched by their distinctive prefix. */
const GOVERNED = [
  'Synchronous filesystem call on the event loop',
  'Synchronous process spawn on the event loop',
];

/**
 * The backpressure rule is held at exactly ZERO, not ratcheted.
 *
 * It shares an ESLint entry (and therefore a severity) with the two above,
 * because flat config replaces `no-restricted-syntax` wholesale when a later
 * block targets the same files. So its severity is `warn` like theirs — and
 * this is where it gets its teeth. There is nothing to grandfather: the count
 * is zero today, so any violation is new by definition.
 */
const ZERO_TOLERANCE = "Manual 'data' → write() ignores backpressure";

function isGoverned(message) {
  return GOVERNED.some((g) => message.startsWith(g));
}

function isZeroTolerance(message) {
  return message.startsWith(ZERO_TOLERANCE);
}

let raw;
try {
  // `--format json` so we count structurally rather than by scraping text.
  // ESLint exits non-zero when anything is reported, including warnings, so
  // the output has to be captured from the error path too.
  // Invoke ESLint's JS entry with the current node rather than the `npx`
  // shim: on Windows `spawnSync` refuses a `.cmd` target with EINVAL unless
  // a shell is used, and using a shell would mean quoting this path.
  raw = execFileSync(
    process.execPath,
    [join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js'), '.', '--format', 'json'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (err) {
  raw = err.stdout;
  if (!raw) {
    console.error('❌ Could not run ESLint to count synchronous-IO warnings.');
    console.error(String(err.stderr ?? err.message).slice(0, 2000));
    process.exit(1);
  }
}

let results;
try {
  results = JSON.parse(raw);
} catch {
  console.error('❌ ESLint did not produce parseable JSON output.');
  process.exit(1);
}

// A partial ESLint run must never be treated as a clean one.
//
// ESLint exits non-zero both for "found lint problems" (expected — this repo
// has warnings) and for a hard failure such as a file vanishing mid-scan,
// which happens when something else is writing to the tree. In the failure
// case `stdout` can be empty or cover a handful of files, and this script
// would then record a baseline of ~0 — silently deleting the ratchet it
// exists to hold. A repo this size always lints thousands of files, so a tiny
// result set is proof the run did not complete.
const MIN_EXPECTED_FILES = 500;
if (!Array.isArray(results) || results.length < MIN_EXPECTED_FILES) {
  console.error(
    `❌ ESLint reported only ${Array.isArray(results) ? results.length : 0} files ` +
      `(expected at least ${MIN_EXPECTED_FILES}). The run did not complete, so its\n` +
      'count cannot be trusted — refusing to check or update the baseline.\n' +
      'If another process is writing to the working tree, let it finish and retry.',
  );
  process.exit(1);
}

/** @type {Record<string, number>} */
const byFile = {};
let total = 0;
/** @type {string[]} */
const backpressure = [];
for (const file of results) {
  const rel = file.filePath.slice(repoRoot.length + 1).split('\\').join('/');
  for (const m of file.messages ?? []) {
    if (isZeroTolerance(m.message ?? '')) backpressure.push(`${rel}:${m.line}`);
  }
  const hits = (file.messages ?? []).filter((m) => isGoverned(m.message ?? '')).length;
  if (hits === 0) continue;
  byFile[rel] = hits;
  total += hits;
}

if (backpressure.length > 0) {
  console.error(
    `❌ ${backpressure.length} backpressure violation(s) — this rule allows zero.\n\n` +
      "A manual 'data' → write() ignores backpressure: measured ~17x memory for\n" +
      'no throughput gain (PART 11.1). Use pipe()/pipeline(), or await the write\n' +
      'and pause the source.\n',
  );
  for (const site of backpressure) console.error(`   ${site}`);
  process.exit(1);
}

if (process.argv.includes('--update')) {
  // `--update` may only ratchet DOWN.
  //
  // Without this, the guard is self-service: add synchronous IO, run
  // `--update`, commit the raised baseline, and CI is green — which is not a
  // ratchet, it is a formality. Refusing an upward update means the only way
  // past this check is to fix the call site or add an explicit
  // eslint-disable naming the reason, both of which leave a reviewable trace.
  if (existsSync(baselineFile)) {
    const current = JSON.parse(readFileSync(baselineFile, 'utf8'));
    if (total > current.total) {
      console.error(
        `❌ Refusing to raise the baseline: ${current.total} → ${total}.\n\n` +
          'This budget may only shrink (PART 11.1: "shrink-only allowance").\n' +
          'Use the promises API for the new call, or — if it is genuinely\n' +
          'boot-only or in a child process — add an eslint-disable naming that\n' +
          'reason, which removes it from the count honestly.\n\n' +
          'If the baseline itself is wrong (e.g. it was written from an\n' +
          'incomplete run), delete it and re-run --update to re-establish it.\n',
      );
      for (const [file, count] of Object.entries(byFile)) {
        const was = current.byFile?.[file] ?? 0;
        if (count > was) console.error(`   ${file}: ${was} → ${count}`);
      }
      process.exit(1);
    }
  }
  // No replacer array here: `JSON.stringify(obj, keys, 2)` filters by those
  // keys at EVERY level, so passing the top-level names silently erased every
  // file path inside `byFile` and produced a baseline that could not name
  // which file grew.
  const sortedByFile = Object.fromEntries(Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselineFile, `${JSON.stringify({ total, byFile: sortedByFile }, null, 2)}\n`);
  console.log(`✅ Baseline updated: ${total} synchronous-IO call sites.`);
  process.exit(0);
}

if (!existsSync(baselineFile)) {
  console.error(
    `❌ No baseline at ${baselineFile}. Create it once with:\n` +
      '     node scripts/check-sync-io-budget.mjs --update',
  );
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));

if (total > baseline.total) {
  console.error(
    `❌ Synchronous IO on the event loop increased: ${baseline.total} → ${total}.\n\n` +
      'PART 11.1 allows this count to shrink, never to grow. Use the promises\n' +
      'API for the new call. If it is genuinely boot-only — before the server\n' +
      'listens, or inside a child process — add an eslint-disable naming that\n' +
      'reason, which removes it from this count honestly.\n',
  );

  // Name the files that grew, so the offending change is obvious.
  for (const [file, count] of Object.entries(byFile)) {
    const was = baseline.byFile?.[file] ?? 0;
    if (count > was) console.error(`   ${file}: ${was} → ${count}`);
  }
  process.exit(1);
}

if (total < baseline.total) {
  console.log(
    `✅ Synchronous IO shrank: ${baseline.total} → ${total}. ` +
      'Lower the baseline with `node scripts/check-sync-io-budget.mjs --update`.',
  );
  process.exit(0);
}

console.log(`✅ Synchronous IO on the event loop holding at ${total} call sites (no growth).`);
