// ────────────────────────────────────────────────────────────────
// notificationFilter — the per-device "wake me for" preferences, applied.
//
// Settings › Notifications stores three switches (`notify.gates`,
// `notify.runs`, `notify.chats`). The server's push-token registration has
// no per-category field (only an all-or-nothing `mutedUntil` for the
// non-approval categories), so the switches take effect in two places:
//
//   1. FOREGROUND — `Notifications.setNotificationHandler` asks
//      `shouldPresent` before showing a banner, so a muted category is
//      swallowed while the app is open.
//   2. BACKGROUND — the OS shows whatever the server sent, so the closest
//      available server control is used: when BOTH non-approval categories
//      are off, the server-side mute is engaged (`PUT /push-token/mute`) and
//      those pushes are never sent; when either is on, it is released.
//      Approvals are never mutable server-side by design (see
//      `MUTABLE_CATEGORIES` in @generatorai/core), so a switched-off
//      "Approvals" only affects foreground presentation.
//
// The server's payload puts `{ route, category, threadId }` in `data`
// (PushDispatcher.ts), plus `{ chatId, interactionId, kind, actions? }` for
// chat gates (see notificationCategories.ts). `category` is one of
// 'approval' | 'completed' | 'failed'; `route` starts with `/runs/…` or
// `/chats/…` (`/chats/<id>/gate/<interactionId>` for a gate).
// ────────────────────────────────────────────────────────────────

export const NOTIFY_PREF_KEYS = {
  gates: 'notify.gates',
  runs: 'notify.runs',
  chats: 'notify.chats',
} as const;

export const NOTIFY_PREF_DEFAULTS: NotifyPrefs = { gates: true, runs: true, chats: false };

export interface NotifyPrefs {
  gates: boolean;
  runs: boolean;
  chats: boolean;
}

/** Reads the three switches from a string-keyed store (MMKV in the app). */
export function readNotifyPrefs(get: (key: string) => string | null | undefined): NotifyPrefs {
  const read = (key: string, fallback: boolean): boolean => {
    const stored = get(key);
    return stored === null || stored === undefined ? fallback : stored === '1';
  };
  return {
    gates: read(NOTIFY_PREF_KEYS.gates, NOTIFY_PREF_DEFAULTS.gates),
    runs: read(NOTIFY_PREF_KEYS.runs, NOTIFY_PREF_DEFAULTS.runs),
    chats: read(NOTIFY_PREF_KEYS.chats, NOTIFY_PREF_DEFAULTS.chats),
  };
}

/** Which switch governs a push payload, or null when it is not one of ours. */
export function categoryOf(data: unknown): keyof NotifyPrefs | null {
  if (!data || typeof data !== 'object') return null;
  const { category, route } = data as { category?: unknown; route?: unknown };
  if (category === 'approval') return 'gates';
  if (category !== 'completed' && category !== 'failed') return null;
  if (typeof route === 'string') {
    if (route.startsWith('/chats')) return 'chats';
    if (route.startsWith('/runs') || route.startsWith('/workflows') || route.startsWith('/automations')) {
      return 'runs';
    }
  }
  // A completion/failure we cannot place is treated as a run outcome — the
  // category the user is most likely to expect it under.
  return 'runs';
}

/**
 * Whether a notification should be presented while the app is in the
 * foreground. Unknown payloads (not from our server) are always shown: the
 * preferences are about agent noise, not about hiding the OS's own messages.
 */
export function shouldPresent(data: unknown, prefs: NotifyPrefs): boolean {
  const key = categoryOf(data);
  if (key === null) return true;
  return prefs[key];
}

/**
 * Whether the server-side mute (which covers 'completed' + 'failed' only)
 * should be engaged for these preferences.
 */
export function shouldMuteOnServer(prefs: NotifyPrefs): boolean {
  return !prefs.runs && !prefs.chats;
}

/**
 * Far enough ahead that it never expires in practice, but still a valid
 * positive int32-safe epoch for the server's `mutedUntil` schema (positive
 * integer). Re-asserted on every registration anyway.
 */
export const SERVER_MUTE_HORIZON_MS = 10 * 365 * 24 * 60 * 60 * 1000;
