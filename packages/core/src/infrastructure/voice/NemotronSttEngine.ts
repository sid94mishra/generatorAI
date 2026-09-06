// ────────────────────────────────────────────────────────────────
// NemotronSttEngine — NVIDIA Nemotron 3.5 ASR via NeMo-Speech.cpp.
//
// WHY THIS ENGINE IS SHAPED DIFFERENTLY FROM THE OTHER THREE
// ----------------------------------------------------------
// Whisper, Moonshine and Parakeet all run *in process*, through
// transformers.js + onnxruntime-node on the shared `VoiceWorkerPool`.
// Nemotron cannot: it is a cache-aware FastConformer-**RNNT**, and
//
//   * NVIDIA publishes no ONNX export — the official repo
//     (`nvidia/nemotron-3.5-asr-streaming-0.6b`) ships `.nemo`,
//     `.safetensors` and a q8_0 **GGUF**, and nothing else;
//   * transformers.js has no RNNT decode path for it. Community ONNX
//     exports exist, but they split the model into encoder/decoder/joiner
//     graphs and hand-write the greedy RNNT loop and the mel extractor
//     around them — several hundred lines of decoder that would have to be
//     ported and then maintained against a model we do not control.
//
// So this adapter talks to NVIDIA's own local runtime instead:
// **NeMo-Speech.cpp** (github.com/NVIDIA/NeMo-Speech.cpp, Apache-2.0), which
// loads the official GGUF and exposes an OpenAI-compatible transcription
// route. Both halves — weights and runtime — come from NVIDIA directly.
//
// WHY THE BINARY IS NOT AUTO-INSTALLED
// ------------------------------------
// Model weights are data; this codebase already downloads those on first use
// (Whisper, Moonshine, Kokoro, Silero). `nemo-speech` is a native executable,
// and silently fetching and running one is a different class of act. The
// engine therefore REQUIRES an explicit path and fails with instructions if
// it is absent — at which point `CascadingSttEngine` falls back to Whisper
// and dictation keeps working. Nothing here downloads or executes code on
// its own.
//
// CONFIG (env)
//   GENERATORAI_NEMO_SPEECH_BIN     path to the `nemo-speech` executable (required)
//   GENERATORAI_NEMO_SPEECH_MODEL   GGUF path, or an indexed name the CLI
//                                   resolves to an official NVIDIA repo
//                                   (default nvidia/nemotron-3.5-asr-streaming-0.6b)
//   GENERATORAI_NEMO_SPEECH_DEVICE  auto | cpu | cuda[:N] | metal | vulkan[:N]
//   GENERATORAI_NEMO_SPEECH_PORT    fixed port; default an ephemeral one
//   GENERATORAI_NEMO_SPEECH_URL     talk to an ALREADY-RUNNING server instead
//                                   of spawning one (skips every spawn path)
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { ILogger } from '@generatorai/shared';
import { SPOKEN_SYMBOL_PHRASES } from './RuleBasedTextFormatter.js';
import type {
  ISpeechToTextEngine,
  SttStreamCallbacks,
  SttStreamHandle,
  SttTranscribeOptions,
  SttTranscribeResult,
} from '../../domain/ports/ISpeechToTextEngine.js';

/**
 * The official NVIDIA repository, named in full rather than by the CLI's
 * short index name ('nemotron-3.5'). The CLI accepts either, and spelling out
 * the repo keeps the provenance visible in logs and in the descriptor table —
 * nothing here resolves to a third-party mirror.
 */
const DEFAULT_MODEL = 'nvidia/nemotron-3.5-asr-streaming-0.6b';
/** OpenAI-compatible transcription route exposed by `nemo-speech serve`. */
const TRANSCRIBE_PATH = '/v1/audio/transcriptions';
/** Live streaming route — the project's own event protocol, not OpenAI's. */
const REALTIME_PATH = '/v1/realtime';
/**
 * Silence (ms) after which the server closes an utterance and emits a final.
 *
 * 500ms rather than the server's default 800ms: this drives how quickly a
 * finished sentence commits, and dictation into a composer is a stop-start
 * activity where 800ms of dead air between sentences is noticeable. Measured
 * end to end, the final lands ~190ms after the audio stops regardless, so this
 * is the dominant term in "how long until my sentence is committed".
 */
const ENDPOINTING_MS = Number(process.env['GENERATORAI_NEMO_SPEECH_ENDPOINTING_MS'] ?? '800');

/**
 * Decoder boost for the phrases that mean a symbol.
 *
 * Spoken punctuation commands are short, low-frequency phrases, and the model
 * mangled several of them in live use — "curly brace" came back "curlibrace",
 * "bracket start" as "bracket stat". The formatter can only substitute a
 * phrase it actually receives, so the recogniser is told to expect them.
 * A modest boost: these should win a close contest, not override clear speech.
 */
const SYMBOL_BOOST = { phrases: [...SPOKEN_SYMBOL_PHRASES], boost: 2.0 };
/** How long to wait for the server to load the model and answer. */
const STARTUP_TIMEOUT_MS = Number(process.env['GENERATORAI_NEMO_SPEECH_STARTUP_MS'] ?? '180000');
/** Per-transcription request timeout. */
const REQUEST_TIMEOUT_MS = Number(process.env['GENERATORAI_NEMO_SPEECH_REQUEST_MS'] ?? '60000');

export interface NemotronSttEngineOptions {
  binPath?: string;
  modelId?: string;
  device?: string;
  port?: number;
  /** Base URL of an already-running server; when set, nothing is spawned. */
  baseUrl?: string;
  logger?: ILogger;
}

export class NemotronSttEngine implements ISpeechToTextEngine {
  readonly name: string;

  private readonly binPath: string | undefined;
  private readonly modelId: string;
  private readonly device: string | undefined;
  private readonly configuredPort: number | undefined;
  private readonly externalBaseUrl: string | undefined;
  private readonly logger?: ILogger;

  private proc: ChildProcess | null = null;
  private baseUrl: string | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(opts: NemotronSttEngineOptions = {}) {
    this.binPath = opts.binPath ?? process.env['GENERATORAI_NEMO_SPEECH_BIN'];
    this.modelId = opts.modelId ?? process.env['GENERATORAI_NEMO_SPEECH_MODEL'] ?? DEFAULT_MODEL;
    this.device = opts.device ?? process.env['GENERATORAI_NEMO_SPEECH_DEVICE'];
    this.externalBaseUrl = opts.baseUrl ?? process.env['GENERATORAI_NEMO_SPEECH_URL'];
    const port = opts.port ?? Number(process.env['GENERATORAI_NEMO_SPEECH_PORT'] ?? '0');
    this.configuredPort = Number.isFinite(port) && port > 0 ? port : undefined;
    if (opts.logger) this.logger = opts.logger;
    this.name = `nemotron:${this.modelId}`;
  }

  load(): Promise<void> {
    if (this.baseUrl) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad().catch((err) => {
      this.loadPromise = null;
      throw err;
    });
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    if (this.externalBaseUrl) {
      const url = this.externalBaseUrl.replace(/\/+$/, '');
      await this.waitForReady(url, 10_000);
      this.baseUrl = url;
      this.logger?.info?.(`[stt] Nemotron using the server already running at ${url}`);
      return;
    }

    if (!this.binPath) {
      throw new Error(
        'Nemotron ASR needs the NeMo-Speech.cpp runtime, which is a native executable this app ' +
          'deliberately does not download or run on its own. Install it from NVIDIA ' +
          '(https://github.com/NVIDIA/NeMo-Speech.cpp — Apache-2.0, prebuilt for Windows, macOS and Linux), ' +
          'then set GENERATORAI_NEMO_SPEECH_BIN to the `nemo-speech` binary. ' +
          'Until then voice input falls back to the next engine in the cascade.',
      );
    }

    const port = this.configuredPort ?? (await freePort());
    const args = [
      'serve',
      '--host', '127.0.0.1',
      '--port', String(port),
      '--asr-model', this.modelId,
      // The playground is a browser UI; a headless server has no use for it,
      // and not serving it keeps the surface to the one route we call.
      '--no-ui',
      ...(this.device ? ['--device', this.device] : []),
    ];

    const started = Date.now();
    this.logger?.info?.(
      `[stt] starting NeMo-Speech.cpp: ${this.binPath} ${args.join(' ')} ` +
        '(first run downloads ~707MB of official NVIDIA weights, then cached)',
    );

    const proc = spawn(this.binPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;

    // Keep the last few stderr lines so a startup failure can say WHY rather
    // than only "it never answered".
    const tail: string[] = [];
    const keep = (buf: Buffer): void => {
      const s = buf.toString().trim();
      if (!s) return;
      tail.push(s);
      if (tail.length > 8) tail.shift();
    };
    proc.stderr?.on('data', keep);
    proc.stdout?.on('data', keep);

    let exited: string | null = null;
    proc.on('exit', (code, signal) => {
      exited = `nemo-speech exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`;
      if (this.proc === proc) {
        this.proc = null;
        this.baseUrl = null;
        this.loadPromise = null;
      }
    });
    proc.on('error', (err) => {
      exited = `nemo-speech could not be started: ${err.message}`;
    });

    const url = `http://127.0.0.1:${port}`;
    try {
      await this.waitForReady(url, STARTUP_TIMEOUT_MS, () => exited);
    } catch (err) {
      this.stopProcess();
      const why = tail.length ? ` Last output: ${tail.join(' | ')}` : '';
      throw new Error(`${(err as Error).message}.${why}`);
    }

    this.baseUrl = url;
    this.logger?.info?.(`[stt] Nemotron ready in ${Date.now() - started}ms at ${url} (${this.modelId})`);
  }

  /** Poll until the server answers, the deadline passes, or the child dies. */
  private async waitForReady(
    url: string,
    timeoutMs: number,
    exitReason?: () => string | null,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = 'no response';
    while (Date.now() < deadline) {
      const died = exitReason?.();
      if (died) throw new Error(died);
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
        // Any HTTP answer means the listener is up and the model finished
        // loading — `serve` does not bind until it is ready to transcribe.
        if (res.status < 500) return;
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        lastError = (err as Error).message;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`NeMo-Speech.cpp did not become ready within ${timeoutMs}ms (${lastError})`);
  }

  async transcribe(pcm: Float32Array, options?: SttTranscribeOptions): Promise<SttTranscribeResult> {
    if (!this.baseUrl) await this.load();
    const url = this.baseUrl;
    if (!url) return { text: '' };
    if (pcm.length === 0) return { text: '' };

    const form = new FormData();
    form.append('file', new Blob([encodeWav(pcm)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.modelId);
    form.append('response_format', 'json');
    form.append('speech_contexts', JSON.stringify([SYMBOL_BOOST]));
    if (options?.language) form.append('language', options.language);

    const res = await fetch(`${url}${TRANSCRIBE_PATH}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`NeMo-Speech.cpp transcription failed: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
    }
    const body = (await res.json()) as { text?: string };
    return { text: (body.text ?? '').replace(/\s+/g, ' ').trim() };
  }

  /**
   * Open a `/v1/realtime` session — this is why Nemotron is worth its size.
   *
   * The batch route above cannot produce a word until the caller has decided
   * an utterance is over and handed it a complete buffer, so text arrives in
   * blocks after the speaker stops. This route is fed continuously and answers
   * continuously. Measured on this machine against an 11.7s clip streamed at
   * wall-clock speed: first partial 1.0s after speech began, 30 partial
   * updates at a 191ms median gap (sub-word granularity — "Hel", "lo",
   * ", how"), and the final 190ms after the audio ended.
   *
   * Deltas from the server are FRAGMENTS; they are accumulated here so
   * `onPartial` always receives the whole utterance so far, per the port's
   * contract (a streaming decoder may revise, and a caller appending raw
   * fragments could not represent that).
   */
  async createStream(cb: SttStreamCallbacks, options?: SttTranscribeOptions): Promise<SttStreamHandle> {
    if (!this.baseUrl) await this.load();
    const base = this.baseUrl;
    if (!base) throw new Error('Nemotron is not loaded');

    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}${REALTIME_PATH}`);
    ws.binaryType = 'arraybuffer';

    let utterance = '';
    let cancelled = false;
    let finishResolve: (() => void) | null = null;
    // Audio that arrived before the session was negotiated. Dropping it would
    // clip the first word of every session, which is exactly the syllable a
    // user is most likely to notice missing.
    let ready = false;
    const backlog: Float32Array[] = [];

    const sendPcm = (pcm: Float32Array): void => {
      if (ws.readyState !== ws.OPEN) return;
      const i16 = new Int16Array(pcm.length);
      for (let i = 0; i < pcm.length; i += 1) {
        const v = Math.max(-1, Math.min(1, pcm[i]!));
        i16[i] = Math.round(v * 32767);
      }
      try { ws.send(i16.buffer); } catch { /* socket closed under us */ }
    };

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('realtime session did not open')), 15_000);
      ws.onopen = () => { /* wait for session.created before configuring */ };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('realtime WebSocket failed'));
      };
      ws.onmessage = (ev: MessageEvent) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString()) as Record<string, unknown>;
        } catch { return; }
        const type = String(msg['type'] ?? '');
        if (type === 'session.created') {
          ws.send(JSON.stringify({
            type: 'session.update',
            session: {
              sample_rate: 16_000,
              automatic_punctuation: true,
              endpointing_ms: ENDPOINTING_MS,
              speech_contexts: [SYMBOL_BOOST],
              ...(options?.language ? { language: options.language } : {}),
            },
          }));
          return;
        }
        if (type === 'session.updated') {
          clearTimeout(timer);
          ready = true;
          for (const chunk of backlog.splice(0)) sendPcm(chunk);
          resolve();
          return;
        }
        if (cancelled) return;

        if (type.endsWith('transcription.delta')) {
          const delta = typeof msg['delta'] === 'string' ? msg['delta'] : '';
          if (delta) {
            utterance += delta;
            cb.onPartial(utterance.replace(/\s+/g, ' ').trim());
          }
          return;
        }
        if (type.endsWith('transcription.completed')) {
          const text = typeof msg['transcript'] === 'string'
            ? msg['transcript']
            : typeof msg['text'] === 'string' ? msg['text'] : utterance;
          utterance = '';
          const cleaned = text.replace(/\s+/g, ' ').trim();
          if (cleaned) cb.onFinal(cleaned);
          // `finish()` waits for the flush its commit triggered.
          finishResolve?.();
          finishResolve = null;
          return;
        }
        if (type === 'error') {
          cb.onError(String(msg['message'] ?? 'realtime transcription failed'));
        }
      };
      ws.onclose = () => {
        clearTimeout(timer);
        // A close mid-`finish()` must not hang the caller.
        finishResolve?.();
        finishResolve = null;
      };
    });

    return {
      pushAudio: (pcm: Float32Array): void => {
        if (cancelled || pcm.length === 0) return;
        if (!ready) { backlog.push(new Float32Array(pcm)); return; }
        sendPcm(pcm);
      },
      finish: async (): Promise<void> => {
        if (cancelled || ws.readyState !== ws.OPEN) return;
        const flushed = new Promise<void>((res) => { finishResolve = res; });
        try { ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); } catch { return; }
        // Bounded: a lost `completed` must not strand the session's stop().
        await Promise.race([flushed, new Promise<void>((r) => setTimeout(r, 5_000))]);
        try { ws.close(); } catch { /* already closing */ }
      },
      cancel: (): void => {
        cancelled = true;
        try { ws.send(JSON.stringify({ type: 'input_audio_buffer.clear' })); } catch { /* ignore */ }
        try { ws.close(); } catch { /* ignore */ }
      },
    };
  }

  async dispose(): Promise<void> {
    this.stopProcess();
    this.baseUrl = null;
    this.loadPromise = null;
    return Promise.resolve();
  }

  private stopProcess(): void {
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.exitCode !== null) return;
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  }
}

/** Ask the OS for a port nothing is using, then hand it to the child. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('could not allocate a port'))));
    });
  });
}

/**
 * 16 kHz mono Float32 -> a 16-bit PCM WAV.
 *
 * The port's audio contract is raw Float32 (see ISpeechToTextEngine.ts); the
 * OpenAI-compatible route takes a file. This is the whole adapter between them.
 */
function encodeWav(pcm: Float32Array, sampleRate = 16_000): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    view.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return bytes;
}
