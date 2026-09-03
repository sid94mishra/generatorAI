// ────────────────────────────────────────────────────────────────
// ToolSemaphore — W13 / X-1.
//
// Shared by both providers' tool factories as of the end-to-end review
// (previously only claude-agent's had one; Copilot's custom tools ran with
// no concurrency bound at all). No dedicated test existed for the class
// itself before this — it was only ever exercised indirectly through the
// Claude provider's own tests.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { ToolSemaphore } from '../src/toolSemaphore.js';

describe('ToolSemaphore', () => {
  it('runs up to `permits` calls concurrently, no more', async () => {
    const sem = new ToolSemaphore(2);
    let active = 0;
    let maxActive = 0;
    const releasers: Array<() => void> = [];

    const task = () =>
      sem.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releasers.push(resolve));
        active -= 1;
      });

    const t1 = task();
    const t2 = task();
    const t3 = task();
    await Promise.resolve(); // let the two permitted tasks actually start
    await Promise.resolve();

    expect(active).toBe(2); // third is queued, not running
    expect(maxActive).toBe(2);

    releasers[0]!();
    await t1;
    await Promise.resolve();
    expect(active).toBe(2); // the queued third took the freed permit

    releasers[1]!();
    await t2;
    releasers[2]!();
    await t3;
    expect(active).toBe(0);
  });

  it('releases the permit even when the wrapped function throws', async () => {
    const sem = new ToolSemaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // If the permit leaked, this would hang forever instead of resolving.
    let ran = false;
    await sem.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('treats <= 0 permits as unlimited', async () => {
    const sem = new ToolSemaphore(0);
    let active = 0;
    let maxActive = 0;
    const releasers: Array<() => void> = [];

    const task = () =>
      sem.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releasers.push(resolve));
        active -= 1;
      });

    const tasks = [task(), task(), task(), task(), task()];
    await Promise.resolve();
    await Promise.resolve();

    expect(active).toBe(5); // none queued
    for (const r of releasers) r();
    await Promise.all(tasks);
    expect(maxActive).toBe(5);
  });

  it('serialises strictly with permits=1, FIFO order', async () => {
    const sem = new ToolSemaphore(1);
    const order: number[] = [];

    const task = (n: number) => sem.run(async () => {
      order.push(n);
      await Promise.resolve();
    });

    await Promise.all([task(1), task(2), task(3)]);
    expect(order).toEqual([1, 2, 3]);
  });
});
