// ────────────────────────────────────────────────────────────────
// SSE client for React Native.
//
// RN has no `EventSource`, so this drives `expo/fetch` (which, unlike RN's
// XHR-backed fetch, gives a real streaming body) and feeds bytes to the
// shared `SseParser`.
//
// Responsibilities beyond reading bytes:
//   * mint a FRESH single-use ticket per connect (they are 30s and one-shot)
//   * resume at `afterSeq` so a reconnect never replays or skips
//   * bounded jittered reconnect
//   * a stall watchdog, because a silently dead TCP connection looks
//     identical to an idle one from JS
// ────────────────────────────────────────────────────────────────

import { fetch as expoFetch } from 'expo/fetch';
import { SseParser, parseSseJson } from '@generatorai/client-core';

export interface StreamEvent {
  kind: string;
  sessionId?: string;
  data?: Record<string, unknown>;
  seq?: number;
}

export interface SseClientOptions {
  /** Mints a ticketed URL. Called again on every reconnect. */
  buildUrl(afterSeq: number): Promise<string>;
  onEvent(event: StreamEvent): void;
  onStatusChange?(status: SseStatus): void;
  /**
   * No traffic for this long ⇒ assume the connection is dead.
   *
   * The server sends keep-alive comments, so silence really does mean a
   * broken path — most often a phone that changed networks, where the socket
   * stays "open" from JS's point of view forever.
   */
  stallTimeoutMs?: number;
  maxRetries?: number;
}

export type SseStatus =
  | { state: 'idle' }
  | { state: 'connecting'; attempt: number }
  | { state: 'open' }
  | { state: 'reconnecting'; attempt: number; delayMs: number }
  | { state: 'closed'; reason: string };

const DEFAULT_STALL_MS = 90_000;

export class SseClient {
  private controller: AbortController | null = null;
  private readonly parser = new SseParser();
  private afterSeq = 0;
  private attempt = 0;
  private closed = false;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SseClientOptions) {}

  /** Highest sequence seen — the resume cursor. */
  get cursor(): number {
    return this.afterSeq;
  }

  /** Begin streaming from `afterSeq` (0 = from the start of the cursor log). */
  start(afterSeq = 0): void {
    this.afterSeq = afterSeq;
    this.closed = false;
    this.attempt = 0;
    void this.connect();
  }

  close(): void {
    this.closed = true;
    this.clearStall();
    this.controller?.abort();
    this.controller = null;
    this.setStatus({ state: 'closed', reason: 'closed by caller' });
  }

  private setStatus(status: SseStatus): void {
    this.options.onStatusChange?.(status);
  }

  private clearStall(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  /** Restart the watchdog. Called on every byte, not every event: a
   *  keep-alive comment is proof of life even though it yields no event. */
  private armStall(): void {
    this.clearStall();
    this.stallTimer = setTimeout(() => {
      // Aborting forces the read loop into the reconnect path.
      this.controller?.abort();
    }, this.options.stallTimeoutMs ?? DEFAULT_STALL_MS);
  }

  private async connect(): Promise<void> {
    if (this.closed) return;

    this.attempt += 1;
    this.setStatus({ state: 'connecting', attempt: this.attempt });

    const controller = new AbortController();
    this.controller = controller;

    try {
      // A fresh ticket per attempt: they are single-use and 30s, so reusing
      // one across a reconnect fails with an opaque 401.
      const url = await this.options.buildUrl(this.afterSeq);

      const response = await expoFetch(url, {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`Stream returned ${response.status}`);
      if (!response.body) throw new Error('Stream response had no body');

      this.setStatus({ state: 'open' });
      this.attempt = 0;
      this.parser.reset();
      this.armStall();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        this.armStall();

        // `stream: true` is required — a multi-byte character split across
        // two chunks would otherwise decode to a replacement character.
        for (const message of this.parser.push(decoder.decode(value, { stream: true }))) {
          const event = parseSseJson<StreamEvent>(message);
          if (!event?.kind) continue;
          // Advance the cursor BEFORE dispatching: a handler that throws
          // must not cause the same event to be replayed forever.
          if (typeof event.seq === 'number' && event.seq > this.afterSeq) {
            this.afterSeq = event.seq;
          }
          this.options.onEvent(event);
        }
      }

      // A clean end-of-body still means the stream is gone; reconnect.
      throw new Error('Stream ended');
    } catch (err) {
      if (this.closed) return;
      this.clearStall();

      const max = this.options.maxRetries ?? Infinity;
      if (this.attempt > max) {
        this.setStatus({ state: 'closed', reason: describe(err) });
        return;
      }

      // Exponential with jitter, capped. Jitter matters because every client
      // that dropped during the same server restart otherwise retries in
      // lockstep and knocks it over again.
      const base = Math.min(1000 * 2 ** (this.attempt - 1), 30_000);
      const delayMs = Math.round(base * (0.7 + Math.random() * 0.3));
      this.setStatus({ state: 'reconnecting', attempt: this.attempt, delayMs });

      setTimeout(() => void this.connect(), delayMs);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
