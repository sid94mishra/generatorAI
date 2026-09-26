// ────────────────────────────────────────────────────────────────
// replayEvents tests — event replay into stream store
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { useStreamStore } from '@/stores/streamStore.js';
import { replayEventsIntoStore } from '@/utils/replayEvents.js';
import type { PersistedEvent } from '@generatorai/shared';

/** Helper to create a persisted event */
function makeEvent(kind: string, data: Record<string, unknown> = {}, seq = 0): PersistedEvent {
  return {
    id: seq,
    sessionId: 's1',
    sequenceId: seq,
    kind: kind as PersistedEvent['kind'],
    data,
    timestamp: Date.now(),
  };
}

describe('replayEventsIntoStore', () => {
  beforeEach(() => {
    useStreamStore.setState({ streams: {} });
  });

  it('reconstructs text blocks from token events', () => {
    const events = [
      makeEvent('harness.token', { text: 'Hello ' }, 1),
      makeEvent('harness.token', { text: 'world' }, 2),
      makeEvent('harness.message_complete', { content: 'Hello world' }, 3),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream).toBeDefined();
    expect(stream?.text).toBe('Hello world');
    expect(stream?.status).toBe('complete');
    expect(stream?.blocks.length).toBe(1);
    expect(stream?.blocks[0]?.type).toBe('text');
  });

  it('reconstructs thinking blocks from reasoning events', () => {
    const events = [
      makeEvent('harness.reasoning_delta', { text: 'Let me ' }, 1),
      makeEvent('harness.reasoning_delta', { text: 'think...' }, 2),
      makeEvent('harness.reasoning_complete', {}, 3),
      makeEvent('harness.token', { text: 'Answer' }, 4),
      makeEvent('harness.message_complete', { content: 'Answer' }, 5),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.thinkingText).toBe('Let me think...');
    expect(stream?.blocks.length).toBe(2); // thinking + text
    expect(stream?.blocks[0]?.type).toBe('thinking');
    expect(stream?.blocks[1]?.type).toBe('text');
    if (stream?.blocks[0]?.type === 'thinking') {
      expect(stream.blocks[0].text).toBe('Let me think...');
      expect(stream.blocks[0].isComplete).toBe(true);
    }
  });

  it('reconstructs tool call blocks', () => {
    const events = [
      makeEvent('harness.token', { text: 'Searching...' }, 1),
      makeEvent('harness.tool_start', { tool: 'search', args: { q: 'test' }, callId: 'tc-1' }, 2),
      makeEvent('harness.tool_complete', { tool: 'search', callId: 'tc-1', result: 'found 3' }, 3),
      makeEvent('harness.token', { text: ' Done!' }, 4),
      makeEvent('harness.message_complete', {}, 5),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.blocks.length).toBe(3); // text + tool_call + text
    expect(stream?.blocks[0]?.type).toBe('text');
    expect(stream?.blocks[1]?.type).toBe('tool_call');
    expect(stream?.blocks[2]?.type).toBe('text');
    if (stream?.blocks[1]?.type === 'tool_call') {
      expect(stream.blocks[1].tool).toBe('search');
      expect(stream.blocks[1].callId).toBe('tc-1');
      expect(stream.blocks[1].status).toBe('complete');
      expect(stream.blocks[1].result).toBe('found 3');
    }
  });

  it('reconstructs system messages', () => {
    const events = [
      makeEvent('harness.token', { text: 'Working...' }, 1),
      makeEvent('git.clone_start', { repoUrl: 'https://github.com/test/repo' }, 2),
      makeEvent('git.clone_complete', { localPath: '/tmp/repo' }, 3),
      makeEvent('harness.message_complete', {}, 4),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.blocks.length).toBe(3); // text + system + system
    expect(stream?.blocks[1]?.type).toBe('system');
    expect(stream?.blocks[2]?.type).toBe('system');
    expect(stream?.systemMessages.length).toBe(2);
  });

  it('only shows last turn blocks in multi-turn conversation', () => {
    const events = [
      // Turn 1
      makeEvent('harness.token', { text: 'First response' }, 1),
      makeEvent('harness.tool_start', { tool: 'search', args: {}, callId: 'tc-1' }, 2),
      makeEvent('harness.tool_complete', { callId: 'tc-1', result: 'ok' }, 3),
      makeEvent('harness.message_complete', { content: 'First response' }, 4),
      // User sends another message
      makeEvent('harness.user_message', { content: 'Follow up' }, 5),
      // Turn 2
      makeEvent('harness.reasoning_delta', { text: 'Thinking...' }, 6),
      makeEvent('harness.reasoning_complete', {}, 7),
      makeEvent('harness.token', { text: 'Second response' }, 8),
      makeEvent('harness.message_complete', { content: 'Second response' }, 9),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    // Only turn 2 blocks should survive (turn 1 was cleared by user_message)
    expect(stream?.text).toBe('Second response');
    expect(stream?.thinkingText).toBe('Thinking...');
    expect(stream?.blocks.length).toBe(2); // thinking + text
    expect(stream?.blocks[0]?.type).toBe('thinking');
    expect(stream?.blocks[1]?.type).toBe('text');
    // Turn 1's tool call should NOT be present
    expect(stream?.toolCalls.length).toBe(0);
  });

  it('handles empty events array gracefully', () => {
    replayEventsIntoStore('s1', []);

    const stream = useStreamStore.getState().streams['s1'];
    // Stream should be cleared (from clearStream at start of replay)
    expect(stream?.status).toBe('idle');
    expect(stream?.blocks.length).toBe(0);
  });

  it('leaves stream as streaming when no message_complete or idle (session may still be active)', () => {
    const events = [
      makeEvent('harness.token', { text: 'Hello' }, 1),
      // No explicit message_complete or idle — session may still be streaming
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    // Without message_complete or idle, the session might still be actively
    // streaming (e.g. page refresh mid-turn), so it stays as 'streaming'.
    expect(stream?.status).toBe('streaming');
    expect(stream?.text).toBe('Hello');
  });

  it('reconstructs error state correctly', () => {
    const events = [
      makeEvent('harness.token', { text: 'Partial...' }, 1),
      makeEvent('harness.error', { message: 'Something went wrong' }, 2),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.blocks.length).toBe(2); // text + system(error)
    expect(stream?.blocks[0]?.type).toBe('text');
    expect(stream?.blocks[1]?.type).toBe('system');
    if (stream?.blocks[1]?.type === 'system') {
      expect(stream.blocks[1].category).toBe('error');
    }
  });

  it('reconstructs full multi-phase response (thinking → tool → text)', () => {
    const events = [
      makeEvent('harness.reasoning_delta', { text: 'Planning...' }, 1),
      makeEvent('harness.reasoning_complete', {}, 2),
      makeEvent('harness.tool_start', { tool: 'readFile', args: { path: 'a.ts' }, callId: 'tc-1' }, 3),
      makeEvent('harness.tool_complete', { callId: 'tc-1', result: 'file content' }, 4),
      makeEvent('harness.tool_start', { tool: 'search', args: { q: 'test' }, callId: 'tc-2' }, 5),
      makeEvent('harness.tool_complete', { callId: 'tc-2', result: '3 matches' }, 6),
      makeEvent('harness.token', { text: 'Based on analysis...' }, 7),
      makeEvent('artifact.created', { name: 'output.json' }, 8),
      makeEvent('harness.message_complete', {}, 9),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.status).toBe('complete');
    expect(stream?.blocks.map(b => b.type)).toEqual([
      'thinking', 'tool_call', 'tool_call', 'text', 'system',
    ]);
    expect(stream?.thinkingText).toBe('Planning...');
    expect(stream?.toolCalls.length).toBe(2);
    expect(stream?.text).toBe('Based on analysis...');
    expect(stream?.systemMessages.length).toBe(1);
  });

  it('handles hook events as system messages', () => {
    const events = [
      makeEvent('hook.started', { hookName: 'pre-build', phase: 'before' }, 1),
      makeEvent('hook.completed', { hookName: 'pre-build' }, 2),
      makeEvent('harness.token', { text: 'Done' }, 3),
      makeEvent('harness.message_complete', {}, 4),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.blocks.length).toBe(3); // system + system + text
    expect(stream?.blocks[0]?.type).toBe('system');
    expect(stream?.blocks[1]?.type).toBe('system');
    expect(stream?.blocks[2]?.type).toBe('text');
  });

  it('clears stream for fully-completed turn (copilot.idle) so chatHistory is sole source', () => {
    const events = [
      makeEvent('harness.token', { text: 'Hello' }, 1),
      makeEvent('harness.message_complete', { content: 'Hello' }, 2),
      makeEvent('harness.idle', {}, 3),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    // After copilot.idle the end-of-replay logic calls clearStream so
    // chatHistory (the persisted messages) becomes the single source of truth.
    // The stream is deliberately idle — ChatView renders chatHistory instead.
    expect(stream?.status).toBe('idle');
    expect(stream?.blocks.length).toBe(0);
  });

  it('clears stream after full multi-phase response ending in idle', () => {
    // Simulates a mid-turn tool call: message_complete fires, then tool call, then more tokens
    const events = [
      makeEvent('harness.token', { text: 'Searching...' }, 1),
      makeEvent('harness.message_complete', {}, 2),
      makeEvent('harness.tool_start', { tool: 'search', args: { q: 'test' }, callId: 'tc-1' }, 3),
      makeEvent('harness.tool_complete', { callId: 'tc-1', result: 'found' }, 4),
      makeEvent('harness.token', { text: ' Found it!' }, 5),
      makeEvent('harness.message_complete', {}, 6),
      makeEvent('harness.idle', {}, 7),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    // copilot.idle triggers end-of-replay clearStream — chatHistory is
    // the data source for completed turns.
    expect(stream?.status).toBe('idle');
    expect(stream?.blocks.length).toBe(0);
  });

  it('multi-turn replay only keeps last turn and tracks completion correctly', () => {
    const events = [
      // Turn 1 — with idle
      makeEvent('harness.token', { text: 'First' }, 1),
      makeEvent('harness.message_complete', {}, 2),
      makeEvent('harness.idle', {}, 3),
      // Turn 2 — active (no idle)
      makeEvent('harness.user_message', { content: 'Follow up' }, 4),
      makeEvent('harness.token', { text: 'Still going' }, 5),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    // Turn 2 is still active — no idle or message_complete in this turn
    expect(stream?.status).toBe('streaming');
    expect(stream?.text).toBe('Still going');
  });

  it('ignores empty token text during replay', () => {
    const events = [
      makeEvent('harness.token', { text: '' }, 1),
      makeEvent('harness.token', { text: 'Hello' }, 2),
      makeEvent('harness.token', { text: '' }, 3),
      makeEvent('harness.message_complete', { content: 'Hello' }, 4),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.text).toBe('Hello');
    expect(stream?.blocks.length).toBe(1);
    expect(stream?.blocks[0]?.type).toBe('text');
  });

  it('ignores empty reasoning text during replay', () => {
    const events = [
      makeEvent('harness.reasoning_delta', { text: '' }, 1),
      makeEvent('harness.reasoning_delta', { text: 'Think' }, 2),
      makeEvent('harness.reasoning_complete', {}, 3),
      makeEvent('harness.token', { text: 'Answer' }, 4),
      makeEvent('harness.message_complete', { content: 'Answer' }, 5),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.thinkingText).toBe('Think');
    expect(stream?.blocks.length).toBe(2); // thinking + text
  });

  it('fast-path: skips replay for completed interactive session (idle after user_message)', () => {
    const events = [
      // Turn 1
      makeEvent('harness.user_message', { content: 'Hello' }, 1),
      makeEvent('harness.token', { text: 'Hi there!' }, 2),
      makeEvent('harness.message_complete', { content: 'Hi there!' }, 3),
      makeEvent('harness.idle', {}, 4),
      // Metadata events that arrive after idle
      makeEvent('session.completed', {}, 5),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    // Fast-path detects completed session (idle > user_message) and skips replay.
    // Stream stays cleared — chatHistory is the sole data source.
    expect(stream?.status).toBe('idle');
    expect(stream?.blocks.length).toBe(0);
    expect(stream?.text).toBe('');
  });

  it('fast-path: skips replay for multi-turn completed session', () => {
    const events = [
      // Turn 1
      makeEvent('harness.user_message', { content: 'First question' }, 1),
      makeEvent('harness.token', { text: 'First answer' }, 2),
      makeEvent('harness.message_complete', { content: 'First answer' }, 3),
      makeEvent('harness.idle', {}, 4),
      // Turn 2
      makeEvent('harness.user_message', { content: 'Second question' }, 5),
      makeEvent('harness.token', { text: 'Second answer' }, 6),
      makeEvent('harness.message_complete', { content: 'Second answer' }, 7),
      makeEvent('harness.idle', {}, 8),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    // All turns completed — fast-path clears stream, chatHistory has everything.
    expect(stream?.status).toBe('idle');
    expect(stream?.blocks.length).toBe(0);
  });

  it('no fast-path: replays last turn when session is mid-stream', () => {
    const events = [
      // Turn 1 — completed
      makeEvent('harness.user_message', { content: 'First question' }, 1),
      makeEvent('harness.token', { text: 'First answer' }, 2),
      makeEvent('harness.message_complete', { content: 'First answer' }, 3),
      makeEvent('harness.idle', {}, 4),
      // Turn 2 — still streaming (no idle)
      makeEvent('harness.user_message', { content: 'Second question' }, 5),
      makeEvent('harness.reasoning_delta', { text: 'Thinking...' }, 6),
      makeEvent('harness.reasoning_complete', {}, 7),
      makeEvent('harness.token', { text: 'Partial response' }, 8),
    ];

    replayEventsIntoStore('s1', events);

    const stream = useStreamStore.getState().streams['s1'];
    // Last turn is still active — replay builds stream blocks for it.
    expect(stream?.status).toBe('streaming');
    expect(stream?.text).toBe('Partial response');
    expect(stream?.thinkingText).toBe('Thinking...');
    expect(stream?.turnUserMessage).toBe('Second question');
    // Only last turn's blocks exist (turn 1 was discarded by startPending)
    expect(stream?.blocks.length).toBe(2); // thinking + text
  });

  describe('orchestrator workers still running at page load', () => {
    const workerEvents = (lastStatus: string) => [
      makeEvent('harness.user_message', { content: 'spawn two workers' }, 1),
      makeEvent('harness.token', { text: 'spawned' }, 2),
      makeEvent('chat.background_task.spawned', { chatId: 'c1', taskId: 'w-live', taskName: 'readme', model: 'sonnet' }, 3),
      makeEvent('chat.background_task.spawned', { chatId: 'c1', taskId: 'w-done', taskName: 'changelog' }, 4),
      makeEvent('harness.message_complete', { content: 'spawned' }, 5),
      makeEvent('harness.idle', {}, 6),
      makeEvent('chat.background_task.progress', { chatId: 'c1', taskId: 'w-live', status: 'running', currentStep: 'Edit', toolCalls: 4, startedAt: 10 }, 7),
      makeEvent('chat.background_task.progress', { chatId: 'c1', taskId: 'w-done', status: 'running', currentStep: 'Bash', toolCalls: 2, startedAt: 11 }, 8),
      makeEvent('chat.background_task.' + (lastStatus === 'completed' ? 'completed' : 'status'), { chatId: 'c1', taskId: 'w-done', status: lastStatus, summary: 'done' }, 9),
    ];

    it('rebuilds one row per live worker after a completed turn (the fast path)', () => {
      replayEventsIntoStore('s1', workerEvents('completed'));
      const stream = useStreamStore.getState().streams['s1'];
      const tasks = (stream?.blocks ?? []).filter((b) => b.type === 'background_task');
      expect(tasks).toEqual([
        expect.objectContaining({ taskId: 'w-live', taskName: 'readme', model: 'sonnet', status: 'running', currentStep: 'Edit', toolCalls: 4 }),
      ]);
      // Renders (not idle) without looking like a turn in progress.
      expect(stream?.status).toBe('complete');
    });

    it('leaves a worker out once it has settled, whatever the terminal status', () => {
      replayEventsIntoStore('s1', workerEvents('cancelled'));
      const tasks = (useStreamStore.getState().streams['s1']?.blocks ?? []).filter((b) => b.type === 'background_task');
      expect(tasks.map((b) => (b as { taskId: string }).taskId)).toEqual(['w-live']);
    });

    it('rebuilds live workers even when the orchestrator turn is still open', () => {
      const events = workerEvents('completed').filter((e) => e.kind !== 'harness.idle' && e.kind !== 'harness.message_complete');
      replayEventsIntoStore('s1', events);
      const tasks = (useStreamStore.getState().streams['s1']?.blocks ?? []).filter((b) => b.type === 'background_task');
      expect(tasks.map((b) => (b as { taskId: string }).taskId)).toEqual(['w-live']);
    });
  });

  it('rebuilds stage gate cards and operator bubbles; a gate ended by a later lifecycle event is not pending', () => {
    const perm = (interactionId: string) => ({
      stageRunId: 'sr1', workflowRunId: 'run-1', interactionId, toolName: 'Bash', type: 'shell',
      description: 'rm', inputSummary: 'rm -rf', permissionMode: 'default',
    });
    replayEventsIntoStore('s1', [
      makeEvent('stage_run.running', { stageRunId: 'sr1', workflowRunId: 'run-1' }, 1),
      makeEvent('stage_run.operator_message', { stageRunId: 'sr1', workflowRunId: 'run-1', content: 'hi' }, 2),
      // Asked before a crash: the resume re-asks under a new id.
      makeEvent('stage.permission.requested', perm('old'), 3),
      makeEvent('stage_run.paused', { stageRunId: 'sr1', workflowRunId: 'run-1' }, 4),
      makeEvent('stage_run.resumed', { stageRunId: 'sr1', workflowRunId: 'run-1' }, 5),
      makeEvent('stage.permission.requested', perm('new'), 6),
    ]);
    const blocks = useStreamStore.getState().streams['stageRun:sr1']?.blocks ?? [];
    expect(blocks.some((b) => b.type === 'system' && (b as { category?: string }).category === 'operator')).toBe(true);
    const cards = blocks.filter((b) => b.type === 'permission') as Array<{ interactionId: string; status: string }>;
    expect(cards.map((c) => [c.interactionId, c.status])).toEqual([['old', 'expired'], ['new', 'pending']]);
  });
});
