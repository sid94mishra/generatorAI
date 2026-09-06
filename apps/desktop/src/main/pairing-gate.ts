// ────────────────────────────────────────────────────────────────
// Gate in front of the pairing-grant mint.
//
// `requestPairingCode` hands the renderer a grant carrying EVERY scope. The
// renderer is trusted (it is our own SPA, and `ipc-guard.ts` refuses anyone
// else), but a compromised page must not be able to turn one bug into an
// unbounded stream of admin credentials. Two controls, both process-local:
//
//   • a rate limit — a handful of mints per window, with a minimum gap;
//   • a native confirmation — every mint after the first at launch asks the
//     user through an OS dialog the page cannot draw or dismiss. The first is
//     exempt because it is the normal boot path (`AuthGate.tsx` auto-pairs a
//     fresh renderer), and asking then would be pure friction.
//
// Pure: the dialog and the clock are injected, so this is unit-testable.
// ────────────────────────────────────────────────────────────────

export interface PairingGateOptions {
  /** Mints allowed per `windowMs`. */
  maxPerWindow?: number;
  windowMs?: number;
  /** Minimum spacing between two mints. */
  minGapMs?: number;
  now?: () => number;
}

export type PairingGateDecision =
  | { allowed: true; needsConfirmation: boolean }
  | { allowed: false; reason: 'rate-limited'; retryAfterMs: number };

export class PairingGate {
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly minGapMs: number;
  private readonly now: () => number;
  private readonly issuedAt: number[] = [];

  constructor(options: PairingGateOptions = {}) {
    this.maxPerWindow = options.maxPerWindow ?? 5;
    this.windowMs = options.windowMs ?? 10 * 60_000;
    this.minGapMs = options.minGapMs ?? 3_000;
    this.now = options.now ?? Date.now;
  }

  /** How many grants this process has minted so far. */
  get issued(): number {
    return this.issuedAt.length;
  }

  /** Decide whether a mint may proceed right now. Does not record it. */
  check(): PairingGateDecision {
    const now = this.now();
    const recent = this.issuedAt.filter((t) => now - t < this.windowMs);
    const last = recent[recent.length - 1];
    if (last !== undefined && now - last < this.minGapMs) {
      return { allowed: false, reason: 'rate-limited', retryAfterMs: this.minGapMs - (now - last) };
    }
    if (recent.length >= this.maxPerWindow) {
      const oldest = recent[0]!;
      return { allowed: false, reason: 'rate-limited', retryAfterMs: this.windowMs - (now - oldest) };
    }
    return { allowed: true, needsConfirmation: this.issuedAt.length > 0 };
  }

  /** Record a mint that went ahead. */
  record(): void {
    this.issuedAt.push(this.now());
  }
}

export interface PairingGateDeps {
  gate: PairingGate;
  /** Shows the native confirmation; resolves true when the user accepts. */
  confirm: (deviceName: string | undefined) => Promise<boolean>;
  log: { warn: (message: string, meta?: unknown) => void; info: (message: string, meta?: unknown) => void };
}

export class PairingRefusedError extends Error {
  constructor(
    message: string,
    readonly code: 'RATE_LIMITED' | 'DECLINED',
  ) {
    super(message);
    this.name = 'PairingRefusedError';
  }
}

/**
 * Runs the gate for one mint attempt. Resolves when the mint may proceed;
 * rejects with `PairingRefusedError` when rate-limited or declined — the
 * renderer surfaces that message on its manual pairing screen, so the refusal
 * is never silent.
 */
export async function admitPairingRequest(deviceName: string | undefined, deps: PairingGateDeps): Promise<void> {
  const decision = deps.gate.check();
  if (!decision.allowed) {
    const seconds = Math.ceil(decision.retryAfterMs / 1000);
    deps.log.warn('[pairing] refused: rate limit', { retryAfterMs: decision.retryAfterMs });
    throw new PairingRefusedError(
      `Too many pairing requests from this desktop session. Try again in ${seconds}s.`,
      'RATE_LIMITED',
    );
  }
  if (decision.needsConfirmation) {
    const ok = await deps.confirm(deviceName);
    if (!ok) {
      deps.log.info('[pairing] declined by the user');
      throw new PairingRefusedError('Pairing was declined in the desktop confirmation dialog.', 'DECLINED');
    }
  }
  deps.gate.record();
}
