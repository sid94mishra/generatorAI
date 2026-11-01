// ────────────────────────────────────────────────────────────────
// sentMessageStore — what the composer just sent, per session: the files and
// chats attached to it. The optimistic bubble shows them as chips until the
// server's copy of the message (which carries them) is fetched, so a prompt's
// attachments are on screen from the moment it is sent — uploads included.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type { ChatMessage, ChatReferenceRecord } from '@generatorai/shared';
import { globalSingleton } from '../lib/globalSingleton.js';

export interface SentMessage {
  /** The prompt as sent — the bubble shows these chips only while it shows this text. */
  prompt: string;
  attachments: NonNullable<ChatMessage['attachments']>;
  chatRefs: readonly Pick<ChatReferenceRecord, 'chatId' | 'name'>[];
}

interface SentMessageState {
  /** Session id → the message its composer sent last. */
  sent: Record<string, SentMessage>;
  record: (sessionId: string, message: SentMessage) => void;
}

const useSentMessageStoreImpl = create<SentMessageState>((set) => ({
  sent: {},
  record: (sessionId, message) => set((s) => ({ sent: { ...s.sent, [sessionId]: message } })),
}));

export const useSentMessageStore = globalSingleton('web.sentMessageStore', () => useSentMessageStoreImpl);
