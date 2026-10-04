// ────────────────────────────────────────────────────────────────
// Recently finished activity hook (G-11) — Home "Recently finished".
//
// Merges chats' finished turns, terminal workflow runs and terminal
// automation executions into one feed, newest first. An item carries the
// commit / pull request its workspace made through the SCM flow (MG-13, see
// `packages/shared/src/types/RecentActivity.ts`). No SSE: Home refetches it
// when the attention feed (G-01) loses an item (something just finished).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { startOfDay } from '@generatorai/client-core';
import type { ChatMessage, RecentActivityItem } from '@generatorai/shared';
import { attachmentUrl } from '@/lib/attachmentUrl.js';
import { usePlatform } from '../providers/PlatformProvider.js';
import { useAttention } from './attentionQueries.js';

export interface RecentActivityQuery {
  since?: string;
  limit?: number;
  projectId?: string;
}

export const activityKeys = {
  all: ['activity-recent'] as const,
  recent: (query?: RecentActivityQuery) => ['activity-recent', query ?? {}] as const,
};

export function useRecentActivity(query?: RecentActivityQuery) {
  const platform = usePlatform();
  return useQuery({
    queryKey: activityKeys.recent(query),
    queryFn: () => platform.getRecentActivity(query),
    staleTime: 30_000,
  });
}

/** Most items a day's feed asks for (the endpoint's own cap). */
const TODAY_LIMIT = 100;
/**
 * A finished turn's list row (G-02) is written a moment after the attention
 * feed drops the chat: one more read after this delay catches it. A single
 * follow-up, not a polling loop.
 */
const FINISH_SETTLE_MS = 1_500;

/**
 * Everything that finished today (since local midnight), newest first — the
 * Activity column's Failed and Recent groups (D-92). No SSE of its own: it
 * refetches when the attention feed loses an item (something finished or was
 * answered), and moves to the new day at midnight.
 */
export function useTodayActivity(options: { enabled?: boolean } = {}) {
  const platform = usePlatform();
  const enabled = options.enabled !== false;
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  useEffect(() => {
    if (!enabled) return undefined;
    const wait = Math.max(1_000, day + 86_400_000 - Date.now() + 1_000);
    const timer = setTimeout(() => setDay(startOfDay(Date.now())), wait);
    return () => clearTimeout(timer);
  }, [day, enabled]);

  const query = useQuery({
    queryKey: activityKeys.recent({ since: new Date(day).toISOString(), limit: TODAY_LIMIT }),
    queryFn: () => platform.getRecentActivity({ since: new Date(day).toISOString(), limit: TODAY_LIMIT }),
    enabled,
    staleTime: 30_000,
  });

  const { data: attention } = useAttention({ enabled });
  const joined = attention ? [...attention.needsYou, ...attention.running].map((i) => i.key).join('\n') : undefined;
  const previous = useRef<ReadonlySet<string> | null>(null);
  const { refetch } = query;
  useEffect(() => {
    if (joined === undefined) return undefined;
    const current = new Set(joined ? joined.split('\n') : []);
    const before = previous.current;
    previous.current = current;
    if (!before || ![...before].some((key) => !current.has(key))) return undefined;
    void refetch();
    const timer = setTimeout(() => void refetch(), FINISH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [joined, refetch]);

  return query;
}

/** How many of the chat's latest messages are searched for the prompt to resend. */
const RETRY_HISTORY = 50;

/**
 * Retry a failed item with the existing endpoints (05 §G-11): a failed chat
 * resends its last prompt (`POST /chats/:id/prompt`), a failed run is forked
 * (engine v2: a terminal run is never mutated — "Retry failed" is a fork
 * invocation on the pinned definition with a fresh workspace, like the run
 * page's). Resolves to the new run's id for a run.
 */
export function useRetryActivity() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: Pick<RecentActivityItem, 'entityId' | 'retry'>): Promise<{ runId?: string }> => {
      if (item.retry === 'run_retry') {
        const fork = await platform.invokeWorkflow({
          target: { kind: 'fork', sourceRunId: item.entityId, definition: 'pinned', workspace: 'fresh' },
          variables: {},
          client: 'web',
        });
        return { runId: fork.runId };
      }
      if (item.retry === 'chat_prompt') {
        const messages = await platform.getChatMessages(item.entityId, RETRY_HISTORY);
        const last = [...messages].reverse().find((m) => m.role === 'user' && (m.content.trim() || m.attachments?.length));
        if (!last) throw new Error('This chat has no prompt to send again.');
        // The prompt goes again WITH its files (final-review #21): each is fetched back from the chat.
        const files = await Promise.all((last.attachments ?? []).map((att) => refetchAttachment(att, item.entityId)));
        if (files.length > 0) await platform.sendChatPromptWithFiles(item.entityId, last.content, files);
        else await platform.sendChatPrompt(item.entityId, last.content);
        return {};
      }
      throw new Error('This item cannot be retried.');
    },
    meta: { errorTitle: 'Retry failed' },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
  });
}

/** A persisted message attachment as a `File` to send again; fails when it can no longer be fetched. */
async function refetchAttachment(att: NonNullable<ChatMessage['attachments']>[number], chatId: string): Promise<File> {
  const url = attachmentUrl(att, chatId);
  if (!url) throw new Error(`"${att.name}" can no longer be attached. Open the chat to send it again.`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch "${att.name}" (${res.status}).`);
  const blob = await res.blob();
  return new File([blob], att.name, { type: att.mimeType || blob.type });
}
