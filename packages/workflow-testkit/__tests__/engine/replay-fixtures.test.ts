// ────────────────────────────────────────────────────────────────
// Scheduler replay fixtures (G5 §7.3), recorded from whole v2 runs.
//
// Each committed batch of the actor is recorded as {state, message, now,
// decisions} with the run's pinned graph. This test replays every record
// through `decide()` and requires byte-identical decisions (determinism,
// G5 §7.2 invariant 10). With UPDATE_FIXTURES=1 it also writes the records
// to `packages/core/__tests__/fixtures/scheduler/*.jsonl`, which the core
// `replay.test.ts` replays on every run of the core suite, so a semantic
// change to `decide()` shows up as a fixture diff that review must accept.
// ────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { compile, decide, type DecideRecord } from '@generatorai/core';
import { createTestEngine, v2Adapter, type TestEngine, type WorkflowSpecJson } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../core/__tests__/fixtures/scheduler');

async function record(name: string, spec: WorkflowSpecJson, script: Record<string, Array<Record<string, unknown>>>): Promise<void> {
  const records: DecideRecord[] = [];
  engine = await createTestEngine({ adapter: v2Adapter({ onDecide: (r) => records.push(structuredClone(r)) }), script });
  const run = await engine.runWorkflow(spec);
  const snap = await run.waitForTerminal();
  expect(['completed', 'failed']).toContain(snap.run.status);
  const graph = await engine.services.runDefinitionReader.get(snap.run.definitionVersionId);
  const compiled = compile(graph);
  const mine = records.filter((r) => r.runId === run.runId);
  expect(mine.length).toBeGreaterThan(5);
  for (const r of mine) expect(decide(compiled, r.state, r.message, r.now)).toEqual(r.decisions);
  if (process.env['UPDATE_FIXTURES'] === '1') {
    mkdirSync(FIXTURES, { recursive: true });
    // Engine bookkeeping variables hold machine paths; no expression reads them.
    const scrub = (r: DecideRecord) => ({
      ...r.state,
      run: { ...r.state.run, variables: Object.fromEntries(Object.entries(r.state.run.variables).map(([k, v]) => [k, k.startsWith('__') ? '<scrubbed>' : v])) },
    });
    const lines = [JSON.stringify({ kind: 'graph', graph }), ...mine.map((r) => JSON.stringify({ state: scrub(r), message: r.message, now: r.now, decisions: r.decisions }))];
    writeFileSync(join(FIXTURES, `${name}.jsonl`), `${lines.join('\n')}\n`);
  }
}

describe('scheduler replay fixtures (engine)', () => {
  it('fan-out and join', async () => {
    await record(
      'fanout-join',
      {
        name: 'replay-fanout',
        stages: [
          { name: 'start', prompt: 'S' },
          { name: 'left', prompt: 'L' },
          { name: 'right', prompt: 'R' },
          { name: 'join', prompt: 'J', context: { mode: 'output' } },
        ],
        edges: [
          ['start', 'left'],
          ['start', 'right'],
          ['left', 'join'],
          ['right', 'join'],
        ],
      },
      {},
    );
  });

  it('a retry, then failure routing', async () => {
    await record(
      'retry-failure-route',
      {
        name: 'replay-retry',
        stages: [
          { name: 'f', prompt: 'F', retry: { maxAttempts: 2, initialDelayMs: 50, backoffMultiplier: 1 } },
          { name: 'ok', prompt: 'OK' },
          { name: 'recover', prompt: 'RECOVER' },
        ],
        edges: [
          ['f', 'ok', 'success'],
          ['f', 'recover', 'failure'],
        ],
      },
      { f: [{ error: { message: 'upstream overloaded (1)' } }, { error: { message: 'upstream overloaded (2)' } }] },
    );
  });
});
