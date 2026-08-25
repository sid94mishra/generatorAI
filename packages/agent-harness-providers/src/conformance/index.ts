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
// Usage in a test file:
//   import { runConversationLifecycleConformance } from '../conformance/index.js';
//   import { FauxProvider } from '../providers/faux/FauxProvider.js';
//   test('faux passes lifecycle conformance', async () => {
//     const faux = new FauxProvider();
//     await faux.initialize();
//     await runConversationLifecycleConformance(faux);
//   });
// ────────────────────────────────────────────────────────────────

import type { IAgentHarness } from '@generatorai/core';
import type { AgentEvent } from '@generatorai/shared';
import type { FauxProvider } from '../providers/faux/FauxProvider.js';

/** Collect all events emitted during a conversation turn. */
function collectEvents(harness: IAgentHarness, conversationId: string): {
  events: AgentEvent[];
  stop: () => void;
} {
  const events: AgentEvent[] = [];
  const stop = harness.onConversationEvent(conversationId, (e: AgentEvent) => events.push(e));
  return { events, stop };
}

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
 * in the correct order.
 *
 * Requires the harness to be a FauxProvider so we can script the response.
 * Real provider tests run this with a live model (integration tests).
 *
 * @throws if any assertion fails
 */
export async function runToolCallConformance(faux: FauxProvider): Promise<void> {
  const id = `conformance-tool-${Date.now()}`;
  await faux.createConversation({ conversationId: id });

  faux.script(
    [
      { type: 'tool_call', name: 'Read', input: { file_path: '/test' } },
      { type: 'text', content: 'Done reading.' },
      { type: 'complete' },
    ],
    id,
  );

  const { events, stop } = collectEvents(faux, id);

  // Send prompt and provide tool result concurrently
  const turnPromise = faux.sendPromptAndWait(id, 'read /test');
  // Wait a tick for tool_start to be emitted
  await new Promise((r) => setTimeout(r, 10));
  await faux.provideNextToolResult('file contents here');
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
  if (completeEvent.data.result !== 'file contents here') {
    throw new Error(`conformance: tool_complete result was ${JSON.stringify(completeEvent.data.result)}`);
  }

  await faux.deleteConversation(id);
}

// ── Suite 3: Semantic cancellation ─────────────────────────────

/**
 * W44 — Verifies that cancellation emits harness.cancelled (not throws).
 * W13 / X-4 compliance.
 *
 * @throws if any assertion fails
 */
export async function runCancellationConformance(faux: FauxProvider): Promise<void> {
  const id = `conformance-cancel-${Date.now()}`;
  await faux.createConversation({ conversationId: id });

  faux.script(
    [{ type: 'cancelled', reason: 'user_abort' }],
    id,
  );

  const { events, stop } = collectEvents(faux, id);
  let threw = false;

  try {
    await faux.sendPromptAndWait(id, 'do something');
  } catch {
    threw = true;
  }
  stop();

  if (threw) {
    throw new Error('conformance: sendPromptAndWait threw on cancellation — must emit harness.cancelled instead');
  }

  const cancelEvent = events.find((e) => e.kind === 'harness.cancelled');
  if (!cancelEvent) {
    throw new Error('conformance: harness.cancelled was not emitted on cancellation');
  }

  await faux.deleteConversation(id);
}

// ── Suite 4: Truncation guard ───────────────────────────────────

/**
 * W44 — Verifies that a truncated response emits tool errors for all
 * pending tool calls, not silent success. W13 / B1 compliance.
 *
 * @throws if any assertion fails
 */
export async function runTruncationConformance(faux: FauxProvider): Promise<void> {
  const id = `conformance-trunc-${Date.now()}`;
  await faux.createConversation({ conversationId: id });

  // Script: tool call followed by truncation
  faux.script(
    [
      { type: 'tool_call', name: 'Write', input: { file_path: '/danger', content: 'truncated' } },
      { type: 'truncated' }, // all subsequent tool_calls get synthetic errors
    ],
    id,
  );

  const { events, stop } = collectEvents(faux, id);

  // Start the turn — truncation fires without needing provideToolResult
  await faux.sendPromptAndWait(id, 'write something');
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
  const allFailed = completeEvents.every((e) => e.data.success === false);
  if (!allFailed) {
    throw new Error(
      'conformance: truncation test: not all tool_complete events have success:false — truncated tool calls must be failed, not silently succeeded',
    );
  }

  // Must NOT have thrown
  await faux.deleteConversation(id);
}

// ── Suite 5: Capabilities declared ─────────────────────────────

/**
 * W44 — Verifies that capabilities() returns a non-null object with no
 * undefined required fields. L9 compliance.
 *
 * @throws if any assertion fails
 */
export function runCapabilityDeclarationConformance(harness: IAgentHarness): void {
  const caps = harness.capabilities();
  const required: Array<keyof typeof caps> = [
    'vision',
    'reasoning',
    'reasoningEfforts',
    'planMode',
    'mcpServers',
    'skillDirectories',
    'fullToolGating',
    'sessionPersistence',
    'budgetTracking',
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
