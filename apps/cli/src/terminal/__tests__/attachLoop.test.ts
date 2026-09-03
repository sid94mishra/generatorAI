import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// `vi.mock`/`vi.hoisted` are hoisted above every import, including this
// file's own — a hoisted factory that reaches for the `EventEmitter` import
// itself hits it before that binding is initialised (a real, previously-hit
// footgun: `ReferenceError: Cannot access '__vi_import_0__' before
// initialization`). The fake below stays self-contained (its own tiny
// on/emit) specifically to avoid that.
const { FakeSocket } = vi.hoisted(() => {
  class FakeSocket {
    static OPEN = 1;
    static instances: FakeSocket[] = [];
    readyState = 0;
    sent: Array<Record<string, unknown>> = [];
    url: string;
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    constructor(url: string) {
      this.url = url;
      FakeSocket.instances.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return this;
    }
    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
    send(data: string): void {
      this.sent.push(JSON.parse(data) as Record<string, unknown>);
    }
    close(): void {
      this.readyState = 3;
    }
    open(): void {
      this.readyState = 1;
      this.emit('open');
    }
  }
  return { FakeSocket };
});

vi.mock('ws', () => ({ WebSocket: FakeSocket }));

// Imported after the mock so `attachLoop.ts`'s `import { WebSocket } from
// 'ws'` resolves to `FakeSocket`.
const { attachToTerminal } = await import('../attachLoop.js');

function fakeStdin(overrides: { isTTY?: boolean; isRaw?: boolean } = {}) {
  const stream = new EventEmitter() as unknown as NodeJS.ReadStream & {
    isTTY?: boolean;
    isRaw?: boolean;
  };
  stream.isTTY = overrides.isTTY ?? true;
  stream.isRaw = overrides.isRaw ?? false;
  (stream as unknown as { setRawMode: ReturnType<typeof vi.fn> }).setRawMode = vi.fn(
    (v: boolean) => {
      stream.isRaw = v;
      return stream;
    },
  );
  (stream as unknown as { resume: ReturnType<typeof vi.fn> }).resume = vi.fn(() => stream);
  (stream as unknown as { pause: ReturnType<typeof vi.fn> }).pause = vi.fn(() => stream);
  return stream;
}

function fakeStdout(cols = 80, rows = 24) {
  const stream = new EventEmitter() as unknown as NodeJS.WriteStream & {
    columns: number;
    rows: number;
  };
  stream.columns = cols;
  stream.rows = rows;
  (stream as unknown as { write: ReturnType<typeof vi.fn> }).write = vi.fn(() => true);
  return stream;
}

beforeEach(() => {
  FakeSocket.instances.length = 0;
});

describe('attachToTerminal', () => {
  it('creates a session sized to the real terminal when no terminalId is given', async () => {
    const create = vi.fn(async () => ({ id: 'term_new' }));
    const stdin = fakeStdin();
    const stdout = fakeStdout(100, 40);

    const promise = attachToTerminal({
      workspaceId: 'ws_1',
      api: { create, scrollback: vi.fn(async () => ({ data: '' })) },
      socketUrl: vi.fn(async (path) => `ws://x${path}`),
      stdin,
      stdout,
    });

    // Let the async setup (create + scrollback + socketUrl) settle before
    // the socket exists to open.
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(create).toHaveBeenCalledWith('ws_1', { cols: 100, rows: 40 });

    FakeSocket.instances[0]!.emit('close');
    await promise;
  });

  it('replays scrollback before the socket opens, in order', async () => {
    const stdin = fakeStdin();
    const stdout = fakeStdout();
    const writes: unknown[] = [];
    (stdout.write as ReturnType<typeof vi.fn>).mockImplementation((chunk: unknown) => {
      writes.push(chunk);
      return true;
    });

    const promise = attachToTerminal({
      workspaceId: 'ws_1',
      terminalId: 'term_1',
      api: { create: vi.fn(), scrollback: vi.fn(async () => ({ data: 'previous output' })) },
      socketUrl: vi.fn(async (path) => `ws://x${path}`),
      stdin,
      stdout,
    });

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(writes[0]).toBe('previous output');

    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit('close');
    await promise;
  });

  it('enters raw mode and sends the current size on open, then restores raw mode on detach', async () => {
    const stdin = fakeStdin({ isRaw: false });
    const stdout = fakeStdout(120, 30);

    const promise = attachToTerminal({
      workspaceId: 'ws_1',
      terminalId: 'term_1',
      api: { create: vi.fn(), scrollback: vi.fn(async () => ({ data: '' })) },
      socketUrl: vi.fn(async (path) => `ws://x${path}`),
      stdin,
      stdout,
    });

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0]!;
    socket.open();

    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    expect(socket.sent).toEqual(expect.arrayContaining([{ t: 'resize', cols: 120, rows: 30 }]));

    stdin.emit('data', Buffer.from('\x1d')); // Ctrl+]
    const outcome = await promise;

    expect(outcome).toEqual({ reason: 'detached', terminalId: 'term_1' });
    // Restored to the mode it found the terminal in, not hardcoded false.
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('forwards bytes typed before the detach chord, and nothing after it', async () => {
    const stdin = fakeStdin();
    const stdout = fakeStdout();

    const promise = attachToTerminal({
      workspaceId: 'ws_1',
      terminalId: 'term_1',
      api: { create: vi.fn(), scrollback: vi.fn(async () => ({ data: '' })) },
      socketUrl: vi.fn(async (path) => `ws://x${path}`),
      stdin,
      stdout,
    });

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.sent.length = 0; // drop the initial resize

    stdin.emit('data', Buffer.from('echo hi\x1dgarbage'));
    await promise;

    expect(socket.sent).toEqual([{ t: 'input', data: 'echo hi' }]);
  });

  it('writes binary frames straight to stdout and ACKs once the threshold is crossed', async () => {
    const stdin = fakeStdin();
    const stdout = fakeStdout();

    const promise = attachToTerminal({
      workspaceId: 'ws_1',
      terminalId: 'term_1',
      api: { create: vi.fn(), scrollback: vi.fn(async () => ({ data: '' })) },
      socketUrl: vi.fn(async (path) => `ws://x${path}`),
      stdin,
      stdout,
    });

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.sent.length = 0;

    const big = Buffer.alloc(64 * 1024, 'a');
    socket.emit('message', big, true);

    expect(stdout.write).toHaveBeenCalledWith(big);
    expect(socket.sent).toEqual([{ t: 'ack', bytes: 64 * 1024 }]);

    socket.emit('close');
    await promise;
  });

  it('resolves with the exit code on a real exit frame', async () => {
    const stdin = fakeStdin();
    const stdout = fakeStdout();

    const promise = attachToTerminal({
      workspaceId: 'ws_1',
      terminalId: 'term_1',
      api: { create: vi.fn(), scrollback: vi.fn(async () => ({ data: '' })) },
      socketUrl: vi.fn(async (path) => `ws://x${path}`),
      stdin,
      stdout,
    });

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.emit('message', Buffer.from(JSON.stringify({ t: 'exit', code: 3 })), false);

    await expect(promise).resolves.toEqual({ reason: 'exited', terminalId: 'term_1', exitCode: 3 });
  });

  it('resolves as aborted, and restores the terminal, when the caller signal fires', async () => {
    const stdin = fakeStdin({ isRaw: false });
    const stdout = fakeStdout();
    const controller = new AbortController();

    const promise = attachToTerminal({
      workspaceId: 'ws_1',
      terminalId: 'term_1',
      api: { create: vi.fn(), scrollback: vi.fn(async () => ({ data: '' })) },
      socketUrl: vi.fn(async (path) => `ws://x${path}`),
      stdin,
      stdout,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.instances[0]!.open();
    controller.abort();

    await expect(promise).resolves.toEqual({ reason: 'aborted', terminalId: 'term_1' });
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('maps a scope error onto a friendly message', async () => {
    const stdin = fakeStdin();
    const stdout = fakeStdout();

    const promise = attachToTerminal({
      workspaceId: 'ws_1',
      terminalId: 'term_1',
      api: { create: vi.fn(), scrollback: vi.fn(async () => ({ data: '' })) },
      socketUrl: vi.fn(async (path) => `ws://x${path}`),
      stdin,
      stdout,
    });

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.instances[0]!.emit('error', new Error('403 forbidden, INSUFFICIENT_SCOPE'));

    await expect(promise).resolves.toEqual({
      reason: 'error',
      terminalId: 'term_1',
      message: 'This device is not allowed to open terminals (missing exec:terminal).',
    });
  });
});
