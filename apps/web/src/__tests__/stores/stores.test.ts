// ────────────────────────────────────────────────────────────────
// Zustand Store tests — streamStore & connectionStore
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { useStreamStore } from '@/stores/streamStore.js';
import { useConnectionStore } from '@/stores/connectionStore.js';

describe('streamStore', () => {
  beforeEach(() => {
    useStreamStore.setState({ streams: {} });
  });

  it('appendToken creates stream and appends text', () => {
    useStreamStore.getState().appendToken('s1', 'Hello');
    useStreamStore.getState().appendToken('s1', ' world');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.text).toBe('Hello world');
    expect(stream?.status).toBe('streaming');
  });

  it('appendThinking sets thinking status', () => {
    useStreamStore.getState().appendThinking('s1', 'thinking...');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.thinkingText).toBe('thinking...');
    expect(stream?.status).toBe('thinking');
  });

  it('completeThinking transitions from thinking to streaming', () => {
    useStreamStore.getState().appendThinking('s1', 'think');
    useStreamStore.getState().completeThinking('s1');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.status).toBe('streaming');
  });

  it('addToolCall records a tool call', () => {
    useStreamStore.getState().addToolCall('s1', 'search', { query: 'test' });
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.toolCalls?.length).toBe(1);
    expect(stream?.toolCalls?.[0]?.tool).toBe('search');
    expect(stream?.toolCalls?.[0]?.status).toBe('running');
  });

  it('completeToolCall marks tool call as complete', () => {
    useStreamStore.getState().addToolCall('s1', 'search', {});
    useStreamStore.getState().completeToolCall('s1', 'search', { matches: 3 });
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.toolCalls?.[0]?.status).toBe('complete');
    expect(stream?.toolCalls?.[0]?.result).toEqual({ matches: 3 });
  });

  it('addSystemMessage stores system messages', () => {
    useStreamStore.getState().addSystemMessage('s1', 'Cloning repo...');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.systemMessages?.length).toBe(1);
    expect(stream?.systemMessages?.[0]).toBe('Cloning repo...');
  });

  it('completeStream sets status to complete', () => {
    useStreamStore.getState().appendToken('s1', 'data');
    useStreamStore.getState().completeStream('s1');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.status).toBe('complete');
  });

  it('errorStream sets status to error', () => {
    useStreamStore.getState().appendToken('s1', 'data');
    useStreamStore.getState().errorStream('s1');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.status).toBe('error');
  });

  it('clearStream resets stream state for a session', () => {
    useStreamStore.getState().appendToken('s1', 'data');
    useStreamStore.getState().clearStream('s1');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.text).toBe('');
    expect(stream?.status).toBe('idle');
  });

  it('isolates streams for different sessions', () => {
    useStreamStore.getState().appendToken('s1', 'A');
    useStreamStore.getState().appendToken('s2', 'B');
    expect(useStreamStore.getState().streams['s1']?.text).toBe('A');
    expect(useStreamStore.getState().streams['s2']?.text).toBe('B');
  });

  // ── Blocks-based temporal ordering tests ──

  it('maintains ordered blocks for tokens and tool calls', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'Hello ');
    store.addToolCall('s1', 'search', { q: 'test' });
    store.appendToken('s1', 'result ');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.blocks.length).toBe(3);
    expect(stream?.blocks[0]?.type).toBe('text');
    expect(stream?.blocks[1]?.type).toBe('tool_call');
    expect(stream?.blocks[2]?.type).toBe('text');
  });

  it('groups consecutive thinking tokens into one block', () => {
    const store = useStreamStore.getState();
    store.appendThinking('s1', 'think');
    store.appendThinking('s1', 'ing...');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.blocks.length).toBe(1);
    expect(stream?.blocks[0]?.type).toBe('thinking');
    if (stream?.blocks[0]?.type === 'thinking') {
      expect(stream.blocks[0].text).toBe('thinking...');
    }
  });

  it('completeToolCall matches by callId', () => {
    const store = useStreamStore.getState();
    store.addToolCall('s1', 'readFile', { path: 'a.ts' }, 'call-1');
    store.addToolCall('s1', 'readFile', { path: 'b.ts' }, 'call-2');
    store.completeToolCall('s1', 'call-2', 'file B content');
    const stream = useStreamStore.getState().streams['s1'];
    // First readFile still running, second completed
    expect(stream?.toolCalls[0]?.status).toBe('running');
    expect(stream?.toolCalls[1]?.status).toBe('complete');
    expect(stream?.toolCalls[1]?.result).toBe('file B content');
  });

  it('addSystemMessage creates system blocks with category', () => {
    const store = useStreamStore.getState();
    store.addSystemMessage('s1', 'Cloning repo...', 'system');
    store.addSystemMessage('s1', 'Subagent started', 'subagent');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.blocks.length).toBe(2);
    if (stream?.blocks[0]?.type === 'system') {
      expect(stream.blocks[0].category).toBe('system');
    }
    if (stream?.blocks[1]?.type === 'system') {
      expect(stream.blocks[1].category).toBe('subagent');
    }
  });

  it('clearStream resets blocks and counters', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'data');
    store.addToolCall('s1', 'search', {});
    store.clearStream('s1');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.blocks.length).toBe(0);
    expect(stream?.text).toBe('');
    expect(stream?.status).toBe('idle');
  });

  // ── Block persistence and lifecycle tests ──

  it('blocks persist after completeStream (no auto-clear)', () => {
    const store = useStreamStore.getState();
    store.appendThinking('s1', 'reasoning...');
    store.completeThinking('s1');
    store.addToolCall('s1', 'search', { q: 'test' }, 'tc-1');
    store.completeToolCall('s1', 'tc-1', { matches: 5 });
    store.appendToken('s1', 'Here are the results');
    store.addSystemMessage('s1', 'Operation complete');
    store.completeStream('s1');

    const stream = useStreamStore.getState().streams['s1'];
    // All blocks should persist after completeStream
    expect(stream?.status).toBe('complete');
    expect(stream?.blocks.length).toBe(4); // thinking + tool_call + text + system
    expect(stream?.blocks[0]?.type).toBe('thinking');
    expect(stream?.blocks[1]?.type).toBe('tool_call');
    expect(stream?.blocks[2]?.type).toBe('text');
    expect(stream?.blocks[3]?.type).toBe('system');
    // Flat fields also preserved
    expect(stream?.thinkingText).toBe('reasoning...');
    expect(stream?.text).toBe('Here are the results');
    expect(stream?.toolCalls.length).toBe(1);
    expect(stream?.systemMessages.length).toBe(1);
  });

  it('startPending clears all blocks and resets state', () => {
    const store = useStreamStore.getState();
    store.appendThinking('s1', 'thinking');
    store.addToolCall('s1', 'search', {});
    store.appendToken('s1', 'response');
    store.completeStream('s1');
    // Verify blocks exist
    expect(useStreamStore.getState().streams['s1']?.blocks.length).toBe(3);

    // startPending should wipe everything for the new turn
    store.startPending('s1');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.status).toBe('pending');
    expect(stream?.blocks.length).toBe(0);
    expect(stream?.text).toBe('');
    expect(stream?.thinkingText).toBe('');
    expect(stream?.toolCalls.length).toBe(0);
    expect(stream?.systemMessages.length).toBe(0);
  });

  it('maintains temporal order through multi-phase response', () => {
    const store = useStreamStore.getState();
    // Phase 1: thinking
    store.appendThinking('s1', 'Let me search...');
    store.completeThinking('s1');
    // Phase 2: tool call
    store.addToolCall('s1', 'searchCode', { q: 'test' }, 'tc-1');
    store.completeToolCall('s1', 'tc-1', 'found 3 matches');
    // Phase 3: more thinking
    store.appendThinking('s1', 'Now analyzing...');
    store.completeThinking('s1');
    // Phase 4: another tool call
    store.addToolCall('s1', 'readFile', { path: 'a.ts' }, 'tc-2');
    store.completeToolCall('s1', 'tc-2', 'file content');
    // Phase 5: response text
    store.appendToken('s1', 'Based on my analysis...');
    // Phase 6: system message
    store.addSystemMessage('s1', 'Operation logged');

    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.blocks.length).toBe(6);
    expect(stream?.blocks.map(b => b.type)).toEqual([
      'thinking', 'tool_call', 'thinking', 'tool_call', 'text', 'system',
    ]);
  });

  it('getStream returns frozen default for unknown sessions', () => {
    const stream = useStreamStore.getState().getStream('nonexistent');
    expect(stream.status).toBe('idle');
    expect(stream.blocks.length).toBe(0);
    // Should not throw when reading properties
    expect(stream.text).toBe('');
    expect(stream.thinkingText).toBe('');
  });

  it('completeStream does not overwrite pending status', () => {
    const store = useStreamStore.getState();
    // Simulate: stream was active, then user sent next message (pending)
    store.appendToken('s1', 'response');
    store.startPending('s1');
    expect(useStreamStore.getState().streams['s1']?.status).toBe('pending');

    // A stale completeStream arrives (e.g., late copilot.idle from previous turn)
    store.completeStream('s1');
    // Should NOT overwrite pending — pending means a new turn has started
    expect(useStreamStore.getState().streams['s1']?.status).toBe('pending');
  });

  it('errorStream preserves blocks for error display', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'partial response');
    store.addToolCall('s1', 'search', {});
    store.errorStream('s1');
    const stream = useStreamStore.getState().streams['s1'];
    expect(stream?.status).toBe('error');
    // Blocks should persist so user can see what happened before the error
    expect(stream?.blocks.length).toBe(2);
    expect(stream?.text).toBe('partial response');
  });
});

describe('connectionStore', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
  });

  it('setConnectionState sets connection state', () => {
    useConnectionStore.getState().setConnectionState('s1', 'connected');
    const conn = useConnectionStore.getState().connections['s1'];
    expect(conn?.state).toBe('connected');
  });

  it('recordEvent increments events count', () => {
    useConnectionStore.getState().setConnectionState('s1', 'connected');
    useConnectionStore.getState().recordEvent('s1');
    useConnectionStore.getState().recordEvent('s1');
    const conn = useConnectionStore.getState().connections['s1'];
    expect(conn?.eventsReceived).toBe(2);
  });

  it('removeConnection clears connection', () => {
    useConnectionStore.getState().setConnectionState('s1', 'connected');
    useConnectionStore.getState().removeConnection('s1');
    const conn = useConnectionStore.getState().connections['s1'];
    expect(conn).toBeUndefined();
  });
});
