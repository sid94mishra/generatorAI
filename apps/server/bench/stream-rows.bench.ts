// ────────────────────────────────────────────────────────────────
// Stream write amplification of a workflow run (P07 WP-7.5, W-42).
//
// Runs T1 (start → 5 branches → join → final) on the testkit and routes
// every event the run emitted through the server's own scope fan-out
// (`streamRowsFor`, the rule the event store + bridge apply), counting the
// `stream_cursors` rows the run would write per event. P01 deleted the
// per-run JSONL log and P03 added the outbox, which removed the third copy
// F T9 measured (3 writes per event); W-42 is accepted at <= 2.2 rows per event.
//
// A soft check: a warning above 2.2, never a failure (the stream-index
// rewrite is a deferred follow-up, not a gate).
// Run with `pnpm --filter @generatorai/server bench`.
// ────────────────────────────────────────────────────────────────

import { afterAll, bench, describe } from 'vitest';
import { createTestEngine } from '@generatorai/workflow-testkit';
import { streamRowsFor } from '../src/composition/streamScopes.js';

const ACCEPTED_ROWS_PER_EVENT = 2.2;
const BRANCHES = ['b1', 'b2', 'b3', 'b4', 'b5'];
const T1 = {
  name: 't1-stream-rows',
  stages: [
    { name: 'start', prompt: 'Write one line containing the token START.' },
    ...BRANCHES.map((b) => ({ name: b, prompt: `Write one line containing the token ${b}.` })),
    { name: 'join', prompt: 'Write one line containing the token JOIN.' },
    { name: 'final', prompt: 'Write one line containing the token FINAL.' },
  ],
  edges: [...BRANCHES.map((b) => ['start', b] as const), ...BRANCHES.map((b) => [b, 'join'] as const), ['join', 'final'] as const],
};

let measured: { events: number; rows: number; byFamily: Record<string, { events: number; rows: number }> } | undefined;

describe('stream write amplification', () => {
  bench(
    'T1 run',
    async () => {
      const engine = await createTestEngine({
        script: Object.fromEntries(BRANCHES.map((b) => [b, [{ text: `${b} branch output: this line is long enough to be kept.`, delayMs: 20 }]])),
      });
      try {
        const run = await engine.runWorkflow(T1);
        await run.waitForTerminal(60_000);
        await engine.settle(200);
        // One logical event per emission (the testkit records a global event on both of its subscriptions).
        const seen = new Set<string>();
        const byFamily: Record<string, { events: number; rows: number }> = {};
        let events = 0;
        let rows = 0;
        for (const e of run.events) {
          const id = `${e.sessionId === '__global__' ? 'g' : e.sessionId}|${e.kind}|${JSON.stringify(e.data)}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const n = streamRowsFor({ sessionId: e.sessionId, kind: e.kind, data: e.data });
          const family = e.kind.split('.')[0] ?? e.kind;
          byFamily[family] = { events: (byFamily[family]?.events ?? 0) + 1, rows: (byFamily[family]?.rows ?? 0) + n };
          events += 1;
          rows += n;
        }
        measured = { events, rows, byFamily };
      } finally {
        await engine.dispose();
      }
    },
    { iterations: 1, time: 0, warmupIterations: 0 },
  );
});

afterAll(() => {
  if (!measured || measured.events === 0) return;
  const ratio = measured.rows / measured.events;
  console.log(`[bench] T1 stream rows: ${measured.rows} rows for ${measured.events} events = ${ratio.toFixed(2)} rows per event (accepted <= ${ACCEPTED_ROWS_PER_EVENT})`);
  for (const [family, f] of Object.entries(measured.byFamily)) console.log(`[bench]   ${family}: ${f.events} events, ${f.rows} rows`);
  if (ratio > ACCEPTED_ROWS_PER_EVENT) console.warn(`[bench] write amplification ${ratio.toFixed(2)} is over ${ACCEPTED_ROWS_PER_EVENT}: open a follow-up with these numbers (W-42)`);
});
