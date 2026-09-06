// ────────────────────────────────────────────────────────────────
// ToolMessage — Renders tool call/result messages with styled groups
//
// NOTE (duplication risk): tool calls now also render as StepRow
// entries inside StreamPanel when they are persisted on the assistant
// message's metadata.toolCalls (the v2 chat path — see
// ChatManagementService). Standalone role:'tool' messages only come
// from the legacy harness replay path (CopilotProvider.getMessages),
// which does NOT populate assistant metadata, so both renderings do
// not appear for the same history today. If a future persistence path
// writes both, dedup here rather than deleting this component.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import type { ChatMessage } from '@generatorai/shared';
import { Wrench, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/index.js';

interface ToolMessageProps {
  message: ChatMessage;
}

export function ToolMessage({ message }: ToolMessageProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mx-2">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-warning-muted)] overflow-hidden">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-warning)]/10"
        >
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-warning)]/15">
            <Wrench className="h-3 w-3 text-[var(--color-warning)]" />
          </div>
          <span className="text-xs font-semibold text-[var(--color-foreground)]">{message.toolName ?? 'Tool'}</span>
          <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" />
          <span className="text-[10px] text-[var(--color-muted-foreground)]">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
          <div className="ml-auto">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-[var(--color-warning)]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[var(--color-warning)]" />
            )}
          </div>
        </Button>

        {expanded && (
          <div className="border-t border-[var(--color-warning)]/20 px-4 py-3 space-y-2">
            {message.toolArgs != null && (
              <div>
                <span className="text-[10px] font-semibold text-[var(--color-muted-foreground)]">Arguments:</span>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-[var(--color-muted)] p-2.5 text-[10px] font-mono text-[var(--color-foreground)]">
                  {String(JSON.stringify(message.toolArgs, null, 2))}
                </pre>
              </div>
            )}
            {message.toolResult != null && (
              <div>
                <span className="text-[10px] font-semibold text-[var(--color-muted-foreground)]">Result:</span>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-[var(--color-muted)] p-2.5 text-[10px] font-mono text-[var(--color-foreground)]">
                  {typeof message.toolResult === 'string'
                    ? message.toolResult
                    : String(JSON.stringify(message.toolResult, null, 2))}
                </pre>
              </div>
            )}
            {message.content && (
              <p className="text-xs text-[var(--color-muted-foreground)] leading-relaxed">{message.content}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
