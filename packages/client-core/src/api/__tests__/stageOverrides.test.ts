import { describe, expect, it } from 'vitest';

import {
  STAGE_OVERRIDES_VARIABLE,
  activeStageOverrides,
  blankStageOverrides,
  encodeStageOverrides,
} from '../stageOverrides.js';

describe('stage overrides', () => {
  it('seeds one untouched draft per stage', () => {
    expect(blankStageOverrides(['plan', 'build'])).toEqual([
      { stageName: 'plan', stageIndex: 0, skip: false, variables: {} },
      { stageName: 'build', stageIndex: 1, skip: false, variables: {} },
    ]);
  });

  it('drops drafts that change nothing and omits empty fields', () => {
    const drafts = blankStageOverrides(['a', 'b', 'c']);
    drafts[1] = { ...drafts[1]!, skip: true };
    drafts[2] = { ...drafts[2]!, variables: { depth: 2 } };
    expect(activeStageOverrides(drafts)).toEqual([
      { stageName: 'b', stageIndex: 1, skip: true },
      { stageName: 'c', stageIndex: 2, variables: { depth: 2 } },
    ]);
    expect(activeStageOverrides(undefined)).toEqual([]);
  });

  it('sends nothing extra for an untouched form', () => {
    const vars = { repo: 'x' };
    expect(encodeStageOverrides(vars, blankStageOverrides(['a']), { orchestrated: true })).toEqual({ variables: vars });
    expect(encodeStageOverrides(vars, [], { orchestrated: false })).toEqual({ variables: vars });
  });

  it('uses a top-level array for orchestrated runs', () => {
    const drafts = [{ stageName: 'a', stageIndex: 0, skip: true, variables: {} }];
    const out = encodeStageOverrides({ repo: 'x' }, drafts, { orchestrated: true });
    expect(out.variables).toEqual({ repo: 'x' });
    expect(out.stageOverrides).toEqual([{ stageName: 'a', stageIndex: 0, skip: true }]);
  });

  it('folds overrides into __stageOverrides for plain runs without mutating input', () => {
    const vars = { repo: 'x' };
    const drafts = [{ stageName: 'a', stageIndex: 0, skip: true, variables: {} }];
    const out = encodeStageOverrides(vars, drafts, { orchestrated: false });
    expect(out.stageOverrides).toBeUndefined();
    expect(out.variables).toEqual({
      repo: 'x',
      [STAGE_OVERRIDES_VARIABLE]: [{ stageName: 'a', stageIndex: 0, skip: true }],
    });
    expect(vars).toEqual({ repo: 'x' });
    expect(STAGE_OVERRIDES_VARIABLE).toBe('__stageOverrides');
  });
});
