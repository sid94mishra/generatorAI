// The transcript's stream selectors (MB-07, MD-149) and the wire message → blocks adapter it renders.
import { describe, expect, it } from 'vitest';
import { DEFAULT_STREAM, messageAttachments, messageWasStopped, wireChatMessageToBlocks as chatMessageToBlocks, type StreamBlock, type ToolCallBlock } from '@generatorai/client-core';

import { activityLabelFor, blocksSignature, selectChatView } from './selectChatView';

let nextId = 1;
function tool(
  tool: string,
  args: unknown,
  extra: Partial<ToolCallBlock> = {},
): ToolCallBlock {
  const blockId = nextId++;
  return {
    type: 'tool_call',
    blockId,
    callId: extra.callId ?? `call-${blockId}`,
    tool,
    args,
    status: 'complete',
    result: 'ok',
    ...extra,
  };
}

describe('blocksSignature / selectChatView', () => {
  it('uses shared live counts without confusing nested tools with subagents', () => {
    const view = selectChatView({ ...DEFAULT_STREAM, status: 'streaming', blocks: [
      tool('Agent', {}, { callId: 'worker', status: 'running' }),
      tool('Read', {}, { parentCallId: 'worker', status: 'running' }),
    ] });
    expect(view.runningTools).toBe(1);
    expect(view.runningSubagents).toBe(1);
    expect(view.pendingWorkers).toBe(0);
  });
  it('does not change when text streams into the live block, but does when it settles', () => {
    const a: StreamBlock[] = [{ type: 'text', blockId: 1, content: 'Hel' }];
    const b: StreamBlock[] = [{ type: 'text', blockId: 1, content: 'Hello world' }];
    expect(blocksSignature(a)).toBe(blocksSignature(b));
    const c: StreamBlock[] = [...b, tool('Read', { file_path: 'x' }, { status: 'running', result: undefined })];
    expect(blocksSignature(c)).not.toBe(blocksSignature(b));
    const d = c.map((x) => (x.type === 'tool_call' ? { ...x, status: 'complete' as const, result: 'r' } : x));
    expect(blocksSignature(d)).not.toBe(blocksSignature(c));
  });

  it('exposes the open gate by identity and a stable activity label', () => {
    const permission: StreamBlock = {
      type: 'permission',
      blockId: 9,
      interactionId: 'i',
      toolName: 'Bash',
      permissionType: 't',
      description: '',
      inputSummary: '',
      permissionMode: 'default',
      status: 'pending',
    };
    const view = selectChatView({ ...DEFAULT_STREAM, status: 'streaming', blocks: [permission] });
    expect(view.gate).toBe('permission');
    expect(view.gateBlock).toBe(permission);
    expect(activityLabelFor({ ...view, lastBlock: 'none', typing: true })).toBe('Writing…');
    expect(activityLabelFor({ ...view, status: 'pending' })).toBe('Working…');
    expect(activityLabelFor({ ...view, lastBlock: 'thinking-live' })).toBeNull();
    expect(activityLabelFor(selectChatView(undefined))).toBeNull();
  });

  it.each(['complete', 'error', 'idle'] as const)('does not pin a missed permission resolution after a %s turn', (status) => {
    const stale: StreamBlock = {
      type: 'permission', blockId: 9, interactionId: 'answered-elsewhere',
      toolName: 'shell', permissionType: 'shell_exec', description: '',
      inputSummary: '', permissionMode: 'plan', status: 'pending',
    };
    const view = selectChatView({ ...DEFAULT_STREAM, status, blocks: [stale] });
    expect(view.gate).toBeNull();
    expect(view.gateBlock).toBeNull();
  });
});

describe('chatMessageToBlocks', () => {
  it('interleaves text segments and tool calls by sequence, flagging failures and parents', () => {
    const blocks = chatMessageToBlocks({
      id: 'm',
      chatId: 'c',
      role: 'assistant',
      content: 'Done.',
      metadata: {
        thinkingText: 'hmm',
        textSegments: [
          { content: 'Looking…', sequence: 0 },
          { content: 'Done.', sequence: 3 },
        ],
        toolCalls: [
          { id: 't1', tool: 'Agent', args: { description: 'x' }, status: 'complete', sequence: 1 } as never,
          { id: 't2', tool: 'Read', args: { file_path: 'a' }, status: 'running', sequence: 2, parentId: 't1', success: false } as never,
        ],
        partial: true,
      },
    });
    expect(blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_call', 'tool_call', 'text']);
    const read = blocks[3]!;
    if (read.type !== 'tool_call') throw new Error('expected tool_call');
    expect(read.status).toBe('complete');
    expect(read.error).toBe(true);
    expect(read.parentCallId).toBe('t1');
    expect(messageWasStopped({ id: 'm', chatId: 'c', role: 'assistant', content: '', metadata: { partial: true } })).toBe(true);
  });

  it('falls back to content and parses attachments defensively', () => {
    const blocks = chatMessageToBlocks({ id: 'm', chatId: 'c', role: 'assistant', content: 'Plain' });
    expect(blocks).toEqual([{ type: 'text', blockId: 0, content: 'Plain' }]);
    const message = {
      id: 'u',
      chatId: 'c',
      role: 'user' as const,
      content: 'see',
      attachments: [{ name: 'a.png', path: '/x/a.png', mimeType: 'image/png', artifactId: 'art' }, { bogus: true }],
    };
    expect(messageAttachments(message)).toEqual([{ name: 'a.png', path: '/x/a.png', mimeType: 'image/png', artifactId: 'art' }]);
  });
});
