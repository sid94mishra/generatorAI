// ────────────────────────────────────────────────────────────────
// useNoSourceNotice — say so when a chat has no folder of the person's
// linked: the agent works in an empty folder of its own, which is easy to
// miss until it "can't find" the code. Shown once per chat per session, with
// the way to link one (a started chat can still choose its working directory
// once).
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import type { Chat, WorkspaceMount } from '@generatorai/shared';
import { toast } from '@/ui/primitives/Toast/Toast.js';

/** Chats already told this session. */
const told = new Set<string>();

export function useNoSourceNotice(
  chat: Pick<Chat, 'id' | 'parentChatId' | 'sideOfChatId' | 'status'> | undefined,
  mounts: readonly WorkspaceMount[] | undefined,
  started: boolean,
  onChoose: () => void,
): void {
  const live = (mounts ?? []).filter((m) => m.status !== 'removed');
  // Nothing of the person's: only the chat's own folder (or nothing prepared yet).
  const noSource = !!mounts && live.length > 0 && live.every((m) => m.mode === 'generated');
  const eligible = !!chat && noSource && chat.status === 'active' && !chat.parentChatId && !chat.sideOfChatId;
  useEffect(() => {
    if (!eligible || !chat || told.has(chat.id)) return;
    told.add(chat.id);
    toast.info('No folder linked to this chat', {
      id: `no-source-${chat.id}`,
      description: started
        ? 'The agent works in an empty folder of its own. You can still choose its working directory — once.'
        : 'The agent will work in an empty folder of its own. Choose a folder to work on your files.',
      action: { label: 'Choose a folder', onClick: onChoose },
      duration: 12_000,
    });
  }, [eligible, chat, started, onChoose]);
}
