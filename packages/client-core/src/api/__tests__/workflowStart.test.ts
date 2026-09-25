import { describe, expect, it } from 'vitest';
import { needsOrchestratedStart } from '../workflowStart.js';

const lifecycle = {
  codebaseAliases: [],
  useWorktree: true,
  requiresCodebase: false,
  preprocessingSteps: [],
  postProcessing: { autoCommit: false, autoPush: false, autoCreatePR: false, steps: [] },
};

describe('needsOrchestratedStart', () => {
  it('is false for a global workflow with an empty lifecycle', () => {
    expect(needsOrchestratedStart({ lifecycle })).toBe(false);
  });
  it('is true for a project workflow, codebases, or pre/post-processing', () => {
    expect(needsOrchestratedStart({ lifecycle, projectId: '11111111-1111-4111-8111-111111111111' })).toBe(true);
    expect(needsOrchestratedStart({ lifecycle: { ...lifecycle, requiresCodebase: true } })).toBe(true);
    expect(
      needsOrchestratedStart({ lifecycle: { ...lifecycle, postProcessing: { ...lifecycle.postProcessing, autoCreatePR: true } } }),
    ).toBe(true);
  });
});
