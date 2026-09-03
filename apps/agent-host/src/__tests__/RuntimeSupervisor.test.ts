import { describe, it, expect, vi } from 'vitest';
import { RuntimeSupervisor, MAX_RUNTIME_AGE_MS, type RuntimeEntry, type RuntimeSupervisorOptions } from '../RuntimeSupervisor.js';
import { FakeHarness, recordingLogger } from './helpers/fakeHarness.js';

type SupervisorOverrides = Partial<Omit<RuntimeSupervisorOptions, 'logger'>>;

function makeSupervisor(overrides: SupervisorOverrides = {}) {
  const logger = recordingLogger();
  const created: FakeHarness[] = [];
  const supervisor = new RuntimeSupervisor({
    logger,
    createHarness: async () => {
      const h = new FakeHarness(`replacement-${created.length}`);
      created.push(h);
      return h.asHarness();
    },
    ...overrides,
  });
  return { supervisor, logger, created };
}

/** Force a runtime to look older than it is. */
function age(entry: RuntimeEntry, ms: number): void {
  entry.startedAt = Date.now() - ms;
}

describe('RuntimeSupervisor recycling (W12)', () => {
  it('does nothing while runtimes are within budget', async () => {
    const original = new FakeHarness('original');
    const { supervisor } = makeSupervisor({ probeRss: async () => 10 });
    supervisor.register(original.asHarness());

    await supervisor.runRecyclePass();

    expect(original.stopped).toBe(false);
    expect(supervisor.stats().recycleCount).toBe(0);
  });

  it('recycles a runtime older than the age budget', async () => {
    const original = new FakeHarness('original');
    const { supervisor, created } = makeSupervisor({ probeRss: async () => 10 });
    const id = supervisor.register(original.asHarness());
    age(supervisor.get(id)!, MAX_RUNTIME_AGE_MS + 1);

    await supervisor.runRecyclePass();

    expect(original.stopped).toBe(true);
    expect(created).toHaveLength(1);
    expect(supervisor.get(id)).toBeUndefined();
    expect(supervisor.stats().runtimeCount).toBe(1);
    expect(supervisor.stats().recycleCount).toBe(1);
  });

  it('does not probe RSS for a runtime younger than the probe floor', async () => {
    const probeRss = vi.fn(async () => 10_000 * 1024 * 1024); // absurdly over budget
    const original = new FakeHarness('original');
    const { supervisor } = makeSupervisor({ probeRss, rssProbeMinAgeMs: 60_000 });
    supervisor.register(original.asHarness());

    await supervisor.runRecyclePass();

    // A freshly booted provider's RSS is dominated by module loading; probing
    // it would recycle it in a loop.
    expect(probeRss).not.toHaveBeenCalled();
    expect(original.stopped).toBe(false);
  });

  it('recycles on RSS once past the probe floor, and records the sample', async () => {
    const original = new FakeHarness('original');
    const { supervisor, created } = makeSupervisor({
      probeRss: async () => 600 * 1024 * 1024,
      rssProbeMinAgeMs: 1,
      maxRuntimeRssBytes: 500 * 1024 * 1024,
    });
    const id = supervisor.register(original.asHarness());
    age(supervisor.get(id)!, 10_000);

    await supervisor.runRecyclePass();

    expect(original.stopped).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('drain-and-swaps sessions rather than dropping them', async () => {
    const original = new FakeHarness('original');
    const moved: Array<{ from: string; to: string }> = [];
    const { supervisor } = makeSupervisor({
      probeRss: async () => 10,
      drainSessions: async (from: RuntimeEntry, to: RuntimeEntry) => {
        moved.push({ from: from.id, to: to.id });
      },
    });
    const id = supervisor.register(original.asHarness());
    age(supervisor.get(id)!, MAX_RUNTIME_AGE_MS + 1);

    await supervisor.runRecyclePass();

    expect(moved).toHaveLength(1);
    expect(moved[0]!.from).toBe(id);
    expect(moved[0]!.to).not.toBe(id);
  });

  it('keeps the old runtime when the swap fails, and tears down the half-built replacement', async () => {
    const original = new FakeHarness('original');
    const { supervisor, logger } = makeSupervisor({
      probeRss: async () => 10,
      drainSessions: async () => {
        throw new Error('migration exploded');
      },
    });
    const id = supervisor.register(original.asHarness());
    age(supervisor.get(id)!, MAX_RUNTIME_AGE_MS + 1);

    await supervisor.runRecyclePass();

    // A runtime over its budget still answers prompts; a host with no runtime
    // answers nothing.
    expect(original.stopped).toBe(false);
    expect(supervisor.get(id)).toBeDefined();
    expect(supervisor.get(id)!.draining).toBe(false);
    expect(supervisor.stats().runtimeCount).toBe(1);
    expect(logger.lines.some((l) => l.includes('keeping the old runtime'))).toBe(true);
  });

  it('refuses to recycle (and says so once) when no replacement factory exists', async () => {
    const logger = recordingLogger();
    const original = new FakeHarness('original');
    const supervisor = new RuntimeSupervisor({ logger, probeRss: async () => 10 });
    const id = supervisor.register(original.asHarness());
    age(supervisor.get(id)!, MAX_RUNTIME_AGE_MS + 1);

    await supervisor.runRecyclePass();
    await supervisor.runRecyclePass();

    expect(original.stopped).toBe(false);
    expect(logger.lines.filter((l) => l.includes('recycling is disabled')).length).toBe(1);
  });

  it('never hands a new session to a draining runtime', async () => {
    const original = new FakeHarness('original');
    const { supervisor } = makeSupervisor({
      probeRss: async () => 10,
      drainSessions: async (from: RuntimeEntry) => {
        // Mid-swap: pickRuntime must not return the runtime being drained.
        expect(supervisor.pickRuntime()?.id).not.toBe(from.id);
      },
    });
    const id = supervisor.register(original.asHarness());
    age(supervisor.get(id)!, MAX_RUNTIME_AGE_MS + 1);

    await supervisor.runRecyclePass();
    expect.assertions(1);
  });

  it('startRecycleTimer drives passes and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      const original = new FakeHarness('original');
      const { supervisor, created } = makeSupervisor({ probeRss: async () => 10 });
      const id = supervisor.register(original.asHarness());
      age(supervisor.get(id)!, MAX_RUNTIME_AGE_MS + 1);

      // Regression: runRecyclePass had NO caller and NO timer — it was a
      // logging stub that nothing ever invoked.
      supervisor.startRecycleTimer(1_000);
      await vi.advanceTimersByTimeAsync(1_100);

      expect(created).toHaveLength(1);
      supervisor.stopRecycleTimer();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not overlap passes', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const original = new FakeHarness('original');
    const { supervisor } = makeSupervisor({
      rssProbeMinAgeMs: 1,
      probeRss: async () => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return 10;
      },
    });
    const id = supervisor.register(original.asHarness());
    age(supervisor.get(id)!, 10_000);

    await Promise.all([supervisor.runRecyclePass(), supervisor.runRecyclePass(), supervisor.runRecyclePass()]);
    expect(maxConcurrent).toBe(1);
  });

  it('picks the least-loaded runtime', () => {
    const { supervisor } = makeSupervisor();
    const a = supervisor.register(new FakeHarness('a').asHarness());
    const b = supervisor.register(new FakeHarness('b').asHarness());
    supervisor.get(a)!.sessionCount = 5;
    supervisor.get(b)!.sessionCount = 1;
    expect(supervisor.pickRuntime()?.id).toBe(b);
  });
});
