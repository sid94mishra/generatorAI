// The pairing mint hands out an all-scope grant. These pin the two controls in
// front of it: the per-process rate limit and the native confirmation for
// every mint after the launch-time auto-pair.

import { describe, expect, it, vi } from 'vitest';
import { admitPairingRequest, PairingGate, PairingRefusedError } from '../pairing-gate';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('PairingGate', () => {
  it('lets the first mint through without confirmation', () => {
    const gate = new PairingGate({ now: clock().now });
    expect(gate.check()).toEqual({ allowed: true, needsConfirmation: false });
  });

  it('requires confirmation for every mint after the first', () => {
    const c = clock();
    const gate = new PairingGate({ now: c.now, minGapMs: 0 });
    gate.record();
    c.advance(10_000);
    expect(gate.check()).toEqual({ allowed: true, needsConfirmation: true });
  });

  it('enforces a minimum gap between mints', () => {
    const c = clock();
    const gate = new PairingGate({ now: c.now, minGapMs: 3_000 });
    gate.record();
    c.advance(1_000);
    expect(gate.check()).toEqual({ allowed: false, reason: 'rate-limited', retryAfterMs: 2_000 });
    c.advance(2_000);
    expect(gate.check().allowed).toBe(true);
  });

  it('caps mints per window and recovers when the window slides', () => {
    const c = clock();
    const gate = new PairingGate({ now: c.now, minGapMs: 0, maxPerWindow: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i += 1) {
      expect(gate.check().allowed).toBe(true);
      gate.record();
      c.advance(1_000);
    }
    const refused = gate.check();
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterMs).toBe(60_000 - 3_000);
    c.advance(60_000);
    expect(gate.check().allowed).toBe(true);
  });
});

describe('admitPairingRequest', () => {
  const log = { warn: vi.fn(), info: vi.fn() };

  it('does not show a dialog for the first mint', async () => {
    const gate = new PairingGate();
    const confirm = vi.fn(async () => true);
    await admitPairingRequest('Desktop', { gate, confirm, log });
    expect(confirm).not.toHaveBeenCalled();
    expect(gate.issued).toBe(1);
  });

  it('asks natively for the second mint and honours a decline', async () => {
    const c = clock();
    const gate = new PairingGate({ now: c.now, minGapMs: 0 });
    const confirm = vi.fn(async () => false);
    await admitPairingRequest('Desktop', { gate, confirm, log });
    c.advance(5_000);
    await expect(admitPairingRequest('Desktop', { gate, confirm, log })).rejects.toMatchObject({
      name: 'PairingRefusedError',
      code: 'DECLINED',
    });
    expect(confirm).toHaveBeenCalledWith('Desktop');
    expect(gate.issued).toBe(1); // a declined mint is not recorded
  });

  it('proceeds when the user accepts', async () => {
    const c = clock();
    const gate = new PairingGate({ now: c.now, minGapMs: 0 });
    await admitPairingRequest(undefined, { gate, confirm: async () => true, log });
    c.advance(5_000);
    await admitPairingRequest(undefined, { gate, confirm: async () => true, log });
    expect(gate.issued).toBe(2);
  });

  it('rejects with a readable message when rate-limited, before asking', async () => {
    const c = clock();
    const gate = new PairingGate({ now: c.now, minGapMs: 3_000 });
    const confirm = vi.fn(async () => true);
    await admitPairingRequest(undefined, { gate, confirm, log });
    c.advance(500);
    const err = await admitPairingRequest(undefined, { gate, confirm, log }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PairingRefusedError);
    expect((err as PairingRefusedError).code).toBe('RATE_LIMITED');
    expect((err as Error).message).toMatch(/Try again in 3s/);
    expect(confirm).not.toHaveBeenCalled();
  });
});
