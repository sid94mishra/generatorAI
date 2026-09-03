import { describe, expect, it, vi } from 'vitest';
import {
  AdmissionController,
  AdmissionTimeoutError,
  laneFor,
  sizeLane,
} from '../src/services/AdmissionController.js';

/** Resolve-on-demand promise, so a task can be parked deterministically. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('laneFor — the §3.9 `attended` predicate', () => {
  it('routes attended work to the reserved interactive lane', () => {
    expect(laneFor({ attended: true })).toBe('interactive');
    // `bulk` never overrides attendedness: a human is waiting either way.
    expect(laneFor({ attended: true, bulk: true })).toBe('interactive');
  });

  it('routes unattended work to ordinary, and opted-in background work to bulk', () => {
    expect(laneFor({ attended: false })).toBe('ordinary');
    expect(laneFor({ attended: false, bulk: true })).toBe('bulk');
  });
});

describe('sizeLane — dynamic sizing with the active bound reported', () => {
  it('reports `cpu` when CPU count is the binding constraint', () => {
    const d = sizeLane('ordinary', undefined, { cpus: 4, totalMemBytes: 64 * 1024 ** 3 });
    expect(d.limit).toBe(4);
    expect(d.boundBy).toBe('cpu');
  });

  it('reports `memory` when RAM is the binding constraint', () => {
    // 2 GB / 512 MB-per-task = 4, below the 32 CPUs.
    const d = sizeLane('ordinary', undefined, { cpus: 32, totalMemBytes: 2 * 1024 ** 3 });
    expect(d.limit).toBe(4);
    expect(d.boundBy).toBe('memory');
  });

  it('reports `hardCap` on a large machine rather than fanning out unbounded', () => {
    const d = sizeLane('ordinary', undefined, { cpus: 128, totalMemBytes: 512 * 1024 ** 3 });
    expect(d.limit).toBe(16);
    expect(d.boundBy).toBe('hardCap');
  });

  it('reports `floor` on a starved machine so it stays usable', () => {
    const d = sizeLane('ordinary', undefined, { cpus: 1, totalMemBytes: 256 * 1024 ** 2 });
    expect(d.limit).toBe(2);
    expect(d.boundBy).toBe('floor');
  });

  it('clamps an explicit configured value instead of trusting it', () => {
    // W18: "Clamp configuration on load, log, and audit" — an operator cannot
    // set 10_000 and remove the bound the lane exists to provide.
    const probe = { cpus: 8, totalMemBytes: 32 * 1024 ** 3 };
    expect(sizeLane('ordinary', 10_000, probe).limit).toBe(16);
    expect(sizeLane('ordinary', 6, probe).limit).toBe(6);
  });

  it('honours a deliberate concurrency of 1 rather than raising it to the auto-sizing floor', () => {
    // The floor guards auto-sizing on a starved box; it must not override an
    // operator who explicitly asked for serial execution.
    const probe = { cpus: 8, totalMemBytes: 32 * 1024 ** 3 };
    expect(sizeLane('ordinary', 1, probe).limit).toBe(1);
  });

  it('reads an explicit 0 as 1, not as Semaphore’s "unlimited"', () => {
    // `new Semaphore(0)` disables limiting entirely. Someone typing 0 into a
    // concurrency cap means "as little as possible", never "no cap at all".
    const probe = { cpus: 8, totalMemBytes: 32 * 1024 ** 3 };
    expect(sizeLane('ordinary', 0, probe).limit).toBe(1);
    expect(sizeLane('ordinary', -5, probe).limit).toBe(1);
  });
});

describe('AdmissionController', () => {
  it('runs a task and reports it as running while in flight', async () => {
    const ac = new AdmissionController({ ordinaryConcurrency: 2 });
    const gate = deferred();
    const p = ac.admit('ordinary', async () => {
      await gate.promise;
      return 'done';
    });
    await flush();
    expect(ac.running('ordinary')).toBe(1);
    gate.resolve();
    await expect(p).resolves.toBe('done');
    expect(ac.running('ordinary')).toBe(0);
  });

  it('queues rather than rejecting when the lane is full', async () => {
    const ac = new AdmissionController({ ordinaryConcurrency: 1 });
    const gate = deferred();
    const started: number[] = [];

    const a = ac.admit('ordinary', async () => {
      started.push(1);
      await gate.promise;
    });
    const b = ac.admit('ordinary', async () => {
      started.push(2);
    });
    await flush();

    expect(started).toEqual([1]);
    expect(ac.depth('ordinary')).toBe(1);

    gate.resolve();
    await Promise.all([a, b]);
    expect(started).toEqual([1, 2]);
  });

  it('releases the permit when the task throws', async () => {
    const ac = new AdmissionController({ ordinaryConcurrency: 1 });
    await expect(
      ac.admit('ordinary', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(ac.running('ordinary')).toBe(0);
    // The lane is usable again — a leaked permit would hang this.
    await expect(ac.admit('ordinary', async () => 'ok')).resolves.toBe('ok');
  });

  it('keeps lanes independent — a saturated bulk lane does not block interactive', async () => {
    const ac = new AdmissionController({ interactiveConcurrency: 2, bulkConcurrency: 1 });
    const gate = deferred();
    void ac.admit('bulk', async () => {
      await gate.promise;
    });
    void ac.admit('bulk', async () => {
      await gate.promise;
    });
    await flush();

    await expect(ac.admit('interactive', async () => 'fast')).resolves.toBe('fast');
    gate.resolve();
  });

  // ── W18's headline acceptance criterion ──────────────────────────────
  // "with 8 stages on approval, unrelated runs still progress"
  describe('parking across an approval wait', () => {
    it('lets unrelated work run while every permit-holder is parked', async () => {
      const ac = new AdmissionController({ ordinaryConcurrency: 8 });
      const approvals = Array.from({ length: 8 }, () => deferred());

      // Eight stages take a permit, then park on human approval.
      const parked = approvals.map((approval) =>
        ac.admit('ordinary', async (ticket) => {
          ticket.pause();
          await approval.promise;
          await ticket.resume();
          return 'approved';
        }),
      );
      await flush();

      // All eight are parked, none are running, so the lane is free.
      expect(ac.parked('ordinary')).toBe(8);
      expect(ac.running('ordinary')).toBe(0);

      // The criterion: an unrelated run still progresses. Before the ticket
      // existed this call sat in the queue behind eight parked stages.
      await expect(ac.admit('ordinary', async () => 'unrelated')).resolves.toBe('unrelated');

      approvals.forEach((a) => a.resolve());
      await expect(Promise.all(parked)).resolves.toEqual(Array(8).fill('approved'));
      expect(ac.parked('ordinary')).toBe(0);
      expect(ac.running('ordinary')).toBe(0);
    });

    it('re-queues on resume when the lane has filled up meanwhile', async () => {
      const ac = new AdmissionController({ ordinaryConcurrency: 1 });
      const approval = deferred();
      const occupier = deferred();

      const parkedTask = ac.admit('ordinary', async (ticket) => {
        ticket.pause();
        await approval.promise;
        await ticket.resume();
        return 'resumed';
      });
      await flush();

      // Someone else takes the only slot while the first task is parked.
      const other = ac.admit('ordinary', async () => {
        await occupier.promise;
        return 'other';
      });
      await flush();
      expect(ac.running('ordinary')).toBe(1);

      approval.resolve();
      await flush();
      // The resuming task must wait — it does not get to jump the cap.
      expect(ac.depth('ordinary')).toBe(1);

      occupier.resolve();
      await expect(other).resolves.toBe('other');
      await expect(parkedTask).resolves.toBe('resumed');
      expect(ac.running('ordinary')).toBe(0);
    });

    it('treats pause() and resume() as idempotent', async () => {
      const ac = new AdmissionController({ ordinaryConcurrency: 1 });
      await ac.admit('ordinary', async (ticket) => {
        ticket.pause();
        ticket.pause(); // no double-release
        await ticket.resume();
        await ticket.resume(); // no double-acquire
      });
      // A double release would leave the counter above the cap; a double
      // acquire would leave it below. Both show up as a broken lane here.
      expect(ac.running('ordinary')).toBe(0);
      expect(ac.parked('ordinary')).toBe(0);
      await expect(ac.admit('ordinary', async () => 'ok')).resolves.toBe('ok');
    });

    it('accounts correctly when a parked task throws without resuming', async () => {
      const ac = new AdmissionController({ ordinaryConcurrency: 1 });
      await expect(
        ac.admit('ordinary', async (ticket) => {
          ticket.pause();
          throw new Error('cancelled while parked');
        }),
      ).rejects.toThrow('cancelled while parked');

      expect(ac.parked('ordinary')).toBe(0);
      expect(ac.running('ordinary')).toBe(0);
      await expect(ac.admit('ordinary', async () => 'ok')).resolves.toBe('ok');
    });
  });

  describe('queue-wait timeout', () => {
    it('rejects with AdmissionTimeoutError after the queue deadline', async () => {
      const ac = new AdmissionController({ ordinaryConcurrency: 1, queueWaitTimeoutMs: 20 });
      const gate = deferred();
      const holder = ac.admit('ordinary', async () => {
        await gate.promise;
      });
      await flush();

      await expect(ac.admit('ordinary', async () => 'never')).rejects.toBeInstanceOf(
        AdmissionTimeoutError,
      );

      gate.resolve();
      await holder;
    });

    it('does not leak the slot when a timed-out waiter is later granted a permit', async () => {
      const ac = new AdmissionController({ ordinaryConcurrency: 1, queueWaitTimeoutMs: 20 });
      const gate = deferred();
      const holder = ac.admit('ordinary', async () => {
        await gate.promise;
      });
      await flush();

      await expect(ac.admit('ordinary', async () => 'never')).rejects.toBeInstanceOf(
        AdmissionTimeoutError,
      );

      // The holder finishes and hands its permit to the abandoned waiter.
      // That permit must come back, or the lane is permanently one slot down.
      gate.resolve();
      await holder;
      await flush();

      await expect(ac.admit('ordinary', async () => 'ok')).resolves.toBe('ok');
      expect(ac.depth('ordinary')).toBe(0);
      expect(ac.running('ordinary')).toBe(0);
    });

    it('waits indefinitely when the timeout is disabled with 0', async () => {
      const ac = new AdmissionController({ ordinaryConcurrency: 1, queueWaitTimeoutMs: 0 });
      const gate = deferred();
      const holder = ac.admit('ordinary', async () => {
        await gate.promise;
      });
      await flush();

      const queued = ac.admit('ordinary', async () => 'eventually');
      await new Promise((r) => setTimeout(r, 30));
      expect(ac.depth('ordinary')).toBe(1);

      gate.resolve();
      await holder;
      await expect(queued).resolves.toBe('eventually');
    });
  });

  describe('observability', () => {
    it('logs at INFO when work actually queues, and not when it does not', async () => {
      const info = vi.fn();
      const ac = new AdmissionController({
        ordinaryConcurrency: 1,
        logger: { info },
      });
      info.mockClear(); // drop the per-lane sizing lines from construction

      await ac.admit('ordinary', async () => 'immediate');
      expect(info).not.toHaveBeenCalledWith('[Admission] queued', expect.anything());

      const gate = deferred();
      const holder = ac.admit('ordinary', async () => {
        await gate.promise;
      });
      await flush();
      const queued = ac.admit('ordinary', async () => 'later');
      await flush();

      expect(info).toHaveBeenCalledWith('[Admission] queued', expect.objectContaining({ lane: 'ordinary' }));

      gate.resolve();
      await Promise.all([holder, queued]);
    });

    it('publishes cap/running/waiting/parked per lane', async () => {
      const ac = new AdmissionController({
        interactiveConcurrency: 2,
        ordinaryConcurrency: 1,
        bulkConcurrency: 1,
      });
      const gate = deferred();
      const approval = deferred();

      const holder = ac.admit('ordinary', async () => {
        await gate.promise;
      });
      await flush();
      const waiter = ac.admit('ordinary', async () => 'w');
      const parkedTask = ac.admit('bulk', async (t) => {
        t.pause();
        await approval.promise;
        await t.resume();
      });
      await flush();

      const ordinary = ac.snapshot().find((l) => l.lane === 'ordinary')!;
      expect(ordinary).toMatchObject({ concurrencyLimit: 1, running: 1, queued: 1, parked: 0 });
      expect(ac.snapshot().find((l) => l.lane === 'bulk')).toMatchObject({ parked: 1, running: 0 });

      gate.resolve();
      approval.resolve();
      await Promise.all([holder, waiter, parkedTask]);
    });

    it('reports how each lane was sized so the startup line is explainable', () => {
      const ac = new AdmissionController({ ordinaryConcurrency: 6 });
      const report = ac.sizingReport();
      expect(report.map((d) => d.lane)).toEqual(['interactive', 'ordinary', 'bulk']);
      expect(report.find((d) => d.lane === 'ordinary')).toMatchObject({
        limit: 6,
        boundBy: 'configured',
      });
    });
  });
});
