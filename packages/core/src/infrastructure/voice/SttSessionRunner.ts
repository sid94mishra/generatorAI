// ────────────────────────────────────────────────────────────────
// SttSessionRunner — per-connection speech-to-text state machine.
//
// One instance per open dictation WebSocket, owned by a `VoiceService`
// session record.
//
// Phase 1 rewrite (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C/E): the
// original design re-transcribed the ENTIRE accumulated buffer from sample
// zero on every 900ms debounce tick for the whole lifetime of the session —
// cost grew with utterance length, and already-emitted words could visibly
// change between passes. This version segments audio using `EnergyVad`
// (silence detection — see EnergyVad.ts for why this substitutes for the
// plan's native-EOU-model design): each segment is transcribed and
// finalized independently, then the buffer resets for the next one. Interim
// passes during an open segment stay debounced (900ms) but now only ever
// re-transcribe the CURRENT segment, which is bounded by silence gaps, not
// the whole session.
//
// Also adds pause()/resume() (Part C.3): pause suspends audio consumption
// and discards the current open segment's not-yet-committed audio WITHOUT
// tearing the engine down (keeps the model warm); resume continues the SAME
// runner. This lets a manual composer correction interrupt dictation
// without re-paying model warm-up cost or losing already-finalized segments.
//
// Concurrency (post-review fix): every call into `engine.transcribe()`
// (interim, segment finalize, or the final stop() pass) is serialized
// through `this.queue` — a strict FIFO promise chain with NO timeout. An
// earlier version waited for an in-flight call via a 1-second POLL
// ("`for (…) await setTimeout(20)`, give up after 50 iterations"); on a
// real CPU ONNX model whose transcribe() call can legitimately exceed 1s
// (entirely plausible — MAX_SEGMENT_SAMPLES allows up to 120s of audio),
// that poll would give up and start a SECOND concurrent transcribe() call,
// directly violating ISpeechToTextEngine's "safe to call
// concurrently-serialised... one at a time" contract. The queue has no such
// ceiling — it waits exactly as long as the prior call actually takes.
//
// The audio for each operation is also now snapshotted (and, for a segment
// boundary, the accumulator reset) SYNCHRONOUSLY at the moment it's
// triggered — inside pushAudio()/stop(), before anything is enqueued — not
// inside the async function that eventually runs once dequeued. This
// matters because `this.chunks`/`totalSamples` is a single shared mutable
// accumulator: if a segment boundary's own transcribe() call sat in the
// queue behind a slow interim pass, audio for the *next* utterance could
// keep arriving into the same not-yet-reset accumulator, and by the time
// the queued operation finally ran it would transcribe a merged mix of two
// separate utterances instead of just the one that was actually detected.
// Capturing a private, closed-over Float32Array (and resetting the shared
// accumulator) at trigger time gives every operation its own exclusive
// slice of audio regardless of how long it waits its turn in the queue.
//
// Moved from `apps/server/src/stt/SttSession.ts` in the Phase 0 seam work;
// this is the Phase 1 behavior rewrite on top of that move.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import { STT_STREAMING_UNSUPPORTED, type ISpeechToTextEngine, type SttStreamHandle } from '../../domain/ports/ISpeechToTextEngine.js';
import type { ITextFormatter } from '../../domain/ports/ITextFormatter.js';
import { EnergyVad, type EnergyVadOptions } from './EnergyVad.js';
import type { VoiceActivityDetector } from './VoiceActivityDetector.js';

/** How often (ms) to run an interim pass while the current segment keeps growing. */
const INTERIM_DEBOUNCE_MS = Number(process.env['GENERATORAI_STT_INTERIM_DEBOUNCE_MS'] ?? '900');
/**
 * How much of the open segment an INTERIM pass looks at, counted back from
 * the newest audio. Committed segments are always transcribed in full — this
 * bounds the live preview only.
 *
 * Without this the preview re-transcribes the whole open segment on every
 * tick, so its cost grows without limit as the user keeps talking: measured
 * over a 20s utterance, the worst single interim pass costs 789ms with no
 * window against 136ms at a 2s window. That unbounded growth is the same
 * defect VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part A.3 names as root
 * cause 1; Phase 1 narrowed it from per-session to per-segment but never
 * bounded it.
 *
 * A fixed-length window over a live stream is the standard shape for this
 * (streaming ASR toolkits do the same), and it is safe HERE specifically
 * because the window feeds a preview that is thrown away — nothing is
 * stitched across windows, so none of the usual overlap/duplication handling
 * is needed. What the user loses is preview context on an unusually long
 * unbroken utterance: the preview becomes a rolling tail rather than the
 * whole segment. Segments cut at silence, so in practice most never reach it.
 *
 * 5s default is a deliberate middle: it covers a typical dictated sentence
 * whole, and caps the worst pass at roughly 250ms on the reference machine.
 * Lower it toward 2s to chase latency, raise it for more preview context.
 */
const INTERIM_WINDOW_SAMPLES =
  16_000 * Number(process.env['GENERATORAI_STT_INTERIM_WINDOW_S'] ?? '5');
/** Don't bother transcribing until the open segment has at least this much audio. */
const MIN_INTERIM_SAMPLES = 16_000 * 0.6; // 0.6s @ 16 kHz
/** Safety cap per segment so a stuck client (or continuous noise that never
 *  trips the VAD's silence threshold) can't grow one segment unbounded. */
const MAX_SEGMENT_SAMPLES = 16_000 * 120;

export interface SttSessionCallbacks {
  onInterim: (text: string) => void;
  /**
   * Phase 1 — a segment reached end-of-utterance (silence detected) while
   * the session is still listening. More of these can follow within the
   * same session; the client inserts each at the composer's current caret
   * position (Part C.2).
   */
  onSegment: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

export class SttSessionRunner {
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private language?: string;
  private interimTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingInterim = false;
  /** Set false by `start({ interim: false })` — see that method's doc. */
  private interimEnabled = true;
  private stopped = false;
  private paused = false;
  private lastInterim = '';
  private readonly vad: VoiceActivityDetector;
  /** True once the MAX_SEGMENT_SAMPLES cap has been logged for the CURRENT open segment (avoids log spam). */
  private capWarned = false;

  /**
   * Strict FIFO serialization for every `engine.transcribe()` call — see
   * the file header. `busy` mirrors whether the chain currently has
   * unresolved work, so `pushAudio`'s interim trigger can decide to
   * coalesce (`pendingInterim`) instead of piling up redundant interim
   * passes behind a slow one. A segment finalize or `stop()` never
   * consults `busy` — those must always run, never be dropped/coalesced.
   */
  private queue: Promise<void> = Promise.resolve();
  private busy = false;

  /**
   * Set when the engine has a native streaming decoder (see
   * `ISpeechToTextEngine.createStream`). On this path the engine does its own
   * endpointing, so the VAD, the interim debounce and the whole
   * accumulate-then-transcribe machinery below are bypassed entirely — audio
   * goes straight through and partials come straight back.
   */
  private stream: SttStreamHandle | null = null;
  private streamOpening: Promise<void> | null = null;
  /** Audio captured before `createStream()` resolved. */
  private streamBacklog: Float32Array[] = [];
  private streaming = false;
  /**
   * Which stream incarnation is current. A pause closes the stream and a
   * resume opens a new one, so a late callback from the closed one must be
   * ignored rather than written into the composer.
   */
  private streamGeneration = 0;
  /**
   * Set while a pause-triggered flush is in flight. The `paused` guard on the
   * callbacks would otherwise swallow the very transcript the flush exists to
   * deliver.
   */
  private flushing = false;
  /** Serializes open/close so overlapping pause+resume cannot leave two streams. */
  private streamOp: Promise<void> = Promise.resolve();

  constructor(
    private readonly engine: ISpeechToTextEngine,
    private readonly cb: SttSessionCallbacks,
    private readonly logger?: ILogger,
    vadOptions?: EnergyVadOptions,
    /**
     * Phase 2 — optional cleanup pass (filler-word removal, spoken
     * punctuation, or an LLM rewrite; see ITextFormatter.ts). Applied ONLY
     * to a committed segment/final transcript, never to the live interim
     * preview — see that port's file header for why.
     */
    private readonly formatter?: ITextFormatter,
    /**
     * Segmentation strategy. Appended LAST so every existing positional
     * caller keeps working. Defaults to the RMS detector, so nothing that
     * constructs a runner directly (tests, embedded callers) has to know a
     * neural VAD exists; production injects `SileroVad` — see
     * VoiceActivityDetector.ts.
     */
    vad?: VoiceActivityDetector,
  ) {
    this.vad = vad ?? new EnergyVad(vadOptions);
  }

  /**
   * Configure the session and warm the model.
   *
   * `interim: false` suppresses the live preview passes entirely. That is not
   * only a saving for the client that doesn't render one: every interim pass
   * goes through the SAME serialization queue as the segment finalizations
   * (see the file header), so on an engine chosen for accuracy rather than
   * raw speed, a preview nobody displays directly delays the committed text
   * the user is actually waiting for.
   */
  start(language?: string, options?: { interim?: boolean }): void {
    this.language = language;
    if (options?.interim === false) this.interimEnabled = false;

    if (typeof this.engine.createStream === 'function') {
      this.streaming = true;
      this.streamOpening = this.openStream().catch((err) => {
        // Falling back is better than failing: the batch path below still
        // produces text, just in blocks rather than word by word.
        this.streaming = false;
        this.stream = null;
        const why = (err as Error).message;
        if (why === STT_STREAMING_UNSUPPORTED) {
          // Expected on every batch engine; not worth a warning per session.
          this.logger?.debug?.('[stt] engine has no streaming decoder; using segmented transcription');
        } else {
          this.logger?.warn?.(`[stt] live streaming failed to start (${why}); using segmented transcription instead`);
        }
      });
      return;
    }

    // Kick off model load so the first interim isn't blocked on download.
    void this.engine.load().catch((err) => {
      this.cb.onError((err as Error).message);
    });
  }

  private async openStream(): Promise<void> {
    const gen = ++this.streamGeneration;

    const current = (): boolean => gen === this.streamGeneration && !this.stopped;

    const handle = await this.engine.createStream!(
      {
        // Partials are the whole point of this path, but a client that asked
        // not to receive them still should not.
        onPartial: (text) => {
          if (!current() || this.paused || !this.interimEnabled) return;
          const shown = this.formatInterim(text);
          if (shown === this.lastInterim) return;
          this.lastInterim = shown;
          this.cb.onInterim(shown);
        },
        // Each completed utterance is a segment; the client inserts it and
        // the next one starts fresh. `stop()` emits onFinal separately.
        onFinal: (text) => {
          // `flushing` deliberately overrides `paused`: a pause flushes the
          // open utterance precisely so it gets committed, and dropping it
          // here is what used to leave raw, unformatted partial text stranded
          // in the composer.
          if (!current() || (this.paused && !this.flushing)) return;
          this.lastInterim = '';
          void this.applyFormatter(text).then((formatted) => {
            if (formatted) this.cb.onSegment(formatted);
          });
        },
        onError: (message) => { if (current()) this.cb.onError(message); },
      },
      ...(this.language ? [{ language: this.language }] : []),
    );
    if (!current()) {
      handle.cancel();
      return;
    }
    this.stream = handle;
    for (const chunk of this.streamBacklog.splice(0)) handle.pushAudio(chunk);
  }

  /** Append a chunk of 16 kHz mono Float32 PCM. No-op while stopped or paused. */
  pushAudio(pcm: Float32Array): void {
    if (this.stopped || this.paused) return;

    if (this.streaming) {
      // No accumulator, no VAD, no segment cap: the engine consumes audio as
      // fast as it arrives and decides for itself where utterances end.
      if (this.stream) this.stream.pushAudio(pcm);
      else this.streamBacklog.push(new Float32Array(pcm));
      return;
    }

    if (this.totalSamples >= MAX_SEGMENT_SAMPLES) {
      if (!this.capWarned) {
        this.capWarned = true;
        this.logger?.warn?.(
          `[stt] segment hit the ${MAX_SEGMENT_SAMPLES} sample safety cap without a silence gap — ` +
            'further audio in this segment is being dropped until stop()/pause() or a VAD trigger clears it.',
        );
      }
      return;
    }
    // This check only looked at state BEFORE this call, so a single chunk
    // LARGER than the remaining budget could still sail straight past the
    // cap in one shot — exactly what happens when a client sends an entire
    // long recording as ONE binary frame (mobile's `useVoiceInput.ts`
    // batch-upload shape) rather than small streaming chunks (the web
    // client's shape, which this cap was originally sized against).
    // Truncating to fit keeps the same safety-cap contract regardless of
    // how the audio arrives, instead of silently accepting an unbounded
    // single push.
    const remaining = MAX_SEGMENT_SAMPLES - this.totalSamples;
    const chunk = pcm.length > remaining ? pcm.subarray(0, remaining) : pcm;
    if (chunk.length < pcm.length && !this.capWarned) {
      this.capWarned = true;
      this.logger?.warn?.(
        `[stt] a single push exceeded the ${MAX_SEGMENT_SAMPLES} sample safety cap — ` +
          'it was truncated to fit; the remainder was dropped.',
      );
    }
    this.chunks.push(chunk);
    this.totalSamples += chunk.length;

    const trailingSilentSamples = this.vad.pushChunk(chunk);
    if (trailingSilentSamples > 0) {
      // Sustained silence — the open segment is complete. Snapshot + reset
      // SYNCHRONOUSLY (see file header) then enqueue the actual transcribe
      // call — never skipped/coalesced, unlike interim passes.
      const speechSamples = Math.max(0, this.totalSamples - trailingSilentSamples);
      const segment = this.merged(speechSamples);
      this.resetOpenSegment();
      void this.enqueue(() => this.doFinalizeSegment(segment));
      return;
    }
    this.scheduleInterim();
  }

  /**
   * Suspend audio consumption WITHOUT disposing the engine (Part C.3). Any
   * not-yet-finalized audio in the current open segment is discarded — it
   * was never committed to the client, consistent with C.2 ("live/interim
   * text never becomes part of the real editable buffer").
   */
  pause(): void {
    if (this.stopped) return;
    this.paused = true;
    if (this.streaming) {
      // CLOSE the stream, do not merely stop feeding it.
      //
      // The engine detects end-of-utterance from SILENCE IN THE AUDIO, and a
      // pause sends no audio at all — so it never finalizes, and its decoder
      // keeps the utterance-so-far buffered. When the user spoke again, the
      // new words were appended to that stale buffer and the whole thing was
      // re-emitted, pasting the previous sentence in after whatever they had
      // just typed:
      //
      //   "…about the project timeline NOTE so I wanted to talk about the
      //    project timeline. we need to finish…"
      //
      // Flushing commits what was actually said (formatted, so its filler
      // words are stripped like any other segment) and leaves nothing behind
      // for the next utterance to inherit.
      this.lastInterim = '';
      const handle = this.stream;
      this.stream = null;
      this.streamBacklog = [];
      if (handle) {
        this.flushing = true;
        this.streamOp = this.streamOp
          .then(() => handle.finish())
          .catch(() => undefined)
          .finally(() => { this.flushing = false; });
      }
      return;
    }
    if (this.interimTimer) {
      clearTimeout(this.interimTimer);
      this.interimTimer = null;
    }
    this.pendingInterim = false;
    this.resetOpenSegment();
    this.vad.reset();
  }

  /** Resume the SAME session — no reload, no re-negotiation. */
  resume(): void {
    if (this.stopped) return;
    this.paused = false;
    if (this.streaming && !this.stream) {
      // Queued behind the pause's flush so the two cannot interleave; the
      // model is already warm server-side, so this is just a socket.
      this.streamOpening = this.streamOp = this.streamOp
        .then(() => (this.stopped || this.stream ? undefined : this.openStream()))
        .catch((err: unknown) => {
          this.streaming = false;
          this.stream = null;
          this.logger?.warn?.(`[stt] could not resume live streaming (${(err as Error).message})`);
        });
    }
  }

  private scheduleInterim(): void {
    if (!this.interimEnabled) return;
    if (this.interimTimer) return;
    this.interimTimer = setTimeout(() => {
      this.interimTimer = null;
      this.triggerInterim();
    }, INTERIM_DEBOUNCE_MS);
  }

  private triggerInterim(): void {
    if (this.stopped || this.paused) return;
    if (this.totalSamples < MIN_INTERIM_SAMPLES) return;
    if (this.busy) {
      // A transcribe() call (a prior interim, or a segment finalize that
      // raced ahead of this debounce tick) is already queued/running.
      // Don't pile up another one behind it — just remember to run one
      // more pass once the queue drains, same as the original design's
      // `pendingInterim` coalescing.
      this.pendingInterim = true;
      return;
    }
    // Snapshot synchronously (this is a non-destructive peek — interim
    // passes never reset the accumulator, only a segment boundary or
    // stop() does), bounded to the trailing window so the cost of a preview
    // does not grow with how long the user has been talking.
    const pcm = this.mergedTail(INTERIM_WINDOW_SAMPLES);
    void this.enqueue(() => this.doInterim(pcm));
  }

  private async doInterim(pcm: Float32Array): Promise<void> {
    if (this.stopped || this.paused) return;
    try {
      const { text } = await this.engine.transcribe(pcm, { language: this.language });
      if (!this.stopped && !this.paused && text && text !== this.lastInterim) {
        this.lastInterim = text;
        this.cb.onInterim(text);
      }
    } catch (err) {
      this.logger?.warn?.(`[stt] interim transcribe failed: ${(err as Error).message}`);
    } finally {
      if (this.pendingInterim && !this.stopped && !this.paused) {
        this.pendingInterim = false;
        this.scheduleInterim();
      }
    }
  }

  private async doFinalizeSegment(segment: Float32Array): Promise<void> {
    if (segment.length === 0) return;
    try {
      const { text } = await this.engine.transcribe(segment, { language: this.language });
      if (!this.stopped && !this.paused && text) {
        this.cb.onSegment(await this.applyFormatter(text));
      }
    } catch (err) {
      this.cb.onError((err as Error).message);
    }
  }

  /**
   * The interim-safe subset of the cleanup pass, for live partials.
   *
   * Without this the composer showed every filler the model transcribed and
   * only tidied them when the segment eventually committed — which on a long
   * unbroken utterance is a very long time to sit looking at "and then um,".
   * Formatters that cannot do this synchronously and idempotently omit the
   * method, and their partials pass through untouched.
   */
  private formatInterim(text: string): string {
    const fn = this.formatter?.formatInterim;
    if (!fn) return text;
    try {
      return fn.call(this.formatter, text, { language: this.language }) || text;
    } catch {
      return text;
    }
  }

  /**
   * Phase 2 cleanup pass — applied ONLY here and in stop()'s final pass,
   * never to a live interim preview (see ITextFormatter.ts's file header).
   * `ITextFormatter` implementations must never throw, but this guard
   * exists anyway so a future implementation that doesn't honor that
   * contract degrades to "no formatting" instead of losing the segment.
   */
  private async applyFormatter(text: string): Promise<string> {
    if (!this.formatter) return text;
    try {
      return await this.formatter.format(text, { language: this.language });
    } catch (err) {
      this.logger?.warn?.(`[stt] text formatter (${this.formatter.name}) failed: ${(err as Error).message}`);
      return text;
    }
  }

  /** Finalise: flush any open segment and emit it as the final transcript. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.streaming) {
      // Every utterance already reached the client as a segment, so the final
      // frame carries nothing new — it exists to close the session. Emitting
      // the last utterance again here would duplicate it in the composer.
      await this.streamOp.catch(() => undefined);
      await this.streamOpening?.catch(() => undefined);
      const handle = this.stream;
      this.stream = null;
      this.streamBacklog = [];
      // `stopped` is already true, which gates onPartial/onFinal above, so
      // let the flush through explicitly rather than suppressing it.
      this.stopped = false;
      try {
        await handle?.finish();
      } finally {
        this.stopped = true;
      }
      this.cb.onFinal('');
      return;
    }

    if (this.interimTimer) {
      clearTimeout(this.interimTimer);
      this.interimTimer = null;
    }
    this.pendingInterim = false;

    // Snapshot + reset synchronously, same reasoning as the VAD-triggered
    // path — `this.stopped` is already true above, so no further
    // pushAudio() can add anything after this point.
    const segment = this.merged();
    this.resetOpenSegment();

    await this.enqueue(async () => {
      if (segment.length === 0) {
        this.cb.onFinal('');
        return;
      }
      try {
        const { text } = await this.engine.transcribe(segment, { language: this.language });
        this.cb.onFinal(await this.applyFormatter(text));
      } catch (err) {
        this.cb.onError((err as Error).message);
      }
    });
  }

  /** Discard everything without emitting a final transcript. */
  cancel(): void {
    this.stopped = true;
    if (this.streaming) {
      this.stream?.cancel();
      this.stream = null;
      this.streamBacklog = [];
    }
    if (this.interimTimer) {
      clearTimeout(this.interimTimer);
      this.interimTimer = null;
    }
    this.resetOpenSegment();
  }

  // ── Internal ──────────────────────────────────────────────────

  /**
   * Enqueue one `engine`-calling operation, guaranteeing it never overlaps
   * with any other enqueued operation regardless of how long either takes.
   * Each `fn` is responsible for handling its own errors (they all already
   * wrap their `engine.transcribe()` call in try/catch and report via
   * `cb.onError`), so this never needs to propagate a rejection.
   */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.busy = true;
    const next = this.queue.then(fn, fn).finally(() => {
      // Only the tail of the chain clears `busy` — if something newer was
      // enqueued while this one ran, `this.queue` already points past it.
      if (this.queue === next) this.busy = false;
    });
    this.queue = next;
    return next;
  }

  /**
   * Concatenate the accumulated chunks. `capSamples`, when given, truncates
   * the result to only the first N samples — used to drop trailing silence
   * that only existed to trip the VAD, never to trim from the FRONT.
   */
  private merged(capSamples?: number): Float32Array {
    const total = capSamples !== undefined ? Math.min(capSamples, this.totalSamples) : this.totalSamples;
    const out = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      if (offset >= total) break;
      const take = Math.min(c.length, total - offset);
      out.set(c.subarray(0, take), offset);
      offset += take;
    }
    return out;
  }

  /**
   * The NEWEST `maxSamples` of the open segment. Counterpart to `merged()`,
   * which takes from the front: a preview wants the most recent audio, a
   * committed segment wants all of it.
   */
  private mergedTail(maxSamples: number): Float32Array {
    if (this.totalSamples <= maxSamples) return this.merged();
    const out = new Float32Array(maxSamples);
    // Walk backwards so a long accumulator costs only the chunks we keep.
    let needed = maxSamples;
    let writeAt = maxSamples;
    for (let i = this.chunks.length - 1; i >= 0 && needed > 0; i -= 1) {
      const chunk = this.chunks[i]!;
      const take = Math.min(chunk.length, needed);
      writeAt -= take;
      out.set(chunk.subarray(chunk.length - take), writeAt);
      needed -= take;
    }
    return out;
  }

  private resetOpenSegment(): void {
    this.chunks = [];
    this.totalSamples = 0;
    this.lastInterim = '';
    this.capWarned = false;
  }
}
