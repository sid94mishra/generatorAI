// ────────────────────────────────────────────────────────────────
// T7 — context passing between stages (F_live_tests §1 T7, §5 `t7.json`).
//
// CHARACTERISATION of today's engine. `// KNOWN-BUG W-xx` marks the
// assertions PHASE-02/03 flip.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const A_OUTPUT = 'CODEWORD-PELICAN is the secret word for this run, followed by a long explanation.';
const A_SUMMARY = 'A-SUMMARY: stage A chose a codeword.';

const T7 = {
  name: 't7-context',
  variables: [
    { name: 'topic', type: 'string', label: 'topic', required: true },
    { name: 'missing_var', type: 'string', label: 'missing' },
  ],
  stages: [
    { name: 'A', prompt: 'Invent a codeword.' },
    { name: 'B_summary', prompt: 'Repeat the codeword.' },
    { name: 'B_full', prompt: 'Repeat the codeword.', context: { mode: 'output' } },
    { name: 'B_none', prompt: 'Repeat the codeword.', context: { mode: 'none' } },
    { name: 'B_struct', prompt: 'Repeat the codeword.', context: { mode: 'structured' } },
    { name: 'B_srcs', prompt: 'Repeat the codeword.', context: { from: ['a'] } },
    { name: 'V_interp', prompt: 'TOPIC={{topic}} FULL={{variables.topic}} RUN={{run.id}} MISSING={{missing_var}}' },
  ],
  edges: [
    ['A', 'B_summary'],
    ['A', 'B_full'],
    ['A', 'B_none'],
    ['A', 'B_struct'],
    ['B_none', 'B_srcs'],
    ['A', 'V_interp'],
  ] as const,
};

describe('T7 context passing (current engine)', () => {
  it('delivers predecessor context per context.mode / context.from, as an extra model turn', async () => {
    engine = await createTestEngine({
      script: { A: [{ text: A_OUTPUT }, { on: 'summary', text: A_SUMMARY }] },
    });
    const run = await engine.runWorkflow(T7, { topic: 'otters' });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');

    const contextOf = (stage: string) => snap.calls.find((c) => c.stageName === stage && c.kind === 'context');

    // summary-only (default): the summary, not the output.
    expect(contextOf('B_summary')!.prompt).toContain(A_SUMMARY);
    expect(contextOf('B_summary')!.prompt).not.toContain('CODEWORD-PELICAN');
    // output: the complete output.
    expect(contextOf('B_full')!.prompt).toContain('CODEWORD-PELICAN');
    // none: no context turn at all.
    expect(contextOf('B_none')).toBeUndefined();
    // structured: summary (+ outputData when the stage produced JSON).
    expect(contextOf('B_struct')!.prompt).toContain(A_SUMMARY);
    // context.from pulls a stage that is not a predecessor.
    expect(contextOf('B_srcs')!.prompt).toContain('## Completed Stage: "A"');
    expect(contextOf('B_srcs')!.prompt).not.toContain('## Completed Stage: "B_none"');

    // Context is a separate model turn before the prompt, with its own reply.
    const kinds = snap.calls.filter((c) => c.stageName === 'B_full').map((c) => c.kind);
    expect(kinds).toEqual(['context', 'prompt', 'summary']); // KNOWN-BUG W-49 (context costs a model turn; O-3)
    const contextMsg = snap.stages['B_full']!.messages.find((m) => m.metadata?.['isContextMessage'] === true);
    expect(contextMsg?.role).toBe('user');
  });

  it('interpolates {{name}}, {{variables.x}} and {{run.id}}, and warns about a declared variable with no value', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow(T7, { topic: 'otters' });
    const snap = await run.waitForTerminal();
    const prompt = snap.calls.find((c) => c.stageName === 'V_interp' && c.kind === 'prompt')!.prompt;
    expect(prompt.startsWith(`TOPIC=otters FULL=otters RUN=${snap.run.id} MISSING=`)).toBe(true);
    const warn = snap.events.find(
      (e) => e.kind === 'harness.session_info' && e.data['infoType'] === 'unresolved_variables',
    );
    expect(warn?.data['unresolved']).toEqual(['missing_var']);
    // An undeclared placeholder is rejected when the definition is saved.
    const err = await engine
      .importDefinition({ stages: [{ name: 'X', prompt: 'hi {{never_declared}}' }] })
      .catch((e: unknown) => e);
    expect((err as { issues?: Array<{ code: string }> }).issues?.map((i) => i.code)).toContain('template-unknown-variable');
    // Every prompt carries the file-writing boilerplate (O-6).
    expect(prompt).toContain('**IMPORTANT: How to create files**'); // KNOWN-BUG W-48 (boilerplate on every prompt provokes refusals)
  });

  it('a linear workflow gives every stage its own fresh session with its own config', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow({
      stages: [
        { name: 'S1', prompt: 'one', session: { model: 'model-one' } },
        { name: 'S2', prompt: 'two', session: { model: 'model-two' } },
      ],
      edges: [['S1', 'S2']],
    });
    const snap = await run.waitForTerminal();
    expect(snap.run.sessionMode).toBe('per-stage');
    // v2 sessionReuse 'fresh' (P01 review R4): one conversation per stage, each
    // created with its own stage's model (W-09 closed for the v1 engine).
    expect(new Set(snap.calls.map((c) => c.conversationId)).size).toBe(2);
    const models = [...engine.harness.conversationParams.values()].map((p) => p.model).sort();
    expect(models).toEqual(['model-one', 'model-two']);
  });
});
