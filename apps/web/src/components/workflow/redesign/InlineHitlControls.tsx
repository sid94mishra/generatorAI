// ────────────────────────────────────────────────────────────────
// InlineHitlControls — approve / request-changes / reject.
// Renders inside a stage card when status = 'awaiting_input'.
// Semantics:
//   • Approve         → outcome 'approved'. Any typed feedback is IGNORED;
//                       the stage completes and the DAG advances.
//   • Request changes → outcome 'changes_requested'. The feedback is sent to
//                       the stage's session as a follow-up prompt; the agent
//                       responds and the stage re-parks for another review
//                       round. Feedback is required, and this loop repeats
//                       until the reviewer approves or rejects.
//   • Reject          → outcome 'rejected'. TERMINAL: the stage fails, which
//                       blocks every downstream stage and stops the run.
//                       Confirmed before firing because it is not undoable.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Check, X, Hand, Ban } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Textarea } from '@/components/ui/index.js';

interface InlineHitlControlsProps {
  reason: string;
  tool?: string;
  args?: Record<string, unknown>;
  onApprove?: (followUp?: string) => void;
  onReject?: (feedback?: string) => void;
  /** Terminal rejection. Omit to hide the action (e.g. legacy interrupts). */
  onTerminalReject?: (reason?: string) => void;
}

export function InlineHitlControls({
  reason,
  tool,
  args,
  onApprove,
  onReject,
  onTerminalReject,
}: InlineHitlControlsProps) {
  const [feedback, setFeedback] = useState('');
  const [confirmingReject, setConfirmingReject] = useState(false);

  const trimmed = feedback.trim();

  return (
    <section
      className={cn(
        'rounded-lg border-l-2 border-[var(--color-warning)] bg-[var(--color-warning)]/[0.06] p-3 space-y-2.5',
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <Hand className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)] animate-status-breathe" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-[var(--color-warning)]">Awaiting your approval</p>
          <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--color-foreground)]/85">
            {reason}
          </p>
          {tool && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)]">
              <span>Tool:</span>
              <code className="rounded bg-[var(--color-subtle)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--color-foreground)]">
                {tool}
              </code>
            </div>
          )}
          {args && Object.keys(args).length > 0 && (
            <pre className="mt-1.5 max-h-32 overflow-auto rounded bg-[var(--color-background)]/80 p-2 text-[10.5px] font-mono text-[var(--color-foreground)]/75">
              {JSON.stringify(args, null, 2)}
            </pre>
          )}
        </div>
      </div>

      <Textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={2}
        placeholder="Optional feedback — required to request changes…"
        className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-[12px] text-[var(--color-foreground)] focus:border-[var(--color-primary)]/50 focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => onApprove?.(undefined)}
          variant="ghost"
          size="sm"
          className="h-auto flex items-center gap-1.5 rounded-md bg-[var(--color-success)] px-3 py-1 text-[11.5px] font-semibold text-white hover:brightness-110"
        >
          <Check className="h-3.5 w-3.5" />
          Approve &amp; continue
        </Button>
        <Button
          type="button"
          onClick={() => onReject?.(trimmed.length > 0 ? trimmed : undefined)}
          disabled={trimmed.length === 0}
          title={trimmed.length === 0 ? 'Enter feedback above to request changes' : 'Send feedback as a follow-up prompt'}
          variant="ghost"
          size="sm"
          className="h-auto flex items-center gap-1.5 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-1 text-[11.5px] font-semibold text-[var(--color-warning)] hover:bg-[var(--color-warning)]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Request changes
        </Button>

        {/* Terminal reject — two-step because it fails the stage and blocks
            every downstream stage. There is no undo. */}
        {onTerminalReject && !confirmingReject && (
          <Button
            type="button"
            onClick={() => setConfirmingReject(true)}
            title="Reject this stage and stop the workflow run"
            variant="ghost"
            size="sm"
            className="h-auto ml-auto flex items-center gap-1.5 rounded-md border border-[var(--color-danger)]/40 px-3 py-1 text-[11.5px] font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
          >
            <Ban className="h-3.5 w-3.5" />
            Reject
          </Button>
        )}
        {onTerminalReject && confirmingReject && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-danger)]">
              Stops the run. Downstream stages will not execute.
            </span>
            <Button
              type="button"
              onClick={() => {
                setConfirmingReject(false);
                onTerminalReject(trimmed.length > 0 ? trimmed : undefined);
              }}
              variant="ghost"
              size="sm"
              className="h-auto rounded-md bg-[var(--color-danger)] px-3 py-1 text-[11.5px] font-semibold text-white hover:brightness-110"
            >
              Confirm reject
            </Button>
            <Button
              type="button"
              onClick={() => setConfirmingReject(false)}
              variant="ghost"
              size="sm"
              className="h-auto rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--color-muted-foreground)] hover:bg-transparent hover:text-[var(--color-foreground)]"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
