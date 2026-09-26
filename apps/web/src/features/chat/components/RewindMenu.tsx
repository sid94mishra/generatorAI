// ────────────────────────────────────────────────────────────────
// F-chat-04 RewindMenu — "go back to just before this message".
//
// Anchored on a USER message, because that is what the checkpoint is: the
// files and the conversation the instant before that prompt was sent. Three
// options, Claude Code's `/rewind` split — code, conversation, or both —
// because "undo what it did" and "make it forget we discussed it" are
// different intentions.
//
// Restoring the conversation hands the prompt back to the composer (via
// `rewindStore`) instead of resending it: a rewind that re-ran itself would
// make the destructive option unreviewable. While a turn is in flight the
// server answers 409 CHAT_BUSY, so the control is disabled and says why.
// ────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from 'react';
import { useRewindChat } from '@/hooks/queries.js';
import { useRewindStore } from '@/stores/rewindStore.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { MenuItem, MenuPopup, MenuRoot } from '@/ui/primitives/Menu/Menu.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';

type RewindScope = 'all' | 'code' | 'conversation';

interface RewindFiles {
  restored?: number;
  deleted?: number;
  skipped?: number;
  mounts?: unknown[];
}

export interface RewindMenuProps {
  chatId: string;
  /** The turn this user message opened — the rewind anchor. */
  turnId: string;
  /** Workspace behind the chat, so the file queries can be invalidated. */
  workspaceId?: string | undefined;
  /** False while a turn is in flight (the server would answer 409 anyway). */
  canRewind: boolean;
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

/** "3 files restored, 1 deleted across 2 mounts." — or nothing to say. */
export function describeRewoundFiles(files: RewindFiles | undefined): string | undefined {
  if (!files) return undefined;
  const parts: string[] = [];
  if (files.restored) parts.push(`${files.restored} file${files.restored === 1 ? '' : 's'} restored`);
  if (files.deleted) parts.push(`${files.deleted} deleted`);
  if (files.skipped) parts.push(`${files.skipped} skipped`);
  const mounts = files.mounts?.length ?? 0;
  if (mounts > 1) parts.push(`across ${mounts} mounts`);
  if (parts.length === 0) return 'No files needed changing.';
  return `${parts.join(', ')}.`;
}

/** The provider could not rewind its own history, so the next turn carries a digest. */
export const SYNTHETIC_REWIND_NOTE =
  'The provider does not support native rewind; the model will receive a summary of the surviving conversation with your next message.';

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

export function RewindMenu({ chatId, turnId, workspaceId, canRewind }: RewindMenuProps) {
  const rewind = useRewindChat(chatId, workspaceId);
  // One menu per transcript row is expensive (every user message has this
  // control), so the menu mounts only while open, anchored to the button.
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const offerPrompt = useRewindStore((s) => s.offerPrompt);

  const run = useCallback(
    (scope: RewindScope) => {
      rewind.mutate(
        { turnId, scope },
        {
          onSuccess: (result) => {
            const description = [
              describeRewoundFiles(result.files),
              result.conversation === 'synthetic' ? SYNTHETIC_REWIND_NOTE : undefined,
            ]
              .filter(Boolean)
              .join(' ');
            toast.info('Rewound to before this message', description ? { description } : undefined);
            // The prompt comes back for editing; sending it again is the user's call.
            if (scope !== 'code') offerPrompt(chatId, result.prompt);
          },
          onError: (error: unknown) => {
            const busy = errorCode(error) === 'CHAT_BUSY';
            toast.error(busy ? 'Nothing was rewound' : 'Rewind failed', {
              description: busy
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
  if (disabled) {
    // A disabled button emits no pointer events, so the reason lives on a wrapper.
    return (
      <Tooltip content={rewind.isPending ? 'Rewinding…' : 'Wait for the current response to finish before rewinding'}>
        <span className="inline-flex">
          {rewind.isPending ? (
            <span className="flex size-control-sm items-center justify-center">
              <Spinner size={14} label="Rewinding" />
            </span>
          ) : (
            <IconButton icon="history" label="Rewind to here" size="sm" disabled data-testid="rewind-button" tooltip={false} />
          )}
        </span>
      </Tooltip>
    );
  }

  return (
    <>
      <IconButton
        ref={buttonRef}
        icon="history"
        label="Rewind to here"
        size="sm"
        tooltip={false}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="rewind-button"
      />
      {open ? (
        <MenuRoot open onOpenChange={setOpen}>
          <MenuPopup anchor={buttonRef} align="end" finalFocus={buttonRef} data-testid="rewind-menu">
            {OPTIONS.map((option) => (
              <MenuItem
                key={option.scope}
                description={option.help}
                data-testid={`rewind-option-${option.scope}`}
                onClick={() => run(option.scope)}
              >
                {option.label}
              </MenuItem>
            ))}
          </MenuPopup>
        </MenuRoot>
      ) : null}
    </>
  );
}
