// ────────────────────────────────────────────────────────────────
// T4 — output rules and the text they judge (F_live_tests §1 T4/T4b, §2
// F-4..F-9, §5 rule table), on the engine's output contract.
//
// Every stage answers with the same 54-char line. The rules judge that
// answer (the latest prompt/repair turn) and nothing else: no summary text
// joins it (W-17), validation happens inside the attempt before success is
// reported, so no stage completes unvalidated (F-5), and a slow repair turn
// is a live attempt the reaper leaves alone (W-02, F-4).
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, stageKeyFor, type RunSnapshot, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const ANSWER = 'GREEN-7731 alpha bravo charlie delta echo foxtrot golf';

type Rule = { type: string; message: string; [field: string]: unknown };
const rule = (type: string, value: unknown, message: string): Rule => ({ type, value, message });

const RULE_STAGES: Array<{ name: string; rule: Rule; answer?: string }> = [
  { name: 'V_contains_pass', rule: rule('contains', 'GREEN-7731', 'has the token') },
  { name: 'V_contains_fail', rule: rule('contains', 'PURPLE-0000', 'has the purple token') },
  { name: 'V_regex', rule: { type: 'regex', pattern: 'GREEN-\\d{4}', message: 'regex token' } },
  {
    name: 'V_regex_anchored',
    rule: { type: 'regex', pattern: '^GREEN-7731 alpha bravo charlie delta echo foxtrot golf$', message: 'exact line' },
  },
  { name: 'V_max_length', rule: rule('max_length', 200, 'at most 200 chars') },
  { name: 'V_not_contains', rule: rule('not_contains', 'instruct', 'no "instruct"') },
  { name: 'V_min_length', rule: rule('min_length', 20, 'at least 20 chars') },
  {
    name: 'V_json_pass',
    rule: {
      type: 'json_schema',
      schema: { type: 'object', required: ['name', 'age'], properties: { name: { type: 'string' }, age: { type: 'number' } } },
      message: 'valid person',
    },
    answer: '```json\n{"name":"Bob","age":42}\n```\nThat is the person record for this stage.',
  },
  {
    name: 'V_custom_script',
    rule: { type: 'custom_script', command: 'node', args: ['--version'], message: 'script passes' },
  },
];

const inst = (snap: RunSnapshot, name: string) => snap.stages[stageKeyFor(name)]!;

describe('T4 output rules (engine)', () => {
  it('judges the stage answer only: rules pass on the answer, a failing rule repairs then fails (W-17)', { timeout: 90_000 }, async () => {
    engine = await createTestEngine({
      script: Object.fromEntries(RULE_STAGES.map((s) => [s.name, [{ text: s.answer ?? ANSWER }]])),
    });
    const e = engine;
    const snaps = await Promise.all(
      RULE_STAGES.map(async (s) => {
        const run = await e.runWorkflow({
          name: `t4-${s.name}`,
          stages: [
            {
              name: s.name,
              prompt: `Write one line containing the token ${s.name}.`,
              output: { rules: [s.rule] },
              repair: { maxRepairs: 1 },
              retry: { maxAttempts: 1 },
              onExhausted: 'fail',
            },
          ],
        });
        // Nine runs finalize at once (workspace completion is git work): allow for a loaded machine.
        return run.waitForTerminal(60_000);
      }),
    );
    const byName = new Map(RULE_STAGES.map((s, i) => [s.name, snaps[i]!]));
    const of = (n: string) => inst(byName.get(n)!, n);

    for (const n of ['V_contains_pass', 'V_regex', 'V_min_length', 'V_json_pass', 'V_custom_script']) expect(of(n).status).toBe('completed');
    // The answer alone is judged: an anchored regex, a length cap and a
    // not-contains all hold (they failed on answer + summary before, W-17).
    for (const n of ['V_regex_anchored', 'V_max_length', 'V_not_contains']) expect(of(n).status).toBe('completed');

    const failed = of('V_contains_fail');
    expect(failed.status).toBe('failed');
    expect(failed.attempts?.[0]?.errorCode).toBe('validation_rule');
    expect(failed.error).toContain('has the purple token');
    // One repair turn on the attempt, judged on its own answer, then no more.
    expect(failed.attempts?.map((a) => `${a.status}:${a.repairCount}`)).toEqual(['failed:1']);
    expect(byName.get('V_contains_fail')!.calls.map((c) => c.kind)).toEqual(['prompt', 'repair']);
  });

  it('no stage completes unvalidated: two failing stages both fail, whatever order they finish in (F-5)', async () => {
    engine = await createTestEngine();
    const run = await engine.runWorkflow({
      name: 't4-race',
      stages: [
        { name: 'V_fail', prompt: 'fail', output: { rules: [rule('contains', 'NEVER-PRESENT-XYZ', 'cannot pass')] }, repair: { maxRepairs: 0 }, onExhausted: 'fail' },
        { name: 'V_race', prompt: 'race', output: { rules: [rule('contains', 'NEVER-PRESENT-XYZ', 'cannot pass')] }, repair: { maxRepairs: 0 }, onExhausted: 'fail' },
      ],
    });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('failed');
    expect(inst(snap, 'V_fail').status).toBe('failed');
    expect(inst(snap, 'V_race').status).toBe('failed');
    expect(inst(snap, 'V_race').attempts?.[0]?.errorCode).toBe('validation_rule');
  });

  it('a slow repair turn is a live attempt: the reaper leaves it alone and it is judged (W-02, F-4)', async () => {
    engine = await createTestEngine({
      script: { V_retry: [{ text: 'no magic token here' }, { on: 'repair', delayMs: 1500, text: 'Corrected answer: V_RETRY-OK.' }] },
    });
    const run = await engine.runWorkflow({
      name: 't4b-slow-repair',
      stages: [
        {
          name: 'V_retry',
          prompt: 'Write one line containing the token V_RETRY-OK.',
          output: { rules: [rule('contains', 'V_RETRY-OK', 'has the token')] },
          repair: { maxRepairs: 1 },
          onExhausted: 'fail',
        },
      ],
    });
    const snap = await run.waitForTerminal(20_000);
    const v = inst(snap, 'V_retry');
    expect(v.status).toBe('completed');
    expect(v.outputText).toBe('Corrected answer: V_RETRY-OK.');
    expect(v.attempts?.map((a) => `${a.status}:${a.repairCount}`)).toEqual(['succeeded:1']);
    expect(snap.run.status).toBe('completed');
  });
});
