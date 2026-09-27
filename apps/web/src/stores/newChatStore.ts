// ────────────────────────────────────────────────────────────────
// newChatStore — the 640 NewChatDialog's open/closed state (04 §0
// cross-feature rule, R-1, P5-09).
//
// `NewChatDialog` (features/chats/create) is mounted ONCE by `app/`
// (app/shell/ShellRoute.tsx), inside the shell's `overlays`. Every opener —
// the sidebar "New chat" icon, the `chat.new` command, the palette action,
// ChatsList's header button, a future Projects row action, Home's quick
// composer — calls `useNewChatStore.getState().open(draft?)` rather than
// importing `features/chats` (no cross-feature imports).
//
// Unlike `settingsUiStore`, this store needs no injected navigator: opening
// the dialog is not a navigation. The dialog's own "More options" link
// closes itself and navigates to `/chats/new` directly, since it already
// renders inside the router.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type { CreateChatDraft } from '@generatorai/shared/ui-contract';
import { globalSingleton } from '../lib/globalSingleton.js';

interface NewChatUiState {
  isOpen: boolean;
  /** Prefilled fields (e.g. Home's quick composer text) for the next open. */
  initialDraft: Partial<CreateChatDraft> | undefined;
  open: (draft?: Partial<CreateChatDraft>) => void;
  close: () => void;
}

const useNewChatStoreImpl = create<NewChatUiState>((set) => ({
  isOpen: false,
  initialDraft: undefined,
  open: (draft) => set({ isOpen: true, initialDraft: draft }),
  close: () => set({ isOpen: false, initialDraft: undefined }),
}));

export const useNewChatStore = globalSingleton('web.newChatStore', () => useNewChatStoreImpl);
