import { describe, expect, it } from 'vitest';
import type { StreamBlock, ToolCallBlock } from '@generatorai/client-core';

import {
  MAX_OUTPUT_CHARS,
  agentConsoleRows,
  capTail,
  isShellTool,
  rowFromToolCall,
} from '../terminal/agentConsoleRows';

function call(overrides: Partial<ToolCallBlock>): ToolCallBlock {
  return {
    type: 'tool_call',
    blockId: 1,
    callId: 'call-1',
    tool: 'Bash',
    args: { command: 'ls -la' },
    status: 'complete',
    ...overrides,
  };
}

describe('isShellTool', () => {
  it('matches the shell tools of every harness, case-insensitively', () => {
    for (const name of ['Bash', 'bash', 'PowerShell', 'shell', 'execute_command', 'run_command']) {
      expect(isShellTool(name), name).toBe(true);
    }
  });

  it('does not match tools that merely contain a shell word', () => {
    // `run` alone would catch `run_workflow`; `sh` would catch `publish`.
    for (const name of ['run_workflow', 'publish', 'Read', 'Edit', 'Bash2', 'mcp__x__bash_history']) {
      expect(isShellTool(name), name).toBe(false);
    }
  });
});

describe('agentConsoleRows', () => {
  it('keeps only shell tool calls, in stream order', () => {
    const blocks: StreamBlock[] = [
      { type: 'text', blockId: 0, content: 'hello' } as unknown as StreamBlock,
      call({ callId: 'a', tool: 'Read', args: { path: 'x' } }),
      call({ callId: 'b', tool: 'Bash', args: { command: 'pnpm test' } }),
      call({ callId: 'c', tool: 'PowerShell', args: { command: 'Get-ChildItem' }, status: 'running' }),
    ];
    const rows = agentConsoleRows(blocks);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c']);
    expect(rows[0]!.command).toBe('pnpm test');
    expect(rows[1]!.status).toBe('running');
  });

  it('returns nothing for an empty stream', () => {
    expect(agentConsoleRows([])).toEqual([]);
  });
});

describe('rowFromToolCall — result shapes', () => {
  it('takes a string result verbatim', () => {
    const row = rowFromToolCall(call({ result: 'total 0\n' }));
    expect(row.output).toBe('total 0\n');
    expect(row.status).toBe('complete');
    expect(row.exitCode).toBeUndefined();
  });

  it('reads stdout/stderr/exitCode from an object result', () => {
    const row = rowFromToolCall(
      call({ result: { stdout: 'ok', stderr: 'warn', exitCode: 0, durationMs: 1234 } }),
    );
    expect(row.output).toBe('ok\nwarn');
    expect(row.exitCode).toBe(0);
    expect(row.durationMs).toBe(1234);
    expect(row.status).toBe('complete');
  });

  it('reads MCP content envelopes', () => {
    const row = rowFromToolCall(
      call({ result: { content: [{ type: 'text', text: 'line 1' }, { type: 'text', text: 'line 2' }] } }),
    );
    expect(row.output).toBe('line 1\nline 2');
  });

  it('falls back to JSON for an unknown object', () => {
    const row = rowFromToolCall(call({ result: { weird: true } }));
    expect(row.output).toContain('"weird": true');
  });

  it('marks a non-zero exit code as failed', () => {
    expect(rowFromToolCall(call({ result: { stdout: '', exitCode: 1 } })).status).toBe('failed');
  });

  it('marks the provider error flag as failed', () => {
    expect(rowFromToolCall(call({ error: true, result: 'boom' })).status).toBe('failed');
  });

  it('marks an { ok: false, error } envelope as failed and surfaces the message', () => {
    const row = rowFromToolCall(call({ result: { ok: false, error: 'command not found' } }));
    expect(row.status).toBe('failed');
    expect(row.output).toContain('command not found');
  });

  it('is running until the call completes, whatever the result says', () => {
    expect(rowFromToolCall(call({ status: 'running', result: undefined })).status).toBe('running');
  });
});

describe('rowFromToolCall — args', () => {
  it('reads the command and cwd under their common names', () => {
    expect(rowFromToolCall(call({ args: { command: 'a', cwd: '/w' } })).cwd).toBe('/w');
    expect(rowFromToolCall(call({ args: { cmd: 'b', working_directory: '/x' } })).command).toBe('b');
    expect(rowFromToolCall(call({ args: { cmd: 'b', working_directory: '/x' } })).cwd).toBe('/x');
  });

  it('keeps the tool description when present', () => {
    expect(rowFromToolCall(call({ args: { command: 'a', description: 'List files' } })).description).toBe(
      'List files',
    );
  });

  it('tolerates garbage args', () => {
    expect(rowFromToolCall(call({ args: null })).command).toBe('');
    expect(rowFromToolCall(call({ args: 'string' })).command).toBe('');
    expect(rowFromToolCall(call({ args: [1, 2] })).command).toBe('');
  });
});

describe('output cap', () => {
  it('keeps the tail of a large output at 4 KB', () => {
    const big = `${'x'.repeat(100_000)}THE END`;
    const row = rowFromToolCall(call({ result: big }));
    expect(row.output.length).toBe(MAX_OUTPUT_CHARS);
    expect(row.output.startsWith('…')).toBe(true);
    expect(row.output.endsWith('THE END')).toBe(true);
  });

  it('leaves small output untouched', () => {
    expect(capTail('short', 10)).toBe('short');
  });
});
