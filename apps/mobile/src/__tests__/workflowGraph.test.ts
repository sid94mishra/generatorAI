import { describe, expect, it } from 'vitest';
import { incomingStages } from '../components/work/workflowGraph';

describe('workflow dependency outline', () => {
  it('shows a real REST fork and join instead of silently hiding all dependencies', () => {
    const incoming = incomingStages([
      { fromStageId: 'design', toStageId: 'build' },
      { fromStageId: 'design', toStageId: 'tests' },
      { fromStageId: 'build', toStageId: 'review' },
      { fromStageId: 'tests', toStageId: 'review' },
    ]);
    expect(incoming.get('build')).toEqual(['design']);
    expect(incoming.get('review')).toEqual(['build', 'tests']);
  });
  it('accepts legacy imports without duplicate or malformed prerequisites', () => {
    expect(incomingStages([{ from: 'a', to: 'b' }, { source: 'a', target: 'b' }, {}]).get('b'))
      .toEqual(['a']);
  });
});
