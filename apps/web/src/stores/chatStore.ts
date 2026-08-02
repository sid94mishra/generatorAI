// ────────────────────────────────────────────────────────────────
// chatStore — Zustand store for v2 Chat-specific state
//
// Manages the active chat context and adapts the existing
// streamStore for chat-centric usage. Chats own sessions,
// so this store maps chatId → sessionId for SSE routing.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type { Chat } from '@generatorai/shared';

export interface ChatState {
  /** Currently active chat ID (the one being viewed) */
  activeChatId: string | null;
  /** Map of chatId → sessionId for SSE event routing */
  chatSessionMap: Record<string, string>;
  /** Map of chatId → Chat entity (cached for sidebar status etc.) */
  chatCache: Record<string, Chat>;
}

interface ChatStoreActions {
  /** Set the currently active chat */
  setActiveChatId: (chatId: string | null) => void;
  /** Register a chat → session mapping for SSE routing */
  registerChat: (chatId: string, sessionId: string, chat?: Chat) => void;
  /** Remove a chat mapping (on delete/archive) */
  unregisterChat: (chatId: string) => void;
  /** Update cached chat entity */
  updateChatCache: (chatId: string, chat: Chat) => void;
  /** Get sessionId for a chat */
  getSessionId: (chatId: string) => string | undefined;
  /** Bulk update chat cache from API response */
  bulkUpdateCache: (chats: Chat[]) => void;
  /** Clear all state */
  reset: () => void;
}

const initialState: ChatState = {
  activeChatId: null,
  chatSessionMap: {},
  chatCache: {},
};

export const useChatStore = create<ChatState & ChatStoreActions>((set, get) => ({
  ...initialState,

  setActiveChatId: (chatId) => set({ activeChatId: chatId }),

  registerChat: (chatId, sessionId, chat) => set((state) => ({
    chatSessionMap: { ...state.chatSessionMap, [chatId]: sessionId },
    chatCache: chat
      ? { ...state.chatCache, [chatId]: chat }
      : state.chatCache,
  })),

  unregisterChat: (chatId) => set((state) => {
    const { [chatId]: _session, ...restMap } = state.chatSessionMap;
    const { [chatId]: _chat, ...restCache } = state.chatCache;
    return {
      chatSessionMap: restMap,
      chatCache: restCache,
      activeChatId: state.activeChatId === chatId ? null : state.activeChatId,
    };
  }),

  updateChatCache: (chatId, chat) => set((state) => ({
    chatCache: { ...state.chatCache, [chatId]: chat },
  })),

  getSessionId: (chatId) => get().chatSessionMap[chatId],

  bulkUpdateCache: (chats) => set((state) => {
    const updated = { ...state.chatCache };
    const updatedMap = { ...state.chatSessionMap };
    for (const chat of chats) {
      updated[chat.id] = chat;
      updatedMap[chat.id] = chat.sessionId;
    }
    return { chatCache: updated, chatSessionMap: updatedMap };
  }),

  reset: () => set(initialState),
}));
