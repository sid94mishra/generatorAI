// Shell navigation actions (MD-87, 06 §3.1): one implementation for the sidebar, the palette, links and the
// hardware shortcuts. Router-aware, query-free.
import { router } from 'expo-router';

import { CHATS_HREF, NEEDS_YOU_HREF, NEW_CHAT_HREF, SEARCH_HREF, SERVERS_HREF, SETTINGS_HREF } from './hrefs';
import { normalizePath } from './parentHref';

type Href = Parameters<typeof router.replace>[0];

/** A module switch resets the Stack (MD-87): dismiss everything, then replace with the root, no animation. */
export function goToModule(href: string, currentPath?: string): void {
  if (currentPath !== undefined && normalizePath(currentPath) === normalizePath(href) && !router.canDismiss()) return;
  if (router.canDismiss()) router.dismissAll();
  router.replace(href as Href);
}

/** New chat: the MB-06 route sheet (`/chats/new`, M6-05). */
export function openNewChat(): void {
  router.push(NEW_CHAT_HREF as never);
}

export function openSearch(params?: Record<string, string>): void {
  router.push((params ? { pathname: SEARCH_HREF, params } : SEARCH_HREF) as never);
}

export function openSettings(): void {
  router.push(SETTINGS_HREF as Href);
}

export function openNeedsYou(): void {
  router.push(NEEDS_YOU_HREF as Href);
}

/** The server switcher sheet (MB-20). */
export function openServers(): void {
  router.push(SERVERS_HREF as Href);
}
