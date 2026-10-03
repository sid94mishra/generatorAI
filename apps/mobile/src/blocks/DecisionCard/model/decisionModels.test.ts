import { describe, expect, it } from 'vitest';

import { acceptableIterations, budgetParts, decisionHeadline, loopCommandError, loopDecisionOf, positive } from './loopDecisionModel';
import { reviewView, usageLine } from './reviewModel';

describe('loop decisions (MB-34)', () => {
  const view = loopDecisionOf({ kind: 'loop_decision', action: 'exhaust', reason: 'max_iterations', iterations: 3, k: 2, maxIterations: 3, checkpoints: [0, 5], budget: { maxTurns: 40 }, usage: { turns: 38, costUsd: 1.2 } })!;

  it('reads the parked payload and nothing else', () => {
    expect(loopDecisionOf({ kind: 'stage_completion_review' })).toBeNull();
    expect(view).toMatchObject({ action: 'exhaust', k: 2, iterations: 3 });
  });

  it('offers checkpointed iterations plus the last', () => {
    expect(acceptableIterations(view)).toEqual([0, 2]);
  });

  it('says why and what it spent', () => {
    expect(decisionHeadline(view)).toBe('Ran out · max iterations');
    expect(budgetParts(view)).toEqual(['38/40 turns', '$1.20']);
    expect(loopCommandError(new Error('checkpoint_unavailable: k=1'))).toBe('That iteration has no workspace checkpoint to restore. k=1');
    expect(positive(' 2.4 ', true)).toBe(2);
    expect(positive('-1', false)).toBeNull();
  });
});

describe('completion review (MB-34)', () => {
  it('reads the round, the summary and the facts', () => {
    const v = reviewView({ name: 'Apply upgrades', stageKey: 'apply', interruptData: { kind: 'stage_completion_review', round: 1, summary: '14 packages, 3 majors' }, artifactManifest: [{ path: 'package.json' }, { path: 'unnamed.txt' }], usage: { inputTokens: 48213, outputTokens: 6100, costUsd: 0.41 } }, { maxRounds: 3 });
    expect(v).toMatchObject({ title: 'Review Apply upgrades', round: 'round 1 of 3', summary: '14 packages, 3 majors', promptTitle: 'Approve Apply upgrades?' });
    expect(v.facts).toEqual(['1 file', '48.2K in · 6.1K out · $0.41']);
  });

  it('falls back to the output and says nothing it does not know', () => {
    const v = reviewView({ name: 'Plan', stageKey: 'plan', outputText: 'Did the thing' });
    expect(v.summary).toBe('Did the thing');
    expect(v.round).toBeNull();
    expect(usageLine({})).toBeNull();
  });
});
