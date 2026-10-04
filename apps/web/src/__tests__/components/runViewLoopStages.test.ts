// The run page for a loop(implement → test) → review workflow (desktop end-to-end build): body stages are not
// "parallel" with their own loop, and the Review's stage prompt shows what the engine rendered from the loop.

import { describe, expect, it } from 'vitest';
import { deriveRunView, type DeriveRunViewInput } from '@/features/workflows/run/model/deriveRunView.js';

const t = (min: number) => new Date(Date.UTC(2026, 9, 5, 1, min)).toISOString();

function input(): DeriveRunViewInput {
  return {
    run: {
      id: 'run-1',
      status: 'running',
      variables: { feature: 'Task search' },
      stageRuns: [
        { id: 'loop', stageKey: 'loop_1', name: 'Loop 1', kind: 'loop', status: 'completed', startedAt: t(0), completedAt: t(20), outputData: { iterations: 1, last: { implement: 'Search is in; tests pass.' } } },
        { id: 'impl', stageKey: 'implement', name: 'Implement', status: 'completed', scopeId: 'loop', startedAt: t(0), completedAt: t(19), outputText: 'Search is in; tests pass.' },
        { id: 'test', stageKey: 'test', name: 'Test', kind: 'check', status: 'completed', scopeId: 'loop', startedAt: t(19), completedAt: t(20) },
        { id: 'rev', stageKey: 'review', name: 'Review', status: 'running', startedAt: t(20) },
      ],
    },
    stageDefs: [
      { kind: 'loop', key: 'loop_1', name: 'Loop 1' },
      { kind: 'agent', key: 'implement', name: 'Implement', parentKey: 'loop_1', prompts: [{ text: 'Implement {{feature}}' }] },
      { kind: 'check', key: 'test', name: 'Test', parentKey: 'loop_1', check: { command: 'npm', args: ['test'] } },
      { kind: 'agent', key: 'review', name: 'Review', prompts: [{ text: 'Review {{feature}}. The implementer reported: {{ stages.loop_1.output.last.implement }}' }] },
    ],
    edges: [{ from: 'implement', to: 'test' }, { from: 'loop_1', to: 'review' }],
    elapsedMs: 0,
    // The check's stream entry never got a terminal event (no agent turn).
    streams: { 'stageRun:test': { status: 'pending', blocks: [] } },
  } as unknown as DeriveRunViewInput;
}

describe('run view — loops', () => {
  const view = deriveRunView(input());
  const byKey = Object.fromEntries(view.stages.map((s) => [s.stageKey, s]));

  it('does not call a body stage parallel with the loop it runs in', () => {
    expect(byKey.implement!.parallelWith ?? []).toEqual([]);
    expect(byKey.test!.parallelWith ?? []).toEqual([]);
  });

  it("renders a stage prompt's references to earlier stages, as the engine sent it", () => {
    expect(byKey.review!.prompt).toBe('Review Task search. The implementer reported: Search is in; tests pass.');
  });

  it('a finished check stage is not streaming even if its stream entry never closed', () => {
    expect(byKey.test!.streaming).toBe(false);
  });
});
