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
    expect(data['fileOp']).toEqual({ kind: 'edit', filePath: 'src/b.ts', additions: 3, deletions: 2 });
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
});
