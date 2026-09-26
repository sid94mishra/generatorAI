// ────────────────────────────────────────────────────────────────
// F-dock-05 ComputerPanel — watch what the agent does on the desktop
// (P4-11; board ChatComputer). Chat-only dock tab (D-04).
//
//   • Now — the capture of the TARGET WINDOW each time the agent read it,
//     never the whole screen; with a live preview running, the recorder's
//     frame per action with the agent's cursor drawn on top.
//   • Replay — the run played back (per-turn captures, or the opt-in ffmpeg
//     screen video with chapter marks).
// Plus the dock consent card, Pause agent / Take over (G-07), the driver
// runtime banner, the action log (click a row to hold that window) and the
// standing grants. All data comes through hooks/computerQueries.ts.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
import { selectPendingConsent } from '@generatorai/client-core';
import type { ComputerControlMode } from '@generatorai/shared';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import {
  useComputerActivity,
  useComputerDesk,
  useComputerFrameUrl,
  useComputerMediaUrls,
  useComputerPreviewFeed,
  useComputerRecording,
  useComputerRuntime,
  useControlComputerRuntime,
  useSetComputerControl,
  useToggleComputerPreview,
  type ComputerRecordingState,
} from '@/hooks/computerQueries.js';
import { frameForEntry, type ComputerTimelineEntry } from '@/hooks/computerTimeline.js';
import { ComputerActionLog } from './computer/ComputerActionLog.js';
import { ComputerConsentCard } from './computer/ComputerConsentCard.js';
import { ComputerGrants } from './computer/ComputerGrants.js';
import { ComputerReplay } from './computer/ComputerReplay.js';

type ComputerView = 'now' | 'replay';

export interface ComputerPanelProps {
  workspaceId?: string;
  /**
   * Whether this is the visible dock tab. The live preview feed (a frame per
   * action plus a cursor sample every ~30 ms) is subscribed only while true.
   */
  active?: boolean;
}

const NOT_RECORDING: ComputerRecordingState = { recording: false };

export function ComputerPanel({ workspaceId, active = true }: ComputerPanelProps) {
  if (!workspaceId) {
    return (
      <EmptyState
        icon="computer"
        title="No workspace"
        description="Computer Use is not available until this chat has a workspace."
        className="h-full"
      />
    );
  }
  return <ComputerDesk workspaceId={workspaceId} active={active} />;
}

/** Re-render when the earliest pending prompt expires (an unanswered prompt is a denial). */
function useExpiryTick(expiries: readonly number[]): number {
  const [now, setNow] = useState(() => Date.now());
  const next = expiries.filter((t) => t > now).sort((a, b) => a - b)[0];
  useEffect(() => {
    if (next === undefined) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [next]);
  return now;
}

function ComputerDesk({ workspaceId, active }: { workspaceId: string; active: boolean }) {
  const [view, setView] = useState<ComputerView>('now');
  const [pinned, setPinned] = useState<{ id: string; artifactId: string; fallback: boolean } | null>(null);
  const [videoNonce, setVideoNonce] = useState(0);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);

  const recording = useComputerRecording(workspaceId).data ?? NOT_RECORDING;
  const togglePreview = useToggleComputerPreview(workspaceId);
  const runtime = useComputerRuntime(workspaceId).data;
  const controlRuntime = useControlComputerRuntime(workspaceId);
  const activity = useComputerActivity(workspaceId);
  const desk = useComputerDesk(workspaceId).data;
  const setControl = useSetComputerControl(workspaceId);
  const preview = useComputerPreviewFeed(workspaceId, recording.recording && active);
  const media = useComputerMediaUrls(workspaceId);
  const frameUrl = useComputerFrameUrl(workspaceId, pinned?.artifactId ?? activity.latestFrameId);

  const now = useExpiryTick(desk?.pending.map((p) => p.expiresAt) ?? []);
  const pending = desk ? selectPendingConsent(desk, { now }) : [];
  const prompt = pending[0];
  const control = desk?.control?.mode;

  const start = (screenVideo: boolean) =>
    togglePreview.mutate(
      {
        start: true,
        ...(activity.windowTitle ? { windowTitle: activity.windowTitle } : {}),
        ...(screenVideo ? { screenVideo: true } : {}),
      },
      {
        onSuccess: () => {
          setVideoNonce((n) => n + 1);
          setView(screenVideo ? 'replay' : 'now');
        },
      },
    );
  const stop = () => togglePreview.mutate({ start: false }, { onSuccess: () => setVideoNonce((n) => n + 1) });

  const pin = (entry: ComputerTimelineEntry) => {
    if (pinned?.id === entry.id) {
      setPinned(null);
      return;
    }
    const source = frameForEntry(activity.entries, entry.id);
    if (!source) return;
    setPinned({ id: entry.id, ...source });
    setView('now');
  };

  // Cursor onto the rendered frame. The action's own click point is already in
  // the frame's pixel space; otherwise the desktop cursor is mapped through the
  // window's bounds. The last spot is held rather than blinking out.
  const lastCursor = useRef<{ left: number; top: number } | null>(null);
  const cursor = useMemo(() => {
    const point = preview.frame?.point;
    if (point && frameSize && frameSize.w > 0 && frameSize.h > 0) {
      lastCursor.current = { left: (point.x / frameSize.w) * 100, top: (point.y / frameSize.h) * 100 };
      return lastCursor.current;
    }
    const c = preview.cursor;
    const b = preview.window;
    if (c && b && b.w > 0 && b.h > 0) {
      const left = ((c.x - b.x) / b.w) * 100;
      const top = ((c.y - b.y) / b.h) * 100;
      if (left >= -2 && left <= 102 && top >= -2 && top <= 102) {
        lastCursor.current = { left, top };
        return lastCursor.current;
      }
    }
    return lastCursor.current;
  }, [preview.frame, preview.cursor, preview.window, frameSize]);

  const livePreview = view === 'now' && recording.recording && preview.frame && !pinned ? preview.frame : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid="computer-panel">
      <div className="flex min-h-panel-bar shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-fg" title={activity.windowTitle || undefined}>
          {activity.windowTitle || 'Computer'}
        </span>
        <SegmentedControl<ComputerView>
          label="Computer view"
          value={view}
          onValueChange={setView}
          items={[
            { value: 'now', label: 'Now' },
            { value: 'replay', label: 'Replay' },
          ]}
        />
        {recording.recording ? (
          <Button size="sm" variant="danger" icon="stop" loading={togglePreview.isPending} onClick={stop}>
            Stop preview
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              icon="play"
              loading={togglePreview.isPending}
              onClick={() => start(false)}
              title="Watch the agent work — window frames and its cursor, which keep working if you lock the screen"
            >
              Live preview
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="plus"
              disabled={togglePreview.isPending}
              onClick={() => start(true)}
              title="Also record a screen video. Needs ffmpeg, captures the whole display, and records the lock screen if the workstation locks."
            >
              Screen video
            </Button>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-2 p-3">
          {recording.refusal ? <Callout tone="warn">{recording.refusal.message}</Callout> : null}
          {recording.detail && !recording.recording ? <Callout tone="warn">{recording.detail}</Callout> : null}
          {runtime && runtime.enabled && runtime.state !== 'ready' ? (
            <Callout
              tone={runtime.state === 'stopped' ? 'neutral' : 'warn'}
              title={
                runtime.state === 'stopped'
                  ? 'Desktop driver idle — starts on its own'
                  : runtime.state === 'degraded'
                    ? 'Desktop driver reports problems'
                    : 'Desktop driver unavailable'
              }
              action={
                runtime.state !== 'unavailable' ? (
                  <Button
                    size="sm"
                    loading={controlRuntime.isPending}
                    onClick={() => controlRuntime.mutate(runtime.state === 'stopped' ? 'start' : 'restart')}
                  >
                    {runtime.state === 'stopped' ? 'Start now' : 'Restart'}
                  </Button>
                ) : undefined
              }
            >
              {runtime.state === 'stopped'
                ? 'The agent opens a session itself the first time it touches the desktop. Starting one here only saves that first wait.'
                : runtime.detail}
            </Callout>
          ) : null}

          {prompt ? <ComputerConsentCard key={prompt.requestId} workspaceId={workspaceId} prompt={prompt} /> : null}

          <div className="flex min-h-48 flex-col rounded-card border border-line-soft bg-sunken" data-testid="computer-stage">
            <div className="flex min-h-control items-center gap-2 px-2 pt-2">
              {recording.recording ? (
                <Badge tone="run">
                  <StatusDot tone="run" size="sm" />
                  Live
                </Badge>
              ) : null}
              {pinned ? <Badge>{pinned.fallback ? 'Last window read before this step' : 'Past frame'}</Badge> : null}
              {prompt ? (
                <Badge tone="warn" icon="hand" className="ml-auto">
                  Waiting for your answer
                </Badge>
              ) : null}
            </div>
            <div className="flex min-h-40 flex-1 items-center justify-center p-2">
              {view === 'replay' ? (
                <ComputerReplay
                  workspaceId={workspaceId}
                  recording={recording}
                  entries={activity.entries}
                  videoNonce={videoNonce}
                />
              ) : livePreview ? (
                // The cursor is an overlay window, never in the capture — which
                // is exactly why it travels as coordinates.
                <div className="relative inline-block max-w-full">
                  <img
                    src={media.turnFrame(livePreview.turn, livePreview.kind)}
                    alt={`Live — ${livePreview.tool ?? 'window'}`}
                    onLoad={(e) => setFrameSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    className="max-h-96 max-w-full rounded-control border border-line-soft object-contain"
                  />
                  {cursor ? (
                    <span
                      aria-hidden
                      data-testid="computer-cursor"
                      style={{ left: `${cursor.left}%`, top: `${cursor.top}%` }}
                      className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-run"
                    />
                  ) : null}
                </div>
              ) : frameUrl ? (
                <img
                  src={frameUrl}
                  alt={pinned ? 'The window at that moment' : 'Most recent window the agent read'}
                  className="max-h-96 max-w-full rounded-control border border-line-soft object-contain"
                />
              ) : (
                <EmptyState
                  icon="computer"
                  title="No window captured yet"
                  description="Frames appear here each time the agent reads a window — only the window it targets, never your whole screen."
                />
              )}
            </div>
          </div>

          <div className="flex min-h-control items-center gap-2">
            {control ? <ControlButtons mode={control} busy={setControl.isPending} onSet={(m) => setControl.mutate(m)} /> : null}
            <span className="ml-auto flex items-center gap-1.5 text-small text-fg-3">
              <StatusDot tone={activity.live ? 'ok' : 'muted'} size="sm" />
              {activity.live ? 'Watching' : 'Idle'}
            </span>
          </div>
          {recording.recording ? (
            <p className="text-small text-fg-3">
              {recording.cast?.active
                ? 'Live preview on. Now updates once per action; open Replay for the smooth screen video.'
                : 'Live preview on — the agent’s window and cursor. Nothing else on screen is captured.'}
            </p>
          ) : null}
        </div>

        <ComputerActionLog
          entries={activity.entries}
          pinnedId={pinned?.id ?? null}
          pinnedIsFallback={pinned?.fallback ?? false}
          onPin={pin}
          onUnpin={() => setPinned(null)}
        />
        <ComputerGrants workspaceId={workspaceId} />
      </div>
    </div>
  );
}

/** Pause agent / Take over (G-07), and the way back from each. */
function ControlButtons({
  mode,
  busy,
  onSet,
}: {
  mode: ComputerControlMode;
  busy: boolean;
  onSet: (mode: ComputerControlMode) => void;
}) {
  if (mode === 'user') {
    return (
      <>
        <Badge tone="warn" icon="hand">
          You have control
        </Badge>
        <Button size="sm" icon="forward" disabled={busy} onClick={() => onSet('agent')}>
          Hand back
        </Button>
      </>
    );
  }
  return (
    <>
      {mode === 'paused' ? (
        <Button size="sm" icon="play" disabled={busy} onClick={() => onSet('agent')}>
          Resume agent
        </Button>
      ) : (
        <Button size="sm" icon="pause" disabled={busy} onClick={() => onSet('paused')}>
          Pause agent
        </Button>
      )}
      <Button size="sm" icon="pointer" disabled={busy} onClick={() => onSet('user')}>
        Take over
      </Button>
    </>
  );
}
