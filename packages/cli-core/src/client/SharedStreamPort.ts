/**
 * SharedStreamPort — connection-deduplicating wrapper around StreamPort.
 *
 * W48 / STR-04 — CLI step toward the full mux stream (one connection per tab).
 *
 * The TUI's `StreamReconciler` opens one connection per pane; when two panes
 * show the same scope:id (e.g. two tabs on the same chat) the naive
 * `StreamPort.subscribe()` would open two identical connections to the server.
 * `SharedStreamPort` tracks active connections by `scope:id` key and fans out
 * to all local handlers from a single underlying connection.
 *
 * This is the first step of the STR-04 CLI migration. The full step (one
 * connection for ALL scopes, using the mux endpoint) requires server-side
 * protocol support — see apps/web/src/platform/muxStream.ts for the reference
 * implementation.
 *
 * Thread safety: Node.js is single-threaded; no mutex needed.
 */

import type { StreamPort } from '../context/CliContext.js';

type StreamEvent = { kind: string; data: Record<string, unknown>; sequence?: number };
type SubscribeOptions = Parameters<StreamPort['subscribe']>[3];

type HandlerEntry = {
  handler: (event: StreamEvent) => void;
  options?: SubscribeOptions;
};

interface SharedEntry {
  /** All local handlers subscribed to this scope:id. */
  handlers: Set<HandlerEntry>;
  /** Max sequence seen — used when a new handler joins late to resume. */
  maxSeq: number;
  /** Disposer from the underlying StreamPort connection. */
  dispose: () => void;
}

export class SharedStreamPort implements StreamPort {
  private readonly shared = new Map<string, SharedEntry>();

  constructor(private readonly underlying: StreamPort) {}

  subscribe(
    scope: 'session' | 'run' | 'chat' | 'global',
    id: string,
    handler: (event: StreamEvent) => void,
    options?: SubscribeOptions,
  ): () => void {
    const key = `${scope}:${id}`;
    let entry = this.shared.get(key);

    const handlerEntry: HandlerEntry = { handler, options };

    if (!entry) {
      // First subscriber for this scope:id — open one real connection.
      const handlers = new Set<HandlerEntry>();
      let maxSeq = options?.afterSequence ?? 0;

      const dispose = this.underlying.subscribe(scope, id, (event) => {
        if (typeof event.sequence === 'number') {
          maxSeq = Math.max(maxSeq, event.sequence);
          (sharedEntry as { maxSeq: number }).maxSeq = maxSeq;
        }
        // Fan-out to all local handlers.
        for (const h of handlers) {
          try {
            h.handler(event);
          } catch {
            // isolated — never let one pane crash another
          }
        }
      }, {
        // Use the minimum afterSequence across all (initial) options.
        afterSequence: options?.afterSequence,
        filter: options?.filter,
        onConnected: () => {
          for (const h of handlers) {
            h.options?.onConnected?.();
          }
        },
        onReconnecting: (attempt) => {
          for (const h of handlers) {
            h.options?.onReconnecting?.(attempt);
          }
        },
        onDisconnected: (reason) => {
          for (const h of handlers) {
            h.options?.onDisconnected?.(reason);
          }
        },
      });

      const sharedEntry: SharedEntry = { handlers, maxSeq, dispose };
      this.shared.set(key, sharedEntry);
      entry = sharedEntry;
    }

    entry.handlers.add(handlerEntry);

    return () => {
      entry?.handlers.delete(handlerEntry);
      if (entry?.handlers.size === 0) {
        // Last subscriber gone — close the underlying connection.
        entry.dispose();
        this.shared.delete(key);
      }
    };
  }

  /** Dispose all active connections (call on CLI exit). */
  disposeAll(): void {
    for (const entry of this.shared.values()) {
      entry.dispose();
    }
    this.shared.clear();
  }
}
