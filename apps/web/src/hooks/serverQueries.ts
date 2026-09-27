// ────────────────────────────────────────────────────────────────
// Server switcher hooks (G-03) — the Servers menu (app/shell/ServersMenu:
// the sidebar switcher, the title-strip server chip and the rail mark) and
// the shell's active-server name; no UI lives here.
//
// Desktop: the shell holds the list (main process, `IPC.getServers` — see
// `@/lib/desktop.js` `desktopServers`) and main probes every entry's
// reachability with Node `fetch`.
//
// Plain browser tab: the client-runtime connection catalog (`authRuntime.ts`,
// one entry per server this client has paired with), plus the page's own
// server when the catalog has no entry for it (a loopback or unpaired
// session is still talking to it). The page may only probe
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
  forgetConnection,
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

/** The id of the page's own server when the catalog has no entry for it. */
export const THIS_ORIGIN_SERVER_ID = 'this-origin';

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Plain web: the paired-server catalog, probing only the entry on this page's
 * own origin. A page served by a server it never paired with (loopback dev
 * auth, an unauthenticated LAN session) is still talking to that server, so
 * it is listed too — first, active, with the name and status its own
 * `server-info` reports (probed, never invented).
 */
async function loadWebList(): Promise<ServerListItem[]> {
  const active = getActiveConnection();
  const here = typeof window === 'undefined' ? null : window.location.origin;
  const catalog = listConnections();
  const listed = await Promise.all(
    catalog.map(async (c): Promise<ServerListItem> => {
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
  if (!here || catalog.some((c) => originOf(c.endpoint) === here)) return listed;
  const probe = await probeServer(here, { timeoutMs: WEB_PROBE_TIMEOUT_MS });
  const hostname = new URL(here).hostname;
  const self: ServerListItem = {
    id: THIS_ORIGIN_SERVER_ID,
    label: probe.serverName ?? new URL(here).host,
    url: here,
    kind: isLoopbackHost(hostname) ? 'local' : 'remote',
    active: !listed.some((s) => s.active),
    ...probe,
  };
  return [self, ...listed];
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
 * Whether this client can add a server from the switcher. Desktop only: a
 * plain web tab pairs with a new server through the pairing screen, not a
 * switcher action — see `features/pairing/PairingGate.tsx` — so the switcher offers no "Add
 * server…" there (never a menu item that does nothing).
 */
export function canAddServer(): boolean {
  return isDesktop && desktopServers.isAvailable();
}

/** Opens the "Add server" flow (the shell's prompt). A no-op where `canAddServer()` is false. */
export function addServer(): void {
  if (canAddServer()) desktopServers.add();
}

/**
 * Whether this client can forget a server here: a plain web tab's paired
 * catalog entries. Desktop forgets through the native `Server ▸ Forget
 * Server` menu, which owns that list.
 */
export function canForgetServer(item: ServerListItem): boolean {
  if (isDesktop && desktopServers.isAvailable()) return false;
  return listConnections().some((c) => c.serverId === item.id);
}

/**
 * Deletes this client's credential for a paired server (web); a new pairing
 * code is needed to return. Forgetting the active server reloads onto the
 * pairing screen.
 */
export function useForgetServer(): (id: string) => void {
  const queryClient = useQueryClient();
  return (id) => {
    forgetConnection(id);
    void queryClient.invalidateQueries({ queryKey: serverKeys.all });
  };
}
