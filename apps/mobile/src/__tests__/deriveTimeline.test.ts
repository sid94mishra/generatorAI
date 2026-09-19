import { describe, expect, it } from 'vitest';
import type { StreamBlock, StreamUsage, ToolCallBlock } from '@generatorai/client-core';

import {
  awaitsUserDecision,
  blocksSignature,
  cacheMissHint,
  collapseWork,
  countSteps,
  deriveTimeline,
  formatWorkDuration,
  rowsEqual,
  toolFamily,
  workLabel,
  type TimelineRow,
} from '../components/chat/timeline/deriveTimeline';
import { chatMessageToBlocks, messageAttachments, messageWasStopped } from '../components/chat/timeline/chatMessageToBlocks';
import { activityLabelFor, selectChatView } from '../components/chat/timeline/selectChatView';
import { DEFAULT_STREAM } from '@generatorai/client-core';

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

function kinds(rows: TimelineRow[]): string[] {
  return rows.map((r) => r.kind);
}

describe('toolFamily', () => {
  it('folds create into edit and recognises shells and agents', () => {
    expect(toolFamily('Write')).toBe('edit');
    expect(toolFamily('str_replace_editor')).toBe('edit');
    expect(toolFamily('Read')).toBe('read');
    expect(toolFamily('Grep')).toBe('search');
    expect(toolFamily('Bash')).toBe('shell');
    expect(toolFamily('powershell')).toBe('shell');
    expect(toolFamily('Agent')).toBe('agent');
    expect(toolFamily('Task')).toBe('agent');
    expect(toolFamily('mcp__generatorai-tools__click_element')).toBe('other');
  });
});

describe('deriveTimeline — grouping', () => {
  it('folds consecutive reads into one "Read N files" row', () => {
    const blocks: StreamBlock[] = [
      tool('Read', { file_path: 'src/a.ts' }),
      tool('Read', { file_path: 'src/b.ts' }),
      tool('Read', { file_path: 'src/c.ts' }),
    ];
    const rows = deriveTimeline(blocks, { active: false });
    expect(kinds(rows)).toEqual(['group']);
    const row = rows[0]!;
    if (row.kind !== 'group') throw new Error('expected group');
    expect(row.group.label).toBe('Read 3 files');
    expect(row.group.family).toBe('read');
    expect(row.group.steps).toHaveLength(3);
    expect(row.group.summary).toBe('c.ts, b.ts, a.ts');
    expect(row.group.status).toBe('done');
  });

  it('sums +/− across an edit group and keeps a lone step as a plain row', () => {
    const blocks: StreamBlock[] = [
      tool('Write', { file_path: 'a.ts' }, { fileOp: { kind: 'create', filePath: 'a.ts', additions: 10, deletions: 0 } }),
      tool('Edit', { file_path: 'b.ts' }, { fileOp: { kind: 'edit', filePath: 'b.ts', additions: 2, deletions: 3 } }),
      tool('Grep', { pattern: 'foo' }),
    ];
    const rows = deriveTimeline(blocks, { active: false });
    expect(kinds(rows)).toEqual(['group', 'tool']);
    const group = rows[0]!;
    if (group.kind !== 'group') throw new Error('expected group');
    expect(group.group.label).toBe('Edited 2 files');
    expect(group.group.fileOps).toEqual({ files: 2, additions: 12, deletions: 3 });
    const single = rows[1]!;
    if (single.kind !== 'tool') throw new Error('expected tool');
    expect(single.step.family).toBe('search');
    expect(single.step.target).toBe('foo');
  });

  it('names a run of one MCP tool after the tool and reports a live group', () => {
    const blocks: StreamBlock[] = [
      tool('mcp__browser__click_element', { url: 'https://a' }),
      tool('mcp__browser__click_element', { url: 'https://b' }, { status: 'running', result: undefined }),
    ];
    const rows = deriveTimeline(blocks, { active: true });
    const row = rows[0]!;
    if (row.kind !== 'group') throw new Error('expected group');
    expect(row.group.status).toBe('running');
    expect(row.group.label).toBe('click_element · running (2)');
    const settled = deriveTimeline(blocks.map((b) => (b.type === 'tool_call' ? { ...b, status: 'complete' as const } : b)), { active: false });
    if (settled[0]!.kind !== 'group') throw new Error('expected group');
    expect(settled[0]!.group.label).toBe('click_element ×2');
  });

  it('breaks a group on a thinking or text block', () => {
    const blocks: StreamBlock[] = [
      tool('Read', { file_path: 'a.ts' }),
      { type: 'text', blockId: nextId++, content: 'Looking…' },
      tool('Read', { file_path: 'b.ts' }),
      tool('Read', { file_path: 'c.ts' }),
    ];
    expect(kinds(deriveTimeline(blocks, { active: false }))).toEqual(['tool', 'text', 'group']);
  });
});

describe('deriveTimeline — nesting', () => {
  it('nests children under the Agent call by parentCallId and counts steps', () => {
    const agent = tool('Agent', { description: 'explore auth', prompt: 'Find the auth code' }, { callId: 'agent-1', status: 'running', result: undefined });
    const blocks: StreamBlock[] = [
      agent,
      tool('Read', { file_path: 'auth.ts' }, { parentCallId: 'agent-1' }),
      tool('Grep', { pattern: 'token' }, { parentCallId: 'agent-1' }),
      tool('Read', { file_path: 'other.ts' }),
    ];
    const rows = deriveTimeline(blocks, { active: true });
    expect(kinds(rows)).toEqual(['tool', 'tool']);
    const agentRow = rows[0]!;
    if (agentRow.kind !== 'tool') throw new Error('expected tool');
    expect(agentRow.step.family).toBe('agent');
    expect(agentRow.step.agentName).toBe('explore auth');
    expect(agentRow.step.status).toBe('running');
    expect(countSteps(agentRow.step.children)).toBe(2);
    expect(agentRow.step.children?.map((c) => c.family)).toEqual(['read', 'search']);
  });

  it('falls back to the top level when the parent is missing', () => {
    const blocks: StreamBlock[] = [tool('Read', { file_path: 'x.ts' }, { parentCallId: 'gone' })];
    const rows = deriveTimeline(blocks, { active: false });
    expect(kinds(rows)).toEqual(['tool']);
  });

  it('reuses the interned step when neither block nor children changed', () => {
    const agent = tool('Agent', { description: 'x' }, { callId: 'a' });
    const child = tool('Read', { file_path: 'a.ts' }, { parentCallId: 'a' });
    const first = deriveTimeline([agent, child], { active: false });
    const second = deriveTimeline([agent, child], { active: false });
    expect(rowsEqual(first[0]!, second[0]!)).toBe(true);
    const grown = deriveTimeline([agent, child, tool('Read', { file_path: 'b.ts' }, { parentCallId: 'a' })], { active: false });
    expect(rowsEqual(first[0]!, grown[0]!)).toBe(false);
  });
});

describe('deriveTimeline — status', () => {
  it('flags the provider error and the ok:false envelope as failed, with the message', () => {
    const blocks: StreamBlock[] = [
      tool('Bash', { command: 'pnpm test' }, { error: true, result: 'Error: 3 tests failed\nmore' }),
      { type: 'text', blockId: nextId++, content: 'hm' },
      tool('mcp__browser__click', { selector: '#x' }, { result: { ok: false, error: 'element not found' } }),
    ];
    const rows = deriveTimeline(blocks, { active: false });
    const first = rows[0]!;
    if (first.kind !== 'tool') throw new Error('expected tool');
    expect(first.step.status).toBe('failed');
    expect(first.step.errorMessage).toBe('Error: 3 tests failed');
    const third = rows[2]!;
    if (third.kind !== 'tool') throw new Error('expected tool');
    expect(third.step.status).toBe('failed');
    expect(third.step.errorMessage).toBe('element not found');
  });

  it('gives warning and error system blocks their tone (D6)', () => {
    const blocks: StreamBlock[] = [
      { type: 'system', blockId: nextId++, message: 'MCP "github" failed to start', category: 'warning' },
      { type: 'system', blockId: nextId++, message: 'boom', category: 'error' },
      { type: 'system', blockId: nextId++, message: 'Sub-agent started: x', category: 'subagent' },
    ];
    const rows = deriveTimeline(blocks, { active: false });
    expect(rows.map((r) => (r.kind === 'system' ? r.tone : r.kind))).toEqual(['warning', 'danger', 'info']);
  });

  it('marks running calls as waiting while a gate is open and appends the waiting row', () => {
    const blocks: StreamBlock[] = [
      tool('Bash', { command: 'rm -rf x' }, { status: 'running', result: undefined }),
      {
        type: 'permission',
        blockId: nextId++,
        interactionId: 'i1',
        toolName: 'Bash',
        permissionType: 'tool',
        description: 'd',
        inputSummary: 'rm -rf x',
        permissionMode: 'default',
        status: 'pending',
      },
    ];
    expect(awaitsUserDecision(blocks)).toBe('permission');
    const rows = deriveTimeline(blocks, { active: true });
    expect(kinds(rows)).toEqual(['tool', 'waiting']);
    const first = rows[0]!;
    if (first.kind !== 'tool') throw new Error('expected tool');
    expect(first.step.status).toBe('waiting');
  });

  it('degrades an unresolved call to pending once the turn settled, never spinning', () => {
    const blocks: StreamBlock[] = [tool('Read', { file_path: 'a' }, { status: 'running', result: undefined })];
    const live = deriveTimeline(blocks, { active: true });
    const done = deriveTimeline(blocks, { active: false });
    if (live[0]!.kind !== 'tool' || done[0]!.kind !== 'tool') throw new Error('expected tool');
    expect(live[0]!.step.status).toBe('running');
    expect(done[0]!.step.status).toBe('pending');
  });
});

describe('deriveTimeline — special rows', () => {
  it('builds file-op steps with +/− meta and the fileOp for the inline diff', () => {
    const fileOp = { kind: 'edit' as const, filePath: 'src/a.ts', additions: 4, deletions: 1, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 4, lines: ['-a', '+b', '+c'] }] };
    const rows = deriveTimeline([tool('Edit', { file_path: 'src/a.ts' }, { fileOp })], { active: false });
    const row = rows[0]!;
    if (row.kind !== 'tool') throw new Error('expected tool');
    expect(row.step.meta).toBe('+4 −1');
    expect(row.step.fileOp).toBe(fileOp);
  });

  it('builds shell steps with the command, exit code and output', () => {
    const rows = deriveTimeline(
      [tool('Bash', { command: 'pnpm test' }, { result: { stdout: 'ok\n', exitCode: 0 } })],
      { active: false },
    );
    const row = rows[0]!;
    if (row.kind !== 'tool') throw new Error('expected tool');
    expect(row.step.family).toBe('shell');
    expect(row.step.shell?.command).toBe('pnpm test');
    expect(row.step.shell?.exitCode).toBe(0);
    expect(row.step.shell?.output).toBe('ok\n');
  });

  it('detects a screenshot result', () => {
    const rows = deriveTimeline(
      [tool('mcp__browser__screenshot_page', {}, { result: { ok: true, artifactPath: 'shots/page.png', artifactType: 'browser_screenshot' } })],
      { active: false },
    );
    const row = rows[0]!;
    if (row.kind !== 'tool') throw new Error('expected tool');
    expect(row.step.image).toEqual({ relativePath: 'shots/page.png', label: 'page.png' });
  });

  it('appends stopped, hook and usage rows after the blocks, in that order', () => {
    const usage: StreamUsage = { model: 'm', inputTokens: 1, outputTokens: 2 };
    const rows = deriveTimeline([{ type: 'text', blockId: nextId++, content: 'partial' }], {
      active: false,
      stopped: true,
      hooks: [{ id: 'h1', hookName: 'pre-commit', phase: 'PreToolUse', status: 'ok' }],
      usage,
    });
    expect(kinds(rows)).toEqual(['text', 'stopped', 'hook', 'usage']);
  });

  it('prefixes ids so history and live rows never collide', () => {
    const block = tool('Read', { file_path: 'a' });
    const a = deriveTimeline([block], { active: false, idPrefix: 'm1:' });
    const b = deriveTimeline([block], { active: false, idPrefix: 'm2:' });
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });

  it('skips empty thinking heartbeats and marks the live text row', () => {
    const blocks: StreamBlock[] = [
      { type: 'thinking', blockId: nextId++, text: '', isComplete: false },
      { type: 'text', blockId: nextId++, content: 'Hello' },
    ];
    const rows = deriveTimeline(blocks, { active: true });
    expect(kinds(rows)).toEqual(['text']);
    expect(rows[0]!.kind === 'text' && rows[0]!.live).toBe(true);
    const settled = deriveTimeline(blocks, { active: false });
    expect(settled[0]!.kind === 'text' && settled[0]!.live).toBe(false);
  });
});

describe('blocksSignature / selectChatView', () => {
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

describe('cacheMissHint', () => {
  it('only reports a miss once the scope has proven it caches', () => {
    const cold: StreamUsage = { model: 'm', inputTokens: 5_000, outputTokens: 10 };
    expect(cacheMissHint(cold, null)).toBeNull();
    const warm: StreamUsage = { model: 'm', inputTokens: 100, outputTokens: 10, cacheReadTokens: 4_000 };
    expect(cacheMissHint(cold, warm)).toMatch(/cold/);
    expect(cacheMissHint(warm, cold)).toBeNull();
    expect(cacheMissHint({ ...cold, inputTokens: 200 }, warm)).toBeNull();
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

describe('deriveTimeline — settled turn collapse', () => {
  const text = (content: string): StreamBlock => ({ type: 'text', blockId: nextId++, content }) as StreamBlock;
  const system = (message: string, category: 'system' | 'warning' | 'error'): StreamBlock =>
    ({ type: 'system', blockId: nextId++, message, category }) as StreamBlock;

  it('folds a settled turn\'s steps into one work row and keeps prose visible', () => {
    const blocks: StreamBlock[] = [
      text('Looking around.'),
      tool('ToolSearch', { query: 'x' }),
      tool('Grep', { pattern: 'y' }),
      tool('Agent', { description: 'Write alpha.txt' }),
      text('Done.'),
    ];
    const rows = deriveTimeline(blocks, { active: false, collapseSettled: true, durationMs: 42_000 });
    expect(kinds(rows)).toEqual(['text', 'work', 'text']);
    const work = rows[1]!;
    if (work.kind !== 'work') throw new Error('expected work');
    expect(work.work.steps).toBe(3);
    expect(work.work.durationMs).toBe(42_000);
    expect(workLabel(work.work)).toBe('Worked · 3 steps · 42s');
    expect(kinds(work.work.rows)).toEqual(['tool', 'tool', 'tool']);
  });

  it('never collapses a live turn, and leaves a single step as a plain row', () => {
    const live = deriveTimeline([tool('Read', { file_path: 'a' }), tool('Grep', { pattern: 'b' })], { active: true, collapseSettled: true });
    expect(kinds(live)).not.toContain('work');
    const single = deriveTimeline([text('hi'), tool('Read', { file_path: 'a' }), text('bye')], { active: false, collapseSettled: true });
    expect(kinds(single)).toEqual(['text', 'tool', 'text']);
  });

  it('keeps warnings and errors outside the fold and splits the run around them', () => {
    const rows = deriveTimeline(
      [tool('Read', { file_path: 'a' }), tool('Grep', { pattern: 'b' }), system('MCP down', 'warning'), tool('Bash', { command: 'ls' }), tool('Bash', { command: 'pwd' })],
      { active: false, collapseSettled: true, durationMs: 5_000 },
    );
    expect(kinds(rows)).toEqual(['work', 'system', 'work']);
    // Two disclosures cannot both claim the turn's duration.
    for (const row of rows) if (row.kind === 'work') expect(row.work.durationMs).toBeUndefined();
  });

  it('counts failures and nested sub-agent steps', () => {
    const parent = tool('Agent', { description: 'Worker' }, { callId: 'p1' });
    const rows = collapseWork(
      deriveTimeline([parent, tool('Read', { file_path: 'a' }, { parentCallId: 'p1' }), tool('Bash', { command: 'x' }, { error: true })], { active: false }),
      'h:',
    );
    const work = rows[0]!;
    if (work.kind !== 'work') throw new Error('expected work');
    expect(work.work.steps).toBe(3);
    expect(work.work.failed).toBe(1);
    expect(workLabel(work.work)).toBe('Worked · 3 steps · 1 failed');
  });

  it('marks only the last prose row of a settled turn as final', () => {
    const rows = deriveTimeline([text('one'), tool('Read', { file_path: 'a' }), text('two')], { active: false });
    const texts = rows.filter((r) => r.kind === 'text');
    expect(texts.map((r) => (r.kind === 'text' ? Boolean(r.final) : null))).toEqual([false, true]);
    const live = deriveTimeline([text('one')], { active: true });
    expect(live[0]!.kind === 'text' && live[0]!.final).toBeFalsy();
  });

  it('compares work rows structurally for the row memo', () => {
    const blocks: StreamBlock[] = [tool('Read', { file_path: 'a' }), tool('Grep', { pattern: 'b' })];
    const a = deriveTimeline(blocks, { active: false, collapseSettled: true });
    const b = deriveTimeline(blocks, { active: false, collapseSettled: true });
    expect(rowsEqual(a[0]!, b[0]!)).toBe(true);
  });

  it('formats durations compactly', () => {
    expect(formatWorkDuration(400)).toBe('1s');
    expect(formatWorkDuration(42_000)).toBe('42s');
    expect(formatWorkDuration(125_000)).toBe('2m 5s');
    expect(formatWorkDuration(3_600_000 + 120_000)).toBe('1h 2m');
  });
});
