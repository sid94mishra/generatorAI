// ────────────────────────────────────────────────────────────────
// TerminalService — spawn cap accounting (P1-38)
//
// The global cap used `this.sessions.size`, which includes exited records.
// Those are deliberately retained for 5 minutes so a late reconnect can still
// replay `terminal.session_closed` — so 20 dead terminals refused every spawn
// on the whole server for five minutes. The per-workspace cap right below it
// already filtered corpses correctly.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import type { ILogger } from '@generatorai/shared';
import type { ITerminalHandle, ITerminalHost, TerminalSpawnOptions } from '../../domain/ports/ITerminalHost.js';
import { TerminalService } from '../TerminalService.js';

function makeLogger(): ILogger {
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

/** A handle whose exit can be driven from the test. */
class FakeHandle implements ITerminalHandle {
  readonly host = 'node-pty' as const;
  readonly pid = 1234;
  readonly shell = 'bash';
  readonly exitCode = null;
  readonly exitSignal = undefined;
  readonly createdAt = Date.now();
  private exitCbs: Array<(info: { code: number; signal?: string }) => void> = [];

  constructor(
    readonly id: string,
    readonly workspaceId: string,
    readonly cwd: string,
    readonly cols: number,
    readonly rows: number,
  ) {}

  write(): void {}
  resize(): void {}
  signal(): void {}
  kill(): void {}
  pause(): void {}
  resume(): void {}
  onData(): () => void {
    return () => {};
  }
  onExit(cb: (info: { code: number; signal?: string }) => void): () => void {
    this.exitCbs.push(cb);
    return () => {
      this.exitCbs = this.exitCbs.filter((c) => c !== cb);
    };
  }
  /** Test hook — fire the PTY exit that turns this record into a corpse. */
  fireExit(): void {
    for (const cb of this.exitCbs) cb({ code: 0 });
  }
}

function makeService(cfg: { maxGlobal: number; maxPerWorkspace: number }) {
  let seq = 0;
  const handles: FakeHandle[] = [];
  const host: ITerminalHost = {
    kind: 'node-pty',
    isAvailable: () => true,
    spawn: async (opts: TerminalSpawnOptions) => {
      const h = new FakeHandle(`sid-${++seq}`, opts.workspaceId, opts.cwd, opts.cols, opts.rows);
      handles.push(h);
      return h;
    },
  };
  const service = new TerminalService(
    [host],
    { emit: async () => {} } as never,
    makeLogger(),
    async () => 'C:/tmp/ws',
    { ...cfg, idleReaperMs: 3_600_000 },
  );
  return { service, handles };
}

describe('TerminalService spawn caps (P1-38)', () => {
  it('does not let exited records consume the global cap', async () => {
    const { service, handles } = makeService({ maxGlobal: 2, maxPerWorkspace: 5 });

    await service.spawn({ workspaceId: 'ws-a' });
    await service.spawn({ workspaceId: 'ws-b' });
    // Both are corpses now — retained for SSE replay, not occupying a slot.
    for (const h of handles) h.fireExit();

    await expect(service.spawn({ workspaceId: 'ws-c' })).resolves.toMatchObject({
      workspaceId: 'ws-c',
    });
  });

  it('still enforces the global cap against live sessions', async () => {
    const { service } = makeService({ maxGlobal: 2, maxPerWorkspace: 5 });

    await service.spawn({ workspaceId: 'ws-a' });
    await service.spawn({ workspaceId: 'ws-b' });

    await expect(service.spawn({ workspaceId: 'ws-c' })).rejects.toThrow(/server cap \(2\)/);
  });

  it('still enforces the per-workspace cap against live sessions', async () => {
    const { service } = makeService({ maxGlobal: 20, maxPerWorkspace: 2 });

    await service.spawn({ workspaceId: 'ws-a' });
    await service.spawn({ workspaceId: 'ws-a' });

    await expect(service.spawn({ workspaceId: 'ws-a' })).rejects.toThrow(/workspace cap \(2\)/);
  });

  it('frees a per-workspace slot once a session exits', async () => {
    const { service, handles } = makeService({ maxGlobal: 20, maxPerWorkspace: 1 });

    await service.spawn({ workspaceId: 'ws-a' });
    handles[0]!.fireExit();

    await expect(service.spawn({ workspaceId: 'ws-a' })).resolves.toBeDefined();
  });
});
