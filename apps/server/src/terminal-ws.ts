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
// Flow control:
//   - Server tracks unacked bytes. > HIGH → pauses the PTY (XOFF).
//     < LOW → resumes.
//   - Defensive: if `ws.bufferedAmount` exceeds a safety threshold, we
//     force-pause regardless of ACKs.
//
// Auth + origin gating live here — the WS upgrade must not bypass API
// auth. The upgrade resolves a full `Principal` and requires the
// `exec:terminal` scope, which is NOT granted to a device by default.
// ────────────────────────────────────────────────────────────────

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { Container } from './composition-root.js';
import { authorizeWebSocketUpgrade } from './middleware/wsAuth.js';
import type { TerminalInputFrame, TerminalOutputFrame } from '@generatorai/shared';

const PATH_RE = /^\/api\/workspaces\/([^/]+)\/terminals\/([^/]+)\/stream$/;

/** Watermarks — see xtermjs.org flowcontrol guide. */
const HIGH_WATERMARK_BYTES = 256 * 1024;
const LOW_WATERMARK_BYTES = 64 * 1024;
const BUFFERED_AMOUNT_CIRCUIT_BREAKER = 1024 * 1024;
/** Input rate limit — max messages/sec/WS to prevent keystroke-spam. */
const INPUT_RATE_LIMIT_PER_SEC = 200;

export function attachTerminalWebSocket(server: HttpServer, container: Container): void {
  const { terminalService, executionWorkspaceRepo, logger } = container;
  const wss = new WebSocketServer({ noServer: true });

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
    ws: import('ws').WebSocket,
    workspaceId: string,
    sessionId: string,
  ): void {
    const attached = terminalService.onWsAttach(sessionId);
    if (!attached) {
      sendJson(ws, { t: 'error', message: 'session not found' });
      ws.close();
      return;
    }

    let closed = false;
    let unackedBytes = 0;
    let paused = false;
    let inputWindowStart = Date.now();
    let inputWindowCount = 0;

    // Serialize input dispatch so a resize + input in quick succession
    // reach the PTY in order.
    let inputChain: Promise<void> = Promise.resolve();

    const detachData = terminalService.subscribeOutput(sessionId, (chunk) => {
      if (closed || ws.readyState !== ws.OPEN) return;
      try {
        ws.send(chunk, { binary: true });
        unackedBytes += chunk.length;
        // Watermark pause.
        if (!paused && unackedBytes >= HIGH_WATERMARK_BYTES) {
          paused = true;
          terminalService.pause(sessionId);
        }
        // Defensive backpressure via WS buffered amount.
        if (ws.bufferedAmount > BUFFERED_AMOUNT_CIRCUIT_BREAKER && !paused) {
          paused = true;
          terminalService.pause(sessionId);
        }
      } catch {
        // Ignore send failures — close will fire and clean up.
      }
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
          inputChain = inputChain.then(() =>
            terminalService.resize(sessionId, msg.cols, msg.rows).then(() => undefined),
          ).catch(() => undefined);
          break;
        case 'ack':
          if (typeof msg.bytes !== 'number' || msg.bytes < 0) return;
          unackedBytes = Math.max(0, unackedBytes - msg.bytes);
          if (paused && unackedBytes <= LOW_WATERMARK_BYTES && ws.bufferedAmount <= BUFFERED_AMOUNT_CIRCUIT_BREAKER / 2) {
            paused = false;
            terminalService.resume(sessionId);
          }
          break;
        case 'signal':
          if (typeof msg.name !== 'string') return;
          terminalService.signal(sessionId, msg.name);
          break;
        case 'kill':
          // Client is closing the tab — kill the session so the PTY does
          // not linger for the idle-reaper. The subsequent ws.close is
          // then a natural detach.
          void terminalService.kill(sessionId, 'user_close');
          break;
      }
    });

    ws.on('close', () => {
      if (closed) return;
      closed = true;
      try { detachData(); } catch { /* ignore */ }
      try { detachExit(); } catch { /* ignore */ }
      terminalService.onWsDetach(sessionId);
    });
    ws.on('error', (err) => {
      logger.debug?.(`[terminal-ws] socket error sid=${sessionId}: ${(err as Error).message}`);
    });
  }

  function sendJson(ws: import('ws').WebSocket, frame: TerminalOutputFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      /* ignore */
    }
  }
}
