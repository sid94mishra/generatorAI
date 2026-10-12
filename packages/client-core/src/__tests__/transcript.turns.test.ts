import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/shared';
import type { StreamBlock } from '../stream/types.js';
import {
  blocksSearchText,
  buildTranscriptTurns,
  digestBlocks,
  findInTexts,
  formatDigest,
  messageBlocks,
  turnSearchText,
} from '../transcript/turns.js';
import { formatStepDuration } from '../transcript/usage.js';
import { deriveSegments } from '../transcript/deriveTimeline.js';

let seq = 0;
const msg = (role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${++seq}`,
  sessionId: 's',
  chatId: 'c',
  role,
  content,
  timestamp: new Date(0),
  ...extra,
});

describe('buildTranscriptTurns', () => {
  it('opens a turn at each user message and folds responses into it', () => {
    const turns = buildTranscriptTurns([msg('user', 'q1'), msg('assistant', 'a1'), msg('user', 'q2'), msg('assistant', 'a2')]);
    expect(turns.map((t) => t.entries.map((e) => e.kind))).toEqual([
      ['user', 'agent'],
      ['user', 'agent'],
    ]);
  });

  it('keeps leading non-user rows in a turn of their own and drops empty responses', () => {
    const turns = buildTranscriptTurns([msg('system', 'hello'), msg('assistant', ''), msg('user', 'q')]);
    expect(turns.map((t) => t.entries.map((e) => e.kind))).toEqual([['system'], ['user']]);
  });

  it('an optimistic bubble opens the live turn; without one the live stream joins the last turn', () => {
    const withBubble = buildTranscriptTurns([msg('user', 'q'), msg('assistant', 'a')], { pendingUserText: 'next', live: true });
    expect(withBubble).toHaveLength(2);
    expect(withBubble[1]!.entries.map((e) => e.kind)).toEqual(['pending_user', 'live']);
    expect(withBubble[1]!.live).toBe(true);

    const without = buildTranscriptTurns([msg('user', 'q'), msg('assistant', 'a')], { live: true });
    expect(without).toHaveLength(1);
    expect(without[0]!.entries.map((e) => e.kind)).toEqual(['user', 'agent', 'live']);

    expect(buildTranscriptTurns([], { live: true })[0]!.entries.map((e) => e.kind)).toEqual(['live']);
  });

  it('keys turns by their first entry so a growing turn keeps its key', () => {
    const q = msg('user', 'q');
    const a = buildTranscriptTurns([q]);
    const b = buildTranscriptTurns([q, msg('assistant', 'x')]);
    expect(a[0]!.key).toBe(b[0]!.key);
  });
});

describe('messageBlocks', () => {
  it('turns a legacy tool row into one completed tool call', () => {
    const blocks = messageBlocks(msg('tool', '', { toolName: 'Read', toolArgs: { file_path: 'a.ts' }, toolResult: 'x' }));
    expect(blocks).toMatchObject([{ type: 'tool_call', tool: 'Read', status: 'complete' }]);
  });
});

describe('digest (Summary mode)', () => {
  const blocks: StreamBlock[] = [
    { type: 'text', blockId: 1, content: 'Looking.' },
    { type: 'tool_call', blockId: 2, callId: 'c1', tool: 'Read', args: { file_path: 'a.ts' }, status: 'complete' },
    {
      type: 'tool_call',
      blockId: 3,
      callId: 'c2',
      tool: 'Edit',
      args: { file_path: 'a.ts' },
      status: 'complete',
      fileOp: { kind: 'edit', filePath: 'a.ts', additions: 14, deletions: 6 },
    },
    { type: 'tool_call', blockId: 4, callId: 'c3', tool: 'Bash', args: { command: 'x' }, status: 'complete', error: true },
    { type: 'text', blockId: 5, content: 'Done: fixed.' },
  ];

  it('counts steps, file-op totals and failures, and keeps the final answer', () => {
    const d = digestBlocks(blocks, 164_000);
    expect(d).toMatchObject({ steps: 3, additions: 14, deletions: 6, failed: 1, finalText: 'Done: fixed.' });
    expect(formatDigest(d, formatStepDuration)).toBe('3 steps · 2m 44s · +14 −6 · 1 failed');
  });

  it('omits what is unknown', () => {
    expect(formatDigest(digestBlocks([{ type: 'text', blockId: 1, content: 'hi' }]), formatStepDuration)).toBe('0 steps');
  });
});

describe('thinking segments', () => {
  it('reasoning becomes its own segment, live only while the turn is active', () => {
    const blocks: StreamBlock[] = [
      { type: 'thinking', blockId: 1, text: 'hmm', isComplete: false },
      { type: 'thinking', blockId: 2, text: '   ', isComplete: true },
      { type: 'text', blockId: 3, content: 'answer' },
    ];
    expect(deriveSegments(blocks, { active: true }).map((s) => s.type)).toEqual(['thinking', 'answer']);
    expect(deriveSegments(blocks, { active: true })[0]).toMatchObject({ live: true });
    expect(deriveSegments(blocks, { active: false })[0]).toMatchObject({ live: false });
  });
});

describe('find', () => {
  it('indexes prose, steps and cards, and counts hits per turn', () => {
    const turns = buildTranscriptTurns([
      msg('user', 'Fix the checkout test'),
      msg('assistant', 'The Checkout race is in applyCoupon.', {
        metadata: { toolCalls: [{ id: 't', tool: 'Read', args: { file_path: 'src/checkout.ts' }, status: 'complete' }] },
      }),
      msg('user', 'thanks'),
    ]);
    const texts = turns.map(turnSearchText);
    expect(findInTexts(texts, 'checkout')).toEqual([{ turn: 0, occurrences: 3 }]);
    expect(findInTexts(texts, '  ')).toEqual([]);
    expect(findInTexts(texts, 'THANKS')).toEqual([{ turn: 1, occurrences: 1 }]);
  });

  it('includes question text and permission tool names', () => {
    const text = blocksSearchText([
      {
        type: 'question',
        blockId: 1,
        interactionId: 'q',
        status: 'pending',
        questions: [{ id: 'a', header: 'Scope', question: 'Which package?', options: [{ label: 'web' }], multiSelect: false, allowFreeform: true }],
      },
      {
        type: 'permission',
        blockId: 2,
        interactionId: 'p',
        toolName: 'Bash',
        permissionType: 'bash',
        description: 'Run a shell command',
        inputSummary: 'git push',
        permissionMode: 'default',
        status: 'pending',
      },
    ]);
    expect(text).toContain('Which package?');
    expect(text).toContain('git push');
  });
});

describe('textJoint', () => {
  it('starts a new paragraph between finished messages that ran together', async () => {
    const { textJoint } = await import('../transcript/deriveTimeline.js');
    expect(textJoint('Reviewed the egress code.', 'Next I am checking')).toBe('\n\n');
  });

  it('joins a stream split mid-sentence as it is', async () => {
    const { textJoint } = await import('../transcript/deriveTimeline.js');
    expect(textJoint('Reviewed the', ' egress code')).toBe('');
    expect(textJoint('Reviewed the egr', 'ess code')).toBe('');
    expect(textJoint('', 'Start')).toBe('');
  });
});
