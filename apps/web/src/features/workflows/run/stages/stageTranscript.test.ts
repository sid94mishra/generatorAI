import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/shared';
import { answeredLastPrompt, persistedRows } from './StageTranscript.js';

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
