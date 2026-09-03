// ────────────────────────────────────────────────────────────────
// SerialApprovalGate — W13, two rules that share one data structure.
//
//   Rule 3: "permission checks serialised even when execution is not."
//   Rule 6: "settle every pending approval and user-input request BEFORE
//            cancelling — a handler blocked on that promise deadlocks forever."
//
// They belong together because both need the same thing the providers did not
// have: a REGISTRY of the approvals that are currently outstanding.
//
// ── Why approvals serialise while execution stays parallel ─────────
//
// Eight tool calls run at once by design. If all eight ask the user at once,
// the human sees eight modals racing for one screen, answers whichever
// surfaced last, and the audit log records an order nobody chose. Worse, a
// policy engine that mutates state on decision (a session-scoped
// "approve-for-location", Copilot's `approve-for-location` kind, an
// allow-list append) is being asked to make eight decisions against the same
// pre-decision snapshot — the second approval never sees that the first one
// already widened the scope, so the user is asked twice for something they
// just granted. Serialising the ASK is therefore not a UX nicety; it is what
// makes each decision observe the decisions before it. Execution is untouched:
// a tool that needs no approval, or whose approval already resolved, keeps its
// permit and runs in parallel.
//
// The queue is a semaphore of one rather than a mutex flag so it is FIFO —
// prompts reach the user in the order the model emitted the calls, matching
// the order-preserving results in `fanout.ts`.
//
// ── Why cancel must settle before it interrupts ────────────────────
//
// An approval is a promise a handler is parked on. Cancelling the turn under
// it does not wake that handler: the interrupt tears down the stream that
// WOULD have delivered the answer, so the promise can never settle and the
// handler is parked forever, holding its permit, its semaphore slot in the
// admission controller, and — because nothing ever resolves — the turn's own
// completion promise. The session is then unstoppable by the very mechanism
// meant to stop it. So `settleAll()` runs FIRST, denying every outstanding
// request with a reason, and only then does the caller interrupt.
// ────────────────────────────────────────────────────────────────

import { ToolSemaphore } from '../toolSemaphore.js';

export interface PendingApproval {
  readonly id: string;
  /** 'approval' = a permission prompt; 'user-input' = a question/plan review. */
  readonly kind: 'approval' | 'user-input';
  readonly createdAt: number;
  readonly label: string;
}

export interface SerialApprovalGateOptions {
  /** Fired whenever the outstanding set changes. For metrics/tests. */
  onChange?: (pending: readonly PendingApproval[]) => void;
}

interface Entry {
  meta: PendingApproval;
  /** Resolves this request's promise with its own caller-supplied deny value. */
  cancel: () => void;
  settled: boolean;
}

let approvalSeq = 0;

export class SerialApprovalGate {
  /**
   * The queue of one. Every ASK passes through it; nothing else does.
   * Reusing `ToolSemaphore` rather than a bespoke mutex keeps the FIFO
   * behaviour under one tested implementation (`__tests__/toolSemaphore.test.ts`
   * pins "serialises strictly with permits=1, FIFO order").
   */
  private readonly queue = new ToolSemaphore(1);
  private readonly entries = new Map<string, Entry>();
  private readonly onChange: SerialApprovalGateOptions['onChange'];

  constructor(options: SerialApprovalGateOptions = {}) {
    this.onChange = options.onChange;
  }

  get pendingCount(): number {
    return this.entries.size;
  }

  pending(): readonly PendingApproval[] {
    return [...this.entries.values()].map((e) => e.meta);
  }

  private notify(): void {
    this.onChange?.(this.pending());
  }

  /**
   * Ask for one decision.
   *
   * @param ask       The real handler (a permission prompt, a plan review, a
   *                  question). Invoked while the queue-of-one is held, so no
   *                  other ask can be in flight.
   * @param onCancel  What this request resolves to when `settleAll` fires
   *                  before the human answers. MUST be the deny/closed value:
   *                  a cancelled approval is not an approval.
   */
  async request<T>(
    opts: { kind?: PendingApproval['kind']; label: string; onCancel: T },
    ask: () => Promise<T>,
  ): Promise<T> {
    const id = `approval-${++approvalSeq}`;
    const meta: PendingApproval = {
      id,
      kind: opts.kind ?? 'approval',
      createdAt: Date.now(),
      label: opts.label,
    };

    // Registered BEFORE the queue is acquired, on purpose. A request still
    // waiting its turn is exactly as un-settleable as one that is being asked:
    // `settleAll` has to reach both, or a cancel issued while three prompts are
    // queued behind one open modal leaves two handlers parked forever.
    let resolveCancelled!: (value: T) => void;
    const cancelled = new Promise<T>((resolve) => { resolveCancelled = resolve; });
    const entry: Entry = {
      meta,
      // Closes over THIS request's deny value, so `settleAll` denies each
      // request in its own vocabulary (a permission gets `{granted:false}`,
      // a plan review gets `{decision:'reject'}`) without knowing the type.
      cancel: () => resolveCancelled(opts.onCancel),
      settled: false,
    };
    this.entries.set(id, entry);
    this.notify();

    try {
      return await Promise.race([
        cancelled,
        this.queue.run(async () => {
          // The gate may have been settled while this request queued. Do not
          // ask a question whose answer is already decided.
          if (entry.settled) return await cancelled;
          return await ask();
        }),
      ]);
    } finally {
      this.entries.delete(id);
      this.notify();
    }
  }

  /**
   * Settle every outstanding approval and user-input request with its own
   * cancellation value. Returns how many were settled — callers log it,
   * because "cancel settled 3 approvals" is the difference between a clean
   * stop and a leak nobody noticed.
   *
   * Idempotent, and safe to call when nothing is pending.
   */
  settleAll(): number {
    let n = 0;
    for (const entry of this.entries.values()) {
      if (entry.settled) continue;
      entry.settled = true;
      entry.cancel();
      n += 1;
    }
    return n;
  }
}
