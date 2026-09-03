import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatCommands } from '../chat.js';
import type { CliContext } from '../../context/CliContext.js';

const CHAT_SUMMARY = { id: 'chat_1', name: 'test', status: 'active', createdAt: 0, updatedAt: 0 };

function fakeContext(overrides: {
  send?: ReturnType<typeof vi.fn>;
  sendWithAttachments?: ReturnType<typeof vi.fn>;
  messages?: ReturnType<typeof vi.fn>;
  sessionId?: string | null;
  /** The single event the fake stream emits before the wait resolves. */
  streamEvent?: { kind: string; data: Record<string, unknown> };
  emit?: ReturnType<typeof vi.fn>;
}): CliContext {
  const send = overrides.send ?? vi.fn(async () => ({ sessionId: 's1' }));
  const sendWithAttachments = overrides.sendWithAttachments ?? vi.fn(async () => ({ sessionId: 's1' }));
  const messages = overrides.messages ?? vi.fn(async () => []);

  return {
    api: {
      chats: {
        list: vi.fn(async () => [CHAT_SUMMARY]),
        get: vi.fn(async () => ({ ...CHAT_SUMMARY, sessionId: overrides.sessionId ?? 's1' })),
        send,
        sendWithAttachments,
        messages,
      },
    },
    stream: {
      // Immediately completes the turn — every test here cares about what
      // was sent and returned, not about timing.
      subscribe: (_scope: string, _id: string, cb: (event: { kind: string; data: Record<string, unknown> }) => void) => {
        queueMicrotask(() => cb(overrides.streamEvent ?? { kind: 'harness.completion', data: {} }));
        return () => {};
      },
    },
    emit: overrides.emit ?? vi.fn(),
    chunk: vi.fn(),
    onDispose: vi.fn(),
    signal: new AbortController().signal,
  } as unknown as CliContext;
}

const send = chatCommands().find((c) => c.id === 'chat.send')!;

describe('chat send', () => {
  it('refuses --model outright instead of silently sending without it', async () => {
    const sendFn = vi.fn();
    const ctx = fakeContext({ send: sendFn });
    await expect(
      send.handler(ctx, {
        args: { chat: 'chat_1', prompt: 'hi' },
        flags: { verbosity: 'normal', model: 'gpt-5' },
      } as never),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('refuses --agent outright instead of silently sending without it', async () => {
    const sendFn = vi.fn();
    const ctx = fakeContext({ send: sendFn });
    await expect(
      send.handler(ctx, {
        args: { chat: 'chat_1', prompt: 'hi' },
        flags: { verbosity: 'normal', agent: 'reviewer' },
      } as never),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('reads --attach files and sends them through sendWithAttachments, not the plain JSON send', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'generatorai-chat-attach-'));
    const filePath = join(dir, 'note.txt');
    writeFileSync(filePath, 'hello attachment');
    try {
      const sendFn = vi.fn();
      const sendWithAttachments = vi.fn(async () => ({ sessionId: 's1' }));
      const ctx = fakeContext({ send: sendFn, sendWithAttachments });

      await send.handler(ctx, {
        args: { chat: 'chat_1', prompt: 'see attached' },
        flags: { verbosity: 'normal', attach: [filePath] },
      } as never);

      expect(sendFn).not.toHaveBeenCalled();
      expect(sendWithAttachments).toHaveBeenCalledTimes(1);
      const [, body, attachments] = sendWithAttachments.mock.calls[0]!;
      expect(body).toEqual({ message: 'see attached' });
      expect(attachments).toEqual([{ name: 'note.txt', data: expect.anything() }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails clearly when an --attach path cannot be read, rather than sending a partial set', async () => {
    const sendWithAttachments = vi.fn();
    const ctx = fakeContext({ sendWithAttachments });
    await expect(
      send.handler(ctx, {
        args: { chat: 'chat_1', prompt: 'see attached' },
        flags: { verbosity: 'normal', attach: ['/does/not/exist/at/all.txt'] },
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(sendWithAttachments).not.toHaveBeenCalled();
  });

  it('--no-stream waits for the turn to complete before returning, and returns the latest message', async () => {
    const sendFn = vi.fn(async () => ({ sessionId: 's1' }));
    const messages = vi.fn(async () => [{ id: 'm1', role: 'assistant', content: 'done', timestamp: 0 }]);
    const ctx = fakeContext({ send: sendFn, messages });

    const result = await send.handler(ctx, {
      args: { chat: 'chat_1', prompt: 'hi' },
      flags: { verbosity: 'normal', noStream: true },
    } as never);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(messages).toHaveBeenCalledWith('chat_1', { limit: 1 });
    expect(result.data).toEqual({ id: 'm1', role: 'assistant', content: 'done', timestamp: 0 });
  });

  it('--no-stream reports a failed exit code when the awaited turn ended in harness.error, not "Turn complete."', async () => {
    const sendFn = vi.fn(async () => ({ sessionId: 's1' }));
    const ctx = fakeContext({
      send: sendFn,
      streamEvent: { kind: 'harness.error', data: { message: 'model unavailable' } },
    });

    const result = await send.handler(ctx, {
      args: { chat: 'chat_1', prompt: 'hi' },
      flags: { verbosity: 'normal', noStream: true },
    } as never);

    expect(result.exitCode).toBeDefined();
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toContain('model unavailable');
  });

  it('streaming mode also reports a failed exit code on harness.error, not silent success', async () => {
    const sendFn = vi.fn(async () => ({ sessionId: 's1' }));
    const ctx = fakeContext({
      send: sendFn,
      streamEvent: { kind: 'harness.error', data: { message: 'boom' } },
    });

    const result = await send.handler(ctx, {
      args: { chat: 'chat_1', prompt: 'hi' },
      flags: { verbosity: 'normal' },
    } as never);

    expect(result.exitCode).toBeDefined();
    expect(result.exitCode).not.toBe(0);
  });

  it('--no-stream suppresses the generic stream event too, not just its own rendering', async () => {
    const sendFn = vi.fn(async () => ({ sessionId: 's1' }));
    const emit = vi.fn();
    const ctx = fakeContext({ send: sendFn, emit });

    await send.handler(ctx, {
      args: { chat: 'chat_1', prompt: 'hi' },
      flags: { verbosity: 'normal', noStream: true },
    } as never);

    // Previously `streamUntil` emitted a `stream` event for every event
    // regardless of the caller's own `silent` gating — visible as a `data`
    // frame in `--ndjson` even though `--no-stream` promises nothing prints
    // while waiting.
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'stream' }));
  });
});
