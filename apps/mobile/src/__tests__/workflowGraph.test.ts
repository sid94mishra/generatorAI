import { describe, expect, it } from 'vitest';
import { incomingStages } from '../components/work/workflowGraph';

describe('workflow dependency outline', () => {
  it('shows a fork and join by stage key, without duplicates', () => {
    const incoming = incomingStages([
      { from: 'design', to: 'build' },
      { from: 'design', to: 'tests' },
      { from: 'build', to: 'review' },
      { from: 'tests', to: 'review' },
      { from: 'tests', to: 'review' },
    ]);
    expect(incoming.get('build')).toEqual(['design']);
    expect(incoming.get('review')).toEqual(['build', 'tests']);
  });
});
