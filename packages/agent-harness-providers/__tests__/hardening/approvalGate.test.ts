// ────────────────────────────────────────────────────────────────
// W13 — permission checks serialised even when execution is not,
//       and every pending approval settleable BEFORE a cancel.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { SerialApprovalGate } from '../../src/hardening/approvalGate.js';
import { ToolSemaphore } from '../../src/toolSemaphore.js';

describe('W13 — permission checks serialised', () => {
  it('never has two asks in flight at once', async () => {
    const gate = new SerialApprovalGate();
    let asking = 0;
    let maxAsking = 0;

    await Promise.all(
      Array.from({ length: 8 }, (_v, i) =>
        gate.request({ label: `tool-${i}`, onCancel: { granted: false } }, async () => {
          asking += 1;
          maxAsking = Math.max(maxAsking, asking);
          await new Promise((r) => setTimeout(r, 3));
          asking -= 1;
          return { granted: true };
        }),
      ),
    );

    expect(maxAsking).toBe(1);
  });

  it('asks in FIFO order, matching the order the model emitted the calls', async () => {
    const gate = new SerialApprovalGate();
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3].map((i) =>
        gate.request({ label: `t${i}`, onCancel: false }, async () => {
          order.push(i);
          await new Promise((r) => setTimeout(r, 1));
          return true;
        }),
      ),
    );
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('serialising approvals does NOT serialise execution', async () => {
    // The gate is one queue; the semaphore is eight permits. A tool that has
    // its decision runs in parallel with seven others.
    const gate = new SerialApprovalGate();
    const sem = new ToolSemaphore(8);
    let executing = 0;
    let maxExecuting = 0;

    await Promise.all(
      Array.from({ length: 8 }, (_v, i) => (async () => {
        await gate.request({ label: `t${i}`, onCancel: false }, async () => true);
        await sem.run(async () => {
          executing += 1;
          maxExecuting = Math.max(maxExecuting, executing);
          await new Promise((r) => setTimeout(r, 10));
          executing -= 1;
        });
      })()),
    );

    expect(maxExecuting).toBeGreaterThan(1);
  });

  it('a decision observes the decisions before it (state mutated under the queue)', async () => {
    const gate = new SerialApprovalGate();
    // "approve-for-location": the first grant widens the scope for the rest.
    let approvedLocation: string | undefined;
    let promptsShown = 0;

    const ask = (location: string) =>
      gate.request({ label: location, onCancel: { granted: false } }, async () => {
        if (approvedLocation === location) return { granted: true };
        promptsShown += 1;
        approvedLocation = location;
        return { granted: true };
      });

    const results = await Promise.all([ask('/repo'), ask('/repo'), ask('/repo')]);
    expect(results.every((r) => r.granted)).toBe(true);
    // Without serialisation all three would read `approvedLocation === undefined`
    // and the user would be prompted three times for the same grant.
    expect(promptsShown).toBe(1);
  });
});

describe('W13 — settle every pending approval BEFORE cancelling', () => {
  it('settles a request that is mid-ask with its own deny value', async () => {
    const gate = new SerialApprovalGate();
    // An ask that only the (now-cancelled) stream could ever answer.
    const pending = gate.request(
      { label: 'Write /etc/hosts', onCancel: { granted: false, reason: 'cancelled' } },
      () => new Promise<{ granted: boolean; reason?: string }>(() => { /* never */ }),
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(gate.pendingCount).toBe(1);

    expect(gate.settleAll()).toBe(1);
    await expect(pending).resolves.toEqual({ granted: false, reason: 'cancelled' });
    expect(gate.pendingCount).toBe(0);
  });

  it('also settles requests still QUEUED behind the open one', async () => {
    const gate = new SerialApprovalGate();
    const blocked = gate.request(
      { label: 'first', onCancel: 'denied-first' },
      () => new Promise<string>(() => { /* never */ }),
    );
    // These never even reach their `ask`; they are waiting for the queue.
    const queued = [1, 2, 3].map((i) =>
      gate.request({ label: `queued-${i}`, onCancel: `denied-${i}` }, async () => 'granted'),
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(gate.pendingCount).toBe(4);

    // If `settleAll` reached only the open ask, these three handlers would be
    // parked forever behind a queue whose head can never advance.
    expect(gate.settleAll()).toBe(4);
    await expect(blocked).resolves.toBe('denied-first');
    await expect(Promise.all(queued)).resolves.toEqual(['denied-1', 'denied-2', 'denied-3']);
  });

  it('a queued request that gains the queue AFTER settleAll is not asked', async () => {
    const gate = new SerialApprovalGate();
    let asked = 0;
    const blocked = gate.request(
      { label: 'first', onCancel: 'denied' },
      () => new Promise<string>(() => { /* never */ }),
    );
    const queued = gate.request({ label: 'second', onCancel: 'denied' }, async () => {
      asked += 1;
      return 'granted';
    });

    await new Promise((r) => setTimeout(r, 5));
    gate.settleAll();
    await Promise.all([blocked, queued]);
    // Asking a question whose answer is already decided would show the user a
    // prompt for a turn they just stopped.
    expect(asked).toBe(0);
  });

  it('is idempotent and safe with nothing pending', () => {
    const gate = new SerialApprovalGate();
    expect(gate.settleAll()).toBe(0);
    expect(gate.settleAll()).toBe(0);
  });

  it('reports what is outstanding so a cancel can log it', async () => {
    const gate = new SerialApprovalGate();
    void gate.request(
      { kind: 'user-input', label: 'plan review', onCancel: 'reject' },
      () => new Promise<string>(() => { /* never */ }),
    );
    await new Promise((r) => setTimeout(r, 5));
    const pending = gate.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe('user-input');
    expect(pending[0]?.label).toBe('plan review');
    gate.settleAll();
  });
});
