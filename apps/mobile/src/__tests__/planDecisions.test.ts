import { describe, expect, it } from 'vitest';

import { toPlanDecision } from '../components/chat/gateActions';
import { PLAN_ACTION_ID, canRequestChanges, offersAutopilot, planDecisionFor } from '../components/review/planDecisions';

describe('planDecisions (single encoder, D12)', () => {
  it('encodes every button through gateActions.toPlanDecision', () => {
    for (const kind of ['approve', 'autopilot', 'changes', 'discard'] as const) {
      const viaSheet = planDecisionFor(kind, 'note');
      const viaGate = toPlanDecision(PLAN_ACTION_ID[kind], 'note');
      expect(viaSheet).toEqual(viaGate);
    }
  });

  it('produces the bodies PlanDecisionSchema accepts', () => {
    expect(planDecisionFor('approve')).toEqual({ approved: true, action: 'implement_interactive' });
    expect(planDecisionFor('autopilot')).toEqual({ approved: true, action: 'implement_autopilot' });
    expect(planDecisionFor('changes', 'tighten step 2')).toEqual({ approved: false, feedback: 'tighten step 2' });
    // Discard is approved+exit_only: the agent leaves plan mode without implementing.
    expect(planDecisionFor('discard')).toEqual({ approved: true, action: 'exit_only' });
  });

  it('drops blank feedback and carries the edited-revision fields', () => {
    expect(planDecisionFor('approve', '   ')).toEqual({ approved: true, action: 'implement_interactive' });
    expect(planDecisionFor('approve', undefined, { useEditedContent: true, expectedRevision: 3 })).toEqual({
      approved: true,
      action: 'implement_interactive',
      useEditedContent: true,
      expectedRevision: 3,
    });
  });

  it('offers autopilot only when the server listed it', () => {
    expect(offersAutopilot(['implement_interactive', 'exit_only'])).toBe(false);
    expect(offersAutopilot(['implement_interactive', 'implement_autopilot'])).toBe(true);
    expect(offersAutopilot(undefined)).toBe(false);
  });

  it('requires a note to request changes', () => {
    expect(canRequestChanges('')).toBe(false);
    expect(canRequestChanges('  ')).toBe(false);
    expect(canRequestChanges('do X')).toBe(true);
  });
});

describe('planBodyWithoutTitle', () => {
  it('drops a first heading that repeats the title', async () => {
    const { planBodyWithoutTitle } = await import('../components/review/planDecisions');
    expect(planBodyWithoutTitle('# Add SAVE20 coupon\n\n## Goal\nText', 'Add SAVE20 coupon')).toBe('## Goal\nText');
  });

  it('keeps a heading that says something else, and bodies with none', async () => {
    const { planBodyWithoutTitle } = await import('../components/review/planDecisions');
    expect(planBodyWithoutTitle('# Overview\nText', 'Add SAVE20 coupon')).toBe('# Overview\nText');
    expect(planBodyWithoutTitle('## Goal\nText', 'Goal')).toBe('## Goal\nText');
    expect(planBodyWithoutTitle('', 'Plan')).toBe('');
  });
});
