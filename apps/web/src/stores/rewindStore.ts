// ────────────────────────────────────────────────────────────────
// rewindStore — the prompt a rewind handed back.
//
// Restoring the conversation puts the rewound prompt back in the composer so
// it can be edited and resent (this is what Claude Code's `/rewind` does, and
// without it the user has to retype the message they just erased). The prompt
// arrives in two places — the REST response of the rewind the user triggered,
// and the `chat.rewound` SSE event (a rewind performed from another device or
// surface) — while the composer lives several components away from both.
//
// So it is parked here, and ChatPage consumes it exactly once: `at` is the
// delivery token, and `clear()` fires as soon as the page has handed it to
// the composer. Nothing is auto-sent — the user decides.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

export interface RewindPrompt {
  chatId: string;
  prompt: string;
  /** Monotonic-ish delivery token, so the same text twice is still two offers. */
  at: number;
}

interface RewindStore {
  pending: RewindPrompt | null;
  /** Offer `prompt` back to `chatId`'s composer. An empty prompt is ignored. */
  offerPrompt: (chatId: string, prompt: string | undefined) => void;
  /** Drop the pending offer (after the composer has taken it, or on chat change). */
  clear: () => void;
}

const useRewindStoreImpl = create<RewindStore>((set) => ({
  pending: null,

  offerPrompt: (chatId, prompt) => {
    if (!prompt?.trim()) return;
    set({ pending: { chatId, prompt, at: Date.now() } });
  },

  clear: () => set({ pending: null }),
}));

/**
 * Shared across every module instance in the tab — the SSE manager writes it
 * from outside React while ChatPage reads it through a hook, and two copies
 * of the store would silently drop the offer.
 */
export const useRewindStore = globalSingleton('web.rewindStore', () => useRewindStoreImpl);
