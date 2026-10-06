import { describe, expect, it } from 'vitest';
import { qualifyBodyRefs, qualifyBodyRefsIn, unqualifyBodyRefs, unqualifyBodyRefsIn } from '../src/stageRefs.js';
import type { EdgeSpec, StageSpec } from '../src/index.js';

// D-104: wrapping stages in a loop / unwrapping it rewrites the references the rest of the graph makes to them.

describe('qualifyBodyRefsIn / unqualifyBodyRefsIn', () => {
  it('reads a body stage through the loop from outside, and back', () => {
    const text = 'Tests passed: {{ stages.test.output.passed }} — {{stages.implement.output.summary}}';
    const qualified = qualifyBodyRefsIn(text, 'loop_1', ['implement', 'test']);
    expect(qualified).toBe('Tests passed: {{ stages.loop_1.output.last.test.output.passed }} — {{stages.loop_1.output.last.implement.output.summary}}');
    expect(unqualifyBodyRefsIn(qualified, 'loop_1', ['implement', 'test'])).toBe(text);
  });

  it('leaves other stages, longer keys and already-qualified paths alone', () => {
    const text = 'stages.review.output && stages.tests.output && stages.other.output.last.test && xstages.test';
    expect(qualifyBodyRefsIn(text, 'loop_1', ['test'])).toBe(text);
    expect(unqualifyBodyRefsIn('stages.loop_1.output.iterations', 'loop_1', ['test'])).toBe('stages.loop_1.output.iterations');
  });
});

describe('qualifyBodyRefs / unqualifyBodyRefs on specs', () => {
  it('rewrites every string of a stage and an edge, keeping untouched values', () => {
    const review = {
      key: 'review',
      name: 'Review',
      kind: 'agent',
      prompts: [{ text: 'Check {{ stages.implement.output }}' }],
      context: { mode: 'summary', from: ['implement'] },
    } as unknown as StageSpec;
    const out = qualifyBodyRefs(review, 'loop_1', ['implement']) as unknown as { prompts: Array<{ text: string }>; context: { from: string[] } };
    expect(out.prompts[0]!.text).toBe('Check {{ stages.loop_1.output.last.implement.output }}');
    // `context.from` names keys, not expressions: the store moves those with the edges.
    expect(out.context.from).toEqual(['implement']);
    expect(qualifyBodyRefs(review, 'loop_1', ['other'])).toBe(review);

    const edge = { from: 'loop_1', to: 'review', when: 'stages.test.output.passed == true' } as unknown as EdgeSpec;
    const q = qualifyBodyRefs(edge, 'loop_1', ['test']);
    expect((q as unknown as { when: string }).when).toBe('stages.loop_1.output.last.test.output.passed == true');
    expect(unqualifyBodyRefs(q, 'loop_1', ['test'])).toEqual(edge);
  });
});
