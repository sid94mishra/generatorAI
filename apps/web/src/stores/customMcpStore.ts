// ────────────────────────────────────────────────────────────────
// customMcpStore — LEGACY localStorage reader for pre-W48 custom MCP
// servers, kept ONLY so `McpSection` can migrate old entries once.
//
// This used to be a zustand `persist` store that WROTE every custom MCP
// server a user added in Settings → MCP Servers straight to
// `localStorage['generatorai:customMcp']` and nowhere else. The server-side
// harness config builder never read localStorage, so a server added there
// was never actually usable — it only ever appeared in this browser tab.
//
// W48 moves persistence server-side: `McpSettingsStore`
// (packages/core/src/mcp/McpSettingsStore.ts) via
// `POST/PUT/DELETE /api/system/mcp-servers/custom` (see
// hooks/projectQueries.ts's useCreateCustomMcpServer and friends). This
// module now only reads back whatever a pre-W48 build already wrote, so
// `McpSection` can POST it to the server once and delete the key.
// ────────────────────────────────────────────────────────────────

const LEGACY_STORAGE_KEY = 'generatorai:customMcp';

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

interface LegacyPersistedShape {
  state?: { servers?: CustomMcpServer[] };
}

/**
 * Whatever a pre-W48 build wrote to `localStorage`, or `[]`. Never throws —
 * a private window, cleared site data, or a corrupt value all just mean
 * "nothing to migrate".
 */
export function readLegacyCustomMcpServers(): CustomMcpServer[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyPersistedShape;
    return Array.isArray(parsed?.state?.servers) ? parsed.state.servers : [];
  } catch {
    return [];
  }
}

/** Call once the legacy entries have been migrated server-side. */
export function clearLegacyCustomMcpServers(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // best effort
  }
}
