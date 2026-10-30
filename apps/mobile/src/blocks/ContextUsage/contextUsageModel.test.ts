import { describe, expect, it } from 'vitest';
import { contextUsageView } from './contextUsageModel';

describe('ContextUsage (MB-41)', () => {
  it('reads the snapshot against its limit and sorts the breakdown', () => {
    const view = contextUsageView({ currentTokens: 84_200, promptTokenLimit: 200_000, breakdown: { system: 4000, conversation: 60_000, tools: 0 }, apiUsage: { input: 1200 } });
    expect(view?.percent).toBe(42);
    expect(view?.title).toBe('42% of context used');
    expect(view?.breakdown.map((b) => b.label)).toEqual(['Conversation', 'System prompt']);
    expect(view?.api.map((a) => a.label)).toEqual(['Input']);
  });

  it('is absent until a snapshot and a limit exist', () => {
    expect(contextUsageView(null, 200_000)).toBeNull();
    expect(contextUsageView({ currentTokens: 10 }, null)).toBeNull();
    expect(contextUsageView({ currentTokens: 10 }, 100)?.percent).toBe(10);
  });
});
