// ────────────────────────────────────────────────────────────────
// Semaphore (P1#7) — bounded concurrency limiter
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { Semaphore } from '../src/utils/Semaphore.js';

describe('Semaphore', () => {
  it('allows up to N holders concurrently and queues the rest (FIFO)', async () => {
    const sem = new Semaphore(2);
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;

    const task = (id: number) =>
      sem.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(id);
        await new Promise((r) => setTimeout(r, 10));
        active -= 1;
      });

    await Promise.all([task(1), task(2), task(3), task(4)]);

    // Never more than 2 running at once.
    expect(maxActive).toBe(2);
    // All four ran.
    expect(order.sort()).toEqual([1, 2, 3, 4]);
  });

  it('hands a released permit directly to the next waiter (no double-count)', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    expect(sem.availablePermits).toBe(0);

    let secondAcquired = false;
    const waiter = sem.acquire().then(() => {
      secondAcquired = true;
    });

    // Still blocked while the single permit is held.
    await new Promise((r) => setTimeout(r, 5));
    expect(secondAcquired).toBe(false);
    expect(sem.pending).toBe(1);

    sem.release();
    await waiter;
    expect(secondAcquired).toBe(true);
    // Permit went straight to the waiter — none left free.
    expect(sem.availablePermits).toBe(0);
  });

  it('treats permits <= 0 as unlimited (every acquire resolves immediately)', async () => {
    const sem = new Semaphore(0);
    await sem.acquire();
    await sem.acquire();
    await sem.acquire();
    expect(sem.pending).toBe(0);
    // release is a no-op when unlimited
    sem.release();
    expect(sem.availablePermits).toBe(Number.POSITIVE_INFINITY);
  });

  it('releases the permit even when the task throws', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // Permit returned — a subsequent run proceeds.
    const result = await sem.run(async () => 'ok');
    expect(result).toBe('ok');
    expect(sem.availablePermits).toBe(1);
  });
});
