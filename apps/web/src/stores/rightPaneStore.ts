// ────────────────────────────────────────────────────────────────
// rightPaneStore — bridges a page-owned right-pane toggle up to the
// global Header. Pages that render a `RightPane` register a controller
// (current open state + toggle) on mount; the Header reads it to show a
// single, consistent side-pane toggle icon in the top bar. When no page
// registers a controller, the Header simply hides the icon.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

export interface RightPaneController {
  /** Whether the page's right pane is currently open. */
  open: boolean;
  /** Toggle the page's right pane. */
  toggle: () => void;
}

interface RightPaneUiState {
  controller: RightPaneController | null;
  setController: (controller: RightPaneController | null) => void;
}

const useRightPaneStoreImpl = create<RightPaneUiState>((set) => ({
  controller: null,
  setController: (controller) => set({ controller }),
}));


// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useRightPaneStore = globalSingleton('web.rightPaneStore', () => useRightPaneStoreImpl);
