// ────────────────────────────────────────────────────────────────
// DisabledSttEngine — null-object STT engine for GENERATORAI_STT=0.
//
// Final end-to-end review finding: `stt-ws.ts` already skips attaching the
// WS route when `GENERATORAI_STT=0`, so no real client can ever reach
// voice input — but `composition-root.ts` still constructed a REAL
// Whisper/Parakeet/CascadingSttEngine and `VoiceService.start()`
// unconditionally calls `sttEngine.load()` to warm it. Unlike `ttsEngine`
// (optional on `VoiceService`'s constructor — `undefined` when
// `GENERATORAI_TTS=0`), `sttEngine` is a required constructor param (STT
// predates TTS in this class), so there was no way to skip constructing a
// real engine at all. That meant the flag's documented promise — "disables
// voice input entirely" — didn't hold for the exact deployment scenario it
// exists for: an operator on an offline/resource-constrained box would
// still pay the full model load/download cost at boot.
//
// This substitutes a real `ISpeechToTextEngine` that does nothing, so
// `VoiceService` still gets a valid required constructor argument, but
// `load()`/`transcribe()`/`dispose()` are all free — no download, no
// memory, no network. It's only ever wired in when the route that would
// use it is already unreachable, so `transcribe()` returning an empty
// result is a "this should never actually run" safety net, not a user-
// visible behavior.
// ────────────────────────────────────────────────────────────────

import type {
  ISpeechToTextEngine,
  SttTranscribeOptions,
  SttTranscribeResult,
} from '../../domain/ports/ISpeechToTextEngine.js';

export class DisabledSttEngine implements ISpeechToTextEngine {
  readonly name = 'disabled';

  load(): Promise<void> {
    return Promise.resolve();
  }

  transcribe(_pcm: Float32Array, _options?: SttTranscribeOptions): Promise<SttTranscribeResult> {
    return Promise.resolve({ text: '' });
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
