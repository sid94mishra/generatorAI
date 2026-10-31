// ────────────────────────────────────────────────────────────────
// sideChatStore — the side-chat controller of the chat on screen (D-180). The
// chat page registers `{quickQuestion}` while mounted; the `chat.sideQuestion`
// command (Ctrl/⌘ ;) and the palette call it. With no chat on screen the
// controller is null and the command stands down — the dockStore pattern.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

export interface SideChatController {
  /** Open a quick side question beside the chat on screen. */
  quickQuestion: () => void;
}

interface SideChatControllerState {
  controller: SideChatController | null;
  setController: (controller: SideChatController | null) => void;
}

const useSideChatStoreImpl = create<SideChatControllerState>((set) => ({
  controller: null,
  setController: (controller) => set({ controller }),
}));

export const useSideChatStore = globalSingleton('web.sideChatStore', () => useSideChatStoreImpl);
