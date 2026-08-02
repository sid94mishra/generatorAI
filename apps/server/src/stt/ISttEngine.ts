// ────────────────────────────────────────────────────────────────
// ISttEngine — speech-to-text engine seam.
//
// The whole voice-input feature talks to this interface, never to a
// concrete model. That keeps the engine swappable: we ship Whisper
// (base.en, local, CPU, free) today and can drop in Nemotron-ONNX or a
// cloud provider later without touching the WebSocket route, the client
// hook, or the UI.
//
// Audio contract: mono PCM, 16 kHz, Float32 samples in [-1, 1]. The
// client captures at 16 kHz so no server-side resampling is needed.
// ────────────────────────────────────────────────────────────────

export interface SttTranscribeOptions {
  /** BCP-47 language hint, e.g. 'en'. Engines may ignore it. */
  language?: string;
}

export interface SttTranscribeResult {
  /** Best-effort transcript for the audio provided so far. */
  text: string;
}

export interface ISttEngine {
  /** Human-readable id for logs/telemetry (e.g. 'whisper-base.en'). */
  readonly name: string;

  /**
   * Ensure the model is loaded and ready. Safe to call repeatedly — the
   * first call pays the one-time download + load cost; later calls are
   * no-ops. Throws if the engine cannot be initialised (e.g. optional
   * dependency missing).
   */
  load(): Promise<void>;

  /**
   * Transcribe a complete PCM buffer (16 kHz mono Float32). Called both
   * for interim passes (growing buffer) and the final pass. Must be safe
   * to call concurrently-serialised by the caller (one at a time).
   */
  transcribe(pcm: Float32Array, options?: SttTranscribeOptions): Promise<SttTranscribeResult>;

  /** Release model resources. Best-effort. */
  dispose(): Promise<void>;
}
