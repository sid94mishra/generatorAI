// ────────────────────────────────────────────────────────────────
// Expo Push provider.
//
// ── Why Expo Push and not direct APNs/FCM ────────────────────────
// Direct delivery needs an APNs signing key and an FCM service account
// stored on the user's own server — more credential material to protect, in
// a product whose entire premise is minimising that. Expo's service needs
// neither; it accepts an opaque device token and delivers.
//
// ── What Expo can and cannot see ─────────────────────────────────
// It sees the TITLE and BODY, because it has to render them. That is the
// same trade every push service demands, including Apple's and Google's:
// APNs sees the payload too. What it never sees is the API, the workspace,
// the diff, or any credential — the notification is a doorbell, and the
// content lives behind the E2E-encrypted transport.
//
// Users who consider that unacceptable can disable push entirely
// (GENERATORAI_PUSH=0) and rely on opening the app, which is why the feature
// degrades cleanly rather than being load-bearing.
// ────────────────────────────────────────────────────────────────

import type { IHttpClient } from '../../domain/ports/IHttpClient.js';
import type { PushMessage, PushProviderClient } from './PushDispatcher.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo rejects batches larger than this. */
const MAX_BATCH = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export class ExpoPushProvider implements PushProviderClient {
  constructor(
    private readonly http: IHttpClient,
    private readonly options: { accessToken?: string | undefined } = {},
  ) {}

  async send(
    messages: PushMessage[],
  ): Promise<Array<{ deviceId: string; ok: boolean; error?: string }>> {
    const results: Array<{ deviceId: string; ok: boolean; error?: string }> = [];

    for (let i = 0; i < messages.length; i += MAX_BATCH) {
      const batch = messages.slice(i, i + MAX_BATCH);
      results.push(...(await this.sendBatch(batch)));
    }
    return results;
  }

  private async sendBatch(
    batch: PushMessage[],
  ): Promise<Array<{ deviceId: string; ok: boolean; error?: string }>> {
    const payload = batch.map((message) => ({
      to: message.target.token,
      title: message.title,
      body: message.body,
      data: message.data,
      sound: 'default',
      // Groups related notifications into one stack on both platforms.
      ...(message.target.platform === 'ios'
        ? { threadId: message.threadId, interruptionLevel: message.interruption }
        : { channelId: message.data.category }),
      // Approvals expire: an hour-old gate has usually been handled at a
      // desk, and delivering it then is pure noise.
      ttl: message.interruption === 'timeSensitive' ? 3600 : 900,
    }));

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.options.accessToken) {
      headers['authorization'] = `Bearer ${this.options.accessToken}`;
    }

    const response = await this.http.request({
      url: EXPO_PUSH_URL,
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      // Short: this runs off the event bus, and a hung push call must not
      // pile up requests behind it.
      timeout: 10_000,
    });

    if (response.status < 200 || response.status >= 300) {
      // A transport-level failure applies to the whole batch. Marking every
      // token failed would delete healthy ones after five outages, so this
      // is reported without incrementing per-token failure counts.
      return batch.map((m) => ({
        deviceId: m.target.deviceId,
        ok: false,
        error: `expo push returned ${response.status}`,
      }));
    }

    let tickets: ExpoTicket[] = [];
    try {
      tickets = (JSON.parse(response.body) as { data?: ExpoTicket[] }).data ?? [];
    } catch {
      return batch.map((m) => ({
        deviceId: m.target.deviceId,
        ok: false,
        error: 'malformed push response',
      }));
    }

    return batch.map((message, index) => {
      const ticket = tickets[index];
      if (!ticket || ticket.status === 'ok') {
        return { deviceId: message.target.deviceId, ok: true };
      }
      return {
        deviceId: message.target.deviceId,
        ok: false,
        // `DeviceNotRegistered` is the one that matters: the app was
        // uninstalled, and the token will never work again.
        error: ticket.details?.error ?? ticket.message ?? 'push rejected',
      };
    });
  }
}
