// ────────────────────────────────────────────────────────────────
// Scheduler replay (G5 §7.3): every fixture in `fixtures/scheduler/` is a
// whole v2 run recorded by the testkit (`replay-fixtures.v2.test.ts`) — the
// pinned graph, then one line per committed batch: the state `decide()`
// read, the message, the clock, and the decisions it made. Replaying must
// give the same decisions. An intentional semantic change regenerates the
// fixtures (`UPDATE_FIXTURES=1` on the testkit test) and is called out in
// review.
// ────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGraph, type WorkflowGraphInput } from '@generatorai/workflow-spec';
import { decide } from '../../src/domain/scheduler/decide.js';
import type { Decision, RunMessage, RunState } from '../../src/domain/scheduler/types.js';
import { compile } from '../../src/domain/workflow-graph/compile.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/scheduler');
const files = readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort();

describe('scheduler replay fixtures', () => {
  it('has fixtures', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`replays ${file} with identical decisions`, () => {
      const [head, ...lines] = readFileSync(join(DIR, file), 'utf8').split('\n').filter((l) => l.trim().length > 0);
      const compiled = compile(parseGraph((JSON.parse(head!) as { graph: WorkflowGraphInput }).graph));
      expect(lines.length).toBeGreaterThan(0);
      for (const [i, line] of lines.entries()) {
        const r = JSON.parse(line) as { state: RunState; message: RunMessage; now: number; decisions: Decision[] };
        expect(decide(compiled, r.state, r.message, r.now), `${file} line ${i + 2} (${r.message.type})`).toEqual(r.decisions);
      }
    });
  }
});
