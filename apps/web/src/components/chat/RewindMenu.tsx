// ────────────────────────────────────────────────────────────────
// RewindMenu — "go back to just before this message".
//
// Anchored on a USER message, because that is what the checkpoint is: the
// state of the files and the conversation the instant before that prompt was
// sent. The three options are Claude Code's `/rewind` menu, with the same
// split — code, conversation, or both — because they are genuinely different
// intentions: "undo what it did" vs "make it forget we discussed it".
//
// Restoring the conversation hands the prompt back to the composer (via
// `rewindStore`) instead of resending it. A rewind that re-ran itself would
// make the destructive option unreviewable.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/index.js';
import { toast } from '@/components/Toast.js';
import { useRewindChat } from '@/hooks/queries.js';
import { useRewindStore } from '@/stores/rewindStore.js';
import { ApiError } from '@/platform/apiFetch.js';
import type { RewindScope, RewindChatResult } from '@/platform/HttpPlatformClient.js';
import { cn } from '@/lib/utils.js';

interface RewindMenuProps {
  chatId: string;
  /** The turn this user message opened — the rewind anchor. */
  turnId: string;
  /** Workspace behind the chat, so the file queries can be invalidated. */
  workspaceId?: string | undefined;
  /** False while a turn is in flight: the server would answer 409 anyway. */
  canRewind: boolean;
  className?: string;
}

const OPTIONS: Array<{ scope: RewindScope; label: string; help: string }> = [
  {
    scope: 'all',
    label: 'Restore code and conversation',
    help: 'Files go back to how they were before this message and the conversation forgets it and everything after.',
  },
  {
    scope: 'conversation',
    label: 'Restore conversation only',
    help: 'The conversation forgets this message and everything after it. Files are left exactly as they are now.',
  },
  {
    scope: 'code',
    label: 'Restore code only',
    help: 'Every file the agent changed since this message, including through shell commands, is put back. The conversation is kept.',
  },
];

/** "3 files restored, 1 deleted across 2 folders" — or nothing to say. */
function describeFiles(files: RewindChatResult['files']): string | undefined {
  if (!files) return undefined;
  const parts: string[] = [];
  if (files.restored) parts.push(`${String(files.restored)} file${files.restored === 1 ? '' : 's'} restored`);
  if (files.deleted) parts.push(`${String(files.deleted)} deleted`);
  if (files.skipped) parts.push(`${String(files.skipped)} skipped`);
  const mounts = files.mounts?.length ?? 0;
  if (mounts > 1) parts.push(`across ${String(mounts)} mounts`);
  if (parts.length === 0) return 'No files needed changing.';
  return `${parts.join(', ')}.`;
}

/** The provider could not rewind its own history, so the next turn carries a digest. */
const SYNTHETIC_NOTE =
  'The provider does not support native rewind; the model will receive a summary of the surviving conversation with your next message.';

export function RewindMenu({ chatId, turnId, workspaceId, canRewind, className }: RewindMenuProps) {
  const [open, setOpen] = useState(false);
  const rewind = useRewindChat(chatId, workspaceId);
  const offerPrompt = useRewindStore((s) => s.offerPrompt);

  const run = useCallback(
    (scope: RewindScope) => {
      setOpen(false);
      rewind.mutate(
        { turnId, scope },
        {
          onSuccess: (result) => {
            const description = [
              describeFiles(result.files),
              result.conversation === 'synthetic' ? SYNTHETIC_NOTE : undefined,
            ]
              .filter(Boolean)
              .join(' ');
            toast({
              variant: 'success',
              title: 'Rewound to before this message',
              ...(description ? { description } : {}),
            });
            // The prompt comes back for editing; sending it again is the
            // user's call, never ours.
            if (scope !== 'code') offerPrompt(chatId, result.prompt);
          },
          onError: (error: unknown) => {
            const code = error instanceof ApiError ? error.code : undefined;
            toast({
              variant: 'error',
              title: code === 'CHAT_BUSY' ? 'Nothing was rewound' : 'Rewind failed',
              description:
                code === 'CHAT_BUSY'
                  ? 'This chat is still working on a turn. Stop it first, then rewind.'
                  : error instanceof Error
                    ? error.message
                    : 'The server refused the rewind.',
            });
          },
        },
      );
    },
    [chatId, offerPrompt, rewind, turnId],
  );

  const disabled = !canRewind || rewind.isPending;

  const trigger = (
    <button
      type="button"
      data-testid="rewind-button"
      disabled={disabled}
      aria-label="Rewind to here"
      title="Rewind to here"
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--color-border)]',
        'bg-[var(--color-card)] text-[var(--color-muted-foreground)] shadow-sm transition-colors',
        'hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      {rewind.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <History className="h-3.5 w-3.5" />
      )}
    </button>
  );

  // A disabled trigger never opens the popover, so the reason has to be the
  // tooltip — otherwise the control is simply inert with no explanation. The
  // span is load-bearing: a disabled button emits no pointer events, so the
  // tooltip would never fire if it were the trigger itself.
  if (disabled) {
    return (
      <Tooltip
        content={
          rewind.isPending ? 'Rewinding…' : 'Wait for the current response to finish before rewinding'
        }
      >
        <span className={cn('inline-flex', className)}>{trigger}</span>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1.5" data-testid="rewind-menu">
        <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Rewind to here
        </p>
        {OPTIONS.map((option) => (
          <button
            key={option.scope}
            type="button"
            data-testid={`rewind-option-${option.scope}`}
            onClick={() => run(option.scope)}
            className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-subtle)]"
          >
            <span className="block text-[13px] font-medium text-[var(--color-foreground)]">
              {option.label}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-muted-foreground)]">
              {option.help}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
