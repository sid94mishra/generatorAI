// ────────────────────────────────────────────────────────────────
// T2 — conditional routing (F_live_tests §1 T2, §5 `t2.json`): stage
// `guard`s and edge `when`s in Expression v2, evaluated by `decide()` after
// readiness. Guards can read upstream stages (W-31), and a broken or
// mistyped expression is rejected when the definition is saved instead of
// silently skipping at run time (W-30).
// ────────────────────────────────────────────────────────────────

import { WorkflowValidationError } from '@generatorai/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, stageKeyFor, type RunSnapshot, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const T2 = {
  name: 't2-conditions',
  variables: [
    { name: 'env', type: 'string', label: 'env', required: true },
    { name: 'count', type: 'number', label: 'count', required: true },
    { name: 'flag', type: 'boolean', label: 'flag', required: true },
  ],
  stages: [
    { name: 'R', prompt: 'Write one line containing the token ROOT.' },
    { name: 'C_and', prompt: 'C_AND', guard: "variables.env == 'prod' and variables.count > 3" },
    { name: 'C_or_false', prompt: 'C_OR', guard: "variables.env == 'dev' or variables.count < 2" },
    { name: 'C_not', prompt: 'C_NOT', guard: 'not variables.flag' },
    { name: 'C_amp', prompt: 'C_AMP' },
    { name: 'C_paren', prompt: 'C_PAREN', guard: "(variables.env == 'prod' || variables.env == 'staging') && !(variables.count == 5)" },
    { name: 'C_stageref', prompt: 'C_STAGEREF', guard: "stages.r.status == 'completed'" },
    { name: 'D_after_skip', prompt: 'D' },
    { name: 'J', prompt: 'JOIN' },
    { name: 'J_always', prompt: 'JALWAYS' },
  ],
  edges: [
    ['R', 'C_and'],
    ['R', 'C_or_false'],
    ['R', 'C_not'],
    // `parent.status` belongs to an edge: this edge carries control only
    // when R completed AND the count is high enough.
    { from: 'R', to: 'C_amp', when: "parent.status == 'completed' && variables.count >= 5" },
    ['R', 'C_paren'],
    ['R', 'C_stageref'],
    ['C_or_false', 'D_after_skip'],
    ['C_and', 'J'],
    ['C_or_false', 'J'],
    ['C_or_false', 'J_always', 'always'],
  ] as const,
};

/** An instance by its stage NAME (instances are keyed by instance path, the stage key). */
const st = (snap: RunSnapshot, name: string) => snap.stages[stageKeyFor(name)]!;

describe('T2 conditional routing (guards and edge when)', () => {
  it('evaluates guards and edge `when`, reads upstream stages, and cascades skips', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow(T2, { env: 'prod', count: 5, flag: false });
    const snap = await run.waitForTerminal();

    expect(snap.run.status).toBe('completed');
    const status = (n: string) => st(snap, n).status;

    for (const ran of ['R', 'C_and', 'C_not', 'C_amp', 'C_stageref']) expect(status(ran)).toBe('completed');
    for (const skipped of ['C_or_false', 'C_paren']) expect(status(skipped)).toBe('skipped');

    // A skipped predecessor cascades on success edges...
    expect(status('D_after_skip')).toBe('skipped');
    // ...a join with one completed and one skipped predecessor still runs...
    expect(status('J')).toBe('completed');
    // ...and an `always` edge from a skipped stage fires.
    expect(status('J_always')).toBe('completed');

    // Skipped stages never reached the model.
    const called = new Set(snap.calls.map((c) => c.stageName));
    for (const n of ['C_or_false', 'C_paren', 'D_after_skip']) expect(called.has(n)).toBe(false);
  });

  it('a false edge `when` skips its target like an unmet guard', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow(T2, { env: 'prod', count: 4, flag: true });
    const snap = await run.waitForTerminal();
    expect(st(snap, 'C_amp').status).toBe('skipped');
    expect(st(snap, 'C_not').status).toBe('skipped');
    expect(snap.run.status).toBe('completed');
  });

  it('rejects an unparseable or mistyped condition when the definition is saved', async () => {
    engine = await createTestEngine();
    const broken = {
      stages: [
        { name: 'A', prompt: 'A' },
        { name: 'B', prompt: 'B', guard: '((( variables.x ==' },
      ],
      edges: [['A', 'B']] as const,
    };
    await expect(engine.importDefinition(broken)).rejects.toBeInstanceOf(WorkflowValidationError);

    // `not` of a string variable is a save-time type error, not a silent skip.
    const mistyped = {
      variables: [{ name: 'sflag', type: 'string', label: 'sflag' }],
      stages: [{ name: 'A', prompt: 'A', guard: 'not variables.sflag' }],
    };
    const err = await engine.importDefinition(mistyped).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowValidationError);
    expect((err as WorkflowValidationError).issues.some((i) => i.path === '/stages/0/guard')).toBe(true);
  });
});
