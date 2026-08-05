import { describe, expect, it } from 'vitest';

import { DEFAULT_STREAM, type StreamsRecord } from '../stream/types.js';
import * as r from '../stream/reducer.js';

const SID = 'session-1';

/** Apply a sequence of reducers, threading the record through. */
const run = (...steps: Array<(s: StreamsRecord) => StreamsRecord>): StreamsRecord =>
  steps.reduce<StreamsRecord>((s, step) => step(s), {});

const blocks = (s: StreamsRecord) => r.getStream(s, SID).blocks;
const kinds = (s: StreamsRecord) => blocks(s).map((b) => b.type);

describe('stream reducer — temporal ordering', () => {
  it('preserves the interleaving of thinking, text and tool calls', () => {
    // This is THE property the block model exists for. Parallel buffers
    // (one string for thinking, one for text) cannot represent this.
    const s = run(
      (x) => r.appendThinking(x, SID, 'let me look'),
      (x) => r.completeThinking(x, SID),
      (x) => r.appendToken(x, SID, 'Checking '),
      (x) => r.addToolCall(x, SID, 'read_file', { path: 'a.ts' }, 'c1'),
      (x) => r.completeToolCall(x, SID, 'c1', 'ok'),
      (x) => r.appendToken(x, SID, 'done.'),
    );

    expect(kinds(s)).toEqual(['thinking', 'text', 'tool_call', 'text']);
  });

  it('splits text into a new block after an interruption', () => {
    const s = run(
      (x) => r.appendToken(x, SID, 'a'),
      (x) => r.appendToken(x, SID, 'b'),
      (x) => r.addSystemMessage(x, SID, 'note'),
      (x) => r.appendToken(x, SID, 'c'),
    );

    expect(kinds(s)).toEqual(['text', 'system', 'text']);
    // Contiguous tokens still coalesce into one block.
    expect(blocks(s)[0]).toMatchObject({ content: 'ab' });
    expect(blocks(s)[2]).toMatchObject({ content: 'c' });
    // The flat accumulator stays complete regardless of block splits.
    expect(r.getStream(s, SID).text).toBe('abc');
  });

  it('ignores empty tokens and blank system messages', () => {
    const s = run(
      (x) => r.appendToken(x, SID, ''),
      (x) => r.appendThinking(x, SID, ''),
      (x) => r.addSystemMessage(x, SID, '   '),
    );
    expect(s).toEqual({});
  });
});

describe('stream reducer — invariant 2: block ids are monotonic across turns', () => {
  it('never restarts blockId after startPending', () => {
    const first = run(
      (x) => r.appendToken(x, SID, 'one'),
      (x) => r.addToolCall(x, SID, 't', {}, 'c1'),
    );
    const maxFirst = Math.max(...blocks(first).map((b) => b.blockId));

    const second = run(
      () => first,
      (x) => r.startPending(x, SID, 'next question'),
      (x) => r.appendToken(x, SID, 'two'),
    );

    // A colliding key here makes React reuse a DOM node across turns.
    expect(Math.min(...blocks(second).map((b) => b.blockId))).toBeGreaterThan(maxFirst);
    expect(r.getStream(second, SID).turnId).toBe(1);
  });

  it('never restarts blockId after clearStream', () => {
    const before = run((x) => r.appendToken(x, SID, 'one'));
    const after = run(
      () => before,
      (x) => r.clearStream(x, SID),
      (x) => r.appendToken(x, SID, 'two'),
    );
    expect(blocks(after)[0]!.blockId).toBeGreaterThan(blocks(before)[0]!.blockId);
  });
});

describe('stream reducer — invariant 3: terminal statuses are never revived', () => {
  it.each(['complete', 'idle', 'error'] as const)(
    'a late tool_complete does not drag %s back to streaming',
    (terminal) => {
      let s = run(
        (x) => r.appendToken(x, SID, 'hi'),
        (x) => r.addToolCall(x, SID, 'slow_tool', {}, 'c1'),
      );
      s = {
        [SID]: { ...r.getStream(s, SID), status: terminal },
      };

      s = r.completeToolCall(s, SID, 'c1', 'late result');

      // Reviving 'streaming' here stops auto-clear from ever firing, which
      // leaves the composer disabled forever.
      expect(r.getStream(s, SID).status).toBe(terminal);
      // The result must still be recorded.
      expect(blocks(s).find((b) => b.type === 'tool_call')).toMatchObject({
        status: 'complete',
        result: 'late result',
      });
    },
  );

  it('completeStream does not overwrite a freshly started turn', () => {
    const s = run(
      (x) => r.appendToken(x, SID, 'old turn'),
      (x) => r.startPending(x, SID, 'new turn'),
      // A trailing completion event from the PREVIOUS turn arrives late.
      (x) => r.completeStream(x, SID),
    );
    expect(r.getStream(s, SID).status).toBe('pending');
  });
});

describe('stream reducer — invariant 4: widgets survive turn boundaries', () => {
  const widget = {
    instanceId: 'w1',
    descriptorId: 'd1',
    extensionId: 'ext',
    component: 'Form',
    surface: 'inline',
    assetsBase: 'https://widgets.local/ext',
    entry: 'index.js',
    props: { a: 1 },
    status: 'active' as const,
  };

  it('carries widgets across startPending and clearStream', () => {
    const base = run(
      (x) => r.appendToken(x, SID, 'text'),
      (x) => r.addWidget(x, SID, widget),
    );

    const afterTurn = r.startPending(base, SID, 'next');
    expect(kinds(afterTurn)).toEqual(['widget']);

    const afterClear = r.clearStream(base, SID);
    expect(kinds(afterClear)).toEqual(['widget']);
  });

  it('de-dups a re-emitted render instead of stacking frames', () => {
    const s = run(
      (x) => r.addWidget(x, SID, widget),
      // A resume/replay re-emits the same render event.
      (x) => r.addWidget(x, SID, { ...widget, props: { a: 2 } }),
    );
    expect(blocks(s)).toHaveLength(1);
    expect(blocks(s)[0]).toMatchObject({ props: { a: 2 } });
  });

  it('normalizes legacy surfaces to the two canonical values', () => {
    const s = run(
      (x) => r.addWidget(x, SID, { ...widget, surface: 'chat' }),
      (x) => r.addWidget(x, SID, { ...widget, instanceId: 'w2', surface: 'right-pane' }),
    );
    expect(blocks(s).map((b) => (b as { surface: string }).surface)).toEqual(['inline', 'widget']);
  });
});

describe('stream reducer — invariant 5: usage survives a clear', () => {
  it('keeps usage and contextUsage so the gauge does not reset to 0%', () => {
    const usage = { model: 'm', inputTokens: 100, outputTokens: 20 };
    const s = run(
      (x) => r.appendToken(x, SID, 'hi'),
      (x) => r.setUsage(x, SID, usage),
      (x) => r.setContextUsage(x, SID, { used: 120, limit: 1000 }, 1_000),
      (x) => r.clearStream(x, SID),
    );

    expect(r.getStream(s, SID).usage).toEqual(usage);
    expect(r.getStream(s, SID).contextUsage).toMatchObject({ used: 120, at: 1_000 });
  });

  it('records usage on an idle stream but not for an unknown session', () => {
    const usage = { model: 'm', inputTokens: 1, outputTokens: 1 };
    // Replay applies usage after clearStream leaves the stream idle.
    const idle: StreamsRecord = { [SID]: { ...DEFAULT_STREAM } };
    expect(r.getStream(r.setUsage(idle, SID, usage), SID).usage).toEqual(usage);

    // But an unknown session must not conjure a ghost entry.
    expect(r.setUsage({}, SID, usage)).toEqual({});
  });

  it('lets context usage go down after compaction', () => {
    const s = run(
      (x) => r.appendToken(x, SID, 'hi'),
      (x) => r.setContextUsage(x, SID, { used: 900, limit: 1000 }, 1),
      (x) => r.setContextUsage(x, SID, { used: 100, limit: 1000 }, 2),
    );
    // A max() here would freeze the gauge at the pre-compaction peak.
    expect(r.getStream(s, SID).contextUsage).toMatchObject({ used: 100 });
  });
});

describe('stream reducer — tool call matching', () => {
  it('merges a duplicate tool_start carrying the materialized args', () => {
    // Claude Agent SDK emits tool_start twice for one call.
    const s = run(
      (x) => r.addToolCall(x, SID, 'edit', {}, 'c1'),
      (x) => r.addToolCall(x, SID, 'edit', { path: 'a.ts' }, 'c1'),
    );
    expect(blocks(s)).toHaveLength(1);
    expect(blocks(s)[0]).toMatchObject({ args: { path: 'a.ts' }, status: 'running' });
  });

  it('does not let a duplicate start revive a completed call', () => {
    const s = run(
      (x) => r.addToolCall(x, SID, 'edit', { path: 'a.ts' }, 'c1'),
      (x) => r.completeToolCall(x, SID, 'c1', 'done'),
      (x) => r.addToolCall(x, SID, 'edit', { path: 'a.ts' }, 'c1'),
    );
    expect(blocks(s)[0]).toMatchObject({ status: 'complete' });
  });

  it('completes only the first running call when matching by tool name', () => {
    const s = run(
      (x) => r.addToolCall(x, SID, 'grep', { q: 'a' }, 'c1'),
      (x) => r.addToolCall(x, SID, 'grep', { q: 'b' }, 'c2'),
      (x) => r.completeToolCall(x, SID, 'grep', 'first'),
    );
    const calls = blocks(s).filter((b) => b.type === 'tool_call');
    expect(calls[0]).toMatchObject({ callId: 'c1', status: 'complete', result: 'first' });
    expect(calls[1]).toMatchObject({ callId: 'c2', status: 'running' });
  });
});

describe('stream reducer — plan and question cards', () => {
  const plan = {
    planId: 'p1',
    revision: 1,
    title: 'Refactor',
    summary: 'do it',
    status: 'draft' as const,
    actions: ['approve'],
  };

  it('updates a plan in place across revisions instead of stacking cards', () => {
    const s = run(
      (x) => r.upsertPlan(x, SID, plan),
      (x) => r.upsertPlan(x, SID, { ...plan, revision: 2, title: 'Refactor v2' }),
    );
    expect(blocks(s)).toHaveLength(1);
    expect(blocks(s)[0]).toMatchObject({ revision: 2, title: 'Refactor v2' });
  });

  it('stamps openedAt when a plan starts awaiting review', () => {
    // The timestamp is what stops a poll fired BEFORE the card existed from
    // expiring it — see PlanBlock.openedAt.
    const s = r.upsertPlan({}, SID, { ...plan, status: 'awaiting_review' }, 4_242);
    expect(blocks(s)[0]).toMatchObject({ openedAt: 4_242 });
  });

  it('preserves the first fileName when a later event omits it', () => {
    const s = run(
      (x) => r.upsertPlan(x, SID, { ...plan, fileName: 'plan-1.md' }),
      (x) => r.upsertPlan(x, SID, { ...plan, status: 'awaiting_review' }),
    );
    expect(blocks(s)[0]).toMatchObject({ fileName: 'plan-1.md' });
  });

  it('refuses to expire a question that was already answered', () => {
    const question = {
      interactionId: 'i1',
      questions: [],
      status: 'pending' as const,
    };
    const s = run(
      (x) => r.upsertQuestion(x, SID, question),
      (x) => r.answerQuestion(x, SID, 'i1', { q1: ['yes'] }),
      // A late expiry from a poll that predates the answer.
      (x) => r.expireQuestion(x, SID, 'i1'),
    );
    expect(blocks(s)[0]).toMatchObject({ status: 'answered', answers: { q1: ['yes'] } });
  });
});

describe('stream reducer — providers that never stream tokens', () => {
  it('commits a message_complete answer when the turn produced no text', () => {
    const s = r.appendTokenIfNoText({}, SID, 'All done.');
    expect(r.getStream(s, SID).text).toBe('All done.');
    expect(kinds(s)).toEqual(['text']);
  });

  it('is a no-op once any text block exists, so a streamed answer is never doubled', () => {
    const streamed = r.appendToken({}, SID, 'All done.');
    const s = r.appendTokenIfNoText(streamed, SID, 'All done.');
    expect(s).toBe(streamed);
  });

  it('still commits when the turn produced only tool calls and thinking', () => {
    const s = run(
      (x) => r.appendThinking(x, SID, 'hmm'),
      (x) => r.addToolCall(x, SID, 'read', {}, 'c1'),
      (x) => r.appendTokenIfNoText(x, SID, 'Here is the summary.'),
    );
    expect(kinds(s)).toEqual(['thinking', 'tool_call', 'text']);
  });
});

describe('stream reducer — replayed turn boundaries', () => {
  it('ignores a replayed user_message for the turn already in flight', () => {
    // A gap-fill after a dropped connection re-delivers the user message.
    // Resetting here would erase a turn's tool calls mid-stream.
    const live = run(
      (x) => r.startTurn(x, SID, 'do the thing'),
      (x) => r.addToolCall(x, SID, 'read', {}, 'c1'),
      (x) => r.appendToken(x, SID, 'working'),
    );
    expect(r.startTurn(live, SID, 'do the thing')).toBe(live);
  });

  it('still starts a new turn when the prompt differs', () => {
    const live = run(
      (x) => r.startTurn(x, SID, 'first'),
      (x) => r.appendToken(x, SID, 'working'),
    );
    const next = r.startTurn(live, SID, 'second');
    expect(r.getStream(next, SID).turnUserMessage).toBe('second');
    expect(blocks(next)).toEqual([]);
  });

  it('starts a turn normally when nothing is in flight', () => {
    const s = r.startTurn({}, SID, 'hello');
    expect(r.getStream(s, SID).status).toBe('pending');
  });
});

describe('stream reducer — referential stability', () => {
  // The Zustand adapter skips the update when the record is returned
  // unchanged, so identity is load-bearing for render performance.
  it('returns the identical record for no-op operations', () => {
    const s: StreamsRecord = { [SID]: { ...DEFAULT_STREAM } };

    expect(r.appendToken(s, SID, '')).toBe(s);
    expect(r.addSystemMessage(s, SID, '')).toBe(s);
    expect(r.setUsage({}, SID, { model: 'm', inputTokens: 0, outputTokens: 0 })).toEqual({});
    expect(r.updateWidgetState(s, SID, 'missing', {})).toBe(s);
    expect(r.setPlanStatus(s, SID, 'missing', 'draft')).toBe(s);
    expect(r.expireQuestion(s, SID, 'missing')).toBe(s);
    expect(r.setServerTurnId({ [SID]: { ...DEFAULT_STREAM, serverTurnId: 't' } }, SID, 't')).toEqual(
      { [SID]: { ...DEFAULT_STREAM, serverTurnId: 't' } },
    );
  });

  it('never mutates the record it was given', () => {
    const original: StreamsRecord = { [SID]: { ...DEFAULT_STREAM } };
    const snapshot = JSON.stringify(original);
    r.appendToken(original, SID, 'x');
    r.addToolCall(original, SID, 't', {}, 'c1');
    r.startPending(original, SID, 'q');
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('stream reducer — inline tool calls', () => {
  it('rebuilds text blocks into text + tool_call while keeping other blocks', () => {
    const content =
      'before\n<function_calls>\n<invoke name="read_file">\n<parameter name="path">a.ts</parameter>\n</invoke>\n</function_calls>\nafter';

    const s = run(
      (x) => r.appendThinking(x, SID, 'hmm'),
      (x) => r.appendToken(x, SID, 'raw stream text'),
      (x) => r.processInlineToolCalls(x, SID, content),
    );

    // Thinking survives; the raw text block is replaced by structure.
    expect(kinds(s)[0]).toBe('thinking');
    expect(kinds(s)).toContain('tool_call');
    expect(r.getStream(s, SID).toolCalls.some((t) => t.tool === 'read_file')).toBe(true);
  });

  it('leaves the record untouched when there is nothing to parse', () => {
    const s: StreamsRecord = { [SID]: { ...DEFAULT_STREAM } };
    expect(r.processInlineToolCalls(s, SID, 'just prose')).toBe(s);
  });
});
