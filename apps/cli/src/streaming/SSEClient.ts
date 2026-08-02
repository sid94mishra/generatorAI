// SSEClient — Manages Server-Sent Event connections with automatic reconnection.
// Wraps the EventSource API with typed events, sequence tracking, and graceful shutdown.

import type { PersistedEvent } from '@generatorai/shared';
import type { SSEScope, SSESubscriptionOptions } from '../platform/types.js';

export interface SSEClientOptions {
  baseUrl: string;
  scope: SSEScope;
  id: string;
  handler: (event: PersistedEvent) => void;
  options?: SSESubscriptionOptions;
  apiKey?: string;
}

export class SSEClient {
  private eventSource: EventSource | null = null;
  private lastSequence = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private reconnectDelay = 1000;
  private closed = false;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;

  constructor(private readonly config: SSEClientOptions) {
    if (config.options?.afterSequence) {
      this.lastSequence = config.options.afterSequence;
    }
  }

  connect(): void {
    if (this.closed) return;

    const url = this.buildUrl();

    // Dynamic import EventSource for Node.js environments
    this.createEventSource(url);
  }

  private buildUrl(): string {
    const params = new URLSearchParams();
    params.set('scope', this.config.scope);
    params.set('id', this.config.id);

    if (this.lastSequence > 0) {
      params.set('afterSeq', String(this.lastSequence));
    }

    if (this.config.options?.filter?.length) {
      params.set('filter', this.config.options.filter.join(','));
    }

    if (this.config.apiKey) {
      params.set('apiKey', this.config.apiKey);
    }

    return `${this.config.baseUrl}/api/stream?${params.toString()}`;
  }

  private createEventSource(url: string): void {
    // Use global EventSource (available via eventsource polyfill)
    const ES = globalThis.EventSource;
    if (!ES) {
      throw new Error('EventSource not available. Install "eventsource" package.');
    }

    this.eventSource = new ES(url);

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.config.options?.onConnected?.();
    };

    this.eventSource.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as PersistedEvent;

        // Track sequence for reconnection
        if (parsed.sequenceId > this.lastSequence) {
          this.lastSequence = parsed.sequenceId;
        }

        this.config.handler(parsed);
      } catch {
        // Silently skip malformed events
      }
    };

    this.eventSource.onerror = () => {
      if (this.closed) return;

      this.eventSource?.close();
      this.eventSource = null;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.config.options?.onDisconnected?.();
        return;
      }

      this.reconnectAttempts++;
      this.config.options?.onReconnecting?.();

      // Exponential backoff with jitter
      const jitter = Math.random() * 500;
      const delay = Math.min(this.reconnectDelay + jitter, 30000);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);

      this.reconnectTimeout = setTimeout(() => this.connect(), delay);
    };
  }

  /** Get the last seen sequence number (for replay on reconnect) */
  getLastSequence(): number {
    return this.lastSequence;
  }

  /** Close the connection permanently */
  close(): void {
    this.closed = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.eventSource?.close();
    this.eventSource = null;
  }
}
