import { describe, expect, it } from 'vitest';

import { checkFeature } from '../services/auth/featureGate';
import { planCardActions } from '../blocks/GateCard/model/gateActions';

describe('computer feature gate', () => {
  it('describes exec:computer as a grantable, lockable feature', () => {
    expect(checkFeature('computer', ['exec:computer'])).toEqual({ available: true, missing: [], reason: null, grantable: true });
    const locked = checkFeature('computer', ['exec:terminal']);
    expect(locked).toMatchObject({ available: false, missing: ['exec:computer'], grantable: true });
    expect(locked.reason).toBeTruthy();
  });
});

describe('planCardActions', () => {
  it('names the server ids, keeps approve first and asks for feedback on changes', () => {
    const actions = planCardActions(['request_changes', 'exit_only', 'implement_autopilot', 'implement_interactive']);
    expect(actions.map((a) => a.label)).toEqual([
      'Approve & implement',
      'Approve & run autonomously',
      'Request changes',
      'Discard plan',
    ]);
    expect(actions.find((a) => a.label === 'Request changes')?.wantsFeedback).toBe(true);
    expect(actions.find((a) => a.label === 'Discard plan')?.tone).toBe('danger');
    expect(actions[0]?.id).toBe('implement_interactive');
  });

  it('defaults to approve + changes and keeps unknown ids actionable', () => {
    expect(planCardActions([]).map((a) => a.id)).toEqual(['implement_interactive', 'request_changes']);
    const odd = planCardActions(['escalate_to_owner']);
    expect(odd).toHaveLength(1);
    expect(odd[0]).toMatchObject({ id: 'escalate_to_owner', tone: 'neutral', wantsFeedback: false });
  });
});
