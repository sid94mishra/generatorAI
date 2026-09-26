// ────────────────────────────────────────────────────────────────
// Computer "Replay" view. Two sources, depending on how the preview ran:
//   – the ffmpeg screen cast (opt-in "Screen video"): a real video with the
//     agent's actions as chapter marks on a seek bar and as rows that jump;
//   – otherwise the driver's per-turn window captures, played back at a fixed
//     cadence with a scrubber. This one works window-scoped, over RDP and
//     with a locked workstation, and outlives the run.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Slider } from '@/ui/primitives/Slider/Slider.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import {
  useComputerMediaUrls,
  useComputerReplayTurns,
  type ComputerRecordingState,
  type ComputerReplayTurn,
} from '@/hooks/computerQueries.js';
import type { ComputerTimelineEntry } from '@/hooks/computerTimeline.js';

/** Milliseconds per turn during frame playback (real gaps are mostly model latency). */
const REPLAY_INTERVAL_MS = 700;

/** `after` shows the result of the action — what a reviewer wants to see. */
function bestFrame(turn: ComputerReplayTurn): 'before' | 'click' | 'after' {
  if (turn.frames.includes('after')) return 'after';
  if (turn.frames.includes('click')) return 'click';
  return 'before';
}

export function formatOffset(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface ComputerReplayProps {
  workspaceId: string;
  recording: ComputerRecordingState;
  entries: readonly ComputerTimelineEntry[];
  /** Bumped when a preview starts or stops, so the video element reloads. */
  videoNonce: number;
}

export function ComputerReplay({ workspaceId, recording, entries, videoNonce }: ComputerReplayProps) {
  const hasCast = Boolean(recording.hasCast || recording.cast?.active);
  return hasCast ? (
    <CastReplay workspaceId={workspaceId} recording={recording} entries={entries} videoNonce={videoNonce} />
  ) : (
    <TurnReplay workspaceId={workspaceId} recording={recording} videoNonce={videoNonce} />
  );
}

function CastReplay({ workspaceId, recording, entries, videoNonce }: ComputerReplayProps) {
  const media = useComputerMediaUrls(workspaceId);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);

  // The capture origin is the cast's start, not the first event: the recorder
  // starts before the agent does, so the clocks would otherwise disagree.
  const markers = useMemo(() => {
    const origin = recording.cast?.startedAt;
    if (!origin || duration <= 0 || !Number.isFinite(duration)) return [];
    return entries
      .map((e) => ({
        id: e.id,
        offset: (e.at - origin) / 1000,
        label: `${e.action}${e.target ? ` · ${e.target}` : ''}`,
        refused: e.kind === 'refusal',
      }))
      .filter((m) => m.offset >= 0 && m.offset <= duration)
      .reverse();
  }, [entries, recording.cast?.startedAt, duration]);

  const seek = (offset: number) => {
    if (videoRef.current) videoRef.current.currentTime = offset;
  };
  const seekable = !recording.recording && duration > 0 && Number.isFinite(duration);

  return (
    <div className="flex w-full flex-col gap-2">
      <video
        key={videoNonce}
        ref={videoRef}
        autoPlay={recording.recording}
        muted
        playsInline
        controls={!recording.recording}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        className="max-h-96 w-full rounded-control border border-line-soft bg-sunken object-contain"
        src={media.video(videoNonce)}
      />
      {markers.length > 0 ? (
        <>
          <Slider
            label="Seek the screen video"
            min={0}
            max={seekable ? duration : 1}
            value={seekable ? Math.min(time, duration) : 0}
            disabled={!seekable}
            onValueChange={seek}
            ticks={markers.map((m) => ({ value: m.offset, label: '' }))}
            getAriaValueText={(v) => formatOffset(v)}
          />
          <p className="text-small text-fg-3">
            {markers.length} action{markers.length === 1 ? '' : 's'} on the timeline
            {recording.recording ? ' — seeking is available once the recording stops' : ''}
          </p>
          <ul className="flex flex-col">
            {markers.map((m) => (
              <li key={m.id}>
                <Button
                  size="sm"
                  variant="ghost"
                  fullWidth
                  disabled={!seekable}
                  onClick={() => seek(m.offset)}
                  className="justify-start gap-3 font-normal"
                >
                  <span className="w-10 shrink-0 text-left font-mono text-micro text-fg-3">{formatOffset(m.offset)}</span>
                  <span className={m.refused ? 'min-w-0 truncate text-err' : 'min-w-0 truncate text-fg'}>{m.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function TurnReplay({ workspaceId, recording, videoNonce }: Omit<ComputerReplayProps, 'entries'>) {
  const media = useComputerMediaUrls(workspaceId);
  const { data } = useComputerReplayTurns(workspaceId, { enabled: true, live: recording.recording });
  const turns = useMemo(() => data ?? [], [data]);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Set once the viewer scrubs, so live capture stops moving the playhead. */
  const scrubbed = useRef(false);

  useEffect(() => {
    scrubbed.current = false;
  }, [videoNonce]);

  // Follow the newest capture while recording, unless the viewer scrubbed.
  useEffect(() => {
    if (!scrubbed.current && turns.length > 0) setPlayhead(turns.length - 1);
  }, [turns.length]);

  useEffect(() => {
    if (!playing || turns.length === 0) return;
    const timer = window.setInterval(() => {
      setPlayhead((current) => {
        if (current >= turns.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, REPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, turns.length]);

  const index = Math.min(playhead, Math.max(0, turns.length - 1));
  const active = turns[index] ?? null;

  // Decode the next frame before it is shown, so stepping does not flash.
  useEffect(() => {
    const upcoming = turns[index + 1];
    if (!upcoming) return;
    const img = new window.Image();
    img.src = media.turnFrame(upcoming.turn, bestFrame(upcoming));
  }, [turns, index, media]);

  if (!active) {
    return (
      <EmptyState
        icon="history"
        title="No captures yet"
        description="Start a live preview and each action the agent takes is recorded here to play back."
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex min-h-40 items-center justify-center">
        <img
          src={media.turnFrame(active.turn, bestFrame(active))}
          alt={`Turn ${index + 1} — ${active.tool ?? 'window'}`}
          className="max-h-96 max-w-full rounded-control border border-line-soft object-contain"
        />
      </div>
      <div className="flex items-center gap-2">
        <IconButton
          size="sm"
          icon={playing ? 'pause' : 'play'}
          label={playing ? 'Pause' : 'Play the run back'}
          onClick={() => {
            if (!playing && index >= turns.length - 1) {
              scrubbed.current = true;
              setPlayhead(0);
            }
            setPlaying((p) => !p);
          }}
        />
        <Slider
          label="Scrub the recording"
          min={0}
          max={Math.max(0, turns.length - 1)}
          value={index}
          onValueChange={(v) => {
            scrubbed.current = true;
            setPlaying(false);
            setPlayhead(v);
          }}
          getAriaValueText={(v) => `Turn ${v + 1} of ${turns.length}`}
          className="flex-1"
        />
        <span className="shrink-0 font-mono text-micro tabular-nums text-fg-3">
          {index + 1}/{turns.length}
        </span>
      </div>
      <p className="text-small text-fg-3">
        {active.tool ?? 'window'} — the window the agent was working in.
        {recording.recording ? ' Still capturing.' : ''}
      </p>
    </div>
  );
}
