// ────────────────────────────────────────────────────────────────
// fileOp mapping — `tool_use_result` → `harness.tool_complete.fileOp`.
//
// The SDK's user messages carry the tool's structured Output object
// (FileWriteOutput / FileEditOutput). The mapper turns its structuredPatch
// (or gitDiff, when git counted for us) into per-op "+A −D" stats that ride
// the tool_complete event to every surface. These shapes mirror the SDK's
// sdk-tools.d.ts contracts.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { mapClaudeAgentMessageToAgentEvents } from '../src/providers/claude-agent/event-mapper.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

function toolStart(id: string, name: string, parent?: string): SDKMessage {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id, name, input: { file_path: 'x' } }],
    },
    parent_tool_use_id: parent ?? null,
  } as unknown as SDKMessage;
}

function toolResult(
  id: string,
  toolUseResult: unknown,
  parent: string | null = null,
): SDKMessage {
  return {
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }],
    },
    parent_tool_use_id: parent,
    tool_use_result: toolUseResult,
  } as unknown as SDKMessage;
}

function completeOf(events: ReturnType<typeof mapClaudeAgentMessageToAgentEvents>) {
  const ev = events.find((e) => e.kind === 'harness.tool_complete');
  expect(ev).toBeDefined();
  return ev!.data as Record<string, unknown>;
}

describe('tool_use_result → fileOp', () => {
  it('derives create stats from a FileWriteOutput structuredPatch', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('t1', 'Write'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('t1', {
          type: 'create',
          filePath: 'C:\\ws\\src\\convert.mjs',
          content: 'a\nb\nc',
          structuredPatch: [
            { oldStart: 0, oldLines: 0, newStart: 1, newLines: 3, lines: ['+a', '+b', '+c'] },
          ],
          originalFile: null,
        }),
      ),
    );
    expect(data['fileOp']).toEqual({
      kind: 'create',
      filePath: 'C:\\ws\\src\\convert.mjs',
      additions: 3,
      deletions: 0,
      hunks: [
        { oldStart: 0, oldLines: 0, newStart: 1, newLines: 3, lines: ['+a', '+b', '+c'] },
      ],
    });
  });

  it('prefers gitDiff counts when git already counted', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('t2', 'Edit'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('t2', {
          filePath: 'src/a.ts',
          oldString: 'x',
          newString: 'y',
          originalFile: 'x',
          structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] }],
          gitDiff: { filename: 'src/a.ts', status: 'modified', additions: 7, deletions: 2, changes: 9, patch: '' },
        }),
      ),
    );
    expect(data['fileOp']).toMatchObject({ additions: 7, deletions: 2, kind: 'edit' });
  });

  it('counts hunk lines for an Edit without gitDiff', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('t3', 'Edit'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('t3', {
          filePath: 'src/b.ts',
          oldString: 'old',
          newString: 'new',
          originalFile: 'old',
          structuredPatch: [
            { oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, lines: [' ctx', '-one', '-two', '+uno', '+dos', '+tres'] },
          ],
        }),
      ),
    );
    expect(data['fileOp']).toEqual({
      kind: 'edit',
      filePath: 'src/b.ts',
      additions: 3,
      deletions: 2,
      hunks: [
        {
          oldStart: 3,
          oldLines: 2,
          newStart: 3,
          newLines: 3,
          lines: [' ctx', '-one', '-two', '+uno', '+dos', '+tres'],
        },
      ],
    });
  });

  it('emits no fileOp for non-file tool outputs (Bash)', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('t4', 'PowerShell'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('t4', { stdout: 'hello', stderr: '', interrupted: false }),
      ),
    );
    expect(data['fileOp']).toBeUndefined();
  });

  it('carries parentToolCallId on nested (subagent) completes', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('t5', 'Read', 'agent-call-1'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(toolResult('t5', undefined, 'agent-call-1')),
    );
    expect(data['parentToolCallId']).toBe('agent-call-1');
    expect(data['tool']).toBe('Read');
  });
  // ── Hunks (inline diff in the transcript) ──

  it('passes several hunks through verbatim', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('h1', 'Edit'));
    const patch = [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] },
      { oldStart: 40, oldLines: 2, newStart: 40, newLines: 2, lines: [' c', '-d', '+e'] },
    ];
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('h1', { filePath: 'src/c.ts', originalFile: 'a', structuredPatch: patch }),
      ),
    );
    const fileOp = data['fileOp'] as Record<string, unknown>;
    expect(fileOp['hunks']).toEqual(patch);
    expect(fileOp['hunksTruncated']).toBeUndefined();
    expect(fileOp).toMatchObject({ additions: 2, deletions: 2 });
  });

  it('caps total hunk lines and flags the truncation', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('h2', 'Edit'));
    // 200 lines in the first hunk, plus a second hunk that must be dropped whole.
    const big = Array.from({ length: 200 }, (_, i) => `+line ${i}`);
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('h2', {
          filePath: 'src/big.ts',
          originalFile: '',
          structuredPatch: [
            { oldStart: 1, oldLines: 0, newStart: 1, newLines: 200, lines: big },
            { oldStart: 500, oldLines: 1, newStart: 700, newLines: 1, lines: ['-x', '+y'] },
          ],
        }),
      ),
    );
    const fileOp = data['fileOp'] as Record<string, unknown>;
    const hunks = fileOp['hunks'] as { lines: string[] }[];
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(160);
    expect(hunks[0]!.lines[0]).toBe('+line 0');
    expect(fileOp['hunksTruncated']).toBe(true);
    // Counts describe the WHOLE patch, never the capped preview.
    expect(fileOp).toMatchObject({ additions: 201, deletions: 1 });
  });

  it('truncates an over-long single line rather than dropping it', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('h3', 'Edit'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('h3', {
          filePath: 'src/min.js',
          originalFile: '',
          structuredPatch: [
            { oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: [`+${'z'.repeat(5000)}`] },
          ],
        }),
      ),
    );
    const fileOp = data['fileOp'] as Record<string, unknown>;
    const hunks = fileOp['hunks'] as { lines: string[] }[];
    // 2000 capped chars + the ellipsis; the leading '+' is inside the cap.
    expect(hunks[0]!.lines[0]!).toHaveLength(2001);
    expect(hunks[0]!.lines[0]!.endsWith('\u2026')).toBe(true);
    // A per-line cap is not a hunk cut.
    expect(fileOp['hunksTruncated']).toBeUndefined();
  });

  it('synthesises a hunk and additions for a create with an empty patch', () => {
    // Claude reports a brand-new file as `type: create` with NO structuredPatch
    // — there is no "before". Without synthesis this rendered as "+0 −0" with
    // nothing to expand, which is the case a reader most wants inline.
    mapClaudeAgentMessageToAgentEvents(toolStart('h4', 'Write'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('h4', {
          type: 'create',
          filePath: 'routes.test.js',
          content: 'const a = 1;\nconst b = 2;\n',
          structuredPatch: [],
          originalFile: null,
        }),
      ),
    );
    expect(data['fileOp']).toEqual({
      kind: 'create',
      filePath: 'routes.test.js',
      // The trailing newline terminates line 2; it does not start a third.
      additions: 2,
      deletions: 0,
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 2,
          lines: ['+const a = 1;', '+const b = 2;'],
        },
      ],
    });
  });

  it('caps a synthesised create hunk too', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('h5', 'Write'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('h5', {
          type: 'create',
          filePath: 'big.txt',
          content: Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n'),
          structuredPatch: [],
        }),
      ),
    );
    const fileOp = data['fileOp'] as Record<string, unknown>;
    expect((fileOp['hunks'] as { lines: string[] }[])[0]!.lines).toHaveLength(160);
    expect(fileOp['hunksTruncated']).toBe(true);
    expect(fileOp['additions']).toBe(500);
  });

  it('emits an empty create with no hunks', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('h6', 'Write'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('h6', { type: 'create', filePath: 'empty.txt', content: '', structuredPatch: [] }),
      ),
    );
    expect(data['fileOp']).toEqual({
      kind: 'create',
      filePath: 'empty.txt',
      additions: 0,
      deletions: 0,
    });
  });

  it('yields no fileOp when the result has no structuredPatch at all', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('h7', 'Read'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('h7', { filePath: 'src/d.ts', content: 'whatever' }),
      ),
    );
    expect(data['fileOp']).toBeUndefined();
  });

  it('yields no hunks for an update whose structuredPatch is empty', () => {
    mapClaudeAgentMessageToAgentEvents(toolStart('h8', 'Write'));
    const data = completeOf(
      mapClaudeAgentMessageToAgentEvents(
        toolResult('h8', {
          type: 'update',
          filePath: 'src/e.ts',
          content: 'unchanged',
          structuredPatch: [],
        }),
      ),
    );
    expect(data['fileOp']).toEqual({
      kind: 'update',
      filePath: 'src/e.ts',
      additions: 0,
      deletions: 0,
    });
  });
});
