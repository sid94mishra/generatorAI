// G-07 — the computer consent + control read model. Pinned: prompts fold in
// and out by requestId (other workspaces ignored), control follows
// computer.control_changed, expired prompts are not answerable, and the
// answer options mirror the server's rules (no always_allow on synthetic).

import { describe, expect, it } from 'vitest';
import type { ComputerPendingConsent } from '@generatorai/shared';
import {
  agentHasControl,
  applyComputerEvent,
  consentAnswerOptions,
  initialComputerDeskState,
  seedComputerDesk,
  selectPendingConsent,
} from '../computer/index.js';

const WS = 'ws-1';

function prompt(requestId: string, patch: Partial<ComputerPendingConsent> = {}): ComputerPendingConsent {
  return {
    requestId,
    workspaceId: WS,
    chatId: 'chat-1',
    appIdentity: 'com.example.app',
    appLabel: 'Example',
    action: 'plan',
    summary: '2 actions in Example',
    path: 'synthetic',
    plan: [{ action: 'clickPoint', target: '(1, 2)' }, { action: 'typeText' }],
    expiresAt: 10_000,
    ...patch,
  };
}

describe('computer desk read model', () => {
  it('folds prompts in and out by requestId and ignores other workspaces', () => {
    let s = initialComputerDeskState(WS);
    s = applyComputerEvent(s, { kind: 'computer.consent_required', data: prompt('b', { expiresAt: 20_000 }) });
    s = applyComputerEvent(s, { kind: 'computer.consent_required', data: prompt('a') });
    s = applyComputerEvent(s, { kind: 'computer.consent_required', data: prompt('x', { workspaceId: 'ws-2' }) });
    expect(s.pending.map((p) => p.requestId)).toEqual(['a', 'b']);
    expect(s.pending[0]!.plan).toHaveLength(2);

    s = applyComputerEvent(s, { kind: 'computer.consent_resolved', data: { workspaceId: WS, requestId: 'a', decision: 'allow_once' } });
    expect(s.pending.map((p) => p.requestId)).toEqual(['b']);
    const same = applyComputerEvent(s, { kind: 'computer.consent_resolved', data: { workspaceId: WS, requestId: 'zzz' } });
    expect(same).toBe(s);
  });

  it('knows nothing about control until it is read, then follows control_changed', () => {
    let s = initialComputerDeskState(WS);
    expect(agentHasControl(s)).toBe(false);
    s = seedComputerDesk(s, { control: { workspaceId: WS, mode: 'agent', changedAt: null } });
    expect(agentHasControl(s)).toBe(true);
    s = applyComputerEvent(s, { kind: 'computer.control_changed', data: { workspaceId: WS, mode: 'user', previous: 'agent', changedAt: 5 } });
    expect(s.control).toEqual({ workspaceId: WS, mode: 'user', changedAt: 5 });
    expect(agentHasControl(s)).toBe(false);
    expect(applyComputerEvent(s, { kind: 'computer.control_changed', data: { workspaceId: WS, mode: 'robot' } })).toBe(s);
  });

  it('selects only prompts still answerable, optionally for one chat', () => {
    const s = seedComputerDesk(initialComputerDeskState(WS), {
      pending: [prompt('old', { expiresAt: 100 }), prompt('mine'), prompt('theirs', { chatId: 'chat-2' })],
    });
    expect(selectPendingConsent(s, { now: 500 }).map((p) => p.requestId)).toEqual(['mine', 'theirs']);
    expect(selectPendingConsent(s, { now: 500, chatId: 'chat-1' }).map((p) => p.requestId)).toEqual(['mine']);
  });

  it('offers no always_allow on a synthetic prompt, and scope only where it applies', () => {
    expect(consentAnswerOptions({ path: 'synthetic' })).toEqual([
      { decision: 'allow_once', scopes: ['app'] },
      { decision: 'allow_run', scopes: ['app', 'any'] },
      { decision: 'deny', scopes: ['app'] },
    ]);
    expect(consentAnswerOptions({ path: 'accessibility' }).map((o) => o.decision)).toEqual([
      'allow_once',
      'allow_run',
      'always_allow',
      'deny',
    ]);
  });
});
