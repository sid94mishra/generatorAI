// Share sheet data (MX-09; MG-09): the recent chats to send into (the Chats list's own rows, with live status), the
// agents and projects a new chat can start with, and Send — one `POST /chats/ingest` with a key fixed per opened
// sheet, so pressing Send again after a lost response replays instead of sending twice.
import { useMemo } from 'react';
import { File } from 'expo-file-system';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chatLiveSets, queryKeys, toChatRowModel } from '@generatorai/client-core';
import type { ChatIngestTarget } from '@generatorai/shared';

import { chatRowView, type ChatRowView } from '../../blocks/ChatRow';
import { useApi } from '../../services/api/useApi';
import type { SharePayload } from '../../services/native/shareIntent';
import { useAttention } from '../../services/stream/AttentionProvider';

const RECENT = 12;

export function useRecentChats(): { rows: ChatRowView[]; isLoading: boolean; isError: boolean } {
  const api = useApi();
  const attention = useAttention();
  const projects = useShareProjects();
  const chats = useQuery({
    queryKey: [...queryKeys.chats(), 'share-recent'],
    queryFn: () => api.chats.list({ status: 'active', sort: 'activity', limit: RECENT }),
    staleTime: 15_000,
  });
  const names = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const live = useMemo(() => chatLiveSets(attention.snapshot), [attention.snapshot]);
  const rows = useMemo(
    () => (chats.data?.items ?? []).map((item) => chatRowView(toChatRowModel(item, live, item.projectId ? names.get(item.projectId) : undefined))),
    [chats.data, live, names],
  );
  return { rows, isLoading: chats.isLoading, isError: chats.isError };
}

export function useShareAgents(projectId: string | null) {
  const api = useApi();
  return useQuery({ queryKey: ['agents', 'selectable', projectId ?? ''] as const, meta: { persist: true }, queryFn: () => api.agents.selectable(projectId ?? undefined) });
}

export function useShareProjects() {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.projects(), 'summary'], meta: { persist: true }, queryFn: () => api.projects.list({ includeSummary: true }), staleTime: 60_000 });
}

export function useSendShare() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ payload, target, note, idempotencyKey }: { payload: SharePayload; target: ChatIngestTarget; note: string; idempotencyKey: string }) => {
      const attachments = await Promise.all(
        payload.files.map(async (f) => ({ name: f.name, mimeType: f.mimeType, data: await new File(f.uri).bytes() })),
      );
      return api.chats.ingest(
        {
          target,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(payload.text ? { text: payload.text } : {}),
          ...(payload.url ? { url: payload.url } : {}),
          attachments,
        },
        { idempotencyKey },
      );
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.chats() }),
  });
}
