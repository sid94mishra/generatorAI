import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/shared';
import { answeredLastPrompt, liveTurnSaved, persistedRows } from './StageTranscript.js';
import { liveTurnSegments } from './StageRow.js';

const row = (id: string, role: ChatMessage['role'], extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, sessionId: 's', role, content: id, timestamp: new Date(0), ...extra }) as ChatMessage;

describe('persistedRows', () => {
  const prompt = row('prompt', 'user');
  const done = row('done', 'assistant', { metadata: { turnId: 't1' } as ChatMessage['metadata'] });
  const partial = row('partial', 'assistant', { complete: false, metadata: { turnId: 't2' } as ChatMessage['metadata'] });

  it('shows everything once no turn is in flight, a partial left by a stop included', () => {
    expect(persistedRows([prompt, done, partial], false, null).map((m) => m.id)).toEqual(['prompt', 'done', 'partial']);
  });

  it('leaves the turn in flight to the stream', () => {
    expect(persistedRows([prompt, done, partial], true, 't2').map((m) => m.id)).toEqual(['prompt', 'done']);
    const sameTurn = row('same', 'assistant', { metadata: { turnId: 't2' } as ChatMessage['metadata'] });
    expect(persistedRows([prompt, sameTurn], true, 't2').map((m) => m.id)).toEqual(['prompt']);
  });
});

describe('answeredLastPrompt', () => {
  it('is true only when a response follows the latest prompt', () => {
    expect(answeredLastPrompt([row('p', 'user'), row('a', 'assistant')])).toBe(true);
    expect(answeredLastPrompt([row('p', 'user'), row('a', 'assistant'), row('p2', 'user')])).toBe(false);
    expect(answeredLastPrompt([])).toBe(false);
  });
});

describe('liveTurnSaved (a follow-up lost on a revisit)', () => {
  it('is true once the live turn is saved finished: the stream is stale, the history wins', () => {
    const doneT2 = row('a2', 'assistant', { metadata: { turnId: 't2' } as ChatMessage['metadata'] });
    const partialT2 = row('p2', 'assistant', { complete: false, metadata: { turnId: 't2' } as ChatMessage['metadata'] });
    expect(liveTurnSaved([row('q', 'user'), doneT2], 't2')).toBe(true);
    expect(liveTurnSaved([row('q', 'user'), partialT2], 't2')).toBe(false);
    expect(liveTurnSaved([doneT2], null)).toBe(false);
  });
});

describe('liveTurnSegments (the follow-up prompt drawn twice)', () => {
  const answer = (id: string) => ({ type: 'answer' as const, id, text: id });
  it('keeps only what came after the person’s last message; null when they never wrote', () => {
    expect(liveTurnSegments([answer('first'), { type: 'operator', id: 'op', text: 'again' }, answer('second')])).toEqual([answer('second')]);
    expect(liveTurnSegments([answer('first'), { type: 'operator', id: 'op', text: 'again' }])).toEqual([]);
    expect(liveTurnSegments([answer('first')])).toBeNull();
  });
});
