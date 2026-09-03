// ────────────────────────────────────────────────────────────────
// browser-ws — WebSocket endpoint for the browser live view (W15, D5).
//
// URL pattern:  ws://<host>:<port>/api/workspaces/:id/browser/stream
//
// ONE transport carries everything (D5: "one transport, no signalling"):
//
//   server → client, text JSON
//     {type:'stream_unavailable', reason}      this bridge cannot stream
//     {type:'stream_error', message}           a declared stream then broke
//   server → client, binary
//     16-byte header + encoded payload — see FRAME_HEADER_BYTES below.
//     Every frame states its own codec, so a mid-stream fall back from VP8 to
//     JPEG is a value the client reads rather than a failure it infers.
//   client → server, text JSON
//     {type:'hello', accept:[…codecs]}         once, immediately on open
//     `BrowserInputEvent` — mouse.click, key.type, … → BrowserService.interact
//
// ── P1-33: transport is DECLARED, not discovered ────────────────────────
//
// This file used to pick its transport by calling `screencast()` inside a
// `try` and falling back to an HTTP polling loop in the `catch`. That is a
// feature detector built out of an exception, and it cannot tell the two cases
// apart: "this bridge has no screencast" (native/desktop mode, permanent) and
// "the screencast just failed" (transient CDP error). A single transient error
// therefore demoted a healthy session to five HTTP screenshots a second for the
// rest of its life. It now asks `screencastCapabilities()` — synchronous,
// total, and unable to lie by omission — and the polling loop is GONE.
// ────────────────────────────────────────────────────────────────

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { Container } from './composition-root.js';
import { authorizeWebSocketUpgrade } from './middleware/wsAuth.js';
import type { BrowserInputEvent, ScreencastCodec, ScreencastFrame } from '@generatorai/core';
import { SCREENCAST_LIMITS, clampScreencastOptions } from '@generatorai/core';
import { readBoundedInt } from '@generatorai/shared';

const PATH_RE = /^\/api\/workspaces\/([^/?#]+)\/browser\/stream$/;

/**
 * P1-32 (second half) — bounds on the input chain.
 *
 * `interact()` is one CDP round trip; a trackpad or a drag emits pointer moves
 * at up to ~500 Hz. The FIFO promise chain that keeps a click ordered ahead of
 * a keystroke has no bound of its own, so at that rate it grows faster than it
 * drains: unbounded memory, and — worse — input arriving at the page seconds
 * after the user made it, which reads as a frozen page and provokes more input.
 *
 * Two bounds, because they catch different things:
 *   • DEPTH bounds how far behind reality the page may fall.
 *   • RATE bounds sustained cost even when every event does drain in time.
 *
 * Moves are COALESCED rather than dropped: only the newest queued move matters,
 * because the pointer's position is state, not an event — replaying twenty
 * stale positions is strictly worse than jumping to the current one. Clicks,
 * keys and wheels are discrete and are never coalesced; over the bound they are
 * dropped, which is the honest failure (a lost keystroke) rather than the
 * dishonest one (a keystroke that lands ten seconds late, on another element).
 */
const MAX_PENDING_INPUTS = 24;
const INPUT_RATE_PER_SEC = 120;
const INPUT_BURST = 60;

/**
 * Binary frame header. Fixed size so the client can parse it with one
 * `DataView` and no allocation:
 *
 *   0     uint8    magic 'G' (0x47) — a mis-framed socket fails here, loudly,
 *                  instead of being handed to a decoder as garbage
 *   1     uint8    version (1)
 *   2     uint8    codec: 0 = jpeg, 1 = vp8
 *   3     uint8    flags: bit 0 = keyframe
 *   4..5  uint16   width
 *   6..7  uint16   height
 *   8..15 float64  presentation timestamp, MICROseconds, monotonic per stream
 *
 * The timestamp is a float64 rather than a uint64 so the client reads a plain
 * `number` — `EncodedVideoChunk.timestamp` wants a number, and going through
 * BigInt for a value that never exceeds 2^53 buys nothing.
 */
const FRAME_HEADER_BYTES = 16;
const FRAME_MAGIC = 0x47;
const FRAME_VERSION = 1;
const CODEC_IDS: Record<ScreencastCodec, number> = { jpeg: 0, vp8: 1 };

/** Codecs a client may ask for. Anything else in `accept` is ignored. */
const KNOWN_CODECS: readonly ScreencastCodec[] = ['vp8', 'jpeg'];

/**
 * How long to wait for the client's `hello` before assuming the most
 * conservative answer (JPEG only). Bounded because a client that never speaks
 * must still get a picture — an older build, or a proxy that buffers the first
 * client message, should degrade to JPEG rather than to a blank panel.
 */
const CLIENT_HELLO_TIMEOUT_MS = 1_500;

/**
 * Socket backpressure. Above the high-water mark the frame loop WAITS rather
 * than dropping immediately, which is what makes a slow client cheaper on the
 * host: the loop not taking a frame means the capture side is not acked, and
 * an un-acked CDP screencast simply stops capturing (W15: "a slow client
 * reduces host CPU"). The wait is bounded so a genuinely stalled socket drops
 * the frame instead of stalling the stream forever.
 */
const SOCKET_HIGH_WATER_BYTES = 512 * 1024;
const SOCKET_DRAIN_TIMEOUT_MS = 250;

/**
 * Floor between key-frame requests on one socket.
 *
 * A key frame is one to two orders of magnitude larger than a delta, and both
 * requesters here fire per frame: the backpressure drop below, and a client
 * whose decoder has lost its reference. Unthrottled, a stream that is dropping
 * every delta would ask 20 times a second and be answered with 20 key frames —
 * turning a congested socket into a much more congested one. One request per
 * half-second still heals the view inside a frame or two of the congestion
 * clearing.
 */
const KEYFRAME_REQUEST_MIN_INTERVAL_MS = 500;

/** Position is state; every other event is a discrete thing that happened. */
function isCoalescable(event: BrowserInputEvent): boolean {
  return event.type === 'mouse.move';
}

export function attachBrowserWebSocket(server: HttpServer, container: Container): void {
  const { browserService, logger } = container;
  // `noServer: true` — we handle upgrade manually so multiple ws paths
  // (future) can share the HTTP server without conflict.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const match = PATH_RE.exec(url.split('?')[0] ?? '');
    if (!match) return;
    const workspaceId = decodeURIComponent(match[1] ?? '');
    if (!workspaceId) {
      socket.destroy();
      return;
    }

    // This socket dispatches synthetic mouse/keyboard events into a live
    // Chromium page — it is remote control, not a read-only view, so it needs
    // an explicit `exec:browser` grant. Previously this upgrade had NO auth
    // check at all and relied only on knowing a workspace id.
    void (async () => {
      const result = await authorizeWebSocketUpgrade({
        container,
        req,
        socket,
        requiredScopes: ['exec:browser'],
        ticketScope: { scope: 'browser', id: workspaceId },
        label: 'browser-ws',
      });
      if (!result.ok) return;

      container.security.audit.record({
        action: 'exec.browser_opened',
        result: 'success',
        principal: result.principal ?? null,
        resourceType: 'workspace',
        resourceId: workspaceId,
        severity: 'warn',
      });
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleConnection(ws, workspaceId);
      });
    })().catch((err: unknown) => {
      logger.warn?.(`[browser-ws] upgrade failed: ${(err as Error).message}`);
      socket.destroy();
    });
  });

  function handleConnection(ws: WebSocket, workspaceId: string): void {
    let stopped = false;
    // Screencast is paint-driven: on a settled page the bridge's generator is
    // parked waiting for the next paint, where `iterator.return()` cannot
    // reach it. Aborting on close is what actually unwinds the generator, its
    // subscriber registration and its encoder stream — otherwise a viewer who
    // closes the panel on a static page leaves all three alive until the page
    // happens to repaint.
    const streamAbort = new AbortController();
    logger.info?.(`[browser-ws v3-framepoll] client connected workspace=${workspaceId}`);
    // P0-25: Bump activity so the idle sweeper doesn't reap a session the moment
    // a viewer connects. The sweeper now checks lastFrameSentAt in addition to
    // lastActivityAt, so frame delivery keeps the session alive, but connecting
    // is itself a signal of user presence worth recording immediately.
    browserService.bumpActivity(workspaceId);

    // Serialize input dispatch so a rapid click-then-type sequence
    // reaches Chromium in the right order. Without this the click
    // and the keystroke race, and keys can land on the previously
    // focused element (URL bar / body) before the click has moved
    // focus to the intended input. FIFO chain via promise queue.
    // An explicit bounded FIFO with a single drainer, rather than a
    // `promise.then()` chain: the chain expressed the ordering but had no way
    // to observe its own depth, so nothing could refuse to grow it.
    const queue: BrowserInputEvent[] = [];
    let draining = false;
    let dropped = 0;
    let lastDropWarnAt = 0;
    // Token bucket. Refilled by elapsed time rather than by a timer, so an idle
    // socket costs nothing and a burst (a real drag) is still absorbed whole.
    let tokens = INPUT_BURST;
    let lastRefillAt = Date.now();

    const takeToken = (): boolean => {
      const now = Date.now();
      tokens = Math.min(INPUT_BURST, tokens + ((now - lastRefillAt) * INPUT_RATE_PER_SEC) / 1000);
      lastRefillAt = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };

    const noteDrop = (): void => {
      dropped += 1;
      const now = Date.now();
      // Logged at most once a second: an over-rate client produces hundreds of
      // drops per second and a per-drop log is its own denial of service.
      if (now - lastDropWarnAt < 1000) return;
      lastDropWarnAt = now;
      logger.warn?.(
        `[browser-ws] dropping input for workspace=${workspaceId}: ${queue.length} queued, ${dropped} dropped so far`,
      );
    };

    /**
     * Drains the queue one event at a time.
     *
     * Awaiting each `interact()` is what keeps the FIFO guarantee the original
     * chain provided — a click is finished before the keystroke behind it
     * starts, so keys cannot land on the previously focused element.
     */
    const drain = async (): Promise<void> => {
      if (draining) return;
      draining = true;
      try {
        while (!stopped && queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          await browserService.interact(workspaceId, next).catch(() => undefined);
        }
      } finally {
        draining = false;
      }
    };

    // The client's declared codec support, resolved by its `hello`. A promise
    // rather than a callback so the stream can simply await it — and so a
    // client that never sends one resolves to the conservative answer instead
    // of leaving the stream hanging.
    let resolveAccept: ((codecs: readonly ScreencastCodec[]) => void) | null = null;
    const clientAccepts = new Promise<readonly ScreencastCodec[]>((resolve) => {
      resolveAccept = resolve;
      const timer = setTimeout(() => {
        if (!resolveAccept) return;
        resolveAccept = null;
        logger.debug?.(`[browser-ws] no client hello for workspace=${workspaceId}; assuming JPEG only`);
        resolve(['jpeg']);
      }, CLIENT_HELLO_TIMEOUT_MS);
      timer.unref?.();
    });

    ws.on('message', (raw) => {
      if (stopped) return;
      try {
        const msg = JSON.parse(raw.toString()) as
          | BrowserInputEvent
          | { type: 'hello'; accept?: unknown }
          | { type: 'request_keyframe' };
        if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return;

        // The client saying "I lost the reference". It reaches the encoder, not
        // the input queue: it is not an action on the page, and it must not be
        // dropped by the input rate limiter — the whole point is that it
        // arrives on a stream that is already losing frames.
        if (msg.type === 'request_keyframe') {
          requestKeyframe();
          return;
        }

        if (msg.type === 'hello') {
          if (!resolveAccept) return;  // a second hello is ignored, not honoured
          const declared = Array.isArray((msg as { accept?: unknown }).accept)
            ? ((msg as { accept: unknown[] }).accept.filter(
                (c): c is ScreencastCodec => typeof c === 'string' && (KNOWN_CODECS as readonly string[]).includes(c),
              ))
            : [];
          const resolve = resolveAccept;
          resolveAccept = null;
          // An empty/garbage accept list is a client that cannot tell us what
          // it decodes, which is exactly the JPEG case.
          resolve(declared.length > 0 ? declared : ['jpeg']);
          return;
        }

        // Coalesce onto the TAIL only, never past a discrete event: collapsing
        // a move that arrived after a click into one that arrived before it
        // would move the pointer off the target before the click lands.
        const tail = queue[queue.length - 1];
        if (isCoalescable(msg) && tail !== undefined && isCoalescable(tail)) {
          queue[queue.length - 1] = msg;
          return;
        }
        if (queue.length >= MAX_PENDING_INPUTS || !takeToken()) {
          noteDrop();
          return;
        }
        queue.push(msg);
        void drain();
      } catch {
        // Ignore malformed messages.
      }
    });

    ws.on('close', () => {
      stopped = true;
      streamAbort.abort();
      logger.debug?.(`[browser-ws] client closed workspace=${workspaceId}`);
    });

    // `readBoundedInt` rather than `Math.max(lo, Math.min(hi, Number(x)))`:
    // that idiom looks like a clamp but does not clamp `NaN` — `Math.min(95,
    // NaN)` is `NaN` and `Math.max(20, NaN)` is `NaN` — so a typo'd value
    // reached the encoder as NaN instead of being corrected.
    //
    // The BOUNDS come from `SCREENCAST_LIMITS`, not from literals repeated
    // here: this used to be one of three independent clamps whose numbers
    // disagreed, so a documented env var was accepted here and silently cut
    // again further down. See infrastructure/browser/screencastOptions.ts.
    const requested = clampScreencastOptions({
      quality: readBoundedInt('GENERATORAI_BROWSER_STREAM_QUALITY', {
        defaultValue: SCREENCAST_LIMITS.quality.default,
        min: SCREENCAST_LIMITS.quality.min,
        max: SCREENCAST_LIMITS.quality.max,
        onWarn: (msg) => logger.warn?.(msg),
      }),
      fps: readBoundedInt('GENERATORAI_BROWSER_STREAM_FPS', {
        defaultValue: SCREENCAST_LIMITS.fps.default,
        min: SCREENCAST_LIMITS.fps.min,
        max: SCREENCAST_LIMITS.fps.max,
        onWarn: (msg) => logger.warn?.(msg),
      }),
    });

    /**
     * The bridge's re-key handle, registered by `screencast()` below, plus its
     * rate limiter.
     *
     * Everything downstream of the encoder that can lose a frame ends up here:
     * this file's own backpressure drop, and the browser's (a hidden tab, a
     * decoder error), which arrives as a `request_keyframe` message. An
     * inter-coded stream cannot recover from a lost frame on its own, so
     * without this channel any one of them freezes the live view for good.
     */
    let reKey: (() => void) | null = null;
    let lastKeyframeRequestAt = 0;
    const requestKeyframe = (): void => {
      if (!reKey) return;
      const now = Date.now();
      if (now - lastKeyframeRequestAt < KEYFRAME_REQUEST_MIN_INTERVAL_MS) return;
      lastKeyframeRequestAt = now;
      try { reKey(); } catch { /* a dead encoder is not this socket's problem */ }
    };

    const sendJson = (payload: unknown): void => {
      if (ws.readyState !== ws.OPEN) return;
      try { ws.send(JSON.stringify(payload)); } catch { /* connection closing */ }
    };

    /**
     * Write one frame, waiting (briefly) for a congested socket to drain.
     * Returns only once the frame has been handed to `ws` or abandoned, so the
     * caller's loop — and therefore the capture ack behind it — is paced by the
     * client rather than racing ahead of it.
     */
    const sendFrame = async (frame: ScreencastFrame): Promise<void> => {
      if (stopped || ws.readyState !== ws.OPEN) return;
      const waitUntil = Date.now() + SOCKET_DRAIN_TIMEOUT_MS;
      while (ws.bufferedAmount > SOCKET_HIGH_WATER_BYTES && Date.now() < waitUntil) {
        await new Promise((r) => setTimeout(r, 10));
        if (stopped || ws.readyState !== ws.OPEN) return;
      }
      // Still congested after the grace period: drop. Buffering seconds of
      // stale frames is worse than a gap, because the client would then render
      // the past for as long as it takes to catch up.
      //
      // A KEY FRAME is exempt, and that exemption is the whole point. Every
      // inter-coded frame behind it decodes only against it, so dropping one
      // does not cost a frame — it costs every frame until the encoder happens
      // to produce another, which in `realtime` mode it never does. The live
      // view simply froze, with a healthy socket and nothing logged. A key
      // frame is a few tens of KB against a 512 KB watermark; sending it while
      // congested is far cheaper than the alternative.
      if (ws.bufferedAmount > SOCKET_HIGH_WATER_BYTES && !frame.keyframe) {
        // The dropped delta has broken the chain for everything after it, so
        // the stream needs a fresh reference once the congestion clears.
        requestKeyframe();
        return;
      }

      const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
      header.writeUInt8(FRAME_MAGIC, 0);
      header.writeUInt8(FRAME_VERSION, 1);
      header.writeUInt8(CODEC_IDS[frame.codec], 2);
      header.writeUInt8(frame.keyframe ? 1 : 0, 3);
      header.writeUInt16BE(Math.min(0xffff, Math.max(0, frame.width)), 4);
      header.writeUInt16BE(Math.min(0xffff, Math.max(0, frame.height)), 6);
      header.writeDoubleBE(frame.timestampUs, 8);
      try { ws.send(Buffer.concat([header, frame.data]), { binary: true }); } catch { /* closing */ }
    };

    void (async () => {
      try {
        // P1-33 — ASK, do not attempt-and-catch. A bridge that cannot stream
        // is told so on the same socket and the client stops rather than
        // silently switching to a path that costs five screenshots a second.
        const capabilities = browserService.screencastCapabilities(workspaceId);
        if (!capabilities.supportsScreencast) {
          sendJson({ type: 'stream_unavailable', reason: 'bridge-has-no-screencast' });
          return;
        }

        const accept = await clientAccepts;
        await streamViaScreencast({
          ws,
          isStopped: () => stopped,
          sendFrame,
          startScreencast: () =>
            browserService.screencast(workspaceId, {
              ...requested,
              codecs: accept,
              signal: streamAbort.signal,
              onRequestKeyframe: (request) => { reKey = request; },
            }),
          seedFrame: () => browserService.frame(workspaceId, { quality: requested.quality }),
        });
      } catch (err) {
        // Reaching here means the stream broke AFTER it was declared available
        // — a real error, not a capability question. Say so; do not silently
        // substitute a different transport.
        logger.warn?.(`[browser-ws] stream failed for ${workspaceId}: ${(err as Error).message}`);
        sendJson({ type: 'stream_error', message: 'screencast ended' });
      } finally {
        streamAbort.abort();
        try { ws.close(); } catch { /* ignore */ }
      }
    })();
  }
}


interface StreamArgs {
  ws: WebSocket;
  isStopped: () => boolean;
  sendFrame: (frame: ScreencastFrame) => Promise<void>;
  startScreencast: () => AsyncIterable<ScreencastFrame>;
  /** One-shot JPEG screenshot. Used for the seed and the paint-silence keepalive. */
  seedFrame: () => Promise<Buffer>;
}

/**
 * Consume `BrowserService.screencast()`.
 *
 * CDP screencast is paint-driven: a page that is not repainting emits nothing,
 * so a viewer arriving at a settled page would otherwise sit on a blank canvas.
 * Two mechanisms cover that, and neither is a second concurrent transport —
 * both go down this same socket, as JPEG-coded frames the client draws exactly
 * like any other:
 *
 *   • a SEED screenshot the moment the socket opens, so first paint is
 *     immediate rather than "whenever this page next changes";
 *   • a KEEPALIVE screenshot after 2 s of paint silence, which also covers a
 *     client that resized and is waiting for geometry it will not otherwise be
 *     told about.
 *
 * The concurrent HTTP polling loop that used to shadow this is deleted (W15,
 * "delete the concurrent polling path"): it existed because the transport was
 * chosen by catching an exception, and there is no exception to catch any more.
 */
async function streamViaScreencast(args: StreamArgs): Promise<void> {
  const { ws, isStopped, sendFrame, startScreencast, seedFrame } = args;
  const KEEPALIVE_MS = 2000;

  const startedAt = Date.now();
  /** Monotonic microseconds for the out-of-band JPEG frames this file emits. */
  let lastSyntheticUs = 0;
  const syntheticFrame = (jpeg: Buffer): ScreencastFrame => {
    lastSyntheticUs = Math.max((Date.now() - startedAt) * 1000, lastSyntheticUs + 1);
    return {
      codec: 'jpeg',
      data: jpeg,
      keyframe: true,
      // The client sizes its canvas from the decoded bitmap for JPEG, so 0 here
      // is "not stated" rather than a lie about the dimensions.
      width: 0,
      height: 0,
      timestampUs: lastSyntheticUs,
      ts: Date.now(),
    };
  };

  const iterator = startScreencast()[Symbol.asyncIterator]();
  let lastFrameAt = Date.now();
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  try {
    await sendFrame(syntheticFrame(await seedFrame()));

    keepaliveTimer = setInterval(() => {
      if (isStopped() || ws.readyState !== ws.OPEN) return;
      if (Date.now() - lastFrameAt < KEEPALIVE_MS) return;
      void seedFrame().then((jpeg) => sendFrame(syntheticFrame(jpeg))).catch(() => undefined);
    }, KEEPALIVE_MS);
    // A keepalive for one socket must never be the reason the process cannot
    // exit; the socket close path clears it, and shutdown does not wait for it.
    keepaliveTimer.unref?.();

    while (!isStopped() && ws.readyState === ws.OPEN) {
      const { value, done } = await iterator.next();
      if (done) break;
      lastFrameAt = Date.now();
      await sendFrame(value);
    }
  } finally {
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    await iterator.return?.(undefined).catch(() => undefined);
  }
}
