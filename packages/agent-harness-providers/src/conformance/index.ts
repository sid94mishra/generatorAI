// ────────────────────────────────────────────────────────────────
// W44 — Conformance suites for IAgentHarness implementations.
//
// Each suite is a function that takes an IAgentHarness instance and
// runs a set of assertions against it. Implementations that pass all
// suites are conformant.
//
// The FauxProvider itself passes these suites — they serve both as a
// specification and as regression tests for any new provider.
//
// ── Why the suites take a `scenario` ───────────────────────────────
//
// Three of the five suites used to be typed `(faux: FauxProvider)`, so they
// could only ever run against the test double. That is why the `computerUse`
// gap in `CodexProvider`, `OpenCodeProvider` and `AgentHostClient` survived:
// the one suite that WOULD have caught it had never been pointed at them.
//
// The assertions — which is where the value is — are unchanged and provider-
// agnostic. Only "how do I provoke this condition on THIS provider" is
// parameterised, via `ConformanceScenario`. The parameter defaults to the
// FauxProvider scripting it always used, so existing callers are unaffected.
//
// Usage in a test file:
//   import { runConversationLifecycleConformance } from '../conformance/index.js';
//   import { FauxProvider } from '../providers/faux/FauxProvider.js';
//   test('faux passes lifecycle conformance', async () => {
//     const faux = new FauxProvider();
//     await faux.initialize();
//     await runConversationLifecycleConformance(faux);
//   });
//
//   // …and against a real provider, whose conditions are driven by prompts:
//   await runTruncationConformance(codex, { prompt: 'TOOL_TRUNCATE now' });
// ────────────────────────────────────────────────────────────────

import type { IAgentHarness } from '@generatorai/core';
import type { AgentEvent } from '@generatorai/shared';

/** Collect all events emitted during a conversation turn. */
function collectEvents(harness: IAgentHarness, conversationId: string): {
  events: AgentEvent[];
  stop: () => void;
} {
  const events: AgentEvent[] = [];
  const stop = harness.onConversationEvent(conversationId, (e: AgentEvent) => events.push(e));
  return { events, stop };
}

// ── Scenario: how to provoke a condition on one particular provider ──

/**
 * Provider-specific instructions for provoking one conformance condition.
 *
 * Everything here is about SETUP. No assertion lives in a scenario — a
 * provider cannot weaken the suite by supplying one.
 */
export interface ConformanceScenario {
  /** The prompt that provokes the condition on this provider. */
  prompt: string;
  /** Run after the conversation is created — e.g. scripting a FauxProvider. */
  prepare?: (harness: IAgentHarness, conversationId: string) => void | Promise<void>;
  /**
   * Run shortly after the turn starts, while it is still in flight — e.g.
   * supplying a tool result, or issuing the cancellation under test.
   */
  duringTurn?: (harness: IAgentHarness, conversationId: string) => void | Promise<void>;
  /** Asserted against `tool_complete.result` when the scenario can predict it. */
  expectedToolResult?: unknown;
}

/** The subset of FauxProvider the default scenarios drive. */
interface FauxLike {
  script(entries: unknown[], conversationId: string): void;
  provideNextToolResult(result: string): Promise<void>;
}

function asFaux(harness: IAgentHarness, suite: string): FauxLike {
  const f = harness as unknown as Partial<FauxLike>;
  if (typeof f.script !== 'function') {
    throw new Error(
      `conformance: ${suite} was called without a scenario against a provider that is not a FauxProvider. ` +
      `Pass a ConformanceScenario describing how to provoke this condition on it.`,
    );
  }
  return f as FauxLike;
}

/** Wait for the turn to be under way before `duringTurn` acts on it. */
const TURN_START_SETTLE_MS = 10;

// ── Suite 1: Conversation lifecycle ────────────────────────────

/**
 * W44 — Verifies basic conversation create / list / delete lifecycle.
 * Every IAgentHarness implementation must pass this.
 *
 * @throws if any assertion fails
 */
export async function runConversationLifecycleConformance(harness: IAgentHarness): Promise<void> {
  const id = `conformance-lifecycle-${Date.now()}`;

  // Create
  const created = await harness.createConversation({ conversationId: id });
  if (created !== id) {
    throw new Error(
      `conformance: createConversation returned ${created}, expected ${id}`,
    );
  }

  // hasLiveConversation
  if (!harness.hasLiveConversation(id)) {
    throw new Error('conformance: hasLiveConversation returned false immediately after createConversation');
  }

  // listConversations
  const list = await harness.listConversations();
  if (!list.includes(id)) {
    throw new Error(`conformance: listConversations did not include ${id}`);
  }

  // getConversationWarnings returns array (possibly empty)
  const warnings = harness.getConversationWarnings(id);
  if (!Array.isArray(warnings)) {
    throw new Error('conformance: getConversationWarnings must return an array');
  }

  // deleteConversation
  await harness.deleteConversation(id);

  // After delete, hasLiveConversation should be false
  if (harness.hasLiveConversation(id)) {
    throw new Error('conformance: hasLiveConversation returned true after deleteConversation');
  }
}

// ── Suite 2: Tool call flow ─────────────────────────────────────

/**
 * W44 — Verifies that a simple tool_start → tool_complete flow is emitted
 * in the correct order, and that a successful tool is reported as a success.
 *
 * @throws if any assertion fails
 */
export async function runToolCallConformance(
  harness: IAgentHarness,
  scenario?: ConformanceScenario,
): Promise<void> {
  const id = `conformance-tool-${Date.now()}`;
  const s: ConformanceScenario = scenario ?? {
    prompt: 'read /test',
    prepare: (h, convId) => asFaux(h, 'runToolCallConformance').script(
      [
        { type: 'tool_call', name: 'Read', input: { file_path: '/test' } },
        { type: 'text', content: 'Done reading.' },
        { type: 'complete' },
      ],
      convId,
    ),
    duringTurn: (h) => asFaux(h, 'runToolCallConformance').provideNextToolResult('file contents here'),
    expectedToolResult: 'file contents here',
  };

  await harness.createConversation({ conversationId: id });
  await s.prepare?.(harness, id);

  const { events, stop } = collectEvents(harness, id);

  const turnPromise = harness.sendPromptAndWait(id, s.prompt);
  if (s.duringTurn) {
    // Wait a tick for tool_start to be emitted
    await new Promise((r) => setTimeout(r, TURN_START_SETTLE_MS));
    await s.duringTurn(harness, id);
  }
  await turnPromise;
  stop();

  const kinds = events.map((e) => e.kind);
  const toolStartIdx = kinds.indexOf('harness.tool_start');
  const toolCompleteIdx = kinds.indexOf('harness.tool_complete');

  if (toolStartIdx === -1) {
    throw new Error('conformance: harness.tool_start was not emitted');
  }
  if (toolCompleteIdx === -1) {
    throw new Error('conformance: harness.tool_complete was not emitted');
  }
  if (toolCompleteIdx < toolStartIdx) {
    throw new Error('conformance: harness.tool_complete emitted before harness.tool_start');
  }
  const completeEvent = events[toolCompleteIdx] as Extract<AgentEvent, { kind: 'harness.tool_complete' }>;
  if (completeEvent.data.success !== true) {
    throw new Error(
      'conformance: a tool call that succeeded was reported with success:false — ' +
      'a stale pending-call list is the usual cause',
    );
  }
  if (s.expectedToolResult !== undefined && completeEvent.data.result !== s.expectedToolResult) {
    throw new Error(`conformance: tool_complete result was ${JSON.stringify(completeEvent.data.result)}`);
  }

  await harness.deleteConversation(id);
}

// ── Suite 3: Semantic cancellation ─────────────────────────────

/**
 * W44 — Verifies that cancellation is a SUCCESS-VALUED outcome. W13 / X-4.
 *
 * There are two cancellation ORIGINS and the suite covers both, because
 * providers historically diverged on the second one:
 *
 *   • **In-band** — the turn's own stream reports it was cancelled, with no
 *     caller abort. `sendPromptAndWait` MUST NOT throw: nobody asked for this,
 *     so a rejection here is an unexplained failure at the call site.
 *
 *   • **Caller abort** — the caller aborts the signal it passed, or calls
 *     `abortConversation()`. The suite requires `harness.cancelled` to be
 *     emitted and `harness.error` NOT to be: a Stop must render as the neutral
 *     "Stopped" badge, never a red error toast. Whether the promise then
 *     resolves with the partial content or rejects is deliberately left to the
 *     provider — `ClaudeAgentProvider` and `CopilotProvider` reject (the caller
 *     who aborted is the one who sees it), while Codex/OpenCode/ACP resolve —
 *     but the OBSERVABLE outcome is pinned either way.
 *
 * The audit that prompted this read `ClaudeAgentProvider.ts:1103` as failing
 * the in-band assertion. It does not: that throw is guarded by
 * `abortController.signal.aborted`, so it is on the caller-abort path, which
 * the suite never exercised. The genuine gap was that the caller-abort path
 * emitted no `harness.cancelled` at all when the caller used its own signal —
 * fixed at the provider, and pinned here.
 *
 * @throws if any assertion fails
 */
export async function runCancellationConformance(
  harness: IAgentHarness,
  scenario?: ConformanceScenario,
): Promise<void> {
  const id = `conformance-cancel-${Date.now()}`;
  const s: ConformanceScenario = scenario ?? {
    prompt: 'do something',
    prepare: (h, convId) =>
      asFaux(h, 'runCancellationConformance').script([{ type: 'cancelled', reason: 'user_abort' }], convId),
  };
  // A scenario with no `duringTurn` cancels in band; one with `duringTurn`
  // (which issues the abort) exercises the caller-abort origin.
  const callerInitiated = s.duringTurn != null;

  await harness.createConversation({ conversationId: id });
  await s.prepare?.(harness, id);

  const { events, stop } = collectEvents(harness, id);
  let threw = false;

  try {
    const turnPromise = harness.sendPromptAndWait(id, s.prompt);
    if (s.duringTurn) {
      await new Promise((r) => setTimeout(r, TURN_START_SETTLE_MS));
      await s.duringTurn(harness, id);
    }
    await turnPromise;
  } catch {
    threw = true;
  }
  stop();

  if (threw && !callerInitiated) {
    throw new Error('conformance: sendPromptAndWait threw on cancellation — must emit harness.cancelled instead');
  }

  const cancelEvent = events.find((e) => e.kind === 'harness.cancelled');
  if (!cancelEvent) {
    throw new Error('conformance: harness.cancelled was not emitted on cancellation');
  }
  const errorEvent = events.find((e) => e.kind === 'harness.error');
  if (errorEvent) {
    throw new Error(
      'conformance: harness.error was emitted alongside harness.cancelled — ' +
      'a cancellation is not a failure and must not raise an error to the UI',
    );
  }

  await harness.deleteConversation(id);
}

// ── Suite 4: Truncation guard ───────────────────────────────────

/**
 * W44 — Verifies that a truncated response emits tool errors for all
 * pending tool calls, not silent success. W13 / B1 compliance.
 *
 * @throws if any assertion fails
 */
export async function runTruncationConformance(
  harness: IAgentHarness,
  scenario?: ConformanceScenario,
): Promise<void> {
  const id = `conformance-trunc-${Date.now()}`;
  const s: ConformanceScenario = scenario ?? {
    prompt: 'write something',
    // Script: tool call followed by truncation
    prepare: (h, convId) => asFaux(h, 'runTruncationConformance').script(
      [
        { type: 'tool_call', name: 'Write', input: { file_path: '/danger', content: 'truncated' } },
        { type: 'truncated' }, // all subsequent tool_calls get synthetic errors
      ],
      convId,
    ),
  };

  await harness.createConversation({ conversationId: id });
  await s.prepare?.(harness, id);

  const { events, stop } = collectEvents(harness, id);

  // Start the turn — truncation fires without needing provideToolResult
  await harness.sendPromptAndWait(id, s.prompt);
  stop();

  const kinds = events.map((e) => e.kind);

  // Must have emitted at least one tool_start
  if (!kinds.includes('harness.tool_start')) {
    throw new Error('conformance: truncation test: harness.tool_start not emitted');
  }

  // tool_complete must be emitted with success:false (the truncation error)
  const completeEvents = events.filter(
    (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> =>
      e.kind === 'harness.tool_complete',
  );
  if (completeEvents.length === 0) {
    throw new Error('conformance: truncation test: harness.tool_complete not emitted');
  }
  const started = new Set<string>();
  for (const e of events) {
    if (e.kind === 'harness.tool_start') started.add(String(e.data.callId));
  }
  const succeeded = new Set<string>();
  const failed = new Set<string>();
  for (const e of completeEvents) {
    (e.data.success === true ? succeeded : failed).add(String(e.data.callId));
  }

  // 1. Nothing may be left dangling. A tool call the model started and the
  //    truncation cut short must be reported, or the agent waits forever for
  //    a result that is never coming.
  const dangling = [...started].filter((id) => !succeeded.has(id) && !failed.has(id));
  if (dangling.length > 0) {
    throw new Error(
      `conformance: truncation test: tool call(s) ${dangling.join(', ')} were started and never completed — ` +
      'a truncated response must fail its open tool calls, not drop them',
    );
  }

  // 2. A call that already reported a SUCCESS must not also be failed.
  //    Re-failing it tells the model to redo work it has already done, which
  //    for a write or a delete is destructive (X-2).
  const doubleReported = [...succeeded].filter((id) => failed.has(id));
  if (doubleReported.length > 0) {
    throw new Error(
      `conformance: truncation test: tool call(s) ${doubleReported.join(', ')} reported success AND failure — ` +
      'the truncation guard must fail only calls still open, which means pruning the pending list on each result',
    );
  }

  // 3. The guard must actually have fired.
  if (failed.size === 0) {
    throw new Error(
      'conformance: truncation test: no tool_complete had success:false — the truncation guard did not fire',
    );
  }

  // Must NOT have thrown
  await harness.deleteConversation(id);
}

// ── Suite 5: Cancellation settles pending work ──────────────────

/**
 * W13 — the rule t3code states as: *"settle every pending approval and
 * user-input request BEFORE cancelling — a handler blocked on that promise
 * deadlocks forever."*
 *
 * ── What this suite actually catches ───────────────────────────────
 *
 * The observable consequence of getting the ORDER wrong is a turn that never
 * finishes. A tool handler (or a permission prompt, or a plan review) is
 * parked on a promise that only the provider's own stream can resolve. Cancel
 * tears that stream down; the promise is now unresolvable; the handler holds
 * its permit, its admission-controller slot, and the turn's completion promise
 * forever. Nothing throws. The session simply becomes unstoppable by the one
 * mechanism meant to stop it — and it is invisible in a test that only asserts
 * "a cancelled event was emitted", because that event fires either way.
 *
 * So the assertion here is a DEADLINE on `sendPromptAndWait`, taken while
 * something is genuinely parked. `runCancellationConformance` (suite 3)
 * asserts the SHAPE of a cancellation; this one asserts it TERMINATES.
 *
 * The same deadline covers the grace-budget rule (KiroCrew
 * `session_handle.py:1477-1516`): whether the runtime acknowledges the cancel
 * or the provider has to synthesise the terminal event itself, the caller must
 * reach a terminal state inside the budget — and must reach it WITHOUT the
 * provider killing a runtime process that co-tenant sessions are sharing,
 * which is why the suite ends by proving the harness still serves a new
 * conversation afterwards.
 *
 * @param scenario `prepare` must leave the turn parked on something (a tool
 *   call awaiting a result, an approval awaiting a decision). `duringTurn`
 *   must issue the cancellation. Defaults to a FauxProvider script that parks
 *   on a tool call and cancels with `abortConversation`.
 * @param graceMs Deadline for the turn to settle after the cancel is issued.
 *
 * @throws if any assertion fails
 */
export async function runCancellationSettlesPendingConformance(
  harness: IAgentHarness,
  scenario?: ConformanceScenario,
  graceMs = 5_000,
): Promise<void> {
  const id = `conformance-settle-${Date.now()}`;
  const s: ConformanceScenario = scenario ?? {
    prompt: 'read something slow',
    prepare: (h, convId) =>
      asFaux(h, 'runCancellationSettlesPendingConformance').script(
        [
          // The turn parks here and cannot proceed without a tool result. If
          // cancellation does not settle it, `sendPromptAndWait` never returns.
          { type: 'tool_call', name: 'Read', input: { file_path: '/slow' } },
          { type: 'complete' },
        ],
        convId,
      ),
    duringTurn: (h, convId) => h.abortConversation(convId),
  };

  await harness.createConversation({ conversationId: id });
  await s.prepare?.(harness, id);

  const { events, stop } = collectEvents(harness, id);

  const turnPromise = harness.sendPromptAndWait(id, s.prompt).then(
    () => 'settled' as const,
    () => 'settled' as const, // a rejection is still a settlement; suite 3 pins the shape
  );

  await new Promise((r) => setTimeout(r, TURN_START_SETTLE_MS));
  if (!s.duringTurn) {
    stop();
    throw new Error(
      'conformance: runCancellationSettlesPendingConformance needs a scenario whose ' +
      '`duringTurn` issues the cancellation — without one nothing is ever cancelled',
    );
  }
  await s.duringTurn(harness, id);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'deadlocked'>((resolve) => {
    timer = setTimeout(() => resolve('deadlocked'), graceMs);
  });
  const outcome = await Promise.race([turnPromise, deadline]);
  if (timer !== undefined) clearTimeout(timer);
  stop();

  if (outcome === 'deadlocked') {
    throw new Error(
      `conformance: the turn had not settled ${graceMs}ms after cancellation. ` +
      'A pending approval or tool call is parked on a promise the cancel tore the ' +
      'stream down under, so it can never resolve. Settle every pending approval and ' +
      'user-input request BEFORE interrupting, and synthesise a terminal event when ' +
      'the runtime does not acknowledge within the grace budget.',
    );
  }

  const terminal = events.find(
    (e) => e.kind === 'harness.cancelled' || e.kind === 'harness.idle',
  );
  if (!terminal) {
    throw new Error(
      'conformance: cancellation produced no terminal event (harness.cancelled or ' +
      'harness.idle). An unacknowledged cancel must SYNTHESISE the terminal event — ' +
      'never kill a shared runtime process, which would end co-tenant sessions too.',
    );
  }

  await harness.deleteConversation(id);

  // The runtime must have survived. A provider that "cancels" by killing a
  // shared process passes everything above and fails here.
  const probeId = `${id}-after`;
  await harness.createConversation({ conversationId: probeId });
  if (!harness.hasLiveConversation(probeId)) {
    throw new Error(
      'conformance: the harness could not open a new conversation after a cancellation — ' +
      'the cancel appears to have torn down the shared runtime rather than the one session',
    );
  }
  await harness.deleteConversation(probeId);
}

// ── Suite 6: Capabilities declared ─────────────────────────────

/**
 * W44 — Verifies that capabilities() returns a non-null object with no
 * undefined required fields. L9 compliance.
 *
 * @throws if any assertion fails
 */
export function runCapabilityDeclarationConformance(harness: IAgentHarness): void {
  const caps = harness.capabilities();
  // MINOR-4 fix: computerUse added to required fields. All capability flags
  // must be explicitly declared so consumers can apply L9 fail-closed defaults.
  const required: Array<keyof typeof caps> = [
    'vision',
    'reasoning',
    'reasoningEfforts',
    'planMode',
    'mcpServers',
    'approvalGating',
    'hostTools',
    'structuredOutput',
    'skills',
    'sessionPersistence',
    'budgetTracking',
    'computerUse',
  ];
  for (const field of required) {
    if (caps[field as keyof typeof caps] === undefined) {
      throw new Error(
        `conformance: capabilities().${String(field)} is undefined — all required fields must be declared (L9: fail-closed defaults)`,
      );
    }
  }
  if (!Array.isArray(caps.reasoningEfforts)) {
    throw new Error('conformance: capabilities().reasoningEfforts must be an array');
  }
}

// ── Convenience: run every suite against one provider ───────────

/** The four provider-specific scenarios needed to run the full battery. */
export interface ConformanceScenarioSet {
  toolCall: ConformanceScenario;
  /** Cancellation reported in band by the provider's own stream. */
  cancellationInBand: ConformanceScenario;
  /** Cancellation issued by the caller mid-turn (`duringTurn` must abort). */
  cancellationCallerAbort: ConformanceScenario;
  truncation: ConformanceScenario;
  /**
   * W13 — optional. A turn that is PARKED on something (a tool result, an
   * approval) plus a `duringTurn` that cancels it, so
   * `runCancellationSettlesPendingConformance` can assert the turn terminates.
   *
   * Optional rather than required only because the existing Tier-B provider
   * fixtures (`fakeAcpAgent.mjs`, `fakeCodexAppServer.mjs`,
   * `fakeOpenCodeServe.mjs`) do not yet script a parked turn. Supplying one is
   * a small fixture change per provider and this should become required — the
   * deadlock it catches is silent everywhere else.
   */
  cancellationSettlesPending?: ConformanceScenario;
}

/**
 * Run every suite against one harness.
 *
 * This is what "the conformance suites are wired to a provider" means: one
 * call per provider, in that provider's own test file, so a regression in any
 * of them fails that provider's build.
 *
 * `cancellationSettlesPending` (W13) runs only when its scenario is supplied —
 * see the field's own comment for why it is not yet mandatory.
 *
 * @throws if any assertion in any suite fails
 */
export async function runFullConformance(
  harness: IAgentHarness,
  scenarios: ConformanceScenarioSet,
): Promise<void> {
  runCapabilityDeclarationConformance(harness);
  await runConversationLifecycleConformance(harness);
  await runToolCallConformance(harness, scenarios.toolCall);
  await runCancellationConformance(harness, scenarios.cancellationInBand);
  await runCancellationConformance(harness, scenarios.cancellationCallerAbort);
  await runTruncationConformance(harness, scenarios.truncation);
  if (scenarios.cancellationSettlesPending) {
    await runCancellationSettlesPendingConformance(harness, scenarios.cancellationSettlesPending);
  }
}
