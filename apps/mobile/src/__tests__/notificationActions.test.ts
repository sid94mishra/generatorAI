import { describe, expect, it, vi } from 'vitest';

import {
  APPROVAL_ACTIONS,
  APPROVAL_CATEGORY_ID,
  APPROVAL_CHANNEL_ID,
  decisionOutcome,
  decisionRequest,
  intentFromResponse,
  submitDecision,
  type NotificationIntent,
} from '../notifications/notificationCategories';

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
    expect(APPROVAL_ACTIONS.map((a) => a.identifier)).toEqual(['approve', 'deny']);
    for (const action of APPROVAL_ACTIONS) {
      expect(action.options.opensAppToForeground).toBe(false);
      // A lock-screen Allow must not be pressable by whoever holds the
      // phone, and the credential is unreadable until the device unlocks.
      expect(action.options.isAuthenticationRequired).toBe(true);
    }
    expect(APPROVAL_ACTIONS[1].options.isDestructive).toBe(true);
  });
});

describe('intentFromResponse — permission prompt', () => {
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
    const run = { route: '/runs/r1', category: 'approval', threadId: 'run:r1' };
    expect(intentFromResponse(TAP, run, TAP)).toEqual({ type: 'open', route: '/runs/r1' });
    expect(intentFromResponse('approve', run, TAP)).toEqual({ type: 'open', route: '/runs/r1' });
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

describe('decisionRequest', () => {
  const decide: Extract<NotificationIntent, { type: 'decide' }> = {
    type: 'decide',
    chatId: 'c1',
    interactionId: 'i1',
    behavior: 'allow',
    route: '/chats/c1/gate/i1',
  };

  it('targets the existing chat permission route with the server’s body shape', () => {
    // POST /api/chats/:id/interactions/:interactionId/permission with
    // { behavior } — the same request the in-app gate card sends.
    const { path, init } = decisionRequest(decide);
    expect(path).toBe('/api/chats/c1/interactions/i1/permission');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ behavior: 'allow' });
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
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
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
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
