// ────────────────────────────────────────────────────────────────
// AgentHostClient — W12, the gateway-side proxy to the agent-host process.
//
// Found during end-to-end review with ZERO test coverage and two real bugs:
// `sendPromptAndWait` listened for an event kind ('chat.message_complete')
// that nothing in the codebase ever emits, so every turn resolved via
// 'harness.idle' with a hardcoded `{content: ''}` regardless of what the
// assistant actually said — and `getMessages()` read from a map nothing ever
// wrote to. Both are fixed; these tests pin the fix so it cannot regress.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';

import type { AgentEvent, ILogger } from '@generatorai/shared';

import { AgentHostClient } from '../src/services/AgentHostClient.js';
import type { HostSupervisor } from '../src/infrastructure/HostSupervisor.js';

function mockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger;
}

/** A supervisor stub that never talks to a real child process. */
function makeSupervisor(sendImpl?: (req: unknown) => Promise<{ type: string; message?: string }>) {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    send: vi.fn(sendImpl ?? (async () => ({ type: 'ok' }))),
  } as unknown as HostSupervisor;
}

function messageComplete(content: string): AgentEvent {
  return { kind: 'harness.message_complete', data: { content } } as unknown as AgentEvent;
}

function idle(): AgentEvent {
  return { kind: 'harness.idle', data: {} } as unknown as AgentEvent;
}

describe('AgentHostClient.sendPromptAndWait', () => {
  it('resolves with the actual assistant content, not a hardcoded empty string', async () => {
    const client = new AgentHostClient(makeSupervisor(), mockLogger());
    const conversationId = await client.createConversation({} as never);

    const pending = client.sendPromptAndWait(conversationId, 'hello');
    client.handleHostEvent({ type: 'agent_event', sessionId: conversationId, event: messageComplete('hi there') });
    client.handleHostEvent({ type: 'agent_event', sessionId: conversationId, event: idle() });

    await expect(pending).resolves.toEqual({ content: 'hi there' });
  });

  it('resolves with only the FINAL text segment when a turn emits several', async () => {
    // Matches every other provider's contract — see ChatMessage.ts's
    // `textSegments` doc: "content holds only the final one."
    const client = new AgentHostClient(makeSupervisor(), mockLogger());
    const conversationId = await client.createConversation({} as never);

    const pending = client.sendPromptAndWait(conversationId, 'hello');
    client.handleHostEvent({ type: 'agent_event', sessionId: conversationId, event: messageComplete('planning…') });
    client.handleHostEvent({ type: 'agent_event', sessionId: conversationId, event: messageComplete('done.') });
    client.handleHostEvent({ type: 'agent_event', sessionId: conversationId, event: idle() });

    await expect(pending).resolves.toEqual({ content: 'done.' });
  });

  it('resolves with whatever streamed so far on cancellation, not empty content', async () => {
    const client = new AgentHostClient(makeSupervisor(), mockLogger());
    const conversationId = await client.createConversation({} as never);

    const pending = client.sendPromptAndWait(conversationId, 'hello');
    client.handleHostEvent({ type: 'agent_event', sessionId: conversationId, event: messageComplete('partial answer') });
    client.handleHostEvent({
      type: 'agent_event',
      sessionId: conversationId,
      event: { kind: 'harness.cancelled', data: { reason: 'user_abort' } } as unknown as AgentEvent,
    });

    // W13 — cancellation is a semantic success, never a throw.
    await expect(pending).resolves.toEqual({ content: 'partial answer' });
  });

  it('rejects with the harness error message on harness.error', async () => {
    const client = new AgentHostClient(makeSupervisor(), mockLogger());
    const conversationId = await client.createConversation({} as never);

    const pending = client.sendPromptAndWait(conversationId, 'hello');
    client.handleHostEvent({
      type: 'agent_event',
      sessionId: conversationId,
      event: { kind: 'harness.error', data: { message: 'boom' } } as unknown as AgentEvent,
    });

    await expect(pending).rejects.toThrow('boom');
  });
});

describe('AgentHostClient.getMessages', () => {
  it('accumulates both the user prompt and the assistant reply', async () => {
    const client = new AgentHostClient(makeSupervisor(), mockLogger());
    const conversationId = await client.createConversation({} as never);

    const pending = client.sendPromptAndWait(conversationId, 'hello');
    client.handleHostEvent({ type: 'agent_event', sessionId: conversationId, event: messageComplete('hi there') });
    client.handleHostEvent({ type: 'agent_event', sessionId: conversationId, event: idle() });
    await pending;

    const messages = await client.getMessages(conversationId);
    expect(messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'hello' }),
      expect.objectContaining({ role: 'assistant', content: 'hi there' }),
    ]);
  });

  it('returns an empty array for a conversation that was never created', async () => {
    const client = new AgentHostClient(makeSupervisor(), mockLogger());
    expect(await client.getMessages('never-created')).toEqual([]);
  });
});
