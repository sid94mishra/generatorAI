// ────────────────────────────────────────────────────────────────
// AgentHostSupervisor — W12 unit tests
//
// Validates:
//   - BoundedSemaphore FIFO order and concurrency cap
//   - acquireExecution / acquireColdStart idempotent release
//   - Instance lifecycle (register, markInUse, markIdle, unregister)
//   - shouldRecycle — age and RSS thresholds
//   - snapshot() reflects live state
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AgentHostSupervisor,
  type AgentHostSnapshot,
} from '../src/AgentHostSupervisor.js';

// ── helpers ──────────────────────────────────────────────────────

/** Returns a promise that resolves after `ms` ms. */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Tests ─────────────────────────────────────────────────────────

describe('AgentHostSupervisor — W12', () => {
  let sup: AgentHostSupervisor;

  beforeEach(() => {
    sup = new AgentHostSupervisor({
      maxConcurrentExecutions: 2,
      maxConcurrentColdStarts: 1,
      instanceMaxAgeMs: 1000,       // 1 s for fast age tests
      instanceMaxRssBytes: 100,     // 100 B for RSS tests
      rssProbeMinAgeMs: 0,          // probe immediately
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── execution semaphore ─────────────────────────────────────────

  describe('execution semaphore', () => {
    it('allows up to maxConcurrentExecutions simultaneous holders', async () => {
      const r1 = await sup.acquireExecution();
      const r2 = await sup.acquireExecution();

      // 3rd acquire should queue
      let r3Acquired = false;
      const p3 = sup.acquireExecution().then((r) => {
        r3Acquired = true;
        return r;
      });

      await delay(10);
      expect(r3Acquired).toBe(false); // still waiting

      r1(); // release one slot
      const r3 = await p3;
      expect(r3Acquired).toBe(true);

      r2();
      r3();
    });

    it('release is idempotent — double-release does not corrupt available count', async () => {
      const release = await sup.acquireExecution();
      release();
      release(); // second call must be a no-op

      // Both execution slots should be available again
      const ra = await sup.acquireExecution();
      const rb = await sup.acquireExecution();

      let rcAcquired = false;
      const pc = sup.acquireExecution().then((r) => { rcAcquired = true; return r; });
      await delay(10);
      expect(rcAcquired).toBe(false); // cap respected

      ra(); rb();
      const rc = await pc;
      rc();
    });

    it('snapshot reflects queued waiters', async () => {
      const r1 = await sup.acquireExecution();
      const r2 = await sup.acquireExecution();

      // queue a 3rd waiter
      const p3 = sup.acquireExecution();
      await delay(5);

      const snap: AgentHostSnapshot = sup.snapshot();
      expect(snap.executionQueueDepth).toBe(1);
      expect(snap.maxConcurrentExecutions).toBe(2);

      r1(); r2();
      const r3 = await p3;
      r3();
    });
  });

  // ── cold-start semaphore ────────────────────────────────────────

  describe('cold-start semaphore', () => {
    it('allows only 1 concurrent cold-start', async () => {
      const c1 = await sup.acquireColdStart();

      let c2Acquired = false;
      const pc2 = sup.acquireColdStart().then((r) => {
        c2Acquired = true;
        return r;
      });

      await delay(10);
      expect(c2Acquired).toBe(false);

      c1();
      const c2 = await pc2;
      expect(c2Acquired).toBe(true);
      c2();
    });
  });

  // ── instance lifecycle ──────────────────────────────────────────

  describe('instance lifecycle', () => {
    it('registerInstance creates a record', () => {
      sup.registerInstance('inst-1', 'sess-a');
      expect(sup.snapshot().instanceCount).toBe(1);
    });

    it('registerInstance with same id is idempotent', () => {
      sup.registerInstance('inst-1', 'sess-a');
      sup.registerInstance('inst-1', 'sess-b'); // second call: should add session id, not duplicate record
      expect(sup.snapshot().instanceCount).toBe(1);
    });

    it('markInUse / markIdle update inUse flag (blocks recycle)', () => {
      sup.registerInstance('inst-1');
      sup.markInUse('inst-1');
      // RSS over limit, but in-use → should NOT recycle
      expect(sup.shouldRecycle('inst-1', 999)).toBe(false);

      sup.markIdle('inst-1');
      // idle and RSS over limit → should recycle
      expect(sup.shouldRecycle('inst-1', 999)).toBe(true);
    });

    it('unregisterInstance removes the record', () => {
      sup.registerInstance('inst-1');
      sup.unregisterInstance('inst-1');
      expect(sup.snapshot().instanceCount).toBe(0);
    });

    it('operations on unknown instanceId are silently no-ops', () => {
      // Must not throw
      sup.markInUse('ghost');
      sup.markIdle('ghost');
      sup.unregisterInstance('ghost');
      expect(sup.shouldRecycle('ghost')).toBe(false);
    });
  });

  // ── shouldRecycle ───────────────────────────────────────────────

  describe('shouldRecycle', () => {
    it('recycles when age >= maxAgeMs', async () => {
      sup.registerInstance('aged');
      // Wait past the 1s maxAgeMs set in beforeEach
      await delay(1010);
      expect(sup.shouldRecycle('aged')).toBe(true);
    });

    it('recycles when RSS >= maxRssBytes and age >= rssProbeMinAgeMs', () => {
      sup.registerInstance('rss-heavy');
      // rssProbeMinAgeMs = 0 so probe fires immediately
      expect(sup.shouldRecycle('rss-heavy', 200)).toBe(true);
    });

    it('does not recycle when RSS is under the limit', () => {
      sup.registerInstance('rss-ok');
      expect(sup.shouldRecycle('rss-ok', 50)).toBe(false);
    });

    it('does not recycle when instance is in-use even if limits exceeded', async () => {
      sup.registerInstance('busy');
      sup.markInUse('busy');
      await delay(1010);
      expect(sup.shouldRecycle('busy', 9999)).toBe(false);
    });
  });

  // ── logStatus ───────────────────────────────────────────────────

  describe('logStatus', () => {
    it('does not throw', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      expect(() => sup.logStatus()).not.toThrow();
      consoleSpy.mockRestore();
    });
  });
});
