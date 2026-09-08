// ────────────────────────────────────────────────────────────────
// PushDispatcher — turns interesting events into notifications.
//
//   EventBus.subscribeAll ──▶ planNotification ──▶ scope filter ──▶ provider
//
// ── Design constraints that shaped this ──────────────────────────
//
// 1. SCOPE IS ENFORCED PER DEVICE. A notification body carries content (run
//    names, error text, plan summaries). A device without the corresponding
//    read scope must never receive it — otherwise push becomes a side channel
//    around the authorization model that every HTTP route is checked against.
//
// 2. DELIVERY IS FIRE-AND-FORGET. A slow or down push service must never
//    block the event bus, because that bus also drives SSE to every connected
//    client. A dropped notification is a minor annoyance; a stalled bus is an
//    outage.
//
// 3. DEDUPLICATION IS BY (device, thread, category). Agents re-emit gate
//    events on reconnect and replay, and buzzing a phone five times for one
//    approval is how users disable notifications permanently.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';

import {
  isMutable,
  planNotification,
  type InteractionKind,
  type NotificationPlan,
} from './notificationPolicy.js';

/** What the dispatcher needs to know about a device. Structural, so the
 *  service does not depend on the auth package's concrete record type. */
export interface PushTarget {
  deviceId: string;
  scopes: readonly string[];
  token: string;
  provider: 'expo' | 'apns' | 'fcm';
  platform: string;
  mutedUntil: number | null;
}

/**
 * What the app receives in the notification's `data` field.
 *
 * `route`/`category`/`threadId` are always present. The interaction fields
 * are set for chat gates so a lock-screen action can resolve the gate
 * without opening the UI; `actions` is present ONLY for tool-permission
 * prompts (the one gate with a closed allow/deny answer).
 */
export interface PushData {
  route: string;
  category: string;
  threadId: string;
  chatId?: string;
  interactionId?: string;
  kind?: InteractionKind;
  actions?: readonly string[];
}

export interface PushMessage {
  target: PushTarget;
  title: string;
  body: string;
  /** Consumed by the app to deep-link on tap and to act from the lock screen. */
  data: PushData;
  threadId: string;
  interruption: 'active' | 'timeSensitive';
  /**
   * Expo/UNNotification category identifier. The app registers an
   * `approval` category with Allow/Deny buttons at startup, so every
   * approval notification names it — the OS then renders the buttons.
   */
  categoryId?: string;
}

/** Pluggable delivery, so Expo Push / APNs / FCM can be swapped or faked. */
export interface PushProviderClient {
  send(messages: PushMessage[]): Promise<Array<{ deviceId: string; ok: boolean; error?: string }>>;
}

export interface PushDispatcherPorts {
  listTargets(): PushTarget[];
  recordSuccess(deviceId: string): void;
  recordFailure(deviceId: string, error: string): void;
  provider: PushProviderClient;
  logger: ILogger;
  clock?: () => number;
  /** Suppression window for an identical (device, thread, category). */
  dedupeWindowMs?: number;
}

interface EventLike {
  kind: string;
  data: unknown;
}

const DEFAULT_DEDUPE_MS = 60_000;

export class PushDispatcher {
  private readonly clock: () => number;
  private readonly dedupeWindowMs: number;
  /** `${deviceId}|${threadId}|${category}` → last sent time. */
  private readonly recentlySent = new Map<string, number>();

  constructor(private readonly ports: PushDispatcherPorts) {
    this.clock = ports.clock ?? Date.now;
    this.dedupeWindowMs = ports.dedupeWindowMs ?? DEFAULT_DEDUPE_MS;
  }

  /**
   * Handle one event.
   *
   * Returns the messages it decided to send, so tests can assert the decision
   * without a provider. Delivery itself is not awaited by the caller.
   */
  handleEvent(event: EventLike): PushMessage[] {
    const plan = planNotification({
      kind: event.kind,
      data: isRecord(event.data) ? event.data : undefined,
    });
    if (!plan) return [];

    const now = this.clock();
    const messages: PushMessage[] = [];

    for (const target of this.ports.listTargets()) {
      if (!this.shouldDeliver(target, plan, now)) continue;

      messages.push({
        target,
        title: plan.title,
        body: plan.body,
        data: buildData(plan),
        threadId: plan.threadId,
        interruption: plan.interruption,
        ...(plan.category === 'approval' ? { categoryId: APPROVAL_CATEGORY_ID } : {}),
      });
      this.recentlySent.set(dedupeKey(target.deviceId, plan), now);
    }

    if (messages.length > 0) {
      // Deliberately not awaited: a slow push service must never stall the
      // event bus that also drives SSE to every connected client.
      void this.deliver(messages);
    }
    return messages;
  }

  private shouldDeliver(target: PushTarget, plan: NotificationPlan, now: number): boolean {
    // Constraint 1 — the notification body carries readable content.
    if (!target.scopes.includes(plan.requiredScope)) return false;

    // Muting never applies to approvals: a user who mutes those silently
    // blocks their own agents and then wonders why nothing progresses.
    if (isMutable(plan.category) && target.mutedUntil != null && target.mutedUntil > now) {
      return false;
    }

    // Constraint 3 — replay and reconnect re-emit gate events.
    const lastSent = this.recentlySent.get(dedupeKey(target.deviceId, plan));
    if (lastSent != null && now - lastSent < this.dedupeWindowMs) return false;

    return true;
  }

  private async deliver(messages: PushMessage[]): Promise<void> {
    try {
      const results = await this.ports.provider.send(messages);
      for (const result of results) {
        if (result.ok) {
          this.ports.recordSuccess(result.deviceId);
        } else {
          this.ports.recordFailure(result.deviceId, result.error ?? 'unknown push failure');
        }
      }
    } catch (err) {
      // Never log the token or the body: one is credential material, the
      // other is user content.
      this.ports.logger.warn('[Push] Delivery failed', {
        count: messages.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Drop dedupe entries older than the window so the map cannot grow without bound. */
  pruneDedupeCache(): void {
    const cutoff = this.clock() - this.dedupeWindowMs;
    for (const [key, at] of this.recentlySent) {
      if (at < cutoff) this.recentlySent.delete(key);
    }
  }
}

/** Must match the category the mobile app registers with Allow/Deny actions. */
export const APPROVAL_CATEGORY_ID = 'approval';

function buildData(plan: NotificationPlan): PushData {
  const data: PushData = { route: plan.route, category: plan.category, threadId: plan.threadId };
  const gate = plan.interaction;
  if (gate) {
    data.chatId = gate.chatId;
    data.interactionId = gate.interactionId;
    data.kind = gate.kind;
    if (gate.actions && gate.actions.length > 0) data.actions = [...gate.actions];
  }
  return data;
}

function dedupeKey(deviceId: string, plan: NotificationPlan): string {
  return `${deviceId}|${plan.threadId}|${plan.category}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
