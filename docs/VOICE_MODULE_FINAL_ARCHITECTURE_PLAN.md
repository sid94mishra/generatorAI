# Voice Module — Final Architecture & Implementation Plan

**Status: implemented.** Parts B–E below (STT segmentation/pause-resume, transcript cleanup, TTS foundation, and live speak-while-streaming) are all built, each independently reviewed and fixed, with a final cross-phase end-to-end review completed on top. This document is kept as the design record — read it for *why*, and read the code (linked throughout) for the current *what*, since implementation details (model substitutions made for environment/library constraints, exact file names) may have moved on from what's described below. Uncommitted on `arch-redesign` pending the user's own review.

**Relationship to prior work:** this document supersedes and consolidates `docs/VOICE_AGENT_REALTIME_STT_PLAN.md` into one definitive design. That earlier document remains as the supporting research trail (web research citations, model benchmarks, competitive survey, section-by-section revision history) — this document is the thing to review and approve; cross-references back to it are marked `[research →]`.

**What's genuinely new in this pass, beyond consolidation:** a concrete design for the "pause mid-dictation, make a manual correction, resume" interaction, which none of the prior passes addressed — that gap is closed in Part C below.

---

## Part A — Current architecture, re-verified against the live codebase (not assumed from memory)

Before designing anything new, the working tree was re-checked directly (not from recollection): `git status`/`git diff --stat` confirm **zero uncommitted changes to any STT/voice-related file** since the deep-dive that produced the file:line evidence below — that evidence is still an accurate description of the code running today. Two architectural precedents this plan depends on (`BrowserService.ts`, `TerminalService.ts`) were re-confirmed present and structurally intact (a 10-line unrelated diff on `BrowserService.ts`, not a rewrite).

### A.1 Core layering (unchanged, restated for grounding)

GeneratorAI is Hexagonal/Ports-and-Adapters with a DDD core: **Presentation** (`apps/web`, `apps/cli`, `apps/server/routes`) → **Application** (`packages/core/src/services`) → **Domain** (`packages/core/src/domain/ports`, pure TypeScript, zero deps) → **Infrastructure** (concrete adapters implementing those ports). The rule that matters most for this plan: *"Every service talks to [a port]; SDKs only ever appear inside the adapter package"* — `IAgentHarness` is the canonical example. This plan's whole design is "do the same thing, for voice, that's already done for the agent harness, the browser, and the terminal."

### A.2 The established pattern this plan builds on: workspace-scoped, model/process-backed capability services

Two existing services are the direct architectural precedent for the new Voice Module, confirmed present in the current tree:

- **`BrowserService`** — owns a `Map<workspaceId, SessionRecord>` of Chromium sessions behind the `IBrowserBridge` port, enforces a configurable concurrency cap (`GENERATORAI_BROWSER_MAX_CONCURRENT`), LRU-evicts when the cap is hit.
- **`TerminalService`** — owns an ephemeral `Map<sid, TerminalRecord>` of PTY sessions behind the `ITerminalHost` port, with per-workspace and global concurrency caps, an idle reaper, and hooks into workspace deletion for cleanup.

Both are: session-scoped, backed by a native process/model resource, capacity-capped, and cleaned up on idle or deletion. **Voice I/O is the same shape of problem** — this plan's `VoiceService` (Part B) is a third instance of this exact pattern, not a new architectural style.

### A.3 The current STT implementation, traced end-to-end — restated precisely, root causes intact

```
Web/Desktop: getUserMedia (16kHz) → AudioWorklet (~128ms chunks) → binary WS frames
   → apps/server/src/stt-ws.ts → SttSession → WhisperSttEngine (local, CPU, base.en)
   → { interim | final } JSON frames → chat composer textarea

Mobile: hold → expo-audio records to a WAV FILE (no live sample callback)
   → release → whole file sent as ONE frame → same pipeline → single { final } frame
```

**Confirmed root causes, unchanged since the last review (all file:line-verified):**

1. **`SttSession.ts`** re-transcribes the *entire* accumulated audio buffer from sample zero on every 900ms tick (`runInterim()` calls `engine.transcribe(this.merged(), ...)`, where `merged()` concatenates every chunk since recording started) — not an incremental decode. Cost grows with utterance length; this is the direct cause of "very bad real-time performance."
2. **`WhisperSttEngine.ts`**'s entire post-processing step is `text.replace(/\s+/g, ' ').trim()` — zero punctuation model, zero filler-word removal, zero structure inference. This is the direct cause of "flat dictation, no punctuation/intent."
3. Each interim pass independently re-decides the *entire* transcript from scratch, so already-emitted words can visibly change between updates — a distinct, more specific defect than "slow."
4. **No pause/resume concept exists at all** — the protocol only has `start`/`stop`/`cancel`. There is no way today to suspend a session (keep the model warm, stop consuming audio) and cleanly resume it — every "stop" tears the session down; every "start" is a fresh session. This matters directly for Part C's new requirement.
5. **Zero TTS capability exists anywhere in the codebase** — confirmed by the same file-by-file trace; there is no `ITts*` port, no TTS route, no TTS client hook, nothing. This is a from-scratch addition, not an extension of existing code.
6. Mobile has no live/streaming behavior at all today — pure record-then-send-once batch dictation, by explicit documented design (`expo-audio` has no live sample callback).

`[research →]` full evidence, line numbers, and the industry comparison (OpenAI Realtime, Deepgram, AssemblyAI, Wispr Flow/Superwhisper, FluidVoice's actual source) that grounds every design choice below.

---

## Part B — The pluggable Voice Module: final design

### B.1 Two ports, not three — "speech-to-speech" is a composition, not a new primitive

The request describes three capabilities: speech→text, speech→speech, and text→speech. **The module should expose exactly two engine ports — `ISpeechToTextEngine` and `ITextToSpeechEngine` — because "speech→speech" is not a third kind of model to plug in; it's what you get by running the first port, then the existing agent/chat turn cycle, then the second port, in sequence.** GeneratorAI already has the middle piece (the agent turn) fully built. Treating "voice conversation with the agent" as a *pipeline composition* of two existing-shaped primitives, rather than inventing a third "speech-to-speech" engine abstraction, is the more defensible design for three concrete reasons:

1. There is no real model category that natively does "arbitrary speech in → arbitrary different speech out" for this use case *other than* chaining STT → LLM → TTS (the true single-model full-duplex systems, like Kyutai's Moshi, are voice-*cloning*/conversational-*prosody* models, not "answer my question" agents — `[research →]` §7.2's finding that unified bidirectional models don't fit this product's actual need).
2. A third port would duplicate logic the first two already have to get right (audio capture/streaming, session lifecycle, buffering) for no capability gain.
3. It keeps the module honestly scoped to what it actually is: an I/O adapter pair for the two ends of the existing conversation, not a new conversational engine.

### B.2 Port shapes

```typescript
// packages/core/src/domain/ports/ISpeechToTextEngine.ts
// (generalizes the existing ISttEngine — same contract, same seam, new implementations behind it)
export interface ISpeechToTextEngine {
  readonly name: string;
  load(): Promise<void>;
  transcribe(pcm: Float32Array, options?: SttTranscribeOptions): Promise<SttTranscribeResult>;
  dispose(): Promise<void>;
}

// packages/core/src/domain/ports/ITextToSpeechEngine.ts  (NEW)
export interface ITextToSpeechEngine {
  readonly name: string;
  load(): Promise<void>;
  /** Streams audio as it's synthesized — callers never block on the whole utterance. */
  synthesize(text: string, opts?: TtsSynthesizeOptions): AsyncIterable<Float32Array>;
  dispose(): Promise<void>;
}
```

No SDK/vendor type ever crosses these ports — exactly the same discipline already enforced for `IAgentHarness`.

### B.3 `VoiceService` — the orchestrator, following the `BrowserService`/`TerminalService` pattern exactly

```typescript
class VoiceService {
  // STT half — what the chat composer calls today.
  async startSttSession(workspaceId: string, opts: SttSessionOptions): Promise<SttSessionHandle>;
  async pauseSttSession(sessionId: string): Promise<void>;   // NEW — see Part C
  async resumeSttSession(sessionId: string): Promise<void>;  // NEW — see Part C

  // TTS half — nothing calls this yet; the seam exists so nothing later needs a redesign.
  async speak(workspaceId: string, text: string | AsyncIterable<string>, opts?: SpeakOptions): Promise<SpeechHandle>;
}
```

Session state lives in a `Map<sessionId, VoiceSessionRecord>`, capacity-capped and idle-reaped, identically in spirit to `BrowserService`'s `Map<workspaceId, SessionRecord>` and `TerminalService`'s `Map<sid, TerminalRecord>`. `speak()`'s signature already accepts a text *stream*, not just a finished string — that's what lets a future "agent speaks while it's still generating" feature attach to the existing `harness.token` EventBus stream later without changing this API (`[research →]` §12.3).

### B.4 Models — finalized

| Direction | Engine | Why |
|---|---|---|
| STT, live/streaming path | **`nvidia/parakeet_realtime_eou_120m-v1`** (120M params, ONNX INT8) | Native streaming, **end-of-utterance detection built into the model** (emits an `<EOU>` token — no separate VAD component needed), 80–160ms latency. Benchmarked at RTF ≈0.033–0.05 on an ordinary Intel i7 (20–30× faster than real-time) — comfortably fits a 16GB Windows laptop on CPU alone, no GPU required. |
| STT, optional accuracy pass | **`parakeet-tdt-0.6b-v3`** (ONNX INT8) | 6.32% WER, beats Whisper large-v3's 7.44%; same CPU-viability profile. Optional — run only if the 120M model's accuracy isn't sufficient for a given segment. |
| TTS (Phase 3, minimal) | **Kokoro-82M** | Apache 2.0, ONNX export (plugs into the same `onnxruntime-node` runtime already in the stack), best quality-for-size on CPU with no GPU requirement among reviewed options. |

Both STT variants plug into the existing `onnxruntime-node` dependency (already present via the current Whisper engine) — no new native runtime for STT. Kokoro likewise. `[research →]` §10 and §7 for the full benchmark citations and license notes.

### B.5 End-to-end flow diagram

```
STT (built now):
  Mic → capture (unchanged) → VoiceService.startSttSession()
     → ISpeechToTextEngine = Parakeet-EOU-120M (native streaming + endpointing)
          → live partial (never enters the real textarea value — see Part C.2)
          → on <EOU>: segment complete → optional TDT-0.6B accuracy pass
     → ITextFormatter (rule-based default / opt-in LLM through the encrypted secrets
        vault — [research →] §4.3, §9.2) → cleaned segment text
     → inserted at the composer's current caret position (Part C.1)

TTS (designed now, minimal build, full build deferred):
  Agent turn streams via the EXISTING harness.token EventBus (no new plumbing)
     → (only when speak() has been invoked for that session) sentence-boundary buffer
     → VoiceService.speak() → ITextToSpeechEngine = Kokoro
     → audio chunks streamed to client, played as they arrive
```

---

## Part C — Pause, correct, resume: the new design work this round requires

### C.1 The problem, stated precisely

Today's design (and every competitor reviewed) assumes dictation only ever *appends*. The actual requirement: the user is dictating, notices something wrong, **manually edits the text** (not by voice — by clicking in and typing/deleting), and then **resumes speaking**, expecting new speech to continue naturally from wherever they left off — without the system fighting the edit, duplicating text, or inserting new words in the wrong place.

### C.2 The key design decision: insert-at-caret, and live text never touches the real editable buffer

Two changes to the original design remove almost all of this problem's difficulty, rather than requiring a complex merge/reconciliation algorithm:

1. **Finalized (cleaned) STT segments are inserted at the textarea's current caret position — standard text-insertion semantics — not appended to a separately-tracked `confirmedText` buffer.** This is exactly how native OS dictation (Windows Speech Recognition, macOS Dictation) already behaves: text lands wherever the cursor is. If the user clicks elsewhere in the message and starts typing, the caret moves there — and when dictation resumes, new speech naturally inserts at that same point, because that's just where the caret is. No separate "which buffer am I appending to" bookkeeping is needed; the browser's own caret *is* the source of truth.
2. **Live/interim (not-yet-finalized) text never becomes part of the textarea's real, editable value.** The earlier design's "`confirmedText + ' ' + liveText`, both shown inline" is revised: interim text is rendered as a visually distinct, non-editable affordance (dimmed/italic trailing preview, or shown in the recording pill next to the waveform — not mixed into the actual edit buffer). Only a fully finalized, formatted segment ever gets inserted into the real value. **This is the change that removes the hard case entirely** — there is never any uncommitted, still-forming STT text sitting inside the editable buffer for a manual edit to collide with, because nothing uncommitted is ever put there in the first place. This mirrors how IME composition previews and modern voice-typing UIs (Google Docs voice typing shows a distinct "listening" state, not a live-mutating in-place string) already avoid exactly this class of bug.

### C.3 Pause vs. stop — a protocol change that directly protects the latency goal

Today, `stt-ws.ts` only has `start`/`stop`/`cancel`. Tearing a session down and starting a new one on every correction would **re-pay the model warm-up cost every time the user makes a correction** — directly working against the latency requirement this whole plan exists to fix. **Add a `pause`/`resume` message pair**, additive and backward-compatible with the existing control-frame shape:

```
{ t: 'pause' }   — client stops sending audio frames; server suspends the session
                   (keeps the loaded model warm, does not tear anything down)
{ t: 'resume' }  — client resumes sending audio frames; server continues the
                   SAME session (no re-negotiation, no reload)
```

Client-side trigger for `pause`: **any manual interaction with the composer while a dictation session is active** — a keydown, paste, or selection-changing click. This is detected automatically; the user doesn't have to remember to press anything to "tell" the system they're about to correct something — the act of clicking/typing into the field *is* the pause trigger. Any in-flight, not-yet-finalized live/interim text at the moment of pause is simply discarded (never inserted — consistent with C.2, since it was never committed anyway).

**Resume is an explicit user action** (click the mic control again — the same control, now showing a distinct "paused" visual state) — deliberately not an ambient "detect they started talking again" auto-resume. Every real product reviewed (Codex, Claude Code) uses explicit push-to-talk rather than ambient always-listening precisely because auto-resume-on-detected-speech is a substantially harder and more error-prone problem than this scope calls for, and an explicit control keeps the interaction predictable — the user always knows, by looking at one button, whether they're being listened to right now.

### C.4 State machine

```
idle ──(user clicks mic)──▶ listening
listening ──(manual composer interaction detected)──▶ paused
paused ──(user clicks mic again)──▶ listening   [resumes SAME session, no reload]
listening ──(user clicks stop)──▶ finalizing ──▶ idle
paused ──(user clicks stop)──▶ finalizing ──▶ idle
```

`paused` is a genuinely new state — it did not exist before this plan. Its entire purpose is to let the correction happen without the system racing against it or discarding session/model warm-state.

### C.5 What this does *not* attempt to solve (explicitly out of scope, and why that's the right call)

- **Voice-driven correction** ("scratch that," "undo the last sentence") is not designed here — the request specifically describes a *manual* (typed) correction, and voice-command-based editing is a distinct, harder feature (needs its own command-grammar recognition layered on top of dictation) that would dilute this round's actual ask if bundled in.
- **Merging concurrent speech and typing** (user keeps talking while also typing) is intentionally not supported — pause is immediate and total the moment a manual interaction is detected, which is a simpler and more predictable contract than trying to interleave two live input sources into one buffer.

---

## Part D — Performance budget (consolidated, concrete targets)

| Stage | Target | Basis |
|---|---|---|
| Live partial text latency (word appears after being spoken) | ≤200ms | Parakeet-EOU-120M's own published 80–160ms model latency + minor pipeline overhead |
| Segment finalization (silence → cleaned text committed) | ≤500ms for a typical short utterance | EOU-120M's native endpoint detection removes the old debounce-timer delay entirely; formatter pass (§4.3) adds a small, bounded rule-based or single-shot-LLM cost |
| Pause → resume round trip | Near-instant, no model reload | Direct payoff of the `pause`/`resume` protocol addition in C.3 — this is the specific number that would regress badly without that change |
| CPU/RAM footprint (STT only, on the reference 16GB Windows laptop) | ~640MB disk, low single-digit GB RAM during inference | Parakeet TDT 0.6B INT8 ONNX benchmark data — `[research →]` §10 |

The single biggest lever against the original "very bad real-time performance" complaint is not any one of these numbers alone — it's the combination of (a) native endpointing removing the old full-buffer-re-transcription-on-a-timer pattern entirely, and (b) the pause/resume protocol change preventing corrections from re-paying startup cost. Both are structural fixes, not tuning.

---

## Part E — Final phased plan

**Phase 0 — Core seam, zero user-visible change.**
Define `ISpeechToTextEngine`/`ITextToSpeechEngine`, stand up `VoiceService` (mirroring `BrowserService`/`TerminalService`), migrate the existing Whisper engine behind the renamed port with no behavior change. Pure risk-reduction — proves the seam before any model swap.

**Phase 1 — STT model swap + native endpointing + pause/resume + insert-at-caret. (This is the phase that fixes every complaint in the original request.)**
- Implement `ParakeetSttEngine` (EOU-120M live path, optional TDT-0.6B-v3 accuracy pass); remove the old debounce-timer/full-buffer-retranscription logic entirely (superseded by native endpointing).
- Add the `pause`/`resume` control frames to the WS protocol (C.3).
- Change the composer's text-insertion model to insert-at-caret and move live/interim text out of the real editable buffer entirely (C.2).
- Wire the "manual interaction while listening → auto-pause" detection (C.3/C.4).
- Keep Whisper registered as a fallback engine, not removed.

**Phase 2 — Text formatting: filler words, punctuation, structure.**
Rule-based local default (filler-word removal, deterministic punctuation-command handling in the style FluidVoice's own open-source code uses — `[research →]` §7.6b) + optional BYOK LLM cleanup pass, stored through the encrypted secrets vault from day one (not a new plaintext credential column — direct callback to the security review's standing P0-2 finding).

**Phase 3 — TTS foundation ("bear the implementation, don't require it in production yet").**
`ITextToSpeechEngine` + Kokoro implementation + `VoiceService.speak()` wired to exactly one low-risk caller — a manual "read this message aloud" button on a completed message. Proves the entire chain (port → service → engine → audio playback) end-to-end without touching live speak-while-streaming complexity.

**Phase 4 — Live speak-while-streaming (explicitly deferred, not required this round).**
Sentence-boundary `EventBus` subscriber (attaches only when `speak()` has been invoked in streaming mode for that session — never an always-on tax), pipelined synthesis overlapped with continued generation, eventual barge-in/interruption handling. This is what turns "read a finished message aloud" into "the agent talks while it works" — matching what OpenAI's Codex Realtime V3 already ships in production (`[research →]` §11) — sequenced last because it is the only phase with genuinely new turn-taking complexity, and because the request itself explicitly scopes this as forward-looking rather than blocking.

Phases 0–3 can be scoped and estimated independently of Phase 4 — that separation exists specifically because `speak()`'s signature was designed to accept a text stream from Phase 0 onward, so Phase 4 is a pure addition to an already-correct interface, not a redesign of it.

---

## Part F — Reconciliation: what the build actually found (added after implementation)

Everything above is preserved as the original design record. This section records where **reality diverged from the plan**, established by querying the live Hugging Face Hub, reading the installed library source, and running the models and the server end to end. Where the two disagree, this section is right and Parts B/D above are wrong.

### F.1 The model table in B.4 was partly unbuildable

| Plan said | What is actually true | Consequence |
|---|---|---|
| STT live path: `nvidia/parakeet_realtime_eou_120m-v1` **"(120M params, ONNX INT8)"** | Repo exists, but its **entire** file list is `parakeet_realtime_eou_120m-v1.nemo`, a README and two images. `library_name: nemo`. **No ONNX export, no `config.json`.** | Not loadable by transformers.js at any quantization. The "native EOU token, no separate VAD needed" premise of B.4/B.5/D is therefore unavailable. Substituted: `onnx-community/parakeet-ctc-0.6b-ONNX` (Hub-verified, `model_type: parakeet_ctc`, which the installed transformers.js v3.8.1 **does** implement) plus `EnergyVad` for endpointing. |
| STT accuracy pass: `parakeet-tdt-0.6b-v3` "(ONNX INT8)" | `nvidia/parakeet-tdt-0.6b-v3` publishes **no ONNX export**, and its `model_type` is `parakeet_tdt` (`ParakeetForTDT`), which transformers.js v3.8.1 does not implement — only `parakeet_ctc` is in its CTC map. | **Not implemented**, deliberately rather than silently. |
| TTS: **Kokoro-82M** | Correct. `onnx-community/Kokoro-82M-v1.0-ONNX` verified on the Hub and executed locally end to end. | Built — but *not* the way the plan implied (see F.2). |

Both surviving models are pinned to **`q8` (INT8)**, which B.4 asked for and no earlier code actually set: transformers.js defaults to fp32 in Node, which would have pulled **2.4 GB** for Parakeet instead of 611 MB, blowing Part D's disk budget nearly 4×.

### F.2 Kokoro could not be driven through transformers.js at all

`pipeline('text-to-speech', 'onnx-community/Kokoro-82M-v1.0-ONNX')` throws `Unsupported model type: style_text_to_speech_2` — Kokoro's architecture is not in either model map that pipeline resolves against, its tokenizer is phoneme-level (needs G2P first), and the pipeline has no `voice` option to select a style vector. The first implementation did exactly this and was therefore **completely non-functional**, while its unit tests passed because they mocked the very call that always throws. Rebuilt on `kokoro-js`, which closes all three gaps. See `KokoroTtsEngine.ts`.

### F.3 The load-bearing performance finding: ONNX inference blocks the event loop

`onnxruntime-node` 1.21.0 returns a Promise from `session.run()` but executes **synchronously on the calling thread**. Measured with raw ORT and no transformers.js in the path: a 12404 ms run blocked the loop for 12354 ms.

On the main thread that is not a slow path, it is an outage — the server answers nothing for every user for the duration, and `WedgeDetector` (5 s threshold) correctly declares the process wedged and shuts it down. **Reproduced twice end to end: a single "Read aloud" click killed the server.** Fixed by moving inference to a worker thread (`VoiceWorkerPool.ts`); the engines keep all surrounding logic on the main thread.

This is the single most important correction to Part D, which implicitly assumed inference cost was latency only. It is also *throughput and availability*.

### F.4 Part D targets, measured

Reference machine: 16-core Windows laptop, CPU only, both models `q8`, measured through the real WebSocket routes against the running server.

| Part D target | Measured | Verdict |
|---|---|---|
| Live partial ≤200 ms | First interim lands **1.1 s** after audio starts. Parakeet's own RTF is **0.041–0.048** (a 5 s snapshot decodes in ~530 ms), so the model is not the constraint — `SttSessionRunner`'s 900 ms interim debounce is. | **Not met, and not reachable through this design.** The 200 ms figure assumed the EOU model's native streaming, which does not exist in a loadable form (F.1). Lowering the debounce would trade CPU for it. |
| Segment finalization ≤500 ms | **315–774 ms** across runs (stop → `final`), for an 11 s utterance | **Met to borderline** for a typical short utterance. Scales linearly with segment length at RTF ≈0.045. |
| Pause → resume near-instant, no reload | **0–2 ms** round trip | **Met**, comfortably — the clearest win of the whole plan. |
| ~640 MB disk, low single-digit GB RAM | Parakeet q8 **611 MB** + Kokoro q8 **92 MB** = ~703 MB on disk | **Met** (the 640 MB figure counted STT only). |
| *(not in the plan)* TTS time-to-first-audio | **8.5 s → 2.7–4.5 s** after routing the finished-string path through the same sentence-at-a-time loop as the live path | Kokoro's RTF is ≈1.0–1.7, so whole-message synthesis is the wrong unit of work; per-sentence is. |
| *(not in the plan)* Concurrent dictation | Two simultaneous 5 s sessions resolve in **~1.1 s** total | Serialized through the single inference worker; no contention pathology. |

Accuracy, same fixture (JFK clip, 11 s): Parakeet returns the reference transcript, in **lowercase and unpunctuated** — precisely what Phase 2's `ITextFormatter` exists to repair, so the two phases are load-bearing for each other rather than independent.

### F.5 Mobile reached parity, because its blocking premise expired

Both mobile hooks were built on a constraint stated in their own headers: *"`expo-audio` records to a FILE and exposes no sample callback"*, and its mirror, *"no raw-PCM streaming PLAYBACK primitive"*. The first is **no longer true**. `expo-audio` 57 ships `useAudioStream` — native PCM microphone capture with an `onBuffer` callback and `'float32'` encoding. The batch record-then-send design existed only to work around something that has since been fixed upstream, so it was replaced rather than preserved.

| | before | now |
|---|---|---|
| Dictation | hold, release, wait, whole utterance appears | live interim preview, segments commit as you pause |
| Pause/resume (Part C.3) | absent | present — editing the draft auto-pauses |
| Insert-at-caret (Part C.2) | appended to the end of the draft | inserted at the caret, same as web |
| Long dictations | **silently truncated** — the client read only `final` and ignored every `segment`, so everything before the last pause was dropped | every segment committed |
| Read aloud | whole utterance buffered, then played | first sentence plays while the rest synthesizes |
| Speak-while-streaming | not possible | supported |

The second constraint — no PCM playback queue — **is still true**, and it is what shaped the TTS design. Options considered:

1. *Buffer the whole turn, then play.* Defeats the purpose: no audio until the agent finishes.
2. *Fixed-size batches, one file each.* Puts the unavoidable file-boundary gap at an arbitrary point, i.e. mid-word.
3. **Sentence-aligned batches.** Chosen. The server already synthesizes one sentence at a time, so `tts-ws` now emits `{ t: 'sentence' }` immediately before each sentence's audio (`TtsSessionRunner`'s `onSentence` hook). Mobile writes one WAV per sentence and appends it to a native `AudioPlaylist`, which plays them back-to-back off the JS thread.

Option 3 wins because the gap becomes *inaudible*: it lands where a speaker would pause anyway. It also improves the pre-existing Phase 3 "read aloud" on mobile, which no longer waits for the whole message. The marker is additive and ignored by the web client, which keeps scheduling PCM gaplessly through Web Audio.

The one genuinely new mobile hazard is that `useAudioStream` documents that the delivered `sampleRate` "may differ if the hardware cannot deliver it", and reports `channels` per buffer — while the STT endpoint accepts only 16 kHz mono. That mismatch does not throw, it transcribes to nothing (verified: 44.1 kHz audio fed to Parakeet returned an empty string). `apps/mobile/src/voice/pcm.ts` normalises every buffer, downmixing *before* resampling, and is unit-tested directly for that reason. End-to-end, a simulated 48 kHz stereo device capture pushed through that conversion into the live server returns the reference transcript exactly.

### F.6 Open issue: Parakeet corrupts or drops some segments (upstream)

transformers.js logs `Unknown tokenizer class "ParakeetTokenizer", attempting to construct from base class` for this repo, and the fallback decoder is unreliable at some input lengths. Reproduced against the **raw library**, no code from this repo in the path, on prefixes of one clean clip:

```
3.5s → "and so my fellow americans"            ✓
3.9s → "and so my fellow americans askeded"    ✗ duplicated subword
4.0s → ""                                      ✗ empty
4.8s → ""                                      ✗ empty
4.9s → "and so my fellow americans ask not"    ✓
5.2s → ""                                      ✗ empty
```

`EnergyVad` cuts segments at silence — i.e. at arbitrary lengths — so this lands on real dictation: a live session committed `"and so my fellowllow americans"`. Nothing in `SttSessionRunner`, the formatter (which cannot insert text) or the worker is implicated.

**Half of it is now fixed.** Across the same 31-length sweep the failures split 8 empty / 3 corrupt, and an empty segment is the damaging one — it silently deletes what the user said. `ParakeetSttEngine.transcribe()` therefore retries once with 200 ms of appended silence when the first pass returns empty *and* the audio had speech energy. Padding every segment does not help (9 / 8 / 10 bad at 0 / 200 / 500 ms), but no length fails at all three pads, so a small alignment shift reliably clears it. That change is what turned the two previously-failing concurrency checks green.

The remaining corruption (a doubled subword) is left alone deliberately: every heuristic that detects it also matches legitimate English — "that that", "had had" — so acting on it would corrupt good transcripts to cosmetically improve bad ones. It is visible and self-correctable; a silently dropped sentence is not.

**Correction to an earlier claim in this document:** Whisper does *not* avoid "the whole class". Measured on the same sweep it is 6/31 vs Parakeet's 11/31 — but most of Whisper's are not defects at all, just an honest transcription of a word truncated mid-utterance by the arbitrary cut ("ask not" clipped at 3.7 s → "ask me to"), which real silence-aligned segments do not produce. What is genuinely engine-specific is that Whisper never returns empty and never doubles a subword, and that it emits punctuation and capitalisation, which Parakeet does not. Against that, Parakeet is **~4× faster** (411 ms vs 1717 ms per clip), which is what makes Part D's ≤500 ms finalization reachable at all. `auto` therefore still prefers Parakeet; `GENERATORAI_STT_ENGINE=whisper` is a legitimate preference, not merely a fallback.

---

## Part G — Engine factory, and the interim window (added after the plan-vs-code audit)

Two changes that are architecture, not tuning, and therefore belong in this record. The remaining audit items (plan flaws F1–F8, gaps G1–G5) are still open pending review.

### G.1 Model choice is configuration, not code

`VoiceEngineFactory.ts` constructs both engines by id. Nothing in `VoiceService`, `SttSessionRunner`, either WebSocket route, or any client names a model any more; `composition-root.ts` reads an id and asks the factory for it. Adding a better model later is one descriptor plus one constructor entry.

It mirrors `HarnessFactory`/`HarnessRegistry` in `packages/agent-harness-providers` deliberately — that is this codebase's existing answer to "pluggable provider selected by configuration", and voice is the same shape of problem, so it gets the same shape of solution rather than a second convention.

| id | engine | download | cased output | measured avg |
|---|---|---|---|---|
| `parakeet` *(default preference)* | Parakeet CTC 0.6B q8 | 611 MB | **no** | 284 ms |
| `moonshine` | Moonshine Base q8 | 63 MB | yes | 146 ms |
| `whisper` | Whisper base.en fp32 | 140 MB | yes | 1717 ms |
| `auto` *(default)* | preferred, falling back to Whisper | — | — | — |
| `disabled` | no-op engine | — | — | — |

`GENERATORAI_STT_ENGINE` selects; `GENERATORAI_STT_PREFERRED` changes which engine `auto` tries first. An unknown value warns and falls back to `auto` rather than refusing to boot — this is hand-edited configuration.

Descriptors carry `casedOutput` because it is load-bearing and not inferable from a model id: an engine that emits neither capitals nor punctuation cannot have them added back downstream — `RuleBasedTextFormatter` handles *spoken* punctuation commands ("comma"), never inferred sentence structure. Any UI offering this choice has to be able to say so.

### G.2 The interim preview is now windowed

`SttSessionRunner` re-transcribed the whole open segment on every debounce tick, so preview cost grew without limit while the user kept talking. That is the plan's own root cause 1, narrowed by Phase 1 from per-session to per-segment but never bounded.

Interim passes now see only the trailing `GENERATORAI_STT_INTERIM_WINDOW_S` seconds (default 5). **Committed segments are unchanged and still transcribe in full**, so accuracy is untouched. Measured worst single interim pass over a 20 s utterance:

| window | Parakeet | Moonshine base | Whisper base.en |
|---|---|---|---|
| full buffer *(before)* | 789 ms | 690 ms | — |
| 3 s | 266 ms | 174 ms | — |
| 2 s | **136 ms** | 155 ms | — |

At 2 s this reaches Part D's ≤200 ms target on the model already in use — a target Part D had declared reachable only via a model that turned out not to exist. The default is 5 s rather than 2 s because the window is also how much context the preview shows: below ~3 s the preview becomes a short rolling tail on a long utterance. It is one env value to change.

A fixed-length window over a live stream is the standard shape for streaming ASR. The usual companion concern — de-duplicating overlap between consecutive windows — does **not** apply here, because the window feeds a preview that is discarded; nothing is stitched across windows.

### G.3 What the external review changed

Checking current practice before building corrected two things in the audit:

- **Interim instability is not a defect.** Streaming ASR is expected to emit partials that refine as context arrives ("I want to go to the" → "I want to go to the store"). The audit proposed stabilising this; that would fight the convention every comparable product follows. **Dropped.**
- **`EnergyVad` is the weakest of the three standard approaches.** Neural VAD (Silero) consistently outperforms WebRTC VAD, which outperforms an RMS-energy baseline — which is exactly what `EnergyVad` is. Silero VAD is ~1.8 MB of ONNX and runs on the runtime already in the stack. Pure silence-based endpointing also cuts people off mid-sentence when they pause to think, which a 700 ms hangover does not solve.

  **Not built in this pass, deliberately** — it changes segmentation, the one behaviour everything else is validated against, and bundling it here would make the change unreviewable. It is the highest-value next step.
