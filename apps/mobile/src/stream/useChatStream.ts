// ────────────────────────────────────────────────────────────────
// useChatStream — connect a chat to its live event stream.
//
//   SSE bytes → SseParser → StreamEventRouter → effects → store
//                                             ↘ query invalidation
//
// ── STR-04 / W48 — Mobile stream architecture ────────────────────
// Mobile is already single-connection correct:
//   • Navigation stack shows one screen at a time; `enabled` is false for
//     off-screen screens, so only one SseClient is active per app session.
//   • The AppState listener closes the stream when the app backgrounds,
//     resuming from the cursor when it comes foreground — no stale socket.
//   • `SseClient` uses expo/fetch (real streaming body), not EventSource,
//     with a stall watchdog and jittered reconnect — already better than
//     a raw EventSource on the web.
// No mux stream changes are needed for mobile.
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
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { StreamEventRouter, queryKeys, type StreamEffect } from '@generatorai/client-core';

import { useAuth } from '../auth/AuthProvider';
import { SseClient, type SseStatus, type StreamEvent } from './SseClient';
import { useStreamStore } from './streamStore';

const FLUSH_INTERVAL_MS = 16;

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
  const { streamUrl, state } = useAuth();
  const queryClient = useQueryClient();
  const applyEffects = useStreamStore((s) => s.applyEffects);

  // Refs, not state: these must not trigger a re-render, and the effect must
  // not re-run when a callback identity changes mid-stream.
  const routerRef = useRef(new StreamEventRouter());
  const pendingRef = useRef<StreamEffect[]>([]);
  const invalidateRef = useRef(new Map<string, string | undefined>());

  useEffect(() => {
    if (!enabled || state.status !== 'authenticated') return;

    const router = routerRef.current;
    router.reset();

    /**
     * Apply buffered effects.
     *
     * Query invalidations are de-duplicated per tick: a burst of ten
     * `message_complete` events must produce ONE refetch, not ten.
     */
    const flush = (): void => {
      const drained = router.drain();
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

    const client = new SseClient({
      buildUrl: (afterSeq) =>
        streamUrl('chat', chatId).then((url) =>
          afterSeq > 0 ? `${url}${url.includes('?') ? '&' : '?'}afterSeq=${afterSeq}` : url,
        ),
      onEvent: (event: StreamEvent) => {
        for (const effect of router.handle(event.sessionId ?? chatId, event)) {
          if (effect.op === 'invalidate') {
            invalidateRef.current.set(effect.resource, effect.id);
          } else {
            pendingRef.current.push(effect);
          }
        }
      },
      ...(onStatusChange ? { onStatusChange } : {}),
    });

    client.start();

    /**
     * Detach while backgrounded.
     *
     * iOS suspends timers and sockets anyway; holding the connection just
     * burns battery and produces a stale socket that looks alive. On return
     * we resume from the cursor, so nothing is lost.
     */
    const onAppStateChange = (next: AppStateStatus): void => {
      if (next === 'active') {
        client.start(client.cursor);
      } else if (next === 'background') {
        client.close();
      }
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      subscription.remove();
      clearInterval(timer);
      client.close();
      // Final flush so text buffered in the last partial tick is not lost
      // when the user navigates away mid-sentence.
      flush();
      router.reset();
    };
  }, [chatId, enabled, state.status, streamUrl, queryClient, applyEffects, onStatusChange]);
}
