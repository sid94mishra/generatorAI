import { describe, expect, it } from 'vitest';

import { availablePanes, COMPUTER_PANE_IMPLEMENTED, computerFeature, routeSection } from '../components/chat/panes/paneModel';
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
    expect(without.map((p) => p.id)).toEqual(['chat', 'changes', 'files', 'terminal', 'browser']);
    expect(without[1]).toEqual({ id: 'changes', label: 'Changes' });
  });

  it('offers Computer once computer use is enabled, scope or not (the pane locks itself)', () => {
    expect(COMPUTER_PANE_IMPLEMENTED).toBe(true);
    const off = availablePanes({ workspaceId: 'ws', scopes: ['exec:computer'], changesCount: 2 });
    expect(off.map((p) => p.id)).not.toContain('computer');
    expect(off[1]).toEqual({ id: 'changes', label: 'Changes', count: 2 });

    const on = availablePanes({ workspaceId: 'ws', scopes: [], changesCount: 0, computerUseEnabled: true });
    expect(on.map((p) => p.id)).toEqual(['chat', 'changes', 'files', 'terminal', 'browser', 'computer']);
    expect(on.at(-1)).toEqual({ id: 'computer', label: 'Computer' });

    const waiting = availablePanes({ workspaceId: 'ws', scopes: ['exec:computer'], changesCount: 0, computerUseEnabled: true, computerNeedsAnswer: true });
    expect(waiting.at(-1)).toEqual({ id: 'computer', label: 'Computer', live: true });

    // Needs a workspace like the other execution panes.
    expect(availablePanes({ workspaceId: null, scopes: ['exec:computer'], changesCount: 0, computerUseEnabled: true }).map((p) => p.id)).toEqual(['chat']);
  });

  it('describes exec:computer as a grantable, lockable feature', () => {
    expect(computerFeature(['exec:computer'])).toEqual({ available: true, missing: [], reason: null, grantable: true });
    const locked = computerFeature(['exec:terminal']);
    expect(locked).toMatchObject({ available: false, missing: ['exec:computer'], grantable: true });
    expect(locked.reason).toBeTruthy();
  });

  it('routes composer sections to a pane or the More sheet', () => {
    expect(routeSection('changes')).toEqual({ pane: 'changes' });
    expect(routeSection('plan')).toEqual({ more: 'plan' });
    expect(routeSection('tasks')).toEqual({ more: 'tasks' });
    expect(routeSection('widgets')).toBeNull();
  });

  it('offers Tasks to an orchestrator or a chat with tasks, with the running count', () => {
    const none = availablePanes({ workspaceId: 'ws', scopes: [], changesCount: 0, tasks: { orchestrator: false, total: 0, running: 0 } });
    expect(none.map((p) => p.id)).toEqual(['chat', 'changes', 'files', 'terminal', 'browser']);

    const orchestrator = availablePanes({ workspaceId: 'ws', scopes: [], changesCount: 1, tasks: { orchestrator: true, total: 0, running: 0 } });
    expect(orchestrator.map((p) => p.id)).toEqual(['chat', 'changes', 'files', 'tasks', 'terminal', 'browser']);
    expect(orchestrator[3]).toEqual({ id: 'tasks', label: 'Tasks' });

    const running = availablePanes({ workspaceId: 'ws', scopes: [], changesCount: 0, tasks: { orchestrator: false, total: 3, running: 2 } });
    expect(running[3]).toEqual({ id: 'tasks', label: 'Tasks', count: 2 });

    // No workspace yet: workers still have a pane.
    const early = availablePanes({ workspaceId: null, scopes: [], changesCount: 0, tasks: { orchestrator: true, total: 1, running: 1 } });
    expect(early.map((p) => p.id)).toEqual(['chat', 'tasks']);
    expect(routeSection('tasks', early)).toEqual({ pane: 'tasks' });
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
