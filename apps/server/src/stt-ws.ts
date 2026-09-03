// ────────────────────────────────────────────────────────────────
// stt-ws — WebSocket endpoint for local speech-to-text (voice input).
//
// URL:  ws://<host>/api/stt/stream
//
// Client → server:
//   • Binary WS frames = raw 16 kHz mono Float32 PCM audio chunks.
//   • Text JSON frames  = control:
//       { t: 'start', lang?, interim? }   interim defaults to true; set false
//                           to suppress live preview passes entirely
//       { t: 'stop' }     → finalise; server replies with { t:'final' }
//       { t: 'cancel' }   → discard; no final emitted
//       { t: 'pause' }    — Phase 1: suspend audio consumption, keep the
//                           model warm (no teardown). No-op before 'start'.
//       { t: 'resume' }   — Phase 1: continue the SAME session.
//
// Server → client (JSON only):
//   { t: 'ready' }              — connection accepted, model warming
//   { t: 'interim', text }      — best-effort transcript for the currently
//                                 open (not yet finalized) segment
//   { t: 'segment', text }      — Phase 1: a segment reached end-of-utterance
//                                 (silence detected) while still listening;
//                                 more can follow in the same session
//   { t: 'final',   text }      — flushes any open segment, after 'stop'
//   { t: 'error',   message }
//   { t: 'paused' }             — Phase 1: ack for 'pause'
//   { t: 'resumed' }            — Phase 1: ack for 'resume'
//
// Runs entirely on the local machine (Whisper/Parakeet on CPU, selectable
// via STT_ENGINE — see composition-root.ts) — no cloud, no key, no cost.
// Auth + origin gating mirror the REST middleware and the terminal/browser
// WebSockets.
//
// Phase 0 (voice-module seam work): this route is a thin WS transport layer
// over `container.voiceService` (VoiceService owns the session
// lifecycle/cap/idle-reap — see packages/core/src/services/VoiceService.ts)
// instead of managing a module-level engine singleton + ad hoc session map
// itself.
// Phase 1: added the pause/resume frames above and 'segment' events — see
// docs/VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C. A client that never
// sends pause/resume (e.g. the mobile single-shot record/transcribe flow)
// is unaffected; a client that ignores 'segment' frames just never sees
// mid-session commits (falls back to only ever seeing the final 'final').
// ────────────────────────────────────────────────────────────────

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SttSessionHandle } from '@generatorai/core';
import type { Container } from './composition-root.js';
import { authorizeWebSocketUpgrade } from './middleware/wsAuth.js';

const PATH = '/api/stt/stream';

export function attachSttWebSocket(server: HttpServer, container: Container): void {
  const { logger, voiceService } = container;

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
    // No workspace scoping today — see VoiceService's file-header note.
    const workspaceId: string | null = null;

    let handle: SttSessionHandle | null = null;

    const sendJson = (frame: Record<string, unknown>): void => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        /* ignore */
      }
    };

    // `VoiceService.startSttSession` throws synchronously when the global
    // concurrency cap is reached — this must never escape as an uncaught
    // exception out of the `ws` message-handling callback (no caller of
    // `ensureSession()` is otherwise guarded). Report it as the same
    // `{t:'error'}` frame any other engine failure uses.
    const ensureSession = (): SttSessionHandle | null => {
      if (handle) return handle;
      try {
        handle = voiceService.startSttSession(workspaceId, {
          onInterim: (text) => sendJson({ t: 'interim', text }),
          onSegment: (text) => sendJson({ t: 'segment', text }),
          onFinal: (text) => sendJson({ t: 'final', text }),
          onError: (message) => sendJson({ t: 'error', message }),
        });
        return handle;
      } catch (err) {
        sendJson({ t: 'error', message: (err as Error).message });
        return null;
      }
    };

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        // Raw Float32 PCM. `ws` hands us a Node Buffer; view it as Float32
        // without copying when byte-aligned, else copy into an aligned one.
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        const pcm = toFloat32(buf);
        if (pcm.length) ensureSession()?.pushAudio(pcm);
        return;
      }
      // Control JSON.
      let msg: { t?: string; lang?: string; interim?: boolean };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      switch (msg.t) {
        case 'start': {
          const started = ensureSession();
          if (started) {
            // `interim` is optional and defaults to ON, so a client that
            // predates this field (mobile's batch upload) is unaffected.
            started.start(msg.lang, { interim: msg.interim !== false });
            sendJson({ t: 'ready' });
          }
          break;
        }
        case 'stop':
          if (handle) void handle.stop();
          break;
        case 'cancel':
          if (handle) handle.cancel();
          handle = null;
          break;
        case 'pause':
          // No-op if dictation was never started — nothing to suspend.
          if (handle) {
            handle.pause();
            sendJson({ t: 'paused' });
          }
          break;
        case 'resume':
          if (handle) {
            handle.resume();
            sendJson({ t: 'resumed' });
          }
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      if (handle) handle.cancel();
      handle = null;
    });
    ws.on('error', () => {
      if (handle) handle.cancel();
      handle = null;
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
