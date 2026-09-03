// ────────────────────────────────────────────────────────────────
// The provider-reported context snapshot.
//
// Guards three defects that made the gauge and its popover disagree with the
// CLI's own `/context`, all found against a live session and fixed together:
//
//   1. `getContextUsage()` was awaited AFTER the `result` message, at which
//      point a string-prompt `query()` has already closed its transport — so
//      it rejected every time and the authoritative snapshot never landed.
//      It is now sampled mid-turn and cached; this suite drives that cache.
//   2. DEFERRED tools were counted as occupied context. Every one of the 38
//      MCP tools on the live session reported `isLoaded: false`, adding
//      14,957 tokens to a 39,029-token window (+38%) and overflowing the
//      popover's stacked bar.
//   3. `currentTokens` came from the turn's AGGREGATE usage, which sums every
//      API call the turn made. Two messages in a fresh chat read as 212k / 23%.
//
// The numbers below are the ones actually observed on that session.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import type { AgentEvent } from '@generatorai/shared';

/** The shape of `getContextUsage()`, as the live CLI answered it. */
const LIVE_USAGE = {
  totalTokens: 39_029,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  isAutoCompactEnabled: true,
  autoCompactThreshold: 967_000,
  model: 'claude-sonnet-5',
  categories: [
    { name: 'System prompt', tokens: 13_197, color: '' },
    { name: 'System tools', tokens: 23_770, color: '' },
    { name: 'MCP tools (deferred)', tokens: 14_957, color: '', isDeferred: true },
    { name: 'System tools (deferred)', tokens: 14_178, color: '', isDeferred: true },
    { name: 'Messages', tokens: 2_071, color: '' },
    { name: 'Autocompact buffer', tokens: 33_000, color: '' },
    { name: 'Free space', tokens: 927_962, color: '' },
  ],
  mcpTools: [
    { name: 'mcp__generatorai-tools__click_element', serverName: 'generatorai-tools', tokens: 414, isLoaded: false },
    { name: 'mcp__generatorai-tools__close_widget', serverName: 'generatorai-tools', tokens: 174, isLoaded: false },
  ],
  memoryFiles: [],
  agents: [],
  messageBreakdown: {
    toolCallTokens: 93,
    toolResultTokens: 64,
    attachmentTokens: 1_494,
    assistantMessageTokens: 228,
    userMessageTokens: 20,
    redirectedContextTokens: 0,
    unattributedTokens: 172,
    toolCallsByType: [],
    attachmentsByType: [],
  },
  apiUsage: null,
  gridRows: [],
  percentage: 4,
};

/** A `result` message whose turn made three API calls. */
const RESULT_MESSAGE = {
  usage: {
    input_tokens: 6,
    output_tokens: 309,
    cache_read_input_tokens: 77_849,
    cache_creation_input_tokens: 39_173,
    iterations: [
      { type: 'message', input_tokens: 2, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 38_800 },
      { type: 'message', input_tokens: 2, output_tokens: 154, cache_read_input_tokens: 38_800, cache_creation_input_tokens: 248 },
      { type: 'message', input_tokens: 2, output_tokens: 115, cache_read_input_tokens: 39_048, cache_creation_input_tokens: 125 },
    ],
  },
};

/**
 * Drives the private snapshot path: seed the probe cache the way a mid-turn
 * `getContextUsage()` reply does, then emit for a finished turn.
 */
function snapshotFor(
  usage: unknown = LIVE_USAGE,
  resultMessage: unknown = RESULT_MESSAGE,
): Record<string, unknown> | undefined {
  const provider = new ClaudeAgentProvider({
    cliPath: '/nonexistent/claude',
    defaultCwd: '/tmp',
  } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
  const internals = provider as unknown as {
    contextProbes: Map<string, { inFlight: boolean; latest: unknown }>;
    emitEventToHandlers: (id: string, event: AgentEvent) => void;
    emitContextUsageSnapshot: (id: string, resultMessage: unknown) => void;
  };

  const emitted: AgentEvent[] = [];
  internals.emitEventToHandlers = (_id, event) => {
    emitted.push(event);
  };
  internals.contextProbes.set('conv-1', { inFlight: false, latest: usage });
  internals.emitContextUsageSnapshot('conv-1', resultMessage);

  const ev = emitted.find((e) => e.kind === 'harness.context_usage');
  return ev ? (ev.data as Record<string, unknown>) : undefined;
}

describe('claude-agent provider-reported context snapshot', () => {
  it('excludes deferred tools, which occupy no context', () => {
    const d = snapshotFor()!;
    const b = d['breakdown'] as Record<string, number>;
    // Every MCP tool on the live session was `isLoaded: false`, so there is no
    // MCP row at all — not a row reading 14,957.
    expect(b['mcpTools']).toBeUndefined();
    expect(b['system']).toBe(13_197);
    expect(b['tools']).toBe(23_770);
    // Never "System tools (deferred)" (14,178) nor "MCP tools (deferred)".
    expect(Object.values(b)).not.toContain(14_178);
    expect(Object.values(b)).not.toContain(14_957);
  });

  it('keeps the rows summing to no more than the total they sit under', () => {
    const d = snapshotFor()!;
    const b = d['breakdown'] as Record<string, number>;
    // The bar's segments — the nested "·" rows decompose `conversation`.
    const segments = ['system', 'tools', 'mcpTools', 'memoryFiles', 'skills', 'conversation'];
    const barTotal = segments.reduce((a, k) => a + (b[k] ?? 0), 0);
    expect(barTotal).toBeLessThanOrEqual(d['currentTokens'] as number);
    // …and genuinely accounts for the window rather than trivially passing by
    // reporting almost nothing. (Unattributed tokens keep it under 100%.)
    expect(barTotal).toBeGreaterThan((d['currentTokens'] as number) * 0.95);
  });

  it('counts the last API call, not the turn total', () => {
    const d = snapshotFor()!;
    // Last iteration: 2 + 39,048 + 125.
    expect(d['currentTokens']).toBe(39_175);
    // The aggregate would have been 6 + 77,849 + 39,173 = 117,028.
    expect(d['currentTokens']).not.toBe(117_028);
    expect(d['apiUsage']).toEqual({ input: 2, output: 115, cacheRead: 39_048, cacheWrite: 125 });
  });

  it('publishes the provider limits and the auto-compaction point', () => {
    const d = snapshotFor()!;
    expect(d['source']).toBe('provider');
    expect(d['promptTokenLimit']).toBe(1_000_000);
    expect(d['compactionThreshold']).toBe(967_000);
    expect(d['model']).toBe('claude-sonnet-5');
  });

  it('emits nothing when no probe landed, leaving the derived snapshot alone', () => {
    // Previously the control call was awaited after `result`, always rejected,
    // and this path never ran at all. It must stay silent rather than
    // overwrite `event-mapper`'s correct total with an empty breakdown.
    expect(snapshotFor(null)).toBeUndefined();
  });

  it('falls back to the probe total when the result carries no per-call breakdown', () => {
    const d = snapshotFor(LIVE_USAGE, { usage: { input_tokens: 1, output_tokens: 1 } })!;
    expect(d['currentTokens']).toBe(39_029);
  });
});
