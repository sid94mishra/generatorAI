// ────────────────────────────────────────────────────────────────
// PlanCard — the in-transcript plan document chip (PLN-01)
//
// Renders where the agent produced the plan, so the transcript reads
// research → questions → plan → implementation. Clicking the file chip opens
// the Plan tab in the right pane; the action row is the fast path for a
// straightforward approve / request-changes.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  FileText,
  Check,
  MessageSquarePlus,
  ChevronDown,
  Loader2,
  CircleSlash,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Textarea } from '@/components/ui/index.js';
import type { PlanBlock } from '@/stores/streamStore.js';

export interface PlanCardProps {
  plan: PlanBlock;
  /** Opens the Plan tab in the right pane. */
  /**
   * Opens the plan in the right-pane Plan tab. Omitted when the card is
   * rendered from persisted history, where there is no live gate to act on;
   * the header then degrades to static text instead of a button.
   */
  onOpen?: (planId: string) => void;
  onApprove?: (planId: string, action: 'implement_interactive' | 'implement_autopilot') => void;
  onRequestChanges?: (planId: string, feedback: string) => void;
  busy?: boolean;
}

/**
 * Status presentation.
 *
 * Every status carries an icon AND a label — colour alone is not an accessible
 * status indicator.
 */
const STATUS_META: Record<
  PlanBlock['status'],
  { label: string; className: string; Icon: typeof Check }
> = {
  drafting: {
    label: 'Drafting',
    className: 'bg-[var(--color-muted)]/40 text-[var(--color-muted-foreground)]',
    Icon: Loader2,
  },
  recorded: {
    // Captured in an autonomous mode: informational only, no gate was opened.
    label: 'Recorded',
    className: 'bg-[var(--color-muted)]/40 text-[var(--color-muted-foreground)]',
    Icon: FileText,
  },
  awaiting_review: {
    label: 'Needs review',
    className: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]',
    Icon: Clock,
  },
  changes_requested: {
    label: 'Changes requested',
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    Icon: MessageSquarePlus,
  },
  approved: {
    label: 'Approved',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    Icon: Check,
  },
  rejected: {
    label: 'Discarded',
    className: 'bg-[var(--color-muted)]/40 text-[var(--color-muted-foreground)]',
    Icon: CircleSlash,
  },
  superseded: {
    label: 'Superseded',
    className: 'bg-[var(--color-muted)]/40 text-[var(--color-muted-foreground)]',
    Icon: CircleSlash,
  },
  expired: {
    label: 'Expired',
    className: 'bg-[var(--color-muted)]/40 text-[var(--color-muted-foreground)]',
    Icon: AlertTriangle,
  },
};

/**
 * Renders the model's summary/title as plain text.
 *
 * The card shows these in a truncated single-line chip and a two-line clamp,
 * so a real markdown renderer is the wrong tool — but the raw source is not
 * presentable either (models routinely open with `**Goal:** …`). Strip the
 * inline markers and collapse whitespace instead.
 */
function toPlainText(value: string): string {
  return value
    .replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|>\s*)/gm, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function PlanCard({ plan, onOpen, onApprove, onRequestChanges, busy }: PlanCardProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [showActions, setShowActions] = useState(false);

  const meta = STATUS_META[plan.status];
  const isActionable = plan.status === 'awaiting_review';
  const canAutopilot = plan.actions.includes('implement_autopilot');
  const title = toPlainText(plan.title);
  const summary = plan.summary ? toPlainText(plan.summary) : '';

  return (
    <div
      className={cn(
        'rounded-xl border bg-[var(--color-card)] transition-colors',
        isActionable
          ? 'border-[var(--color-primary)]/40 shadow-sm'
          : 'border-[var(--color-border)]/60',
      )}
    >
      {/* Header — the file chip is the primary "open the plan" affordance. */}
      <div className="flex items-start gap-3 p-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onOpen ? () => onOpen(plan.planId) : undefined}
          disabled={!onOpen}
          className={cn(
            'flex h-auto min-w-0 flex-1 items-start gap-3 whitespace-normal p-0 text-left font-normal',
            // The chip had no hover chrome and no dimmed disabled state before
            // it became a <Button>; keep both off so the card looks unchanged.
            'hover:bg-transparent disabled:cursor-default disabled:opacity-100',
            // Replayed history has no Plan tab to open; drop the affordance
            // rather than offering a button that does nothing.
            onOpen ? 'cursor-pointer' : 'cursor-default',
          )}
          {...(onOpen ? { 'aria-label': `Open plan ${title}` } : {})}
        >
          <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <FileText className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-medium text-[var(--color-foreground)]">
                {title}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  meta.className,
                )}
              >
                <meta.Icon
                  className={cn('h-2.5 w-2.5', plan.status === 'drafting' && 'animate-spin')}
                />
                {meta.label}
              </span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--color-muted-foreground)]">
              {plan.fileName && (
                <span className="truncate font-mono">{plan.fileName}</span>
              )}
              <span>Revision {plan.revision}</span>
            </span>
            {summary && summary !== title && (
              <span className="mt-1 block line-clamp-2 text-xs text-[var(--color-muted-foreground)]">
                {summary}
              </span>
            )}
          </span>
        </Button>
      </div>

      {/* Action row — only while the gate is actually open. */}
      {isActionable && (onApprove || onRequestChanges) && (
        <div className="border-t border-[var(--color-border)]/60 p-2">
          {!showFeedback ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {onOpen && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpen(plan.planId)}
                className="h-auto rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
              >
                Review plan
              </Button>
              )}
              <div className="relative">
                <div className="flex items-stretch">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() => onApprove?.(plan.planId, 'implement_interactive')}
                    className={cn(
                      'flex h-auto items-center gap-1.5 bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90',
                      // Square right edge only while the split-button caret is there.
                      canAutopilot ? 'rounded-l-md rounded-r-none' : 'rounded-md',
                    )}
                  >
                    {!busy && <Check className="h-3 w-3" />}
                    Approve &amp; implement
                  </Button>
                  {canAutopilot && (
                    <Button
                      type="button"
                      variant="primary"
                      disabled={busy}
                      aria-label="More approval options"
                      aria-haspopup="menu"
                      aria-expanded={showActions}
                      onClick={() => setShowActions((p) => !p)}
                      className="h-auto rounded-r-md rounded-l-none border-l border-[var(--color-primary-foreground)]/20 bg-[var(--color-primary)] px-1.5 text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {showActions && canAutopilot && (
                  <div
                    role="menu"
                    className="absolute bottom-full left-0 z-50 mb-1.5 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 shadow-2xl"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      role="menuitem"
                      onClick={() => {
                        setShowActions(false);
                        onApprove?.(plan.planId, 'implement_autopilot');
                      }}
                      className="block h-auto w-full whitespace-normal rounded-md px-2 py-1.5 text-left text-xs font-normal text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)]"
                    >
                      <span className="block font-medium">Approve &amp; run autonomously</span>
                      <span className="block text-[10px] text-[var(--color-muted-foreground)]">
                        Skips per-action prompts while implementing.
                      </span>
                    </Button>
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setShowFeedback(true)}
                className="h-auto flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)]"
              >
                <MessageSquarePlus className="h-3 w-3" />
                Request changes
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <label
                htmlFor={`plan-feedback-${plan.planId}`}
                className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]"
              >
                What should change?
              </label>
              <Textarea
                id={`plan-feedback-${plan.planId}`}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Be specific — this goes straight to the agent."
                className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-xs text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/40"
              />
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowFeedback(false);
                    setFeedback('');
                  }}
                  className="h-auto rounded-md px-2.5 py-1.5 text-xs font-normal text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={busy || feedback.trim().length === 0}
                  loading={busy}
                  onClick={() => {
                    onRequestChanges?.(plan.planId, feedback.trim());
                    setShowFeedback(false);
                    setFeedback('');
                  }}
                  className="h-auto flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90"
                >
                  Send feedback
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
