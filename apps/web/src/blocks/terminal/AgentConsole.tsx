// ────────────────────────────────────────────────────────────────
// AgentConsole — the agent's shell commands, read-only (F-dock-03; board
// DockTerminal "Agent console").
//
// Header "Agent commands · N run in this chat" + Back to shell; a read-only
// note; one block per command: status glyph, `$ command`, purpose line, then
// its output (cut at 20,000 chars) once it finishes. The command opened from
// a transcript step is ringed and scrolled into view. Duration is not shown:
// no source reports it for shell calls (D-36).
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef } from 'react';
import type { ChatMessage } from '@generatorai/shared';
import type { StreamState } from '@/stores/streamStore.js';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { collectShellEntries, MAX_SHELL_OUTPUT_CHARS, type ShellEntry } from './agentConsoleEntries.js';

export interface AgentConsoleProps {
  messages: readonly ChatMessage[] | undefined;
  stream: StreamState | undefined;
  /** The command opened from the transcript: ringed and scrolled to. */
  selectedCallId: string | null;
  /** "Back to shell". */
  onClose: () => void;
}

export function AgentConsole({ messages, stream, selectedCallId, onClose }: AgentConsoleProps) {
  const entries = useMemo(() => collectShellEntries(messages, stream), [messages, stream]);
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' });
  }, [selectedCallId, entries.length]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-panel-bar shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <Icon concept="terminal" size={14} className="text-fg-3" />
        <span className="text-ui font-semibold text-fg">Agent commands</span>
        <span className="font-mono text-small text-fg-3">{entries.length} run in this chat</span>
        <Button variant="secondary" size="sm" icon="back" className="ml-auto" onClick={onClose}>
          Back to shell
        </Button>
      </div>
      <p className="m-0 flex shrink-0 items-start gap-2 border-b border-line-soft px-3 py-2 text-small text-fg-3">
        <Icon concept="lock" size={14} className="mt-0.5 shrink-0" />
        Read-only. The agent runs commands in its own sandboxed shell; output appears the moment each command finishes.
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <p className="m-0 px-2 py-4 text-center text-small text-fg-3">No agent commands in this chat yet.</p>
        ) : (
          entries.map((entry) => (
            <ShellEntryCard
              key={entry.callId}
              entry={entry}
              selected={entry.callId === selectedCallId}
              {...(entry.callId === selectedCallId ? { cardRef: selectedRef } : {})}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ShellEntryCard({
  entry,
  selected,
  cardRef,
}: {
  entry: ShellEntry;
  selected: boolean;
  cardRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const truncated = entry.output.length > MAX_SHELL_OUTPUT_CHARS;
  return (
    <div
      ref={cardRef}
      data-testid="agent-console-entry"
      className={cn(
        'shrink-0 overflow-hidden rounded-card border bg-raised',
        selected ? 'border-accent ring-1 ring-accent' : 'border-line-soft',
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="mt-0.5 flex shrink-0">
          {entry.status === 'running' ? (
            <Spinner size={14} label="Running" className="text-run" />
          ) : entry.failed ? (
            <Icon concept="status-failed" size={14} label="Failed" className="text-err" />
          ) : (
            <Icon concept="status-succeeded" size={14} label="Finished" className="text-ok" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-small break-all whitespace-pre-wrap text-fg">
            <span className="text-fg-3 select-none">$ </span>
            {entry.command || '(no command)'}
          </div>
          {entry.description ? <div className="mt-0.5 text-small text-fg-3">{entry.description}</div> : null}
        </div>
      </div>
      {entry.status === 'running' ? (
        <div className="border-t border-line-soft px-3 py-2 text-small text-fg-3">
          Running — output arrives when the command finishes…
        </div>
      ) : entry.output ? (
        <pre className="m-0 max-h-72 overflow-auto border-t border-line-soft bg-sunken px-3 py-2 font-mono text-small leading-normal break-all whitespace-pre-wrap text-fg-2">
          {truncated ? `${entry.output.slice(0, MAX_SHELL_OUTPUT_CHARS)}\n… (output truncated)` : entry.output}
        </pre>
      ) : (
        <div className="border-t border-line-soft px-3 py-2 text-small text-fg-3">(no output)</div>
      )}
    </div>
  );
}
