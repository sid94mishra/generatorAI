import { describe, expect, it } from 'vitest';

import { activeStageOverrides, blankStageOverrides } from '../runStart.js';

describe('stage overrides', () => {
  it('seeds one untouched draft per stage', () => {
    expect(blankStageOverrides([{ key: 'plan', name: 'Plan' }, { key: 'build', name: 'Build' }])).toEqual([
      { stageKey: 'plan', stageName: 'Plan', skip: false, variables: {} },
      { stageKey: 'build', stageName: 'Build', skip: false, variables: {} },
    ]);
  });

  it('drops drafts that change nothing and omits empty fields', () => {
    const drafts = blankStageOverrides(['a', 'b', 'c'].map((k) => ({ key: k, name: k.toUpperCase() })));
    drafts[1] = { ...drafts[1]!, skip: true };
    drafts[2] = { ...drafts[2]!, variables: { depth: 2 } };
    expect(activeStageOverrides(drafts)).toEqual([
      { stageKey: 'b', skip: true },
      { stageKey: 'c', variables: { depth: 2 } },
    ]);
    expect(activeStageOverrides(undefined)).toEqual([]);
  });
});
