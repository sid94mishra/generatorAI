// ────────────────────────────────────────────────────────────────
// editSourcesStore — which chat's "Edit sources…" dialog is open.
//
// The chat workspace (features/chat) asks for the dialog from the composer's
// blocking bar / Sources chip and the Files tab's Sources block; `app/`
// mounts it (EditSourcesHost), the same store-driven pattern as the New chat
// dialog (04 §0 "cross-feature actions go through stores"). The dialog body is
// the legacy source editor until B-04 SourcePicker lands (P5); only the host
// changes then.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

interface EditSourcesState {
  /** The chat whose sources are being edited; null when the dialog is closed. */
  chatId: string | null;
  open: (chatId: string) => void;
  close: () => void;
}

const useEditSourcesStoreImpl = create<EditSourcesState>((set) => ({
  chatId: null,
  open: (chatId) => set({ chatId }),
  close: () => set({ chatId: null }),
}));

export const useEditSourcesStore = globalSingleton('web.editSourcesStore', () => useEditSourcesStoreImpl);
