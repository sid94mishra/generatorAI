// ────────────────────────────────────────────────────────────────
// settingsUiStore — session-only UI state for the global Settings modal.
// Tracks whether the modal is open and which section is active so the
// sidebar / header gear / command palette can all open it to a target.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { globalSingleton } from '../lib/globalSingleton.js';

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'providers'
  | 'agents'
  | 'skills'
  | 'mcp'
  | 'templates'
  | 'source-control'
  | 'browser-terminal'
  | 'computer-use'
  | 'audio'
  | 'extensions'
  | 'security'
  | 'storage'
  | 'diagnostics';

interface SettingsUiState {
  open: boolean;
  section: SettingsSectionId;
  openSettings: (section?: SettingsSectionId) => void;
  closeSettings: () => void;
  setSection: (section: SettingsSectionId) => void;
}

const useSettingsUiStoreImpl = create<SettingsUiState>((set) => ({
  open: false,
  section: 'general',
  openSettings: (section) => set((s) => ({ open: true, section: section ?? s.section })),
  closeSettings: () => set({ open: false }),
  setSection: (section) => set({ section }),
}));


// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useSettingsUiStore = globalSingleton('web.settingsUiStore', () => useSettingsUiStoreImpl);
