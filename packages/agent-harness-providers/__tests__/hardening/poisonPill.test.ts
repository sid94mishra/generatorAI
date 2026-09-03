// ────────────────────────────────────────────────────────────────
// W13 — poison-pill downgrade. The TRIGGER is what this file pins.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { PoisonPillRegistry } from '../../src/hardening/poisonPill.js';

describe('W13 — poison-pill trigger', () => {
  it('starts healthy and stays healthy below the downgrade threshold', () => {
    const p = new PoisonPillRegistry();
    expect(p.statusOf('Read')).toBe('healthy');
    p.recordFailure('Read');
    p.recordFailure('Read');
    expect(p.statusOf('Read')).toBe('healthy');
  });

  it('downgrades on the 3rd consecutive failure and quarantines on the 5th', () => {
    const p = new PoisonPillRegistry();
    p.recordFailure('Bash'); p.recordFailure('Bash');
    expect(p.statusOf('Bash')).toBe('healthy');
    expect(p.recordFailure('Bash')).toBe('downgraded');
    expect(p.recordFailure('Bash')).toBe('downgraded');
    expect(p.recordFailure('Bash')).toBe('quarantined');
    expect(p.isQuarantined('Bash')).toBe(true);
  });

  it('a single success resets the ladder completely', () => {
    const p = new PoisonPillRegistry();
    for (let i = 0; i < 5; i++) p.recordFailure('Grep');
    expect(p.statusOf('Grep')).toBe('quarantined');
    p.recordSuccess('Grep');
    expect(p.statusOf('Grep')).toBe('healthy');
    expect(p.consecutiveFailures('Grep')).toBe(0);
  });

  it('counts CONSECUTIVE failures, not a rate — an intermittent tool is never downgraded', () => {
    const p = new PoisonPillRegistry();
    for (let i = 0; i < 20; i++) {
      p.recordFailure('Flaky');
      p.recordFailure('Flaky');
      p.recordSuccess('Flaky');
    }
    // 40 failures out of 60 calls, and still healthy: it keeps answering, so
    // it is unreliable rather than wedged, and starving it would be wrong.
    expect(p.statusOf('Flaky')).toBe('healthy');
  });

  it('tracks keys independently — one broken tool never downgrades another', () => {
    const p = new PoisonPillRegistry();
    for (let i = 0; i < 5; i++) p.recordFailure('Broken');
    expect(p.statusOf('Broken')).toBe('quarantined');
    expect(p.statusOf('Read')).toBe('healthy');
  });

  it('reports each transition exactly once', () => {
    const seen: string[] = [];
    const p = new PoisonPillRegistry({
      onTransition: (key, from, to) => seen.push(`${key}:${from}->${to}`),
    });
    for (let i = 0; i < 6; i++) p.recordFailure('X');
    expect(seen).toEqual(['X:healthy->downgraded', 'X:downgraded->quarantined']);
  });

  it('refuses a quarantine threshold below the downgrade threshold', () => {
    expect(() => new PoisonPillRegistry({ downgradeAfter: 5, quarantineAfter: 2 })).toThrow(
      /quarantineAfter must be >= downgradeAfter/,
    );
  });
});

describe('W13 — poison-pill downgrade behaviour', () => {
  it('runs a healthy key with no serialisation', async () => {
    const p = new PoisonPillRegistry();
    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        p.runFor('Read', async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
        }),
      ),
    );
    expect(maxActive).toBe(4);
  });

  it('confines a DOWNGRADED key to one call at a time', async () => {
    const p = new PoisonPillRegistry({ downgradeAfter: 1, quarantineAfter: 99 });
    p.recordFailure('Slow');
    expect(p.isDowngraded('Slow')).toBe(true);

    let active = 0;
    let maxActive = 0;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        p.runFor('Slow', async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
        }),
      ),
    );
    // The whole mechanism: a downgraded key stops competing for the batch.
    expect(maxActive).toBe(1);
  });

  it('a rejection in a downgraded chain reaches its own caller and does not break the next', async () => {
    const p = new PoisonPillRegistry({ downgradeAfter: 1, quarantineAfter: 99 });
    p.recordFailure('Chain');

    const first = p.runFor('Chain', async () => { throw new Error('boom'); });
    await expect(first).rejects.toThrow('boom');
    await expect(p.runFor('Chain', async () => 'ok')).resolves.toBe('ok');
  });

  it('gives the model a legible reason when a key is quarantined', () => {
    const p = new PoisonPillRegistry();
    for (let i = 0; i < 5; i++) p.recordFailure('WebFetch');
    const reason = p.quarantineReason('WebFetch');
    expect(reason).toContain('WebFetch');
    expect(reason).toMatch(/5 times in a row/);
    expect(reason).toMatch(/Do not call it again in this turn/);
  });

  it('reset() forgets everything, so state never leaks into the next turn', () => {
    const p = new PoisonPillRegistry();
    for (let i = 0; i < 5; i++) p.recordFailure('Read');
    p.reset();
    expect(p.statusOf('Read')).toBe('healthy');
  });
});
