// ────────────────────────────────────────────────────────────────
// transcriptFindStore — the app-level transcript find (D-33 spike).
//
// A virtualized transcript does not render off-screen turns, so neither the
// browser's find nor the desktop FindBar (`webContents.findInPage`) can see
// them. While such a transcript is mounted it registers an opener here; the
// desktop FindBar's "Find" command and the transcript's own Mod+F then open
// the transcript find, which searches the whole model and scrolls each match
// into view. With nothing registered, find-in-page works as before.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

interface TranscriptFindState {
  /** Opens the mounted transcript's find, or null when none handles find. */
  open: ((query?: string) => void) | null;
  register: (open: (query?: string) => void) => () => void;
}

const useTranscriptFindStoreImpl = create<TranscriptFindState>((set, get) => ({
  open: null,
  register: (open) => {
    set({ open });
    return () => {
      if (get().open === open) set({ open: null });
    };
  },
}));

export const useTranscriptFindStore = globalSingleton('web.transcriptFindStore', () => useTranscriptFindStoreImpl);
