import { deepLinkToRoute } from '@generatorai/shared/ui-contract';

/** Notification data can select a protected screen, never start pairing. */
export function safeRoute(route: unknown): string | null {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return null;
  const safe = deepLinkToRoute(route);
  if (!safe || safe.split('?')[0] === '/pair') return null;
  return safe;
}
export function isSafeNotificationRoute(route: unknown): route is string { return safeRoute(route) !== null; }
