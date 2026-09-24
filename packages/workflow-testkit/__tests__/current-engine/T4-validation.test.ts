// ────────────────────────────────────────────────────────────────
// T4 — result-validation rules and the texts they check
// (F_live_tests §1 T4/T4b, §2 F-4..F-9, §5 rule table).
//
// Every stage answers with the same 54-char line; its summary turn answers
// with a long paragraph that says "as instructed". The rules show what text
// validation actually reads today.
//
// CHARACTERISATION of today's engine. `// KNOWN-BUG W-xx` marks the
// assertions PHASE-03 flips.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine, type Turn } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const ANSWER = 'GREEN-7731 alpha bravo charlie delta echo foxtrot golf';
const SUMMARY =
  'Summary: I wrote the requested GREEN line exactly as instructed. ' +
  'No files were created or modified. The line is the only output of this stage. '.repeat(4);

const answerThenSummary: Turn[] = [{ text: ANSWER }, { on: 'summary', text: SUMMARY }];

const rule = (type: string, value: unknown, message: string) => ({ type, value, message });

const RULE_STAGES: Array<{ name: string; rule: ReturnType<typeof rule>; answer?: string }> = [
  { name: 'V_contains_pass', rule: rule('contains', 'GREEN-7731', 'has the token') },
  { name: 'V_contains_fail', rule: rule('contains', 'PURPLE-0000', 'has the purple token') },
  { name: 'V_regex', rule: rule('regex', 'GREEN-\\d{4}', 'regex token') },
  { name: 'V_regex_anchored', rule: rule('regex', '^GREEN-7731 alpha bravo charlie delta echo foxtrot golf$', 'exact line') },
  { name: 'V_max_length', rule: rule('max_length', 200, 'at most 200 chars') },
  { name: 'V_not_contains', rule: rule('not_contains', 'instruct', 'no "instruct"') },
  { name: 'V_min_length', rule: rule('min_length', 20, 'at least 20 chars') },
  {
    name: 'V_json_pass',
    rule: rule(
      'json_schema',
      { type: 'object', required: ['name', 'age'], properties: { name: { type: 'string' }, age: { type: 'number' } } },
      'valid person',
    ),
    answer: '```json\n{"name":"Bob","age":42}\n```\nThat is the person record for this stage.',
  },
  {
    name: 'V_custom_script',
    rule: rule('custom_script', 'node -e "process.exit(0)"', 'script passes'),
  },
  {
    name: 'V_llm_french',
    rule: rule('llm_validation', 'must be written entirely in French and mention Paris', 'is French'),
  },
];

describe('T4 result validation (current engine)', () => {
  it('validates the joined assistant text of every turn, not the stage answer', async () => {
    engine = await createTestEngine({
      script: Object.fromEntries(
        RULE_STAGES.map((s) => [s.name, s.answer ? [{ text: s.answer }, { on: 'summary', text: SUMMARY }] : answerThenSummary]),
      ),
    });
    const e = engine;
    // One single-stage run per rule: a run finalizes only after its own
    // stage was processed, so the finalize race below cannot interfere.
    const snaps = await Promise.all(
      RULE_STAGES.map(async (s) => {
        const run = await e.runWorkflow({
          name: `t4-${s.name}`,
          stages: [{ name: s.name, prompt: `Write one line containing the token ${s.name}.`, resultValidation: [s.rule] }],
        });
        return run.waitForTerminal();
      }),
    );
    const byName = new Map(RULE_STAGES.map((s, i) => [s.name, snaps[i]!]));
    const status = (n: string) => byName.get(n)!.stages[n]!.status;

    // Correct today.
    expect(status('V_contains_pass')).toBe('completed');
    expect(status('V_regex')).toBe('completed');
    expect(status('V_min_length')).toBe('completed');
    expect(status('V_contains_fail')).toBe('failed');
    expect(byName.get('V_contains_fail')!.stages['V_contains_fail']!.error).toBe(
      'Validation failed after 1 attempt(s): has the purple token',
    );

    // The summary turn is part of the validated text (F-6).
    expect(status('V_regex_anchored')).toBe('failed'); // KNOWN-BUG W-17 (validates answer + summary, anchors never match)
    expect(status('V_max_length')).toBe('failed'); // KNOWN-BUG W-17 (summary counts toward length)
    expect(status('V_not_contains')).toBe('failed'); // KNOWN-BUG W-17 ("as instructed" is only in the summary)

    // Three of the rule types cannot be used (F-7..F-9).
    expect(status('V_json_pass')).toBe('failed'); // KNOWN-BUG W-47 (schema keywords treated as required keys)
    expect(e.logs.some((l) => l.message.includes('missing keys: type, required, properties'))).toBe(true); // KNOWN-BUG W-47
    expect(status('V_custom_script')).toBe('failed'); // KNOWN-BUG W-47 (whole value run as the executable, no args)
    expect(e.logs.some((l) => l.message.includes('custom_script'))).toBe(true);
    expect(status('V_llm_french')).toBe('completed'); // KNOWN-BUG W-47 (llm_validation is a ≥50-char stub)

    for (const snap of snaps) {
      expect(snap.events.filter((ev) => ev.kind === 'workflow_run.stage_validation')).toHaveLength(1);
    }
  });

  it('a stage that completes after the run was finalized is never validated', async () => {
    // The production reconcile tick (3 s): both stages are terminal before
    // the first tick, which processes V_fail first — its failure finalizes
    // the run, and V_race's late onStageCompleted returns on
    // `run.status !== 'running'` without validating (F-5).
    engine = await createTestEngine({ timing: { reconcileIntervalMs: 3000 } });
    const run = await engine.runWorkflow({
      name: 't4-race',
      stages: [
        { name: 'V_fail', prompt: 'fail', resultValidation: [rule('contains', 'NEVER-PRESENT-XYZ', 'cannot pass')] },
        { name: 'V_race', prompt: 'race', resultValidation: [rule('contains', 'NEVER-PRESENT-XYZ', 'cannot pass')] },
      ],
    });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('failed');
    expect(snap.stages['V_fail']!.status).toBe('failed');
    const validated = snap.events.filter((e) => e.kind === 'workflow_run.stage_validation').map((e) => e.data['stageName']);
    expect(validated).toEqual(['V_fail']); // KNOWN-BUG W-17 (validation skipped by the finalize race)
    expect(snap.stages['V_race']!.status).toBe('completed'); // KNOWN-BUG W-17 (a rule-violating stage ends completed)
  });

  it('an in-session validation retry is reaped by the heartbeat check', async () => {
    // The feedback turn takes 3 s; the testkit's stale window is 2 s.
    engine = await createTestEngine({
      script: { V_retry: [{ on: 'validation_feedback', delayMs: 3000, text: 'Corrected answer: still no magic token here.' }] },
    });
    const run = await engine.runWorkflow({
      name: 't4b-validation-retry',
      stages: [
        {
          name: 'V_retry',
          prompt: 'Write one line containing the token V_RETRY.',
          retryPolicy: { maxRetries: 2, backoffMs: 100, backoffMultiplier: 1 },
          resultValidation: [rule('contains', 'NEVER-PRESENT-XYZ', 'never passes')],
        },
      ],
    });
    const snap = await run.waitForTerminal(20_000);
    const v = snap.stages['V_retry']!;
    expect(v.status).toBe('failed');
    // `retryInSession` never starts a heartbeat: the row is `running`, its
    // last beat is from the first attempt, and the reconciler reaps the
    // healthy retry as a hung executor (F-4).
    expect(v.error).toMatch(/^Stage heartbeat stale/); // KNOWN-BUG W-02 (reaper kills a healthy validation retry)
    expect(v.retryCount).toBe(1); // KNOWN-BUG W-02 (attempts 2..N never run)
    expect(snap.events.filter((e) => e.kind === 'workflow_run.stage_validation')).toHaveLength(1); // KNOWN-BUG W-02
    expect(snap.run.status).toBe('failed');
  });
});
