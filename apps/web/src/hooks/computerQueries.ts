// ────────────────────────────────────────────────────────────────
// Computer consent, grants and control hooks (G-07).
//
// `useComputerDesk(workspaceId)` is the read side of the Computer dock tab and
// the consent card: the prompts awaiting an answer (with the batch `plan`),
// and who drives the desktop (`agent | paused | user`). It seeds from the two
// REST reads and stays live on ONE workspace-scope subscription, folding
// `computer.consent_required` / `consent_resolved` / `control_changed` through
// client-core's `applyComputerEvent` — the same reducer mobile uses. A missed
// stretch (resync, reconnect) refetches both reads.
//
// Mutations: answer a prompt (with "this app / any app"), revoke a grant,
// Pause agent / Take over / hand back. No UI lives here (P4 builds the panel).
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMPUTER_DESK_EVENT_KINDS,
  applyComputerEvent,
  initialComputerDeskState,
  seedComputerDesk,
  type ComputerDeskState,
} from '@generatorai/client-core';
import type {
  ComputerConsentAnswer,
  ComputerControlMode,
  ComputerControlState,
  ComputerPendingConsent,
} from '@generatorai/shared';
import { usePlatform } from '../providers/PlatformProvider.js';
import { openMultiplexedStream } from '../platform/muxStream.js';

export const computerKeys = {
  consent: (workspaceId: string) => ['computer', workspaceId, 'consent'] as const,
  control: (workspaceId: string) => ['computer', workspaceId, 'control'] as const,
  grants: (workspaceId: string) => ['computer', workspaceId, 'grants'] as const,
};

function parseFrame(raw: string): { kind: string; data: unknown } | null {
  try {
    const frame = JSON.parse(raw) as { kind?: unknown; payload?: unknown };
    return typeof frame.kind === 'string' ? { kind: frame.kind, data: frame.payload } : null;
  } catch {
    return null;
  }
}

/**
 * Pending consent + control for one workspace, live. `data` is undefined until
 * both reads have landed (unknown, not "nothing pending" / "agent").
 */
export function useComputerDesk(workspaceId: string | undefined) {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  const enabled = Boolean(workspaceId);
  const ws = workspaceId ?? '';

  const consent = useQuery({
    queryKey: computerKeys.consent(ws),
    queryFn: () => platform.getComputerConsent(ws),
    enabled,
  });
  const control = useQuery({
    queryKey: computerKeys.control(ws),
    queryFn: () => platform.getComputerControl(ws),
    enabled,
  });

  useEffect(() => {
    if (!workspaceId) return;
    const fold = (event: { kind: string; data: unknown }) => {
      const current = seedComputerDesk(initialComputerDeskState(workspaceId), {
        pending: queryClient.getQueryData<ComputerPendingConsent[]>(computerKeys.consent(workspaceId)) ?? [],
        ...(queryClient.getQueryData<ComputerControlState>(computerKeys.control(workspaceId))
          ? { control: queryClient.getQueryData<ComputerControlState>(computerKeys.control(workspaceId))! }
          : {}),
      });
      const next = applyComputerEvent(current, event);
      if (next === current) return;
      if (next.pending !== current.pending) queryClient.setQueryData(computerKeys.consent(workspaceId), next.pending);
      if (next.control && next.control !== current.control) {
        queryClient.setQueryData(computerKeys.control(workspaceId), next.control);
      }
    };
    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: computerKeys.consent(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: computerKeys.control(workspaceId) });
    };
    let lostConnection = false;
    const handle = openMultiplexedStream(
      'workspace',
      workspaceId,
      {
        onMessage: (message) => {
          const frame = parseFrame(message.data);
          if (frame) fold(frame);
        },
        onResync: refetch,
        onError: () => {
          lostConnection = true;
        },
        onOpen: () => {
          if (lostConnection) {
            lostConnection = false;
            refetch();
          }
        },
      },
      COMPUTER_DESK_EVENT_KINDS,
    );
    return () => handle.close();
  }, [workspaceId, queryClient]);

  const data = useMemo<ComputerDeskState | undefined>(() => {
    if (!workspaceId || !consent.data || !control.data) return undefined;
    return seedComputerDesk(initialComputerDeskState(workspaceId), { pending: consent.data, control: control.data });
  }, [workspaceId, consent.data, control.data]);

  return {
    data,
    isLoading: consent.isLoading || control.isLoading,
    error: consent.error ?? control.error,
  };
}

/** Answer a pending prompt. The resolved event removes it from `useComputerDesk`; the cache is trimmed at once too. */
export function useAnswerComputerConsent(workspaceId: string | undefined) {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answer: ComputerConsentAnswer) => platform.answerComputerConsent(workspaceId!, answer),
    onSettled: (_result, _error, answer) => {
      const key = computerKeys.consent(workspaceId ?? '');
      queryClient.setQueryData<ComputerPendingConsent[]>(key, (prev) =>
        prev?.filter((p) => p.requestId !== answer.requestId),
      );
      if (answer.decision === 'always_allow') {
        void queryClient.invalidateQueries({ queryKey: computerKeys.grants(workspaceId ?? '') });
      }
    },
  });
}

/** Standing grants (`appIdentity: '*'` = any app). */
export function useComputerGrants(workspaceId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: computerKeys.grants(workspaceId ?? ''),
    queryFn: () => platform.listComputerGrants(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useRevokeComputerGrant(workspaceId: string | undefined) {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appIdentity: string) => platform.revokeComputerGrant(workspaceId!, appIdentity),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: computerKeys.grants(workspaceId ?? '') }),
  });
}

/** Pause agent (`paused`), Take over (`user`) or hand back (`agent`). */
export function useSetComputerControl(workspaceId: string | undefined) {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: ComputerControlMode) => platform.setComputerControl(workspaceId!, mode),
    onSuccess: (state) => queryClient.setQueryData(computerKeys.control(workspaceId ?? ''), state),
  });
}
