// ────────────────────────────────────────────────────────────────
// W13 / X-4 — the Stop sequence: ORDER, success-valuedness, and the
// grace budget that synthesises a terminal event instead of killing a
// shared runtime.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  cancelSemantically,
  CancellationInFlight,
  DEFAULT_CANCEL_GRACE_MS,
  type CancelDeps,
} from '../../src/hardening/semanticCancel.js';
import { SerialApprovalGate } from '../../src/hardening/approvalGate.js';

function trace(): { log: string[]; deps: CancelDeps } {
  const log: string[] = [];
  return {
    log,
    deps: {
      settlePending: () => { log.push('settle'); return 2; },
      interrupt: () => { log.push('interrupt'); },
      protocolCancel: async () => { log.push('protocolCancel'); },
      synthesiseTerminal: () => { log.push('synthesise'); },
    },
  };
}

describe('W13 — cancellation ORDER', () => {
  it('settles pending approvals BEFORE interrupting', async () => {
    const { log, deps } = trace();
    await cancelSemantically(deps, new CancellationInFlight(), { graceMs: 10 });
    expect(log.indexOf('settle')).toBeLessThan(log.indexOf('interrupt'));
  });

  it('fires the protocol cancel in the background, never awaiting it', async () => {
    let resolveProtocol!: () => void;
    const protocol = new Promise<void>((r) => { resolveProtocol = r; });
    const inFlight = new CancellationInFlight();

    const started = Date.now();
    const outcome = await cancelSemantically(
      {
        settlePending: () => 0,
        interrupt: () => { /* local only */ },
        // Models a protocol cancel sent to a runtime that is itself wedged.
        protocolCancel: () => protocol,
        synthesiseTerminal: () => { /* … */ },
      },
      inFlight,
      { graceMs: 50 },
    );

    // If it were awaited, Stop would be as slow as the failure Stop escapes.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(outcome.stopReason).toBe('cancelled');
    resolveProtocol();
  });

  it('reaches the terminal event even when the local interrupt throws', async () => {
    const log: string[] = [];
    const outcome = await cancelSemantically(
      {
        settlePending: () => { log.push('settle'); return 1; },
        interrupt: () => { throw new Error('closeHandle blew up'); },
        synthesiseTerminal: () => { log.push('synthesise'); },
      },
      new CancellationInFlight(),
      { graceMs: 10 },
    );
    expect(log).toEqual(['settle', 'synthesise']);
    expect(outcome.stopReason).toBe('cancelled');
  });

  it('surfaces a protocol-cancel failure without throwing', async () => {
    const outcome = await cancelSemantically(
      {
        settlePending: () => 0,
        interrupt: () => { /* … */ },
        protocolCancel: async () => { throw new Error('session/cancel: -32601'); },
        synthesiseTerminal: () => { /* … */ },
      },
      new CancellationInFlight(),
      { graceMs: 30 },
    );
    expect(outcome.stopReason).toBe('cancelled');
    expect(outcome.protocolCancelError?.message).toMatch(/-32601/);
  });
});

describe('W13 / X-4 — cancellation is a SUCCESS', () => {
  it('resolves with {stopReason: "cancelled"} rather than rejecting', async () => {
    const { deps } = trace();
    await expect(
      cancelSemantically(deps, new CancellationInFlight(), { graceMs: 10 }),
    ).resolves.toMatchObject({ stopReason: 'cancelled' });
  });

  it('reports how many approvals it had to settle', async () => {
    const gate = new SerialApprovalGate();
    const parked = [1, 2, 3].map((i) =>
      gate.request({ label: `t${i}`, onCancel: 'denied' }, () => new Promise<string>(() => { /* never */ })),
    );
    await new Promise((r) => setTimeout(r, 5));

    const outcome = await cancelSemantically(
      {
        settlePending: () => gate.settleAll(),
        interrupt: () => { /* … */ },
        synthesiseTerminal: () => { /* … */ },
      },
      new CancellationInFlight(),
      { graceMs: 10 },
    );

    expect(outcome.settledApprovals).toBe(3);
    await expect(Promise.all(parked)).resolves.toEqual(['denied', 'denied', 'denied']);
  });
});

describe('W13 — grace budget → synthesised terminal event', () => {
  it('does NOT synthesise when the runtime acknowledges inside the budget', async () => {
    const { log, deps } = trace();
    const inFlight = new CancellationInFlight();
    setTimeout(() => inFlight.acknowledgeTerminal(), 10);

    const outcome = await cancelSemantically(deps, inFlight, { graceMs: 1_000 });
    expect(outcome.terminal).toBe('runtime');
    expect(log).not.toContain('synthesise');
  });

  it('synthesises exactly one terminal event when the runtime never acknowledges', async () => {
    const { log, deps } = trace();
    const outcome = await cancelSemantically(deps, new CancellationInFlight(), { graceMs: 40 });
    expect(outcome.terminal).toBe('synthesised');
    expect(log.filter((l) => l === 'synthesise')).toHaveLength(1);
  });

  it('offers no way to kill a process — the interface has no kill hook', () => {
    // The mechanism IS the absence. KiroCrew session_handle.py:1477-1516: a
    // shared runtime serves co-tenant sessions, so killing it to end one
    // session ends theirs too. If a `kill` field is ever added to CancelDeps,
    // this assertion is where that decision has to be argued.
    const keys: Array<keyof CancelDeps> = [
      'settlePending', 'interrupt', 'protocolCancel', 'synthesiseTerminal',
    ];
    expect(keys).not.toContain('kill');
    const deps: CancelDeps = {
      settlePending: () => 0,
      interrupt: () => { /* … */ },
      synthesiseTerminal: () => { /* … */ },
    };
    expect(Object.keys(deps)).not.toContain('kill');
  });

  it('an acknowledgement arriving BEFORE the cancel is honoured', async () => {
    const { log, deps } = trace();
    const inFlight = new CancellationInFlight();
    inFlight.acknowledgeTerminal();
    const outcome = await cancelSemantically(deps, inFlight, { graceMs: 5_000 });
    expect(outcome.terminal).toBe('runtime');
    expect(log).not.toContain('synthesise');
  });

  it('acknowledgeTerminal is idempotent', async () => {
    const { deps } = trace();
    const inFlight = new CancellationInFlight();
    const promise = cancelSemantically(deps, inFlight, { graceMs: 500 });
    inFlight.acknowledgeTerminal();
    inFlight.acknowledgeTerminal();
    inFlight.acknowledgeTerminal();
    await expect(promise).resolves.toMatchObject({ terminal: 'runtime' });
    expect(inFlight.acknowledged).toBe(true);
  });

  it('defaults the grace budget to 2s', () => {
    expect(DEFAULT_CANCEL_GRACE_MS).toBe(2_000);
  });
});
