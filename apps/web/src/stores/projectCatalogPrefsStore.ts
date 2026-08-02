// ────────────────────────────────────────────────────────────────
// projectCatalogPrefsStore — per-project enable/disable for the
// artifacts a project exposes (skills, prompts, agents, MCP servers).
// System-scoped artifacts are available to every project by default;
// disabling one here is a client preference (persisted) that hides it
// from that project's agents. Mirrors the global catalogPrefsStore but
// keyed by projectId so each project has its own on/off set.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** `${projectId}:${artifactId}` → present means DISABLED for that project. */
type DisabledKey = string;

interface ProjectCatalogPrefsState {
  disabled: DisabledKey[];
  isDisabled: (projectId: string, artifactId: string) => boolean;
  setEnabled: (projectId: string, artifactId: string, enabled: boolean) => void;
}

const key = (projectId: string, artifactId: string): DisabledKey => `${projectId}:${artifactId}`;

export const useProjectCatalogPrefsStore = create<ProjectCatalogPrefsState>()(
  persist(
    (set, get) => ({
      disabled: [],
      isDisabled: (projectId, artifactId) => get().disabled.includes(key(projectId, artifactId)),
      setEnabled: (projectId, artifactId, enabled) =>
        set((s) => {
          const k = key(projectId, artifactId);
          return {
            disabled: enabled
              ? s.disabled.filter((x) => x !== k)
              : s.disabled.includes(k)
                ? s.disabled
                : [...s.disabled, k],
          };
        }),
    }),
    { name: 'generatorai:projectCatalogPrefs' },
  ),
);
