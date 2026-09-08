import { describe, expect, it } from 'vitest';

import { availablePanes, COMPUTER_PANE_IMPLEMENTED, routeSection } from '../components/chat/panes/paneModel';
import { describeSessionTransport } from '../components/chat/sessionTransport';
import { planCardActions } from '../components/chat/gateActions';

describe('availablePanes', () => {
  it('offers only the chat until a workspace exists', () => {
    expect(availablePanes({ workspaceId: null, scopes: ['exec:terminal', 'exec:computer'], changesCount: 3 })).toEqual([
      { id: 'chat', label: 'Chat' },
    ]);
  });

  it('lists Terminal and Browser without their scope (they render locked pages)', () => {
    const without = availablePanes({ workspaceId: 'ws', scopes: [], changesCount: 0 });
    expect(without.map((p) => p.id)).toEqual(['chat', 'changes', 'terminal', 'browser']);
    expect(without[1]).toEqual({ id: 'changes', label: 'Changes' });
  });

  it('withholds Computer while the pane has no implementation, scope or not', () => {
    expect(COMPUTER_PANE_IMPLEMENTED).toBe(false);
    const withScope = availablePanes({ workspaceId: 'ws', scopes: ['exec:computer'], changesCount: 2 });
    expect(withScope.map((p) => p.id)).not.toContain('computer');
    expect(withScope[1]).toEqual({ id: 'changes', label: 'Changes', count: 2 });
  });

  it('routes composer sections to a pane or the More sheet', () => {
    expect(routeSection('changes')).toEqual({ pane: 'changes' });
    expect(routeSection('plan')).toEqual({ more: 'plan' });
    expect(routeSection('widgets')).toBeNull();
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
