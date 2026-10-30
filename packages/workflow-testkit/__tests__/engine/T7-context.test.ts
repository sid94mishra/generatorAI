// ────────────────────────────────────────────────────────────────
// T7 — context passing between stages (F_live_tests §1 T7, §5 `t7.json`).
//
// Predecessor results reach a stage inside its FIRST prompt, fenced as
// untrusted (`<generatorai:stage-context>`): no separate context turn
// (W-49, F O-3) and no file-writing boilerplate on every prompt (W-48).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, stageKeyFor, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

// Over 6,000 characters: B_summary reads A's summary, so A's `auto` summary is a model turn (P07 WP-7.1).
const A_OUTPUT = `CODEWORD-PELICAN is the secret word for this run, followed by a long explanation.
${'The explanation goes on. '.repeat(260)}`;
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

describe('T7 context passing (engine)', () => {
  it('delivers predecessor context per context.mode / context.from, inside the first prompt', async () => {
    engine = await createTestEngine({
      script: { A: [{ text: A_OUTPUT }, { on: 'summary', text: A_SUMMARY }] },
    });
    const run = await engine.runWorkflow(T7, { topic: 'otters' });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');

    const promptOf = (stage: string) => snap.calls.find((c) => c.stageName === stage && c.kind === 'prompt')!.prompt;

    // summary (default): the summary, not the output.
    expect(promptOf('B_summary')).toContain(A_SUMMARY);
    expect(promptOf('B_summary')).not.toContain('CODEWORD-PELICAN');
    // output: the complete output.
    expect(promptOf('B_full')).toContain('CODEWORD-PELICAN');
    // none: no context block at all.
    expect(promptOf('B_none')).not.toContain('generatorai:stage-context');
    // structured: the summary (+ the structured output when the stage produced JSON).
    expect(promptOf('B_struct')).toContain(A_SUMMARY);
    // context.from pulls a stage that is not a predecessor.
    expect(promptOf('B_srcs')).toContain('## Completed stage "A"');
    expect(promptOf('B_srcs')).not.toContain('## Completed stage "B_none"');
    // The context is fenced as untrusted text.
    expect(promptOf('B_full')).toMatch(/^<generatorai:stage-context trust="untrusted">/);

    // No context turn: a leaf stage spends exactly its prompt (W-49).
    expect(snap.calls.filter((c) => c.stageName === 'B_full').map((c) => c.kind)).toEqual(['prompt']);
    expect(snap.stages[stageKeyFor('B_full')]!.messages.some((m) => m.turnRole === 'context')).toBe(false);
  });

  it('interpolates {{name}}, {{variables.x}} and {{run.id}}, and warns about a declared variable with no value', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow(T7, { topic: 'otters' });
    const snap = await run.waitForTerminal();
    const prompt = snap.calls.find((c) => c.stageName === 'V_interp' && c.kind === 'prompt')!.prompt;
    expect(prompt).toContain(`TOPIC=otters FULL=otters RUN=${snap.run.id} MISSING=`);
    const warn = snap.events.find(
      (e) => e.kind === 'harness.session_info' && e.data['infoType'] === 'unresolved_variables',
    );
    expect(warn?.data['unresolved']).toEqual(['missing_var']);
    // An undeclared placeholder is rejected when the definition is saved.
    const err = await engine
      .importDefinition({ stages: [{ name: 'X', prompt: 'hi {{never_declared}}' }] })
      .catch((e: unknown) => e);
    expect((err as { issues?: Array<{ code: string }> }).issues?.map((i) => i.code)).toContain('template-unknown-variable');
    // No file-writing boilerplate rides on the prompt (W-48, O-6).
    expect(prompt).not.toContain('**IMPORTANT: How to create files**');
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
    // sessionReuse 'fresh' (the default): one conversation per stage, each
    // created with its own stage's model (W-09).
    expect(new Set(snap.calls.map((c) => c.conversationId)).size).toBe(2);
    const models = [...engine.harness.conversationParams.values()].map((p) => p.model).sort();
    expect(models).toEqual(['model-one', 'model-two']);
  });
});
