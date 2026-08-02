// ────────────────────────────────────────────────────────────────
// Deep-link route validation.
//
// A notification's `route` originates from server-side event data, which in
// turn can contain agent output. Treating it as trusted navigation input
// would let a prompt-injected agent steer the app — or, worse, open an
// external URL that looks like it came from us.
//
// So the rule is allowlist, not sanitise: only in-app absolute paths whose
// first segment is a screen we actually have.
//
// Pure and dependency-free so it can be tested exhaustively without Expo.
// ────────────────────────────────────────────────────────────────

/** First path segments the app is willing to navigate to from a notification. */
const ALLOWED_ROOTS = new Set([
  'chats',
  'runs',
  'automations',
  'projects',
  'changes',
  'settings',
]);

export function isSafeNotificationRoute(route: unknown): route is string {
  if (typeof route !== 'string' || route.length === 0) return false;

  // Must be an in-app absolute path.
  if (!route.startsWith('/')) return false;
  // `//evil.com` is protocol-relative: browsers and some link handlers treat
  // it as an absolute URL, so it must not slip through the leading-`/` check.
  if (route.startsWith('//')) return false;
  // A scheme anywhere means it is trying to leave the app.
  if (route.includes('://')) return false;
  // Control characters and newlines can smuggle a second value past naive
  // parsers downstream.
  if (/[\u0000-\u001f\u007f]/.test(route)) return false;
  // Traversal has no meaning in a route table and signals an attack.
  if (route.includes('..')) return false;

  const firstSegment = route.split('/')[1]?.split('?')[0];
  if (!firstSegment) return false;

  return ALLOWED_ROOTS.has(firstSegment);
}

/** The route to navigate to, or null when it must be ignored. */
export function safeRoute(route: unknown): string | null {
  return isSafeNotificationRoute(route) ? route : null;
}
