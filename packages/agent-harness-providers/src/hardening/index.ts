// ────────────────────────────────────────────────────────────────
// W13 — Provider hardening.
//
// One module per mechanism from the plan's Track-3 W13 item, each composable
// and each with a named test. Nothing here knows about a specific provider:
// the seams that use them are `toolSemaphore.ts` (which both providers already
// hold), the two `tool-factory.ts` files, and `conformance/index.ts`.
//
//   fanout.ts         — MAX_PARALLEL_TOOLS=8, order-preserving results,
//                       per-item AND overall timeouts, abort threading.
//   poisonPill.ts     — poison-pill downgrade (serialise, then quarantine).
//   approvalGate.ts   — permission checks serialised; every pending approval
//                       settleable before a cancel.
//   semanticCancel.ts — settle → interrupt → background protocol cancel →
//                       success-valued `cancelled` → grace budget →
//                       synthesised terminal event (never a process kill).
//   lateUpdateGuard.ts— generational discard of superseded-turn updates.
//   byteCap.ts        — per-record byte cap with drop-on-exceed.
//   truncation.ts     — a truncated response never executes a tool, with
//                       model-legible re-issue guidance.
//   contextLedger.ts  — append-only context invariant + the four-breakpoint
//                       cache scheme.
// ────────────────────────────────────────────────────────────────

export {
  boundedFanOut,
  boundedFanOutMapped,
  FanOutAbortError,
  DEFAULT_MAX_PARALLEL_TOOLS,
  DEFAULT_PER_ITEM_TIMEOUT_MS,
  DEFAULT_OVERALL_TIMEOUT_MS,
  type FanOutOptions,
  type FanOutOutcome,
  type FanOutSuccess,
  type FanOutFailure,
  type FanOutFailureKind,
  type FanOutContext,
} from './fanout.js';

export {
  PoisonPillRegistry,
  type PoisonPillOptions,
  type PoisonStatus,
} from './poisonPill.js';

export {
  SerialApprovalGate,
  type PendingApproval,
  type SerialApprovalGateOptions,
} from './approvalGate.js';

export {
  cancelSemantically,
  CancellationInFlight,
  DEFAULT_CANCEL_GRACE_MS,
  type CancelDeps,
  type CancelOptions,
  type CancelOutcome,
  type TerminalOrigin,
} from './semanticCancel.js';

export {
  GenerationGuard,
  type GenerationGuardOptions,
} from './lateUpdateGuard.js';

export {
  ByteCapper,
  renderRecord,
  DEFAULT_RECORD_BYTE_CAP,
  type ByteCapMode,
  type ByteCapOptions,
  type ByteCapResult,
} from './byteCap.js';

export {
  TurnExecutionLatch,
  TruncatedTurnError,
  truncationGuidance,
} from './truncation.js';

export {
  AppendOnlyContext,
  ContextInvariantError,
  MAX_CACHE_BREAKPOINTS,
  CACHE_MIN_PREFIX_TOKENS,
  DEFAULT_CACHE_MIN_PREFIX_TOKENS,
  cacheMinPrefixTokens,
  type CacheBreakpoint,
  type ContextRecord,
  type AppendOnlyContextOptions,
} from './contextLedger.js';
