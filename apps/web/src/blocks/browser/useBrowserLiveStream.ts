// ────────────────────────────────────────────────────────────────
// Screencast live view: the `/browser/stream` socket painted onto a
// `<canvas>`, and the input channel back to the page.
//
// D5 chose WebCodecs over the existing socket. The server sends encoded VP8
// chunks behind a 16-byte header (see `screencastFrame.ts`) when this client
// says it can decode them, and JPEG when it cannot. Every frame states its
// own codec, so the two are interleavable: the seed frame and the
// paint-silence keepalive are JPEG on a socket whose steady state is VP8, and
// nothing here has to be told when that changes.
//
// ── Why the decode is not in a Worker ───────────────────────────────────
//
// The heavy work already happens off the main thread: `VideoDecoder` and
// `createImageBitmap` both decode on browser-internal threads and only their
// *callbacks* land here, where all that remains is one `drawImage` — a GPU
// blit of an already-decoded frame. Moving the callback to a Worker would
// require creating one from a `blob:` URL (a component cannot add a file to
// the bundle without a second entry point), and the app's CSP is
// `default-src 'self'` with no `worker-src blob:`, so such a Worker is
// blocked outright. Detecting that by catching the failure is precisely the
// pattern P1-33 exists to forbid, so we do not attempt it.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';

import { countFallback } from '@/lib/clientMetrics.js';
import { buildAuthenticatedSocketUrl } from '@/platform/authTransport.js';

import { browserStreamEndpoint, fetchBrowserScreencastJpeg, postBrowserInput, type BrowserMode } from './browserApi.js';
import type { BrowserInputEvent } from './browserInput.js';
import { CODEC_JPEG, CODEC_VP8, parseScreencastFrame } from './screencastFrame.js';

/** Live-stream socket health, surfaced next to the status pill so a dropped
 *  connection is visible instead of silently retrying behind a frozen frame. */
export type BrowserStreamState = 'connecting' | 'live' | 'reconnecting' | 'degraded' | 'stopped';

/** Socket reconnects before falling back to HTTP frame polling. */
export const MAX_STREAM_RECONNECTS = 6;
const KEYFRAME_REQUEST_MIN_INTERVAL_MS = 500;

/** Backoff before reconnect attempt `n` (1-based). */
export function reconnectDelayMs(n: number): number {
  return Math.min(2000, 250 * n);
}

export interface BrowserLiveStreamOptions {
  open: boolean;
  /** False while the dock tab is not selected: the socket is torn down (P1-50). */
  visible: boolean;
  workspaceId: string | undefined;
  ready: boolean | undefined;
  mode: BrowserMode | undefined;
  /** Changing it re-opens the socket (a restarted session). */
  sessionKey: number;
}

export interface BrowserLiveStream {
  /** Goes on the live `<canvas>`; frames are painted into it. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** True once at least one frame has been painted. */
  hasFrame: boolean;
  streamState: BrowserStreamState;
  /** Send input over the socket when open, else over HTTP. */
  sendInput: (event: BrowserInputEvent) => Promise<void>;
}

export function useBrowserLiveStream({ open, visible, workspaceId, ready, mode, sessionKey }: BrowserLiveStreamOptions): BrowserLiveStream {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  /**
   * True once at least one frame has been painted onto the live canvas.
   *
   * The live view is a `<canvas>` because WebCodecs hands back `VideoFrame`s,
   * not images — and the canvas keeps the last frame on screen by itself.
   */
  const [hasFrame, setHasFrame] = useState(false);
  const [streamState, setStreamState] = useState<BrowserStreamState>('connecting');

  const sendInput = useCallback(async (event: BrowserInputEvent) => {
    if (!workspaceId) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify(event)); return; } catch { /* fall through */ }
    }
    try {
      await postBrowserInput(workspaceId, event);
    } catch { /* silent */ }
  }, [workspaceId]);

  useEffect(() => {
    // P1-50 — `visible` sits alongside `open` deliberately: an invisible tab
    // is exactly as uninteresting as a closed pane. The dock keeps every
    // tab mounted, so without this each open Browser tab held its own live
    // screencast socket and decoded every frame that was painted nowhere.
    if (!open || !visible || !workspaceId || !ready || mode !== 'screencast') {
      setHasFrame(false);
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }
    const id: string = workspaceId;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const pollController = new AbortController();

    type Decoded = ImageBitmap | VideoFrame;
    let decoder: VideoDecoder | null = null;
    let decoderSize = { width: 0, height: 0 };
    /** VP8 delta frames before the first key frame decode to nothing. */
    let sawKeyframe = false;
    /** Wall-clock of the last `request_keyframe`, for the rate limit below. */
    let lastKeyframeRequestAt = 0;

    const isHidden = (): boolean =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden';

    /**
     * Ask the server for a fresh key frame.
     *
     * A VP8 delta decodes only against the frame before it, so the moment this
     * client drops or fails to decode one chunk, every chunk after it is
     * undecodable — and the encoder, running in `realtime` mode, has no reason
     * of its own to ever emit another key frame.
     *
     * Rate-limited because the triggers fire per frame and each answer is a
     * full key frame. Silent while the document is hidden: asking for an
     * expensive frame nobody is looking at would defeat the drop it is
     * recovering from — the `visibilitychange` handler asks on the way back.
     */
    function requestKeyframe(): void {
      if (cancelled || isHidden()) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - lastKeyframeRequestAt < KEYFRAME_REQUEST_MIN_INTERVAL_MS) return;
      lastKeyframeRequestAt = now;
      try { ws.send(JSON.stringify({ type: 'request_keyframe' })); } catch { /* closing */ }
    }

    // Coming back to a tab whose reference chain was dropped while it was
    // hidden. Without this the panel waits for the next delta to notice, and
    // on a settled page that is "until something on the page moves".
    const onVisibility = (): void => {
      if (cancelled || isHidden() || sawKeyframe) return;
      requestKeyframe();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    function paint(source: Decoded, width: number, height: number): void {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      setHasFrame(true);
    }

    function closeDecoder(): void {
      const d = decoder;
      decoder = null;
      sawKeyframe = false;
      decoderSize = { width: 0, height: 0 };
      if (d && d.state !== 'closed') {
        try { d.close(); } catch { /* already gone */ }
      }
    }

    function ensureDecoder(width: number, height: number): VideoDecoder | null {
      if (typeof VideoDecoder === 'undefined') return null;
      if (decoder && decoder.state !== 'closed'
        && decoderSize.width === width && decoderSize.height === height) return decoder;
      // A resize changes the coded size, and a decoder configured for the old
      // one silently produces stretched frames rather than erroring.
      closeDecoder();
      const created = new VideoDecoder({
        output: (frame) => {
          try { paint(frame, frame.displayWidth, frame.displayHeight); } finally { frame.close(); }
        },
        error: () => {
          // The stream is not lost: the server keeps sending, and JPEG frames
          // still paint. Drop the decoder and ask for a key frame — nothing
          // else is going to produce one.
          closeDecoder();
          requestKeyframe();
        },
      });
      created.configure({ codec: 'vp8', codedWidth: width, codedHeight: height });
      decoder = created;
      decoderSize = { width, height };
      sawKeyframe = false;
      return created;
    }

    function onBinaryFrame(buffer: ArrayBuffer): void {
      if (cancelled) return;
      const frame = parseScreencastFrame(buffer);
      if (!frame) return;
      const { codec, keyframe, width, height, timestamp, payload } = frame;

      // The socket stays open across a browser-tab switch (closing it would
      // drop the agent's view of the page), but decoding a frame for a
      // document nobody is looking at is pure waste.
      //
      // Key frames are still decoded while hidden: a dropped key frame is not
      // a dropped frame, it is the end of the stream — every delta after it
      // is undecodable. The saving this exists for is the delta stream; a key
      // frame arrives at open, on resize and on request, so decoding one
      // costs almost nothing and is what makes coming back possible at all.
      const hidden = isHidden();

      if (codec === CODEC_VP8) {
        if (hidden && !keyframe) {
          countFallback('browserFramesDroppedHidden');
          // Say out loud that the chain is broken, so the deltas that follow
          // are not fed to a decoder whose reference frame never arrived.
          sawKeyframe = false;
          return;
        }
        const active = ensureDecoder(width, height);
        if (!active) return;              // no VideoDecoder: nothing to do
        if (!keyframe && !sawKeyframe) {
          // Either we joined mid-stream or something upstream dropped a chunk.
          // Either way this frame is undecodable and so is every one behind it
          // until a key frame arrives — which only happens if we ask.
          requestKeyframe();
          return;
        }
        if (keyframe) sawKeyframe = true;
        try {
          active.decode(new EncodedVideoChunk({
            type: keyframe ? 'key' : 'delta',
            timestamp,
            data: payload,
          }));
        } catch {
          closeDecoder();
          requestKeyframe();
        }
        return;
      }

      if (codec === CODEC_JPEG) {
        // Self-contained: dropping one strands nothing behind it, so the
        // hidden-tab saving is free here.
        if (hidden) {
          countFallback('browserFramesDroppedHidden');
          return;
        }
        // `createImageBitmap` decodes off the main thread and yields a bitmap
        // the compositor can upload directly — no object URL, no <img> load
        // event, and nothing to revoke.
        void createImageBitmap(new Blob([payload], { type: 'image/jpeg' }))
          .then((bitmap) => {
            if (cancelled) { bitmap.close(); return; }
            try { paint(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
          })
          .catch(() => undefined);
      }
    }

    /**
     * What this client can decode, most-preferred first — asked of the browser
     * rather than assumed, and resolved once per stream. `VideoDecoder`
     * existing is not the same as VP8 being supported (Safari's WebCodecs, for
     * one, ships a different codec set), so the config is actually probed.
     */
    const acceptedCodecs: Promise<string[]> = (async () => {
      if (typeof VideoDecoder === 'undefined') return ['jpeg'];
      try {
        const support = await VideoDecoder.isConfigSupported({ codec: 'vp8' });
        return support.supported ? ['vp8', 'jpeg'] : ['jpeg'];
      } catch {
        return ['jpeg'];
      }
    })();

    function tryOpenWs(): void {
      // Ticket-minting is async, so the socket is created inside the promise.
      // `cancelled` is re-checked after the await for the unmount race.
      void (async () => {
        try {
          const url = await buildAuthenticatedSocketUrl(
            browserStreamEndpoint(id),
            { scope: 'browser', id },
          );
          if (cancelled) return;
          ws = new WebSocket(url);
          // `arraybuffer`, not `blob`: the header has to be read synchronously
          // to know which decoder the payload belongs to, and a Blob would put
          // an extra async hop in front of every single frame.
          ws.binaryType = 'arraybuffer';
          wsRef.current = ws;
          attachWsHandlers(ws);
        } catch {
          // No `exec:browser` scope, or the device was revoked — fall back to
          // the polling path, which will surface the HTTP error properly.
          if (!cancelled) startPolling();
        }
      })();
    }

    function attachWsHandlers(ws: WebSocket): void {
      try {
        ws.onopen = () => {
          // Fresh connection is healthy — reset the reconnect budget so a
          // later drop gets its own full set of retry attempts.
          reconnectAttempts = 0;
          setStreamState('live');
          // The codec is DECLARED by both ends before a byte of video moves:
          // this is the client half of P1-33's negotiation.
          void acceptedCodecs.then((accept) => {
            if (cancelled || ws.readyState !== WebSocket.OPEN) return;
            try { ws.send(JSON.stringify({ type: 'hello', accept })); } catch { /* closing */ }
          });
        };
        ws.onmessage = (e) => {
          if (cancelled) return;
          if (typeof e.data === 'string') {
            try {
              const msg = JSON.parse(e.data) as { type?: string };
              // The server telling us it cannot stream is an answer, not a
              // failure: stop, and do not start a second transport behind it.
              if (msg.type === 'stream_unavailable') setStreamState('stopped');
              else if (msg.type === 'stream_error') setStreamState('reconnecting');
            } catch { /* ignore malformed control frames */ }
            return;
          }
          onBinaryFrame(e.data as ArrayBuffer);
        };
        ws.onerror = () => { /* fallthrough to reconnect on close */ };
        ws.onclose = () => {
          if (cancelled) return;
          wsRef.current = null;
          closeDecoder();
          // A dropped stream must NOT freeze the live view on its last
          // frame — the agent keeps driving the page after any transient
          // WS/close. Reconnect with a short backoff; only after repeated
          // failures fall back to HTTP frame polling.
          if (reconnectAttempts < MAX_STREAM_RECONNECTS) {
            reconnectAttempts += 1;
            setStreamState('reconnecting');
            reconnectTimer = setTimeout(() => { if (!cancelled) tryOpenWs(); }, reconnectDelayMs(reconnectAttempts));
          } else {
            startPolling();
          }
        };
      } catch { startPolling(); }
    }

    async function pollTick(): Promise<void> {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        pollTimer = setTimeout(() => { if (!cancelled) void pollTick(); }, 1000);
        return;
      }
      const started = Date.now();
      try {
        const res = await fetchBrowserScreencastJpeg(id, started, pollController.signal);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        const bitmap = await createImageBitmap(blob);
        if (cancelled) { bitmap.close(); return; }
        try { paint(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
      } catch { /* silent */ }
      if (cancelled) return;
      const elapsed = Date.now() - started;
      pollTimer = setTimeout(() => { if (!cancelled) void pollTick(); }, Math.max(100, 200 - elapsed));
    }
    function startPolling(): void {
      if (pollTimer || cancelled) return;
      // N5 — the expensive fallback, and the ONLY thing this path is for: the
      // socket could not be opened at all (no `exec:browser` grant, or six
      // failed reconnects). It is never a concurrent second capture path — the
      // codec fallback for a client that cannot decode VP8 happens on the
      // socket itself. Counted so a test (and `system doctor`) can tell "the
      // screencast is fine" from "the screencast has been on the slow path for
      // an hour".
      countFallback('browserScreencastHttpFallback');
      setStreamState('degraded');
      void pollTick();
    }

    setStreamState('connecting');
    tryOpenWs();
    return () => {
      cancelled = true;
      pollController.abort();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (pollTimer) clearTimeout(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeDecoder();
      try { ws?.close(); } catch { /* ignore */ }
      wsRef.current = null;
      setStreamState('stopped');
    };
  }, [open, visible, workspaceId, ready, mode, sessionKey]);

  return { canvasRef, hasFrame, streamState, sendInput };
}
