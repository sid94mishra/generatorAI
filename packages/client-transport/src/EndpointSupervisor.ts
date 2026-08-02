// ────────────────────────────────────────────────────────────────
// EndpointSupervisor — picks and maintains the route to the paired host.
//
// Responsibilities:
//   1. Try candidates in priority order (LAN before relay: faster, and it
//      keeps traffic off a third party entirely).
//   2. Verify the host's pinned identity BEFORE any credential is sent.
//   3. Retry with bounded, jittered backoff.
//   4. Fail over to the next candidate when one is unreachable.
//
// ── The security-critical part ───────────────────────────────────
// `verifyHost` runs against `GET /api/auth/server-info`, which is an
// UNAUTHENTICATED endpoint. That ordering is the whole point: we learn who
// answered at this address before we hand over a DPoP proof or an access
// token. This is the client half of the guarantee that
// `agent-tests/host-pinning-e2e.mjs` asserts.
// ────────────────────────────────────────────────────────────────

import { Backoff, type BackoffOptions } from './Backoff.js';
import type {
  TransportAdapter,
  TransportCandidate,
  TransportKind,
  TransportStatus,
} from './TransportAdapter.js';

export class HostIdentityMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
    readonly endpoint: string,
  ) {
    super(
      `The server at ${endpoint} is not the one this device paired with. ` +
        'Its identity key changed, which can mean the server was reinstalled — ' +
        'or that something is impersonating it. Re-pair only if you expected this.',
    );
    this.name = 'HostIdentityMismatchError';
  }
}

export class NoReachableEndpointError extends Error {
  constructor(readonly attempts: Array<{ kind: TransportKind; reason: string }>) {
    super(
      `No reachable endpoint. Tried: ${attempts.map((a) => `${a.kind} (${a.reason})`).join(', ')}`,
    );
    this.name = 'NoReachableEndpointError';
  }
}

export interface EndpointSupervisorOptions {
  /** `serverId` recorded at pairing. Empty disables pinning (dev only). */
  pinnedServerId: string;
  candidates: TransportCandidate[];
  /**
   * Resolve the identity the server advertises at `endpoint`.
   * Must hit the unauthenticated `/api/auth/server-info`.
   */
  verifyHost(endpoint: string, signal?: AbortSignal): Promise<string>;
  backoff?: BackoffOptions;
  onStatusChange?(status: TransportStatus): void;
  /** Injected in tests so retry scheduling is deterministic. */
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
  clock?(): number;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

export class EndpointSupervisor {
  private status: TransportStatus = { state: 'idle' };
  private active: TransportAdapter | null = null;
  private readonly backoff: Backoff;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly clock: () => number;
  /** Single-flight: N callers racing a reconnect must produce ONE attempt. */
  private connecting: Promise<TransportAdapter> | null = null;

  constructor(private readonly options: EndpointSupervisorOptions) {
    this.backoff = new Backoff(options.backoff);
    this.sleep = options.sleep ?? defaultSleep;
    this.clock = options.clock ?? Date.now;
  }

  get currentStatus(): TransportStatus {
    return this.status;
  }

  /** The connected adapter, or null when not connected. */
  get adapter(): TransportAdapter | null {
    return this.active;
  }

  private setStatus(status: TransportStatus): void {
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  /**
   * Connect, or return the existing connection.
   *
   * @param maxRounds How many times to cycle the whole candidate list before
   *   giving up. One round = one attempt at each candidate.
   */
  async connect(maxRounds = 1, signal?: AbortSignal): Promise<TransportAdapter> {
    if (this.active) return this.active;
    // Single-flight: a burst of requests after a drop must not start a
    // stampede of parallel relay handshakes.
    if (this.connecting) return this.connecting;

    this.connecting = this.doConnect(maxRounds, signal).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(maxRounds: number, signal?: AbortSignal): Promise<TransportAdapter> {
    const ordered = [...this.options.candidates].sort((a, b) => a.priority - b.priority);
    if (ordered.length === 0) {
      this.setStatus({ state: 'offline', reason: 'no candidates configured' });
      throw new NoReachableEndpointError([]);
    }

    const failures: Array<{ kind: TransportKind; reason: string }> = [];

    for (let round = 0; round < maxRounds; round += 1) {
      for (const candidate of ordered) {
        signal?.throwIfAborted();

        this.setStatus({
          state: 'connecting',
          kind: candidate.kind,
          attempt: this.backoff.attempts + 1,
        });

        try {
          const adapter = await this.tryCandidate(candidate, signal);
          this.active = adapter;
          this.backoff.reset();
          this.setStatus({
            state: 'connected',
            kind: adapter.kind,
            endpoint: adapter.endpoint,
          });
          return adapter;
        } catch (err) {
          if (err instanceof HostIdentityMismatchError) {
            // Terminal. Deliberately NOT falling through to the next
            // candidate: a mismatch is a security event the user must see.
            // Silently succeeding over the relay would hide the fact that
            // something is answering for the host on the local network.
            this.setStatus({
              state: 'host-mismatch',
              expected: err.expected,
              actual: err.actual,
            });
            throw err;
          }
          if (isAbort(err)) throw err;
          failures.push({ kind: candidate.kind, reason: describe(err) });
        }
      }

      const isLastRound = round === maxRounds - 1;
      if (!isLastRound) {
        const delay = this.backoff.next();
        this.setStatus({
          state: 'reconnecting',
          kind: ordered[0]!.kind,
          attempt: this.backoff.attempts,
          nextRetryAt: this.clock() + delay,
        });
        await this.sleep(delay, signal);
      }
    }

    this.setStatus({ state: 'offline', reason: 'all endpoints unreachable' });
    throw new NoReachableEndpointError(failures);
  }

  private async tryCandidate(
    candidate: TransportCandidate,
    signal?: AbortSignal,
  ): Promise<TransportAdapter> {
    const adapter = await candidate.create();
    try {
      await adapter.open(signal);

      // Identity check BEFORE the caller can send a credential over this
      // adapter. Order is the security property; do not move this.
      if (this.options.pinnedServerId) {
        const actual = await this.options.verifyHost(adapter.endpoint, signal);
        if (actual !== this.options.pinnedServerId) {
          throw new HostIdentityMismatchError(
            this.options.pinnedServerId,
            actual,
            adapter.endpoint,
          );
        }
      }
      return adapter;
    } catch (err) {
      // Never leak a half-open transport: a relay stream left dangling holds
      // a slot on the host's 64-stream budget until it times out.
      await adapter.close().catch(() => undefined);
      throw err;
    }
  }

  /** Drop the active transport so the next `connect()` re-selects. */
  async disconnect(): Promise<void> {
    const adapter = this.active;
    this.active = null;
    this.setStatus({ state: 'idle' });
    if (adapter) await adapter.close().catch(() => undefined);
  }

  /**
   * Report that the active transport failed, so the next `connect()` picks
   * a fresh route. Called by the caller's fetch wrapper on a network error.
   */
  async invalidate(reason: string): Promise<void> {
    const adapter = this.active;
    this.active = null;
    this.setStatus({ state: 'offline', reason });
    if (adapter) await adapter.close().catch(() => undefined);
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
