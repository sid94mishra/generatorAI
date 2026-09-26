// WF-06 BudgetMeter: which dimensions show, and tokens-only when no provider
// reported a cost (D-35, D-81).
import { describe, expect, it } from 'vitest';
import { budgetItems, tightestItem } from '../BudgetMeter.js';

describe('budgetItems', () => {
  it('shows turns and tokens only when nothing else is limited or reported', () => {
    const items = budgetItems({ turns: 3, inputTokens: 1000, outputTokens: 500 }, undefined, 60_000);
    expect(items.map((i) => i.key)).toEqual(['turns', 'tokens']);
    expect(items[1]).toMatchObject({ used: 1500, usedText: '1.5k' });
    expect(tightestItem(items)).toBeUndefined();
  });

  it('adds wall clock only when the budget limits it and cost only when a provider reported it', () => {
    const items = budgetItems(
      { turns: 118, inputTokens: 1_000_000, outputTokens: 400_000, costUsd: 3.12 },
      { maxTurns: 250, maxCostUsd: 10, maxWallClockMs: 3_600_000 },
      1_800_000,
    );
    expect(items.map((i) => i.key)).toEqual(['turns', 'tokens', 'wall', 'cost']);
    expect(items.find((i) => i.key === 'cost')).toMatchObject({ usedText: '$3.12', limitText: '$10.00', over: false });
  });

  it('never shows dollars without a reported cost, even with a cost limit', () => {
    const items = budgetItems({ turns: 1 }, { maxCostUsd: 5 }, 0);
    expect(items.some((i) => i.key === 'cost')).toBe(false);
  });

  it('marks an exhausted limit and picks the tightest one for the inline meter', () => {
    const items = budgetItems({ turns: 250, inputTokens: 10 }, { maxTurns: 250, maxTokens: 1000 }, 0);
    expect(items.find((i) => i.key === 'turns')?.over).toBe(true);
    expect(tightestItem(items)?.key).toBe('turns');
  });
});
