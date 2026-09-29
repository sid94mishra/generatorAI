import { deepLinkToRoute } from '@generatorai/shared/ui-contract';

export const UNPAIRED_LINK_MESSAGE = "Link is for a server this phone isn't paired with";
export type PendingLink = { route: string; serverId: string | null };

/** Called before React mounts too; authentication consumes it when storage is ready. */
export function createLinkQueue() {
  let current: PendingLink | null = null;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    enqueue(input: unknown, explicitServerId?: string) {
      const parsed = deepLinkToRoute(input);
      if (!parsed) return false;
      const [pathname, query] = parsed.split('?');
      const params = new URLSearchParams(query);
      if (explicitServerId !== undefined) {
        if (!/^[A-Za-z0-9_-]+$/.test(explicitServerId)) return false;
        params.set('server', explicitServerId);
      }
      current = { route: pathname + (params.size ? `?${params}` : ''), serverId: params.get('server') };
      emit();
      return true;
    },
    clear() { current = null; emit(); },
    finish(link: PendingLink) {
      if (current !== link) return false;
      current = null; emit(); return true;
    },
  };
}
export const linkQueue = createLinkQueue();

/** Native intents cannot wait on React auth: queue protected navigation for the mounted shell. */
export function redirectLink(path: string, activeServerId?: string | null): string {
  const route = deepLinkToRoute(path);
  linkQueue.clear();
  if (!route) return '/';
  if (route.split('?')[0] === '/pair') return route;
  const targetId = new URLSearchParams(route.split('?')[1]).get('server');
  // Let Expo own direct navigation. Emitting a second navigation here races
  // redirectSystemPath's return value and can send the user back to Home.
  if (!targetId || targetId === activeServerId) return route;
  linkQueue.enqueue(route);
  return '/';
}

export function linkDisposition(link: PendingLink, pairedIds: readonly string[], activeId: string | null): 'unknown' | 'switch' | 'open' {
  if (!link.serverId) return 'open';
  if (!pairedIds.includes(link.serverId)) return 'unknown';
  return link.serverId === activeId ? 'open' : 'switch';
}
