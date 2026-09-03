import { describe, expect, it } from 'vitest';

import { StreamEventRouter, type StreamEffect } from '../stream/eventRouter.js';

const SID = 'session-1';

const token = (text: string) => ({ kind: 'harness.token', data: { text } });
const think = (text: string) => ({ kind: 'harness.reasoning_delta', data: { text } });

/** Feed events and collect every effect, including the final drain. */
function run(events: Array<{ kind: string; data?: Record<string, unknown> }>): StreamEffect[] {
  const router = new StreamEventRouter();
  const out: StreamEffect[] = [];
  for (const e of events) out.push(...router.handle(SID, e));
  out.push(...router.drain());
  return out;
}

/** Reconstruct the transcript the way a store would apply the effects. */
function transcript(effects: StreamEffect[]): string {
  return effects
    .filter((e) => e.op === 'appendToken' || e.op === 'appendThinking')
    .map((e) => {
      const marker = e.op === 'appendToken' ? 'T' : 'K';
      return `${marker}(${(e as { text: string }).text})`;
    })
    .join(' ');
}

describe('StreamEventRouter — the cross-buffer flush invariant', () => {
  it('preserves arrival order when thinking and tokens interleave', () => {
    // THE bug this module exists to prevent. Two independent buffers flushed
    // on a timer emit K(ab) T(12) — reordering text the model produced
    // interleaved, and permanently losing the boundary between them.
    const effects = run([think('a'), token('1'), think('b'), token('2')]);
    expect(transcript(effects)).toBe('K(a) T(1) K(b) T(2)');
  });

  it('coalesces a run of the same kind into one effect', () => {
    // Coalescing is why a 200 tok/s stream does not cause 200 renders/s.
    const effects = run([token('a'), token('b'), token('c')]);
    expect(transcript(effects)).toBe('T(abc)');
  });

  it('coalesces within runs but never across a kind boundary', () => {
    const effects = run([token('a'), token('b'), think('x'), think('y'), token('c')]);
    expect(transcript(effects)).toBe('T(ab) K(xy) T(c)');
  });

  it('flushes pending text before an ordered event', () => {
    // A tool call that lands mid-sentence must appear AFTER the text that
    // preceded it, not before.
    const router = new StreamEventRouter();
    router.handle(SID, token('Reading the file'));
    const effects = router.handle(SID, {
      kind: 'harness.tool_start',
      data: { tool: 'read_file', callId: 'c1' },
    });
    expect(effects.map((e) => e.op)).toEqual(['appendToken', 'addToolCall']);
  });

  it.each([
    'harness.reasoning_complete',
    'harness.idle',
    'harness.error',
    'harness.message_complete',
  ])('flushes pending text before %s', (kind) => {
    const router = new StreamEventRouter();
    router.handle(SID, token('partial'));
    const effects = router.handle(SID, { kind, data: {} });
    expect(effects[0]).toMatchObject({ op: 'appendToken', text: 'partial' });
  });

  it('reports whether a flush is pending', () => {
    const router = new StreamEventRouter();
    expect(router.hasPending).toBe(false);
    router.handle(SID, token('x'));
    expect(router.hasPending).toBe(true);
    router.drain();
    expect(router.hasPending).toBe(false);
  });

  it('ignores empty deltas rather than emitting empty blocks', () => {
    expect(run([token(''), think('')])).toEqual([]);
  });
});

describe('StreamEventRouter — stream key routing', () => {
  it('routes each event by its OWN stageRunId', () => {
    // With parallel stages, a shared "current stage" makes stage A's tokens
    // land in stage B's transcript whenever B starts first.
    const router = new StreamEventRouter();
    const out: StreamEffect[] = [];
    out.push(...router.handle(SID, { kind: 'harness.token', data: { text: 'a', stageRunId: 'A' } }));
    out.push(...router.handle(SID, { kind: 'harness.token', data: { text: 'b', stageRunId: 'B' } }));
    out.push(...router.drain());

    const byKey = Object.fromEntries(
      out
        .filter((e) => e.op === 'appendToken')
        .map((e) => [(e as { key: string }).key, (e as { text: string }).text]),
    );
    expect(byKey).toEqual({ 'stageRun:A': 'a', 'stageRun:B': 'b' });
  });

  it('inherits the last stage for events that carry no stageRunId', () => {
    // Harness events (tokens, tool calls) are emitted under the stage's
    // session and do not repeat the stage id.
    const router = new StreamEventRouter();
    router.handle(SID, { kind: 'harness.user_message', data: { stageRunId: 'A', content: 'go' } });
    const effects = [...router.handle(SID, token('hello')), ...router.drain()];
    expect(effects.find((e) => e.op === 'appendToken')).toMatchObject({ key: 'stageRun:A' });
  });

  it('falls back to the session id when no stage is involved', () => {
    const effects = run([token('hi')]);
    expect(effects[0]).toMatchObject({ key: SID });
  });
});

describe('StreamEventRouter — turn lifecycle', () => {
  it('discards buffered text from the previous turn on a new user message', () => {
    // Text left over from an aborted turn must not be prepended to the next
    // answer, where it would read as the model contradicting itself.
    const router = new StreamEventRouter();
    router.handle(SID, token('stale text'));
    const effects = router.handle(SID, {
      kind: 'harness.user_message',
      data: { content: 'new question' },
    });

    // The stale text is flushed to its own (previous) turn, then cleared.
    // `cancelTranscriptCleanup` disarms the settle-and-clear timer the
    // PREVIOUS turn's idle armed — without it a new turn can be wiped a few
    // seconds in by a timer that belongs to the turn before it.
    expect(effects.map((e) => e.op)).toEqual([
      'appendToken',
      'cancelTranscriptCleanup',
      'startPending',
      'invalidate',
    ]);
    // Nothing survives into the new turn.
    expect(router.hasPending).toBe(false);
    expect(router.drain()).toEqual([]);
  });

  it('routes inline tool-call XML to the restructuring path', () => {
    const effects = run([
      { kind: 'harness.message_complete', data: { content: 'x <function_calls> y' } },
    ]);
    expect(effects.some((e) => e.op === 'processInlineToolCalls')).toBe(true);
  });

  it('does not restructure ordinary prose', () => {
    const effects = run([{ kind: 'harness.message_complete', data: { content: 'just prose' } }]);
    expect(effects.some((e) => e.op === 'processInlineToolCalls')).toBe(false);
    expect(effects.some((e) => e.op === 'invalidate')).toBe(true);
  });

  it('completes the stream on idle', () => {
    const effects = run([{ kind: 'harness.idle', data: {} }]);
    expect(effects.some((e) => e.op === 'completeStream')).toBe(true);
  });

  it('records an error as both a visible note and a status change', () => {
    // A status change alone leaves the user staring at a stopped spinner
    // with no explanation.
    const effects = run([{ kind: 'harness.error', data: { message: 'rate limited' } }]);
    expect(effects).toEqual([
      { op: 'errorStream', key: SID },
      { op: 'addSystemMessage', key: SID, message: 'Error: rate limited', category: 'error' },
      // The session row and the message list both went stale: the turn is
      // over and the server has already persisted whatever it managed.
      { op: 'invalidate', resource: 'session' },
      { op: 'invalidate', resource: 'messages' },
    ]);
  });

  it('matches tool completion by callId, falling back to tool name', () => {
    expect(
      run([{ kind: 'harness.tool_complete', data: { callId: 'c1', result: 'ok' } }])[0],
    ).toMatchObject({ op: 'completeToolCall', toolOrCallId: 'c1' });

    expect(
      run([{ kind: 'harness.tool_complete', data: { tool: 'grep', result: 'ok' } }])[0],
    ).toMatchObject({ op: 'completeToolCall', toolOrCallId: 'grep' });
  });
});

describe('StreamEventRouter — orchestrator worker turns', () => {
  it('hides internal turns from the transcript', () => {
    // Worker chats are bookkeeping. Rendering them shows the user their own
    // agent talking to itself.
    expect(run([{ kind: 'harness.token', data: { text: 'x', __isInternalTurn: true } }])).toEqual([]);
    expect(
      run([{ kind: 'harness.tool_start', data: { tool: 't', __isInternalTurn: true } }]),
    ).toEqual([]);
  });

  it('still refreshes history for an internal user message', () => {
    // The message is not rendered live, but it IS persisted, so the list
    // must refetch or the transcript silently diverges from the server.
    const effects = run([
      { kind: 'harness.user_message', data: { content: 'x', __isInternalTurn: true } },
    ]);
    expect(effects).toEqual([{ op: 'invalidate', resource: 'messages' }]);
  });
});

describe('StreamEventRouter — forward compatibility', () => {
  it('ignores an unknown event kind', () => {
    // A newer server must not break an older client.
    expect(run([{ kind: 'harness.some_future_thing', data: { a: 1 } }])).toEqual([]);
  });

  it('does not drop buffered text when an unknown event arrives', () => {
    // Silently losing the sentence before an unrecognised event would be a
    // data-loss bug that only appears after a server upgrade.
    const router = new StreamEventRouter();
    router.handle(SID, token('important'));
    router.handle(SID, { kind: 'harness.unknown', data: {} });
    expect(router.drain()).toEqual([{ op: 'appendToken', key: SID, text: 'important' }]);
  });

  it('survives a malformed event without throwing', () => {
    const router = new StreamEventRouter();
    expect(() => router.handle(SID, { kind: '' })).not.toThrow();
    expect(() => router.handle(SID, { kind: 'harness.token' })).not.toThrow();
  });
});

describe('StreamEventRouter — plan and question gates', () => {
  it.each([
    ['chat.plan.review_requested', 'plans'],
    ['chat.plan.decided', 'plans'],
    ['chat.question.asked', 'interactions'],
    ['chat.question.expired', 'interactions'],
    // The underscore spellings are not on the wire but were once assumed to
    // be; both are accepted so the gate cannot go silent again.
    ['chat.question_asked', 'interactions'],
    ['chat.question_expired', 'interactions'],
  ])('%s triggers a %s refetch', (kind, resource) => {
    expect(run([{ kind, data: {} }])).toContainEqual({ op: 'invalidate', resource });
  });

  it('builds a question card so the gate can render before the refetch lands', () => {
    const effects = run([
      {
        kind: 'chat.question.asked',
        data: { interactionId: 'i1', questions: [{ id: 'q1', header: 'Scope' }] },
      },
    ]);
    expect(effects).toContainEqual({
      op: 'upsertQuestion',
      key: SID,
      question: {
        interactionId: 'i1',
        questions: [{ id: 'q1', header: 'Scope' }],
        status: 'pending',
      },
    });
  });

  it('builds a plan card on review_requested', () => {
    const effects = run([
      {
        kind: 'chat.plan.review_requested',
        data: {
          planId: 'p1',
          interactionId: 'i2',
          revision: 2,
          title: 'Refactor',
          summary: 'Do the thing',
          actions: ['approve', 'request_changes'],
        },
      },
    ]);
    expect(effects).toContainEqual({
      op: 'upsertPlan',
      key: SID,
      plan: {
        planId: 'p1',
        revision: 2,
        title: 'Refactor',
        summary: 'Do the thing',
        status: 'awaiting_review',
        actions: ['approve', 'request_changes'],
        interactionId: 'i2',
      },
    });
  });
});

describe('StreamEventRouter — non-streaming providers', () => {
  it('emits the whole answer from message_complete', () => {
    expect(
      run([{ kind: 'harness.message_complete', data: { content: 'All done.' } }]),
    ).toContainEqual({ op: 'appendTokenIfNoText', key: SID, text: 'All done.' });
  });

  it('does not do so for tool-call XML, which is restructured instead', () => {
    const effects = run([
      {
        kind: 'harness.message_complete',
        data: { content: '<function_calls>…</function_calls>' },
      },
    ]);
    expect(effects.some((e) => e.op === 'appendTokenIfNoText')).toBe(false);
    expect(effects.some((e) => e.op === 'processInlineToolCalls')).toBe(true);
  });
});
