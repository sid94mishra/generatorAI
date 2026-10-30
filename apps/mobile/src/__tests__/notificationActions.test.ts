import { describe, expect, it, vi } from 'vitest';

import { NOTIFICATION_CATEGORY_IDS } from '@generatorai/shared/ui-contract';
import {
  answerForReply,
  APPROVAL_CATEGORY_ID,
  APPROVAL_CHANNEL_ID,
  categoryRegistrations,
  decisionOutcome,
  intentFromResponse,
  submitAnswer,
  submitDecision,
  type NotificationIntent,
} from '../services/notifications/notificationCategories';

// The value Expo hands back for a plain tap (Notifications.DEFAULT_ACTION_IDENTIFIER).
const TAP = 'expo.modules.notifications.actions.DEFAULT';

// Exactly what @generatorai/core's PushDispatcher puts in `data` for a
// tool-permission prompt (see PushDispatcher.test.ts there).
const permissionData = {
  route: '/chats/c1/gate/i1',
  category: 'approval',
  threadId: 'chat:c1',
  chatId: 'c1',
  interactionId: 'i1',
  kind: 'permission',
  actions: ['approve', 'deny'],
};

const questionData = {
  route: '/chats/c1/gate/q1',
  category: 'approval',
  threadId: 'chat:c1',
  chatId: 'c1',
  interactionId: 'q1',
  kind: 'question',
};

describe('approval category', () => {
  it('matches the identifiers the server sends', () => {
    // `categoryId: 'approval'` and `channelId: 'approvals'` are hard-coded
    // in ExpoPushProvider.ts; drift here means buttons silently vanish.
    expect(APPROVAL_CATEGORY_ID).toBe('approval');
    expect(APPROVAL_CHANNEL_ID).toBe('approvals');
  });

  it('keeps the app in the background for both buttons and marks Deny destructive', () => {
    const approval = categoryRegistrations().find((c) => c.identifier === 'approval')!;
    expect(approval.actions.map((a) => [a.identifier, a.buttonTitle])).toEqual([['approve', 'Allow once'], ['deny', 'Deny'], ['open', 'Open']]);
    for (const action of approval.actions.slice(0, 2)) {
      expect(action.options.opensAppToForeground).toBe(false);
      // A lock-screen Allow must not be pressable by whoever holds the
      // phone, and the credential is unreadable until the device unlocks.
      expect(action.options.isAuthenticationRequired).toBe(true);
    }
    expect(approval.actions[1]!.options.isDestructive).toBe(true);
    expect(approval.actions[2]!.options.opensAppToForeground).toBe(true);
  });
});

describe('categories v2 (06 §7.2)', () => {
  it('registers every shared category, grouped with a summary', () => {
    const all = categoryRegistrations();
    expect(all.map((c) => c.identifier)).toEqual([...NOTIFICATION_CATEGORY_IDS]);
    for (const c of all) expect(c.options).toEqual({ categorySummaryFormat: '%u more', showTitle: true });
  });

  it('gives a risky gate and a run approval only a foreground review (MD-31)', () => {
    const byId = Object.fromEntries(categoryRegistrations().map((c) => [c.identifier, c.actions]));
    expect(byId['approval.risky']).toEqual([{ identifier: 'review', buttonTitle: 'Review in app', options: { opensAppToForeground: true } }]);
    expect(byId['run.approval']!.map((a) => a.options.opensAppToForeground)).toEqual([true]);
    expect(byId['done']).toEqual([]);
  });

  it('offers a question a text reply that needs an unlocked device', () => {
    const reply = categoryRegistrations().find((c) => c.identifier === 'question')!.actions[0]!;
    expect(reply).toEqual({
      identifier: 'reply',
      buttonTitle: 'Reply',
      textInput: { submitButtonTitle: 'Send', placeholder: 'Reply to your agent' },
      options: { opensAppToForeground: false, isAuthenticationRequired: true },
    });
  });
});

describe('intentFromResponse — v2 replies and risky gates', () => {
  const v2 = { v: 2, serverId: 'B', href: '/chats/c1/gate/q1', threadId: 'chat:c1', chatId: 'c1', interactionId: 'q1', kind: 'question', category: 'question' };
  const question = { id: 'k', options: ['Migrate them now', 'Keep a v11 shim'], multiSelect: false, freeText: true, count: 1 };

  it('sends a reply naming an option as that option, anything else as free text', () => {
    expect(intentFromResponse('reply', { ...v2, question }, TAP, ' migrate THEM now ')).toEqual({
      type: 'answer', serverId: 'B', chatId: 'c1', interactionId: 'q1', route: '/chats/c1/gate/q1?server=B',
      response: { answers: { k: ['Migrate them now'] } },
    });
    expect(intentFromResponse('reply', { ...v2, question }, TAP, 'Do both')).toMatchObject({ type: 'answer', response: { answers: {}, freeformResponse: 'Do both' } });
  });

  it('opens the gate when the reply cannot answer it', () => {
    expect(intentFromResponse('reply', { ...v2, question }, TAP, '   ').type).toBe('open');
    expect(intentFromResponse('reply', { ...v2, question: { ...question, count: 2 } }, TAP, 'yes').type).toBe('open');
    expect(intentFromResponse('reply', { ...v2, question: { ...question, freeText: false } }, TAP, 'Do both').type).toBe('open');
    expect(intentFromResponse('reply', { ...permissionData, serverId: undefined }, TAP, 'yes').type).toBe('open');
  });

  it('never decides a risky gate from the notification, even with a stale Allow action', () => {
    const risky = { ...permissionData, category: 'approval.risky', risk: 'risky' };
    expect(intentFromResponse('approve', risky, TAP)).toEqual({ type: 'open', route: '/chats/c1/gate/i1' });
    expect(intentFromResponse('approve', { ...permissionData, risk: 'risky' }, TAP).type).toBe('open');
    expect(intentFromResponse('review', risky, TAP)).toEqual({ type: 'open', route: '/chats/c1/gate/i1' });
  });

  it('matches answers for a reply without question data as free text', () => {
    expect(answerForReply(undefined, 'ok')).toEqual({ answers: {}, freeformResponse: 'ok' });
  });

  it('posts a reply through the signed fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 }));
    const intent = intentFromResponse('reply', { ...v2, question }, TAP, 'Keep a v11 shim') as Extract<NotificationIntent, { type: 'answer' }>;
    await expect(submitAnswer(intent, fetchImpl)).resolves.toBe('settled');
    expect(fetchImpl).toHaveBeenCalledWith('/api/chats/c1/interactions/q1/respond', expect.objectContaining({ method: 'POST' }));
  });
});

describe('intentFromResponse — permission prompt', () => {
  it('pins actions and fallback navigation to the notification server', () => {
    expect(intentFromResponse('approve', { ...permissionData, serverId: 'B' }, TAP)).toMatchObject({ type: 'decide', serverId: 'B', route: '/chats/c1/gate/i1?server=B' });
    expect(intentFromResponse('approve', { ...permissionData, route: '/chats/c1/gate/i1?server=B' }, TAP)).toMatchObject({ type: 'decide', serverId: 'B' });
    expect(intentFromResponse(TAP, { ...permissionData, serverId: 'B' }, TAP)).toEqual({ type: 'open', route: '/chats/c1/gate/i1?server=B' });
  });
  it('never falls back to an active-server decision for an invalid explicit identity', () => {
    expect(intentFromResponse('approve', { ...permissionData, serverId: '../other' }, TAP).type).not.toBe('decide');
  });
  it('maps Allow to an allow decision without opening the UI', () => {
    expect(intentFromResponse('approve', permissionData, TAP)).toEqual({
      type: 'decide',
      chatId: 'c1',
      interactionId: 'i1',
      behavior: 'allow',
      route: '/chats/c1/gate/i1',
    });
  });

  it('maps Deny to a deny decision', () => {
    expect(intentFromResponse('deny', permissionData, TAP)).toMatchObject({
      type: 'decide',
      behavior: 'deny',
    });
  });

  it('opens the gate on a plain tap', () => {
    expect(intentFromResponse(TAP, permissionData, TAP)).toEqual({
      type: 'open',
      route: '/chats/c1/gate/i1',
    });
  });

  it('refuses to decide when the server did not offer that action', () => {
    // A future server may send a permission prompt with a single action or
    // none; the phone must not invent decisions the server did not offer.
    const noActions = { ...permissionData, actions: [] };
    expect(intentFromResponse('approve', noActions, TAP)).toEqual({
      type: 'open',
      route: '/chats/c1/gate/i1',
    });
  });

  it('refuses ids that could change the request path', () => {
    const hostile = { ...permissionData, interactionId: '../../auth/devices' };
    expect(intentFromResponse('approve', hostile, TAP).type).toBe('open');
    const spaced = { ...permissionData, chatId: 'c 1' };
    expect(intentFromResponse('approve', spaced, TAP).type).toBe('open');
  });
});

describe('intentFromResponse — gates that need reading', () => {
  it('opens a question gate even if an action button was somehow pressed', () => {
    // No blind approve/deny on a question: the user has to read it.
    expect(intentFromResponse('approve', questionData, TAP)).toEqual({
      type: 'open',
      route: '/chats/c1/gate/q1',
    });
    expect(intentFromResponse(TAP, questionData, TAP)).toEqual({
      type: 'open',
      route: '/chats/c1/gate/q1',
    });
  });

  it('opens a workflow approval (no chat interaction) on tap', () => {
    const run = { route: '/workflows/w1/runs/r1', category: 'approval', threadId: 'run:r1' };
    expect(intentFromResponse(TAP, run, TAP)).toEqual({ type: 'open', route: '/workflows/w1/runs/r1' });
    expect(intentFromResponse('approve', run, TAP)).toEqual({ type: 'open', route: '/workflows/w1/runs/r1' });
  });
});

describe('intentFromResponse — robustness', () => {
  it('ignores payloads without a route', () => {
    expect(intentFromResponse(TAP, undefined, TAP)).toEqual({ type: 'ignore', reason: 'no-route' });
    expect(intentFromResponse(TAP, {}, TAP)).toEqual({ type: 'ignore', reason: 'no-route' });
    expect(intentFromResponse(TAP, 'route=/chats/c1', TAP)).toEqual({ type: 'ignore', reason: 'no-route' });
  });

  it('ignores a route the allowlist refuses, even on a decision', () => {
    // A decision still needs a fallback screen; an external URL is never one.
    expect(intentFromResponse(TAP, { ...permissionData, route: 'https://evil.example' }, TAP)).toEqual({
      type: 'ignore',
      reason: 'unsafe-route',
    });
    // The decision itself is still valid — the route is only the fallback.
    expect(intentFromResponse('approve', { ...permissionData, route: '//evil' }, TAP)).toMatchObject({
      type: 'decide',
      route: null,
    });
  });

  it('treats an unknown action identifier like a tap', () => {
    expect(intentFromResponse('snooze', permissionData, TAP)).toEqual({
      type: 'open',
      route: '/chats/c1/gate/i1',
    });
  });
});

describe('decisionOutcome', () => {
  it('counts an accepted decision as settled', () => {
    expect(decisionOutcome(202)).toBe('settled');
  });

  it('counts a duplicate (409) as settled — someone already answered', () => {
    // Opening the app to a gate that no longer exists would be the wrong
    // reaction to "your desktop got there first".
    expect(decisionOutcome(409)).toBe('settled');
  });

  it('distinguishes a vanished gate from an auth problem from a server fault', () => {
    expect(decisionOutcome(404)).toBe('gone');
    expect(decisionOutcome(401)).toBe('forbidden');
    expect(decisionOutcome(403)).toBe('forbidden');
    expect(decisionOutcome(500)).toBe('failed');
    expect(decisionOutcome(503)).toBe('failed');
  });
});

describe('submitDecision', () => {
  const decide: Extract<NotificationIntent, { type: 'decide' }> = {
    type: 'decide',
    chatId: 'c1',
    interactionId: 'i1',
    behavior: 'deny',
    route: null,
  };

  it('posts through the signed fetch and reports the outcome', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 }));
    await expect(submitDecision(decide, fetchImpl)).resolves.toBe('settled');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/chats/c1/interactions/i1/permission',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports a network failure instead of throwing', async () => {
    // The caller runs from a notification listener with nobody to catch.
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(submitDecision(decide, fetchImpl)).resolves.toBe('failed');
  });
});
