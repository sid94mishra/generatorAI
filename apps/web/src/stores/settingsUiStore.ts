// ────────────────────────────────────────────────────────────────
// settingsUiStore — the one "open Settings" hop every call site uses.
//
// Settings is a modal addressed by URL (D-26): `openSettings(section)` is a
// navigation to `/settings/<section>` that carries the current page as
// `state.backgroundLocation`, so the page stays mounted behind the modal.
// The store keeps the last-visited section (a bare `openSettings()` returns
// where the user was) and holds the opener the shell lends it
// (app/shell/ShellRoute) — the shell knows the current location; a store
// cannot hold a router hook, and importing the router here would close an
// import cycle through every lazy page. Before the shell mounts (a deep link
// handled before hydration) the fallback is a full page load.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { DEFAULT_SETTINGS_SECTION, settingsPath, type SettingsSectionId } from '@generatorai/shared/ui-contract';
import { globalSingleton } from '../lib/globalSingleton.js';

/** Opens (or, inside the modal, switches to) a section; lent by the shell. */
export type SettingsOpener = (section: SettingsSectionId) => void;

interface SettingsUiState {
  /** Last section the user looked at — the target of a bare `openSettings()`. */
  section: SettingsSectionId;
  /** Injected by the shell (ShellRoute); null before it mounts. */
  opener: SettingsOpener | null;
  setOpener: (opener: SettingsOpener | null) => void;
  /** Open the Settings modal over the current page, or switch its section when it is open. */
  openSettings: (section?: SettingsSectionId) => void;
}

const useSettingsUiStoreImpl = create<SettingsUiState>((set, get) => ({
  section: DEFAULT_SETTINGS_SECTION,
  opener: null,
  setOpener: (opener) => set({ opener }),
  openSettings: (section) => {
    const target = section ?? get().section;
    set({ section: target });
    const open = get().opener;
    if (open) open(target);
    else if (typeof window !== 'undefined') window.location.assign(settingsPath(target));
  },
}));

// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useSettingsUiStore = globalSingleton('web.settingsUiStore', () => useSettingsUiStoreImpl);
