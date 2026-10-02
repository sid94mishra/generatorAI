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

/**
 * The `(dev)` routes (Storybook, the theme switcher, the notification tester) in a development
 * build only. They are not product routes, so the shared allowlist rejects them; walkthroughs and
 * Maestro still need to open them by link. Release builds never match (`dev` is `__DEV__`).
 */
const DEV_ROUTES: ReadonlySet<string> = new Set(['storybook', 'theme', 'notify']);
export function devRoute(path: string, dev: boolean): string | null {
  if (!dev) return null;
  const match = /^(?:generatorai:\/\/\/?|\/)?([a-z]+)(\?[A-Za-z0-9_=&%.-]*)?$/.exec(path);
  return match && DEV_ROUTES.has(match[1]!) ? `/${match[1]}${match[2] ?? ''}` : null;
}

/** Native intents cannot wait on React auth: queue protected navigation for the mounted shell. */
export function redirectLink(path: string, activeServerId?: string | null): string {
  const dev = devRoute(path, typeof __DEV__ !== 'undefined' && __DEV__);
  if (dev) return dev;
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
