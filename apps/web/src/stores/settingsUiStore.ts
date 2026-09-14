// ────────────────────────────────────────────────────────────────
// settingsUiStore — which Settings section is active.
//
// Settings is a ROUTED PAGE (`/settings/:section`), not a modal. This
// store no longer owns an `open` flag; it keeps the last-visited section
// (so `openSettings()` with no argument returns where the user was) and
// owns the one-line navigation hop every "open settings" call site uses.
//
// The navigator is injected by AppLayout rather than imported from
// `router.tsx`: the router module imports every page, and every page may
// import this store, so importing it here would close a cycle. The
// fallback keeps a call working (full page load) if the layout has not
// mounted yet — e.g. a deep link handled before hydration.
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

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = [
  'general',
  'appearance',
  'providers',
  'agents',
  'skills',
  'mcp',
  'templates',
  'source-control',
  'browser-terminal',
  'computer-use',
  'audio',
  'extensions',
  'security',
  'storage',
  'diagnostics',
];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'general';

/** Narrow an arbitrary URL segment to a known section id. */
export function toSettingsSection(value: string | undefined | null): SettingsSectionId {
  return SETTINGS_SECTION_IDS.includes(value as SettingsSectionId)
    ? (value as SettingsSectionId)
    : DEFAULT_SETTINGS_SECTION;
}

/** The canonical URL for a section. */
export function settingsPath(section: SettingsSectionId = DEFAULT_SETTINGS_SECTION): string {
  return `/settings/${section}`;
}

type Navigator = (path: string, opts?: { replace?: boolean }) => void;

interface SettingsUiState {
  /** Last section the user looked at — the target of a bare `openSettings()`. */
  section: SettingsSectionId;
  /** Injected by AppLayout; null before the shell mounts. */
  navigator: Navigator | null;
  setNavigator: (navigate: Navigator | null) => void;
  /** Navigate to `/settings/<section>`. */
  openSettings: (section?: SettingsSectionId) => void;
  /** Kept for call sites that used to dismiss the modal. Now a no-op hop home. */
  closeSettings: () => void;
  /** Switch section from inside the page (replaces the history entry). */
  setSection: (section: SettingsSectionId) => void;
}

const useSettingsUiStoreImpl = create<SettingsUiState>((set, get) => ({
  section: DEFAULT_SETTINGS_SECTION,
  navigator: null,
  setNavigator: (navigate) => set({ navigator: navigate }),
  openSettings: (section) => {
    const target = section ?? get().section;
    set({ section: target });
    const go = get().navigator;
    if (go) go(settingsPath(target));
    else if (typeof window !== 'undefined') window.location.assign(settingsPath(target));
  },
  closeSettings: () => {
    const go = get().navigator;
    if (go) go('/');
  },
  setSection: (section) => {
    set({ section });
    const go = get().navigator;
    if (go) go(settingsPath(section), { replace: true });
  },
}));

// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useSettingsUiStore = globalSingleton('web.settingsUiStore', () => useSettingsUiStoreImpl);
