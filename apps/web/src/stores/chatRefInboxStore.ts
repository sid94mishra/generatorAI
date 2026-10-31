// ────────────────────────────────────────────────────────────────
// chatRefInboxStore — chats waiting to be attached to another chat's composer
// (D-179). A side chat's "Send to main chat" (D-180) drops itself here for its
// parent; the parent's composer takes them on its next render and shows them
// as chips. Cross-feature actions go through stores (04 §0).
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type { ChatReferenceMode } from '@generatorai/shared';
import { globalSingleton } from '../lib/globalSingleton.js';

export interface InboxChatRef {
  chatId: string;
  name: string;
  mode: ChatReferenceMode;
}

interface ChatRefInboxState {
  /** Target chat id → chats to attach to its composer. */
  inbox: Record<string, readonly InboxChatRef[]>;
  push: (targetChatId: string, ref: InboxChatRef) => void;
  clear: (targetChatId: string) => void;
}

const useChatRefInboxStoreImpl = create<ChatRefInboxState>((set) => ({
  inbox: {},
  push: (target, ref) =>
    set((s) => {
      const cur = s.inbox[target] ?? [];
      return cur.some((r) => r.chatId === ref.chatId) ? s : { inbox: { ...s.inbox, [target]: [...cur, ref] } };
    }),
  clear: (target) =>
    set((s) => {
      if (!(target in s.inbox)) return s;
      const next = { ...s.inbox };
      delete next[target];
      return { inbox: next };
    }),
}));

export const useChatRefInboxStore = globalSingleton('web.chatRefInboxStore', () => useChatRefInboxStoreImpl);
