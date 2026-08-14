// ────────────────────────────────────────────────────────────────
// settingsUiStore — session-only UI state for the global Settings modal.
// Tracks whether the modal is open and which section is active so the
// sidebar / header gear / command palette can all open it to a target.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';

export type SettingsSectionId =
  | 'general'
  | 'providers'
  | 'agents'
  | 'skills'
  | 'mcp'
  | 'templates'
  | 'source-control'
  | 'browser-terminal'
  | 'computer-use'
  | 'extensions'
  | 'security'
  | 'diagnostics';

interface SettingsUiState {
  open: boolean;
  section: SettingsSectionId;
  openSettings: (section?: SettingsSectionId) => void;
  closeSettings: () => void;
  setSection: (section: SettingsSectionId) => void;
}

export const useSettingsUiStore = create<SettingsUiState>((set) => ({
  open: false,
  section: 'general',
  openSettings: (section) => set((s) => ({ open: true, section: section ?? s.section })),
  closeSettings: () => set({ open: false }),
  setSection: (section) => set({ section }),
}));
