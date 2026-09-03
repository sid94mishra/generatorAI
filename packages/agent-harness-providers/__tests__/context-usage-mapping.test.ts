// ────────────────────────────────────────────────────────────────
// Context-usage translation tests.
//
// Guards the two bugs that made the gauge lie:
//   1. Copilot's `max_context_window_tokens` includes the completion budget,
//      so adding `max_output_tokens` on top double-counted it (200K rendered
//      as 264K, disagreeing with the runtime `usage_info.tokenLimit`).
//   2. Anthropic's `usage.input_tokens` EXCLUDES cached tokens, so dropping
//      the cache buckets made a cache-heavy Claude conversation read as ~0%.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { mapSdkEventToAgentEvent } from '../src/providers/copilot/event-mapper.js';
import { mapClaudeAgentMessageToAgentEvents } from '../src/providers/claude-agent/event-mapper.js';

function ev(type: string, data?: unknown, extra?: Record<string, unknown>) {
  return { type, data, ...extra } as unknown as Parameters<typeof mapSdkEventToAgentEvent>[0];
}

describe('copilot → harness.context_usage', () => {
  it('maps session.usage_info, using tokenLimit as the prompt budget', () => {
    const out = mapSdkEventToAgentEvent(ev('session.usage_info', {
      currentTokens: 42_000,
      tokenLimit: 200_000,
      messagesLength: 12,
      systemTokens: 3_000,
      conversationTokens: 30_000,
      toolDefinitionsTokens: 9_000,
    }));

    expect(out.kind).toBe('harness.context_usage');
    const d = out.data as Record<string, unknown>;
    expect(d['source']).toBe('provider');
    expect(d['currentTokens']).toBe(42_000);
    // The denominator must be the PROMPT limit the runtime reports, never the
    // advertised total — that mismatch is the original bug.
    expect(d['promptTokenLimit']).toBe(200_000);
    expect(d['messagesLength']).toBe(12);
    expect(d['breakdown']).toEqual({
      system: 3_000,
      conversation: 30_000,
      tools: 9_000,
    });
  });

  it('tags sub-agent snapshots so they do not overwrite the main gauge', () => {
    const out = mapSdkEventToAgentEvent(
      ev('session.usage_info', { currentTokens: 10, tokenLimit: 100 }, { agentId: 'sub-1' }),
    );
    expect((out.data as Record<string, unknown>)['agentId']).toBe('sub-1');
  });

  it('keeps compaction_complete numbers instead of discarding them', () => {
    // Previously this fell into the mapper's default branch, so the gauge
    // stayed pinned at the pre-compaction value.
    const out = mapSdkEventToAgentEvent(ev('session.compaction_complete', {
      contextWindow: { currentTokens: 15_000, tokenLimit: 200_000, systemTokens: 3_000 },
    }));
    expect(out.kind).toBe('harness.context_usage');
    const d = out.data as Record<string, unknown>;
    expect(d['currentTokens']).toBe(15_000);
    expect(d['promptTokenLimit']).toBe(200_000);
  });

  it('maps session.context_changed too', () => {
    const out = mapSdkEventToAgentEvent(ev('session.context_changed', {
      currentTokens: 1_234,
      tokenLimit: 200_000,
    }));
    expect(out.kind).toBe('harness.context_usage');
    expect((out.data as Record<string, unknown>)['currentTokens']).toBe(1_234);
  });
});

describe('claude-agent → usage + context_usage', () => {
  function resultMessage(over: Record<string, unknown> = {}) {
    return {
      type: 'result',
      subtype: 'success',
      duration_ms: 1_000,
      total_cost_usd: 0.02,
      // `usage` is the turn's AGGREGATE — every API call summed. Here: three
      // calls whose cached prefix was re-read each time. `iterations` carries
      // the per-call breakdown, and its last entry is the assembled prompt of
      // the final call, i.e. the actual window occupancy.
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 5_000,
        iterations: [
          { type: 'message', input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 12_000 },
          { type: 'message', input_tokens: 30, output_tokens: 15, cache_read_input_tokens: 12_000, cache_creation_input_tokens: 3_000 },
          { type: 'message', input_tokens: 50, output_tokens: 25, cache_read_input_tokens: 15_000, cache_creation_input_tokens: 900 },
        ],
      },
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 40_000,
          cacheCreationInputTokens: 5_000,
          contextWindow: 200_000,
          maxOutputTokens: 64_000,
        },
      },
      ...over,
    } as never;
  }

  it('forwards Anthropic cache tokens on harness.usage', () => {
    const events = mapClaudeAgentMessageToAgentEvents(resultMessage());
    const usage = events.find((e) => e.kind === 'harness.usage')!;
    const d = usage.data as Record<string, unknown>;
    expect(d['cacheReadTokens']).toBe(40_000);
    expect(d['cacheWriteTokens']).toBe(5_000);
    expect(d['model']).toBe('claude-sonnet-4-6');
  });

  it('measures the window from the last API call, not the turn total', () => {
    const events = mapClaudeAgentMessageToAgentEvents(resultMessage());
    const ctx = events.find((e) => e.kind === 'harness.context_usage')!;
    const d = ctx.data as Record<string, unknown>;
    // Last iteration: input(50) + cacheRead(15k) + cacheWrite(900) = 15,950.
    //
    // The aggregate — input(100) + cacheRead(40k) + cacheWrite(5k) = 45,100 —
    // is what this used to report, and it is a sum of BILLING across the
    // turn's three API calls, not a measure of the window. Live, that made a
    // two-message chat read as 212k tokens / 23% full, climbing every turn,
    // because each tool round-trip re-counted the same cached prefix.
    expect(d['currentTokens']).toBe(15_950);
    expect(d['source']).toBe('derived');
    // 200K total window minus the 64K completion reserve.
    expect(d['promptTokenLimit']).toBe(136_000);
    expect(d['totalContextWindow']).toBe(200_000);
    // apiUsage must describe the SAME call as the total above it, so the
    // popover's rows add up to the number they sit under.
    expect(d['apiUsage']).toEqual({ input: 50, output: 25, cacheRead: 15_000, cacheWrite: 900 });
  });

  it('still reports the turn TOTAL as usage — spend is cumulative, occupancy is not', () => {
    const events = mapClaudeAgentMessageToAgentEvents(resultMessage());
    const usage = events.find((e) => e.kind === 'harness.usage')!.data as Record<string, unknown>;
    const ctx = events.find((e) => e.kind === 'harness.context_usage')!.data as Record<string, unknown>;
    expect(usage['cacheReadTokens']).toBe(40_000);
    expect(ctx['apiUsage']).not.toEqual(
      expect.objectContaining({ cacheRead: usage['cacheReadTokens'] }),
    );
  });

  it('skips a trailing compaction iteration — it is not the assembled prompt', () => {
    const events = mapClaudeAgentMessageToAgentEvents(resultMessage({
      usage: {
        input_tokens: 5,
        output_tokens: 5,
        iterations: [
          { type: 'message', input_tokens: 7, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 100 },
          { type: 'compaction', input_tokens: 0, cache_read_input_tokens: 180_000, cache_creation_input_tokens: 0 },
        ],
      },
    }));
    const d = events.find((e) => e.kind === 'harness.context_usage')!.data as Record<string, unknown>;
    expect(d['currentTokens']).toBe(9_107);
  });

  it('publishes no context snapshot when the turn produced no tokens', () => {
    // A failed turn (auth error, abort) reports zeros. Rendering "0 / 200k ·
    // 0%" from that would confidently state something false.
    const events = mapClaudeAgentMessageToAgentEvents(resultMessage({
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage: {},
    }));
    expect(events.find((e) => e.kind === 'harness.context_usage')).toBeUndefined();
  });

  it('publishes no context snapshot when the API reported no per-call breakdown', () => {
    // Without `iterations` there is no honest way to separate occupancy from
    // spend, and this module's rule is to say nothing rather than invent a
    // number. `ClaudeAgentProvider`'s control-channel probe still supplies the
    // provider-reported snapshot in that case.
    const events = mapClaudeAgentMessageToAgentEvents(resultMessage({
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 40_000 },
    }));
    expect(events.find((e) => e.kind === 'harness.context_usage')).toBeUndefined();
    // …but the turn's spend is still reported.
    expect(events.find((e) => e.kind === 'harness.usage')).toBeDefined();
  });

  it('attributes usage to the model that did the most work, not insertion order', () => {
    const events = mapClaudeAgentMessageToAgentEvents(resultMessage({
      modelUsage: {
        'claude-haiku-4-5': { inputTokens: 10, outputTokens: 5 },
        'claude-opus-4-8': { inputTokens: 90_000, outputTokens: 400, contextWindow: 200_000 },
      },
    }));
    const usage = events.find((e) => e.kind === 'harness.usage')!;
    expect((usage.data as Record<string, unknown>)['model']).toBe('claude-opus-4-8');
  });

  it('emits a post-compaction snapshot so the gauge can drop', () => {
    const events = mapClaudeAgentMessageToAgentEvents({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: 180_000, post_tokens: 22_000 },
    } as never);
    const ctx = events.find((e) => e.kind === 'harness.context_usage')!;
    expect(ctx).toBeDefined();
    expect((ctx.data as Record<string, unknown>)['currentTokens']).toBe(22_000);
  });
});
