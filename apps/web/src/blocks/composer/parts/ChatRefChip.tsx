// ────────────────────────────────────────────────────────────────
// ChatRefChip — a chat attached to the draft as context (D-179): the same
// chip as a file (`composer-attachment` size, radius, ×) with the `message`
// glyph, the chat's name and its mode. Clicking it opens the mode popover:
// Auto / Summary / Recent / Full and what that mode includes.
// ────────────────────────────────────────────────────────────────

import { CHAT_REFERENCE_MODE_LABEL, CHAT_REFERENCE_MODES, type ChatReferenceMode } from '@generatorai/shared';
import { useChatReferencePreview } from '@/hooks/queries.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { useState } from 'react';
import type { ComposerChatRef } from '../model/types.js';

const MODE_HINT: Record<ChatReferenceMode, string> = {
  auto: 'The whole chat when it fits, else a summary and the last three turns.',
  summary: 'A summary of the whole chat.',
  recent: 'The last three turns, word for word.',
  full: 'Every turn; the oldest are left out past the limit.',
};

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

export interface ChatRefChipProps {
  chatRef: ComposerChatRef;
  onModeChange: (mode: ChatReferenceMode) => void;
  onRemove: () => void;
}

/** One attached chat (`composer-chat-ref`). */
export function ChatRefChip({ chatRef, onModeChange, onRemove }: ChatRefChipProps) {
  const [open, setOpen] = useState(false);
  const preview = useChatReferencePreview(chatRef.chatId, chatRef.mode, { enabled: open });
  const p = preview.data;
  const includes = p
    ? p.resolvedMode === 'summary' && chatRef.mode !== 'summary'
      ? `Summary + last ${p.includedTurns} of ${p.totalTurns} turns`
      : p.resolvedMode === 'summary'
        ? `Summary of ${p.totalTurns} turns`
        : `${p.includedTurns} of ${p.totalTurns} turns`
    : null;
  return (
    <div
      data-testid="composer-chat-ref"
      className="inline-flex h-control-sm max-w-full min-w-0 items-center gap-1 rounded-control-sm border border-line bg-raised pr-0.5 pl-2 text-small text-fg"
    >
      <PopoverRoot open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-w-0 gap-1.5 border-0 px-0 text-fg hover:not-disabled:bg-transparent"
              aria-label={`Attached chat ${chatRef.name}, ${CHAT_REFERENCE_MODE_LABEL[chatRef.mode]}. Change what is included`}
            >
              <Icon concept="message" size={12} className="shrink-0 text-fg-3" />
              <span className="max-w-43 truncate">{chatRef.name}</span>
              <span className="shrink-0 text-micro text-fg-3">{CHAT_REFERENCE_MODE_LABEL[chatRef.mode]}</span>
            </Button>
          }
        />
        <PopoverPopup side="top" align="start" className="flex w-80 flex-col gap-2.5 p-3" data-testid="chat-ref-popover">
          <PopoverTitle className="truncate text-ui font-medium text-fg">{chatRef.name}</PopoverTitle>
          <SegmentedControl<ChatReferenceMode>
            label="What to include"
            size="sm"
            fullWidth
            value={chatRef.mode}
            onValueChange={onModeChange}
            items={CHAT_REFERENCE_MODES.map((m) => ({ value: m, label: CHAT_REFERENCE_MODE_LABEL[m] }))}
          />
          <p className="text-small text-fg-2">{MODE_HINT[chatRef.mode]}</p>
          <p className="flex items-center gap-1.5 text-small text-fg-3" data-testid="chat-ref-preview">
            {preview.isLoading ? (
              <>
                <Spinner size={12} /> Counting…
              </>
            ) : p ? (
              `${includes} · ~${formatTokens(p.tokens)} tokens · taken when you send`
            ) : preview.isError ? (
              'Could not read this chat.'
            ) : null}
          </p>
        </PopoverPopup>
      </PopoverRoot>
      <IconButton icon="x" size="sm" label={`Remove ${chatRef.name}`} tooltip={false} onClick={onRemove} className="size-4" />
    </div>
  );
}
