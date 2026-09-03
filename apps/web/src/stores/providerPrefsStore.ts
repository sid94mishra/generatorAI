// ────────────────────────────────────────────────────────────────
// providerPrefsStore — user-level enabled/active set for the agent
// providers (GitHub Copilot / Claude). Persisted to localStorage so a
// user's provider choices survive reloads and re-logins. The backend
// serves one "active" harness at a time; this set records which
// providers the user has turned on (multiple allowed) so the app can
// offer them and re-activate the last one on demand.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { globalSingleton } from '../lib/globalSingleton.js';

interface ProviderPrefsState {
  /** Provider ids (harness types) the user has enabled. */
  enabledProviders: string[];
  setProviderEnabled: (id: string, enabled: boolean) => void;
  isEnabled: (id: string) => boolean;
}

const useProviderPrefsStoreImpl = create<ProviderPrefsState>()(
  persist(
    (set, get) => ({
      enabledProviders: [],
      setProviderEnabled: (id, enabled) =>
        set((s) => ({
          enabledProviders: enabled
            ? s.enabledProviders.includes(id)
              ? s.enabledProviders
              : [...s.enabledProviders, id]
            : s.enabledProviders.filter((x) => x !== id),
        })),
      isEnabled: (id) => get().enabledProviders.includes(id),
    }),
    { name: 'generatorai:providerPrefs' },
  ),
);


// HMR-split-proof: every module instance shares the first-created store.
// See lib/globalSingleton.ts for why this is load-bearing in dev.
export const useProviderPrefsStore = globalSingleton('web.providerPrefsStore', () => useProviderPrefsStoreImpl);
