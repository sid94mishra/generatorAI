import { describe, expect, it, vi } from 'vitest';

import {
  PushDispatcher,
  type PushMessage,
  type PushTarget,
} from '../src/services/push/PushDispatcher.js';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
} as never;

function target(overrides: Partial<PushTarget> = {}): PushTarget {
  return {
    deviceId: 'dev-1',
    scopes: ['read:workflows', 'read:chats'],
    token: 'ExponentPushToken[xxx]',
    provider: 'expo',
    platform: 'ios',
    mutedUntil: null,
    ...overrides,
  };
}

function makeDispatcher(targets: PushTarget[], now = { value: 1_000 }) {
  const sent: PushMessage[][] = [];
  const recordSuccess = vi.fn();
  const recordFailure = vi.fn();

  const dispatcher = new PushDispatcher({
    listTargets: () => targets,
    recordSuccess,
    recordFailure,
    provider: {
      send: async (messages) => {
        sent.push(messages);
        return messages.map((m) => ({ deviceId: m.target.deviceId, ok: true }));
      },
    },
    logger,
    clock: () => now.value,
  });

  return { dispatcher, sent, recordSuccess, recordFailure, now };
}

const gate = { kind: 'stage_run.awaiting_input', data: { workflowRunId: 'r1', name: 'Deploy' } };

describe('PushDispatcher — scope enforcement', () => {
  it('delivers only to devices holding the required read scope', () => {
    // Push must not become a side channel around the authorization model
    // that every HTTP route is checked against.
    const { dispatcher } = makeDispatcher([
      target({ deviceId: 'allowed', scopes: ['read:workflows'] }),
      target({ deviceId: 'denied', scopes: ['read:chats'] }),
    ]);

    const messages = dispatcher.handleEvent(gate);
    expect(messages.map((m) => m.target.deviceId)).toEqual(['allowed']);
  });

  it('sends a chat notification only to devices with read:chats', () => {
    const { dispatcher } = makeDispatcher([
      target({ deviceId: 'workflows-only', scopes: ['read:workflows'] }),
      target({ deviceId: 'chats', scopes: ['read:chats'] }),
    ]);

    const messages = dispatcher.handleEvent({
      kind: 'chat.question.asked',
      data: { chatId: 'c1' },
    });
    expect(messages.map((m) => m.target.deviceId)).toEqual(['chats']);
  });

  it('sends nothing when no device is authorized', () => {
    const { dispatcher, sent } = makeDispatcher([target({ scopes: [] })]);
    expect(dispatcher.handleEvent(gate)).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('PushDispatcher — noise control', () => {
  it('ignores high-frequency stream events entirely', () => {
    const { dispatcher, sent } = makeDispatcher([target()]);
    for (const kind of ['harness.token', 'stage_run.running', 'harness.tool_start']) {
      expect(dispatcher.handleEvent({ kind, data: { workflowRunId: 'r1' } })).toEqual([]);
    }
    expect(sent).toEqual([]);
  });

  it('suppresses a repeat of the same gate within the window', () => {
    // Agents re-emit gate events on reconnect and replay. Buzzing a phone
    // five times for one approval is how users disable notifications.
    const { dispatcher } = makeDispatcher([target()]);
    expect(dispatcher.handleEvent(gate)).toHaveLength(1);
    expect(dispatcher.handleEvent(gate)).toHaveLength(0);
    expect(dispatcher.handleEvent(gate)).toHaveLength(0);
  });

  it('allows a repeat once the window has passed', () => {
    const now = { value: 1_000 };
    const { dispatcher } = makeDispatcher([target()], now);
    expect(dispatcher.handleEvent(gate)).toHaveLength(1);
    now.value += 61_000;
    expect(dispatcher.handleEvent(gate)).toHaveLength(1);
  });

  it('does not suppress a DIFFERENT subject', () => {
    const { dispatcher } = makeDispatcher([target()]);
    dispatcher.handleEvent(gate);
    expect(
      dispatcher.handleEvent({
        kind: 'stage_run.awaiting_input',
        data: { workflowRunId: 'r2', name: 'Other' },
      }),
    ).toHaveLength(1);
  });

  it('dedupes per device, not globally', () => {
    // Two phones must both be told; suppressing the second because the first
    // was notified would silently break multi-device setups.
    const { dispatcher } = makeDispatcher([
      target({ deviceId: 'phone' }),
      target({ deviceId: 'tablet' }),
    ]);
    expect(dispatcher.handleEvent(gate)).toHaveLength(2);
  });

  it('prunes the dedupe cache so it cannot grow without bound', () => {
    const now = { value: 1_000 };
    const { dispatcher } = makeDispatcher([target()], now);
    dispatcher.handleEvent(gate);
    now.value += 120_000;
    dispatcher.pruneDedupeCache();
    // Pruned, so the same event is deliverable again.
    expect(dispatcher.handleEvent(gate)).toHaveLength(1);
  });
});

describe('PushDispatcher — muting', () => {
  it('honours a mute for completions', () => {
    const { dispatcher } = makeDispatcher([target({ mutedUntil: 999_999 })]);
    expect(
      dispatcher.handleEvent({ kind: 'workflow_run.completed', data: { workflowRunId: 'r1' } }),
    ).toEqual([]);
  });

  it('ignores a mute for approvals', () => {
    // Muting approvals would let a user silently block their own agents.
    const { dispatcher } = makeDispatcher([target({ mutedUntil: 999_999 })]);
    expect(dispatcher.handleEvent(gate)).toHaveLength(1);
  });

  it('resumes delivery once the mute expires', () => {
    const now = { value: 1_000_000 };
    const { dispatcher } = makeDispatcher([target({ mutedUntil: 999_999 })], now);
    expect(
      dispatcher.handleEvent({ kind: 'workflow_run.completed', data: { workflowRunId: 'r1' } }),
    ).toHaveLength(1);
  });
});

describe('PushDispatcher — delivery outcomes', () => {
  it('records success per device', async () => {
    const { dispatcher, recordSuccess } = makeDispatcher([target()]);
    dispatcher.handleEvent(gate);
    await Promise.resolve();
    await Promise.resolve();
    expect(recordSuccess).toHaveBeenCalledWith('dev-1');
  });

  it('records a failure so a dead token is eventually dropped', async () => {
    const recordFailure = vi.fn();
    const dispatcher = new PushDispatcher({
      listTargets: () => [target()],
      recordSuccess: vi.fn(),
      recordFailure,
      provider: {
        send: async (messages) =>
          messages.map((m) => ({ deviceId: m.target.deviceId, ok: false, error: 'DeviceNotRegistered' })),
      },
      logger,
    });

    dispatcher.handleEvent(gate);
    await Promise.resolve();
    await Promise.resolve();
    expect(recordFailure).toHaveBeenCalledWith('dev-1', 'DeviceNotRegistered');
  });

  it('never lets a provider error escape into the event bus', async () => {
    // A stalled bus is an outage; a dropped notification is an annoyance.
    const dispatcher = new PushDispatcher({
      listTargets: () => [target()],
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
      provider: {
        send: async () => {
          throw new Error('push service unreachable');
        },
      },
      logger,
    });

    expect(() => dispatcher.handleEvent(gate)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('carries the gate identity, actions and category for a permission prompt', () => {
    // Everything the phone needs to answer from the lock screen without
    // opening the UI: which chat, which gate, and which decisions exist.
    const { dispatcher } = makeDispatcher([target()]);
    const [message] = dispatcher.handleEvent({
      kind: 'chat.permission.requested',
      data: {
        chatId: 'c1',
        interactionId: 'i1',
        toolName: 'Bash',
        inputSummary: 'pnpm test',
        description: 'Run a shell command',
      },
    });
    expect(message!.title).toBe('Allow Bash: pnpm test?');
    expect(message!.categoryId).toBe('approval');
    expect(message!.data).toEqual({
      route: '/chats/c1/gate/i1',
      category: 'approval',
      threadId: 'chat:c1',
      chatId: 'c1',
      interactionId: 'i1',
      kind: 'permission',
      actions: ['approve', 'deny'],
    });
  });

  it('names the approval category for every approval, but never for other categories', () => {
    const { dispatcher } = makeDispatcher([target()]);
    const [approval] = dispatcher.handleEvent(gate);
    expect(approval!.categoryId).toBe('approval');
    // A workflow gate has no chat interaction, so no per-gate fields leak in.
    expect(approval!.data).toEqual({ route: '/runs/r1', category: 'approval', threadId: 'run:r1' });

    const [done] = dispatcher.handleEvent({
      kind: 'workflow_run.completed',
      data: { workflowRunId: 'r2' },
    });
    expect(done!.categoryId).toBeUndefined();
  });

  it('dedupes a permission prompt per chat, so a replayed gate does not buzz twice', () => {
    const { dispatcher } = makeDispatcher([target()]);
    const prompt = {
      kind: 'chat.permission.requested',
      data: { chatId: 'c1', interactionId: 'i1', toolName: 'Bash' },
    };
    expect(dispatcher.handleEvent(prompt)).toHaveLength(1);
    expect(dispatcher.handleEvent(prompt)).toHaveLength(0);
  });

  it('carries the deep-link route in the payload', () => {
    // A notification that cannot navigate is worse than none.
    const { dispatcher } = makeDispatcher([target()]);
    const [message] = dispatcher.handleEvent(gate);
    expect(message!.data.route).toBe('/runs/r1');
    expect(message!.threadId).toBe('run:r1');
    expect(message!.interruption).toBe('timeSensitive');
  });
});
