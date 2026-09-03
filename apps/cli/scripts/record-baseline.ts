// ────────────────────────────────────────────────────────────────
// Records the startup and hot-path baselines (Phase 0 item 4).
//
//   pnpm --filter @generatorai/cli baseline
//   pnpm --filter @generatorai/cli baseline --json
//
// The audit asks to "record cold start, memory, idle CPU, event throughput,
// and frame timing baselines". Three of those are honest to measure from a
// script, and three are not — so this measures the three and says plainly
// that it is not measuring the others, rather than reporting a number
// obtained some other way and calling it the same thing:
//
//   MEASURED   cold start (process spawn to a completed `--version`),
//              resident memory after the registry and keymap are built,
//              event throughput through the timeline reducer.
//
//   NOT HERE   idle CPU with ten attached tabs, and frame timing. Both are
//              properties of a RUNNING terminal under a real render loop.
//              Approximating them from a script would produce a number that
//              looks like the budget and answers a different question, which
//              is worse than no number: it would be quoted.
//
// Everything below runs against the built package, not a dev server, because
// a cold-start number measured through `tsx` is measuring `tsx`.
// ────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildRegistry, emptyTimeline, Keymap, reduceEvent } from '@generatorai/cli-core';

const here = dirname(fileURLToPath(import.meta.url));
const bundled = resolve(here, '../dist-bundle/generatorai.mjs');

interface Sample {
  measure: string;
  value: number;
  unit: string;
  budget?: string;
  note?: string;
}

/** Median rather than mean: one scheduler hiccup should not move the number. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const samples: Sample[] = [];

// ── Cold start ────────────────────────────────────────────────────
//
// Reported against a measured BASELINE, not raw.
//
// An earlier version of this script reported the raw wall time and called it
// "cold start". On the machine it was written on, `node -e 0` alone takes
// ~400 ms — so that figure was almost entirely Node's own startup, and the
// conclusion drawn from it ("the CLI misses its 250 ms budget") was about
// the machine, not the code. A number that attributes the platform's floor
// to the application is worse than no number: it sends someone optimising
// the wrong thing.
if (existsSync(bundled)) {
  const timeSpawn = (args: string[]): number | null => {
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
      if (result.status !== 0) {
        process.stderr.write(`probe failed: ${result.stderr}\n`);
        return null;
      }
      runs.push(performance.now() - start);
    }
    return median(runs);
  };

  // Same spawn mechanism, so everything except loading this CLI cancels out.
  const floor = timeSpawn(['-e', '0']);
  const total = timeSpawn([bundled, '--version']);

  if (floor !== null && total !== null) {
    samples.push({
      measure: 'Node process floor (`node -e 0`)',
      value: Math.round(floor),
      unit: 'ms',
      note: 'What this machine costs before any of our code runs. The app can never be faster than this.',
    });
    samples.push({
      measure: 'Cold start, total (spawn → `--version` exits)',
      value: Math.round(total),
      unit: 'ms',
      budget: 'p95 below 250 ms to first stable frame',
    });
    samples.push({
      measure: "Cold start, this CLI's own share",
      value: Math.round(total - floor),
      unit: 'ms',
      note: 'Total minus the process floor — the part that is ours to fix. Still a lower bound on the real budget: no terminal, no connection, no first paint.',
    });
  }
} else {
  samples.push({
    measure: 'Cold start',
    value: Number.NaN,
    unit: 'ms',
    note: 'Skipped — run `pnpm --filter @generatorai/cli bundle` first; measuring through tsx would be measuring tsx.',
  });
}

// ── Registry and keymap construction ──────────────────────────────
{
  const runs: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    buildRegistry();
    runs.push(performance.now() - start);
  }
  samples.push({
    measure: 'Registry construction',
    value: Number(median(runs).toFixed(2)),
    unit: 'ms',
    note: 'Every surface (binary, palette, completions, RPC, docs) is derived from this; it happens once per process.',
  });
}
{
  const runs: number[] = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    new Keymap();
    runs.push(performance.now() - start);
  }
  samples.push({
    measure: 'Keymap construction (incl. conflict detection)',
    value: Number(median(runs).toFixed(3)),
    unit: 'ms',
  });
}

// ── Event throughput ──────────────────────────────────────────────
{
  const EVENTS = 50_000;
  let state = emptyTimeline();
  state = reduceEvent(state, { kind: 'harness.turn_start', data: {} });
  const start = performance.now();
  for (let i = 0; i < EVENTS; i++) {
    // `text` is the field every provider actually broadcasts; `delta`
    // would hit the reducer's empty-text early return and benchmark
    // nothing.
    state = reduceEvent(state, { kind: 'harness.token', data: { text: 'x' } }, { maxItems: 2000 });
  }
  const elapsed = performance.now() - start;
  samples.push({
    measure: 'Timeline reducer throughput',
    value: Math.round(EVENTS / (elapsed / 1000)),
    unit: 'events/s',
    budget: 'ingest → queued update p95 below 16 ms',
    note: 'The soak budget is 100 events/s; this is the headroom above it.',
  });
  samples.push({
    measure: 'Timeline items retained after 50k events',
    value: state.items.length,
    unit: 'items',
    budget: 'bounded',
  });
}

// ── Memory ────────────────────────────────────────────────────────
{
  const used = process.memoryUsage();
  samples.push({
    measure: 'Heap used after registry + keymap + 50k events',
    value: Math.round(used.heapUsed / 1024 / 1024),
    unit: 'MB',
  });
  samples.push({
    measure: 'RSS after the same',
    value: Math.round(used.rss / 1024 / 1024),
    unit: 'MB',
  });
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ node: process.version, platform: process.platform, samples }, null, 2)}\n`);
} else {
  process.stdout.write(`Baseline — node ${process.version} on ${process.platform}\n\n`);
  for (const sample of samples) {
    const value = Number.isNaN(sample.value) ? '—' : `${sample.value} ${sample.unit}`;
    process.stdout.write(`  ${sample.measure.padEnd(48)} ${value}\n`);
    if (sample.budget) process.stdout.write(`      budget: ${sample.budget}\n`);
    if (sample.note) process.stdout.write(`      ${sample.note}\n`);
  }
  process.stdout.write(
    '\n  Not measured here (properties of a running terminal, not of this code):\n' +
      '    idle CPU with ten attached quiet tabs, frame timing, resize recovery.\n' +
      '    Those belong to the real-console smoke tests.\n',
  );
}
