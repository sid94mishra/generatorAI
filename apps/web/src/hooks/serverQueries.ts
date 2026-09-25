// ────────────────────────────────────────────────────────────────
// Server switcher hooks (G-03) — the sidebar switcher / popover and the
// Windows title-strip server chip consume this once they land (P3); no UI
// lives here.
//
// The desktop shell holds one list (main process, `servers.ts` IPC — see
// `@/lib/desktop.js` `desktopServers`); a plain browser tab has no shell, so
// it falls back to the client-runtime connection catalog (`authRuntime.ts`,
// one entry per server this client has paired with). Either way the result is
// probed for live reachability with the same `probeServer` call — "the same
// code runs on every OS" (05-gap-matrix.md §G-03).
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { probeServer, type ServerProbeResult } from '@generatorai/client-runtime';
import { desktopServers, isDesktop, type DesktopServerEntry } from '@/lib/desktop.js';
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
  status: ServerProbeResult['status'];
  serverName?: string;
  latencyMs?: number;
}

export const serverKeys = {
  all: ['desktop-servers'] as const,
};

interface BaseEntry {
  id: string;
  label: string;
  url: string;
  kind: 'embedded' | 'local' | 'remote';
  active: boolean;
}

function fromDesktopEntry(entry: DesktopServerEntry): BaseEntry {
  return { id: entry.id, label: entry.label, url: entry.url, kind: entry.kind, active: entry.active };
}

async function loadBaseList(): Promise<BaseEntry[]> {
  if (isDesktop && desktopServers.isAvailable()) {
    return (await desktopServers.list()).map(fromDesktopEntry);
  }
  // Plain web (browser tab): the client-runtime catalog — one entry per
  // server this client holds a credential for. There is no "This computer"
  // entry here; a browser tab has no embedded server of its own.
  const active = getActiveConnection();
  return listConnections().map((c) => ({
    id: c.serverId,
    label: c.label,
    url: c.endpoint,
    kind: c.kind,
    active: active?.serverId === c.serverId,
  }));
}

async function withProbes(base: BaseEntry[]): Promise<ServerListItem[]> {
  return Promise.all(
    base.map(async (entry): Promise<ServerListItem> => {
      if (!entry.url) return { ...entry, status: 'offline' };
      const probe = await probeServer(entry.url, { timeoutMs: 2500 });
      return { ...entry, ...probe };
    }),
  );
}

/**
 * Known servers with live reachability, for the switcher. `undefined` until
 * the first list has loaded — never an invented empty list (D-36).
 */
export function useServers(): UseQueryResult<ServerListItem[]> {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: serverKeys.all,
    queryFn: async () => withProbes(await loadBaseList()),
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
