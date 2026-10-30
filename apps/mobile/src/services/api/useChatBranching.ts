// ────────────────────────────────────────────────────────────────
// useChatBranching — rewind, fork and copy-transcript.
//
// The three mutations that move a conversation rather than extend it. They
// live together because they invalidate the same things for the same reason:
// each one rewrites history, files, or both, and every surface keyed off
// this chat is stale the moment the server answers.
//
// What gets invalidated, and why each one is load-bearing:
//
//   chatMessages   the transcript itself lost (rewind) or gained (fork) rows
//   chat           `updatedAt`, the provider session id and — after a
//                  synthetic rewind — the conversation seed all moved
//   chats          the list's preview line is the last message, which is
//                  now a different message; a fork adds a whole new row
//   workspaces/:id the files moved under the Changes tray, the file tree and
//                  every open diff. One PREFIX invalidation covers all of
//                  them, which is what `useChatStream` does for the same
//                  reason — mirroring web's `useRestoreWorkspaceCheckpoint`,
//                  which lists its five workspace keys one by one because
//                  web's keys are not prefix-shaped.
//
// `chat.rewound` also arrives on the stream and invalidates messages/chat by
// itself; doing it here too is deliberate. The mutation's own answer is the
// one the user is waiting on, and a rewind that raced a dropped socket must
// still refresh the screen that asked for it.
// ────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import {
  formatTranscriptMarkdown,
  queryKeys,
  type ForkChatResponse,
  type RewindChatResponse,
  type RewindScope,
} from '@generatorai/client-core';

import { useApi } from './useApi';

export interface RewindInput {
  turnId: string;
  scope: RewindScope;
}

export interface ForkInput {
  /** Omitted forks from the last turn, which is what the chat-level menu wants. */
  turnId?: string;
  name?: string;
}

/**
 * Invalidate everything a history-moving mutation touched.
 *
 * Shared by both mutations so a fork and a rewind can never drift into
 * refreshing different halves of the screen.
 */
function useInvalidateAfterBranch(
  chatId: string,
  workspaceId?: string | null,
): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatInteractions(chatId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.chatPlans(chatId) });
    if (workspaceId) {
      // Prefix match: changes, tree, file bodies, checkpoints and every open
      // diff hang off `['workspaces', id, …]`.
      void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] });
    }
  }, [queryClient, chatId, workspaceId]);
}

/**
 * Rewind to the start of a turn.
 *
 * The caller handles the answer: the counts go in a toast and, for any scope
 * but `code`, `response.prompt` goes back into the composer draft. Errors are
 * NOT toasted here — a 409 `CHAT_BUSY` needs the screen's own wording, and
 * the screen is the only thing that knows whether it is showing a sheet.
 */
export function useRewindChat(
  chatId: string,
  workspaceId?: string | null,
): UseMutationResult<RewindChatResponse, Error, RewindInput> {
  const api = useApi();
  const invalidate = useInvalidateAfterBranch(chatId, workspaceId);
  return useMutation({
    mutationFn: ({ turnId, scope }: RewindInput) => api.chats.rewind(chatId, { turnId, scope }),
    onSuccess: invalidate,
  });
}

/**
 * Fork the conversation after a turn into a new chat.
 *
 * The new chat SHARES this one's workspace (it is a conversation branch, not
 * a copy of the files), so the workspace queries are invalidated too: the
 * Changes tray of the chat being left behind now has a second writer.
 */
export function useForkChat(
  chatId: string,
  workspaceId?: string | null,
): UseMutationResult<ForkChatResponse, Error, ForkInput> {
  const api = useApi();
  const invalidate = useInvalidateAfterBranch(chatId, workspaceId);
  return useMutation({
    mutationFn: (input: ForkInput) => api.chats.fork(chatId, input),
    onSuccess: invalidate,
  });
}

/**
 * Fetch the WHOLE transcript and render it as markdown.
 *
 * Not a query: it is fetched on demand for the clipboard, and caching a
 * possibly enormous string that is used once and discarded would be the
 * wrong trade on a phone. The paged `chatMessages` query is not a substitute
 * — it is capped, so copying from it would silently truncate a long chat.
 */
export function useCopyTranscriptMarkdown(chatId: string): () => Promise<string> {
  const api = useApi();
  return useCallback(async () => {
    const transcript = await api.chats.transcript(chatId);
    return formatTranscriptMarkdown(transcript.name, transcript.messages);
  }, [api, chatId]);
}
