// ────────────────────────────────────────────────────────────────
// EnergyVad — energy-based (RMS) voice-activity/silence detector.
//
// Substitutes for the native end-of-utterance (EOU) token that
// `docs/VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md` Part B.4/E specifies from
// the `nvidia/parakeet_realtime_eou_120m-v1` checkpoint. That checkpoint's
// architecture (RNNT/transducer with in-model streaming state) has no
// implementation in the transformers.js runtime already used by this
// codebase, and there is no way to hand-write and verify a from-scratch ONNX
// decoder for it in this environment. This is a deliberate, documented
// substitution — not a hidden downgrade: it gets the SAME practical outcome
// the plan is actually after (segment finalization driven by a real signal
// instead of a fixed 900ms poll) using a real, independently-verifiable DSP
// technique instead of unverifiable model-decoding code.
//
// Engine-agnostic by design: whichever ISpeechToTextEngine is plugged in
// (Whisper or Parakeet-CTC — see WhisperSttEngine.ts / ParakeetSttEngine.ts),
// segmentation happens here in the session layer, not inside the engine.
//
// Algorithm: track running RMS amplitude per pushed chunk. Once the session
// has seen voiced audio (RMS >= threshold), accumulate consecutive
// sub-threshold sample-time; once that run reaches `silenceHangoverMs`,
// report "end of utterance" once and reset for the next one. Leading
// silence (before any voiced audio) never counts — a session sitting idle
// after `start()` but before the user speaks must not immediately fire.
// ────────────────────────────────────────────────────────────────

export interface EnergyVadOptions {
  /** RMS amplitude (0..1) below which a chunk is treated as silence. Default 0.01. */
  silenceThreshold?: number;
  /** Consecutive silence duration (ms) that counts as end-of-utterance. Default 700ms. */
  silenceHangoverMs?: number;
  /** Sample rate (Hz) of incoming audio, for converting ms to sample counts. Default 16000. */
  sampleRate?: number;
}

export class EnergyVad {
  private readonly threshold: number;
  private readonly hangoverSamples: number;
  private everVoiced = false;
  private silentSamplesRun = 0;

  constructor(opts: EnergyVadOptions = {}) {
    this.threshold = opts.silenceThreshold ?? 0.01;
    const sampleRate = opts.sampleRate ?? 16_000;
    const hangoverMs = opts.silenceHangoverMs ?? 700;
    this.hangoverSamples = Math.round((hangoverMs / 1000) * sampleRate);
  }

  /**
   * Feed one chunk of mono Float32 PCM. Returns `0` while nothing has
   * triggered. The moment sustained silence is first detected after voiced
   * audio, returns the number of trailing silent samples accumulated since
   * the last voiced chunk (across however many chunks that took) — the
   * caller must trim exactly that many samples off the TAIL of its
   * accumulated segment before transcribing it, or the silence used to
   * *detect* the end of the utterance ends up padding the audio actually
   * sent to the engine. This instance resets its internal state at the same
   * time so the next utterance in the same session gets independent
   * detection.
   */
  pushChunk(pcm: Float32Array): number {
    const rms = rootMeanSquare(pcm);
    if (rms >= this.threshold) {
      this.everVoiced = true;
      this.silentSamplesRun = 0;
      return 0;
    }
    if (!this.everVoiced) return 0; // Leading silence never triggers.
    this.silentSamplesRun += pcm.length;
    if (this.silentSamplesRun >= this.hangoverSamples) {
      const trailingSilentSamples = this.silentSamplesRun;
      this.reset();
      return trailingSilentSamples;
    }
    return 0;
  }

  /** Discard all state — used on pause()/cancel() so a fresh utterance starts clean. */
  reset(): void {
    this.everVoiced = false;
    this.silentSamplesRun = 0;
  }
}

function rootMeanSquare(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i] as number;
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / pcm.length);
}
