// ────────────────────────────────────────────────────────────────
// browser-ws — WebSocket endpoint for high-fps live-view streaming.
//
// URL pattern:  ws://<host>:<port>/api/workspaces/:id/browser/stream
//
// Server sends:
//   • Binary WS frames (JPEG bytes) — one per Chromium screencast frame
//     (~10-15 fps depending on quality / CPU).
//
// Client sends:
//   • Text JSON messages matching `BrowserInputEvent` — mouse.click,
//     mouse.wheel, key.type, etc. Dispatched via `BrowserService.interact`.
//
// This bypasses the Vite dev proxy's multipart/x-mixed-replace buffering
// and reduces per-frame overhead vs HTTP polling (no request setup + no
// TLS handshake per frame). Vite proxies WebSockets transparently.
// ────────────────────────────────────────────────────────────────

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { Container } from './composition-root.js';
import { authorizeWebSocketUpgrade } from './middleware/wsAuth.js';
import type { BrowserInputEvent } from '@generatorai/core';

const PATH_RE = /^\/api\/workspaces\/([^/?#]+)\/browser\/stream$/;

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
    logger.info?.(`[browser-ws v3-framepoll] client connected workspace=${workspaceId}`);

    // Serialize input dispatch so a rapid click-then-type sequence
    // reaches Chromium in the right order. Without this the click
    // and the keystroke race, and keys can land on the previously
    // focused element (URL bar / body) before the click has moved
    // focus to the intended input. FIFO chain via promise queue.
    let inputChain: Promise<void> = Promise.resolve();

    ws.on('message', (raw) => {
      if (stopped) return;
      try {
        const msg = JSON.parse(raw.toString()) as BrowserInputEvent;
        if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return;
        inputChain = inputChain.then(
          () => browserService.interact(workspaceId, msg).catch(() => undefined),
        );
      } catch {
        // Ignore malformed messages.
      }
    });

    ws.on('close', () => {
      stopped = true;
      logger.debug?.(`[browser-ws] client closed workspace=${workspaceId}`);
    });

    const quality = Math.max(20, Math.min(95,
      Number(process.env['GENERATORAI_BROWSER_STREAM_QUALITY'] ?? '60')));
    const targetFps = Math.max(5, Math.min(30,
      Number(process.env['GENERATORAI_BROWSER_STREAM_FPS'] ?? '20')));

    const sendFrame = (jpeg: Buffer): void => {
      if (stopped || ws.readyState !== ws.OPEN) return;
      // Skip send if the socket is backed up — dropping is preferable to
      // buffering seconds of stale frames when the client stalls.
      if (ws.bufferedAmount > 512 * 1024) return;
      try { ws.send(jpeg, { binary: true }); } catch { /* connection closing */ }
    };

    (async () => {
      try {
        await streamViaScreencast(ws, () => stopped, sendFrame, () =>
          browserService.screencast(workspaceId, { fps: targetFps, quality }),
          () => browserService.frame(workspaceId, { quality }));
      } catch (err) {
        // screencast() throws immediately in native (desktop) mode — the
        // WCV renders on-screen via Electron, there's no CDP screencast
        // concept. Fall back to the original frame()-polling loop, which
        // still works for that surface (and as a general safety net).
        logger.debug?.(`[browser-ws] screencast unavailable for ${workspaceId}, falling back to polling: ${(err as Error).message}`);
        await streamViaPolling(ws, () => stopped, sendFrame, targetFps, quality,
          () => browserService.frame(workspaceId, { quality }));
      } finally {
        try { ws.close(); } catch { /* ignore */ }
      }
    })();
  }
}

/**
 * Consume `BrowserService.screencast()` — paint-driven, so a static page
 * would otherwise go silent and look frozen. Seed one `frame()` screenshot
 * immediately on connect, then relay screencast frames as they arrive, with
 * a low-rate keepalive (one screenshot every 2s of paint silence) so late
 * subscribers and post-resize clients are never stuck on a stale frame.
 * Throws (without having sent anything past the seed) if the bridge doesn't
 * support screencast (native/desktop mode) — the caller falls back to
 * polling in that case.
 */
async function streamViaScreencast(
  ws: WebSocket,
  isStopped: () => boolean,
  sendFrame: (jpeg: Buffer) => void,
  startScreencast: () => AsyncIterable<{ jpeg: Buffer; ts: number }>,
  seedFrame: () => Promise<Buffer>,
): Promise<void> {
  const KEEPALIVE_MS = 2000;
  sendFrame(await seedFrame());

  const iterator = startScreencast()[Symbol.asyncIterator]();
  let lastFrameAt = Date.now();
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  try {
    keepaliveTimer = setInterval(() => {
      if (isStopped() || ws.readyState !== ws.OPEN) return;
      if (Date.now() - lastFrameAt < KEEPALIVE_MS) return;
      void seedFrame().then(sendFrame).catch(() => undefined);
    }, KEEPALIVE_MS);
    // First `.next()` is where ElectronBridgeAdapter's unsupported-mode
    // throw actually surfaces — everything above this point (the seed
    // frame) is valid in every mode, so nothing is wasted on fallback.
    while (!isStopped() && ws.readyState === ws.OPEN) {
      const { value, done } = await iterator.next();
      if (done) break;
      lastFrameAt = Date.now();
      sendFrame(value.jpeg);
    }
  } finally {
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    await iterator.return?.(undefined).catch(() => undefined);
  }
}

/**
 * Original fixed-interval `frame()` (page.screenshot) polling loop — kept
 * as the fallback for bridges without screencast support (native/desktop
 * mode) and as a general safety net.
 */
async function streamViaPolling(
  ws: WebSocket,
  isStopped: () => boolean,
  sendFrame: (jpeg: Buffer) => void,
  targetFps: number,
  _quality: number,
  fetchFrame: () => Promise<Buffer>,
): Promise<void> {
  const minIntervalMs = Math.floor(1000 / targetFps);
  let last = 0;
  // A `page.screenshot()` frequently throws *transiently* while the page is
  // mid-navigation ("Target closed", "Execution context was destroyed", a
  // popup momentarily detaching the target, …). Tearing the whole stream
  // down on the first such error froze the live view on a stale frame while
  // the agent kept driving the page — the classic "browser is out of sync
  // with the chat" bug. Instead we tolerate transient failures and only
  // give up once the session is genuinely gone (errors keep coming back).
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = Math.max(20, targetFps * 3); // ~3s of failures
  while (!isStopped() && ws.readyState === ws.OPEN) {
    const now = Date.now();
    const wait = Math.max(0, minIntervalMs - (now - last));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (isStopped() || ws.readyState !== ws.OPEN) break;
    last = Date.now();
    let jpeg: Buffer;
    try {
      jpeg = await fetchFrame();
      consecutiveErrors = 0;
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) break;
      continue;
    }
    sendFrame(jpeg);
  }
}
