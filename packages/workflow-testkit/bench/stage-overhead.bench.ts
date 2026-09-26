// ────────────────────────────────────────────────────────────────
// Engine overhead per stage (P07 WP-7.1, W-49).
//
// A linear chain on the zero-latency FauxProvider: every millisecond between
// the run entering `running` and the last stage completing is the engine's (claim,
// compose, journal, validate, settle, decide, the next launch). Target:
// under 150 ms per stage.
//
// A soft gate against `baseline.json`: a warning when slower than the
// baseline, a failure only when more than 25% worse (or over the target).
// Run with `pnpm --filter @generatorai/workflow-testkit bench`.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { afterAll, bench, describe } from 'vitest';
import { createTestEngine } from '../src/index.js';

const STAGES = 10;
const TARGET_MS_PER_STAGE = 150;

const CHAIN = {
  name: 'bench-chain',
  stages: Array.from({ length: STAGES }, (_, i) => ({ name: `s${i}`, prompt: `Step ${i}: reply with one line.` })),
  edges: Array.from({ length: STAGES - 1 }, (_, i) => [`s${i}`, `s${i + 1}`] as const),
};

const samples: number[] = [];

describe('stage overhead', () => {
  bench(
    `${STAGES}-stage chain, zero-latency provider`,
    async () => {
      const engine = await createTestEngine();
      try {
        const run = await engine.runWorkflow(CHAIN);
        const snap = await run.waitForTerminal(60_000);
        if (snap.run.status !== 'completed') throw new Error(`the bench run ended ${snap.run.status}`);
        // From the run entering `running` (after the prepare phases) to the last stage completing.
        const started = snap.events.find((e) => e.kind === 'workflow_run.running')!.at;
        const ended = Math.max(...snap.events.filter((e) => e.kind === 'stage_run.completed').map((e) => e.at));
        samples.push((ended - started) / STAGES);
      } finally {
        await engine.dispose();
      }
    },
    { iterations: 5, time: 0, warmupIterations: 1 },
  );
});

afterAll(() => {
  if (samples.length === 0) return;
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const baseline = (JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8')) as { stageOverheadMs: number }).stageOverheadMs;
  console.log(`[bench] engine overhead per stage: median ${median.toFixed(1)} ms (baseline ${baseline} ms, target < ${TARGET_MS_PER_STAGE} ms)`);
  if (median > baseline) console.warn(`[bench] slower than the baseline by ${(((median - baseline) / baseline) * 100).toFixed(0)}%`);
  if (median > baseline * 1.25 || median > TARGET_MS_PER_STAGE) {
    throw new Error(`Engine overhead per stage ${median.toFixed(1)} ms is over 1.25x the baseline (${baseline} ms) or the ${TARGET_MS_PER_STAGE} ms target`);
  }
});
