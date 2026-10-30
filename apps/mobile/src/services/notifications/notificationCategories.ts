import { ApiError, createApiClient } from '@generatorai/client-core';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_IDS,
  NOTIFICATION_SUMMARY_FORMAT,
  type NotificationActionDef,
  type NotificationCategoryId,
} from '@generatorai/shared/ui-contract';
// ────────────────────────────────────────────────────────────────
// notificationCategories — notification categories v2 and what a response means (MX-07, 06 §7.2, MD-183).
//
// The server names a shared category on every push (`categoryId`, `data.category`); the app registers every
// category's actions at startup from the same table. A response becomes one of:
//
//   * decide — Allow once / Deny on an ORDINARY permission gate (`approval`): POST the decision without opening
//     the UI. A risky gate (`approval.risky`, MG-04) has no such action; it opens the app, which signs (MD-31).
//   * answer — a text reply to a single question: the reply is sent as the option it names (exact, case-insensitive)
//     or as free text when the question takes it; otherwise the gate opens.
//   * open — a tap, Open, Review: the item, through the same allowlist every deep link goes through.
//
// Pure apart from `submitDecision` / `submitAnswer` (which take the signed fetch); no Expo imports, so the mapping
// is unit-tested on node.
// ────────────────────────────────────────────────────────────────

import { safeRoute } from './routeGuard';
import { normalizePushData } from './pushData';

/** The category with Allow / Deny (kept id; must match the server's `APPROVAL_CATEGORY_ID`). */
export const APPROVAL_CATEGORY_ID = 'approval';

/** High-importance Android channel for everything that needs you. */
export const APPROVAL_CHANNEL_ID = 'approvals';

/** The shape `Notifications.setNotificationCategoryAsync` takes (structural, so this file needs no Expo import). */
export interface CategoryAction {
  identifier: string;
  buttonTitle: string;
  textInput?: { submitButtonTitle: string; placeholder: string };
  options: { opensAppToForeground: boolean; isDestructive?: boolean; isAuthenticationRequired?: boolean };
}

export interface CategoryRegistration {
  identifier: NotificationCategoryId;
  actions: CategoryAction[];
  options: { categorySummaryFormat: string; showTitle: boolean };
}

/**
 * Background actions (Allow once, Deny, Reply) require the device to be unlocked first (`isAuthenticationRequired`,
 * iOS): anyone holding a locked phone could otherwise answer, and the signed request needs the device credential,
 * which lives in "when unlocked" storage. Android shows no action buttons on a secure lock screen (PRIVATE channels).
 */
function toAction(action: NotificationActionDef): CategoryAction {
  if (action.kind === 'foreground') return { identifier: action.id, buttonTitle: action.title, options: { opensAppToForeground: true } };
  const base: CategoryAction = {
    identifier: action.id,
    buttonTitle: action.title,
    options: { opensAppToForeground: false, isAuthenticationRequired: true, ...(action.destructive ? { isDestructive: true } : {}) },
  };
  if (action.kind === 'text') base.textInput = { submitButtonTitle: action.submitTitle ?? 'Send', placeholder: action.placeholder ?? '' };
  return base;
}

/** Every category, registered on each launch (idempotent). */
export function categoryRegistrations(): CategoryRegistration[] {
  return NOTIFICATION_CATEGORY_IDS.map((id) => ({
    identifier: id,
    actions: NOTIFICATION_CATEGORIES[id].actions.map(toAction),
    options: { categorySummaryFormat: NOTIFICATION_SUMMARY_FORMAT, showTitle: true },
  }));
}

export type GateKind = 'permission' | 'question' | 'plan';

interface QuestionData {
  id: string;
  options: string[];
  freeText: boolean;
  count: number;
}

/** What the app should do with a notification response. */
export type NotificationIntent =
  /** Resolve an ordinary permission gate in place. `route` is the fallback screen. */
  | { type: 'decide'; serverId?: string; chatId: string; interactionId: string; behavior: 'allow' | 'deny'; route: string | null }
  /** Answer a question gate in place with the typed reply. */
  | {
      type: 'answer';
      serverId?: string;
      chatId: string;
      interactionId: string;
      response: { answers: Record<string, string[]>; freeformResponse?: string };
      route: string | null;
    }
  /** Open a screen (default tap, Open / Review, or an action that cannot be answered in place). */
  | { type: 'open'; route: string }
  /** Nothing to do: not our payload, or a route the allowlist refused. */
  | { type: 'ignore'; reason: 'no-route' | 'unsafe-route' };

/**
 * Ids are path segments of the decision URL. They come from the server's own database, but the payload has passed
 * through a third-party push service, so anything that could change the request's path is refused outright.
 */
const SAFE_ID = /^[A-Za-z0-9._~-]{1,128}$/;

function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

/**
 * A typed reply → the answer to send, or null when it cannot be answered from the notification (several questions,
 * or a choice-only question the reply does not name).
 */
export function answerForReply(question: QuestionData | undefined, text: string): { answers: Record<string, string[]>; freeformResponse?: string } | null {
  const reply = text.trim();
  if (!reply) return null;
  if (!question) return { answers: {}, freeformResponse: reply };
  if (question.count !== 1) return null;
  const match = question.options.find((option) => option.trim().toLowerCase() === reply.toLowerCase());
  if (match) return { answers: { [question.id]: [match] } };
  return question.freeText ? { answers: {}, freeformResponse: reply } : null;
}

function questionOf(value: unknown): QuestionData | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const q = value as Partial<QuestionData>;
  if (typeof q.id !== 'string' || !Array.isArray(q.options) || typeof q.freeText !== 'boolean' || typeof q.count !== 'number') return undefined;
  return { id: q.id, options: q.options.filter((o): o is string => typeof o === 'string'), freeText: q.freeText, count: q.count };
}

/**
 * Map a notification response to an intent.
 *
 * @param actionIdentifier `response.actionIdentifier`
 * @param data `response.notification.request.content.data`
 * @param defaultActionIdentifier `Notifications.DEFAULT_ACTION_IDENTIFIER` (passed in so this module needs no Expo import)
 * @param userText `response.userText` (the Reply field)
 */
export function intentFromResponse(actionIdentifier: string, data: unknown, defaultActionIdentifier: string, userText?: string): NotificationIntent {
  const payload = normalizePushData(data) ?? {};
  const safe = safeRoute(payload.route);
  const routeServerId = safe ? new URL(safe, 'https://local.invalid').searchParams.get('server') : null;
  const serverId = safeId(payload.serverId ?? routeServerId);
  if (payload.serverId !== undefined && (!serverId || !/^[A-Za-z0-9_-]+$/.test(serverId))) return { type: 'ignore', reason: 'unsafe-route' };
  const target = safe ? new URL(safe, 'https://local.invalid') : null;
  if (target && serverId) target.searchParams.set('server', serverId);
  const route = target ? target.pathname + target.search : null;
  const server = serverId ? { serverId } : {};

  const openOrIgnore = (): NotificationIntent => {
    if (route) return { type: 'open', route };
    return { type: 'ignore', reason: typeof payload.route === 'string' && payload.route.length > 0 ? 'unsafe-route' : 'no-route' };
  };

  if (actionIdentifier === defaultActionIdentifier) return openOrIgnore();
  const chatId = safeId(payload.chatId);
  const interactionId = safeId(payload.interactionId);

  if (actionIdentifier === 'approve' || actionIdentifier === 'deny') {
    // Only an ordinary permission gate has a closed allow/deny answer, and only when the server said this action
    // exists for it. A risky gate is signed in the app (MD-31) even if a stale category offered the button.
    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    if (payload.category !== APPROVAL_CATEGORY_ID || payload.risk === 'risky' || payload.kind !== 'permission' || !actions.includes(actionIdentifier) || !chatId || !interactionId) {
      return openOrIgnore();
    }
    return { type: 'decide', chatId, interactionId, behavior: actionIdentifier === 'approve' ? 'allow' : 'deny', route, ...server };
  }

  if (actionIdentifier === 'reply') {
    if (payload.category !== 'question' || payload.kind !== 'question' || !chatId || !interactionId) return openOrIgnore();
    const response = answerForReply(questionOf(payload.question), userText ?? '');
    if (!response) return openOrIgnore();
    return { type: 'answer', chatId, interactionId, response, route, ...server };
  }

  return openOrIgnore();
}

export type DecisionOutcome =
  /** The gate is resolved (by this tap, or already — 409 — by another client). */
  | 'settled'
  /** The gate no longer exists (404): expired, cancelled, or a stale push. */
  | 'gone'
  /** Rejected (401/403): the device lacks `write:chats`, its session lapsed, or the gate needs a signature. */
  | 'forbidden'
  /** Anything else — the user should be shown the gate so they can retry. */
  | 'failed';

/**
 * Interpret the server's answer. A 409 is success from the user's point of view: someone (perhaps their own
 * desktop) already answered, and the agent is unblocked either way.
 */
export function decisionOutcome(status: number): DecisionOutcome {
  if (status === 202 || status === 200 || status === 409) return 'settled';
  if (status === 404) return 'gone';
  if (status === 401 || status === 403) return 'forbidden';
  return 'failed';
}

type SignedFetch = (path: string, init?: RequestInit) => Promise<Response>;

async function outcomeOf(call: () => Promise<unknown>): Promise<DecisionOutcome> {
  try {
    await call();
    return 'settled';
  } catch (error) {
    return error instanceof ApiError ? decisionOutcome(error.status) : 'failed';
  }
}

/** Send the decision through a signed fetch. Never throws: a network failure is `'failed'`, and the caller opens the gate. */
export function submitDecision(intent: Extract<NotificationIntent, { type: 'decide' }>, fetchImpl: SignedFetch): Promise<DecisionOutcome> {
  return outcomeOf(() =>
    createApiClient(fetchImpl).chats.respondPermission(encodeURIComponent(intent.chatId), encodeURIComponent(intent.interactionId), { behavior: intent.behavior }),
  );
}

/** Send a reply through a signed fetch; same outcome rules as a decision. */
export function submitAnswer(intent: Extract<NotificationIntent, { type: 'answer' }>, fetchImpl: SignedFetch): Promise<DecisionOutcome> {
  return outcomeOf(() => createApiClient(fetchImpl).chats.respond(encodeURIComponent(intent.chatId), encodeURIComponent(intent.interactionId), intent.response));
}
