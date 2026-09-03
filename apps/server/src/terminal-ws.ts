// ────────────────────────────────────────────────────────────────
// terminal-ws — WebSocket endpoint for live terminal IO.
//
// URL:  ws://<host>/api/workspaces/:id/terminals/:sid/stream
//
// Server → client:
//   • Binary WS frames = raw PTY bytes (fed straight into xterm.write)
//   • Text JSON frames = control:
//       { t: 'ready',   descriptor }
//       { t: 'exit',    code, signal? }
//       { t: 'resized', cols, rows }
//       { t: 'error',   message }
//
// Client → server (JSON only):
//   { t: 'input',  data }
//   { t: 'resize', cols, rows }
//   { t: 'ack',    bytes }
//   { t: 'signal', name }
//
// Flow control (P1-28):
//   - The watermark belongs to the SESSION, not to this connection. This
//     file used to keep `unackedBytes`/`paused` per WebSocket and act on the
//     SHARED PTY via `terminalService.pause/resume(sessionId)` — so with two
//     viewers attached, one crossing its high mark paused the PTY for both
//     and the other's next ack (covering a different byte range entirely)
//     resumed it. They oscillated and neither bound was enforced.
//   - `terminalService.attachViewer()` now hands this connection an ack
//     cursor into the session's shared watermark; the SLOWEST attached
//     viewer governs. This file no longer counts bytes or touches the PTY.
//   - `ws.bufferedAmount` over the safety threshold is reported as a STALL
//     rather than a direct pause — same effect, but arbitrated with every
//     other viewer instead of racing them.
//
// Auth + origin gating live here — the WS upgrade must not bypass API
// auth. The upgrade resolves a full `Principal` and requires the
// `exec:terminal` scope, which is NOT granted to a device by default.
//
// Resize authority (Phase 5 item 5): with 2+ clients attached to the same
// session, an unarbitrated `resize` was last-write-wins — whichever client
// happened to send one most recently won, even if that was a passive
// viewer's browser window rather than the client actually driving the
// session. See `ResizeAuthority` below.
// ────────────────────────────────────────────────────────────────

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { Container } from './composition-root.js';
import { authorizeWebSocketUpgrade } from './middleware/wsAuth.js';
import type { TerminalInputFrame, TerminalOutputFrame } from '@generatorai/shared';

const PATH_RE = /^\/api\/workspaces\/([^/]+)\/terminals\/([^/]+)\/stream$/;

/**
 * Socket-buffer circuit breaker. Unlike the byte watermarks — which moved to
 * the session (`TerminalService.SessionFlowControl`) — this one is genuinely
 * per-connection: `bufferedAmount` is a property of THIS socket. It is
 * reported to the session as a stall so the shared PTY is still arbitrated in
 * one place.
 */
const BUFFERED_AMOUNT_CIRCUIT_BREAKER = 1024 * 1024;
/** Input rate limit — max messages/sec/WS to prevent keystroke-spam. */
const INPUT_RATE_LIMIT_PER_SEC = 200;

/**
 * P1-27: Coalesce PTY output chunks before sending over WebSocket.
 *
 * A busy terminal can produce 2500+ data events per second. Sending each
 * chunk as a separate WS frame is wasteful at that rate — the browser is
 * woken up for every tiny write. Instead we accumulate chunks for up to
 * COALESCE_MS (4 ms — imperceptible latency) or COALESCE_BYTES (32 KB),
 * whichever comes first, then send one frame.
 *
 * Returns a `send(chunk)` function and a `flush()` function (to be called on
 * WS close to drain any buffered bytes).
 */
const COALESCE_MS = 4;
const COALESCE_BYTES = 32 * 1024;

function makeCoalescer(
  sendRaw: (buf: Buffer) => void,
): { send: (chunk: Buffer) => void; flush: () => void } {
  const pending: Buffer[] = [];
  let pendingBytes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (pending.length === 0) return;
    const combined = pending.length === 1 ? pending[0]! : Buffer.concat(pending);
    pending.length = 0;
    pendingBytes = 0;
    sendRaw(combined);
  };

  const send = (chunk: Buffer): void => {
    pending.push(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes >= COALESCE_BYTES) {
      flush();
      return;
    }
    if (timer === null) {
      timer = setTimeout(flush, COALESCE_MS);
    }
  };

  return { send, flush };
}

/**
 * Resize authority (Phase 5 item 5) — no design precedent existed anywhere
 * in the codebase or docs for this before now (grepped for "resize
 * authority" / "authoritative" / "primary client" near terminal/PTY code:
 * zero matches), so this is a genuine product decision made with best
 * judgment rather than an established contract; logged as an open question
 * for product sign-off.
 *
 * Policy: the FIRST WS connection to attach to a session is its "owner" —
 * the only connection whose `resize` messages are actually applied. If the
 * owner disconnects while others remain attached, ownership passes to the
 * next-oldest still-attached connection. A non-owner's `resize` is silently
 * ignored (not an error — a passive viewer's own window resizing is a
 * normal, expected event, not a client mistake).
 *
 * With exactly one attacher — overwhelmingly the common case — this is a
 * true no-op: that connection is always the owner, so its resize applies
 * exactly as it did before this existed.
 *
 * Deliberately does not touch `TerminalService`/`TerminalRecord` or the
 * wire protocol (`packages/shared/src/types/Terminal.ts`): no client needs
 * to be told whether it is the owner for this to work — its own resize
 * either takes effect or is silently ignored, which is externally
 * indistinguishable from "the terminal just didn't happen to be resized
 * that instant" from that client's point of view.
 */
export class ResizeAuthority {
  private readonly attachOrder = new Map<string, WebSocket[]>();

  /** Call once, right when a WS connection attaches to a session. */
  attach(sessionId: string, ws: WebSocket): void {
    const list = this.attachOrder.get(sessionId);
    if (list) list.push(ws);
    else this.attachOrder.set(sessionId, [ws]);
  }

  /** Call once, when that WS connection closes. */
  detach(sessionId: string, ws: WebSocket): void {
    const list = this.attachOrder.get(sessionId);
    if (!list) return;
    const index = list.indexOf(ws);
    if (index !== -1) list.splice(index, 1);
    // Drops the session entry entirely once empty, rather than leaving a
    // stale `[]` around — a session that gets fully vacated and later
    // reattached to (a genuinely new set of clients) starts clean.
    if (list.length === 0) this.attachOrder.delete(sessionId);
  }

  /** True when `ws` is the current resize authority for this session. */
  isOwner(sessionId: string, ws: WebSocket): boolean {
    return this.attachOrder.get(sessionId)?.[0] === ws;
  }
}

export function attachTerminalWebSocket(server: HttpServer, container: Container): void {
  const { terminalService, executionWorkspaceRepo, logger } = container;
  const wss = new WebSocketServer({ noServer: true });
  const resizeAuthority = new ResizeAuthority();

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const match = PATH_RE.exec(url.split('?')[0] ?? '');
    if (!match) return; // Not our path; leave for other upgrade handlers.
    const workspaceId = decodeURIComponent(match[1] ?? '');
    const sessionId = decodeURIComponent(match[2] ?? '');
    if (!workspaceId || !sessionId) {
      socket.destroy();
      return;
    }

    // Feature-flag gate.
    if (process.env['GENERATORAI_TERMINAL'] === '0') {
      socket.destroy();
      return;
    }

    // ── Auth + origin. A PTY is remote code execution, so the upgrade needs
    // an explicit `exec:terminal` grant — it is deliberately NOT part of the
    // default device scope set (plan §12.1).
    void (async () => {
      const authResult = await authorizeWebSocketUpgrade({
        container,
        req,
        socket,
        requiredScopes: ['exec:terminal'],
        ticketScope: { scope: 'terminal', id: sessionId },
        label: 'terminal-ws',
      });
      if (!authResult.ok) return;

      // Workspace must exist.
      const workspace = await executionWorkspaceRepo.findById(workspaceId);
      if (!workspace) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      const descriptor = terminalService.describe(sessionId);
      if (!descriptor || descriptor.workspaceId !== workspaceId) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      container.security.audit.record({
        action: 'exec.terminal_opened',
        result: 'success',
        principal: authResult.principal ?? null,
        resourceType: 'terminal',
        resourceId: sessionId,
        severity: 'warn',
      });
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleConnection(ws, workspaceId, sessionId);
      });
    })().catch((err: unknown) => {
      logger.warn?.(`[terminal-ws] upgrade failed: ${(err as Error).message}`);
      socket.destroy();
    });
  });

  function handleConnection(
    ws: WebSocket,
    workspaceId: string,
    sessionId: string,
  ): void {
    const viewer = terminalService.attachViewer(sessionId);
    if (!viewer) {
      sendJson(ws, { t: 'error', message: 'session not found' });
      ws.close();
      return;
    }
    resizeAuthority.attach(sessionId, ws);

    let closed = false;
    let stalled = false;
    let inputWindowStart = Date.now();
    let inputWindowCount = 0;

    // Serialize input dispatch so a resize + input in quick succession
    // reach the PTY in order.
    let inputChain: Promise<void> = Promise.resolve();

    /** Report this socket's send-buffer pressure into the session watermark. */
    const syncStall = (): void => {
      const nowStalled = ws.bufferedAmount > BUFFERED_AMOUNT_CIRCUIT_BREAKER;
      // Hysteresis on the way down (half the breaker), so a socket hovering at
      // the threshold doesn't flap the shared PTY on every frame.
      const clear = stalled && ws.bufferedAmount <= BUFFERED_AMOUNT_CIRCUIT_BREAKER / 2;
      if (nowStalled && !stalled) {
        stalled = true;
        viewer.setStalled(true);
      } else if (clear) {
        stalled = false;
        viewer.setStalled(false);
      }
    };

    // P1-27: Coalesce PTY output before sending to reduce per-frame WS overhead.
    const coalescer = makeCoalescer((buf) => {
      if (closed || ws.readyState !== ws.OPEN) return;
      syncStall();
      try { ws.send(buf, { binary: true }); } catch { /* connection closing */ }
    });

    // No byte counting here any more — the session owns the watermark and is
    // already told about every chunk by `TerminalService` itself, so counting
    // again per socket would double-count with the shared cursor.
    const detachData = terminalService.subscribeOutput(sessionId, (chunk) => {
      if (closed || ws.readyState !== ws.OPEN) return;
      coalescer.send(chunk);
    });

    const detachExit = terminalService.subscribeExit(sessionId, (info) => {
      sendJson(ws, {
        t: 'exit',
        code: info.code,
        ...(info.signal ? { signal: info.signal } : {}),
      });
      // Give the client a beat to render the message before we close.
      setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 100);
    });

    // Announce the descriptor so the client can render the header.
    const descriptor = terminalService.describe(sessionId);
    if (descriptor) sendJson(ws, { t: 'ready', descriptor });

    ws.on('message', (raw) => {
      if (closed) return;

      // Input rate-limit — sliding 1s window.
      const now = Date.now();
      if (now - inputWindowStart >= 1000) {
        inputWindowStart = now;
        inputWindowCount = 0;
      }
      inputWindowCount++;
      if (inputWindowCount > INPUT_RATE_LIMIT_PER_SEC) return; // drop

      let msg: TerminalInputFrame;
      try {
        msg = JSON.parse(raw.toString()) as TerminalInputFrame;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      switch (msg.t) {
        case 'input':
          if (typeof msg.data !== 'string') return;
          inputChain = inputChain.then(() => {
            terminalService.input(sessionId, msg.data);
          }).catch(() => undefined);
          break;
        case 'resize':
          if (typeof msg.cols !== 'number' || typeof msg.rows !== 'number') return;
          // Resize authority — a non-owner's resize is a normal, expected
          // event (its own window resized locally), not an error; silently
          // dropped rather than applied or rejected.
          if (!resizeAuthority.isOwner(sessionId, ws)) return;
          inputChain = inputChain.then(() =>
            terminalService.resize(sessionId, msg.cols, msg.rows).then(() => undefined),
          ).catch(() => undefined);
          break;
        case 'ack':
          // Sent from inside xterm's `write(bytes, onParsed)` callback, so
          // this credits what the client has PARSED, not merely received (W14).
          if (typeof msg.bytes !== 'number' || !Number.isFinite(msg.bytes) || msg.bytes < 0) return;
          viewer.ack(msg.bytes);
          syncStall();
          break;
        case 'signal':
          if (typeof msg.name !== 'string') return;
          terminalService.signal(sessionId, msg.name);
          break;
        case 'kill':
          // Client is closing the tab — kill the session so the PTY does
          // not linger for the idle-reaper. The subsequent ws.close is
          // then a natural detach.
          void terminalService.kill(sessionId, 'user_close').catch(() => undefined);
          break;
      }
    });

    ws.on('close', () => {
      if (closed) return;
      closed = true;
      coalescer.flush(); // Drain any buffered bytes before tearing down.
      try { detachData(); } catch { /* ignore */ }
      try { detachExit(); } catch { /* ignore */ }
      // Releases whatever backpressure this viewer was contributing — without
      // it a session that lost its slowest viewer would stay paused forever.
      viewer.detach();
      resizeAuthority.detach(sessionId, ws);
    });
    ws.on('error', (err) => {
      logger.debug?.(`[terminal-ws] socket error sid=${sessionId}: ${(err as Error).message}`);
    });
  }

  function sendJson(ws: WebSocket, frame: TerminalOutputFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      /* ignore */
    }
  }
}
