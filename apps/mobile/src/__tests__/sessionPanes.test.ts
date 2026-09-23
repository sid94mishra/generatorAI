import { describe, expect, it } from 'vitest';

import { computerFeature } from '../components/chat/panes/paneModel';
import { describeSessionTransport } from '../components/chat/sessionTransport';
import { planCardActions } from '../components/chat/gateActions';

describe('computerFeature', () => {
  it('describes exec:computer as a grantable, lockable feature', () => {
    expect(computerFeature(['exec:computer'])).toEqual({ available: true, missing: [], reason: null, grantable: true });
    const locked = computerFeature(['exec:terminal']);
    expect(locked).toMatchObject({ available: false, missing: ['exec:computer'], grantable: true });
    expect(locked.reason).toBeTruthy();
  });
});

describe('describeSessionTransport', () => {
  it('names direct LAN, relay as Tunnel and lets the stream override', () => {
    expect(describeSessionTransport({ state: 'connected', kind: 'lan', endpoint: 'http://h' }, 'connected').label).toBe('LAN');
    expect(describeSessionTransport({ state: 'connected', kind: 'relay', endpoint: 'wss://r' }, 'connected').label).toBe('Tunnel');
    expect(describeSessionTransport({ state: 'connected', kind: 'lan', endpoint: 'http://h' }, 'reconnecting').label).toBe('Reconnecting');
    expect(describeSessionTransport({ state: 'connected', kind: 'lan', endpoint: 'http://h' }, 'offline').tone).toBe('danger');
    expect(describeSessionTransport({ state: 'offline', reason: 'no route' }, 'connected')).toMatchObject({ label: 'Offline', detail: 'no route' });
    expect(describeSessionTransport({ state: 'idle' }, 'idle').label).toBe('Connecting');
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
