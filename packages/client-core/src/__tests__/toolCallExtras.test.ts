// ────────────────────────────────────────────────────────────────
// Tool-call extras — fileOp stats and subagent nesting metadata.
//
// `harness.tool_start.parentToolCallId` and `harness.tool_complete.fileOp`
// must survive the router → effects → reducer pipeline onto the blocks the
// timeline renders from; a dropped field here silently flattens subagent
// activity or blanks every "+A −D" chip.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { StreamEventRouter, applyStreamEffects } from '../index.js';
import * as r from '../stream/reducer.js';
import type { StreamsRecord } from '../stream/types.js';

const KEY = 'sess-1';

function route(router: StreamEventRouter, kind: string, data: Record<string, unknown>) {
  return router.handle(KEY, { kind, data } as never);
}

describe('fileOp + parentCallId through the pipeline', () => {
  it('router forwards parentToolCallId on tool_start and fileOp on tool_complete', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = {};

    streams = applyStreamEffects(
      streams,
      route(router, 'harness.tool_start', {
        tool: 'Agent',
        args: { description: 'explore' },
        callId: 'agent-1',
      }),
    );
    streams = applyStreamEffects(
      streams,
      route(router, 'harness.tool_start', {
        tool: 'Read',
        args: { file_path: 'a.ts' },
        callId: 'read-1',
        parentToolCallId: 'agent-1',
      }),
    );
    streams = applyStreamEffects(
      streams,
      route(router, 'harness.tool_complete', {
        tool: 'Write',
        callId: 'read-1',
        result: 'ok',
        fileOp: { kind: 'create', filePath: 'a.ts', additions: 5, deletions: 1 },
      }),
    );

    const blocks = streams[KEY]!.blocks.filter((b) => b.type === 'tool_call');
    expect(blocks).toHaveLength(2);
    const child = blocks.find((b) => b.type === 'tool_call' && b.callId === 'read-1');
    expect(child && child.type === 'tool_call' ? child.parentCallId : undefined).toBe('agent-1');
    expect(child && child.type === 'tool_call' ? child.fileOp : undefined).toEqual({
      kind: 'create',
      filePath: 'a.ts',
      additions: 5,
      deletions: 1,
    });
  });

  it('reducer.addToolCall records parentCallId; completeToolCall records fileOp', () => {
    let streams: StreamsRecord = {};
    streams = r.addToolCall(streams, KEY, 'Grep', { pattern: 'x' }, 'g1', 'parent-9');
    streams = r.completeToolCall(streams, KEY, 'g1', 'found', {
      kind: 'edit',
      filePath: 'b.ts',
      additions: 2,
      deletions: 3,
    });
    const block = streams[KEY]!.blocks.find((b) => b.type === 'tool_call');
    expect(block && block.type === 'tool_call' ? block.parentCallId : undefined).toBe('parent-9');
    expect(block && block.type === 'tool_call' ? block.fileOp : undefined).toMatchObject({
      additions: 2,
      deletions: 3,
    });
    // the flat mirror carries them too
    expect(streams[KEY]!.toolCalls[0]).toMatchObject({
      parentCallId: 'parent-9',
      fileOp: { additions: 2, deletions: 3 },
    });
  });

  it('a fileOp-less complete leaves no phantom fileOp', () => {
    let streams: StreamsRecord = {};
    streams = r.addToolCall(streams, KEY, 'Read', {}, 'r1');
    streams = r.completeToolCall(streams, KEY, 'r1', 'content');
    const block = streams[KEY]!.blocks.find((b) => b.type === 'tool_call');
    expect(block && block.type === 'tool_call' ? block.fileOp : 'sentinel').toBeUndefined();
  });
});
