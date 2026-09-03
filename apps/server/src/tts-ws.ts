// ────────────────────────────────────────────────────────────────
// tts-ws — WebSocket endpoint for local text-to-speech (voice output).
//
// URL:  ws://<host>/api/tts/stream
//
// Client → server (JSON only):
//   { t: 'speak', text }          — synthesize and stream this finished text
//   { t: 'speak_stream', sessionId } — Phase 4: speak that chat session's
//                                   agent output LIVE, as it is generated
//   { t: 'stop' }                 — barge-in: stop synthesis/playback
//                                   immediately (Part E Phase 4)
//
// Server → client:
//   { t: 'ready', sampleRate }  — connection accepted; `sampleRate` (Hz)
//                                 tells the client how to interpret the
//                                 binary frames that follow, decoupling it
//                                 from whichever TTS engine is configured
//   { t: 'sentence' }           — the binary frames that follow belong to a
//                                 NEW sentence. Purely a boundary marker; a
//                                 client that ignores it hears the same
//                                 audio. It exists because raw PCM carries
//                                 no boundaries and React Native can only
//                                 play whole files, so mobile cuts the
//                                 stream here — where a speaker pauses —
//                                 rather than mid-word.
//   • Binary WS frames = raw Float32 PCM audio chunks at `sampleRate`,
//     in speech order.
//   { t: 'done' }               — synthesis finished, no more audio coming
//   { t: 'error', message }
//
// Phase 3 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E) is `speak`:
// "read this message aloud", one finished string.
//
// Phase 4 is `speak_stream` + `stop`: Part B.5's "Agent turn streams via the
// EXISTING harness.token EventBus (no new plumbing) → (only when speak() has
// been invoked for that session) sentence-boundary buffer → speak()". The
// EventBus subscription is created HERE, per connection, and torn down with
// it — that is what makes it "never an always-on tax" (Part E Phase 4): a
// chat nobody asked to have read aloud has no listener attached. The
// sentence-boundary buffering itself is a layer down, in TtsSessionRunner,
// because `speak()` has accepted an `AsyncIterable<string>` since Phase 0.
//
// A client that only ever sends `speak` is completely unaffected by either
// addition. Runs entirely on the local machine (Kokoro on CPU) — no cloud,
// no key, no cost. Auth mirrors stt-ws.ts: reading a message aloud carries
// the same authority as reading that chat (`read:chats`), the mirror image
// of STT's `write:chats` (speech input becomes a chat message). `sessionId`
// is not separately authorized here for the same reason `GET /api/stream?
// scope=chat&id=…` doesn't: this deployment model has one shared key and no
// per-chat ownership, so `read:chats` already IS the authority to read any
// chat's event stream. If that ever changes, both places change together.
// ────────────────────────────────────────────────────────────────

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { subscribeAgentTokenStream, type AgentTokenStreamHandle, type SpeechSessionHandle } from '@generatorai/core';
import type { Container } from './composition-root.js';
import { authorizeWebSocketUpgrade } from './middleware/wsAuth.js';

const PATH = '/api/tts/stream';

export function attachTtsWebSocket(server: HttpServer, container: Container): void {
  const { logger, voiceService, eventBus } = container;

  // Feature flag — set GENERATORAI_TTS=0 to disable voice output entirely.
  if (process.env['GENERATORAI_TTS'] === '0') {
    logger.info?.('[tts-ws] disabled via GENERATORAI_TTS=0');
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    const pathOnly = url.split('?')[0] ?? '';
    if (pathOnly !== PATH) return; // Not our path; leave for other handlers.

    void (async () => {
      const result = await authorizeWebSocketUpgrade({
        container,
        req,
        socket,
        requiredScopes: ['read:chats'],
        ticketScope: { scope: 'tts', id: null },
        label: 'tts-ws',
      });
      if (!result.ok) return;
      wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws));
    })().catch((err: unknown) => {
      logger.warn?.(`[tts-ws] upgrade failed: ${(err as Error).message}`);
      socket.destroy();
    });
  });

  function handleConnection(ws: WebSocket): void {
    let handle: SpeechSessionHandle | null = null;
    let consuming: Promise<void> | null = null;
    /** Phase 4 — the live EventBus subscription backing a `speak_stream`. */
    let tokenStream: AgentTokenStreamHandle | null = null;

    const sendJson = (frame: Record<string, unknown>): void => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        /* ignore */
      }
    };

    const sendAudio = (chunk: Float32Array): void => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
      } catch {
        /* ignore */
      }
    };

    /**
     * Stop whatever is currently being spoken. Detaching the EventBus
     * subscription matters as much as stopping synthesis: `speak_stream`
     * adds a listener that would otherwise outlive the audio it feeds.
     */
    const stopActive = (): void => {
      if (handle) handle.stop();
      handle = null;
      if (tokenStream) tokenStream.close();
      tokenStream = null;
    };

    /** Drive one speak handle's audio to the client. Shared by both frames. */
    const startSpeaking = (text: string | AsyncIterable<string>): void => {
      try {
        // No workspace scoping — same reasoning as stt-ws.ts.
        handle = voiceService.speak(null, text, {
          onSentence: () => sendJson({ t: 'sentence' }),
        });
      } catch (err) {
        // A cap/config rejection must also drop the subscription the caller
        // may have just opened for us, or it leaks for the socket's lifetime.
        if (tokenStream) tokenStream.close();
        tokenStream = null;
        sendJson({ t: 'error', message: (err as Error).message });
        return;
      }
      const activeHandle = handle;
      consuming = (async () => {
        try {
          for await (const chunk of activeHandle.audio) {
            sendAudio(chunk);
          }
          sendJson({ t: 'done' });
        } catch (err) {
          sendJson({ t: 'error', message: (err as Error).message });
        } finally {
          // The turn ended on its own (or errored). Release the EventBus
          // listener now rather than waiting for the socket to close —
          // but only if this is still the current stream, since a barge-in
          // may already have replaced it.
          if (handle === activeHandle) stopActive();
        }
      })();
    };

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) return; // No binary input on this route.
      let msg: { t?: string; text?: string; sessionId?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      switch (msg.t) {
        case 'speak': {
          if (!msg.text || !msg.text.trim()) return;
          stopActive(); // A second 'speak' before the first finishes barges over it.
          startSpeaking(msg.text);
          break;
        }
        case 'speak_stream': {
          // NOTE: this is the chat's `sessionId` (the EventBus channel),
          // not its chat id — see subscribeAgentTokenStream's doc comment.
          const sessionId = msg.sessionId;
          if (typeof sessionId !== 'string' || !sessionId) {
            sendJson({ t: 'error', message: "speak_stream requires a 'sessionId'" });
            return;
          }
          stopActive();
          tokenStream = subscribeAgentTokenStream(eventBus, sessionId, logger);
          startSpeaking(tokenStream.text);
          break;
        }
        case 'stop':
          stopActive();
          break;
        default:
          break;
      }
    });

    const teardown = (): void => {
      stopActive();
      void consuming; // let any in-flight drain (audio simply stops arriving); nothing to await on close
    };
    ws.on('close', teardown);
    ws.on('error', teardown);

    sendJson({ t: 'ready', sampleRate: voiceService.ttsSampleRate });
  }
}
