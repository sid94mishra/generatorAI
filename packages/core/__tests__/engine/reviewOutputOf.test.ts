// U-29: a completion review shows the stage's structured output (what the PR body and successors use),
// not the closing sentence the agent happened to end its turn with.
import { describe, expect, it } from 'vitest';
import { reviewOutputOf } from '../../src/services/engine/StageExecutor.js';

describe('reviewOutputOf', () => {
  it('prefers the structured output', () => {
    const out = reviewOutputOf("I'll merge those imports.", { verdict: 'approve', pr_description: 'Fixes #15' });
    expect(JSON.parse(out)).toEqual({ verdict: 'approve', pr_description: 'Fixes #15' });
  });
  it('falls back to the text and bounds it', () => {
    expect(reviewOutputOf('All done.', undefined)).toBe('All done.');
    expect(reviewOutputOf('x'.repeat(70_000), undefined)).toHaveLength(64_001);
  });
});
