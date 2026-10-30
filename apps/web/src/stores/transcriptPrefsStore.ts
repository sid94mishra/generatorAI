// ────────────────────────────────────────────────────────────────
// transcriptPrefsStore — the transcript view mode per chat (G-06).
//
// Normal / Verbose / Summary is a way of READING a transcript on this device,
// not a property of the chat, so it is device-local (05-gap-matrix G-06):
// persisted in browser storage per chat id, never sent to the server. A chat
// never switched keeps no entry and reads `normal`.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TranscriptViewMode } from '@generatorai/shared/ui-contract';
import { globalSingleton } from '../lib/globalSingleton.js';

/** Keep the map bounded: the oldest choices go first. */
const MAX_REMEMBERED = 200;

interface TranscriptPrefsState {
  /** chat id → mode; absent = `normal`. */
  viewModes: Record<string, TranscriptViewMode>;
  setViewMode: (chatId: string, mode: TranscriptViewMode) => void;
}

const useTranscriptPrefsStoreImpl = create<TranscriptPrefsState>()(
  persist(
    (set) => ({
      viewModes: {},
      setViewMode: (chatId, mode) =>
        set((state) => {
          const next = { ...state.viewModes };
          delete next[chatId];
          if (mode !== 'normal') next[chatId] = mode;
          const keys = Object.keys(next);
          for (const key of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete next[key];
          return { viewModes: next };
        }),
    }),
    { name: 'generatorai:transcriptPrefs' },
  ),
);

export const useTranscriptPrefsStore = globalSingleton('web.transcriptPrefsStore', () => useTranscriptPrefsStoreImpl);

/** The view mode of one chat (`normal` when none was chosen). */
export function useTranscriptViewMode(chatId: string | undefined): TranscriptViewMode {
  return useTranscriptPrefsStore((s) => (chatId ? s.viewModes[chatId] : undefined) ?? 'normal');
}
