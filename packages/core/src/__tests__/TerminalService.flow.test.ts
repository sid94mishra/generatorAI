// ────────────────────────────────────────────────────────────────
// TerminalService — session-owned watermark (P1-28), end-to-end credit
// acks (P0-23 rebuilt), and host selection (boot race + sandbox routing).
//
// There was no `TerminalService` test at all before this file. A fake
// `ITerminalHost` is used rather than a real PTY because every property here
// is about byte accounting and host-selection ORDER at exact thresholds,
// neither of which a real shell can be made to hit deterministically. The
// real-process coverage of the same wiring lives in `PtyHostAdapter.test.ts`.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import type { ILogger, TerminalHostKind } from '@generatorai/shared';
import { TerminalService } from '../services/TerminalService.js';
import type {
  ITerminalHandle,
  ITerminalHost,
  TerminalSpawnOptions,
} from '../domain/ports/ITerminalHost.js';
import type { EventBus } from '../events/EventBus.js';

const HIGH = 1_000;
const LOW = 200;

function mockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger;
}

function fakeEventBus(): EventBus {
  return { emit: vi.fn(async () => undefined) } as unknown as EventBus;
}

class FakeHandle implements ITerminalHandle {
  readonly id: string;
  readonly workspaceId: string;
  readonly host: TerminalHostKind;
  pid: number | null = 1234;
  readonly cwd = '/tmp';
  readonly shell = '/bin/sh';
  cols = 80;
  rows = 24;
  exitCode: number | null = null;
  exitSignal: string | undefined;
  readonly createdAt = Date.now();

  /** Ordered log of every flow-control action, so ordering is assertable. */
  readonly actions: string[] = [];
  /** Total credit returned through the optional `ack` hook. */
  credited = 0;

  private dataCbs = new Set<(c: Buffer) => void>();
  private exitCbs = new Set<(i: { code: number; signal?: string }) => void>();

  constructor(id: string, workspaceId: string, host: TerminalHostKind, private readonly supportsAck: boolean) {
    this.id = id;
    this.workspaceId = workspaceId;
    this.host = host;
    if (!supportsAck) delete (this as Partial<ITerminalHandle>).ack;
  }

  emit(bytes: number): void {
    const buf = Buffer.alloc(bytes, 0x61);
    for (const cb of this.dataCbs) cb(buf);
  }

  fireExit(code: number): void {
    this.exitCode = code;
    for (const cb of this.exitCbs) cb({ code });
  }

  write(): void { /* not under test */ }
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; }
  signal(): void { /* not under test */ }
  kill(): void { this.actions.push('kill'); }
  pause(): void { this.actions.push('pause'); }
  resume(): void { this.actions.push('resume'); }
  ack(bytes: number): void {
    if (!this.supportsAck) return;
    this.credited += bytes;
    this.actions.push(`ack:${bytes}`);
  }
  onData(cb: (c: Buffer) => void): () => void { this.dataCbs.add(cb); return () => this.dataCbs.delete(cb); }
  onExit(cb: (i: { code: number; signal?: string }) => void): () => void {
    this.exitCbs.add(cb);
    return () => this.exitCbs.delete(cb);
  }
}

class FakeHost implements ITerminalHost {
  readonly handles: FakeHandle[] = [];
  spawnCalls: TerminalSpawnOptions[] = [];

  constructor(
    readonly kind: TerminalHostKind,
    private available = true,
    private readonly opts: { supportsAck?: boolean; canServe?: (o: TerminalSpawnOptions) => boolean; whenReady?: () => Promise<void> } = {},
  ) {
    if (opts.canServe) this.canServe = opts.canServe;
    if (opts.whenReady) this.whenReady = opts.whenReady;
  }

  canServe?: (o: TerminalSpawnOptions) => boolean;
  whenReady?: () => Promise<void>;

  setAvailable(v: boolean): void { this.available = v; }
  isAvailable(): boolean { return this.available; }

  async spawn(o: TerminalSpawnOptions): Promise<ITerminalHandle> {
    this.spawnCalls.push(o);
    const h = new FakeHandle(`h${this.handles.length}`, o.workspaceId, this.kind, this.opts.supportsAck ?? true);
    this.handles.push(h);
    return h;
  }
}

function makeService(hosts: ITerminalHost[]): TerminalService {
  return new TerminalService(
    hosts,
    fakeEventBus(),
    mockLogger(),
    async () => '/tmp/workspace',
    { highWatermarkBytes: HIGH, lowWatermarkBytes: LOW, idleReaperMs: 60_000 },
  );
}

describe('TerminalService — session watermark (P1-28)', () => {
  it('does not pause while nobody is attached — output with no viewer has nothing to wait for', async () => {
    const host = new FakeHost('pty-host');
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });

    host.handles[0]!.emit(HIGH * 10);

    expect(svc.flowState(d.id)).toMatchObject({ paused: false, outstanding: 0 });
    expect(host.handles[0]!.actions.filter((a) => a === 'pause')).toHaveLength(0);
  });

  it('pauses the shared PTY once the SLOWEST viewer falls behind, and resumes only when it catches up', async () => {
    const host = new FakeHost('pty-host');
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });
    const handle = host.handles[0]!;

    const a = svc.attachViewer(d.id)!;
    const b = svc.attachViewer(d.id)!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    handle.emit(HIGH);
    expect(svc.flowState(d.id)!.paused).toBe(true);

    // A alone catching up must NOT release the PTY — B is still behind, and it
    // is the same PTY. This is the exact oscillation the per-connection
    // watermark produced: A's ack used to call `terminalService.resume()`.
    a.ack(HIGH);
    expect(svc.flowState(d.id)!.paused).toBe(true);
    expect(handle.actions.filter((x) => x === 'resume')).toHaveLength(0);

    b.ack(HIGH);
    expect(svc.flowState(d.id)!.paused).toBe(false);
    expect(handle.actions.filter((x) => x === 'resume')).toHaveLength(1);
  });

  it('a viewer leaving releases the backpressure it was contributing', async () => {
    const host = new FakeHost('pty-host');
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });

    const fast = svc.attachViewer(d.id)!;
    const slow = svc.attachViewer(d.id)!;
    host.handles[0]!.emit(HIGH);
    fast.ack(HIGH);
    expect(svc.flowState(d.id)!.paused).toBe(true);

    slow.detach();
    expect(svc.flowState(d.id)!.paused).toBe(false);
  });

  it('a viewer that attaches mid-flood starts caught up rather than instantly pinning the session', async () => {
    const host = new FakeHost('pty-host');
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });

    host.handles[0]!.emit(HIGH * 5); // Long before anyone was watching.
    const late = svc.attachViewer(d.id)!;
    expect(late).not.toBeNull();

    expect(svc.flowState(d.id)).toMatchObject({ paused: false, outstanding: 0 });
  });

  it('cannot be acked past what was actually sent', async () => {
    const host = new FakeHost('pty-host');
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });
    const viewer = svc.attachViewer(d.id)!;

    host.handles[0]!.emit(100);
    viewer.ack(1_000_000); // Buggy/hostile client.
    host.handles[0]!.emit(HIGH);

    // If the over-ack had been banked, `outstanding` would be negative and the
    // watermark would never fire again.
    expect(svc.flowState(d.id)!.paused).toBe(true);
  });

  it('a stalled socket pauses the session even while it is still acking', async () => {
    const host = new FakeHost('pty-host');
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });
    const viewer = svc.attachViewer(d.id)!;

    host.handles[0]!.emit(10);
    viewer.ack(10);
    expect(svc.flowState(d.id)!.paused).toBe(false);

    viewer.setStalled(true);
    expect(svc.flowState(d.id)!.paused).toBe(true);
    viewer.setStalled(false);
    expect(svc.flowState(d.id)!.paused).toBe(false);
  });

  it('releases the pause when the PTY exits, so a corpse is not left holding flow-control state', async () => {
    const host = new FakeHost('pty-host');
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });
    svc.attachViewer(d.id);

    host.handles[0]!.emit(HIGH);
    expect(svc.flowState(d.id)!.paused).toBe(true);

    host.handles[0]!.fireExit(0);
    expect(svc.flowState(d.id)).toMatchObject({ paused: false, viewers: 0 });
  });
});

describe('TerminalService — host credit (P0-23 rebuilt)', () => {
  it('credits the out-of-process host for every byte it takes, without waiting for a viewer', async () => {
    // `PtyHostClient.ack()` had ZERO callers, so the host-side credit counter
    // only ever climbed: past its 100 000-char high watermark the terminal was
    // frozen forever. Crediting must not depend on a viewer being attached —
    // an agent-driven terminal has none.
    const host = new FakeHost('pty-host');
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });
    expect(d.id).toBeTruthy();

    host.handles[0]!.emit(4_096);
    host.handles[0]!.emit(4_096);

    expect(host.handles[0]!.credited).toBe(8_192);
  });

  it('does not depend on the client ack batch size — credit is released even when no ack ever arrives', async () => {
    const host = new FakeHost('pty-host');
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });
    svc.attachViewer(d.id); // Attached, but silent — never acks.

    host.handles[0]!.emit(HIGH * 3);

    // Session watermark holds the PTY (correct — the viewer IS behind), but the
    // host has been fully credited, so it is not ALSO wedged on its own
    // counter. Chaining the two loops is what re-creates the P0-23 freeze on
    // the tail of the last partial ack batch.
    expect(svc.flowState(d.id)!.paused).toBe(true);
    expect(host.handles[0]!.credited).toBe(HIGH * 3);
  });

  it('is a no-op for hosts that own the PTY in-process and have nothing to credit', async () => {
    const host = new FakeHost('node-pty', true, { supportsAck: false });
    const svc = makeService([host]);
    const d = await svc.spawn({ workspaceId: 'w1' });
    expect(d.host).toBe('node-pty');

    expect(() => host.handles[0]!.emit(4_096)).not.toThrow();
    expect(host.handles[0]!.credited).toBe(0);
  });
});

describe('TerminalService — host selection', () => {
  it('skips a host that cannot serve THIS spawn instead of routing every terminal to it', async () => {
    // `SandboxPtyHost` sits first in the chain and reports available whenever
    // docker is on PATH, but its `spawn()` throws unless `attachToSandbox` was
    // asked for — so on any machine with docker, first-available selection
    // handed it every ordinary terminal and every one of them failed.
    const sandbox = new FakeHost('sandbox', true, { canServe: (o) => o.attachToSandbox === true });
    const node = new FakeHost('node-pty');
    const svc = makeService([sandbox, node]);

    const ordinary = await svc.spawn({ workspaceId: 'w1' });
    expect(ordinary.host).toBe('node-pty');
    expect(sandbox.spawnCalls).toHaveLength(0);

    const attached = await svc.spawn({ workspaceId: 'w1', attachToSandbox: true, runId: 'r1' });
    expect(attached.host).toBe('sandbox');
  });

  it('waits for a host that is still starting rather than silently falling through to the next one', async () => {
    // The boot race: `start()` is fire-and-forget, so terminals opened in the
    // first few hundred ms landed on the in-process host while later ones
    // landed on the pty host — one pool, two hosts, decided by timing.
    const ptyHost = new FakeHost('pty-host', false);
    let resolveStart!: () => void;
    const started = new Promise<void>((r) => { resolveStart = r; });
    ptyHost.whenReady = () => started;

    const node = new FakeHost('node-pty');
    const svc = makeService([ptyHost, node]);

    const pending = svc.spawn({ workspaceId: 'w1' });

    // Boot completes a moment later.
    ptyHost.setAvailable(true);
    resolveStart();

    expect((await pending).host).toBe('pty-host');
    expect(node.spawnCalls).toHaveLength(0);
  });

  it('falls through when the starting host never becomes available', async () => {
    const ptyHost = new FakeHost('pty-host', false);
    ptyHost.whenReady = async () => undefined; // Settled, still unavailable.
    const node = new FakeHost('node-pty');
    const svc = makeService([ptyHost, node]);

    expect((await svc.spawn({ workspaceId: 'w1' })).host).toBe('node-pty');
  });
});
