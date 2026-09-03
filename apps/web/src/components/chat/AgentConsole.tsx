// ────────────────────────────────────────────────────────────────
// AgentConsole — the agent's shell commands, terminal-styled.
//
// The harness executes Bash / PowerShell inside its own per-turn CLI
// process, so there is no PTY to attach to and (per the SDK contract)
// no incremental stdout for foreground commands — `tool_progress`
// carries elapsed time only. What CAN be shown honestly is exactly
// what this renders: every command the agent ran in this chat, its
// live running state, and its full output the moment it completes.
//
// Reached from the terminal icon on a command chip in the streaming
// panel; renders inside the integrated Terminal tab in place of the
// interactive shell until closed.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Loader2, CircleX, SquareTerminal } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import type { ChatMessage } from '@generatorai/shared';
import type { StreamState } from '@/stores/streamStore.js';
import { isShellTool } from '@/components/agent/deriveTimeline.js';

interface ShellEntry {
  callId: string;
  command: string;
  description?: string;
  output?: string;
  status: 'running' | 'complete';
  failed: boolean;
}

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
  try { return JSON.stringify(result, null, 2); } catch { return String(result); }
}

/** Merge persisted history and the live stream, newest last, deduped by callId. */
function collectShellEntries(
  messages: readonly ChatMessage[] | undefined,
  stream: StreamState | undefined,
): ShellEntry[] {
  const entries = new Map<string, ShellEntry>();
  for (const msg of messages ?? []) {
    for (const tc of msg.metadata?.toolCalls ?? []) {
      if (!isShellTool(tc.tool)) continue;
      const { command, description } = argsOf(tc.args);
      entries.set(tc.id, {
        callId: tc.id,
        command,
        ...(description ? { description } : {}),
        output: outputOf(tc.result),
        status: 'complete',
        failed: false,
      });
    }
  }
  for (const block of stream?.blocks ?? []) {
    if (block.type !== 'tool_call' || !isShellTool(block.tool)) continue;
    const { command, description } = argsOf(block.args);
    entries.set(block.callId, {
      callId: block.callId,
      command,
      ...(description ? { description } : {}),
      output: outputOf(block.result),
      status: block.status === 'complete' ? 'complete' : 'running',
      failed: false,
    });
  }
  return [...entries.values()];
}

const MAX_OUTPUT_CHARS = 20_000;

export function AgentConsole({
  messages,
  stream,
  selectedCallId,
  onClose,
}: {
  messages: readonly ChatMessage[] | undefined;
  stream: StreamState | undefined;
  selectedCallId: string | null;
  onClose: () => void;
}) {
  const entries = useMemo(() => collectShellEntries(messages, stream), [messages, stream]);
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' });
  }, [selectedCallId, entries.length]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-background)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
        <SquareTerminal className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
        <span className="text-[12px] font-medium text-[var(--color-foreground)]/85">
          Agent commands
        </span>
        <span className="text-[10.5px] text-[var(--color-muted-foreground)]/80">
          {entries.length} run in this chat
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3 w-3" /> Back to shell
        </button>
      </div>
      <p className="border-b border-[var(--color-border)]/50 px-3 py-1 text-[10.5px] leading-snug text-[var(--color-muted-foreground)]/75">
        The agent runs commands in its own sandboxed shell — output appears here the
        moment each command finishes.
      </p>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 font-mono text-[11.5px]">
        {entries.length === 0 && (
          <p className="px-2 py-4 text-center font-sans text-[11.5px] text-[var(--color-muted-foreground)]">
            No agent commands in this chat yet.
          </p>
        )}
        {entries.map((entry) => {
          const selected = entry.callId === selectedCallId;
          const output = entry.output ?? '';
          const truncated = output.length > MAX_OUTPUT_CHARS;
          return (
            <div
              key={entry.callId}
              ref={selected ? selectedRef : null}
              data-testid="agent-console-entry"
              className={cn(
                'rounded-md border bg-[var(--color-card)]/50',
                selected
                  ? 'border-[var(--color-primary)]/60 ring-1 ring-[var(--color-primary)]/30'
                  : 'border-[var(--color-border)]/70',
              )}
            >
              <div className="flex items-start gap-2 px-2.5 py-1.5">
                {entry.status === 'running' ? (
                  <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-[var(--color-primary)]" />
                ) : entry.failed ? (
                  <CircleX className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-danger)]" />
                ) : (
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-success)]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap break-all text-[var(--color-foreground)]/90">
                    <span className="select-none text-[var(--color-muted-foreground)]">$ </span>
                    {entry.command || '(no command)'}
                  </div>
                  {entry.description && (
                    <div className="mt-0.5 font-sans text-[10.5px] text-[var(--color-muted-foreground)]/80">
                      {entry.description}
                    </div>
                  )}
                </div>
              </div>
              {entry.status === 'running' ? (
                <div className="border-t border-[var(--color-border)]/50 px-2.5 py-1.5 text-[10.5px] italic text-[var(--color-muted-foreground)]/70">
                  Running — output arrives when the command finishes…
                </div>
              ) : output ? (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all border-t border-[var(--color-border)]/50 px-2.5 py-1.5 text-[11px] leading-snug text-[var(--color-foreground)]/75">
                  {truncated ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n… (output truncated)` : output}
                </pre>
              ) : (
                <div className="border-t border-[var(--color-border)]/50 px-2.5 py-1.5 text-[10.5px] italic text-[var(--color-muted-foreground)]/60">
                  (no output)
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
