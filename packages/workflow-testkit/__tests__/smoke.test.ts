import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

describe('testkit smoke', () => {
  it('runs a two-stage linear workflow to completion', async () => {
    engine = await createTestEngine({ script: { A: [{ text: 'A says hello, and this line is long enough to count.' }] } });
    const run = await engine.runWorkflow({
      stages: [{ name: 'A', prompt: 'do A' }, { name: 'B', prompt: 'do B' }],
      edges: [['A', 'B']],
    });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect(snap.stages['A']!.outputText).toContain('A says hello');
    expect(snap.stages['B']!.status).toBe('completed');
    console.log(snap.calls.map((c) => `${c.stageName}:${c.kind}`).join(' '));
  });
});
