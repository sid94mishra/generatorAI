// ────────────────────────────────────────────────────────────────
// dockStore — the dock controller of the page on screen (06 §2.2; renamed
// from rightPaneStore in P4-12). A page with a dock (the chat workspace, the
// legacy workflow run page) registers `{open, toggle}` while mounted; the
// `dock.toggle` command (Ctrl/⌘ Alt B, View ▸ Toggle Side Pane) and the
// desktop menu's checkmark read it. The legacy Header's side-pane toggle
// reads it too, for the run page only, until PW ports that page. With no dock
// on screen the controller is null and those affordances stand down.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

export interface DockController {
  /** Whether the page's dock is open. */
  open: boolean;
  /** Open or close the page's dock. */
  toggle: () => void;
}

interface DockControllerState {
  controller: DockController | null;
  setController: (controller: DockController | null) => void;
}

const useDockStoreImpl = create<DockControllerState>((set) => ({
  controller: null,
  setController: (controller) => set({ controller }),
}));

// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useDockStore = globalSingleton('web.dockStore', () => useDockStoreImpl);
