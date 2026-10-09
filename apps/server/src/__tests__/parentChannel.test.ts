// F-4 / F-8 (D-128) — the server's channel to whoever started it: an Electron
// utility process's parentPort or a Node IPC slot, and the vault-key handoff
// that replaced GENERATORAI_SECRET_KEY in the desktop app's child environment.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { parentChannel, receiveSecretKey, watchParentExit, type ParentChannel } from '../parentChannel.js';

function fakeChannel(reply?: (sent: unknown, deliver: (m: unknown) => void) => void): ParentChannel & { sent: unknown[] } {
  const bus = new EventEmitter();
  const sent: unknown[] = [];
  return {
    kind: 'utility',
    sent,
    send: (m) => {
      sent.push(m);
      reply?.(m, (r) => bus.emit('m', r));
    },
    onMessage: (l) => {
      bus.on('m', l);
      return () => bus.off('m', l);
    },
  };
}

describe('parentChannel', () => {
  it('speaks an Electron parentPort (messages arrive as { data })', () => {
    const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
    const proc = { parentPort: port } as unknown as NodeJS.Process;
    const channel = parentChannel(proc)!;
    expect(channel.kind).toBe('utility');
    const got: unknown[] = [];
    const off = channel.onMessage((m) => got.push(m));
    port.emit('message', { data: { type: 'shutdown' } });
    off();
    port.emit('message', { data: { type: 'late' } });
    channel.send({ type: 'x' });
    expect(got).toEqual([{ type: 'shutdown' }]);
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'x' });
  });

  it('speaks a Node IPC slot, and is null for a headless server', () => {
    const proc = Object.assign(new EventEmitter(), { send: vi.fn() }) as unknown as NodeJS.Process;
    const channel = parentChannel(proc)!;
    expect(channel.kind).toBe('ipc');
    const got: unknown[] = [];
    channel.onMessage((m) => got.push(m));
    (proc as unknown as EventEmitter).emit('message', { type: 'shutdown' });
    channel.send({ type: 'y' });
    expect(got).toEqual([{ type: 'shutdown' }]);
    expect((proc as unknown as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalledWith({ type: 'y' });
    expect(parentChannel(new EventEmitter() as unknown as NodeJS.Process)).toBeNull();
  });
});

describe('receiveSecretKey', () => {
  it('asks for the key and resolves with the answer (asking means no message is lost to a late listener)', async () => {
    const channel = fakeChannel((sent, deliver) => {
      if ((sent as { type: string }).type === 'secret-key-request') {
        deliver({ type: 'browser.ensure-tab', workspaceId: 'w' }); // unrelated traffic is ignored
        deliver({ type: 'secret-key', key: 'a2V5' });
      }
    });
    await expect(receiveSecretKey(channel, 1_000)).resolves.toBe('a2V5');
    expect(channel.sent).toEqual([{ type: 'secret-key-request' }]);
  });

  it('resolves null when the shell has no key to give, and rejects when nobody answers', async () => {
    await expect(receiveSecretKey(fakeChannel((_s, deliver) => deliver({ type: 'secret-key', key: null })), 1_000)).resolves.toBeNull();
    await expect(receiveSecretKey(fakeChannel(), 50)).rejects.toThrow(/did not hand over the vault key/);
  });
});

describe('watchParentExit', () => {
  it('fires once the original parent is gone (reparented, or signal 0 fails)', () => {
    vi.useFakeTimers();
    try {
      const proc = { ppid: 100, kill: vi.fn() } as unknown as NodeJS.Process;
      const gone = vi.fn();
      watchParentExit(gone, 1_000, proc);
      vi.advanceTimersByTime(3_000);
      expect(gone).not.toHaveBeenCalled();
      (proc as { ppid: number }).ppid = 1;
      vi.advanceTimersByTime(1_000);
      expect(gone).toHaveBeenCalledTimes(1);

      const proc2 = {
        ppid: 200,
        kill: vi.fn(() => {
          throw Object.assign(new Error('gone'), { code: 'ESRCH' });
        }),
      } as unknown as NodeJS.Process;
      const gone2 = vi.fn();
      watchParentExit(gone2, 1_000, proc2);
      vi.advanceTimersByTime(1_000);
      expect(gone2).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
