// ────────────────────────────────────────────────────────────────
// TurnExecutionLatch — W13 / B1, "a truncated response never executes a tool".
//
// ── What already exists, and what this adds ────────────────────────
//
// Both shipped providers already detect truncation on the EVENT path and fail
// the batch there — `isTruncationStopReason` (ClaudeAgentProvider) and
// `isTruncationFinishReason` (CopilotProvider), both pinned by
// `__tests__/truncation-guard.test.ts` against the real predicates. Neither
// predicate is duplicated here, and neither should be: this module does not
// decide WHETHER a response was truncated.
//
// What was missing is the second half of the sentence. The event-path guard
// suppresses the tool calls it can SEE in the message it is inspecting. It
// does not stop a handler that the SDK has already dispatched, or one it
// dispatches out of the same truncated message a tick later — for the Claude
// provider the tool bodies run inside an in-process MCP server the SDK drives
// directly, so the message loop is not on the call path at all. A `Write` with
// arguments cut off mid-JSON is the X-2 destructive case, and "we filtered the
// list" is a weaker guarantee than "the handler refuses to run".
//
// So this is a LATCH at the execution seam. Once a turn is marked truncated,
// every tool handler for that conversation refuses until the next turn begins.
// Belt and braces, deliberately: the two mechanisms fail independently.
//
// ── Why the refusal is worded for the model ────────────────────────
//
// The plan asks for "model-legible re-issue guidance". A bare
// `Error: truncated` teaches the model nothing and it retries the same
// oversized request, so the next turn truncates too. The guidance names the
// cause, states that NOTHING ran (so the model does not have to guess whether
// a write half-happened), and gives the concrete corrective action.
// ────────────────────────────────────────────────────────────────

/** Thrown by a tool handler that a truncation latch refused. */
export class TruncatedTurnError extends Error {
  constructor(message: string, readonly stopReason: string) {
    super(message);
    this.name = 'TruncatedTurnError';
  }
}

/**
 * The model-legible re-issue guidance. Shared so the wording is identical
 * wherever a truncated batch is reported — the event path, the execution
 * latch, and the conformance suite all quote the same sentence.
 */
export function truncationGuidance(opts: {
  stopReason: string;
  /** How many tool calls were in the truncated batch, if known. */
  toolCallCount?: number;
  /** Name of the specific tool that was refused, if this is one handler. */
  toolName?: string;
}): string {
  const cancelled =
    opts.toolName
      ? `The tool call "${opts.toolName}" was NOT executed`
      : opts.toolCallCount && opts.toolCallCount > 0
        ? `All ${opts.toolCallCount} tool call(s) in this batch were NOT executed`
        : 'No tool call in this batch was executed';
  return (
    `Your response was cut off before it finished (stop reason: ${opts.stopReason}), ` +
    `so its tool arguments may be incomplete. ${cancelled} — nothing was written, ` +
    `deleted, or run, and no partial state exists to clean up. ` +
    `Re-issue the request: emit fewer tool calls in one turn, or ask for a smaller ` +
    `result (a line range, a filter, pagination) so the response fits.`
  );
}

/**
 * Per-conversation latch consulted at the point a tool handler runs.
 *
 * Lives on the provider instance (one per harness), keyed by conversationId,
 * because one instance serves many conversations and a truncation in one must
 * not block tools in another.
 */
export class TurnExecutionLatch {
  private readonly truncated = new Map<string, string>();
  private refusals = 0;

  /**
   * A new turn starts: clear any latch from the previous one. Truncation is a
   * property of ONE response, not of the conversation — leaving the latch set
   * would wedge every future turn.
   */
  beginTurn(conversationId: string): void {
    this.truncated.delete(conversationId);
  }

  /** The response for this conversation stopped on `length`/`max_tokens`/… */
  markTruncated(conversationId: string, stopReason: string): void {
    this.truncated.set(conversationId, stopReason);
  }

  isTruncated(conversationId: string): boolean {
    return this.truncated.has(conversationId);
  }

  /** Number of handler invocations this latch has refused. Never silent. */
  get refusalCount(): number {
    return this.refusals;
  }

  /**
   * Throw if the conversation's current turn was truncated.
   * Call this FIRST in a tool handler, before any side effect.
   */
  assertExecutable(conversationId: string, toolName?: string): void {
    const stopReason = this.truncated.get(conversationId);
    if (stopReason === undefined) return;
    this.refusals += 1;
    throw new TruncatedTurnError(
      truncationGuidance({ stopReason, ...(toolName ? { toolName } : {}) }),
      stopReason,
    );
  }

  /** Drop state for a deleted conversation. */
  forget(conversationId: string): void {
    this.truncated.delete(conversationId);
  }
}
