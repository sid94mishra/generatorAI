// ────────────────────────────────────────────────────────────────
// Route grammar — the deep-link paths shared by push notifications, the
// approvals sheet and the Home queue.
//
// One place, because these strings are a CONTRACT with the server's push
// payload builder: a notification for a permission gate carries exactly
// `/chats/<chatId>/gate/<interactionId>`, and if the app's route file and
// this builder ever disagree the tap lands on "not found". Pure, tested.
// ────────────────────────────────────────────────────────────────

export const APPROVALS_ROUTE = '/approvals' as const;
export const SCOPE_REQUEST_ROUTE = '/scope-request' as const;
export const SEARCH_ROUTE = '/search' as const;

export function chatRoute(chatId: string): string {
  return `/chats/${encodeURIComponent(chatId)}`;
}

export function gateRoute(chatId: string, interactionId: string): string {
  return `/chats/${encodeURIComponent(chatId)}/gate/${encodeURIComponent(interactionId)}`;
}

export function planRoute(chatId: string, planId: string): string {
  return `/chats/${encodeURIComponent(chatId)}/plan/${encodeURIComponent(planId)}`;
}

export function runRoute(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}`;
}

/**
 * The accessory strip's line. Null when there is nothing to say — the strip
 * animates out rather than showing "0 waiting for you".
 */
export function needsYouLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (count > 99) return '99+ waiting for you';
  return count === 1 ? '1 waiting for you' : `${count} waiting for you`;
}
