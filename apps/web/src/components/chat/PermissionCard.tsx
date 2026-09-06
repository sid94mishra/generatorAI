// ────────────────────────────────────────────────────────────────
// PermissionCard — the tool-permission gate (review finding 5.1).
//
// A chat set to "ask me before each tool" (`default`) or "accept edits"
// (`acceptEdits`) blocks the agent on `chat.permission.requested` until the
// user allows or denies the call. Deliberately mirrors QuestionCard: same
// pending → settled lifecycle, same "read-only when replayed" rule (a card
// persisted as still pending can never be answered again — the SDK callback
// it was blocking is long gone), same busy/disabled handling.
//
// `inputSummary` arrives already bounded and secret-redacted by the server
// (`ToolPermissionRequestPayload.inputSummary`) — it is rendered verbatim as
// preformatted text, never re-processed (no markdown, no JSON re-parsing).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Check, Loader2, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import type { PermissionBlock } from '@/stores/streamStore.js';

export interface PermissionCardProps {
  permission: PermissionBlock;
  /**
   * Submits the allow/deny decision. Omitted when the card is replayed from
   * persisted history — the SDK callback it was blocking is long gone, so
   * the card is read-only and the action row is hidden.
   */
  onAnswer?: (interactionId: string, behavior: 'allow' | 'deny', message?: string) => void;
  busy?: boolean;
}

export function PermissionCard({ permission, onAnswer, busy }: PermissionCardProps) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');

  const isPending = permission.status === 'pending';
  const isExpired = permission.status === 'expired';
  const isSettled = permission.status === 'allowed' || permission.status === 'denied';
  // A pending card with no answer handler (history replay) can never be
  // answered — render it as the dead card it is.
  const isAnswerable = isPending && !!onAnswer;

  const statusLabel = isAnswerable
    ? 'The agent wants to run a tool'
    : permission.status === 'allowed'
      ? 'Tool call allowed'
      : permission.status === 'denied'
        ? 'Tool call denied'
        : 'Permission request expired';

  const handleAllow = () => onAnswer?.(permission.interactionId, 'allow');
  const handleDenyConfirm = () => {
    const trimmed = reason.trim();
    onAnswer?.(permission.interactionId, 'deny', trimmed || undefined);
    setDenying(false);
    setReason('');
  };
  const handleDenyCancel = () => {
    setDenying(false);
    setReason('');
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-xl border bg-[var(--color-card)]',
        isAnswerable
          ? 'border-[var(--color-warning,#b8860b)]/40 shadow-sm'
          : 'border-[var(--color-border)]/60',
      )}
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-border)]/60 px-3 py-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-warning,#b8860b)]/10 text-[var(--color-warning,#b8860b)]">
          <ShieldAlert className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-medium text-[var(--color-foreground)]">{statusLabel}</span>
      </div>

      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--color-muted)]/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {permission.permissionType}
          </span>
          <span className="font-mono text-xs font-medium text-[var(--color-foreground)]">
            {permission.toolName}
          </span>
        </div>

        {permission.description && (
          <p className="text-xs text-[var(--color-foreground)]/90">{permission.description}</p>
        )}

        {/* Already bounded + secret-redacted by the server — rendered as-is. */}
        {permission.inputSummary && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)]/60 bg-[var(--color-background)] p-2 font-mono text-[11px] text-[var(--color-muted-foreground)]">
            {permission.inputSummary}
          </pre>
        )}

        {isAnswerable && !denying && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              aria-label={`Deny ${permission.toolName}`}
              disabled={busy}
              onClick={() => setDenying(true)}
              className="rounded-md border border-[var(--color-danger)]/40 px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
            >
              Deny
            </button>
            <button
              type="button"
              aria-label={`Allow ${permission.toolName}`}
              disabled={busy}
              onClick={handleAllow}
              className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              Allow
            </button>
          </div>
        )}

        {isAnswerable && denying && (
          <div className="space-y-1.5 pt-1">
            <label
              htmlFor={`deny-reason-${permission.interactionId}`}
              className="block text-[11px] text-[var(--color-muted-foreground)]"
            >
              Reason for denying (optional)
            </label>
            <input
              id={`deny-reason-${permission.interactionId}`}
              type="text"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why deny this? (optional)"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/40"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleDenyCancel}
                className="rounded-md px-2 py-1.5 text-[11px] text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                aria-label={`Confirm deny ${permission.toolName}`}
                disabled={busy}
                onClick={handleDenyConfirm}
                className="flex items-center gap-1.5 rounded-md bg-[var(--color-danger)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldX className="h-3 w-3" />}
                Confirm deny
              </button>
            </div>
          </div>
        )}

        {isSettled && (
          <p
            data-testid="permission-outcome"
            className={cn(
              'flex items-center gap-1.5 text-[11px]',
              permission.status === 'allowed'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-[var(--color-danger)]',
            )}
          >
            {permission.status === 'allowed' ? (
              <Check className="h-3 w-3" />
            ) : (
              <ShieldX className="h-3 w-3" />
            )}
            {permission.status === 'allowed' ? 'Allowed' : 'Denied'}
            {permission.message ? `: ${permission.message}` : ''}
          </p>
        )}

        {isExpired && (
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            This request is no longer answerable — the agent&apos;s turn ended.
          </p>
        )}
      </div>
    </div>
  );
}
