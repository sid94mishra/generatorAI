// ────────────────────────────────────────────────────────────────
// Turn grouping and the synthetic conversation seed.
//
// Rewind and fork are expressed in turns; this pins how a flat transcript is
// cut into them (including rows written before turn ids existed) and what
// a provider without native branching is told about the surviving history.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@generatorai/shared';
import {
  groupTurns,
  lastAnchor,
  firstAnchor,
  buildConversationSeed,
  applyConversationSeed,
  SEED_MAX_CHARS,
} from '../src/services/chatTranscript.js';

let seq = 0;
function msg(
  role: ChatMessage['role'],
  content: string,
  metadata?: ChatMessage['metadata'],
): ChatMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    sessionId: 's',
    chatId: 'c',
    role,
    content,
    timestamp: new Date(2026, 0, 1, 0, 0, seq),
    ...(metadata ? { metadata } : {}),
  };
}

describe('groupTurns', () => {
  it('pairs each user message with the assistant rows that share its turnId', () => {
    const rows = [
      msg('user', 'q1', { turnId: 't1' }),
      msg('assistant', 'a1', { turnId: 't1', providerAnchor: { kind: 'message', id: 'u-a1' } }),
      msg('user', 'q2', { turnId: 't2' }),
      msg('assistant', 'a2', { turnId: 't2', providerAnchor: { kind: 'message', id: 'u-a2' } }),
    ];
    const turns = groupTurns(rows);
    expect(turns.map((t) => t.turnId)).toEqual(['t1', 't2']);
    expect(turns[0]!.startIndex).toBe(0);
    expect(turns[0]!.endIndex).toBe(2);
    expect(turns[1]!.startIndex).toBe(2);
    expect(turns[1]!.endIndex).toBe(4);
    expect(turns[1]!.userMessage?.content).toBe('q2');
    expect(turns[1]!.assistantMessages).toHaveLength(1);
  });

  it('attaches untagged rows to the turn they follow and gives legacy prompts their own turns', () => {
    const rows = [
      msg('user', 'old question'),
      msg('assistant', 'old answer'),
      msg('system', 'note'),
      msg('user', 'new question', { turnId: 't9' }),
      msg('assistant', 'new answer', { turnId: 't9' }),
    ];
    const turns = groupTurns(rows);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.rows).toHaveLength(3);
    expect(turns[0]!.turnId).toMatch(/^legacy-/);
    expect(turns[1]!.turnId).toBe('t9');
  });

  it('never attributes a tagged assistant row to a different turn', () => {
    const rows = [
      msg('user', 'q1', { turnId: 't1' }),
      msg('assistant', 'a-late', { turnId: 't0' }),
    ];
    const turns = groupTurns(rows);
    expect(turns).toHaveLength(2);
    expect(turns[1]!.turnId).toBe('t0');
  });
});

describe('anchors', () => {
  const rows = [
    msg('user', 'q1', { turnId: 't1' }),
    msg('assistant', 'a1', { turnId: 't1', providerAnchor: { kind: 'turn', id: 'codex-1' } }),
    msg('user', 'q2', { turnId: 't2' }),
    msg('assistant', 'a2', { turnId: 't2' }),
    msg('user', 'q3', { turnId: 't3' }),
    msg('assistant', 'a3', { turnId: 't3', providerAnchor: { kind: 'turn', id: 'codex-3' } }),
  ];
  it('lastAnchor skips unanchored turns and user rows', () => {
    expect(lastAnchor(rows.slice(0, 4))).toEqual({ kind: 'turn', id: 'codex-1' });
    expect(lastAnchor(rows)).toEqual({ kind: 'turn', id: 'codex-3' });
    expect(lastAnchor(rows.slice(0, 1))).toBeUndefined();
  });
  it('firstAnchor finds the first anchored assistant row', () => {
    expect(firstAnchor(rows.slice(2))).toEqual({ kind: 'turn', id: 'codex-3' });
  });
});

describe('buildConversationSeed', () => {
  it('renders prompts, answers and a compact action list, oldest first', () => {
    const seed = buildConversationSeed([
      msg('user', 'Add a README', { turnId: 't1' }),
      msg('assistant', 'Done — README added.', {
        turnId: 't1',
        toolCalls: [
          { id: '1', tool: 'Write', args: { file_path: 'README.md' }, status: 'complete', fileOp: { additions: 12, deletions: 0 } as never },
          { id: '2', tool: 'Bash', args: { command: 'npm test' }, status: 'complete', success: false },
        ],
      }),
    ]);
    expect(seed).toContain('[Conversation history');
    expect(seed).toContain('User:\nAdd a README');
    expect(seed).toContain('Write: README.md (+12 −0)');
    expect(seed).toContain('Bash: npm test [failed]');
    expect(seed).toContain('Done — README added.');
    expect(seed.trimEnd().endsWith('[End of restored history]')).toBe(true);
  });

  it('is empty for an empty transcript and bounded for a huge one, dropping the OLDEST turns', () => {
    expect(buildConversationSeed([])).toBe('');
    const rows: ChatMessage[] = [];
    for (let i = 0; i < 40; i += 1) {
      rows.push(msg('user', `question ${i} ` + 'x'.repeat(1_500), { turnId: `t${i}` }));
      rows.push(msg('assistant', `answer ${i} ` + 'y'.repeat(1_500), { turnId: `t${i}` }));
    }
    const seed = buildConversationSeed(rows);
    expect(seed.length).toBeLessThan(SEED_MAX_CHARS + 2_000);
    expect(seed).toContain('earlier turn');
    expect(seed).toContain('question 39');
    expect(seed).not.toContain('question 0 ');
  });

  it('applyConversationSeed prefixes the prompt and is a no-op for an empty seed', () => {
    expect(applyConversationSeed('', 'hi')).toBe('hi');
    const out = applyConversationSeed('SEED', 'hi');
    expect(out.startsWith('SEED')).toBe(true);
    expect(out.endsWith('[New message from the user]\nhi')).toBe(true);
  });
});
