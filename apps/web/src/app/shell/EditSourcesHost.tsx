// ────────────────────────────────────────────────────────────────
// EditSourcesHost — mounts the "Edit sources" dialog for the chat named in
// `editSourcesStore` (opened by the chat workspace). The body is the legacy
// source editor until B-04 SourcePicker lands (P5); only this host changes.
// Closing the dialog, or navigating away from the chat, clears the store.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useChat } from '@/hooks/queries.js';
import { useEditSourcesStore } from '@/stores/editSourcesStore.js';
import { EditSourcesDialog } from '@/components/chat/sources/EditSourcesDialog.js';

export function EditSourcesHost() {
  const chatId = useEditSourcesStore((s) => s.chatId);
  const close = useEditSourcesStore((s) => s.close);
  const { data: chat } = useChat(chatId ?? undefined);

  const { pathname } = useLocation();
  useEffect(() => {
    if (chatId && pathname !== `/chats/${chatId}`) close();
  }, [chatId, pathname, close]);

  if (!chatId || !chat || chat.id !== chatId) return null;
  return <EditSourcesDialog open onClose={close} chat={chat} />;
}
