// ────────────────────────────────────────────────────────────────
// streamStore tests — streaming state management
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { useStreamStore } from '@/stores/streamStore.js';

describe('streamStore', () => {
  beforeEach(() => {
    useStreamStore.setState({ streams: {} });
  });

  // ── appendToken ──

  it('appendToken creates a text block and sets status to streaming', () => {
    useStreamStore.getState().appendToken('s1', 'hello');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.status).toBe('streaming');
    expect(s.text).toBe('hello');
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]!.type).toBe('text');
  });

  it('appendToken merges consecutive text blocks', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'hello ');
    store.appendToken('s1', 'world');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.blocks).toHaveLength(1);
    expect(s.text).toBe('hello world');
  });

  // ── appendThinking ──

  it('appendThinking creates a thinking block and sets status to thinking', () => {
    useStreamStore.getState().appendThinking('s1', 'hmm');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.status).toBe('thinking');
    expect(s.thinkingText).toBe('hmm');
    expect(s.blocks[0]?.type).toBe('thinking');
  });

  // ── completeThinking ──

  it('completeThinking marks open thinking blocks as complete', () => {
    const store = useStreamStore.getState();
    store.appendThinking('s1', 'thinking...');
    store.completeThinking('s1');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.status).toBe('streaming');
    const tb = s.blocks[0]!;
    expect(tb.type === 'thinking' && tb.isComplete).toBe(true);
  });

  // ── addToolCall ──

  it('addToolCall creates a tool_call block with running status', () => {
    useStreamStore.getState().addToolCall('s1', 'search', { q: 'test' }, 'tc-1');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.status).toBe('streaming');
    expect(s.blocks).toHaveLength(1);
    const b = s.blocks[0]!;
    expect(b.type === 'tool_call' && b.tool === 'search' && b.status === 'running').toBe(true);
  });

  // ── completeToolCall ──

  it('completeToolCall marks a running tool call as complete', () => {
    const store = useStreamStore.getState();
    store.addToolCall('s1', 'search', { q: 'test' }, 'tc-1');
    store.completeToolCall('s1', 'tc-1', 'found');
    const s = useStreamStore.getState().streams['s1']!;
    const b = s.blocks[0]!;
    expect(b.type === 'tool_call' && b.status === 'complete' && b.result === 'found').toBe(true);
  });

  it('completeToolCall preserves terminal status (complete/idle/error)', () => {
    const store = useStreamStore.getState();
    store.addToolCall('s1', 'search', { q: 'test' }, 'tc-1');
    // Simulate copilot.idle arriving before late tool_complete
    store.completeStream('s1');
    expect(useStreamStore.getState().streams['s1']!.status).toBe('complete');

    store.completeToolCall('s1', 'tc-1', 'found');
    // completeToolCall should NOT revert terminal status back to streaming —
    // doing so would prevent the auto-clear mechanism from detecting completion.
    expect(useStreamStore.getState().streams['s1']!.status).toBe('complete');
  });

  // ── startPending ──

  it('startPending resets stream to pending with empty blocks', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'old data');
    store.startPending('s1');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.status).toBe('pending');
    expect(s.blocks).toHaveLength(0);
    expect(s.text).toBe('');
  });

  it('startPending preserves _nextBlockId across turns (prevents React key collision)', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'text1');
    store.addToolCall('s1', 'search', {}, 'tc-1');
    // After 2 blocks, _nextBlockId should be 2
    expect(useStreamStore.getState().streams['s1']!._nextBlockId).toBe(2);

    store.startPending('s1', 'next prompt');
    const s = useStreamStore.getState().streams['s1']!;
    // _nextBlockId preserved — new blocks won't collide with old keys
    expect(s._nextBlockId).toBe(2);
    expect(s.blocks).toHaveLength(0);
  });

  it('startPending sets turnUserMessage for stale-data detection', () => {
    const store = useStreamStore.getState();
    store.startPending('s1', 'hello world');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.turnUserMessage).toBe('hello world');
    expect(s.pendingUserMessage).toBe('hello world');
  });

  it('clearStream resets turnUserMessage', () => {
    const store = useStreamStore.getState();
    store.startPending('s1', 'hello');
    store.clearStream('s1');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.turnUserMessage).toBeNull();
  });

  // ── completeStream ──

  it('completeStream sets status to complete', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'data');
    store.completeStream('s1');
    expect(useStreamStore.getState().streams['s1']!.status).toBe('complete');
  });

  it('completeStream does not overwrite pending status', () => {
    const store = useStreamStore.getState();
    store.startPending('s1');
    store.completeStream('s1');
    // Pending means a new turn has started — old completion should not overwrite
    expect(useStreamStore.getState().streams['s1']!.status).toBe('pending');
  });

  // ── clearStream ──

  it('clearStream resets to idle with empty blocks', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'data');
    store.clearStream('s1');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.status).toBe('idle');
    expect(s.blocks).toHaveLength(0);
  });

  // ── errorStream ──

  it('errorStream sets status to error', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'data');
    store.errorStream('s1');
    expect(useStreamStore.getState().streams['s1']!.status).toBe('error');
  });

  // ── Multi-step turn (tool call flow) ──

  it('handles a full tool call turn: text → tool → text → complete', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'Searching...');
    store.addToolCall('s1', 'search', { q: 'test' }, 'tc-1');
    store.completeToolCall('s1', 'tc-1', '3 results');
    store.appendToken('s1', ' Found it!');
    store.completeStream('s1');

    const s = useStreamStore.getState().streams['s1']!;
    expect(s.status).toBe('complete');
    expect(s.blocks).toHaveLength(3);
    expect(s.blocks.map(b => b.type)).toEqual(['text', 'tool_call', 'text']);
  });

  // ── Empty value guards (fixes for empty rows / jumbled messages) ──

  it('appendToken ignores empty strings', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', '');
    const s = useStreamStore.getState().streams['s1'];
    expect(s).toBeUndefined();
  });

  it('appendThinking ignores empty strings', () => {
    const store = useStreamStore.getState();
    store.appendThinking('s1', '');
    const s = useStreamStore.getState().streams['s1'];
    expect(s).toBeUndefined();
  });

  it('addSystemMessage ignores empty/whitespace-only messages', () => {
    const store = useStreamStore.getState();
    store.appendToken('s1', 'hello');
    store.addSystemMessage('s1', '');
    store.addSystemMessage('s1', '   ');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.blocks).toHaveLength(1); // only the text block
    expect(s.systemMessages).toHaveLength(0);
  });

  it('appendToken does not promote state when empty', () => {
    const store = useStreamStore.getState();
    store.startPending('s1');
    store.appendToken('s1', '');
    // Status should stay pending — an empty token should not flip to streaming
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.status).toBe('pending');
  });

  it('appendThinking does not promote state when empty', () => {
    const store = useStreamStore.getState();
    store.startPending('s1');
    store.appendThinking('s1', '');
    const s = useStreamStore.getState().streams['s1']!;
    expect(s.status).toBe('pending');
  });
});
