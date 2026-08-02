import { describe, expect, it } from 'vitest';

import { toGateAction } from '../components/chat/gateActions';

describe('toGateAction', () => {
  it.each(['approve', 'accept', 'yes', 'continue', 'proceed'])(
    'treats "%s" as the primary action',
    (id) => {
      expect(toGateAction(id).tone).toBe('primary');
    },
  );

  it.each(['reject', 'deny', 'no', 'cancel', 'abort', 'stop'])(
    'treats "%s" as destructive',
    (id) => {
      // Approve and reject must never look alike: this is tapped one-handed
      // and a mis-tap can let an agent loose on a repository.
      expect(toGateAction(id).tone).toBe('danger');
    },
  );

  it('matches compound ids from the server', () => {
    expect(toGateAction('approve_plan').tone).toBe('primary');
    expect(toGateAction('request-changes').tone).toBe('neutral');
    expect(toGateAction('reject_and_stop').tone).toBe('danger');
  });

  it('renders an unknown action as neutral rather than hiding it', () => {
    // A gate the user cannot resolve is worse than an unstyled button.
    const action = toGateAction('escalate_to_owner');
    expect(action.tone).toBe('neutral');
    expect(action.label).toBe('Escalate to owner');
  });

  it('humanizes the label while preserving the id', () => {
    expect(toGateAction('request_changes')).toEqual({
      id: 'request_changes',
      label: 'Request changes',
      tone: 'neutral',
    });
  });

  it('is case-insensitive', () => {
    expect(toGateAction('APPROVE').tone).toBe('primary');
    expect(toGateAction('Reject').tone).toBe('danger');
  });
});
