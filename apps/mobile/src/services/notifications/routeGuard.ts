import { deepLinkToRoute } from '@generatorai/shared/ui-contract';

/**
 * Roots a notification may open (04 §1.6): the push `href` is web-shaped (MG-06), so a run is
 * `/workflows/<id>/runs/<runId>` and the legacy `runs`, `changes`, `terminal` and `approvals` roots are gone.
 */
export const NOTIFICATION_ROOTS: readonly string[] = ['chats', 'workflows', 'automations', 'projects', 'settings', 'scope-request', 'needs-you'];

/** Notification data can select a protected screen, never start pairing. */
export function safeRoute(route: unknown): string | null {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return null;
  const safe = deepLinkToRoute(route);
  if (!safe) return null;
  const root = safe.split('?')[0]!.split('/')[1] ?? '';
  if (root !== '' && !NOTIFICATION_ROOTS.includes(root)) return null;
  return safe;
}
export function isSafeNotificationRoute(route: unknown): route is string { return safeRoute(route) !== null; }
