import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

describe('testkit smoke', () => {
  it('runs a two-stage linear workflow to completion on the engine', async () => {
    engine = await createTestEngine({ script: { A: [{ text: 'A says hello, and this line is long enough to count.' }] } });
    expect(engine.adapter.name).toBe('v2');
    const run = await engine.runWorkflow({
      stages: [{ name: 'A', prompt: 'do A' }, { name: 'B', prompt: 'do B' }],
      edges: [['A', 'B']],
    });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    // Instances are keyed by instance path: the stage key at the top level.
    expect(snap.stages['a']!.outputText).toContain('A says hello');
    expect(snap.stages['a']!.instancePath).toBe('a');
    expect(snap.stages['b']!.status).toBe('completed');
    // B reads A's summary (context mode `summary`): A's output is short, so its
    // `auto` summary is deterministic (no summary turn, P07 WP-7.1); the context
    // rides in B's first prompt, and the leaf B pays no summary turn (W-48, W-49).
    expect(snap.calls.map((c) => `${c.stageName}:${c.kind}`)).toEqual(['A:prompt', 'B:prompt']);
  });

  it('classifies a turn from the persisted turn_role before its text', async () => {
    engine = await createTestEngine();
    const now = Date.now();
    engine.sqlite
      .prepare(`INSERT INTO sessions (id, name, created_at, updated_at, conversation_id, owner_type, owner_id) VALUES ('s1', 's', ?, ?, 'conv-1', 'stage_run', 'sr1')`)
      .run(now, now);
    const msg = engine.sqlite.prepare(`INSERT INTO chat_messages (id, session_id, role, content, timestamp, metadata, turn_role) VALUES (?, 's1', 'user', ?, ?, ?, ?)`);
    msg.run('m1', 'Anything at all', now, JSON.stringify({ stageRunId: 'sr1' }), 'summary');
    msg.run('m2', 'Another plain text', now + 1, JSON.stringify({ stageRunId: 'sr1' }), 'prompt');
    msg.run('m3', 'Third', now + 2, JSON.stringify({ stageRunId: 'sr1' }), 'repair');
    expect(engine.adapter.classifyTurn('conv-1', 'Anything at all')).toBe('summary');
    expect(engine.adapter.classifyTurn('conv-1', 'Another plain text')).toBe('prompt');
    expect(engine.adapter.classifyTurn('conv-1', 'Third')).toBe('repair');
    // Nothing persisted: fall back to the prompt text.
    expect(engine.adapter.classifyTurn('conv-1', 'Provide a concise summary (max 500 words) of all')).toBe('summary');
  });
});
