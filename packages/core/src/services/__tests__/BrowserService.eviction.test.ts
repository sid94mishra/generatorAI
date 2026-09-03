// ────────────────────────────────────────────────────────────────
// BrowserService — max-concurrent LRU eviction (P1-26 related)
//
// Eviction sorted on `lastActivityAt` alone while the idle sweeper honours
// BOTH `lastFrameSentAt` and `visibility: 'visible'` (P0-25). A session the
// human was actively watching — screencasting frames, no clicks — therefore
// looked like the *most* idle session in the pool and was the first thing
// evicted when a new workspace needed a browser.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionWorkspace, ILogger } from '@generatorai/shared';
import type {
  IBrowserBridge,
  BrowserHandle,
  BrowserStartOptions,
} from '../../domain/ports/IBrowserBridge.js';
import { BrowserService } from '../BrowserService.js';

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

function makeBridge(): IBrowserBridge {
  return {
    isAvailable: async () => true,
    start: async (opts: BrowserStartOptions): Promise<BrowserHandle> => ({
      workspaceId: opts.workspaceId,
      cdpEndpoint: 'http://127.0.0.1:9333',
      targetId: `target-${opts.workspaceId}`,
      mode: 'screencast',
      hostRef: `ref-${opts.workspaceId}`,
    }),
    stop: async () => {},
  } as unknown as IBrowserBridge;
}

function makeWorkspace(id: string, visibility: 'visible' | 'headless'): ExecutionWorkspace {
  return {
    id,
    ownerType: 'chat',
    ownerId: id,
    rootPath: `C:/tmp/${id}`,
    status: 'active',
    gitEnabled: false,
    useWorktree: false,
    browserConfig: { enabled: true, visibility },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface SessionShape {
  lastActivityAt: number;
  lastFrameSentAt: number;
}

function makeService(maxConcurrent: number) {
  const stopped: string[] = [];
  const service = new BrowserService(
    { findById: async () => null, updateStatus: async () => {} } as never,
    { create: async () => {} } as never,
    { emit: async () => {} } as never,
    makeLogger(),
    [makeBridge()],
    { maxConcurrent },
  );
  const realStop = service.stop.bind(service);
  vi.spyOn(service, 'stop').mockImplementation(async (workspaceId: string, reason?: string) => {
    stopped.push(workspaceId);
    // Drop the record the way a real stop would, without touching Chromium.
    (service as unknown as { sessions: Map<string, unknown> }).sessions.delete(workspaceId);
    void realStop;
    void reason;
  });
  const sessions = (service as unknown as { sessions: Map<string, SessionShape> }).sessions;
  return { service, stopped, sessions };
}

/** Re-date a started session so the eviction comparator has something to sort. */
function setActivity(
  sessions: Map<string, SessionShape>,
  workspaceId: string,
  patch: Partial<SessionShape>,
): void {
  const rec = sessions.get(workspaceId);
  if (!rec) throw new Error(`no session for ${workspaceId}`);
  Object.assign(rec, patch);
}

describe('BrowserService LRU eviction', () => {
  it('does not evict the session that is still sending frames', async () => {
    const { service, stopped, sessions } = makeService(2);
    const now = Date.now();

    await service.ensureStarted(makeWorkspace('watched', 'headless'));
    await service.ensureStarted(makeWorkspace('stale', 'headless'));

    // `watched` has had no clicks for 10 minutes but is screencasting right
    // now — sorting on lastActivityAt alone makes it the eviction victim.
    setActivity(sessions, 'watched', {
      lastActivityAt: now - 10 * 60_000,
      lastFrameSentAt: now,
    });
    setActivity(sessions, 'stale', {
      lastActivityAt: now - 60_000,
      lastFrameSentAt: now - 60_000,
    });

    await service.ensureStarted(makeWorkspace('newcomer', 'headless'));

    expect(stopped).toEqual(['stale']);
  });

  it('prefers a headless victim over one the human can see', async () => {
    const { service, stopped, sessions } = makeService(2);
    const now = Date.now();

    await service.ensureStarted(makeWorkspace('visible', 'visible'));
    await service.ensureStarted(makeWorkspace('headless', 'headless'));

    // The visible session is by far the least recently used — and still must
    // not be the one that gets closed out from under the user.
    setActivity(sessions, 'visible', {
      lastActivityAt: now - 60 * 60_000,
      lastFrameSentAt: now - 60 * 60_000,
    });
    setActivity(sessions, 'headless', { lastActivityAt: now, lastFrameSentAt: now });

    await service.ensureStarted(makeWorkspace('newcomer', 'headless'));

    expect(stopped).toEqual(['headless']);
  });

  it('still evicts a visible session when it is the only candidate — the cap must hold', async () => {
    const { service, stopped } = makeService(1);

    await service.ensureStarted(makeWorkspace('only-visible', 'visible'));
    await service.ensureStarted(makeWorkspace('newcomer', 'headless'));

    expect(stopped).toEqual(['only-visible']);
  });

  it('evicts the least recently used of several headless sessions', async () => {
    const { service, stopped, sessions } = makeService(3);
    const now = Date.now();

    await service.ensureStarted(makeWorkspace('a', 'headless'));
    await service.ensureStarted(makeWorkspace('b', 'headless'));
    await service.ensureStarted(makeWorkspace('c', 'headless'));

    setActivity(sessions, 'a', { lastActivityAt: now - 5_000, lastFrameSentAt: 0 });
    setActivity(sessions, 'b', { lastActivityAt: now - 30_000, lastFrameSentAt: 0 });
    setActivity(sessions, 'c', { lastActivityAt: now - 1_000, lastFrameSentAt: 0 });

    await service.ensureStarted(makeWorkspace('d', 'headless'));

    expect(stopped).toEqual(['b']);
  });
});
