// ────────────────────────────────────────────────────────────────
// T2 — conditional routing (F_live_tests §1 T2, §5 `t2.json`).
//
// CHARACTERISATION of today's engine. `// KNOWN-BUG W-xx` marks the
// assertions PHASE-03 flips.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const expr = (expression: string) => ({ type: 'expression', expression });

const T2 = {
  name: 't2-conditions',
  sessionMode: 'auto',
  variables: [
    { name: 'env', type: 'string', label: 'env' },
    { name: 'count', type: 'number', label: 'count' },
    { name: 'flag', type: 'boolean', label: 'flag' },
    { name: 'sflag', type: 'string', label: 'sflag' },
  ],
  stages: [
    { name: 'R', prompt: 'Write one line containing the token ROOT.' },
    { name: 'C_and', prompt: 'C_AND', condition: expr("variables.env == 'prod' AND variables.count > 3") },
    { name: 'C_or_false', prompt: 'C_OR', condition: expr("variables.env == 'dev' OR variables.count < 2") },
    { name: 'C_not', prompt: 'C_NOT', condition: expr('NOT variables.flag') },
    { name: 'C_bang_str', prompt: 'C_BANG', condition: expr('!variables.sflag') },
    { name: 'C_amp', prompt: 'C_AMP', condition: expr("status == 'completed' && variables.count >= 5") },
    {
      name: 'C_paren',
      prompt: 'C_PAREN',
      condition: expr("(variables.env == 'prod' || variables.env == 'staging') && !(variables.count == 5)"),
    },
    { name: 'C_lower', prompt: 'C_LOWER', condition: expr("variables.env == 'prod' and variables.count > 3") },
    { name: 'C_stageref', prompt: 'C_STAGEREF', condition: expr("stages.R.status == 'completed'") },
    { name: 'D_after_skip', prompt: 'D' },
    { name: 'J', prompt: 'JOIN' },
    { name: 'J_always', prompt: 'JALWAYS' },
  ],
  edges: [
    ['R', 'C_and'],
    ['R', 'C_or_false'],
    ['R', 'C_not'],
    ['R', 'C_bang_str'],
    ['R', 'C_amp'],
    ['R', 'C_paren'],
    ['R', 'C_lower'],
    ['R', 'C_stageref'],
    ['C_or_false', 'D_after_skip'],
    ['C_and', 'J'],
    ['C_or_false', 'J'],
    ['C_or_false', 'J_always', 'always'],
  ] as const,
};

describe('T2 conditional routing (current engine)', () => {
  it('evaluates AND/OR/NOT/&&/||/!/parens/lower-case and cascades skips', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow(T2, { env: 'prod', count: 5, flag: false, sflag: 'false' });
    const snap = await run.waitForTerminal();

    expect(snap.run.status).toBe('completed');
    const status = (n: string) => snap.stages[n]!.status;

    for (const ran of ['R', 'C_and', 'C_not', 'C_amp', 'C_lower']) expect(status(ran)).toBe('completed');
    for (const skipped of ['C_or_false', 'C_paren']) expect(status(skipped)).toBe('skipped');

    // A skipped predecessor cascades on on_success edges...
    expect(status('D_after_skip')).toBe('skipped');
    // ...a join with one completed and one skipped predecessor still runs...
    expect(status('J')).toBe('completed');
    // ...and an `always` edge from a skipped stage fires.
    expect(status('J_always')).toBe('completed');

    // Skipped stages never reached the model.
    const called = new Set(snap.calls.map((c) => c.stageName));
    for (const n of ['C_or_false', 'C_paren', 'D_after_skip']) expect(called.has(n)).toBe(false);
  });

  it('cannot see stage state and treats the string "false" as truthy', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow(T2, { env: 'prod', count: 5, flag: false, sflag: 'false' });
    const snap = await run.waitForTerminal();

    // `stages.R.status` does not resolve; the unknown identifier evaluates to
    // false and the stage is skipped with no warning anywhere.
    expect(snap.stages['C_stageref']!.status).toBe('skipped'); // KNOWN-BUG W-31 (conditions cannot reference stages/outputs)
    // The skip is recorded as the generic "unreachable" reason, and the
    // definition validator raises nothing about the unknown identifier.
    expect(snap.stages['C_stageref']!.error).toBe('Skipped — no incoming edge or run condition was satisfied'); // KNOWN-BUG W-31 (no diagnostic for an unknown identifier)
    const validation = await engine.services.workflowDefinitionService.validateDefinition(snap.run.workflowDefinitionId);
    expect(validation.valid).toBe(true);
    expect([...validation.errors, ...validation.warnings].filter((m) => m.includes('stages.R'))).toEqual([]); // KNOWN-BUG W-31 (validator accepts `stages.X…`)

    // `!variables.sflag` with sflag = 'false' (a string) → truthy → skipped.
    expect(snap.stages['C_bang_str']!.status).toBe('skipped'); // KNOWN-BUG W-31 (string 'false' is truthy; O-7)
  });

  it('an unparseable condition is accepted and silently always skips', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow({
      stages: [
        { name: 'A', prompt: 'A' },
        { name: 'B', prompt: 'B', condition: expr('((( variables.x ==') },
      ],
      edges: [['A', 'B']],
    });
    const snap = await run.waitForTerminal();
    expect(snap.stages['B']!.status).toBe('skipped'); // KNOWN-BUG W-31 (evaluator is not fail-safe: parse error → false)
    expect(snap.run.status).toBe('completed'); // KNOWN-BUG W-30 (broken definition accepted and "succeeds")
  });
});
