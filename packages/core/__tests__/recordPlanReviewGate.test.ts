// `record_plan` in PLAN MODE is the approval gate for providers that have no
// plan-approval tool of their own (Codex, OpenCode, ACP).
//
// Observed live with Codex: in Plan mode it filed its plan through
// `record_plan`, was answered "Plan could not be recorded. Continue with the
// implementation anyway", and went straight to `apply_patch`. What the tool
// SAYS back is the whole mechanism, so that is what these pin.

import { describe, it, expect } from 'vitest';
import { createRecordPlanTool } from '../src/tools/recordPlanTool.js';
import { PLAN_MODE_TURN_PREFIX, providerHasNativePlanGate } from '../src/services/agentModePolicy.js';

const args = { title: 'Add EUR formatting', content: '# Add EUR formatting\n\n## Goal\n…' };
const run = (review: Parameters<typeof createRecordPlanTool>[0]) =>
  createRecordPlanTool(review).handler(args) as Promise<Record<string, unknown>>;

describe('record_plan as the plan-mode gate', () => {
  it('tells the agent to implement only once the user approved', async () => {
    const out = await run(async () => ({ planId: 'p1', fileName: '', review: { decision: 'approved' } }));
    expect(out['decision']).toBe('approved');
    expect(String(out['message'])).toMatch(/APPROVED/);
    expect(String(out['message'])).toMatch(/implement it now/i);
  });

  it('hands back the user\'s notes and forbids edits when changes are requested', async () => {
    const out = await run(async () => ({
      planId: 'p1', fileName: '', review: { decision: 'changes_requested', feedback: 'Keep it to the pricing module.' },
    }));
    expect(out['decision']).toBe('changes_requested');
    expect(String(out['message'])).toContain('Keep it to the pricing module.');
    expect(String(out['message'])).toMatch(/Do not modify any files/);
    expect(String(out['message'])).toMatch(/record_plan again/);
  });

  it('stops the agent when the user dismisses the plan', async () => {
    const out = await run(async () => ({ planId: 'p1', fileName: '', review: { decision: 'dismissed' } }));
    expect(String(out['message'])).toMatch(/Do not modify any files; end your turn/);
  });

  it('is still fire-and-forget outside plan mode', async () => {
    const out = await run(async () => ({ planId: 'p1', fileName: 'plan.md' }));
    expect(String(out['message'])).toMatch(/Continue with the implementation now/);
    expect(out['decision']).toBeUndefined();
  });
});

describe('plan mode for a provider with none of its own', () => {
  it('knows which providers submit plans natively', () => {
    expect(providerHasNativePlanGate('claude-agent')).toBe(true);
    expect(providerHasNativePlanGate('copilot')).toBe(true);
    expect(providerHasNativePlanGate('codex')).toBe(false);
    expect(providerHasNativePlanGate('acp')).toBe(false);
  });

  it('puts the rules in front of the prompt and routes submission through record_plan', () => {
    expect(PLAN_MODE_TURN_PREFIX).toMatch(/^You are in PLAN MODE\. Do not modify any files/);
    expect(PLAN_MODE_TURN_PREFIX).toContain('call `record_plan`');
    expect(PLAN_MODE_TURN_PREFIX).toMatch(/WAITS for the user's decision/);
    // The native wording must be gone — these providers have no such tool.
    expect(PLAN_MODE_TURN_PREFIX).not.toContain('exit-plan-mode');
    expect(PLAN_MODE_TURN_PREFIX.trimEnd().endsWith("--- The user's request follows ---")).toBe(true);
  });
});
