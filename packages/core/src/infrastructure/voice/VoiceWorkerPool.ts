// ────────────────────────────────────────────────────────────────
// VoiceWorkerPool — runs ONNX voice inference off the main event loop.
//
// WHY THIS EXISTS (measured, not assumed)
// ---------------------------------------
// `onnxruntime-node` (1.21.0) returns a Promise from `session.run()`, but it
// executes SYNCHRONOUSLY on the calling thread. Measured on the reference
// 16-core Windows machine, with raw ORT and zero transformers.js code in the
// path — a run taking 12404ms blocked the event loop for 12354ms. It is a
// promise-shaped blocking call.
//
// Left on the main thread that is not a slow path, it is an outage:
//
//   Kokoro, one medium sentence   ~10.1s compute  →  ~10.0s loop blocked
//   Parakeet, 60s of audio         ~6.4s compute  →   ~6.3s loop blocked
//   Parakeet, 120s (segment cap)  ~14.7s compute  →  ~14.4s loop blocked
//
// For that whole window the server answers nothing — no HTTP, no SSE, no
// agent token streaming, for every user, not just the one who pressed the
// mic. Worse, `WedgeDetector` (apps/server/src/index.ts, 5s threshold) is
// doing exactly its job when it sees this, so it declares the process
// wedged and triggers a full graceful shutdown. Reproduced end to end: one
// "Read aloud" click on a three-sentence message shut the server down.
//
// Chunking the input does not fix it — the block scales with the work, so
// even a single short sentence blocked ~3.8s. The only fix is to run the
// inference on another thread, which is what this file does.
//
// DESIGN
// ------
// One worker thread owns the loaded models; the main thread keeps every bit
// of surrounding logic (model-id/dtype resolution, voice validation, output
// chunking, logging) in the engine classes that are already tested. Only the
// two genuinely heavy calls cross the boundary:
//
//   asr.load / asr.run   — used by BOTH WhisperSttEngine and ParakeetSttEngine
//                          (identical `pipeline('automatic-speech-recognition')`
//                          shape, so one code path serves both)
//   tts.load / tts.run   — kokoro-js
//
// Requests are serialized in the worker, which is the honest model: ORT
// saturates the machine during a run anyway, so admitting one at a time
// bounds CPU instead of thrashing. `VoiceService`'s own concurrency caps sit
// above this. The cost is that a long transcription delays a queued
// read-aloud; that is preferable to both fighting for the same cores.
//
// MODULE RESOLUTION
// -----------------
// The worker source is inline, so there is no build artefact to resolve
// across tsx / dist / Electron / vitest. Its only imports are two npm
// packages, and even those are not resolved inside the worker: the main
// thread resolves them to absolute URLs and passes them in `workerData`.
// Nothing in the worker depends on its own cwd or module parent.
//
// It is loaded from a `data:` URL rather than with `{ eval: true }`, and
// that difference is load-bearing, not stylistic. Node runs `eval: true`
// worker code as **CommonJS**, which defines `__dirname` — set to the
// process cwd. `kokoro-js` resolves its voice files with
//
//     typeof __dirname !== 'undefined' ? __dirname : import.meta.dirname
//
// so under a CommonJS worker it picked up the cwd and looked for
// `<cwd>/../voices/af_heart.bin`, which does not exist. Every synthesis
// then failed with ENOENT, was swallowed by TtsSessionRunner's
// per-sentence catch, and surfaced as "TTS completes instantly and plays
// nothing". A `data:` URL worker is an ES module, has no `__dirname`, and
// so lets kokoro-js find the voices shipped inside its own package.
// ────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker, type TransferListItem } from 'node:worker_threads';
import type { ILogger } from '@generatorai/shared';

/** Ops the worker understands. */
type Op = 'asr.load' | 'asr.run' | 'tts.load' | 'tts.run' | 'vad.load' | 'vad.score' | 'vad.release';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  /**
   * Which worker incarnation this request was posted to. A dying worker must
   * only fail ITS OWN requests: `recycle()` replaces the worker immediately
   * while the old thread's `exit` event arrives later, so without this the
   * corpse's teardown would reject the successor's in-flight work.
   */
  generation: number;
}

export interface AsrRunResult {
  text: string;
}

export interface TtsLoadResult {
  /** Voice names the loaded model actually ships, for host-side validation. */
  voices: string[];
}

export interface TtsRunResult {
  audio: Float32Array;
  samplingRate: number;
}

export interface VadScoreResult {
  probability: number;
}

// ── Worker source (eval mode) ────────────────────────────────────
const WORKER_SOURCE = /* javascript */ `
import { workerData, parentPort } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
const { transformersUrl, kokoroUrl, ortUrl, cacheDir } = workerData;

let transformers = null;
let asrPipeline = null;
let ttsModel = null;
let vadSession = null;
const vadStates = new Map();
const VAD_STATE = 2 * 1 * 128;

// A dependency may resolve to either the ESM or the CommonJS build. Importing
// CJS from ESM puts the exports on \`.default\` rather than on the namespace,
// so \`ns.env\`/\`ns.pipeline\` come back undefined and the first use fails with
// a bare "Cannot set properties of undefined". Probe for a known export and
// unwrap when needed.
async function importPkg(url, probe) {
  const ns = await import(url);
  if (ns && ns[probe] !== undefined) return ns;
  if (ns && ns.default && ns.default[probe] !== undefined) return ns.default;
  throw new Error('voice worker: ' + url + ' has no export "' + probe + '"');
}

async function loadTransformers() {
  if (!transformers) {
    transformers = await importPkg(transformersUrl, 'pipeline');
    if (cacheDir && transformers.env) transformers.env.cacheDir = cacheDir;
  }
  return transformers;
}

// An interrupted weight download leaves a SHORT file in the cache, and
// transformers.js treats any present file as a complete one — so every load
// from then on dies inside onnxruntime with the same message, forever, with
// no path back except a human deleting the directory. Observed on a real
// machine: 210,380,078 bytes of a ~611MB Parakeet weight file, and voice
// input had been dead ever since.
//
// ORT's message is specific enough to act on safely: it names the byte
// offset it wanted and the file length it found. Matching on that (and NOT
// on load failures generally — an unsupported dtype or an OOM session must
// never delete weights) turns a permanent failure into one retry.
const TRUNCATED_WEIGHTS_RE = /are out of bounds or can not be read in full|given file_length/i;

async function evictCachedModel(modelId) {
  const root = (transformers && transformers.env && transformers.env.cacheDir) || null;
  if (!root || typeof modelId !== 'string' || !modelId) return false;
  const dir = path.join(root, ...modelId.split('/'));
  // Refuse to delete anything that is not under the cache root — a model id
  // is remote-supplied and '..' in it must not escape.
  const resolvedRoot = path.resolve(root);
  if (!path.resolve(dir).startsWith(resolvedRoot + path.sep)) return false;
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}

const handlers = {
  async 'asr.load'({ modelId, dtype }) {
    const mod = await loadTransformers();
    const opts = dtype ? { dtype } : {};
    try {
      asrPipeline = await mod.pipeline('automatic-speech-recognition', modelId, opts);
    } catch (err) {
      const message = (err && err.message) || String(err);
      if (!TRUNCATED_WEIGHTS_RE.test(message)) throw err;
      let evicted = false;
      try { evicted = await evictCachedModel(modelId); } catch { /* report the original failure */ }
      throw new Error(
        message +
          (evicted
            ? ' — the cached copy of ' + modelId + ' was incomplete and has been deleted; ' +
              'it will be downloaded again on the next attempt.'
            : ' — the cached copy of ' + modelId + ' appears incomplete but could not be deleted.'),
      );
    }
    return {};
  },
  async 'asr.run'({ pcm, options }) {
    if (!asrPipeline) throw new Error('asr.run called before asr.load');
    const out = await asrPipeline(pcm, options ?? undefined);
    const text = Array.isArray(out)
      ? out.map((o) => (o && o.text) || '').join(' ')
      : ((out && out.text) || '');
    return { text };
  },
  async 'tts.load'({ modelId, dtype }) {
    // kokoro-js pulls its weights through transformers.js, so the cache dir
    // must be set on the SAME module instance before it loads.
    await loadTransformers();
    const { KokoroTTS } = await importPkg(kokoroUrl, 'KokoroTTS');
    ttsModel = await KokoroTTS.from_pretrained(modelId, { dtype, device: 'cpu' });
    return { voices: Object.keys(ttsModel.voices || {}) };
  },
  async 'tts.run'({ text, voice, speed }) {
    if (!ttsModel) throw new Error('tts.run called before tts.load');
    const out = await ttsModel.generate(text, { voice, speed });
    return { audio: out.audio, samplingRate: out.sampling_rate };
  },
  async 'vad.load'({ modelPath }) {
    const ort = await import(ortUrl);
    vadSession = { ort, session: await ort.InferenceSession.create(modelPath) };
    return {};
  },
  async 'vad.score'({ sid, pcm, sampleRate }) {
    if (!vadSession) throw new Error('vad.score called before vad.load');
    const { ort, session } = vadSession;
    const state = vadStates.get(sid) ?? new Float32Array(VAD_STATE);
    const out = await session.run({
      input: new ort.Tensor('float32', pcm, [1, pcm.length]),
      state: new ort.Tensor('float32', state, [2, 1, 128]),
      sr: new ort.Tensor('int64', BigInt64Array.from([BigInt(sampleRate)]), []),
    });
    vadStates.set(sid, new Float32Array(out.stateN.data));
    return { probability: out.output.data[0] };
  },
  async 'vad.release'({ sid }) {
    vadStates.delete(sid);
    return {};
  },
};

// TWO queues, not one. ORT blocks this thread for the duration of a run, so
// nothing here is truly concurrent — but a VAD window must not sit behind a
// QUEUED transcription, only behind a RUNNING one. Splitting the queues turns
// a worst-case wait of "every pending transcribe" into "the one in flight".
let heavyQueue = Promise.resolve();
let vadQueue = Promise.resolve();
parentPort.on('message', (msg) => {
  const { id, op, payload } = msg;
  const run = async () => {
    try {
      const handler = handlers[op];
      if (!handler) throw new Error('unknown op: ' + op);
      const result = await handler(payload || {});
      const transfer = [];
      if (result.audio && result.audio.buffer) transfer.push(result.audio.buffer);
      parentPort.postMessage({ id, ok: true, result }, transfer);
    } catch (err) {
      // Name the op. A bare library message like "mod.pipeline is not a
      // function" is unattributable once it has crossed the thread boundary
      // and been re-thrown on the main side.
      const message = (err && err.message) || String(err);
      parentPort.postMessage({ id, ok: false, error: op + ': ' + message });
    }
  };
  if (op.startsWith('vad.')) vadQueue = vadQueue.then(run);
  else heavyQueue = heavyQueue.then(run);
});
`;

export class VoiceWorkerPool {
  private worker: Worker | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private disposed = false;
  /** Bumped for every spawned worker; see {@link PendingRequest.generation}. */
  private generation = 0;
  /** Workers we terminated on purpose, so their exit isn't reported as a fault. */
  private readonly recycling = new Set<Worker>();
  /** Which ASR model the CURRENT worker holds, so `loadAsr` can spot a switch. */
  private loadedAsrModel: string | undefined;

  constructor(private readonly logger?: ILogger) {}

  /**
   * Absolute file URLs for the two npm packages the worker needs. Resolved
   * HERE, on the main thread, where this module's own resolution context is
   * valid — an `eval: true` worker has none of its own.
   */
  private static resolveDeps(): { transformersUrl: string; kokoroUrl: string; ortUrl: string } {
    return {
      transformersUrl: resolvePackage('@huggingface/transformers'),
      kokoroUrl: resolvePackage('kokoro-js'),
      // The VAD drives onnxruntime directly rather than through
      // transformers.js, and it MUST run on this same worker — see
      // `loadVad`.
      ortUrl: resolvePackage('onnxruntime-node'),
    };
  }

  private ensureWorker(): Worker {
    if (this.disposed) throw new Error('VoiceWorkerPool has been disposed');
    if (this.worker) return this.worker;

    const generation = ++this.generation;
    const { transformersUrl, kokoroUrl, ortUrl } = VoiceWorkerPool.resolveDeps();
    // See MODULE RESOLUTION above for why this is a data: URL module and
    // not `{ eval: true }`.
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`), {
      workerData: {
        transformersUrl,
        kokoroUrl,
        ortUrl,
        cacheDir: process.env['STT_CACHE_DIR'] ?? null,
      },
    });

    worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const req = this.pending.get(msg.id);
      if (!req) return;
      this.pending.delete(msg.id);
      if (msg.ok) req.resolve(msg.result);
      else req.reject(new Error(msg.error ?? 'voice worker failed'));
    });

    // A worker that dies takes its loaded models with it. Fail its in-flight
    // requests rather than leaving callers awaiting forever, and drop the
    // reference so the next call spawns a fresh one (which will re-load the
    // models — slow, but recoverable, and better than a voice feature that
    // stays dead until the server restarts).
    //
    // Scoped to THIS worker on both counts. `recycle()` installs a successor
    // synchronously and the corpse's `exit` lands afterwards, so clearing
    // `this.worker` unconditionally would orphan the live worker and
    // rejecting every pending entry would fail work the successor is already
    // running.
    const die = (reason: string): void => {
      if (this.worker === worker) this.worker = undefined;
      const err = new Error(`voice worker ${reason}`);
      for (const [id, req] of [...this.pending]) {
        if (req.generation !== generation) continue;
        this.pending.delete(id);
        req.reject(err);
      }
    };
    worker.on('error', (err) => {
      this.logger?.error?.(`[voice-worker] crashed: ${err.message}`);
      die(`crashed: ${err.message}`);
    });
    worker.on('exit', (code) => {
      // `terminate()` always reports a non-zero code, so an exit we asked
      // for is not worth a warning — only an exit we didn't. `recycle()` has
      // already logged its own reason.
      const deliberate = this.disposed || this.recycling.delete(worker);
      if (code !== 0 && !deliberate) this.logger?.warn?.(`[voice-worker] exited with code ${code}`);
      die(`exited (code ${code})`);
    });

    // Idle: don't hold the process open for a voice model nobody is using.
    // In flight: DO hold it open — `post()` refs while a request is pending
    // and unrefs when the last one settles. An always-unref'd worker lets
    // Node exit the moment nothing else is scheduled, which silently
    // abandons a transcription that was about to reply (observed: a script
    // whose only pending work was `loadAsr` died with "unsettled top-level
    // await" instead of resolving).
    worker.unref();
    this.worker = worker;
    return worker;
  }

  private post<T>(op: Op, payload: Record<string, unknown>, transfer: TransferListItem[] = []): Promise<T> {
    // Spawning can throw (disposed pool, unresolvable dependency). These are
    // `async` methods from every caller's point of view, so surface it as a
    // rejection — a synchronous throw here would escape an `await` chain that
    // callers reasonably wrap in `.catch()`, and in the engines it would
    // bypass `load()`'s retry bookkeeping entirely.
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (err) {
      return Promise.reject(err as Error);
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const settle = (fn: () => void): void => {
        this.pending.delete(id);
        if (this.pending.size === 0) this.worker?.unref();
        fn();
      };
      this.pending.set(id, {
        resolve: (value) => settle(() => resolve(value as T)),
        reject: (err) => settle(() => reject(err)),
        generation: this.generation,
      });
      worker.ref();
      try {
        worker.postMessage({ id, op, payload }, transfer);
      } catch (err) {
        settle(() => reject(err as Error));
      }
    });
  }

  // ── ASR (Whisper and Parakeet share this path) ─────────────────

  /**
   * Load an ASR model, RECYCLING THE WORKER if the load fails.
   *
   * A half-built ONNX session leaves state behind in the worker that the next
   * `pipeline()` call in that thread inherits. Measured, with a truncated
   * Parakeet weight file in the cache and a complete Whisper one beside it:
   *
   *   parakeet  → fails: "Deserialize tensor onnx::MatMul_7173_quantized …
   *                       given file_length: 210380078"
   *   whisper   → fails with the SAME Parakeet error, naming the SAME
   *               quantized tensor and the SAME Parakeet file length,
   *               despite loading fp32 weights from a different repo
   *   whisper alone, fresh worker → loads in 2.0s and transcribes
   *
   * So the first failure was being reported for every later load, which
   * silently defeated `CascadingSttEngine` — the fallback ran, was told it
   * had failed too, and the user got the first engine's opaque ORT message
   * with voice input dead. Its file header promises the opposite ("never to
   * 'voice input stops working'"), and that promise cannot be kept while the
   * candidates share a contaminated thread.
   *
   * Recycling costs a warm TTS model if one is loaded (the next read-aloud
   * re-loads it, a few seconds). That is the right trade against leaving
   * voice input permanently broken.
   */
  async loadAsr(modelId: string, dtype?: string): Promise<void> {
    // Loading a SECOND, different ASR model into a worker that already holds
    // one fails the same way a failed load does. Measured: moonshine loads in
    // 1.4s on a fresh worker, but in a worker where parakeet had already been
    // loaded and run it dies with "Load model from …decoder_model_merged_
    // quantized.onnx failed:system error number 13". `asr.load` only
    // reassigns `asrPipeline`; the previous ORT session and its file handles
    // are still there. Start clean whenever the model actually changes.
    if (this.loadedAsrModel && this.loadedAsrModel !== modelId) {
      this.recycle(`switching ASR model ${this.loadedAsrModel} -> ${modelId}`);
    }
    try {
      await this.post<void>('asr.load', { modelId, ...(dtype ? { dtype } : {}) });
      this.loadedAsrModel = modelId;
    } catch (err) {
      this.recycle(`ASR model ${modelId} failed to load`);
      throw err;
    }
  }

  /**
   * Terminate the worker so the next request gets a clean one.
   *
   * In-flight requests are rejected by the `exit` handler installed in
   * `ensureWorker`, exactly as for a crash — the caller sees a rejection
   * rather than hanging.
   */
  private recycle(reason: string): void {
    this.loadedAsrModel = undefined;
    const worker = this.worker;
    if (!worker) return;
    this.worker = undefined;
    this.recycling.add(worker);
    this.logger?.warn?.(`[voice-worker] recycling: ${reason}`);
    void worker.terminate().catch(() => undefined);
  }

  runAsr(pcm: Float32Array, options?: Record<string, unknown>): Promise<AsrRunResult> {
    // Always copy, then transfer the COPY. Transferring the caller's own
    // buffer would detach it, and callers legitimately keep the audio alive
    // across calls — `SttSessionRunner` transcribes a growing snapshot of the
    // same segment repeatedly (interim previews, then the final pass), so
    // detaching it mid-session would silently empty later transcriptions.
    // The copy is at most ~7.7MB (the 120s segment cap), against an inference
    // measured in seconds; it is not a cost worth taking that risk for.
    const payloadPcm = new Float32Array(pcm);
    return this.post<AsrRunResult>(
      'asr.run',
      { pcm: payloadPcm, ...(options ? { options } : {}) },
      [payloadPcm.buffer as TransferListItem],
    );
  }

  // ── TTS ────────────────────────────────────────────────────────

  loadTts(modelId: string, dtype: string): Promise<TtsLoadResult> {
    return this.post<TtsLoadResult>('tts.load', { modelId, dtype });
  }

  runTts(text: string, voice: string, speed: number): Promise<TtsRunResult> {
    return this.post<TtsRunResult>('tts.run', { text, voice, speed });
  }

  // ── VAD ────────────────────────────────────────────────────────
  //
  // Voice activity detection shares this worker rather than getting its own,
  // and that is a hard requirement, not a convenience:
  // **onnxruntime-node 1.21.0 supports exactly one thread per process.**
  // Using it from a second thread — main-plus-worker OR worker-plus-worker —
  // segfaults with
  // `FATAL ERROR: v8::HandleScope::CreateHandle() Cannot create a handle
  // without a HandleScope`. Both arrangements were tried and both crashed the
  // server. See SileroVad.ts for the reproduction.

  loadVad(modelPath: string): Promise<void> {
    return this.post<void>('vad.load', { modelPath });
  }

  /** Score one VAD window. `sid` scopes the model's recurrent state per session. */
  scoreVad(sid: number, pcm: Float32Array, sampleRate: number): Promise<VadScoreResult> {
    const owned = new Float32Array(pcm);
    return this.post<VadScoreResult>(
      'vad.score',
      { sid, pcm: owned, sampleRate },
      [owned.buffer as TransferListItem],
    );
  }

  releaseVad(sid: number): Promise<void> {
    return this.post<void>('vad.release', { sid });
  }

  /** Terminate the worker and fail anything still in flight. Idempotent. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const worker = this.worker;
    this.worker = undefined;
    for (const [, req] of this.pending) req.reject(new Error('voice worker disposed'));
    this.pending.clear();
    if (worker) await worker.terminate().catch(() => undefined);
  }
}

/**
 * Resolve a package to an absolute URL the worker can import.
 *
 * `import.meta.resolve` is preferred because it honours the package's
 * `exports` map and the `import` condition, which yields the ESM build.
 * `require.resolve` is the fallback; it yields the CommonJS build, which
 * still works (the worker unwraps `.default`) but is the less faithful entry
 * point. Both are done HERE rather than in the worker, which — being
 * `eval`-created — has no module parent of its own to resolve against.
 */
function resolvePackage(specifier: string): string {
  try {
    return import.meta.resolve(specifier);
  } catch {
    return pathToFileURL(createRequire(import.meta.url).resolve(specifier)).href;
  }
}

/**
 * Process-wide shared pool. The models are hundreds of megabytes each; a
 * second worker would mean a second copy of both for no throughput gain,
 * since ORT already saturates the machine during a run.
 */
let shared: VoiceWorkerPool | undefined;

export function sharedVoiceWorkerPool(logger?: ILogger): VoiceWorkerPool {
  shared ??= new VoiceWorkerPool(logger);
  return shared;
}

/** Test seam / shutdown hook — drops the shared pool so the next call respawns. */
export async function disposeSharedVoiceWorkerPool(): Promise<void> {
  const pool = shared;
  shared = undefined;
  if (pool) await pool.dispose();
}
