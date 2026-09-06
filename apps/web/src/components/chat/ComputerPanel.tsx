// ────────────────────────────────────────────────────────────────
// ComputerPanel — watch what the agent is doing on the desktop.
//
// Two views, and the difference matters:
//
//   • Now — the PNG the driver captured of the TARGET WINDOW each time the
//     agent read it. Never the whole screen. This is a record of the agent's
//     perception, not a remote desktop, and it is always available.
//   • Replay — play the run back. Two sources, and which one you get depends
//     on how the preview was started:
//       – the driver's per-turn window captures, played as a sequence. This is
//         the default and the only one that works window-scoped, over RDP, or
//         after the workstation locks. It outlives the run.
//       – an ffmpeg screen capture, when the operator opted into one. A real
//         fragmented MP4, so it plays live and seeks afterwards — but it
//         records the whole display, including the lock screen.
//     The frame sequence is always there, so the tab is never a dead end.
//
// Frames arrive on the `computer.snapshot` event; the timeline is built from
// `computer.action` / `computer.refusal` / `computer.consent_required`.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Ban, Check, Circle, Eye, Hand, Image, KeyRound, Keyboard, MonitorCog,
  Pause, Play, ShieldQuestion, Square, Video,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/index.js';
import { openMultiplexedStream } from '@/platform/muxStream.js';
import type { ComputerRuntime } from '@/platform/HttpPlatformClient.js';

interface TimelineEntry {
  id: string;
  at: number;
  kind: 'action' | 'refusal' | 'consent';
  action: string;
  appLabel: string;
  target?: string;
  /** `synthetic` and `clipboard` are the tiers that take over the screen. */
  path?: string;
  verified?: boolean;
  message?: string;
  /** The window capture taken for this entry, when one was taken. */
  artifactId?: string;
}

interface PendingConsent {
  requestId: string;
  appIdentity: string;
  appLabel: string;
  action: string;
  summary: string;
  path: string;
  expiresAt: number;
}

interface Grant {
  appIdentity: string;
  appLabel: string;
  decision: 'always_allow' | 'deny';
  scope: string;
  grantedAt: string;
}

interface Props {
  workspaceId?: string;
  embedded?: boolean;
  /**
   * Whether this panel is the visible tab. The live preview feed (a window
   * frame per action plus a cursor sample every ~30 ms) is only subscribed
   * while true; the RightPane keeps inactive tabs mounted, so without this a
   * hidden Computer tab kept decoding frames nobody was looking at. The feed
   * is live-only, so nothing is lost by re-subscribing on activation.
   */
  active?: boolean;
}

interface RecordingState {
  recording: boolean;
  outputDir?: string;
  videoPath?: string;
  detail?: string;
  turnCount?: number;
  hasCast?: boolean;
  cast?: { active: boolean; startedAt?: number; detail?: string };
  refusal?: { code: string; message: string };
}

interface ReplayTurnFrame {
  turn: string;
  kind: 'before' | 'click' | 'after';
  tool: string | null;
  point?: { x: number; y: number };
}
type PreviewFrame = ReplayTurnFrame;

/** One entry of the replay index: a turn and the captures taken during it. */
interface TurnIndexEntry {
  turn: string;
  tool: string | null;
  at: string;
  frames: string[];
}

/** Milliseconds per turn during frame playback. */
const REPLAY_INTERVAL_MS = 700;

/**
 * The frame that best represents a turn. `after` shows the result of the
 * action, which is what someone reviewing a run wants to see; the others are
 * only there when the driver had no reason to capture an `after`.
 */
function bestFrame(entry: TurnIndexEntry): 'before' | 'click' | 'after' {
  if (entry.frames.includes('after')) return 'after';
  if (entry.frames.includes('click')) return 'click';
  return 'before';
}

interface WindowBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}

const MAX_ENTRIES = 60;

/** Synthetic input is the only tier that can steal focus — worth calling out. */
function tookScreen(path?: string): boolean {
  return path === 'synthetic' || path === 'clipboard';
}

function formatOffset(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function iconFor(entry: TimelineEntry): React.ReactNode {
  if (entry.kind === 'refusal') return <Ban className="h-3.5 w-3.5 text-destructive" />;
  if (entry.kind === 'consent') return <ShieldQuestion className="h-3.5 w-3.5 text-warning" />;
  if (entry.action === 'snapshot') return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
  if (tookScreen(entry.path)) return <Keyboard className="h-3.5 w-3.5 text-warning" />;
  return <Hand className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function ComputerPanel({ workspaceId, embedded, active = true }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [windowTitle, setWindowTitle] = useState<string>('');
  const [live, setLive] = useState(false);
  const [consent, setConsent] = useState<PendingConsent | null>(null);
  const [answering, setAnswering] = useState(false);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [showGrants, setShowGrants] = useState(false);
  const [runtime, setRuntime] = useState<ComputerRuntime | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [view, setView] = useState<'frame' | 'video'>('frame');
  const [recording, setRecording] = useState<RecordingState>({ recording: false });
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [videoNonce, setVideoNonce] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  const [pinnedIsFallback, setPinnedIsFallback] = useState(false);
  const [previewFrame, setPreviewFrame] = useState<PreviewFrame | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [windowBounds, setWindowBounds] = useState<WindowBounds | null>(null);
  /** Natural pixel size of the live frame — the space its click point is in. */
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);
  const [turns, setTurns] = useState<TurnIndexEntry[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Set once the viewer scrubs, so live capture stops yanking the playhead. */
  const scrubbedRef = useRef(false);
  const pinnedRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  const recordingRequest = useCallback(
    async (
      action: 'start' | 'stop' | 'status',
      opts: { windowTitle?: string; screenVideo?: boolean } = {},
    ): Promise<RecordingState | null> => {
      if (!workspaceId) return null;
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/computer/recording`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...opts }),
        });
        if (!res.ok) return null;
        return (await res.json()) as RecordingState;
      } catch {
        return null;
      }
    },
    [workspaceId],
  );

  /**
   * Turns the live preview on and off.
   *
   * `screenVideo` is opt-in and separate: the preview itself costs nothing but
   * the driver's own per-turn capture, while a screen video spawns ffmpeg and
   * records the whole display — which becomes the lock screen the moment the
   * workstation locks.
   */
  const togglePreview = useCallback(
    async (screenVideo: boolean) => {
      setRecordingBusy(true);
      try {
        if (recording.recording) {
          const stopped = await recordingRequest('stop');
          const status = await recordingRequest('status');
          setRecording({ ...(stopped ?? { recording: false }), ...(status ?? {}), recording: false });
          setVideoNonce((n) => n + 1);
          setCursor(null);
        } else {
          const started = await recordingRequest('start', {
            ...(windowTitle ? { windowTitle } : {}),
            ...(screenVideo ? { screenVideo: true } : {}),
          });
          if (started) {
            setRecording(started);
            setVideoNonce((n) => n + 1);
            setPreviewFrame(null);
            setView(screenVideo ? 'video' : 'frame');
          }
        }
      } finally {
        setRecordingBusy(false);
      }
    },
    [recording.recording, recordingRequest, windowTitle],
  );

  // Activity marks on the player timeline, YouTube-chapter style. The capture
  // origin comes from the cast rather than the first event: the recorder is
  // started before the agent is, so the two clocks would otherwise disagree by
  // however long the model spent thinking.
  const markers = useMemo(() => {
    const origin = recording.cast?.startedAt;
    if (!origin || videoDuration <= 0) return [];
    return entries
      .map((entry) => {
        const offset = (entry.at - origin) / 1000;
        return {
          id: entry.id,
          kind: entry.kind,
          offset,
          percent: (offset / videoDuration) * 100,
          label: `${entry.action}${entry.target ? ` · ${entry.target}` : ''}`,
        };
      })
      .filter((m) => m.percent >= 0 && m.percent <= 100)
      .reverse();
  }, [entries, recording.cast?.startedAt, videoDuration]);

  // Live preview. Frames and cursor arrive separately because they change at
  // different rates — a window frame per action, a cursor sample every ~30 ms.
  //
  // W09 — this used to be its own `EventSource`, which is why a chat tab with
  // the right pane open held five of them. It is now a scope on the shared
  // multiplexed connection, and the feed itself is live-only: nothing about it
  // is worth replaying, so it never reaches the durable log.
  useEffect(() => {
    if (!workspaceId || !recording.recording || !active) {
      setCursor(null);
      return;
    }
    const stream = openMultiplexedStream('computer', workspaceId, {
      onMessage: ({ data }) => {
        let frame: { kind?: unknown; payload?: unknown };
        try {
          frame = JSON.parse(data) as typeof frame;
        } catch {
          // A malformed frame just means the preview holds the previous one.
          return;
        }
        switch (frame.kind) {
          case 'computer.preview.frame':
            setPreviewFrame(frame.payload as PreviewFrame);
            break;
          case 'computer.preview.window':
            setWindowBounds(frame.payload as WindowBounds);
            break;
          case 'computer.preview.cursor': {
            const last = (frame.payload as Array<{ x: number; y: number }>)?.at(-1);
            if (last) setCursor({ x: last.x, y: last.y });
            break;
          }
          default:
            // `open` and `run` carry only the run directory name, which this
            // panel does not use — it renders whatever the newest frame points at.
            break;
        }
      },
    });

    return () => stream.close();
  }, [workspaceId, recording.recording, active]);

  // Screen coordinates onto the rendered frame. The recorder reports the cursor
  // against the whole desktop but captures a single window, so without the
  // window's origin the pointer lands somewhere else entirely.
  const lastCursorRef = useRef<{ left: number; top: number } | null>(null);
  const cursorOnFrame = useMemo(() => {
    // The action's own click point is already in the frame's pixel space, so it
    // needs no conversion and cannot be thrown off by the wrong window bounds.
    // On a multi-monitor desktop the cursor stream reports points like x=4474
    // while the bounds feed flips between monitors, which put every sample out
    // of range and drew nothing at all.
    if (previewFrame?.point && frameSize && frameSize.w > 0 && frameSize.h > 0) {
      lastCursorRef.current = {
        left: (previewFrame.point.x / frameSize.w) * 100,
        top: (previewFrame.point.y / frameSize.h) * 100,
      };
      return lastCursorRef.current;
    }
    if (cursor && windowBounds && windowBounds.w > 0 && windowBounds.h > 0) {
      const left = ((cursor.x - windowBounds.x) / windowBounds.w) * 100;
      const top = ((cursor.y - windowBounds.y) / windowBounds.h) * 100;
      if (left >= -2 && left <= 102 && top >= -2 && top <= 102) {
        lastCursorRef.current = { left, top };
        return lastCursorRef.current;
      }
    }
    // Hold the last known spot rather than blinking out. The agent's pointer
    // does not stop existing between actions, and a marker that disappears for
    // seconds at a time reads as the feature being broken.
    return lastCursorRef.current;
  }, [cursor, windowBounds, previewFrame, frameSize]);

  // The replay index. Kept current while the Video tab is open so a finished
  // run stays watchable — the captures outlive the driver session that made
  // them, and this is the only playback that exists without an ffmpeg cast.
  useEffect(() => {
    if (!workspaceId || view !== 'video') return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/computer/recording/turns`,
          { cache: 'no-store' },
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { turns?: TurnIndexEntry[] };
        if (cancelled) return;
        const next = body.turns ?? [];
        setTurns(next);
        // Follow the newest capture while recording, unless the viewer scrubbed.
        if (!scrubbedRef.current && next.length > 0) setPlayhead(next.length - 1);
      } catch {
        // Leave whatever is already loaded rather than blanking the player.
      }
    };

    void load();
    if (!recording.recording) return;
    const timer = window.setInterval(load, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [workspaceId, view, recording.recording, videoNonce]);

  // Frame playback. A fixed cadence rather than the real timestamps: the gaps
  // between turns are mostly model latency, so real time would be minutes of a
  // still image.
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

  const activeTurn = turns[Math.min(playhead, Math.max(0, turns.length - 1))] ?? null;

  // Decode the next frame before it is shown, so stepping does not flash white.
  useEffect(() => {
    if (!workspaceId) return;
    const upcoming = turns[playhead + 1];
    if (!upcoming) return;
    const img = new window.Image();
    img.src = `/api/workspaces/${workspaceId}/computer/recording/turns/${upcoming.turn}/${bestFrame(upcoming)}`;
  }, [workspaceId, turns, playhead]);

  const loadRuntime = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/computer/runtime`, { cache: 'no-store' });
      if (res.ok) setRuntime((await res.json()) as ComputerRuntime);
    } catch {
      // Non-fatal — the panel still works without a status line.
    }
  }, [workspaceId]);

  const controlRuntime = useCallback(
    async (action: 'start' | 'restart' | 'stop') => {
      if (!workspaceId) return;
      setRuntimeBusy(true);
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/computer/runtime`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (res.ok) setRuntime((await res.json()) as ComputerRuntime);
      } catch {
        // Leave the previous status rather than blanking it.
      } finally {
        setRuntimeBusy(false);
      }
    },
    [workspaceId],
  );

  const loadGrants = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/computer/grants`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { grants?: Grant[] };
      setGrants(body.grants ?? []);
    } catch {
      // Non-fatal.
    }
  }, [workspaceId]);

  const revokeGrant = useCallback(
    async (appIdentity: string) => {
      if (!workspaceId) return;
      try {
        await fetch(
          `/api/workspaces/${workspaceId}/computer/grants/${encodeURIComponent(appIdentity)}`,
          { method: 'DELETE' },
        );
      } finally {
        await loadGrants();
      }
    },
    [workspaceId, loadGrants],
  );

  const answerConsent = useCallback(
    async (decision: 'allow_once' | 'allow_run' | 'always_allow' | 'deny') => {
      if (!workspaceId || !consent) return;
      setAnswering(true);
      try {
        await fetch(`/api/workspaces/${workspaceId}/computer/consent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: consent.requestId,
            appIdentity: consent.appIdentity,
            decision,
          }),
        });
      } catch {
        // The prompt expires into a denial on the server either way.
      } finally {
        setAnswering(false);
        setConsent(null);
        // An `always_allow` just created a standing grant; refresh so the user
        // can see (and undo) what they granted without reopening the panel.
        if (decision === 'always_allow') void loadGrants();
      }
    },
    [workspaceId, consent, loadGrants],
  );

  // A prompt the user never answers is a denial, so the card must disappear on
  // its own rather than sit there offering buttons that no longer do anything.
  useEffect(() => {
    if (!consent) return;
    const remaining = consent.expiresAt - Date.now();
    if (remaining <= 0) {
      setConsent(null);
      return;
    }
    const timer = setTimeout(() => setConsent(null), remaining);
    return () => clearTimeout(timer);
  }, [consent]);

  const loadFrame = useCallback(
    async (artifactId: string) => {
      if (!workspaceId) return;
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/computer/frames/${encodeURIComponent(artifactId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const url = URL.createObjectURL(await res.blob());
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setFrameSrc(url);
      } catch {
        // A missing frame just means the panel keeps the previous one.
      }
    },
    [workspaceId],
  );

  // Clicking an entry holds its frame. Read through a ref inside the stream
  // handler so a newly arriving snapshot does not yank the view away from the
  // moment the user is looking at.
  //
  // Only snapshots carry a frame of their own: capturing one for an action
  // would mean a second `get_window_state`, and that replaces the driver's
  // element index map — the agent's next click would land on a stale index. So
  // an action falls back to the last window the agent actually read, which is
  // the state it decided to act on.
  const pinTo = useCallback(
    (entry: TimelineEntry) => {
      if (pinned === entry.id) {
        setPinned(null);
        return;
      }
      const index = entries.findIndex((e) => e.id === entry.id);
      const source = entries.slice(index).find((e) => e.artifactId);
      if (!source?.artifactId) return;
      setPinned(entry.id);
      setPinnedIsFallback(source.id !== entry.id);
      setView('frame');
      void loadFrame(source.artifactId);
    },
    [entries, loadFrame, pinned],
  );

  // Seed from history so opening the panel mid-task shows the latest window
  // and what led to it, rather than an empty box until the agent acts again.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [framesRes, activityRes, consentRes] = await Promise.all([
          fetch(`/api/workspaces/${workspaceId}/computer/frames`, { cache: 'no-store' }),
          fetch(`/api/workspaces/${workspaceId}/computer/activity`, { cache: 'no-store' }),
          fetch(`/api/workspaces/${workspaceId}/computer/consent`, { cache: 'no-store' }),
        ]);
        // Seeded FIRST: this panel is usually opened *by* a consent prompt, so
        // it subscribes to the stream a moment after the event it exists for.
        if (consentRes.ok && !cancelled) {
          const body = (await consentRes.json()) as { pending?: PendingConsent[] };
          const first = body.pending?.[0];
          if (first) setConsent(first);
        }
        if (framesRes.ok) {
          const body = (await framesRes.json()) as { frames?: Array<{ id: string }> };
          const newest = body.frames?.[0];
          if (!cancelled && newest) await loadFrame(newest.id);
        }
        if (activityRes.ok && !cancelled) {
          const body = (await activityRes.json()) as {
            entries?: Array<{
              action: string; appLabel: string; target: string | null; path: string | null;
              verified: boolean; refusalCode: string | null; artifactId: string | null; createdAt: string;
            }>;
          };
          const seeded: TimelineEntry[] = (body.entries ?? []).map((e, i) => ({
            id: `seed-${i}`,
            at: new Date(e.createdAt).getTime(),
            kind: e.refusalCode ? 'refusal' : 'action',
            action: e.action,
            appLabel: e.appLabel,
            ...(e.target ? { target: e.target } : {}),
            ...(e.path ? { path: e.path } : {}),
            verified: e.verified,
            ...(e.refusalCode ? { message: e.refusalCode } : {}),
            ...(e.artifactId ? { artifactId: e.artifactId } : {}),
          }));
          setEntries(seeded.reverse().slice(0, MAX_ENTRIES));
        }
      } catch {
        // Non-fatal — the live feed still works.
      }
    })();
    void loadGrants();
    void loadRuntime();
    void (async () => {
      const status = await recordingRequest('status');
      if (status && !cancelled) setRecording(status);
    })();
    return () => { cancelled = true; };
  }, [workspaceId, loadFrame, loadGrants, loadRuntime, recordingRequest]);

  // Both of these change outside this panel — the driver can fault or be
  // restarted, and a recording can be started from another tab or survive a
  // page reload. Without a re-read the toggle lies about its own state and a
  // health banner stays up long after the restart that cleared it.
  useEffect(() => {
    if (!workspaceId) return;
    const timer = setInterval(() => {
      void loadRuntime();
      void recordingRequest('status').then((status) => {
        if (status) setRecording((prev) => ({ ...prev, ...status }));
      });
    }, 10_000);
    return () => clearInterval(timer);
  }, [workspaceId, loadRuntime, recordingRequest]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const es = openMultiplexedStream(
      'session',
      `computer:${workspaceId}`,
      {
        onOpen: () => setLive(true),
        onError: () => setLive(false),
        onMessage: (e) => {
          let frame: { kind?: string; payload?: unknown; data?: unknown };
          try {
            frame = JSON.parse(e.data) as typeof frame;
          } catch {
            return;
          }
          // The unified stream wraps events as `{kind, payload}`; `data` is the
          // shape the EventBus uses internally. Accept both so this keeps
          // working if the panel is ever fed straight off the bus.
          const raw = frame.payload ?? frame.data;
          const d = (typeof raw === 'string' ? safeParse(raw) : raw) as Record<string, unknown> ?? {};
          const push = (entry: Omit<TimelineEntry, 'id' | 'at'>) =>
            setEntries((prev) =>
              [{ ...entry, id: `${Date.now()}-${Math.random()}`, at: Date.now() }, ...prev].slice(0, MAX_ENTRIES),
            );

          switch (frame.kind) {
            case 'computer.session_started':
              push({ kind: 'action', action: 'session started', appLabel: String(d['provider'] ?? '') });
              break;
            case 'computer.snapshot':
              setWindowTitle(String(d['windowTitle'] ?? ''));
              if (typeof d['artifactId'] === 'string' && !pinnedRef.current) void loadFrame(d['artifactId']);
              push({
                kind: 'action',
                action: 'snapshot',
                appLabel: String(d['appLabel'] ?? ''),
                target: `${String(d['elementCount'] ?? 0)} elements`,
                ...(typeof d['artifactId'] === 'string' ? { artifactId: d['artifactId'] } : {}),
              });
              break;
            case 'computer.action':
              push({
                kind: 'action',
                action: String(d['action'] ?? ''),
                appLabel: String(d['appLabel'] ?? ''),
                ...(typeof d['target'] === 'string' ? { target: d['target'] } : {}),
                ...(typeof d['path'] === 'string' ? { path: d['path'] } : {}),
                ...(typeof d['artifactId'] === 'string' ? { artifactId: d['artifactId'] } : {}),
                verified: d['verified'] === true,
              });
              break;
            case 'computer.refusal':
              push({
                kind: 'refusal',
                action: String(d['action'] ?? ''),
                appLabel: String(d['appLabel'] ?? ''),
                message: `${String(d['code'] ?? '')} — ${String(d['message'] ?? '')}`,
              });
              break;
            case 'computer.consent_required':
              setConsent({
                requestId: String(d['requestId'] ?? ''),
                appIdentity: String(d['appIdentity'] ?? ''),
                appLabel: String(d['appLabel'] ?? ''),
                action: String(d['action'] ?? ''),
                summary: String(d['summary'] ?? ''),
                path: String(d['path'] ?? ''),
                expiresAt: Number(d['expiresAt'] ?? 0),
              });
              push({
                kind: 'consent',
                action: String(d['action'] ?? ''),
                appLabel: String(d['appLabel'] ?? ''),
                message: String(d['summary'] ?? ''),
              });
              break;
            case 'computer.consent_resolved':
              setConsent(null);
              break;
            default:
              break;
          }
        },
      },
      ['computer.'],
    );
    return () => es.close();
  }, [workspaceId, loadFrame]);

  if (!workspaceId) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Computer Use is not available until this chat has a workspace.
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', embedded && 'bg-background')}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <MonitorCog className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium text-foreground">
          {windowTitle || 'Computer Use'}
        </span>
        {grants.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowGrants((v) => !v)}
            aria-expanded={showGrants}
            className="ml-auto flex h-auto items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground transition-colors hover:bg-subtle hover:text-foreground"
          >
            <KeyRound className="h-3 w-3" />
            {grants.length} allowed
          </Button>
        )}
        <span
          className={cn(
            'flex items-center gap-1.5 text-[11px]',
            grants.length > 0 ? '' : 'ml-auto',
            live ? 'text-muted-foreground' : 'text-muted-foreground/60',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-success' : 'bg-muted-foreground/40')} />
          {live ? 'Watching' : 'Idle'}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded border border-border p-0.5">
          {(['frame', 'video'] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant="ghost"
              onClick={() => setView(mode)}
              aria-pressed={view === mode}
              className={cn(
                'flex h-auto items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-normal transition-colors',
                view === mode
                  ? 'bg-subtle text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {mode === 'frame' ? <Image className="h-3 w-3" /> : <Video className="h-3 w-3" />}
              {mode === 'frame' ? 'Now' : 'Replay'}
            </Button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            disabled={recordingBusy || !workspaceId}
            onClick={() => void togglePreview(false)}
            className={cn(
              'flex h-auto items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-normal transition-colors',
              recording.recording
                ? 'border-destructive/50 bg-destructive/10 text-destructive'
                : 'border-border bg-card text-foreground hover:bg-subtle',
            )}
            title={
              recording.recording
                ? 'Stop the live preview'
                : 'Watch the agent work — window frames and its cursor, which keep working if you lock the screen'
            }
          >
            {recording.recording ? <Square className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
            {recordingBusy ? 'Working…' : recording.recording ? 'Stop' : 'Live preview'}
          </Button>
          {!recording.recording && (
            <Button
              type="button"
              variant="secondary"
              disabled={recordingBusy || !workspaceId}
              onClick={() => void togglePreview(true)}
              className="flex h-auto items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground transition-colors hover:bg-subtle"
              title="Also record a screen video. Needs ffmpeg, captures the whole display, and records the lock screen if the workstation locks."
            >
              <Video className="h-3 w-3" />
              + screen video
            </Button>
          )}
        </div>
      </div>

      {recording.recording && (
        <div className="shrink-0 border-b border-border bg-subtle/50 px-3 py-1.5 text-[11px] text-muted-foreground">
          {recording.cast?.active ? (
            <>
              Live preview on. <span className="text-foreground">Now</span> updates once per action;
              open <span className="text-foreground">Replay</span> for the smooth screen video.
            </>
          ) : (
            'Live preview on — the agent’s window and cursor. Nothing else on screen is captured.'
          )}
        </div>
      )}
      {recording.detail && !recording.recording && (
        <div className="shrink-0 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
          {recording.detail}
        </div>
      )}
      {recording.refusal && (
        <div className="shrink-0 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
          {recording.refusal.message}
        </div>
      )}

      {runtime && runtime.enabled && runtime.state !== 'ready' && (
        <div className="shrink-0 border-b border-border bg-subtle/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                runtime.state === 'stopped' ? 'bg-muted-foreground/40' : 'bg-warning',
              )}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {runtime.state === 'stopped'
                ? 'Desktop driver idle — starts on its own'
                : runtime.state === 'degraded'
                  ? 'Desktop driver reports problems'
                  : 'Desktop driver unavailable'}
            </span>
            {runtime.state !== 'unavailable' && (
              <Button
                type="button"
                variant="secondary"
                disabled={runtimeBusy}
                onClick={() => void controlRuntime(runtime.state === 'stopped' ? 'start' : 'restart')}
                className="h-auto shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-normal text-foreground transition-colors hover:bg-subtle"
              >
                {runtimeBusy ? 'Working…' : runtime.state === 'stopped' ? 'Start now' : 'Restart'}
              </Button>
            )}
          </div>
          {runtime.state === 'stopped' ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              The agent opens a session itself the first time it touches the desktop. Starting one
              here only saves that first wait.
            </p>
          ) : (
            runtime.detail && <p className="mt-1 text-[11px] text-muted-foreground">{runtime.detail}</p>
          )}
        </div>
      )}

      {showGrants && grants.length > 0 && (
        <div className="shrink-0 border-b border-border bg-subtle/30 px-3 py-2">
          <p className="mb-1.5 text-[11px] text-muted-foreground">
            Apps you told the agent it may always use in this workspace.
          </p>
          <ul className="space-y-1">
            {grants.map((g) => (
              <li key={g.appIdentity} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-foreground" title={g.appIdentity}>
                  {g.appLabel || g.appIdentity}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{g.scope}</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void revokeGrant(g.appIdentity)}
                  className="h-auto shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-normal text-foreground transition-colors hover:bg-subtle"
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {consent && (
          <div className="shrink-0 border-b border-warning/40 bg-warning/10 p-3">
            <div className="flex items-start gap-2">
              <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">
                  Allow <span className="font-semibold">{consent.action}</span> on{' '}
                  <span className="font-semibold">{consent.appLabel}</span>?
                </p>
                {consent.summary && (
                  <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{consent.summary}</p>
                )}
                {tookScreen(consent.path) && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                    <AlertTriangle className="h-3 w-3" />
                    This takes over your keyboard and mouse.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="primary"
                disabled={answering}
                onClick={() => void answerConsent('allow_once')}
                className="h-auto rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Allow once
              </Button>
              {/* The only answer that covers synthetic input without asking
                  again. Offered because an unanswered prompt expires as a
                  denial and ends the run — the common way a long task dies. */}
              <Button
                type="button"
                variant="ghost"
                disabled={answering}
                onClick={() => void answerConsent('allow_run')}
                title="Approve every desktop action for the rest of this run, including ones that take over the keyboard and mouse. Ends when the desktop session does."
                className="h-auto rounded border border-primary/50 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
              >
                Allow all this run
              </Button>
              {/* Synthetic input is never persisted as a standing grant, so
                  offering the option here would promise something the server
                  deliberately downgrades. */}
              {!tookScreen(consent.path) && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={answering}
                  onClick={() => void answerConsent('always_allow')}
                  className="h-auto rounded border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-subtle"
                >
                  Always allow this app
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={answering}
                onClick={() => void answerConsent('deny')}
                className="h-auto rounded border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-subtle"
              >
                Deny
              </Button>
            </div>
          </div>
        )}

        <div className="flex min-h-[8rem] flex-[3] items-center justify-center overflow-auto bg-subtle/40 p-2">
          {view === 'video' ? (
            recording.hasCast || recording.cast?.active ? (
              <div className="flex h-full w-full flex-col gap-1">
                <video
                  key={videoNonce}
                  ref={videoRef}
                  autoPlay={recording.recording}
                  muted
                  playsInline
                  controls={!recording.recording}
                  onDurationChange={(e) => setVideoDuration(e.currentTarget.duration || 0)}
                  className="min-h-0 flex-1 rounded border border-border bg-black object-contain shadow-sm"
                  src={`/api/workspaces/${workspaceId}/computer/recording/video?v=${videoNonce}`}
                />
                {markers.length > 0 && (
                  <div className="shrink-0">
                    <div className="relative h-1.5 rounded-full bg-border">
                      {markers.map((marker) => (
                        <Button
                          key={marker.id}
                          type="button"
                          // `primary` rather than `ghost`: the mark's own colour
                          // is set below, and ghost would repaint it on hover.
                          variant="primary"
                          title={`${marker.label} — ${formatOffset(marker.offset)}`}
                          onClick={() => {
                            if (videoRef.current) videoRef.current.currentTime = marker.offset;
                          }}
                          style={{ left: `${marker.percent}%` }}
                          className={cn(
                            'absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-sm p-0',
                            marker.kind === 'refusal' ? 'bg-destructive' : 'bg-primary',
                          )}
                        >
                          <span className="sr-only">{marker.label}</span>
                        </Button>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {markers.length} action{markers.length === 1 ? '' : 's'} on the timeline — click a mark to jump
                      {recording.recording ? ' (seeking is available once the recording stops)' : ''}
                    </p>
                  </div>
                )}
              </div>
            ) : turns.length > 0 && activeTurn ? (
              // No ffmpeg cast — play the driver's per-turn window captures.
              // This is the recording for the default path, and unlike a screen
              // video it survives a locked workstation and outlives the run.
              <div className="flex h-full w-full flex-col gap-1.5">
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <img
                    src={`/api/workspaces/${workspaceId}/computer/recording/turns/${activeTurn.turn}/${bestFrame(activeTurn)}`}
                    alt={`Turn ${playhead + 1} — ${activeTurn.tool ?? 'window'}`}
                    className="max-h-full max-w-full rounded border border-border object-contain shadow-sm"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (!playing && playhead >= turns.length - 1) {
                        scrubbedRef.current = true;
                        setPlayhead(0);
                      }
                      setPlaying((p) => !p);
                    }}
                    title={playing ? 'Pause' : 'Play the run back'}
                    className="h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-card text-foreground transition-colors hover:bg-subtle"
                  >
                    {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    <span className="sr-only">{playing ? 'Pause' : 'Play'}</span>
                  </Button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, turns.length - 1)}
                    value={Math.min(playhead, turns.length - 1)}
                    onChange={(e) => {
                      scrubbedRef.current = true;
                      setPlaying(false);
                      setPlayhead(Number(e.currentTarget.value));
                    }}
                    aria-label="Scrub the recording"
                    className="h-1 flex-1 cursor-pointer accent-primary"
                  />
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {playhead + 1}/{turns.length}
                  </span>
                </div>
                <p className="shrink-0 text-[10px] text-muted-foreground">
                  {activeTurn.tool ?? 'window'} — the window the agent was working in.
                  {recording.recording ? ' Still capturing.' : ''}
                </p>
              </div>
            ) : (
              <div className="max-w-xs text-center text-xs text-muted-foreground">
                <Video className="mx-auto mb-2 h-6 w-6 opacity-40" />
                No captures yet. Press <span className="text-foreground">Live preview</span> and
                each action the agent takes is recorded here to play back.
              </div>
            )
          ) : previewFrame && recording.recording && !pinned ? (
            // Live: the recorder's window capture with the agent cursor drawn
            // on top. The cursor is a separate overlay window, so it is never
            // in the capture — which is exactly why it travels as coordinates.
            <div className="relative inline-block max-h-full max-w-full">
              <img
                ref={previewImgRef}
                src={`/api/workspaces/${workspaceId}/computer/recording/turns/${previewFrame.turn}/${previewFrame.kind}`}
                alt={`Live — ${previewFrame.tool ?? 'window'}`}
                onLoad={(e) =>
                  setFrameSize({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
                className="max-h-full max-w-full rounded border border-border object-contain shadow-sm"
              />
              {cursorOnFrame && (
                <span
                  aria-hidden
                  style={{ left: `${cursorOnFrame.left}%`, top: `${cursorOnFrame.top}%` }}
                  className="pointer-events-none absolute z-10 -translate-x-[2px] -translate-y-[1px]"
                >
                  <svg width="18" height="24" viewBox="0 0 18 24" className="drop-shadow">
                    <path d="M1 1 L1 18 L5.5 13.8 L8.5 20.5 L11.5 19.2 L8.6 12.8 L14 12.5 Z"
                      fill="#e51c24" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                live · {previewFrame.tool ?? 'window'}
              </span>
            </div>
          ) : frameSrc ? (
            <img
              src={frameSrc}
              alt="Most recent window the agent read"
              className="max-h-full max-w-full rounded border border-border object-contain shadow-sm"
            />
          ) : (
            <div className="max-w-xs text-center text-xs text-muted-foreground">
              <MonitorCog className="mx-auto mb-2 h-6 w-6 opacity-40" />
              No window captured yet. Frames appear here each time the agent reads a
              window — only the window it targets, never your whole screen.
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-[2] flex-col border-t border-border">
          <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Activity
            </span>
            {pinned ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPinned(null)}
                className="h-auto whitespace-normal rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground hover:bg-subtle"
              >
                {pinnedIsFallback ? 'Last window read before this step' : 'Showing a past frame'} — back to live
              </Button>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                Click an entry to see the window at that moment
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {entries.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">
                Nothing yet. Every desktop action the agent takes is listed here as it happens.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => pinTo(entry)}
                      aria-pressed={pinned === entry.id}
                      className={cn(
                        'flex h-auto w-full items-start gap-2 whitespace-normal rounded px-1.5 py-1 text-left text-xs font-normal hover:bg-subtle',
                        pinned === entry.id && 'bg-subtle ring-1 ring-inset ring-border',
                      )}
                    >
                      <span className="mt-0.5 shrink-0">{iconFor(entry)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-foreground">{entry.action}</span>
                        {entry.appLabel && (
                          <span className="text-muted-foreground"> · {entry.appLabel}</span>
                        )}
                        {entry.target && (
                          <span className="text-muted-foreground"> · {entry.target}</span>
                        )}
                        {entry.message && (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {entry.message}
                          </span>
                        )}
                        {tookScreen(entry.path) && (
                          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-warning">
                            <AlertTriangle className="h-3 w-3" />
                            took over the screen
                          </span>
                        )}
                      </span>
                      {entry.kind === 'action' && entry.verified && (
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
