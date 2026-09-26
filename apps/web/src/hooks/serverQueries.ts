// ────────────────────────────────────────────────────────────────
// Server switcher hooks (G-03) — the sidebar switcher / popover and the
// Windows title-strip server chip consume this once they land (P3); no UI
// lives here.
//
// Desktop: the shell holds the list (main process, `IPC.getServers` — see
// `@/lib/desktop.js` `desktopServers`) and main probes every entry's
// reachability with Node `fetch`.
//
// Plain browser tab: the client-runtime connection catalog (`authRuntime.ts`,
// one entry per server this client has paired with). The page may only probe
// its own origin: the app's CSP is `connect-src 'self'` and other servers send
// no CORS headers for it, so probing them from here would log a CSP violation
// and report a false "offline" (P1-review P2-R6). Every other entry is
// `unknown`.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { probeServer } from '@generatorai/client-runtime';
import type { DesktopServerEntry, ServerReachability } from '@generatorai/shared';
import { desktopServers, isDesktop } from '@/lib/desktop.js';
import {
  getActiveConnection,
  listConnections,
  switchConnection as switchWebConnection,
} from '@/platform/authRuntime.js';

export interface ServerListItem {
  /** Desktop: `'embedded'` or a connection id. Web: the paired server's `serverId`. */
  id: string;
  label: string;
  url: string;
  kind: 'embedded' | 'local' | 'remote';
  active: boolean;
  /** `unknown`: not probed, because a web page cannot reach another origin. */
  status: ServerReachability | 'unknown';
  serverName?: string;
  latencyMs?: number;
}

export const serverKeys = {
  all: ['desktop-servers'] as const,
};

/** Per-probe budget for the one probe a web page may run. */
const WEB_PROBE_TIMEOUT_MS = 2500;

function fromDesktopEntry(entry: DesktopServerEntry): ServerListItem {
  return {
    id: entry.id,
    label: entry.label,
    url: entry.url,
    kind: entry.kind,
    active: entry.active,
    status: entry.status,
    ...(entry.serverName !== undefined ? { serverName: entry.serverName } : {}),
    ...(entry.latencyMs !== undefined ? { latencyMs: entry.latencyMs } : {}),
  };
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Plain web: the paired-server catalog, probing only the entry on this page's own origin. */
async function loadWebList(): Promise<ServerListItem[]> {
  const active = getActiveConnection();
  const here = typeof window === 'undefined' ? null : window.location.origin;
  return Promise.all(
    listConnections().map(async (c): Promise<ServerListItem> => {
      const base = {
        id: c.serverId,
        label: c.label,
        url: c.endpoint,
        kind: c.kind,
        active: active?.serverId === c.serverId,
      };
      const origin = originOf(c.endpoint);
      if (!here || origin !== here) return { ...base, status: 'unknown' };
      const probe = await probeServer(origin, { timeoutMs: WEB_PROBE_TIMEOUT_MS, expectedServerId: c.serverId });
      return { ...base, ...probe };
    }),
  );
}

async function loadServers(): Promise<ServerListItem[]> {
  if (isDesktop && desktopServers.isAvailable()) {
    return (await desktopServers.list()).map(fromDesktopEntry);
  }
  return loadWebList();
}

/**
 * Known servers with reachability, for the switcher. `undefined` until the
 * first list has loaded, and the query's `error` when the shell could not
 * list them — never an invented empty list (D-36).
 */
export function useServers(): UseQueryResult<ServerListItem[]> {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: serverKeys.all,
    queryFn: loadServers,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!isDesktop) return undefined;
    return desktopServers.onChanged(() => {
      void queryClient.invalidateQueries({ queryKey: serverKeys.all });
    });
  }, [queryClient]);

  return query;
}

/**
 * Switches the active server. Desktop: a new origin, handled in main
 * (`backend-switcher.ts`). Web: `switchConnection` reloads the page onto the
 * paired server's own origin — there is no in-place swap, on either platform,
 * because every store, the query cache and the SSE manager belong to one
 * server's data.
 */
export function switchServer(id: string): void {
  if (isDesktop && desktopServers.isAvailable()) {
    desktopServers.switchTo(id);
    return;
  }
  switchWebConnection(id);
}

/**
 * Opens the "Add server" flow. Desktop only: a plain web tab pairs with a new
 * server through the pairing screen, not a switcher action — see
 * `AuthGate.tsx`.
 */
export function addServer(): void {
  if (isDesktop && desktopServers.isAvailable()) desktopServers.add();
}
