// ────────────────────────────────────────────────────────────────
// W13 — shared failure vocabulary for the hardening mechanisms.
//
// Lives in its own module so `toolSemaphore.ts` (which raises these) and
// `fanout.ts` (which also raises them, and which imports `ToolSemaphore` for
// its permit pool) do not form an import cycle. A cycle here would be the
// fragile kind: both modules construct at evaluation time.
// ────────────────────────────────────────────────────────────────

/** Why a bounded fan-out or a guarded tool call did not produce a value. */
export type FanOutFailureKind =
  | 'error'
  | 'per-item-timeout'
  | 'overall-timeout'
  | 'aborted'
  | 'poisoned';

/**
 * Raised for every non-`error` failure kind, so a caller can branch on WHY a
 * call produced nothing. The distinction matters at the call site: a
 * `per-item-timeout` means the handler may still be running and its side
 * effects may still land, while `poisoned` means it never started.
 */
export class FanOutAbortError extends Error {
  constructor(readonly kind: FanOutFailureKind, message: string) {
    super(message);
    this.name = 'FanOutAbortError';
  }
}
