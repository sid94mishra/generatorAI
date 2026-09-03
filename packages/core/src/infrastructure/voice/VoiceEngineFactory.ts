// ────────────────────────────────────────────────────────────────
// VoiceEngineFactory — construct STT/TTS engines by id.
//
// The point of this file is that swapping the speech model is a
// CONFIGURATION change, not a code change. Adding a better model later means
// adding one descriptor and one constructor entry here; nothing in
// `VoiceService`, `SttSessionRunner`, the WebSocket routes or any client
// touches a model name.
//
// It deliberately mirrors `HarnessFactory`/`HarnessRegistry` in
// packages/agent-harness-providers, which is this codebase's existing answer
// to the same problem for agent providers: a descriptor table, construction
// by id, and an availability query. Voice is the same shape of problem, so
// it gets the same shape of solution rather than a second convention.
//
// WHY DESCRIPTORS AND NOT JUST A SWITCH
// -------------------------------------
// Choosing a speech model is not a one-dimensional "which is best" — the
// engines differ on axes a caller genuinely needs to reason about, and those
// differences are not discoverable from the model id. `casedOutput` in
// particular is load-bearing: an engine that emits neither capitals nor
// punctuation cannot have them added back downstream (the rule-based
// formatter handles SPOKEN punctuation commands, not inferred structure), so
// a UI that lets a user pick an engine has to be able to say so.
//
// Every figure in the table below was measured on the reference machine
// against the same fixture, not taken from a model card.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { ISpeechToTextEngine } from '../../domain/ports/ISpeechToTextEngine.js';
import type { ITextToSpeechEngine } from '../../domain/ports/ITextToSpeechEngine.js';
import type { VoiceWorkerPool } from './VoiceWorkerPool.js';
import { ParakeetSttEngine } from './ParakeetSttEngine.js';
import { NemotronSttEngine } from './NemotronSttEngine.js';
import { MoonshineSttEngine } from './MoonshineSttEngine.js';
import { WhisperSttEngine } from './WhisperSttEngine.js';
import { DisabledSttEngine } from './DisabledSttEngine.js';
import { CascadingSttEngine } from './CascadingSttEngine.js';
import { KokoroTtsEngine } from './KokoroTtsEngine.js';

/**
 * `auto` is not a model — it is the cascade: try the preferred engine, fall
 * back to Whisper if it cannot load (no network on first run, wiped cache,
 * bad override, OOM session). Kept distinct from the concrete ids so
 * `describe()` can report what actually won.
 */
export type SttEngineId = 'auto' | 'nemotron' | 'parakeet' | 'moonshine' | 'whisper' | 'disabled';
export type TtsEngineId = 'kokoro' | 'disabled';

export interface SttEngineDescriptor {
  id: Exclude<SttEngineId, 'auto' | 'disabled'>;
  label: string;
  /** Hub model id this engine loads by default. */
  modelId: string;
  /** Default quantization. */
  dtype: string;
  /** Approximate first-run download at the default dtype. */
  approxDownloadMB: number;
  /** Emits capitalization and punctuation. Cannot be added back downstream. */
  casedOutput: boolean;
  /** Measured mean latency per clip over the 3–6s sweep, reference machine. */
  measuredAvgMs: number;
  /** One-line summary of the trade-off this engine represents. */
  notes: string;
}

/**
 * Ordered by how good a default they are for dictation into a composer.
 * `notes` are measurements, not marketing.
 *
 * MEASURED HEAD-TO-HEAD (2026-08-31) — all three against the same three
 * sentences, synthesized by this repo's own Kokoro TTS so the reference
 * transcript is exact, resampled to 16 kHz and fed through `VoiceWorkerPool`:
 *
 *   ref   "Hello, how are you today? I would like to schedule a meeting."
 *   ref   "Can you help me with this? It's really important, and I need it done quickly."
 *   ref   "The quick brown fox jumps over the lazy dog. What a beautiful morning!"
 *
 *   parakeet   "helloo how are you today i would like to schedule a meeting"
 *              <EMPTY>                                        ← whole sentence lost
 *              "the quick brown fox jumumps over the lazy dog what a beautififul morning"
 *              228-352ms   no punctuation, no capitals
 *
 *   moonshine  all three transcribed EXACTLY, including the commas and the
 *              question marks, which it infers from prosody
 *              227-263ms   punctuation + capitals
 *
 *   whisper    all three transcribed exactly as well
 *              1664-1995ms (it zero-pads every input to 30s)
 *
 *   nemotron   all three transcribed exactly, and the ONLY engine that kept
 *              the comma in "important, and I need it done quickly"
 *              825-1055ms via NeMo-Speech.cpp on CPU (RTF 0.18-0.28)
 *              -- faster than whisper, ~4x slower than moonshine, 707MB
 *
 * That is why `auto` prefers moonshine. Parakeet's table row below claims it
 * is "most accurate of the three when it succeeds", and its own measurements
 * put 8 of 31 sweep segments at EMPTY — a dictation engine that silently
 * deletes a third of what you say, and cannot punctuate or capitalise what
 * survives, is not a defensible default no matter how good its best case is.
 */
export const STT_ENGINES: readonly SttEngineDescriptor[] = [
  {
    id: 'nemotron',
    label: 'Nemotron 3.5 ASR (NVIDIA)',
    modelId: 'nvidia/nemotron-3.5-asr-streaming-0.6b',
    dtype: 'q8_0',
    approxDownloadMB: 707,
    casedOutput: true,
    // Measured end-to-end through the HTTP route (spawn -> WAV POST ->
    // transcript), not in the worker pool like the rows below, because this
    // engine runs out of process. Same three reference sentences, same
    // machine: 1055/919/825ms for 3.8-4.7s clips, RTF 0.18-0.28.
    measuredAvgMs: 933,
    notes:
      'The most accurate of the four here and the only multilingual one — 40 language-locales in a single checkpoint, with punctuation and capitalization inferred natively. On the shared reference sentences it was the only engine to keep the comma in "important, and I need it done quickly"; both cased alternatives dropped it. Costs ~4x the default per segment and 707MB on disk, and needs the NVIDIA NeMo-Speech.cpp runtime installed separately (a native binary, which this app will not fetch or run unprompted). Opt-in.',
  },
  {
    id: 'parakeet',
    label: 'Parakeet CTC 0.6B',
    modelId: 'onnx-community/parakeet-ctc-0.6b-ONNX',
    dtype: 'q8',
    approxDownloadMB: 611,
    casedOutput: false,
    measuredAvgMs: 284,
    notes:
      'Fast and flat on long segments, but emits NO capitals and NO punctuation, and drops or corrupts words often enough to be unusable for dictation (1 of 3 reference sentences came back empty; the other two doubled a subword). Not the default — see the head-to-head above.',
  },
  {
    id: 'moonshine',
    label: 'Moonshine Base',
    modelId: 'onnx-community/moonshine-base-ONNX',
    dtype: 'q8',
    approxDownloadMB: 63,
    casedOutput: true,
    measuredAvgMs: 146,
    notes:
      'The default. Built for short-form on-device dictation; cost scales with actual audio length. Always capitalizes and punctuates — it infers commas and question marks from prosody — and never returns empty. Smallest download of the three. Can occasionally fall into a repetition loop.',
  },
  {
    id: 'whisper',
    label: 'Whisper base.en',
    modelId: 'Xenova/whisper-base.en',
    dtype: 'fp32',
    approxDownloadMB: 140,
    casedOutput: true,
    measuredAvgMs: 1717,
    notes:
      'Slowest by a wide margin because it zero-pads every input to 30 seconds, so a 1s preview costs the same as an 11s one. Kept as the universal fallback: it never returns empty and never doubles a subword.',
  },
];

export function sttEngineDescriptor(id: SttEngineId): SttEngineDescriptor | undefined {
  return STT_ENGINES.find((e) => e.id === id);
}

/** Ids accepted by `createSttEngine`, for validating configuration. */
export const ALL_STT_ENGINE_IDS: readonly SttEngineId[] = [
  'auto',
  'nemotron',
  'parakeet',
  'moonshine',
  'whisper',
  'disabled',
];

export interface SttEngineFactoryOptions {
  logger?: ILogger;
  /** Shared inference worker. Omit only in tests that mock the model libraries. */
  workerPool?: VoiceWorkerPool;
  /**
   * Which engine `auto` prefers before falling back to Whisper. Defaults to
   * `moonshine` — see the measured comparison above STT_ENGINES. Exists so
   * the cascade's preference is configurable without giving up the fallback.
   */
  preferred?: Exclude<SttEngineId, 'auto' | 'disabled'>;
}

/**
 * Build the configured STT engine.
 *
 * An unknown id is a configuration error, not a runtime one — it throws here,
 * at composition time, rather than failing later on a user's first click.
 */
export function createSttEngine(
  id: SttEngineId,
  opts: SttEngineFactoryOptions = {},
): ISpeechToTextEngine {
  const { logger, workerPool } = opts;
  const engineOpts = { ...(logger ? { logger } : {}), ...(workerPool ? { workerPool } : {}) };

  switch (id) {
    case 'disabled':
      return new DisabledSttEngine();
    case 'nemotron':
      // Out-of-process by necessity — see NemotronSttEngine.ts. It takes no
      // `workerPool`: it does not use transformers.js or onnxruntime-node at
      // all, so handing it the shared ONNX worker would be meaningless.
      return new NemotronSttEngine({ ...(logger ? { logger } : {}) });
    case 'parakeet':
      return new ParakeetSttEngine(engineOpts);
    case 'moonshine':
      return new MoonshineSttEngine(engineOpts);
    case 'whisper':
      return new WhisperSttEngine(engineOpts);
    case 'auto': {
      const preferred = opts.preferred ?? 'moonshine';
      // Whisper is always the last resort, and is never stacked behind
      // itself — a cascade of [whisper, whisper] would just double the load
      // attempt on failure.
      const candidates: ISpeechToTextEngine[] =
        preferred === 'whisper'
          ? [new WhisperSttEngine(engineOpts)]
          : [createSttEngine(preferred, opts), new WhisperSttEngine(engineOpts)];
      // One candidate is not a cascade. Returning it bare keeps `name` (and
      // therefore `describe()` and the telemetry that reads it) honest about
      // what is actually running, instead of reporting a fallback chain of
      // one.
      return candidates.length === 1 ? candidates[0]! : new CascadingSttEngine(candidates, logger);
    }
    default: {
      // Exhaustiveness: adding an id to the union without handling it here is
      // a compile error rather than a silent fallthrough.
      const never: never = id;
      throw new Error(
        `Unknown STT engine "${String(never)}". Expected one of: ${ALL_STT_ENGINE_IDS.join(', ')}`,
      );
    }
  }
}

export interface TtsEngineFactoryOptions {
  logger?: ILogger;
  workerPool?: VoiceWorkerPool;
}

/**
 * Build the configured TTS engine, or `undefined` when voice output is off —
 * `VoiceService` treats a missing engine as "speak() is unavailable", which
 * is how `GENERATORAI_TTS=0` avoids constructing and warming a model no route
 * can reach.
 */
export function createTtsEngine(
  id: TtsEngineId,
  opts: TtsEngineFactoryOptions = {},
): ITextToSpeechEngine | undefined {
  const { logger, workerPool } = opts;
  const engineOpts = { ...(logger ? { logger } : {}), ...(workerPool ? { workerPool } : {}) };

  switch (id) {
    case 'disabled':
      return undefined;
    case 'kokoro':
      return new KokoroTtsEngine(engineOpts);
    default: {
      const never: never = id;
      throw new Error(`Unknown TTS engine "${String(never)}". Expected one of: kokoro, disabled`);
    }
  }
}

/**
 * Resolve an env value to a valid id, warning and falling back rather than
 * throwing on a typo — a mistyped engine name should not stop the server from
 * booting with voice on its default.
 */
export function resolveSttEngineId(raw: string | undefined, logger?: ILogger): SttEngineId {
  if (!raw) return 'auto';
  if ((ALL_STT_ENGINE_IDS as readonly string[]).includes(raw)) return raw as SttEngineId;
  logger?.warn?.(
    `[voice] unknown GENERATORAI_STT_ENGINE="${raw}"; expected one of ${ALL_STT_ENGINE_IDS.join(', ')}. Falling back to "auto".`,
  );
  return 'auto';
}
