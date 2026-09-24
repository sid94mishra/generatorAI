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
  sessionMode: 'per-stage',
  stages: [
    { name: 'A', prompt: 'Invent a codeword.' },
    { name: 'B_summary', prompt: 'Repeat the codeword.' },
    { name: 'B_full', prompt: 'Repeat the codeword.', contextFilter: 'full' },
    { name: 'B_none', prompt: 'Repeat the codeword.', contextFilter: 'none' },
    { name: 'B_struct', prompt: 'Repeat the codeword.', contextFilter: 'structured' },
    { name: 'B_srcs', prompt: 'Repeat the codeword.', contextSources: ['A'] },
    { name: 'V_interp', prompt: 'TOPIC={{topic}} NESTED={{obj.inner}} MISSING={{missing_var}}' },
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
  it('delivers predecessor context per contextFilter, as an extra model turn', async () => {
    engine = await createTestEngine({
      script: { A: [{ text: A_OUTPUT }, { on: 'summary', text: A_SUMMARY }] },
    });
    const run = await engine.runWorkflow(T7, { topic: 'otters', obj: { inner: 'deep' } });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');

    const contextOf = (stage: string) => snap.calls.find((c) => c.stageName === stage && c.kind === 'context');

    // summary-only (default): the summary, not the output.
    expect(contextOf('B_summary')!.prompt).toContain(A_SUMMARY);
    expect(contextOf('B_summary')!.prompt).not.toContain('CODEWORD-PELICAN');
    // full: the complete output.
    expect(contextOf('B_full')!.prompt).toContain('CODEWORD-PELICAN');
    // none: no context turn at all.
    expect(contextOf('B_none')).toBeUndefined();
    // structured: summary (+ outputData when the stage produced JSON).
    expect(contextOf('B_struct')!.prompt).toContain(A_SUMMARY);
    // contextSources pulls a stage that is not a predecessor.
    expect(contextOf('B_srcs')!.prompt).toContain('## Completed Stage: "A"');
    expect(contextOf('B_srcs')!.prompt).not.toContain('## Completed Stage: "B_none"');

    // Context is a separate model turn before the prompt, with its own reply.
    const kinds = snap.calls.filter((c) => c.stageName === 'B_full').map((c) => c.kind);
    expect(kinds).toEqual(['context', 'prompt', 'summary']); // KNOWN-BUG W-49 (context costs a model turn; O-3)
    const contextMsg = snap.stages['B_full']!.messages.find((m) => m.metadata?.['isContextMessage'] === true);
    expect(contextMsg?.role).toBe('user');
  });

  it('interpolates {{var}} and {{a.b}}, and sends an unresolved placeholder raw with a warning', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow(T7, { topic: 'otters', obj: { inner: 'deep' } });
    const snap = await run.waitForTerminal();
    const prompt = snap.calls.find((c) => c.stageName === 'V_interp' && c.kind === 'prompt')!.prompt;
    expect(prompt.startsWith('TOPIC=otters NESTED=deep MISSING={{missing_var}}')).toBe(true);
    const warn = snap.events.find(
      (e) => e.kind === 'harness.session_info' && e.data['infoType'] === 'unresolved_variables',
    );
    expect(warn?.data['unresolved']).toEqual(['missing_var']);
    // Every prompt carries the file-writing boilerplate (O-6).
    expect(prompt).toContain('**IMPORTANT: How to create files**'); // KNOWN-BUG W-48 (boilerplate on every prompt provokes refusals)
  });

  it('a linear auto-mode workflow shares one conversation and still re-sends context', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow({
      sessionMode: 'auto',
      stages: [
        { name: 'S1', prompt: 'one', harnessConfigOverrides: { model: 'model-one' } },
        { name: 'S2', prompt: 'two', harnessConfigOverrides: { model: 'model-two' } },
      ],
      edges: [['S1', 'S2']],
    });
    const snap = await run.waitForTerminal();
    expect(snap.run.sessionMode).toBe('single');
    const convs = new Set(snap.calls.map((c) => c.conversationId));
    expect(convs.size).toBe(1);
    // The one conversation was created with stage 1's config; stage 2's
    // model override never reaches a conversation.
    const params = [...engine.harness.conversationParams.values()];
    expect(params).toHaveLength(1);
    expect(params[0]!.model).toBe('model-one'); // KNOWN-BUG W-09 (stages 2..N run with stage 1's model/tools)
    // ...and S2 is still sent a context turn about S1 into the same conversation.
    expect(snap.calls.filter((c) => c.stageName === 'S2').map((c) => c.kind)[0]).toBe('context'); // KNOWN-BUG W-09 (F-18 re-injected context)
  });
});
