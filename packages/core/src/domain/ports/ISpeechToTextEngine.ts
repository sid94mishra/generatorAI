// ────────────────────────────────────────────────────────────────
// ISpeechToTextEngine — speech-to-text engine seam.
//
// Promoted from the former app-local `apps/server/src/stt/ISttEngine.ts`
// into the domain layer so it follows the same rule as every other
// capability port in this codebase (IAgentHarness, IBrowserBridge,
// ITerminalHost): "every service talks to a port; SDKs/models only ever
// appear inside an infrastructure adapter." This is the
// `ISpeechToTextEngine` described in
// docs/VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part B.2 — same contract,
// same seam, new implementations behind it (Whisper today, Parakeet from
// Phase 1).
//
// Audio contract: mono PCM, 16 kHz, Float32 samples in [-1, 1]. The client
// captures at 16 kHz so no server-side resampling is needed.
// ────────────────────────────────────────────────────────────────

export interface SttTranscribeOptions {
  /** BCP-47 language hint, e.g. 'en'. Engines may ignore it. */
  language?: string;
}

export interface SttTranscribeResult {
  /** Best-effort transcript for the audio provided so far. */
  text: string;
  /**
   * True when the engine's own end-of-utterance detector fired for this
   * call (native streaming engines only — e.g. Parakeet-EOU, Phase 1).
   * Absent/undefined for engines with no endpointing of their own (e.g.
   * Whisper) — callers must fall back to a debounce timer in that case.
   * Optional so this addition is zero-behavior-change for existing engines.
   */
  isEndOfUtterance?: boolean;
}

/**
 * Thrown by `createStream` when the engine that ended up active has no
 * streaming decoder. Distinct from a real failure: a wrapper (see
 * CascadingSttEngine) cannot know which candidate will win until it has
 * loaded one, so it must expose `createStream` unconditionally and report
 * "not supported" at call time. Callers fall back quietly on this and loudly
 * on anything else.
 */
export const STT_STREAMING_UNSUPPORTED = 'stt:streaming-unsupported';

/** Callbacks for a live streaming session — see `createStream`. */
export interface SttStreamCallbacks {
  /**
   * The utterance so far, revised as the model hears more. Cumulative, not a
   * fragment: a streaming decoder may retract and rewrite what it already
   * emitted, so callers replace what they were showing rather than append.
   */
  onPartial: (text: string) => void;
  /** One utterance reached end-of-speech. More may follow on the same stream. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

/** A live streaming session. */
export interface SttStreamHandle {
  /** Feed 16 kHz mono Float32 audio as it is captured. */
  pushAudio: (pcm: Float32Array) => void;
  /** Stop sending audio and flush whatever is buffered as a last utterance. */
  finish: () => Promise<void>;
  /** Abandon the session; no further callbacks fire. */
  cancel: () => void;
}

export interface ISpeechToTextEngine {
  /** Human-readable id for logs/telemetry (e.g. 'whisper:Xenova/whisper-base.en'). */
  readonly name: string;

  /**
   * Ensure the model is loaded and ready. Safe to call repeatedly — the
   * first call pays the one-time download + load cost; later calls are
   * no-ops. Throws if the engine cannot be initialised (e.g. optional
   * dependency missing).
   */
  load(): Promise<void>;

  /**
   * Transcribe a PCM buffer (16 kHz mono Float32). Called both for interim
   * passes and the final pass; exactly what buffer is passed (whole
   * utterance vs. current open segment) is the caller's (session runner's)
   * choice, not this port's concern. Must be safe to call
   * concurrently-serialised by the caller (one at a time).
   */
  transcribe(pcm: Float32Array, options?: SttTranscribeOptions): Promise<SttTranscribeResult>;

  /**
   * Open a live streaming session — OPTIONAL, and the difference between
   * "words appear as you speak" and "a block of text lands after you stop".
   *
   * Only engines with a genuinely incremental decoder implement this. A batch
   * model (Whisper, Moonshine, Parakeet) cannot: the only way to fake it is to
   * re-transcribe a growing buffer over and over, which costs more every pass,
   * can rewrite words the user already read, and still cannot emit anything
   * until it has enough audio to be worth a pass. Callers therefore branch on
   * whether this method exists, and fall back to VAD-segmented batch
   * transcription when it does not — see SttSessionRunner.
   *
   * The engine owns end-of-utterance detection while streaming; a caller-side
   * VAD is neither needed nor used on this path.
   */
  createStream?(cb: SttStreamCallbacks, options?: SttTranscribeOptions): Promise<SttStreamHandle>;

  /** Release model resources. Best-effort. */
  dispose(): Promise<void>;
}
