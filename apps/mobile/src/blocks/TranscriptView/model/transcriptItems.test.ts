import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/client-core';
import type { ScmFlowResult } from '@generatorai/shared';
import { buildTranscriptItems, chatToolCalls, liveScmTurnIds } from './transcriptItems';

const at = (min: number): string => new Date(Date.UTC(2026, 9, 2, 14, min)).toISOString();
const user = (id: string, content: string, turnId: string, min = 0): ChatMessage => ({ id, chatId: 'c', role: 'user', content, timestamp: at(min), metadata: { turnId } });
const agent = (id: string, content: string, turnId: string, min = 1, extra: Record<string, unknown> = {}): ChatMessage => ({
  id,
  chatId: 'c',
  role: 'assistant',
  content,
  timestamp: at(min),
  metadata: { turnId, ...extra },
});
const idle = { serverTurnId: null, pendingUserMessage: null, turnUserMessage: null, turnId: 1, hasLive: false, activityLabel: null };
const result = { status: 'ok', alias: '.', steps: [], readiness: {} } as unknown as ScmFlowResult;

describe('transcript items (MB-07)', () => {
  it('one item per user message and per agent message; header first, footer last of a turn', () => {
    const items = buildTranscriptItems([user('u1', 'Fix it', 't1', 0), agent('a1', 'Looking', 't1', 1), agent('a2', 'Done', 't1', 3)], idle);
    expect(items.map((i) => i.kind)).toEqual(['user', 'agent', 'agent']);
    const [, first, last] = items as Array<Extract<(typeof items)[number], { kind: 'agent' }>>;
    expect([first!.header, first!.footer]).toEqual([true, false]);
    expect([last!.header, last!.footer]).toEqual([false, true]);
    expect(last!.durationMs).toBe(3 * 60_000);
  });

  it('draws the live turn right after its persisted prompt; later prompts follow its output', () => {
    const items = buildTranscriptItems(
      [user('u1', 'One', 't1'), agent('a1', 'Answer', 't1'), user('u2', 'Two', 't2', 5), agent('a2', 'Partial', 't2', 6), user('u3', 'Three', 't3', 7), user('u4', 'Four', 't4', 8)],
      { ...idle, status: 'streaming', serverTurnId: 't2', pendingUserMessage: 'Two', turnUserMessage: 'Two', hasLive: true, activityLabel: 'Working…' },
    );
    expect(items.map((i) => `${i.kind}:${i.key}`)).toEqual(['user:u1', 'agent:a1', 'user:u2', 'live:live-turn', 'activity:activity-1', 'user:u3', 'user:u4']);
    expect(items.some((i) => i.kind === 'user' && i.pending)).toBe(false);
  });

  it('shows the optimistic bubble as sending only until the server acknowledges the turn', () => {
    const base = { ...idle, pendingUserMessage: 'Hi', turnUserMessage: 'Hi', hasLive: true };
    const sending = buildTranscriptItems([user('u1', 'One', 't1')], { ...base, status: 'pending' });
    expect(sending.map((i) => `${i.kind}:${i.key}`)).toEqual(['user:u1', 'user:pending-1', 'live:live-turn']);
    expect((sending[1] as Extract<(typeof sending)[number], { kind: 'user' }>).pending).toBe(true);
    for (const ack of [{ status: 'pending' as const, serverTurnId: 't2' }, { status: 'streaming' as const }, { status: 'complete' as const }]) {
      const items = buildTranscriptItems([user('u1', 'One', 't1')], { ...base, ...ack });
      expect((items[1] as Extract<(typeof items)[number], { kind: 'user' }>).pending).toBe(false);
    }
  });

  it('a finished turn reconciles to its persisted prompt (no pending bubble left behind)', () => {
    const items = buildTranscriptItems([user('u1', 'Hi', 't1'), agent('a1', 'Hello', 't1')], {
      ...idle,
      status: 'complete',
      serverTurnId: 't1',
      pendingUserMessage: 'Hi',
      turnUserMessage: 'Hi',
      hasLive: true,
    });
    expect(items.map((i) => `${i.kind}:${i.key}`)).toEqual(['user:u1', 'live:live-turn']);
  });

  it('takes the persisted prompt of the live turn before its id is known only when it is the newest row', () => {
    const items = buildTranscriptItems([user('u1', 'Same prompt', 't1')], { ...idle, status: 'pending', turnUserMessage: 'Same prompt', pendingUserMessage: 'Same prompt', hasLive: true });
    expect(items.map((i) => `${i.kind}:${i.key}`)).toEqual(['user:u1', 'live:live-turn']);
    const older = buildTranscriptItems([user('u1', 'Same prompt', 't1'), agent('a1', 'Done', 't1')], { ...idle, status: 'pending', turnUserMessage: 'Same prompt', pendingUserMessage: 'Same prompt', hasLive: true });
    expect(older.map((i) => `${i.kind}:${i.key}`)).toEqual(['user:u1', 'agent:a1', 'user:pending-1', 'live:live-turn']);
  });

  it('appends a replayed source-control result to its turn unless the live stream holds it', () => {
    const messages = [user('u1', 'Commit', 't1'), agent('a1', 'Done', 't1')];
    const withScm = buildTranscriptItems(messages, idle, { results: new Map([['t1', result]]), liveTurnIds: new Set() });
    const last = withScm[1] as Extract<(typeof withScm)[number], { kind: 'agent' }>;
    expect(last.blocks.some((b) => b.type === 'scm_result')).toBe(true);
    const live = buildTranscriptItems(messages, idle, { results: new Map([['t1', result]]), liveTurnIds: new Set(['t1']) });
    expect((live[1] as typeof last).blocks.some((b) => b.type === 'scm_result')).toBe(false);
    expect([...liveScmTurnIds([{ type: 'scm_result', blockId: 1, turnId: 't9', result }])]).toEqual(['t9']);
  });

  it('lists every tool call of the chat once, persisted then live', () => {
    const withTools = agent('a1', 'x', 't1', 1, { toolCalls: [{ id: 'call-1', tool: 'Read', args: { file_path: 'a' }, status: 'complete' }] });
    const calls = chatToolCalls([withTools], [{ type: 'tool_call', blockId: 9, callId: 'call-2', tool: 'Bash', args: {}, status: 'running' } as never]);
    expect(calls.map((c) => c.callId)).toEqual(['call-1', 'call-2']);
  });
});
