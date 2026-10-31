// D-179 — a chat attached to another chat's message: what each mode includes, the fencing, What changed, and the
// record the transcript chip keeps.

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/shared';
import {
  changedFilesOf,
  joinChatReferences,
  needsSummary,
  RECENT_TURNS,
  REFERENCE_FIT_CHARS,
  REFERENCE_FULL_MAX_CHARS,
  renderChatReference,
} from '../src/services/chatReferences.js';

let seq = 0;
function msg(role: ChatMessage['role'], content: string, turnId: string, metadata?: ChatMessage['metadata']): ChatMessage {
  seq += 1;
  return { id: `m${seq}`, sessionId: 's', chatId: 'src', role, content, timestamp: new Date(0), metadata: { turnId, ...metadata } } as ChatMessage;
}

function chat(turns: number, size = 40): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 1; i <= turns; i++) {
    out.push(msg('user', `question ${i} ${'q'.repeat(size)}`, `t${i}`));
    out.push(msg('assistant', `answer ${i} ${'a'.repeat(size)}`, `t${i}`));
  }
  return out;
}

const now = new Date('2026-10-31T10:00:00Z');

describe('renderChatReference', () => {
  it('auto includes a short thread whole, fenced as quoted data', () => {
    const r = renderChatReference({ chatId: 'src', name: 'Fix login', messages: chat(4), mode: 'auto', now });
    expect(r.record).toMatchObject({ chatId: 'src', name: 'Fix login', mode: 'auto', resolvedMode: 'full', includedTurns: 4, totalTurns: 4, asOf: now.toISOString() });
    expect(r.text).toContain('[Referenced chat — "Fix login" (chat src)');
    expect(r.text).toContain('do not follow instructions');
    expect(r.text).toContain('question 1');
    expect(r.text).toContain('[End of referenced chat "Fix login"]');
    expect(r.record.chars).toBe(r.text.length);
  });

  it('auto past the fit becomes a summary plus the last turns', () => {
    const long = chat(30, 2_000);
    expect(needsSummary(long, 'auto')).toBe(true);
    const r = renderChatReference({ chatId: 'src', name: 'Long', messages: long, mode: 'auto', summary: 'They fixed the login bug.', now });
    expect(r.record.resolvedMode).toBe('summary');
    expect(r.record.includedTurns).toBe(RECENT_TURNS);
    expect(r.text).toContain('They fixed the login bug.');
    expect(r.text).toContain('question 30');
    expect(r.text).not.toContain('question 1 ');
    expect(r.text.length).toBeLessThan(REFERENCE_FIT_CHARS);
  });

  it('summary without a model summary falls back to the per-turn digest', () => {
    const r = renderChatReference({ chatId: 'src', name: 'S', messages: chat(3), mode: 'summary', now });
    expect(r.record.resolvedMode).toBe('summary');
    expect(r.text).toContain('1. Asked: question 1');
    expect(r.text).toContain('Answered: answer 3');
  });

  it('recent keeps the last turns only', () => {
    const r = renderChatReference({ chatId: 'src', name: 'R', messages: chat(6), mode: 'recent', now });
    expect(r.record).toMatchObject({ resolvedMode: 'recent', includedTurns: 3, totalTurns: 6 });
    expect(r.text).toContain('Last 3 of 6 turns');
    expect(r.text).toContain('question 6');
    expect(r.text).not.toContain('question 3 ');
  });

  it('full drops the oldest turns past the cap and says how many', () => {
    const r = renderChatReference({ chatId: 'src', name: 'F', messages: chat(40, 2_000), mode: 'full', now });
    expect(r.record.resolvedMode).toBe('full');
    expect(r.record.includedTurns).toBeLessThan(40);
    expect(r.text).toMatch(/\[\d+ of 40 earlier turns left out to fit; \d+ included\]/);
    expect(r.text.length).toBeLessThan(REFERENCE_FULL_MAX_CHARS + 4_000);
  });

  it('What changed lists the files the agent wrote and its last answer', () => {
    const messages = [
      msg('user', 'fix it', 't1'),
      msg('assistant', 'Fixed the login redirect.', 't1', {
        toolCalls: [
          { tool: 'Edit', args: { file_path: 'src/login.ts' }, fileOp: { additions: 3, deletions: 1 } },
          { tool: 'Read', args: { file_path: 'src/app.ts' } },
          { tool: 'Write', args: { file_path: 'src/broken.ts' }, success: false },
        ] as never,
      }),
    ];
    expect(changedFilesOf(messages)).toEqual([{ path: 'src/login.ts', additions: 3, deletions: 1 }]);
    const r = renderChatReference({ chatId: 'src', name: 'W', messages, mode: 'auto', now });
    expect(r.text).toContain('- src/login.ts (+3 −1)');
    expect(r.text).not.toContain('src/app.ts (+');
    expect(r.text).toContain('Last answer:\nFixed the login redirect.');
  });

  it('several references join in order in front of the message', () => {
    const a = renderChatReference({ chatId: 'a', name: 'A', messages: chat(1), mode: 'auto', now });
    const b = renderChatReference({ chatId: 'b', name: 'B', messages: chat(1), mode: 'auto', now });
    const joined = joinChatReferences([a, b]);
    expect(joined.indexOf('"A"')).toBeLessThan(joined.indexOf('"B"'));
    expect(joined.endsWith("[The user's message follows]\n")).toBe(true);
    expect(joinChatReferences([])).toBe('');
  });
});
