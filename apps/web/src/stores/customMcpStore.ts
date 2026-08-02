// ────────────────────────────────────────────────────────────────
// customMcpStore — user-defined MCP servers added from the global
// Settings → MCP Servers tab. The built-in system catalog is read-only
// on disk, so servers the user adds here are persisted client-side and
// listed alongside the system entries. Persisted to localStorage.
// ────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CustomMcpTransport = 'local' | 'http' | 'sse';

export interface CustomMcpServer {
  id: string;
  name: string;
  transport: CustomMcpTransport;
  /** For `local`: the launch command (e.g. `npx`). */
  command?: string;
  /** For `local`: whitespace-joined argument string. */
  args?: string;
  /** For `http`/`sse`: the server URL. */
  url?: string;
  /** Environment variables (name → value). */
  env?: Record<string, string>;
  /** Timeout in seconds. */
  timeoutSec?: number;
  createdAt: number;
}

interface CustomMcpState {
  servers: CustomMcpServer[];
  addServer: (server: Omit<CustomMcpServer, 'id' | 'createdAt'>) => void;
  removeServer: (id: string) => void;
}

export const useCustomMcpStore = create<CustomMcpState>()(
  persist(
    (set) => ({
      servers: [],
      addServer: (server) =>
        set((s) => ({
          servers: [
            ...s.servers,
            { ...server, id: `custom-mcp-${Date.now().toString(36)}`, createdAt: Date.now() },
          ],
        })),
      removeServer: (id) => set((s) => ({ servers: s.servers.filter((x) => x.id !== id) })),
    }),
    { name: 'generatorai:customMcp' },
  ),
);
