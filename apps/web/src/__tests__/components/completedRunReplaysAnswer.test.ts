// ────────────────────────────────────────────────────────────────
// A completed stage must replay its answer inline after a reload.
//
// Found during the end-to-end browser pass, and reproduced twice: on a fresh
// run AND on a pre-existing completed run. Reload a finished workflow run and
// the stage timeline showed the prompt bubble but NOTHING for the assistant's
// answer. The text was never lost — it was in the database the whole time —
// but the only way to reach it was Details → Inspector → Output.
//
// Cause: `deriveRunView` built `answer` from `deriveAnswer(stream?.blocks)`
// alone. `streams` is the live stream store, which only holds blocks the
// CURRENT browser session actually received over SSE. After a reload it is
// empty, so a completed stage derived an empty answer and `StreamPanel`
// rendered nothing.
//
// The fix falls back to the persisted `outputText` once a stage is terminal.
// These tests pin both halves: the fallback happens when it should, and it
// does NOT pre-empt the live stream while a stage is still running.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { deriveRunView, type DeriveRunViewInput } from '@/components/workflow/redesign/deriveRunView.js';

const PERSISTED = 'The persisted answer that was written when the stage finished.';
const STREAMED = 'The answer as it arrived over SSE.';

function stageRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sr-1',
    stageKey: 'only_stage',
    name: 'Only Stage',
    status: 'completed',
    totalSteps: 1,
    startedAt: 1,
    completedAt: 2,
    ...overrides,
  };
}

function input(overrides: Partial<DeriveRunViewInput> = {}): DeriveRunViewInput {
  return {
    run: {
      id: 'run-1',
      status: 'completed',
      stageRuns: [stageRun()],
    },
    stageDefs: [{ kind: 'agent', key: 'only_stage', name: 'Only Stage', prompts: [] }],
    edges: [],
    elapsedMs: 0,
    // The reload case: the stream store is empty.
    streams: {},
    ...overrides,
  } as unknown as DeriveRunViewInput;
}

/** A stream store entry carrying a live assistant answer block. */
function streamWithAnswer(text: string) {
  return {
    'stageRun:sr-1': {
      blocks: [{ type: 'text', content: text }],
    },
  } as unknown as DeriveRunViewInput['streams'];
}

describe('deriveRunView — a finished run replays its answer without the live stream', () => {
  it('falls back to the persisted outputText when the stream store is empty', () => {
    const view = deriveRunView(
      input({ run: { id: 'run-1', status: 'completed', stageRuns: [stageRun({ outputText: PERSISTED })] } as never }),
    );

    // Pre-fix this was '' and the timeline rendered a prompt with no answer.
    expect(view.stages[0]!.answer).toBe(PERSISTED);
  });

  it('prefers the settled result when the stream only contains earlier fragments', () => {
    const view = deriveRunView(
      input({
        run: { id: 'run-1', status: 'completed', stageRuns: [stageRun({ outputText: PERSISTED })] } as never,
        streams: streamWithAnswer(STREAMED),
      }),
    );

    expect(view.stages[0]!.answer).toBe(PERSISTED);
    expect(view.stages[0]!.segments).toEqual([]);
    expect(view.stages[0]!.order).toBe(1);
  });

  it('shows the finished output while awaiting approval, including after navigation', () => {
    const view = deriveRunView(input({
      run: { id: 'run-1', status: 'running', stageRuns: [stageRun({ status: 'awaiting_input', outputText: PERSISTED })] } as never,
      streams: streamWithAnswer('I will inspect the files.'),
    }));
    expect(view.stages[0]!.answer).toBe(PERSISTED);
    expect(view.stages[0]!.segments).toEqual([]);
  });

  it('does NOT fall back while the stage is still running', () => {
    const view = deriveRunView(
      input({
        run: {
          id: 'run-1',
          status: 'running',
          stageRuns: [stageRun({ status: 'running', outputText: PERSISTED, completedAt: undefined })],
        } as never,
      }),
    );

    // `outputText` is not written until the stage settles, so treating it as
    // the answer mid-run would show a stale or partial result as if it were
    // final. An empty answer while streaming is correct.
    expect(view.stages[0]!.answer).toBe('');
  });

  it('stays empty for a completed stage that genuinely produced no text', () => {
    const view = deriveRunView(input());

    expect(view.stages[0]!.answer).toBe('');
  });

  it('replays a FAILED stage’s output too, not just a successful one', () => {
    const view = deriveRunView(
      input({
        run: {
          id: 'run-1',
          status: 'failed',
          stageRuns: [stageRun({ status: 'failed', outputText: PERSISTED })],
        } as never,
      }),
    );

    // A failed stage's partial output is often the most useful thing on the
    // page for working out why it failed.
    expect(view.stages[0]!.answer).toBe(PERSISTED);
  });
});
