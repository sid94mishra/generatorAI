// ────────────────────────────────────────────────────────────────
// The Devices tab's live view: the device stream socket painted onto a
// `<canvas>` through WebCodecs, and the input channel back (docs/devices DV-5).
//
// One socket per visible device view; a hidden tab holds none (P1-50). The
// server fans one device stream out to every viewer and sends a joiner the
// decoder config and a fresh keyframe, so a reconnect is also a resync.
// Without WebCodecs (a remote page over plain http) the view falls back to a
// screenshot a second.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceActionMark, DeviceInputEvent, DeviceStreamMessage } from '@generatorai/shared';
import { DEVICE_FRAME_CODEC } from '@generatorai/shared';
import { buildAuthenticatedSocketUrl } from '@/platform/authTransport.js';
import { codecFromAnnexB, codecFromAvcc, concatBytes, isH264, parseDeviceFrame } from './deviceFrames.js';
import { deviceStreamPath, fetchDeviceScreenshot } from './devicesApi.js';

export type DeviceStreamState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'failed';

const MAX_RECONNECTS = 6;
const MARK_TTL_MS = 1200;

export interface DeviceStream {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  state: DeviceStreamState;
  /** The device screen in its native pixels (null before the first frame). */
  size: { width: number; height: number } | null;
  hasFrame: boolean;
  /** Touch marks to draw (agent taps and swipes), newest last. */
  marks: DeviceActionMark[];
  agentAccess: boolean | null;
  agentActive: boolean;
  error: string | null;
  fps: number;
  codec: string | null;
  send: (event: DeviceInputEvent) => void;
  /** Start over after the reconnects ran out. */
  retry: () => void;
}

export function useDeviceStream(options: { workspaceId: string | undefined; device: string | null; enabled: boolean }): DeviceStream {
  const { workspaceId, device, enabled } = options;
  const [attempt, setAttempt] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<DeviceStreamState>('idle');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [marks, setMarks] = useState<DeviceActionMark[]>([]);
  const [agentAccess, setAgentAccess] = useState<boolean | null>(null);
  const [agentActive, setAgentActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [codec, setCodec] = useState<string | null>(null);

  useEffect(() => {
    setHasFrame(false);
    setSize(null);
    setError(null);
    setAgentAccess(null);
    setMarks([]);
    if (!enabled || !workspaceId || !device) {
      setState('idle');
      return;
    }
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnects = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let decoder: VideoDecoder | null = null;
    let annexBConfig: Uint8Array | null = null;
    let waitingKey = true;
    let frames = 0;
    const fpsTimer = setInterval(() => {
      setFps(frames);
      frames = 0;
    }, 1000);

    const paint = (source: CanvasImageSource & { displayWidth?: number; displayHeight?: number; width?: number; height?: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = source.displayWidth ?? (source.width as number);
      const h = source.displayHeight ?? (source.height as number);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      canvas.getContext('2d')?.drawImage(source, 0, 0, w, h);
      frames += 1;
      // Frames flowing is what makes a connection healthy.
      reconnects = 0;
      setError(null);
      setHasFrame(true);
    };

    const resetDecoder = () => {
      try {
        decoder?.close();
      } catch {
        // already closed
      }
      decoder = null;
      waitingKey = true;
    };

    const configure = (codecString: string, description?: Uint8Array) => {
      resetDecoder();
      decoder = new VideoDecoder({
        output: (frame) => {
          paint(frame);
          frame.close();
        },
        error: () => resetDecoder(),
      });
      decoder.configure({ codec: codecString, optimizeForLatency: true, ...(description ? { description } : {}) });
      setCodec(`H.264 ${codecString.slice(5)}`);
    };

    const onBinary = (buffer: ArrayBuffer) => {
      const frame = parseDeviceFrame(buffer);
      if (!frame) return;
      if (frame.codec === DEVICE_FRAME_CODEC.jpeg) {
        void createImageBitmap(new Blob([frame.payload], { type: 'image/jpeg' })).then((bmp) => {
          if (!cancelled) paint(bmp);
          bmp.close();
        });
        return;
      }
      if (!isH264(frame.codec) || typeof VideoDecoder === 'undefined') return;
      if (frame.config) {
        if (frame.codec === DEVICE_FRAME_CODEC.h264Avcc) {
          const c = codecFromAvcc(frame.payload);
          if (c) configure(c, frame.payload.slice());
        } else {
          annexBConfig = frame.payload.slice();
          const c = codecFromAnnexB(annexBConfig);
          if (c) configure(c);
        }
        return;
      }
      if (!decoder || decoder.state !== 'configured') return;
      if (waitingKey && !frame.keyframe) return;
      // Behind: skip deltas until the next keyframe rather than queue lag.
      if (!frame.keyframe && decoder.decodeQueueSize > 6) {
        waitingKey = true;
        return;
      }
      waitingKey = false;
      const data = frame.codec === DEVICE_FRAME_CODEC.h264AnnexB && frame.keyframe && annexBConfig ? concatBytes(annexBConfig, frame.payload) : frame.payload;
      try {
        decoder.decode(new EncodedVideoChunk({ type: frame.keyframe ? 'key' : 'delta', timestamp: frame.timestamp, data }));
      } catch {
        resetDecoder();
      }
    };

    const onText = (raw: string) => {
      let msg: DeviceStreamMessage;
      try {
        msg = JSON.parse(raw) as DeviceStreamMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'size':
          setSize({ width: msg.width, height: msg.height });
          return;
        case 'action':
          setMarks((prev) => [...prev.filter((m) => Date.now() - m.at < MARK_TTL_MS), msg.mark].slice(-12));
          return;
        case 'access':
          setAgentAccess(msg.agentAccess);
          setAgentActive(msg.agentActive);
          return;
        case 'stream_error':
        case 'stream_unavailable':
          setError(msg.message);
          return;
      }
    };

    const startPolling = () => {
      setState('polling');
      const tick = async () => {
        try {
          const blob = await fetchDeviceScreenshot(workspaceId, device);
          const bmp = await createImageBitmap(blob);
          if (!cancelled) paint(bmp);
          bmp.close();
        } catch (err) {
          if (!cancelled) setError((err as Error).message);
        }
      };
      void tick();
      pollTimer = setInterval(() => void tick(), 1000);
    };

    const open = () => {
      void (async () => {
        try {
          const url = await buildAuthenticatedSocketUrl(deviceStreamPath(workspaceId, device), { scope: 'devices', id: workspaceId });
          if (cancelled) return;
          ws = new WebSocket(url);
          ws.binaryType = 'arraybuffer';
          wsRef.current = ws;
          ws.onopen = () => {
            setState('live');
          };
          ws.onmessage = (e) => {
            if (cancelled) return;
            if (typeof e.data === 'string') onText(e.data);
            else onBinary(e.data as ArrayBuffer);
          };
          ws.onclose = () => {
            wsRef.current = null;
            resetDecoder();
            if (cancelled) return;
            // Every close is retried a few times — a device that just booted often
            // refuses its first stream — then left to the Retry button.
            if (reconnects >= MAX_RECONNECTS) {
              setState('failed');
              return;
            }
            reconnects += 1;
            setState('reconnecting');
            retryTimer = setTimeout(open, Math.min(5000, 800 * reconnects));
          };
        } catch (err) {
          if (!cancelled) {
            setError((err as Error).message);
            setState('failed');
          }
        }
      })();
    };

    setState('connecting');
    if (typeof VideoDecoder === 'undefined') startPolling();
    else open();

    return () => {
      cancelled = true;
      clearInterval(fpsTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearInterval(pollTimer);
      resetDecoder();
      try {
        ws?.close();
      } catch {
        // closing
      }
      wsRef.current = null;
    };
  }, [workspaceId, device, enabled, attempt]);

  // Marks fade on their own; clear them once the newest is stale.
  useEffect(() => {
    if (marks.length === 0) return;
    const t = setTimeout(() => setMarks((prev) => prev.filter((m) => Date.now() - m.at < MARK_TTL_MS)), MARK_TTL_MS);
    return () => clearTimeout(t);
  }, [marks]);

  const send = useCallback((event: DeviceInputEvent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { canvasRef, state, size, hasFrame, marks, agentAccess, agentActive, error, fps, codec, send, retry };
}
