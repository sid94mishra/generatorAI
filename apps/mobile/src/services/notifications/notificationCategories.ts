// ────────────────────────────────────────────────────────────────
// notificationCategories — lock-screen actions for approval pushes.
//
// The server tags every approval notification with `categoryId: 'approval'`
// (PushDispatcher.ts / ExpoPushProvider.ts in @generatorai/core). The app
// registers that category at startup with two buttons, Allow and Deny, and
// this module decides what a user's response means:
//
//   * Allow / Deny on a TOOL-PERMISSION prompt → POST the decision to the
//     server without opening the UI. The push `data` carries everything
//     needed (`chatId`, `interactionId`, `kind: 'permission'`, `actions`).
//   * anything else (a plain tap, or a button on a gate that needs reading
//     first — a question, a plan) → open the gate screen via `data.route`,
//     validated by the same allowlist every deep link goes through.
//
// Pure and dependency-free (no Expo / React Native imports) so the mapping
// is unit-tested on node; the hook does the platform calls.
// ────────────────────────────────────────────────────────────────

import { safeRoute } from './routeGuard';

/** Must match `APPROVAL_CATEGORY_ID` on the server. */
export const APPROVAL_CATEGORY_ID = 'approval';

/** High-importance Android channel the server targets for approvals. */
export const APPROVAL_CHANNEL_ID = 'approvals';

export const APPROVAL_ACTION = {
  approve: 'approve',
  deny: 'deny',
} as const;

/**
 * Category actions, in the shape `Notifications.setNotificationCategoryAsync`
 * takes. `opensAppToForeground: false` is the whole point: the decision is
 * sent from the notification shade, and the app stays wherever it was.
 *
 * `isAuthenticationRequired: true` (iOS; ignored elsewhere) on BOTH buttons:
 *   * Allow grants an agent a tool call on the user's machine. Anyone holding
 *     a locked phone could otherwise press it from the lock screen.
 *   * The signed request needs the device credential, which lives in
 *     "when unlocked" protected storage (`secureItemStore.ts`). An action
 *     handled while the phone is still locked cannot read it, so a Deny
 *     without authentication would fail and fall back to opening the app —
 *     a decision the user believes they made, silently not sent.
 * iOS asks for Face ID / passcode first, then delivers the action to an
 * unlocked process.
 */
export const APPROVAL_ACTIONS = [
  {
    identifier: APPROVAL_ACTION.approve,
    buttonTitle: 'Allow',
    options: { opensAppToForeground: false, isAuthenticationRequired: true },
  },
  {
    identifier: APPROVAL_ACTION.deny,
    buttonTitle: 'Deny',
    options: { opensAppToForeground: false, isDestructive: true, isAuthenticationRequired: true },
  },
] as const;

export type GateKind = 'permission' | 'question' | 'plan';

/** What the app should do with a notification response. */
export type NotificationIntent =
  /** Resolve a tool-permission gate in place. `route` is the fallback screen. */
  | {
      type: 'decide';
      chatId: string;
      interactionId: string;
      behavior: 'allow' | 'deny';
      route: string | null;
    }
  /** Open a screen (default tap, or an action on a gate that needs reading). */
  | { type: 'open'; route: string }
  /** Nothing to do: not our payload, or a route the allowlist refused. */
  | { type: 'ignore'; reason: 'no-route' | 'unsafe-route' };

interface PushData {
  route?: unknown;
  category?: unknown;
  chatId?: unknown;
  interactionId?: unknown;
  kind?: unknown;
  actions?: unknown;
}

function asRecord(data: unknown): PushData {
  return data && typeof data === 'object' ? (data as PushData) : {};
}

/**
 * Ids are path segments of the decision URL. They come from the server's own
 * database, but the payload has passed through a third-party push service,
 * so anything that could change the request's path is refused outright.
 */
const SAFE_ID = /^[A-Za-z0-9._~-]{1,128}$/;

function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

/**
 * Map a notification response to an intent.
 *
 * @param actionIdentifier `response.actionIdentifier`
 * @param data `response.notification.request.content.data`
 * @param defaultActionIdentifier `Notifications.DEFAULT_ACTION_IDENTIFIER`
 *   (passed in so this module needs no Expo import)
 */
export function intentFromResponse(
  actionIdentifier: string,
  data: unknown,
  defaultActionIdentifier: string,
): NotificationIntent {
  const payload = asRecord(data);
  const route = safeRoute(payload.route);

  const openOrIgnore = (): NotificationIntent => {
    if (route) return { type: 'open', route };
    return {
      type: 'ignore',
      reason: typeof payload.route === 'string' && payload.route.length > 0 ? 'unsafe-route' : 'no-route',
    };
  };

  if (actionIdentifier === defaultActionIdentifier) return openOrIgnore();

  const behavior =
    actionIdentifier === APPROVAL_ACTION.approve
      ? 'allow'
      : actionIdentifier === APPROVAL_ACTION.deny
        ? 'deny'
        : null;
  if (!behavior) return openOrIgnore();

  // Only a permission gate has a closed allow/deny answer, and only when the
  // server said this action exists for it. A question or plan review needs
  // the user to read something first, so a stray button opens the gate.
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const chatId = safeId(payload.chatId);
  const interactionId = safeId(payload.interactionId);
  if (payload.kind !== 'permission' || !actions.includes(actionIdentifier) || !chatId || !interactionId) {
    return openOrIgnore();
  }

  return { type: 'decide', chatId, interactionId, behavior, route };
}

/** The request that resolves a permission gate. Reuses the chat route. */
export function decisionRequest(intent: Extract<NotificationIntent, { type: 'decide' }>): {
  path: string;
  init: RequestInit;
} {
  return {
    path: `/api/chats/${encodeURIComponent(intent.chatId)}/interactions/${encodeURIComponent(intent.interactionId)}/permission`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ behavior: intent.behavior }),
    },
  };
}

export type DecisionOutcome =
  /** The gate is resolved (by this tap, or already — 409 — by another client). */
  | 'settled'
  /** The gate no longer exists (404): expired, cancelled, or a stale push. */
  | 'gone'
  /** Rejected (401/403): the device lacks `write:chats` or its session lapsed. */
  | 'forbidden'
  /** Anything else — the user should be shown the gate so they can retry. */
  | 'failed';

/**
 * Interpret the server's answer.
 *
 * A 409 is success from the user's point of view: someone (perhaps their own
 * desktop) already answered, and the agent is unblocked either way. Treating
 * it as an error would open the app to a gate that is no longer there.
 */
export function decisionOutcome(status: number): DecisionOutcome {
  if (status === 202 || status === 200 || status === 409) return 'settled';
  if (status === 404) return 'gone';
  if (status === 401 || status === 403) return 'forbidden';
  return 'failed';
}

/**
 * Send the decision through a signed fetch.
 *
 * Never throws: a network failure is reported as `'failed'` so the caller
 * can fall back to opening the gate screen.
 */
export async function submitDecision(
  intent: Extract<NotificationIntent, { type: 'decide' }>,
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<DecisionOutcome> {
  const { path, init } = decisionRequest(intent);
  try {
    const response = await fetchImpl(path, init);
    return decisionOutcome(response.status);
  } catch {
    return 'failed';
  }
}
