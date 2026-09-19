// ────────────────────────────────────────────────────────────────
// pcm-worklet — the audio thread half of dictation.
//
// Batches the render quantum (128 samples) the audio thread hands over into
// frames big enough to be worth a WebSocket message, and posts each frame to
// the main thread, transferring the buffer rather than copying it.
//
// WHY THIS IS A FILE AND NOT A STRING
// -----------------------------------
// This used to be a template literal in `useSpeechToText.ts`, turned into a
// `blob:` URL at runtime, "so no separate build asset is needed". That is
// exactly what broke voice input everywhere the app ships with its real
// Content-Security-Policy: `script-src 'self' '<hash>'` does not include
// `blob:`, so `audioWorklet.addModule(blobUrl)` was refused and every attempt
// to dictate failed with "Failed to initialise audio: Unable to load a
// worklet's module." It worked in the Vite dev server, which serves no such
// header, and nowhere else.
//
// Shipped as a real asset it is fetched from the app's own origin, which
// `'self'` already allows — no CSP exception, no `blob:` in `script-src`,
// and the policy stays as tight as it was.
//
// `frameSamples` arrives through `processorOptions` so the size still has a
// single definition, in the hook, next to the sample rate it is derived from.
// ────────────────────────────────────────────────────────────────

/** Fallback only — the hook always passes the real value. 128 ms at 16 kHz. */
const DEFAULT_FRAME_SAMPLES = 2048;

class PCMWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._chunks = [];
    this._len = 0;
    const requested = options && options.processorOptions && options.processorOptions.frameSamples;
    this._target = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_FRAME_SAMPLES;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this._chunks.push(ch.slice(0));
      this._len += ch.length;
      if (this._len >= this._target) {
        const out = new Float32Array(this._len);
        let o = 0;
        for (const c of this._chunks) {
          out.set(c, o);
          o += c.length;
        }
        this.port.postMessage(out, [out.buffer]);
        this._chunks = [];
        this._len = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
