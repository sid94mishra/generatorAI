import { describe, expect, it, vi } from 'vitest';
import type { MuxStreamEvent, MuxSubscribeOptions } from '@generatorai/client-core';
import { createLifecycleStream } from '../lifecycleStream';

function harness() {
  const clients: Array<{ subscriptions: Array<{ scope: string; id: string; handler: (event: MuxStreamEvent) => void; options?: MuxSubscribeOptions }>; disposeAll: ReturnType<typeof vi.fn> }> = [];
  const create = vi.fn(() => {
    const subscriptions: (typeof clients)[number]['subscriptions'] = [];
    const client = {
      subscriptions, disposeAll: vi.fn(), rejectedScopes: () => [], resetRejections: vi.fn(),
      subscribe: (scope: string, id: string, handler: (event: MuxStreamEvent) => void, options?: MuxSubscribeOptions) => {
        const sub = { scope, id, handler, options };
        subscriptions.push(sub);
        return () => { const at = subscriptions.indexOf(sub); if (at >= 0) subscriptions.splice(at, 1); };
      },
    };
    clients.push(client);
    return client;
  });
  return { create, clients };
}

describe('native lifecycle stream', () => {
  it('keeps mounted subscriptions and drains missed pages before reopening from the last cursor', async () => {
    const { create, clients } = harness();
    const replay = vi.fn().mockResolvedValueOnce({ rows: [{ seq: 8, kind: 'chat.done', payload: { done: true } }], nextAfterSeq: 8 }).mockResolvedValueOnce({ rows: [], nextAfterSeq: 8 });
    const stream = createLifecycleStream(create, replay);
    const handler = vi.fn();
    stream.subscribe('chat', 'c1', handler);
    await stream.resume();
    clients[0]!.subscriptions[0]!.handler({ sequence: 7, kind: 'chat.delta', data: {} });
    stream.suspend();
    expect(clients[0]!.disposeAll).toHaveBeenCalledOnce();
    await stream.resume();
    expect(replay).toHaveBeenNthCalledWith(1, 'chat', 'c1', 7);
    expect(handler).toHaveBeenLastCalledWith({ sequence: 8, kind: 'chat.done', data: { done: true } });
    expect(clients[1]!.subscriptions[0]!.options?.afterSequence).toBe(8);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('does not resurrect the connection or deliver replay after background cancellation', async () => {
    const { create } = harness();
    let finish!: (value: { rows: Array<{ seq: number; kind: string }>; nextAfterSeq: number }) => void;
    const replay = vi.fn(() => new Promise<{ rows: Array<{ seq: number; kind: string }>; nextAfterSeq: number }>((resolve) => { finish = resolve; }));
    const stream = createLifecycleStream(create, replay);
    const handler = vi.fn();
    stream.subscribe('chat', 'c1', handler, { afterSequence: 1 });
    const pending = stream.resume();
    stream.suspend();
    finish({ rows: [{ seq: 2, kind: 'chat.done' }], nextAfterSeq: 2 });
    await pending;
    expect(create).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
  it('retries a failed catch-up and never reattaches an unsubscribed scope', async () => {
    const { create, clients } = harness();
    const replay = vi.fn().mockRejectedValueOnce(new Error('unreachable')).mockResolvedValue({ rows: [], nextAfterSeq: 1 });
    const stream = createLifecycleStream(create, replay);
    const unsubscribe = stream.subscribe('chat', 'c1', vi.fn(), { afterSequence: 1 });
    await expect(stream.resume()).rejects.toThrow('unreachable');
    expect(create).not.toHaveBeenCalled();
    unsubscribe();
    await stream.resume();
    expect(clients[0]!.subscriptions).toHaveLength(0);
    stream.disposeAll();
    await stream.resume();
    expect(create).toHaveBeenCalledOnce();
  });
});
