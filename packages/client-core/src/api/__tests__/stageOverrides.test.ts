import { describe, expect, it } from 'vitest';

import {
  STAGE_OVERRIDES_VARIABLE,
  activeStageOverrides,
  blankStageOverrides,
  encodeStageOverrides,
} from '../stageOverrides.js';

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

  it('sends nothing extra for an untouched form', () => {
    const vars = { repo: 'x' };
    expect(encodeStageOverrides(vars, blankStageOverrides([{ key: 'a', name: 'A' }]), { orchestrated: true })).toEqual({ variables: vars });
    expect(encodeStageOverrides(vars, [], { orchestrated: false })).toEqual({ variables: vars });
  });

  it('uses a top-level array for orchestrated runs', () => {
    const drafts = [{ stageKey: 'a', stageName: 'A', skip: true, variables: {} }];
    const out = encodeStageOverrides({ repo: 'x' }, drafts, { orchestrated: true });
    expect(out.variables).toEqual({ repo: 'x' });
    expect(out.stageOverrides).toEqual([{ stageKey: 'a', skip: true }]);
  });

  it('folds overrides into __stageOverrides for plain runs without mutating input', () => {
    const vars = { repo: 'x' };
    const drafts = [{ stageKey: 'a', stageName: 'A', skip: true, variables: {} }];
    const out = encodeStageOverrides(vars, drafts, { orchestrated: false });
    expect(out.stageOverrides).toBeUndefined();
    expect(out.variables).toEqual({
      repo: 'x',
      [STAGE_OVERRIDES_VARIABLE]: [{ stageKey: 'a', skip: true }],
    });
    expect(vars).toEqual({ repo: 'x' });
    expect(STAGE_OVERRIDES_VARIABLE).toBe('__stageOverrides');
  });
});
