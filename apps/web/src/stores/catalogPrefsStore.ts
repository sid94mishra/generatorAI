// ────────────────────────────────────────────────────────────────
// catalogPrefsStore — user-level enable/disable for the system catalogs
// (skills + MCP servers). These are read-only disk catalogs on the
// server, so "disabled" is a client preference that FILTERS the places
// the app offers them:
//   • disabled skills  → hidden from ArtifactPicker + the chat `/` menu
//   • disabled MCP     → hidden from the per-stage McpServerSelector
// Persisted to localStorage; reactive so a toggle in Settings updates
// every consumer instantly.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CatalogPrefsState {
  /** Artifact ids of skills the user has turned OFF. */
  disabledSkills: string[];
  /** Server ids of system MCP servers the user has turned OFF. */
  disabledMcp: string[];
  setSkillEnabled: (id: string, enabled: boolean) => void;
  setMcpEnabled: (id: string, enabled: boolean) => void;
}

export const useCatalogPrefsStore = create<CatalogPrefsState>()(
  persist(
    (set) => ({
      disabledSkills: [],
      disabledMcp: [],
      setSkillEnabled: (id, enabled) =>
        set((s) => ({
          disabledSkills: enabled
            ? s.disabledSkills.filter((x) => x !== id)
            : s.disabledSkills.includes(id)
              ? s.disabledSkills
              : [...s.disabledSkills, id],
        })),
      setMcpEnabled: (id, enabled) =>
        set((s) => ({
          disabledMcp: enabled
            ? s.disabledMcp.filter((x) => x !== id)
            : s.disabledMcp.includes(id)
              ? s.disabledMcp
              : [...s.disabledMcp, id],
        })),
    }),
    { name: 'generatorai:catalogPrefs' },
  ),
);

/** Non-reactive read of the disabled-skill id set (for hooks/memos). */
export function getDisabledSkillSet(): Set<string> {
  return new Set(useCatalogPrefsStore.getState().disabledSkills);
}

/** Non-reactive read of the disabled-MCP id set. */
export function getDisabledMcpSet(): Set<string> {
  return new Set(useCatalogPrefsStore.getState().disabledMcp);
}
