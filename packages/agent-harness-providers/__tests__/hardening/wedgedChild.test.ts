// ────────────────────────────────────────────────────────────────
// W13 — the plan's own acceptance criterion, against a REAL child process:
//
//   "a deliberately wedged child does not delay the parent interrupt beyond
//    the overall timeout."
//
// The transport shape being reproduced is the one the plan names: a deferred
// per request, resolved only when the child answers. The child here never
// answers. `new Promise(() => {})` would model that, but it would prove only
// that a never-settling promise never settles; spawning `wedgedChild.mjs`
// proves the bound holds against a process that is alive, holding an open
// pipe, and silent — and lets the test assert the two things a mock cannot:
// that the request genuinely REACHED the child, and that the parent returned
// without killing it (the co-tenant rule).
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { boundedFanOut, type FanOutFailure } from '../../src/hardening/fanout.js';
import { cancelSemantically, CancellationInFlight } from '../../src/hardening/semanticCancel.js';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'wedgedChild.mjs',
);

/**
 * The transport under test: one unbounded deferred per request, exactly as
 * described in the plan. Nothing here has a timeout of its own — the bound
 * must come from the fan-out.
 */
class WedgingTransport {
  readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (v: unknown) => void>();
  private stdoutBuf = '';
  stderr = '';
  private seq = 0;

  constructor() {
    this.child = spawn(process.execPath, [FIXTURE], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.stdoutBuf += chunk;
      let nl: number;
      while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
        const line = this.stdoutBuf.slice(0, nl).trim();
        this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { id?: number };
        if (typeof msg.id === 'number') {
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        }
      }
    });
    this.child.stderr.on('data', (chunk: string) => { this.stderr += chunk; });
  }

  /** Awaits an unbounded deferred. Never resolves when `wedge` is true. */
  request(wedge: boolean): Promise<unknown> {
    const id = ++this.seq;
    const p = new Promise<unknown>((resolve) => { this.pending.set(id, resolve); });
    this.child.stdin.write(`${JSON.stringify({ id, wedge })}\n`);
    return p;
  }

  get pendingCount(): number { return this.pending.size; }

  kill(): void { this.child.kill('SIGKILL'); }
}

let transport: WedgingTransport | undefined;

afterEach(() => {
  transport?.kill();
  transport = undefined;
});

describe('W13 — a wedged child does not delay the parent beyond the overall timeout', () => {
  it('returns inside the overall budget while the child is still holding the request', async () => {
    transport = new WedgingTransport();
    const t = transport;

    // Prove the child is up and answering before we wedge it — otherwise a
    // failure to spawn would look like a passing timeout.
    await expect(t.request(false)).resolves.toMatchObject({ ok: true });

    const OVERALL_MS = 400;
    const started = Date.now();
    const outcomes = await boundedFanOut(
      [true, true, true, true],
      // Per-item budget an order of magnitude beyond the overall one: only the
      // OVERALL bound can end this batch. This is the case the per-item timer
      // cannot cover.
      async (wedge) => t.request(wedge),
      { concurrency: 8, perItemTimeoutMs: 60_000, overallTimeoutMs: OVERALL_MS },
    );
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(OVERALL_MS * 5);
    expect(outcomes).toHaveLength(4);
    for (const o of outcomes) {
      expect(o.status).toBe('rejected');
      expect((o as FanOutFailure).kind).toBe('overall-timeout');
    }

    // The requests really did reach the child, and it is still sitting on all
    // four of them right now.
    expect(t.stderr).toMatch(/wedged/);
    expect(t.pendingCount).toBe(4);

    // …and the parent did NOT kill it. A shared runtime may be serving other
    // sessions; ending them is not an acceptable way to bound one fan-out.
    expect(t.child.killed).toBe(false);
    expect(t.child.exitCode).toBeNull();
  });

  it('a Stop issued while a child is wedged completes inside the grace budget', async () => {
    transport = new WedgingTransport();
    const t = transport;

    // A turn is in flight against the wedged child, and a pending approval is
    // parked behind it — the exact deadlock shape.
    const wedged = t.request(true);
    void wedged.catch(() => undefined);
    let approvalSettled = false;
    let settleApproval!: () => void;
    const approval = new Promise<string>((resolve) => {
      settleApproval = () => { approvalSettled = true; resolve('denied'); };
    });

    const inFlight = new CancellationInFlight();
    const synthesised: string[] = [];
    const started = Date.now();

    const outcome = await cancelSemantically(
      {
        settlePending: () => { settleApproval(); return 1; },
        // A local interrupt only. The child is not killed: it may be shared.
        interrupt: () => { /* abort the turn's controller */ },
        // The protocol cancel goes to the wedged child and never comes back —
        // it must not be awaited, or Stop is as slow as the failure it escapes.
        protocolCancel: () => t.request(true) as Promise<void>,
        synthesiseTerminal: () => synthesised.push('harness.cancelled'),
      },
      inFlight,
      { graceMs: 200 },
    );
    const elapsed = Date.now() - started;

    expect(approvalSettled).toBe(true);
    expect(await approval).toBe('denied');
    expect(outcome.stopReason).toBe('cancelled');
    expect(outcome.settledApprovals).toBe(1);
    expect(outcome.terminal).toBe('synthesised');
    expect(synthesised).toEqual(['harness.cancelled']);
    expect(elapsed).toBeLessThan(2_000);

    // Still alive. The synthesised terminal event is what let us stop without
    // killing a process co-tenant sessions may be using.
    expect(t.child.exitCode).toBeNull();
  });
});
