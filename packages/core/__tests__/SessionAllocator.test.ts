// ────────────────────────────────────────────────────────────────
// SessionAllocator Tests — focus on single-mode ref-counting (EXEC-8)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionAllocator } from '../src/services/SessionAllocator.js';
import { EventBus } from '../src/events/EventBus.js';
import type { ISessionRepository } from '../src/domain/ports/IRepositories.js';
import type { CreateConversationParams, IAgentHarness } from '../src/domain/ports/IAgentHarness.js';
import type { Session } from '@generatorai/shared';

const RUN = 'run-1';

function makeMocks() {
  const sessions = new Map<string, Session>();
  const sessionRepo = {
    create: async (s: Session) => {
      sessions.set(s.id, { ...s });
    },
    getById: async (id: string) => {
      const s = sessions.get(id);
      if (!s) throw new Error(`no session ${id}`);
      return s;
    },
    updateStatus: async (id: string, status: Session['status']) => {
      const s = sessions.get(id);
      if (s) s.status = status;
    },
    update: async (id: string, patch: Partial<Session>) => {
      const s = sessions.get(id);
      if (s) Object.assign(s, patch);
    },
  } as unknown as ISessionRepository;

  const counters = { destroy: 0, create: 0, resume: 0 };
  const live = new Set<string>();
  const resumedWith: unknown[] = [];
  const harness = {
    createConversation: async (p: { conversationId: string }) => {
      counters.create++;
      live.add(p.conversationId);
    },
    destroyConversation: async () => {
      counters.destroy++;
    },
    resumeConversation: async (id: string, params?: unknown) => {
      counters.resume++;
      live.add(id);
      resumedWith.push(params);
    },
    hasLiveConversation: (id: string) => live.has(id),
  } as unknown as IAgentHarness;

  const allocator = new SessionAllocator(sessionRepo, harness, new EventBus());
  return { allocator, counters, sessions, live, resumedWith };
}

/** The composer's stand-in: an empty config for every identity. */
const build = async () => ({}) as CreateConversationParams;

describe('SessionAllocator — single mode ref-counting (EXEC-8)', () => {
  let allocator: SessionAllocator;
  let counters: { destroy: number; create: number; resume: number };
  let sessions: Map<string, Session>;

  beforeEach(() => {
    ({ allocator, counters, sessions } = makeMocks());
  });

  it('re-allocating the SAME stage (retry) does not double-count the shared ref', async () => {
    // First allocation creates the shared session (refcount → 1).
    await allocator.allocateSession(RUN, 'stage-1', 'single', build);
    // A retry re-allocates for the same stageRunId WITHOUT an intervening
    // release. This must NOT bump the refcount again.
    await allocator.allocateSession(RUN, 'stage-1', 'single', build);

    expect(counters.create).toBe(1); // only one shared session ever created
    expect(sessions.size).toBe(1);

    // A single release brings the (idempotent) refcount to 0 → session destroyed.
    await allocator.releaseSession('stage-1');
    expect(counters.destroy).toBe(1);
  });

  it('shares one session across distinct stages and destroys it only on the last release', async () => {
    await allocator.allocateSession(RUN, 'stage-1', 'single', build);
    await allocator.allocateSession(RUN, 'stage-2', 'single', build);

    expect(counters.create).toBe(1); // shared
    expect(sessions.size).toBe(1);

    await allocator.releaseSession('stage-1');
    expect(counters.destroy).toBe(0); // stage-2 still holds it

    await allocator.releaseSession('stage-2');
    expect(counters.destroy).toBe(1); // last release destroys the shared session
  });

  it('per-stage mode creates and destroys an independent session per stage', async () => {
    await allocator.allocateSession(RUN, 'stage-1', 'per-stage', build);
    await allocator.allocateSession(RUN, 'stage-2', 'per-stage', build);
    expect(counters.create).toBe(2);

    await allocator.releaseSession('stage-1');
    expect(counters.destroy).toBe(1);
  });

  it('R4 — a shared conversation lost to a restart is attached WITH the composed config', async () => {
    const m = makeMocks();
    await m.allocator.allocateSession(RUN, 'stage-1', 'single', build);
    m.live.clear(); // the process restarted: nothing is in memory
    const composed = { model: 'composed', tools: [] } as unknown as CreateConversationParams;
    await m.allocator.allocateSession(RUN, 'stage-2', 'single', async () => composed);
    expect(m.resumedWith).toEqual([composed]);
    // A live one keeps its config: no rebind.
    await m.allocator.allocateSession(RUN, 'stage-3', 'single', async () => composed);
    expect(m.resumedWith).toHaveLength(1);
  });
});
