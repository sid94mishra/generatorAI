// ────────────────────────────────────────────────────────────────
// AttachChatDialog — "Attach chat…" from the composer's + menu (D-179): search
// the chats by name and attach one as context. Kit only (D-178): Dialog,
// SearchInput and a list of row buttons in the EntityRow rhythm.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { ChatListItem } from '@generatorai/shared';
import { useChats } from '@/hooks/chatListQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Dialog } from '@/ui/primitives/Dialog/Dialog.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton.js';

export interface AttachChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chat being typed in (never offered). */
  currentChatId: string;
  /** Chats already attached (shown as attached). */
  attachedIds: readonly string[];
  onPick: (chat: ChatListItem) => void;
}

export function AttachChatDialog({ open, onOpenChange, currentChatId, attachedIds, onPick }: AttachChatDialogProps) {
  const [q, setQ] = useState('');
  const { data, isLoading } = useChats({ q: q.trim() || undefined, limit: 30 }, { enabled: open });
  const chats = (data?.items ?? []).filter((c) => c.id !== currentChatId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Attach a chat" size="md" data-testid="attach-chat-dialog">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-small text-fg-2">
          The chat goes with your message as context — the whole thread when it fits, else a summary and its last turns.
        </p>
        <SearchInput value={q} onValueChange={setQ} label="Search chats" placeholder="Search chats by name" shortcut={null} autoFocus />
        <div className="flex max-h-80 flex-col overflow-y-auto" role="list" aria-label="Chats">
          {isLoading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} shape="block" className="my-1 h-row" />)
          ) : chats.length === 0 ? (
            <EmptyState icon="chats" title={q ? 'No chats match' : 'No other chats yet'} />
          ) : (
            chats.map((chat) => {
              const attached = attachedIds.includes(chat.id);
              return (
                // The kit Button wraps children in one truncating label span: the glyph goes in `icon`, the
                // status words stay inline after the name.
                <Button
                  key={chat.id}
                  variant="ghost"
                  fullWidth
                  role="listitem"
                  icon="message"
                  disabled={attached}
                  onClick={() => {
                    onPick(chat);
                    onOpenChange(false);
                  }}
                  className="h-row justify-start gap-2.5 px-2 text-left font-normal text-fg"
                >
                  {chat.name}
                  {attached ? <span className="ml-2 text-small text-fg-3">Attached</span> : null}
                  {chat.status === 'archived' ? <span className="ml-2 text-small text-fg-3">Archived</span> : null}
                </Button>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}
