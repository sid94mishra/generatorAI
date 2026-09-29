export type AuthenticatedFetch = (path: string, init?: RequestInit) => Promise<Response>;
const servers = new Map<string, AuthenticatedFetch>();
let activeServer: string | null = null;

export function registerAuthenticatedFetch(serverId: string, fetchImpl: AuthenticatedFetch | null): void {
  if (fetchImpl) servers.set(serverId, fetchImpl);
  else servers.delete(serverId);
}
export function setBackgroundActiveServer(serverId: string | null): void { activeServer = serverId; }
/** Explicit server selection keeps a B notification from executing against active server A. */
export function getAuthenticatedFetch(serverId?: string | null): AuthenticatedFetch | null {
  const id = serverId ?? (servers.size === 1 ? activeServer : null);
  return id ? servers.get(id) ?? null : null;
}
export function clearAuthenticatedFetches(): void { servers.clear(); activeServer = null; }
