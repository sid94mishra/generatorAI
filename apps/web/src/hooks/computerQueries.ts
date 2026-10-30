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
// Pause agent / Take over / hand back.
//
// P4-11 adds the Computer dock tab's other reads: driver runtime, the live
// preview (recording) state, the replay index, the action log (seeded from
// /activity, live on the `session` scope `computer:<ws>`), the live preview
// feed (`computer` scope, only while the tab is visible) and window frames.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
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
import type {
  ComputerRecordingState,
  ComputerReplayFrameKind,
  ComputerRuntime,
} from '../platform/HttpPlatformClient.js';
import {
  COMPUTER_TIMELINE_MAX,
  EMPTY_COMPUTER_TIMELINE,
  foldComputerTimeline,
  seedComputerTimeline,
  type ComputerTimelineState,
} from './computerTimeline.js';

export type {
  ComputerRecordingState,
  ComputerReplayTurn,
  ComputerRuntime,
} from '../platform/HttpPlatformClient.js';

export const computerKeys = {
  consent: (workspaceId: string) => ['computer', workspaceId, 'consent'] as const,
  control: (workspaceId: string) => ['computer', workspaceId, 'control'] as const,
  grants: (workspaceId: string) => ['computer', workspaceId, 'grants'] as const,
  runtime: (workspaceId: string) => ['computer', workspaceId, 'runtime'] as const,
  recording: (workspaceId: string) => ['computer', workspaceId, 'recording'] as const,
  turns: (workspaceId: string) => ['computer', workspaceId, 'turns'] as const,
  frame: (workspaceId: string, artifactId: string) => ['computer', workspaceId, 'frame', artifactId] as const,
};

/**
 * The driver and the preview change outside this tab (a fault, a restart, a
 * recording started elsewhere or surviving a reload), so both are re-read.
 */
const COMPUTER_STATUS_REFRESH_MS = 10_000;
/** The replay index follows new captures while a preview is recording. */
const COMPUTER_TURNS_REFRESH_MS = 2_000;

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

// ── P4-11: runtime, preview, replay, action log, frames ─────────────────

/** Driver process health; re-read every 10 s. */
export function useComputerRuntime(workspaceId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: computerKeys.runtime(workspaceId ?? ''),
    queryFn: () => platform.getComputerRuntime(workspaceId!),
    enabled: Boolean(workspaceId),
    refetchInterval: COMPUTER_STATUS_REFRESH_MS,
  });
}

/** Start / restart / stop the desktop driver. */
export function useControlComputerRuntime(workspaceId: string | undefined) {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'start' | 'restart' | 'stop') => platform.controlComputerRuntime(workspaceId!, action),
    onSuccess: (runtime: ComputerRuntime) => queryClient.setQueryData(computerKeys.runtime(workspaceId ?? ''), runtime),
  });
}

/** Live preview (recording) state; re-read every 10 s. */
export function useComputerRecording(workspaceId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: computerKeys.recording(workspaceId ?? ''),
    queryFn: () => platform.computerRecording(workspaceId!, 'status'),
    enabled: Boolean(workspaceId),
    refetchInterval: COMPUTER_STATUS_REFRESH_MS,
  });
}

export type ComputerPreviewToggle =
  | { start: true; windowTitle?: string; screenVideo?: boolean }
  | { start: false };

/**
 * Turn the live preview on or off. `screenVideo` is a separate opt-in: it
 * spawns ffmpeg and records the whole display (the lock screen too).
 */
export function useToggleComputerPreview(workspaceId: string | undefined) {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (toggle: ComputerPreviewToggle): Promise<ComputerRecordingState> => {
      const ws = workspaceId!;
      if (!toggle.start) {
        const stopped = await platform.computerRecording(ws, 'stop');
        const status = await platform.computerRecording(ws, 'status').catch(() => undefined);
        return { ...stopped, ...(status ?? {}), recording: false };
      }
      return platform.computerRecording(ws, 'start', {
        ...(toggle.windowTitle ? { windowTitle: toggle.windowTitle } : {}),
        ...(toggle.screenVideo ? { screenVideo: true } : {}),
      });
    },
    onSuccess: (state) => {
      queryClient.setQueryData(computerKeys.recording(workspaceId ?? ''), state);
      void queryClient.invalidateQueries({ queryKey: computerKeys.turns(workspaceId ?? '') });
    },
  });
}

/** The replay index (per-turn window captures of the newest run). */
export function useComputerReplayTurns(workspaceId: string | undefined, opts: { enabled: boolean; live: boolean }) {
  const platform = usePlatform();
  return useQuery({
    queryKey: computerKeys.turns(workspaceId ?? ''),
    queryFn: () => platform.listComputerRecordingTurns(workspaceId!),
    enabled: Boolean(workspaceId) && opts.enabled,
    refetchInterval: opts.live ? COMPUTER_TURNS_REFRESH_MS : false,
  });
}

export interface ComputerActivity extends ComputerTimelineState {
  /** The session-scope subscription is connected. */
  live: boolean;
}

/**
 * The action log: seeded from `/activity` (and the newest frame from
 * `/frames`) so opening the tab mid-task shows what led here, then folded
 * live from the session scope `computer:<ws>`.
 */
export function useComputerActivity(workspaceId: string | undefined): ComputerActivity {
  const platform = usePlatform();
  const [state, setState] = useState<ComputerTimelineState>(EMPTY_COMPUTER_TIMELINE);
  const [live, setLive] = useState(false);

  useEffect(() => {
    setState(EMPTY_COMPUTER_TIMELINE);
    setLive(false);
    if (!workspaceId) return;
    let cancelled = false;
    void Promise.all([
      platform.listComputerActivity(workspaceId).catch(() => null),
      platform.listComputerFrames(workspaceId).catch(() => null),
    ]).then(([rows, frames]) => {
      if (cancelled) return;
      setState((prev) => ({
        ...prev,
        // Live events that beat the seed stay on top.
        entries: rows ? [...prev.entries, ...seedComputerTimeline(rows)].slice(0, COMPUTER_TIMELINE_MAX) : prev.entries,
        latestFrameId: prev.latestFrameId ?? frames?.[0]?.id ?? null,
      }));
    });

    const handle = openMultiplexedStream(
      'session',
      `computer:${workspaceId}`,
      {
        onOpen: () => setLive(true),
        onError: () => setLive(false),
        onMessage: (message) => {
          let frame: { kind?: string; payload?: unknown; data?: unknown };
          try {
            frame = JSON.parse(message.data) as typeof frame;
          } catch {
            return;
          }
          setState((prev) => foldComputerTimeline(prev, frame));
        },
      },
      ['computer.'],
    );
    return () => {
      cancelled = true;
      handle.close();
    };
  }, [workspaceId, platform]);

  return useMemo(() => ({ ...state, live }), [state, live]);
}

export interface ComputerPreviewFrame {
  turn: string;
  kind: ComputerReplayFrameKind;
  tool: string | null;
  point?: { x: number; y: number };
}

export interface ComputerWindowBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}

export interface ComputerPreviewFeed {
  frame: ComputerPreviewFrame | null;
  window: ComputerWindowBounds | null;
  cursor: { x: number; y: number } | null;
}

const EMPTY_PREVIEW: ComputerPreviewFeed = { frame: null, window: null, cursor: null };

/**
 * The live preview feed (a window frame per action, a cursor sample every
 * ~30 ms). Live-only, so it is subscribed only while `enabled` (the tab is
 * visible and a preview is recording); nothing is lost by re-subscribing.
 */
export function useComputerPreviewFeed(workspaceId: string | undefined, enabled: boolean): ComputerPreviewFeed {
  const [feed, setFeed] = useState<ComputerPreviewFeed>(EMPTY_PREVIEW);

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setFeed(EMPTY_PREVIEW);
      return;
    }
    const handle = openMultiplexedStream('computer', workspaceId, {
      onMessage: ({ data }) => {
        let frame: { kind?: unknown; payload?: unknown };
        try {
          frame = JSON.parse(data) as typeof frame;
        } catch {
          return; // the preview holds the previous frame
        }
        switch (frame.kind) {
          case 'computer.preview.frame':
            setFeed((prev) => ({ ...prev, frame: frame.payload as ComputerPreviewFrame }));
            break;
          case 'computer.preview.window':
            setFeed((prev) => ({ ...prev, window: frame.payload as ComputerWindowBounds }));
            break;
          case 'computer.preview.cursor': {
            const last = (frame.payload as Array<{ x: number; y: number }> | undefined)?.at(-1);
            if (last) setFeed((prev) => ({ ...prev, cursor: { x: last.x, y: last.y } }));
            break;
          }
          default:
            // `open` / `run` carry only the run directory name.
            break;
        }
      },
    });
    return () => handle.close();
  }, [workspaceId, enabled]);

  return feed;
}

/** A window capture as an object URL (revoked when it changes or on unmount). */
export function useComputerFrameUrl(workspaceId: string | undefined, artifactId: string | null): string | null {
  const platform = usePlatform();
  const frame = useQuery({
    queryKey: computerKeys.frame(workspaceId ?? '', artifactId ?? ''),
    queryFn: () => platform.getComputerFrame(workspaceId!, artifactId!),
    enabled: Boolean(workspaceId && artifactId),
    staleTime: Infinity,
    gcTime: 60_000,
  });
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  // The previous frame stays up while the next one loads (no blank flash), so
  // a URL is revoked only when it is replaced, and on unmount.
  useEffect(() => {
    if (!frame.data) return;
    const next = URL.createObjectURL(frame.data);
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = next;
    setUrl(next);
  }, [frame.data]);
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );
  return url;
}

/** `src` builders for replay frames and the screen-cast video. */
export function useComputerMediaUrls(workspaceId: string | undefined) {
  const platform = usePlatform();
  return useMemo(
    () => ({
      turnFrame: (turn: string, kind: ComputerReplayFrameKind) =>
        workspaceId ? platform.computerMediaUrl(workspaceId, { turn, kind }) : '',
      video: (nonce: number) => (workspaceId ? platform.computerMediaUrl(workspaceId, { video: nonce }) : ''),
    }),
    [platform, workspaceId],
  );
}
