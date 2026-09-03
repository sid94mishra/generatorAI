// ────────────────────────────────────────────────────────────────
// useChatStream — connect a chat to its live event stream.
//
//   mux frames → StreamEventRouter → effects → store
//                                  ↘ query invalidation
//
// ── W09-a / W26 — mobile is on the multiplexed transport ─────────
// This used to open its own `GET /api/stream?scope=chat&id=…` through
// `SseClient`, with its own ticket, reconnect loop and stall watchdog. The
// header here argued that was fine because "the navigation stack shows one
// screen at a time", and that was true of CHAT screens and false of the app:
// nothing else could subscribe without opening a second socket, which is why
// the `global` scope — and therefore every live list update — simply did not
// exist on mobile.
//
// It now subscribes a scope on the connection `MuxStreamProvider` owns. Adding
// `global` (see `useGlobalStream`) costs a `POST .../subs`, not a socket.
// Resume, cross-scope dedup, reconnect and backoff all moved into
// `MuxStreamClient`, which is the same code web and the CLI run.
//
// ── Why the flush is on a timer rather than per event ────────────
// A fast model emits 100–300 tokens/second. Applying each to the store
// immediately means that many store updates and React renders per second,
// which drops frames on any phone. The router buffers text and this hook
// drains it on a ~16ms tick, so the store sees at most ~60 updates/second
// regardless of token rate.
//
// Ordered events (tool calls, turn boundaries, errors) bypass the buffer:
// the router flushes pending text before them, so coalescing never reorders
// the transcript.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  StreamEventRouter,
  queryKeys,
  type MuxStreamEvent,
  type StreamEffect,
} from '@generatorai/client-core';
import { MOBILE_CAPABILITIES } from '@generatorai/shared';

import { useStreamStore } from './streamStore';
import { useMuxStream } from './MuxStreamProvider';

const FLUSH_INTERVAL_MS = 16;

/**
 * Connection state, in the shape screens already render.
 *
 * Kept structurally identical to `SseClient`'s `SseStatus` so the chat screen's
 * status chip did not have to change with the transport underneath it.
 */
export type SseStatus =
  | { state: 'idle' }
  | { state: 'connecting'; attempt: number }
  | { state: 'open' }
  | { state: 'reconnecting'; attempt: number; delayMs: number }
  | { state: 'closed'; reason: string };

export interface UseChatStreamOptions {
  chatId: string;
  /** Skip connecting (e.g. the screen is not focused). */
  enabled?: boolean;
  onStatusChange?(status: SseStatus): void;
}

export function useChatStream({
  chatId,
  enabled = true,
  onStatusChange,
}: UseChatStreamOptions): void {
  const queryClient = useQueryClient();
  const stream = useMuxStream();
  const applyEffects = useStreamStore((s) => s.applyEffects);

  // Refs, not state: these must not trigger a re-render, and the effect must
  // not re-run when a callback identity changes mid-stream.
  // W29/W30-d — the delivery mode comes from the ledger, not from a hardcode
  // here. Mobile is the surface that declares `highLatencyBlockDelivery`, so
  // this router releases prose at markdown block boundaries and raises a
  // typing indicator in between; web constructs the same class with web's
  // entry and gets per-chunk edits. Changing the ledger changes the runtime.
  const routerRef = useRef(
    new StreamEventRouter({ blockDelivery: MOBILE_CAPABILITIES.highLatencyBlockDelivery }),
  );
  const pendingRef = useRef<StreamEffect[]>([]);
  const invalidateRef = useRef(new Map<string, string | undefined>());

  useEffect(() => {
    if (!enabled || !stream) return;

    const router = routerRef.current;
    router.reset();

    /**
     * Apply buffered effects.
     *
     * Query invalidations are de-duplicated per tick: a burst of ten
     * `message_complete` events must produce ONE refetch, not ten.
     */
    const flush = (final = false): void => {
      // W30-d — the frame tick releases only completed blocks; teardown must
      // release everything, or the sentence the user was reading is lost when
      // they navigate away mid-block.
      const drained = final ? router.drainFinal() : router.drain();
      const effects = pendingRef.current.concat(drained);
      pendingRef.current = [];

      if (effects.length > 0) applyEffects(effects);

      const resources = invalidateRef.current;
      if (resources.size > 0) {
        for (const [resource, id] of resources) {
          switch (resource) {
            case 'messages':
              void queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
              break;
            case 'plans':
              void queryClient.invalidateQueries({ queryKey: queryKeys.chatPlans(chatId) });
              break;
            case 'interactions':
              void queryClient.invalidateQueries({ queryKey: queryKeys.chatInteractions(chatId) });
              break;
            case 'chat':
              void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
              break;
            case 'tasks':
              void queryClient.invalidateQueries({ queryKey: queryKeys.chatTasks(chatId) });
              break;
            case 'workspace':
              // Every workspace-scoped surface — changes, tree, file bodies
              // — keys off the workspace id, so one prefix match covers the
              // Workbench without the sheet having to poll.
              if (id) {
                void queryClient.invalidateQueries({ queryKey: ['workspaces', id] });
              }
              break;
            default:
              break;
          }
        }
        resources.clear();
      }
    };

    const timer = setInterval(flush, FLUSH_INTERVAL_MS);

    const unsubscribe = stream.subscribe(
      'chat',
      chatId,
      (event: MuxStreamEvent) => {
        // The frame carries no sessionId of its own; the payload does when
        // the event belongs to a session, and the chat id is the fallback the
        // router keys transcripts by.
        const sessionId =
          typeof event.data['sessionId'] === 'string' ? event.data['sessionId'] : chatId;
        for (const effect of router.handle(sessionId, { kind: event.kind, data: event.data })) {
          if (effect.op === 'invalidate') {
            invalidateRef.current.set(effect.resource, effect.id);
          } else {
            pendingRef.current.push(effect);
          }
        }
      },
      {
        onConnected: () => onStatusChange?.({ state: 'open' }),
        onReconnecting: (attempt) =>
          onStatusChange?.({ state: 'reconnecting', attempt, delayMs: 0 }),
        onDisconnected: (reason) => {
          // A `gap:` reason means this scope's cursor could not be honoured,
          // so the transcript needs a fresh snapshot rather than a resume.
          if (reason?.startsWith('gap:')) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
          }
          onStatusChange?.({ state: 'closed', reason: reason ?? 'disconnected' });
        },
      },
    );

    onStatusChange?.({ state: 'connecting', attempt: 1 });

    return () => {
      unsubscribe();
      clearInterval(timer);
      // Final flush so text buffered in the last partial tick is not lost
      // when the user navigates away mid-sentence.
      flush(true);
      router.reset();
    };
  }, [chatId, enabled, stream, queryClient, applyEffects, onStatusChange]);
}
