// ────────────────────────────────────────────────────────────────
// stt-ws — WebSocket endpoint for local speech-to-text (voice input).
//
// URL:  ws://<host>/api/stt/stream
//
// Client → server:
//   • Binary WS frames = raw 16 kHz mono Float32 PCM audio chunks.
//   • Text JSON frames  = control:
//       { t: 'start', lang? }
//       { t: 'stop' }     → finalise; server replies with { t:'final' }
//       { t: 'cancel' }   → discard; no final emitted
//
// Server → client (JSON only):
//   { t: 'ready' }              — connection accepted, model warming
//   { t: 'interim', text }      — best-effort transcript so far
//   { t: 'final',   text }      — final transcript after 'stop'
//   { t: 'error',   message }
//
// Runs entirely on the local machine (Whisper base.en on CPU) — no
// cloud, no key, no cost. Auth + origin gating mirror the REST
// middleware and the terminal/browser WebSockets.
// ────────────────────────────────────────────────────────────────

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Container } from './composition-root.js';
import { authorizeWebSocketUpgrade } from './middleware/wsAuth.js';
import type { ISttEngine } from './stt/ISttEngine.js';
import { WhisperSttEngine } from './stt/WhisperSttEngine.js';
import { SttSession } from './stt/SttSession.js';

const PATH = '/api/stt/stream';

/** Shared engine singleton — the model loads once and is reused by every
 *  connection (loading is coalesced inside the engine). */
let sharedEngine: ISttEngine | null = null;

export function attachSttWebSocket(server: HttpServer, container: Container): void {
  const { logger } = container;

  // Feature flag — set GENERATORAI_STT=0 to disable voice input entirely.
  if (process.env['GENERATORAI_STT'] === '0') {
    logger.info?.('[stt-ws] disabled via GENERATORAI_STT=0');
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const pathOnly = url.split('?')[0] ?? '';
    if (pathOnly !== PATH) return; // Not our path; leave for other handlers.

    // Speech input becomes a chat message, so it carries the same authority as
    // typing into a chat.
    void (async () => {
      const result = await authorizeWebSocketUpgrade({
        container,
        req,
        socket,
        requiredScopes: ['write:chats'],
        ticketScope: { scope: 'stt', id: null },
        label: 'stt-ws',
      });
      if (!result.ok) return;
      wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws));
    })().catch((err: unknown) => {
      logger.warn?.(`[stt-ws] upgrade failed: ${(err as Error).message}`);
      socket.destroy();
    });
  });

  function handleConnection(ws: WebSocket): void {
    if (!sharedEngine) {
      sharedEngine = new WhisperSttEngine({ logger });
    }
    const engine = sharedEngine;

    let session: SttSession | null = null;

    const sendJson = (frame: Record<string, unknown>): void => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        /* ignore */
      }
    };

    const ensureSession = (language?: string): SttSession => {
      if (session) return session;
      session = new SttSession(
        engine,
        {
          onInterim: (text) => sendJson({ t: 'interim', text }),
          onFinal: (text) => sendJson({ t: 'final', text }),
          onError: (message) => sendJson({ t: 'error', message }),
        },
        logger,
      );
      return session;
    };

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        // Raw Float32 PCM. `ws` hands us a Node Buffer; view it as Float32
        // without copying when byte-aligned, else copy into an aligned one.
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        const pcm = toFloat32(buf);
        if (pcm.length) ensureSession().pushAudio(pcm);
        return;
      }
      // Control JSON.
      let msg: { t?: string; lang?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      switch (msg.t) {
        case 'start':
          ensureSession(msg.lang).start(msg.lang);
          sendJson({ t: 'ready' });
          break;
        case 'stop':
          if (session) void session.stop();
          break;
        case 'cancel':
          if (session) session.cancel();
          session = null;
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      if (session) session.cancel();
      session = null;
    });
    ws.on('error', () => {
      if (session) session.cancel();
      session = null;
    });
  }
}

/** Interpret a byte buffer as little-endian Float32 samples. */
function toFloat32(buf: Buffer): Float32Array {
  const usableBytes = buf.byteLength - (buf.byteLength % 4);
  if (usableBytes <= 0) return new Float32Array(0);
  // Copy into a fresh, 4-byte-aligned ArrayBuffer so the Float32Array view
  // is always valid regardless of the source Buffer's byteOffset.
  const copy = Buffer.allocUnsafe(usableBytes);
  buf.copy(copy, 0, 0, usableBytes);
  return new Float32Array(copy.buffer, copy.byteOffset, usableBytes / 4);
}
