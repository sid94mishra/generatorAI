// ────────────────────────────────────────────────────────────────
// chatGlanceStore — whether the chat summary card shows beside the
// transcript. A way of reading chats on this device, so one setting for every
// chat, persisted in browser storage (shown until the person hides it).
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { globalSingleton } from '../lib/globalSingleton.js';

interface ChatGlanceState {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

const useChatGlanceStoreImpl = create<ChatGlanceState>()(
  persist(
    (set) => ({
      open: true,
      toggle: () => set((s) => ({ open: !s.open })),
      setOpen: (open) => set({ open }),
    }),
    { name: 'generatorai:chatGlance' },
  ),
);

export const useChatGlanceStore = globalSingleton('web.chatGlanceStore', () => useChatGlanceStoreImpl);
