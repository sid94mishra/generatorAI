// ────────────────────────────────────────────────────────────────
// Orchestrator background workers in the transcript.
//
// The `chat.background_task.*` family is emitted on the PARENT chat's scope
// and used to do nothing but invalidate a REST query — so an orchestrator's
// own transcript showed a spawn tool call and then silence for minutes.
// These tests pin the whole pipeline: router → effects → one
// `background_task` block per worker, nested under the spawn call that
// created it.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { StreamEventRouter, applyStreamEffects } from '../index.js';
import { clearStream } from '../stream/reducer.js';
import type { StreamsRecord, BackgroundTaskBlock } from '../stream/types.js';

const KEY = 'sess-parent';

function route(router: StreamEventRouter, kind: string, data: Record<string, unknown>) {
  return router.handle(KEY, { kind, data } as never);
}

function tasksOf(streams: StreamsRecord): BackgroundTaskBlock[] {
  return (streams[KEY]?.blocks ?? []).filter(
    (b): b is BackgroundTaskBlock => b.type === 'background_task',
  );
}

/** Drive a spawn tool call so the router learns the nesting anchor. */
function spawn(router: StreamEventRouter, streams: StreamsRecord, opts: {
  callId: string;
  taskName: string;
  taskId: string;
  complete?: boolean;
}): StreamsRecord {
  let next = applyStreamEffects(streams, route(router, 'harness.tool_start', {
    tool: 'spawn_background_agent',
    args: { taskName: opts.taskName, objective: 'do the thing' },
    callId: opts.callId,
  }));
  if (opts.complete !== false) {
    next = applyStreamEffects(next, route(router, 'harness.tool_complete', {
      tool: 'spawn_background_agent',
      callId: opts.callId,
      result: { ok: true, taskId: opts.taskId, taskName: opts.taskName, status: 'running' },
      success: true,
    }));
  }
  return next;
}

describe('chat.background_task.* → background_task blocks', () => {
  it('creates one block per worker and nests it under the spawn call', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = {};

    streams = spawn(router, streams, { callId: 'call-1', taskName: 'research', taskId: 'chat-w1' });
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.spawned', {
      chatId: 'chat-parent',
      parentChatId: 'chat-parent',
      taskId: 'chat-w1',
      taskName: 'research',
      model: 'gpt-5.6-terra',
    }));

    const tasks = tasksOf(streams);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      taskId: 'chat-w1',
      taskName: 'research',
      model: 'gpt-5.6-terra',
      // Pre-first-event state, distinct from `running` so the live counters
      // can report it as "pending".
      status: 'spawned',
      parentCallId: 'call-1',
    });
  });

  it('nests from the tool_start args alone — the spawned event precedes tool_complete', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = {};
    // No tool_complete: on the wire the spawn handler emits `spawned` BEFORE
    // it returns, so taskName from the args is the only anchor available.
    streams = spawn(router, streams, {
      callId: 'call-9', taskName: 'audit', taskId: 'chat-w9', complete: false,
    });
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.spawned', {
      taskId: 'chat-w9',
      taskName: 'audit',
    }));
    expect(tasksOf(streams)[0]?.parentCallId).toBe('call-9');
  });

  it('falls back to a top-level step when the spawn call is outside the window', () => {
    const router = new StreamEventRouter();
    const streams = applyStreamEffects({}, route(router, 'chat.background_task.spawned', {
      taskId: 'chat-orphan',
      taskName: 'orphan',
    }));
    const task = tasksOf(streams)[0];
    expect(task).toBeDefined();
    expect(task?.parentCallId).toBeUndefined();
  });

  it('merges progress into the existing block instead of appending another', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = {};
    streams = spawn(router, streams, { callId: 'c1', taskName: 'build', taskId: 'w1' });
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.spawned', {
      taskId: 'w1', taskName: 'build', model: 'sonnet',
    }));
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.progress', {
      taskId: 'w1',
      taskName: 'build',
      status: 'running',
      currentStep: 'Bash',
      lastText: 'running the test suite',
      toolCalls: 3,
      startedAt: 1_700_000_000_000,
    }));

    const tasks = tasksOf(streams);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      status: 'running',
      currentStep: 'Bash',
      lastText: 'running the test suite',
      toolCalls: 3,
      startedAt: 1_700_000_000_000,
      // Carried forward: the progress event does not mention the model.
      model: 'sonnet',
    });
  });

  it('settles the block on completion and drops the live step line', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = {};
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.spawned', {
      taskId: 'w2', taskName: 'docs',
    }));
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.progress', {
      taskId: 'w2', taskName: 'docs', status: 'running', currentStep: 'writing', toolCalls: 1, startedAt: 1,
    }));
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.completed', {
      taskId: 'w2', taskName: 'docs', status: 'needs_review', summary: 'wrote the doc',
    }));

    const task = tasksOf(streams)[0]!;
    expect(task.status).toBe('needs_review');
    expect(task.summary).toBe('wrote the doc');
    expect(task.currentStep).toBeUndefined();
    expect(task.endedAt).toBeGreaterThan(0);
  });

  it('marks a failed worker failed and keeps the error as the summary', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = {};
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.spawned', {
      taskId: 'w3', taskName: 'flaky',
    }));
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.failed', {
      taskId: 'w3', taskName: 'flaky', error: 'worker timed out',
    }));
    expect(tasksOf(streams)[0]).toMatchObject({ status: 'failed', summary: 'worker timed out' });
  });

  it('still invalidates the tasks query for every kind', () => {
    const router = new StreamEventRouter();
    for (const kind of [
      'chat.background_task.spawned',
      'chat.background_task.status',
      'chat.background_task.progress',
      'chat.background_task.completed',
      'chat.background_task.failed',
    ]) {
      const effects = route(router, kind, { chatId: 'chat-parent', taskId: 't', taskName: 't' });
      expect(effects.some((e) => e.op === 'invalidate' && e.resource === 'tasks')).toBe(true);
    }
  });

  it('a repeated status event is a no-op update', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = applyStreamEffects({}, route(router, 'chat.background_task.spawned', {
      taskId: 'w4', taskName: 'same',
    }));
    const before = streams;
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.status', {
      taskId: 'w4', taskName: 'same', status: 'spawned',
    }));
    expect(streams).toBe(before);
  });

  it('ignores a worker turn marked internal', () => {
    const router = new StreamEventRouter();
    const streams = applyStreamEffects({}, route(router, 'chat.background_task.progress', {
      taskId: 'w5', taskName: 'x', status: 'running', toolCalls: 0, startedAt: 1,
      __isInternalTurn: true,
    }));
    expect(tasksOf(streams)).toHaveLength(0);
  });
});

describe('sub-agent progress notes', () => {
  it('throttles subagent_progress but never a state change', () => {
    const router = new StreamEventRouter();
    const notes = (kind: string, infoType: string, message: string) =>
      route(router, kind, { infoType, message }).filter((e) => e.op === 'addSystemMessage');

    expect(notes('harness.session_info', 'subagent_started', 'Sub-agent started: explore')).toHaveLength(1);
    expect(notes('harness.session_info', 'subagent_progress', 'reading files')).toHaveLength(1);
    // Second progress inside the window is dropped…
    expect(notes('harness.session_info', 'subagent_progress', 'still reading')).toHaveLength(0);
    // …but the completion is not.
    expect(notes('harness.session_info', 'subagent_completed', 'Sub-agent completed: explore')).toHaveLength(1);
  });

  it('a worker row appearing on an idle orchestrator does not make it look busy', () => {
    const router = new StreamEventRouter();
    // A page reload, or the transcript cleanup after the spawning turn: the
    // stream is idle (or complete) and the worker's next progress event
    // re-creates its row.
    let streams: StreamsRecord = {};
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.progress', {
      chatId: 'chat-parent', taskId: 'chat-w1', taskName: 'research', status: 'running', currentStep: 'Read', toolCalls: 3, startedAt: 1,
    }));
    expect(tasksOf(streams)).toHaveLength(1);
    // Non-idle so the row renders; not `streaming`, which would disable the
    // composer and show Stop for a turn that is not running.
    expect(streams[KEY]?.status).toBe('complete');
  });

  it('a worker row appearing mid-turn leaves the turn streaming', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = {};
    streams = spawn(router, streams, { callId: 'call-1', taskName: 'research', taskId: 'chat-w1' });
    expect(streams[KEY]?.status).toBe('streaming');
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.spawned', {
      chatId: 'chat-parent', taskId: 'chat-w1', taskName: 'research',
    }));
    expect(streams[KEY]?.status).toBe('streaming');
  });

  it('clearStream keeps workers that are still running and drops settled ones', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = {};
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.progress', {
      chatId: 'chat-parent', taskId: 'chat-live', taskName: 'live', status: 'running', toolCalls: 1, startedAt: 1,
    }));
    streams = applyStreamEffects(streams, route(router, 'chat.background_task.completed', {
      chatId: 'chat-parent', taskId: 'chat-done', taskName: 'done', status: 'completed', summary: 'ok',
    }));
    streams = clearStream(streams, KEY);
    expect(tasksOf(streams).map((t) => t.taskId)).toEqual(['chat-live']);
  });
});
