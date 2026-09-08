// ────────────────────────────────────────────────────────────────
// Agent Console rows — the commands the agent ran, from the stream blocks.
//
// The harness runs Bash / PowerShell inside its own per-turn CLI process, so
// there is no PTY to attach to and no incremental stdout: what a phone can
// show honestly is each command, whether it is still running, and its full
// output the moment it completes (plan §6.6, "two-tier" terminal).
//
// Pure functions, no React, so the mapping from a `ToolCallBlock` to a row
// is unit-testable and cannot drift with the renderer.
// ────────────────────────────────────────────────────────────────

import type { ToolCallBlock } from '@generatorai/client-core';

export interface AgentConsoleRow {
  /** The tool call id — stable across streaming updates. */
  id: string;
  command: string;
  cwd?: string;
  exitCode?: number;
  /** Combined output, tail-capped at `MAX_OUTPUT_CHARS`. */
  output: string;
  status: 'running' | 'complete' | 'failed';
  durationMs?: number;
  /** The tool's own one-line description of the command, when it gave one. */
  description?: string;
}

/**
 * 4 KB per row. A row is rendered inside a virtualised list on a phone, and
 * a single `npm install` transcript can be megabytes; the tail is kept
 * because that is where the error is.
 */
export const MAX_OUTPUT_CHARS = 4096;

/**
 * Mirrors `isShellTool` in `apps/web/src/components/agent/deriveTimeline.ts`
 * (`bash | powershell | shell`), widened to the other harnesses' names for
 * the same capability. Anchored on the whole name: "run" alone would match
 * `run_workflow`, which is not a shell.
 */
const SHELL_TOOL = /^(bash|powershell|shell|cmd|terminal|execute_command|run_command|run_terminal_cmd|run_shell_command)$/i;

export function isShellTool(tool: string): boolean {
  return SHELL_TOOL.test(tool);
}

/** Only the blocks that are shell tool calls, in stream order. */
export function agentConsoleRows(
  blocks: ReadonlyArray<{ type: string } | ToolCallBlock>,
): AgentConsoleRow[] {
  const rows: AgentConsoleRow[] = [];
  for (const block of blocks) {
    if (block.type !== 'tool_call') continue;
    const call = block as ToolCallBlock;
    if (!isShellTool(call.tool)) continue;
    rows.push(rowFromToolCall(call));
  }
  return rows;
}

export function rowFromToolCall(call: ToolCallBlock): AgentConsoleRow {
  const args = objectOf(call.args);
  const command = stringField(args, 'command', 'cmd', 'script', 'input') ?? '';
  const cwd = stringField(args, 'cwd', 'workdir', 'working_directory', 'workingDirectory');
  const description = stringField(args, 'description');

  const result = parseResult(call.result);
  const exitCode = result.exitCode;
  const durationMs = result.durationMs;

  const status: AgentConsoleRow['status'] =
    call.status !== 'complete'
      ? 'running'
      : call.error === true || (exitCode !== undefined && exitCode !== 0) || result.failed
        ? 'failed'
        : 'complete';

  return {
    id: call.callId,
    command,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    output: capTail(result.output, MAX_OUTPUT_CHARS),
    status,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

interface ParsedResult {
  output: string;
  exitCode?: number;
  durationMs?: number;
  /** An `{ ok: false }` / `{ error }` envelope with no exit code. */
  failed: boolean;
}

/**
 * Tool results are not one shape. The SDK's Bash tool returns a string; the
 * MCP bridge returns `{ content: [{ type: 'text', text }] }`; in-process
 * tools return `{ stdout, stderr, exitCode }`; a failure may be
 * `{ ok: false, error }`. Each is reduced to text plus whatever exit code
 * it carried.
 */
function parseResult(result: unknown): ParsedResult {
  if (result == null) return { output: '', failed: false };
  if (typeof result === 'string') return { output: result, failed: false };
  if (typeof result !== 'object') return { output: String(result), failed: false };

  const record = result as Record<string, unknown>;
  const parts: string[] = [];

  const content = record['content'];
  if (Array.isArray(content)) {
    for (const item of content) {
      const text = objectOf(item)['text'];
      if (typeof text === 'string') parts.push(text);
    }
  }
  for (const key of ['stdout', 'output', 'text', 'result'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) parts.push(value);
  }
  const stderr = record['stderr'];
  if (typeof stderr === 'string' && stderr.length > 0) parts.push(stderr);
  const error = record['error'];
  if (typeof error === 'string' && error.length > 0) parts.push(error);
  else if (error && typeof error === 'object') {
    const message = objectOf(error)['message'];
    if (typeof message === 'string') parts.push(message);
  }

  let output = parts.join(parts.length > 1 ? '\n' : '');
  if (output.length === 0) {
    try {
      output = JSON.stringify(result, null, 2);
    } catch {
      output = String(result);
    }
  }

  const exitCode = numberField(record, 'exitCode', 'exit_code', 'code', 'status');
  const durationMs = numberField(record, 'durationMs', 'duration_ms');
  const failed = record['ok'] === false || record['isError'] === true || record['is_error'] === true;

  return {
    output,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    failed,
  };
}

/** Keep the LAST `max` characters — the tail is where a failure explains itself. */
export function capTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `…${text.slice(text.length - (max - 1))}`;
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}
