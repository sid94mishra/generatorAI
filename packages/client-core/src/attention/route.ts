import type { AttentionItem } from '@generatorai/shared';
import { deepLinkToRoute } from '@generatorai/shared/ui-contract';

/** Preserve the server-provided target and pane while pinning its server identity. */
export function attentionItemRoute(item: Pick<AttentionItem, 'href'>, serverId: string): { pathname: string; params: Record<string, string> } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(serverId) || !item.href.startsWith('/') || item.href.startsWith('//')) return null;
  const route = deepLinkToRoute(item.href);
  if (!route || route.split('?')[0] === '/pair') return null;
  const [pathname, query] = route.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  params.server = serverId;
  return { pathname: pathname!, params };
}
