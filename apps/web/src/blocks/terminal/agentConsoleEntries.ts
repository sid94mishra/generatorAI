// ────────────────────────────────────────────────────────────────
// collectShellEntries — the agent's shell commands in one chat (F-dock-03).
//
// The harness runs Bash / PowerShell in its own per-turn process: there is no
// PTY to attach to and no incremental stdout, so the console shows exactly
// what exists — every shell call in the chat's history plus the live stream,
// deduped by call id, newest last, with its output once it completes.
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@generatorai/shared';
import { isShellTool } from '@generatorai/shared/ui-contract';
import type { StreamState } from '@/stores/streamStore.js';

export interface ShellEntry {
  callId: string;
  command: string;
  /** The tool's `description` argument (the purpose line), when given. */
  description?: string;
  output: string;
  status: 'running' | 'complete';
  /** The provider reported the call as failed (`is_error`). */
  failed: boolean;
}

/** Output beyond this is cut in the console (the transcript keeps the whole result). */
export const MAX_SHELL_OUTPUT_CHARS = 20_000;

function argsOf(args: unknown): { command: string; description?: string } {
  if (!args || typeof args !== 'object') return { command: '' };
  const a = args as Record<string, unknown>;
  return {
    command: typeof a['command'] === 'string' ? a['command'] : '',
    ...(typeof a['description'] === 'string' ? { description: a['description'] } : {}),
  };
}

function outputOf(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/** Merge persisted history and the live stream, newest last, deduped by callId. */
export function collectShellEntries(
  messages: readonly ChatMessage[] | undefined,
  stream: StreamState | undefined,
): ShellEntry[] {
  const entries = new Map<string, ShellEntry>();
  for (const msg of messages ?? []) {
    for (const tc of msg.metadata?.toolCalls ?? []) {
      if (!isShellTool(tc.tool)) continue;
      entries.set(tc.id, { callId: tc.id, ...argsOf(tc.args), output: outputOf(tc.result), status: 'complete', failed: false });
    }
  }
  for (const block of stream?.blocks ?? []) {
    if (block.type !== 'tool_call' || !isShellTool(block.tool)) continue;
    entries.set(block.callId, {
      callId: block.callId,
      ...argsOf(block.args),
      output: outputOf(block.result),
      status: block.status === 'complete' ? 'complete' : 'running',
      failed: block.error === true,
    });
  }
  return [...entries.values()];
}
