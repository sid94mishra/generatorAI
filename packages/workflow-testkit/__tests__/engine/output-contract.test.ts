// ────────────────────────────────────────────────────────────────
// The output contract on engine v2 (P03 WP-3.5, RV-9, G5 §3.4; fixes
// F-5/F-6/F-7/B-11/W-17).
//
// The fake provider declares `structuredOutput: 'tool'` and full host tools,
// so a `json` stage gets the `submit_output` tool and falls back to the final
// JSON block. The contract is checked BEFORE the stage completes; a failure
// is sent back as a repair turn (a separate budget from retries); an
// exhausted repair budget restarts the attempt with a fresh session.
// ────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from '../../src/index.js';

let engine: TestEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

const SCHEMA = {
  type: 'object',
  properties: { severity: { type: 'string', enum: ['low', 'high'] }, summary: { type: 'string' } },
  required: ['severity'],
  additionalProperties: false,
};

const triage = (extra: Record<string, unknown> = {}) => ({
  name: 'contract-v2',
  stages: [
    { name: 'triage', prompt: 'Triage the report.', output: { format: 'json', schema: SCHEMA }, ...extra },
    { name: 'fix', prompt: 'Fix it.', context: { mode: 'structured' } },
  ],
  edges: [['triage', 'fix']] as const,
});

describe('output contract (engine)', () => {
  it('an invalid answer gets one repair turn; submit_output delivers the fix; the successor sees it', async () => {
    engine = await createTestEngine({
      script: {
        triage: [
          { text: 'Here is the triage:\n```json\n{"severity": 3}\n```' },
          { on: 'repair', text: 'Resubmitted.', submit: { severity: 'high', summary: 'null deref' } },
        ],
      },
    });
    const run = await engine.runWorkflow(triage());
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');

    const t = snap.stages['triage']!;
    expect(t.outputData).toEqual({ severity: 'high', summary: 'null deref' });
    expect(t.attempts?.map((a) => `${a.mode}:${a.status}:${a.repairCount}`)).toEqual(['fresh:succeeded:1']);
    const calls = snap.calls.filter((c) => c.stageName === 'triage');
    expect(calls.map((c) => c.kind)).toEqual(['prompt', 'repair']);
    // The final prompt names the strategy; the repair names the exact failure (ajv path).
    expect(calls[0]!.prompt).toContain('call `submit_output`');
    expect(calls[1]!.prompt).toContain('/severity');
    expect(calls[1]!.submitResult).toEqual({ accepted: true });
    // Stage messages carry their turn roles.
    expect(t.messages.filter((m) => m.role === 'user').map((m) => m.turnRole)).toEqual(['prompt', 'repair']);
    // The successor got the validated structured output.
    expect(snap.calls.find((c) => c.stageName === 'fix')!.prompt).toContain('"severity": "high"');
  });

  it('an exhausted repair budget restarts the attempt on a fresh session, carrying nothing over', async () => {
    const bad = { text: '```json\n{"severity": "medium"}\n```' };
    engine = await createTestEngine({
      script: {
        triage: [
          bad,
          { ...bad, on: 'repair' },
          { ...bad, on: 'repair' },
          { text: 'Fresh start:\n```json\n{"severity": "low"}\n```' },
        ],
      },
    });
    const run = await engine.runWorkflow(triage({ retry: { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 1 } }));
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    const t = snap.stages['triage']!;
    expect(t.attempts?.map((a) => `${a.mode}:${a.status}:${a.errorCode}:${a.repairCount}`)).toEqual([
      'fresh:failed:output_schema:2',
      'restart:succeeded:null:0',
    ]);
    expect(t.outputData).toEqual({ severity: 'low' });
    const calls = snap.calls.filter((c) => c.stageName === 'triage');
    expect(calls.map((c) => c.kind)).toEqual(['prompt', 'repair', 'repair', 'prompt']);
    // The restart is a new conversation (G5 §3.3).
    expect(calls[3]!.conversationId).not.toBe(calls[0]!.conversationId);
  });

  it('hard rules judge the latest answer only, never the rejected one (F-6/F-7, B-11)', async () => {
    engine = await createTestEngine({
      script: {
        notes: [
          { text: 'DRAFT: release notes still being written, nothing final here yet.' },
          { on: 'repair', text: 'Release notes: fixed the crash on start and the slow search.' },
        ],
      },
    });
    const run = await engine.runWorkflow({
      stages: [{ name: 'notes', prompt: 'Write the release notes.', output: { rules: [{ type: 'not_contains', value: 'DRAFT', message: 'no drafts' }] } }],
    });
    const snap = await run.waitForTerminal();
    expect(snap.run.status).toBe('completed');
    expect(snap.stages['notes']!.outputText).toBe('Release notes: fixed the crash on start and the slow search.');
    expect(snap.calls.map((c) => c.kind)).toEqual(['prompt', 'repair']);
    expect(snap.calls[1]!.prompt).toContain('- no drafts');
  });
});
