import { describe, expect, it } from 'vitest';

import { ExpoPushProvider } from '../src/services/push/ExpoPushProvider.js';
import type { PushMessage, PushTarget } from '../src/services/push/PushDispatcher.js';
import type { HttpRequestOptions, IHttpClient } from '../src/domain/ports/IHttpClient.js';

function target(platform: string): PushTarget {
  return {
    deviceId: `dev-${platform}`,
    scopes: ['read:chats'],
    token: `ExponentPushToken[${platform}]`,
    provider: 'expo',
    platform,
    mutedUntil: null,
  };
}

function permissionPrompt(platform: string): PushMessage {
  return {
    target: target(platform),
    title: 'Allow Bash: pnpm test?',
    body: 'Run a shell command',
    data: {
      route: '/chats/c1/gate/i1',
      category: 'approval',
      threadId: 'chat:c1',
      chatId: 'c1',
      interactionId: 'i1',
      kind: 'permission',
      actions: ['approve', 'deny'],
    },
    threadId: 'chat:c1',
    interruption: 'timeSensitive',
    categoryId: 'approval',
  };
}

function completion(platform: string): PushMessage {
  return {
    target: target(platform),
    title: 'Workflow run finished',
    body: 'Nightly',
    data: { route: '/runs/r1', category: 'completed', threadId: 'run:r1' },
    threadId: 'run:r1',
    interruption: 'active',
  };
}

/** Captures the Expo request and answers every ticket with `ok`. */
function fakeHttp(): { http: IHttpClient; requests: HttpRequestOptions[] } {
  const requests: HttpRequestOptions[] = [];
  const http: IHttpClient = {
    request: async (options) => {
      requests.push(options);
      const count = (JSON.parse(options.body ?? '[]') as unknown[]).length;
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ data: Array.from({ length: count }, () => ({ status: 'ok' })) }),
      };
    },
  };
  return { http, requests };
}

function sentPayload(requests: HttpRequestOptions[]): Record<string, unknown>[] {
  return JSON.parse(requests[0]!.body ?? '[]') as Record<string, unknown>[];
}

describe('ExpoPushProvider — approval payload', () => {
  it('sends an iOS permission prompt with the approval category, actions and time-sensitive level', async () => {
    const { http, requests } = fakeHttp();
    await new ExpoPushProvider(http).send([permissionPrompt('ios')]);

    const [payload] = sentPayload(requests);
    expect(payload).toEqual({
      to: 'ExponentPushToken[ios]',
      title: 'Allow Bash: pnpm test?',
      body: 'Run a shell command',
      data: {
        route: '/chats/c1/gate/i1',
        category: 'approval',
        threadId: 'chat:c1',
        chatId: 'c1',
        interactionId: 'i1',
        kind: 'permission',
        actions: ['approve', 'deny'],
      },
      sound: 'default',
      categoryId: 'approval',
      priority: 'high',
      threadId: 'chat:c1',
      interruptionLevel: 'timeSensitive',
      ttl: 3600,
    });
  });

  it('routes an Android permission prompt to the high-importance approvals channel', async () => {
    const { http, requests } = fakeHttp();
    await new ExpoPushProvider(http).send([permissionPrompt('android')]);

    const [payload] = sentPayload(requests);
    expect(payload).toMatchObject({
      categoryId: 'approval',
      priority: 'high',
      channelId: 'approvals',
      ttl: 3600,
    });
    expect(payload!['threadId']).toBeUndefined();
  });

  it('leaves non-approval notifications on their category channel without buttons', async () => {
    const { http, requests } = fakeHttp();
    await new ExpoPushProvider(http).send([completion('android'), completion('ios')]);

    const [android, ios] = sentPayload(requests);
    expect(android!['channelId']).toBe('completed');
    expect(android!['categoryId']).toBeUndefined();
    expect(android!['priority']).toBeUndefined();
    expect(ios!['interruptionLevel']).toBe('active');
    expect(ios!['categoryId']).toBeUndefined();
  });
});
