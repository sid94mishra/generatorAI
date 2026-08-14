# Real-Time Voice Agent — End-to-End Review & Implementation Plan

> **Revision note:** §§0–9 below are the original STT-only review and remain valid — the root-cause analysis, protocol design, and testing approach all still hold. **§§10–13 are a fresh pass that generalizes the architecture into a shared, bidirectional Speech↔Text core** (STT now, TTS forward-looking, both invokable independently through the same design) and **finalizes the STT model choice as Parakeet**, backed by new CPU benchmark evidence and a competitive-architecture survey (Codex, Claude Code, Hermes Agent, LiveKit/Pipecat) that supersedes the more tentative "evaluate before committing" framing in the original §7.6. Read §10 first if you want the current authoritative design; §§0–9 are the supporting detail it builds on.

---

**Scope:** the mic button in the chat composer (web/desktop) and its mobile equivalent. **Method:** full source trace of every file in the pipeline (not a sample — every client hook, WS route, session, and engine file was read in full), cross-checked against current (2026) architecture patterns from OpenAI's Realtime API, Deepgram Nova-3, AssemblyAI Universal-Streaming, and the LLM-reformatting dictation apps (Wispr Flow, Superwhisper) that are the direct product analogue of what's being asked for here.

**This document ends with an explicit "second-pass review" section (§7)** showing what got corrected after the first draft, per your request — not a second parallel plan, but a transparent diff against the first-pass reasoning.

---

## 1. The current implementation, traced end-to-end (evidence, not assumption)

```
Web/Desktop:
  getUserMedia (16kHz mono) → AudioWorklet chunks (~128ms) → binary WS frames
    → apps/server/src/stt-ws.ts → SttSession → WhisperSttEngine (local, CPU)
    → { interim | final } JSON frames → chat composer textarea

Mobile:
  hold button → expo-audio records to a WAV FILE (no live sample callback)
    → release → whole file read, sent as ONE binary frame → same server pipeline
    → single { final } frame after ~1 round trip → composer textarea
```

**Client (`apps/web/src/hooks/useSpeechToText.ts`):** captures the mic, resamples to 16kHz via an inlined `AudioWorklet`, and streams raw Float32 PCM over a WebSocket. Clean, minimal, no compression overhead — a reasonable choice.

**Session (`apps/server/src/stt/SttSession.ts`) — this is the actual root cause of the performance complaint.** Every 900ms (`INTERIM_DEBOUNCE_MS`), it calls `engine.transcribe(this.merged(), ...)` — **`merged()` concatenates every audio chunk received since the user started talking and re-transcribes the entire thing from sample zero, every single time** (`SttSession.ts:74-82,94`). There is no incremental decode, no sliding window, no VAD-based segmentation. The code's own comment is honest about this: *"Whisper is not natively streaming, so we approximate live results by re-transcribing the accumulated buffer on a short debounce."*

**Engine (`apps/server/src/stt/WhisperSttEngine.ts`):** local Whisper `base.en`, run via `@huggingface/transformers` (transformers.js) + `onnxruntime-node`, fully offline, no API key, no cost. `normalizeTranscript()` — the *entire* post-processing step — does nothing but `text.replace(/\s+/g, ' ').trim()` (`WhisperSttEngine.ts:120-122`). There is no punctuation-restoration model, no filler-word removal, no LLM pass, no formatting logic anywhere in this file, or anywhere else in the pipeline — confirmed by having read every file in it.

**Mobile (`apps/mobile/src/voice/useVoiceInput.ts`):** the code's own header comment states the honest reason there's no live streaming here at all: *"React Native cannot [produce live PCM] — `expo-audio` records to a FILE and exposes no sample callback. So the shape of the interaction changes rather than being faked: web = hold, watch the words appear, release; mobile = hold, release, the utterance is transcribed."* This is a deliberate, documented scope decision, not an oversight — but it means **"real-time text appearing as you speak" currently only exists on web/desktop. Mobile is pure batch dictation** (record whole utterance → one request → one response).

---

## 2. Root-cause mapping — every complaint traced to a specific line of code

| Your complaint | Root cause | Evidence |
|---|---|---|
| "Real-time performance is very bad" | Every interim pass **re-transcribes the entire growing buffer from t=0**, not an incremental decode. Cost grows with utterance length; a 15-second dictation means the *last* interim pass alone re-processes all 15 seconds, on CPU, with a batch (non-streaming) model, inside a 900ms debounce window that it can no longer make. | `SttSession.ts:74-108` |
| "Flat voice to text like a dictation app" | That is a precisely accurate description of the code: zero post-processing beyond whitespace trimming. No punctuation restoration, no grammar correction, no filler-word removal, no structure inference. | `WhisperSttEngine.ts:119-122` |
| No proper punctuation | Same root cause — `base.en` produces *some* punctuation as a side effect of its training data, but there is no dedicated punctuation model or LLM pass to fix or improve it, and no verification that it's even reliable at this checkpoint size. | `WhisperSttEngine.ts:28,89-109` |
| No sentence correction / intent mapping | There is no LLM (or any model) in this pipeline at all beyond the ASR model itself. Nothing reads "what did the user *mean*" — only "what phonemes were said." | Confirmed absent across every file in the pipeline |
| No bullets / structure / new lines | Same — this requires a semantic pass over completed text, which doesn't exist | — |
| Text visibly "flickers" or changes while speaking (a related, undiagnosed symptom) | Each interim pass is an *independent* re-transcription, not an extension of previously-decided words — so the ASR model can genuinely choose *different* words for the *same* earlier audio on consecutive passes, since it re-decides everything from scratch each time. This is a more specific and more fixable defect than "slow": it's structurally unstable, not just laggy. | `SttSession.ts:94-98` (`lastInterim` only dedupes identical strings, it doesn't prevent re-decided ones from differing) |
| Real-time voice on mobile | **Doesn't exist today** — mobile is batch-only by explicit design | `useVoiceInput.ts:1-20` |

**What's already good and shouldn't be thrown out:** `ISttEngine` (`apps/server/src/stt/ISttEngine.ts`) is a clean, deliberately swappable port — its own comment states the intent: *"ship Whisper... today and can drop in Nemotron-ONNX or a cloud provider later without touching the WebSocket route, the client hook, or the UI."* This means the fix described below is an engine/pipeline swap behind an already-correct seam, not a rewrite of the composer or the WS route. The local-first, zero-cost, offline-capable design intent is also a deliberate, worthwhile constraint to preserve as a *default*, not discard — it matches this product's self-hosted positioning established throughout its architecture.

---

## 3. How modern real-time voice systems actually do this

| System | Architecture | What it tells us |
|---|---|---|
| **OpenAI Realtime API** (`gpt-realtime`/transcription models) | WebSocket/WebRTC, **server-side VAD for turn detection**, streams **transcript deltas** as speech arrives, final transcript on turn commit ([developers.openai.com](https://developers.openai.com/api/docs/guides/realtime-transcription)) | Confirms the industry-standard shape: VAD-driven turn detection + incremental deltas, never "re-transcribe everything on a timer." |
| **Deepgram Nova-3** | Purpose-built streaming Transformer (GPU), **"true streaming"** — partial transcripts emitted while speaking, automatic punctuation *and paragraphs*, entity/number formatting built into the model itself ([deepgram.com](https://deepgram.com/learn/introducing-nova-3-speech-to-text-api)) | Punctuation/paragraphing is treated as a first-class *model* capability, not a bolt-on. |
| **AssemblyAI Universal-Streaming** | ~300ms latency, **immutable transcripts** — once a word is emitted it is never overwritten by a later response, plus *intelligent (semantic) endpointing*, not just silence-based ([assemblyai.com](https://www.assemblyai.com/universal-streaming)) | Directly explains the "flicker" defect above: immutability is a deliberate UX property competitors optimize for, precisely because re-decided partials look broken to a user watching them. |
| **Silero VAD** | Neural VAD, 30ms frames processed in <1ms on CPU, far more accurate than energy-based/WebRTC VAD in noisy environments; used both to gate expensive ASR work to actual speech *and* to detect end-of-utterance (~500ms silence) for automatic finalization ([aiadoptionagency.com](https://aiadoptionagency.com/silero-vad-voice-activity-detection/), [rajatpandit.com](https://rajatpandit.com/agentic-ai/real-time-audio-vad/)) | This is the missing piece that turns "periodic full re-transcription" into "segment on natural pauses, transcribe each segment once." |
| **faster-whisper / VAD-chunked pseudo-streaming** | Confirms Whisper's encoder-decoder design **cannot natively stream** — the correct workaround is VAD-guided chunking with overlapping windows and output stitching, not "grow one buffer and re-run it," and CTranslate2/INT8 quantization gives 2-4x speedup over the vanilla runtime GeneratorAI currently uses ([arxiv.org/2604.25611](https://arxiv.org/pdf/2604.25611), [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)) | Validates that GeneratorAI's core bug (full-buffer re-transcription) is a known anti-pattern with a well-documented, proven fix. |
| **Wispr Flow / Superwhisper** — the direct product analogue of what you're describing | Both run raw ASR output through **a second LLM pass** that removes filler words, adds punctuation, fixes grammar, and adapts formatting to context — explicitly *without* requiring the user to say "comma" or "period" ([clickup.com](https://clickup.com/blog/wispr-flow-vs-superwhisper/), reviews at [getvoibe.com](https://www.getvoibe.com/resources/wispr-flow-vs-superwhisper/)) | This is the exact two-stage architecture (ASR → LLM cleanup) the request is asking for, already proven at consumer scale by the two market leaders in "AI dictation." |

**The synthesis these five sources converge on, unanimously:** (1) segment audio on detected speech boundaries (VAD), don't re-run a growing buffer on a timer; (2) stream partial results as words are decided, ideally without re-deciding already-emitted words; (3) treat punctuation/structure as a distinct capability — either built into a purpose-built streaming model (Deepgram) or bolted on via a second LLM pass over a non-streaming model's output (Wispr Flow/Superwhisper). GeneratorAI's local-first Whisper choice puts it in the second category by necessity — which is fine, **as long as the VAD-segmentation and LLM-cleanup stages that category requires are actually built**, and today neither exists.

---

## 4. Target architecture

### 4.1 High-level pipeline

```
Mic → AudioWorklet (unchanged) → WS (unchanged, protocol extended — §4.4)
   → Server: Silero VAD gates the stream
        ├─ silence → nothing sent to the ASR engine at all (saves CPU)
        └─ ~500ms trailing silence after speech → utterance boundary detected
   → On each utterance boundary: ONE transcription pass over just that
     segment (not the whole session) via the existing ISttEngine seam
   → Raw segment transcript → LLM cleanup pass (fast, single-shot, no tools,
     no conversation history) → punctuated / corrected / structured text
   → Cleaned segment is APPENDED (not replace-the-whole-buffer) to the
     composer's confirmed text
   → Live word-level partials (rule-based, not LLM) shown for the CURRENT
     in-flight segment only, so the UI still feels immediately responsive
   → On manual stop / session end: optional single whole-dictation coherence
     pass over all confirmed segments together (handles cross-segment
     structure — e.g. recognizing an enumerable request should become a
     bulleted list)
```

This directly fixes the "flicker" defect (§2): only the *current* in-flight segment is ever "live"; once VAD calls the boundary, that segment is transcribed once, cleaned once, and frozen — never re-decided again. This mirrors AssemblyAI's immutable-transcript design goal without requiring their specific model.

### 4.2 VAD: Silero VAD, server-side, gating the existing `ISttEngine`

**Recommendation: run Silero VAD server-side, not client-side, for v1.** The server already depends on `onnxruntime-node` (via `@huggingface/transformers`) — Silero VAD ships as a small ONNX model, so this is an additive dependency on infrastructure already present, not a new runtime. Client-side VAD (to avoid sending silence over the WS at all) is a legitimate future optimization but adds browser-side ML-runtime complexity for a bandwidth saving that matters far less than fixing the transcription-cost bug itself — sequence it later, not now.

**What VAD changes structurally:**
- `SttSession` stops accumulating one ever-growing buffer. It instead tracks "am I currently inside a detected utterance," buffers *only* that utterance's samples, and on ~500ms of trailing silence, hands that bounded segment to the engine for exactly **one** transcription pass, then starts a fresh (empty) buffer for the next utterance.
- This is the single change that fixes the performance complaint: transcription cost per segment is bounded by that segment's length (typically a few seconds), not by total session duration. It also removes the debounce-timer contention (`pendingInterim` queuing in the current code) entirely, because there's no longer a periodically-re-run job — there's one job per detected utterance boundary.
- Automatic finalization on silence, instead of only on a manual "stop" click, is a genuine new capability this unlocks (matches OpenAI/Deepgram/AssemblyAI's turn-detection behavior) — the manual stop button remains, now meaning "end the whole dictation session," not "finalize the one utterance in progress."

### 4.3 The LLM cleanup stage — new, and the piece that directly answers "not a dictation app"

**This must NOT go through `IAgentHarness` (the chat/workflow harness abstraction).** Both current harness providers are subprocess-based: Copilot multiplexes over one persistent CLI process, and Claude Agent spawns a **new OS subprocess per query** (confirmed in the earlier performance review, finding F5 — multi-second cold start per call). Routing a per-utterance punctuation cleanup through either would reintroduce exactly the kind of subprocess-spawn latency the performance review already flagged as a systemic problem, at a much higher call frequency (every few seconds during dictation, instead of once per chat turn). **This needs its own lightweight, direct, single-shot completion call path — a new, narrow capability, not a reuse of the multi-turn agentic harness.**

**Design:**
- A small new interface, e.g. `ITextFormatter`, with one method: `format(rawText: string, opts: { hint?: 'append-to-existing' | 'final-polish' }) → Promise<string>`. No tools, no conversation state, no system-prompt scaffolding beyond a short, fixed instruction. This keeps latency to "one small model round trip," not "one full agentic turn."
- **Default/local-first fallback:** if no cloud key is configured, this stage runs a rule-based cleanup only (sentence-case the first letter, ensure terminal punctuation from ASR's own output, collapse filler-word patterns like "um"/"uh" via a fixed regex list) — strictly better than today's whitespace-only normalization, works fully offline, costs nothing, and requires no new dependency.
- **Opt-in cloud upgrade, reusing the existing BYOK pattern:** GeneratorAI already has a first-class pattern for "user supplies their own API key for a specific capability" — the chat/workflow `harnessConfig.provider.apiKey` BYOK field. Extend that *same* pattern to a new `sttConfig.formatter` setting (`{ provider: 'local-rules' | 'anthropic' | 'openai', apiKey?, model? }`), rather than inventing a new credential shape. **Store it through the encrypted secrets vault, not a fifth plaintext DB column** — this is a direct, explicit callback to the security review's P0-2 finding (BYOK keys are currently plaintext and the fix — wiring through `HarnessInstanceRepository.credentialRefs` — is already scoped); a *new* voice-formatter credential is exactly the kind of thing that must not repeat that mistake on day one.
- **Segment-level cleanup** runs on each VAD-bounded utterance as it finalizes — small input, fast model, a few hundred ms added latency at each natural pause in speech, which is imperceptible against the pause itself.
- **Whole-dictation coherence pass (optional, on stop):** one additional call over the full concatenated, already-segment-cleaned text, prompted specifically to preserve the user's meaning while fixing cross-segment structure — this is what turns "three separate rambling sentences" into a clean bulleted list *when the content is actually enumerable*, adds question marks where the utterance was phrased as a question, and inserts paragraph breaks at topic shifts. This directly answers the "intent mapping," "bulleted points," and "question intact" requirements — but as a text-and-context-based inference over the transcript, not literal acoustic-tone analysis (see the honest scoping note in §4.6).

### 4.4 Protocol changes (`stt-ws.ts`) — additive, backward-compatible

Add one new server→client frame kind and repurpose the existing ones precisely:

```
{ t: 'partial', text }         — live, rule-based, current in-flight segment only
                                  (replaces the OLD 'interim' semantics — cheap,
                                  no LLM, updates frequently, may still be revised)
{ t: 'segment_final', text }   — NEW: one VAD-bounded utterance, LLM-cleaned,
                                  client APPENDS this permanently, never revises it
{ t: 'final', text }           — session end (manual stop), the optional
                                  whole-dictation coherence pass result
{ t: 'error', message }        — unchanged
```
Existing clients that only understand `interim`/`final` still function (graceful degradation) if `partial` is treated as a synonym during rollout, but the composer should be updated to actually use `segment_final` for the append-vs-replace behavior described in §4.1 — that's where the "no more flicker" property actually comes from client-side.

### 4.5 Client changes

- **Web (`useSpeechToText.ts` / `VoiceRecorder.tsx`):** track two pieces of state instead of one — `confirmedText` (grows by appending each `segment_final`) and `liveText` (replaced by each `partial`, discarded once its segment finalizes). The composer displays `confirmedText + ' ' + liveText`. This is a small, contained change to existing state management, not a rewrite.
- **Mobile (`useVoiceInput.ts`):** true live streaming requires a platform-level capability GeneratorAI doesn't have today — `expo-audio` has no live sample callback, as the code's own comment already states, and building one is a real native-module effort, not a quick fix. **Recommended v1 scope: keep mobile's existing "hold, release, one file" interaction, but run that one recorded utterance through the *same* VAD-segmentation + LLM-cleanup pipeline server-side before returning the result.** Mobile users won't see live word-by-word text, but they will get the *same* quality upgrade (proper punctuation, structure, intent-aware cleanup) that web gets — an honest, explicitly-scoped improvement rather than a false promise of live streaming that the platform can't currently support. This matches the existing code's own stated philosophy ("the shape of the interaction changes rather than being faked").

### 4.6 Scoping "tone" honestly

The request asks for formatting driven by "user's voice, tone." Worth being direct about this rather than overpromising: **no system reviewed above — including OpenAI's and Google's frontier real-time voice models — reliably derives semantic *intent* from raw acoustic tone/prosody and uses that to drive *text formatting* choices; the closest production analogues (Wispr Flow, Superwhisper) infer formatting intent from the *words and surrounding context* (what app you're dictating into, sentence structure, enumerable content), not from pitch/prosody analysis.** That's the credible, evidence-backed version of "tone-aware formatting" to build: the LLM cleanup stage in §4.3 already does exactly this (infers a question from phrasing, infers a list from enumerable content, infers emphasis from repeated/intensified phrasing) using the transcript text itself. Treat literal acoustic-prosody-driven formatting as an unproven, Phase-3/research-flagged idea, not a committed deliverable — promising it as a near-term feature would be setting an expectation the current state of the art doesn't reliably support.

---

## 5. Phased plan

**Phase 1 — fix the performance bug (highest leverage, smallest change):** Silero VAD + segment-bounded transcription in `SttSession`, replacing full-buffer re-transcription. This alone fixes the "very bad real-time performance" and "flicker" complaints, with zero new external dependencies (Silero VAD runs on the ONNX runtime already present) and no protocol change required yet (still emit `interim`/`final`, just computed correctly per-segment instead of via periodic full re-runs).

**Phase 2 — add the LLM cleanup stage:** new `ITextFormatter` port + rule-based local default + optional cloud BYOK path (wired through the secrets vault, not a new plaintext column) + protocol extension (`segment_final`) + composer append-not-replace behavior. This is what fixes "flat dictation, no punctuation/intent/structure."

**Phase 3 — mobile parity (server-side pipeline reuse) + whole-dictation coherence pass on stop.**

**Phase 4 (explicitly deferred, research-flagged, not committed):** acoustic-tone-informed formatting, client-side VAD to cut bandwidth, evaluating a purpose-built streaming ASR model (Deepgram/AssemblyAI-class) as an alternative BYOK engine option behind the existing `ISttEngine` seam for users who want cloud-grade accuracy over local Whisper.

---

## 6. Testing plan

- **Unit:** VAD boundary detection against fixture audio (speech/silence/speech patterns); `ITextFormatter`'s rule-based fallback (filler-word removal, punctuation defaults) against a fixed transcript corpus.
- **Latency benchmark:** time from "user stops speaking" to `segment_final` arriving at the client, for utterances of 3s/10s/30s — this is the metric that directly falsifies or confirms the fix to the original performance complaint, and should be checked in CI against a regression threshold, not just eyeballed once.
- **Stability test:** confirm a finalized `segment_final` text is *never* altered by a later frame in the same session — this is the concrete, testable form of "no more flicker."
- **Mobile parity test:** same recorded utterance sent through the pipeline, confirm punctuation/structure quality matches the web path's segment-level cleanup (same `ITextFormatter` call, different capture front-end).
- **Offline/no-BYOK-key test:** confirm the rule-based fallback produces sane output with zero network calls, matching the local-first default this feature has always promised.

---

## 7. Concrete model selection — local, open-weight, zero marginal cost

Answering three follow-up questions directly: which model runs the LLM-cleanup stage (§4.3), whether a single open-weight *bidirectional* (STT+TTS) model can replace the two-stage pipeline, and how transcription actually executes once these are installed. **A real, shipping open-source project — FluidVoice (`altic-dev/FluidVoice` on GitHub, GPLv3) — already validates the exact architecture recommended in §4: multiple swappable local STT backends plus a separate local "Fluid Intelligence" model specifically for on-device dictation enhancement, explicitly positioned as "a local Wispr Flow alternative."** That's the two-stage design in §4.1 and §4.3, already built and shipping, not a hypothetical — worth treating as the closest available reference implementation.

### 7.1 The LLM-cleanup model (§4.3's `ITextFormatter`)

This task is narrow (punctuation, grammar, light restructuring of a few sentences at a time) — it does not need a large general-purpose model, and a large model would work against the latency budget this stage has to hit. **Recommended: a 1.5B–3B parameter open-weight instruct model, quantized to GGUF (Q4_K_M), run via `node-llama-cpp`** (the Node bindings for `llama.cpp` — actively maintained, prebuilt binaries for Windows/macOS/Linux, CPU-only capable with optional CUDA/Metal/Vulkan offload when present). Ranked options, all confirmed open-weight and small enough for this task:

| Model | Size | License | Why it fits |
|---|---|---|---|
| **Qwen2.5/3-Instruct** | 1.5B or 3B | Apache 2.0 | Best instruction-following-per-parameter in this size class; the safe default choice |
| **SmolLM3-3B** | 3B | Apache 2.0 | Hugging Face's own benchmarking places it above Llama-3.2-3B and Qwen2.5-3B at the same scale ([bentoml.com](https://www.bentoml.com/blog/the-best-open-source-small-language-models)) — purpose-built for exactly this "small but capable" niche |
| **Gemma 3 (1B/4B)** | 1B–4B | Gemma license | Google-tuned specifically for controlled, predictable output — a good fit for a narrow reformatting task where you want low variance, not creativity |
| **Phi-4-mini** | ~3.8B | MIT | Explicitly called out as a leading small model for on-device/edge workloads, runs in 4–8GB RAM |

**Avoid Llama 3.2** for this specific stage despite its popularity — its Community License carries usage restrictions the fully-permissive alternatives above don't, and it offers no quality advantage at this size for a narrow formatting task.

**Why `node-llama-cpp` over ONNX Runtime here specifically:** the server already depends on `onnxruntime-node` (via the Whisper/Moonshine STT engine, §8.2) — but GGUF-quantized LLMs are llama.cpp's native format and ecosystem, with far better community tooling, quantization support, and prompt-caching for this exact "small instruct model, short prompt, short output" use case. This is a new native dependency, but it's the same *kind* of dependency GeneratorAI already manages elsewhere (bundled native binaries like `node-pty`, Playwright's Chromium, and the `cloudflared` binary from the relay plan) — same pattern, not a new category of engineering problem.

### 7.2 Can one bidirectional (STT+TTS) model replace the two-stage pipeline?

**Yes, one exists and is genuinely open-weight and locally installable — with an honest hardware caveat.**

**Kyutai's Moshi** ([kyutai-labs/moshi](https://github.com/kyutai-labs/moshi)) is a real full-duplex speech-**and**-text foundation model — it listens and speaks *concurrently* (not turn-by-turn STT-then-TTS), at a practical ~200ms latency, fully open-sourced (weights + code), with **three separate runtime implementations already published: PyTorch (research), MLX (Apple Silicon — genuinely a laptop, not a server), and Rust (production-efficient)**. This is the most direct possible answer to "bidirectional, open weight, installable on a laptop" — it's real, not a research paper with no code.

**The honest caveat:** Moshi's core is a 7B-parameter transformer operating on audio tokens. On Apple Silicon via MLX, unified memory makes this genuinely practical on a laptop. On Windows/Linux without a discrete GPU, running a 7B audio-token model with comfortable real-time headroom on CPU alone is a real stretch — worth testing before committing to it as a universal default, not assuming it based on the Apple Silicon demos. **Qwen2.5-Omni / Qwen3-Omni** (Alibaba, Apache 2.0, also genuinely any-to-any audio+text) is a heavier alternative in the same category — even 4-bit-quantized, it targets GPUs in the RTX 3080-class-and-up range, per Alibaba's own guidance — not a "any laptop" fit either.

**Recommendation: don't adopt a single bidirectional model as the default for this feature.** GeneratorAI's actual current need is STT-into-a-textbox, not full-duplex spoken conversation — composing two small, specialized models (§8.1's formatter + a dedicated STT model below) is lighter, universally CPU-viable, and matches exactly what the validated reference implementation (FluidVoice, §8) already does — it offers a *menu* of specialized local models (Whisper, Parakeet, Nemotron, Apple's own Speech framework), not one do-everything model. **Reserve Moshi as an explicitly-gated, Apple-Silicon-first, advanced/opt-in path** for a genuinely different future feature (the agent speaking responses aloud in a live back-and-forth), not as this feature's foundation.

### 7.3 The STT model itself — a concrete upgrade over `whisper-base.en`

**Recommended: Moonshine** ([moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine), Useful Sensors), specifically because of how it fits GeneratorAI's *existing* code, not just its benchmarks:

- **Purpose-built for exactly this use case** — the project's own framing is "live transcription and voice commands," i.e., short, real-time utterances, not long-form batch transcription. Whisper processes every clip in fixed 30-second windows regardless of actual length; Moonshine scales its processing time to the audio's actual duration — a direct structural fix for short chat-dictation utterances, independent of the VAD-segmentation fix in §4.2.
- **~5x less compute than Whisper tiny.en for a 10-second clip, at no WER increase** ([the-decoder.com](https://the-decoder.com/open-source-moonshine-speech-recognition-model-is-up-to-five-times-faster-than-openais-whisper/), confirmed in the model's own paper).
- **Ships ONNX weights** — it plugs into `onnxruntime-node`, the exact runtime GeneratorAI already depends on via `@huggingface/transformers`. This is a genuinely small change: implement `MoonshineSttEngine implements ISttEngine` alongside the existing `WhisperSttEngine` (the port is already designed for exactly this — §2), no new native dependency, no build-system change.
- Tiny (27M params) and Base (61.5M params) variants exist — Tiny is likely sufficient for short chat-composer utterances and keeps the per-segment latency the VAD-segmentation fix (§4.2) is trying to achieve as low as possible.

### 7.4 If TTS output is ever added (agent speaking back, not just STT-in)

Not in scope for the current chat-input feature, but since the question raises it: **Kokoro-82M** (Apache 2.0, 82M params, ~327MB weights, ONNX export available) is the right default — reviewed sources consistently place it as the best balance of quality-for-size for on-device use, runs fast on CPU with no GPU requirement ([localaimaster.com](https://localaimaster.com/blog/kokoro-tts-local-setup)). **Piper** is the fallback for the most constrained hardware (lower voice quality, but first-audio latency around 40ms and proven on devices as small as a Raspberry Pi 4) — this is the same "tiered fallback by hardware capability" pattern already used for terminal PTY hosts (`NodePtyHost` → `FallbackChildProcessHost`) elsewhere in this codebase, not a new design idea.

### 7.6 NVIDIA Nemotron 3.5 ASR and Parakeet — evaluated against the plan, not assumed

Both are real, open-weight, and worth a place in this plan — but neither is a drop-in replacement for Moonshine without a specific caveat each, and both need verification before being trusted as the *default*, given this feature's "works on any laptop, no GPU required" constraint.

**NVIDIA Nemotron 3.5 ASR** (`nvidia/nemotron-3.5-asr-streaming-0.6b`, 600M params) is architecturally the most sophisticated option reviewed anywhere in this document — and it's worth being specific about *why*, because it doesn't just chunk around a batch model the way Moonshine/Whisper-with-VAD do:

- Its **Cache-Aware FastConformer-RNNT** architecture is *natively* streaming — it reuses cached encoder context and processes only new audio, rather than needing VAD-triggered re-runs on growing/overlapping windows at all ([baseten.co](https://www.baseten.co/blog/introducing-nvidia-nemotron-35-asr-streaming/)). This is a structurally better fix for the §2 root-cause bug (full-buffer re-transcription) than "VAD-segment, then batch-transcribe each segment" — if it works on CPU, it could let this plan **drop the custom VAD-segmentation logic in §4.2 entirely**, since the model itself doesn't need it.
- It has **native punctuation and capitalization** built into the model's output, and **configurable latency via chunk size (80/160/560/1120ms)** — a real, tunable latency/accuracy dial, not an approximation.
- **The unresolved question: does it perform acceptably CPU-only?** Every benchmark found for it is framed in GPU/datacenter throughput terms — "a single H100 sustained up to 100 concurrent real-time streams," hosted via Together AI and Baseten as a paid API. No CPU-only real-time-factor number was found in this research pass. **Recommendation: treat this as the single most promising candidate to spend a prototyping spike on, not as a default to commit to today.** If a CPU benchmark holds up, it simplifies the architecture in §4 meaningfully (drops or shrinks both the VAD stage and part of the punctuation-cleanup burden in one model). If it doesn't hold up on CPU, it's a strong option to offer later as a GPU-accelerated tier for users who have one, alongside Moshi (§7.2) in that same "opt-in, hardware-gated" category.

**NVIDIA Parakeet** (TDT/CTC/RNNT variants, 110M/0.6B/1.1B, plus a streaming 120M variant with built-in end-of-utterance detection) is more accurate than Whisper (6.32% WER for TDT 0.6B v3 vs. Whisper large-v3's 7.44% — [localaimaster.com](https://localaimaster.com/blog/parakeet-vs-whisper)) and genuinely can run CPU-only — but **only via community ports, not NVIDIA's own reference stack.** NVIDIA's own NeMo/PyTorch/CUDA path is GPU-oriented; the practical CPU path is either the ONNX Runtime reimplementation (`achetronic/parakeet`) or the pure-C++ `parakeet.cpp` port (no Python/NeMo/ONNX-runtime dependency at all), with the int8-quantized 0.6B model needing **~670MB disk and ~2GB RAM** for CPU inference — a real, usable number, but noticeably heavier than Moonshine's footprint. Multiple independent sources reviewed for this are explicit and consistent on the tradeoff: *"Parakeet requires GPU and is server-only, best for cloud transcription pipelines at scale, while Moonshine is CPU-first and edge-ready... Parakeet wins on bulk cloud transcription, while Moonshine wins on live edge applications"* ([presenc.ai](https://presenc.ai/research/best-open-weight-speech-to-text-models-2026)-class comparisons; consistent across sources). That's describing NVIDIA's own intended deployment shape, not a hard ban on running it locally — the community CPU ports exist precisely because people want it off the GPU-cloud path — but it's real signal that this isn't the model NVIDIA optimized for a laptop with no GPU.

**Revised recommendation, updating §8.3's engine choice into a tiered strategy behind the existing `ISttEngine` port:**

| Tier | Engine | When |
|---|---|---|
| **Default (ships day one)** | Moonshine | Guaranteed CPU-only, smallest footprint, proven edge-first design — the safe universal choice |
| **Higher-accuracy opt-in** | Parakeet via ONNX/`parakeet.cpp` | User has RAM to spare (~2GB) and wants better WER than Moonshine; still CPU-only, no GPU required |
| **Evaluation candidate — prototype before committing** | Nemotron 3.5 ASR | If a CPU benchmark spike shows acceptable real-time performance, this is the architecturally strongest option and could simplify §4.2/§4.3; until verified, don't build the default pipeline around it |

**One license caveat that applies to both, and doesn't apply to Moonshine/Kokoro/Qwen/SmolLM3 (already confirmed Apache 2.0/MIT):** NVIDIA's community-port *code* wrappers are typically MIT-licensed, but **the model weights themselves carry NVIDIA's own license terms**, which were not fully verified in this research pass. Confirm the exact weight license (commercial redistribution terms specifically, given this would ship bundled inside a distributed desktop app) before committing either model to the shipped default — this is a "verify before you bundle" flag, not a claim that it's blocked.

### 7.6b FluidVoice's actual source, verified directly — what's real, what's closed, and what we can legally reuse

Went past the marketing description in §7 and read FluidVoice's actual source tree (`altic-dev/FluidVoice`) directly. Two findings materially change how this reference should be used.

**License incompatibility is real and specific, not a technicality to wave past.** GeneratorAI is **MIT-licensed** (confirmed: repo root `LICENSE`, `package.json`). FluidVoice has been **GPLv3 since February 23, 2026**; releases before that date were Apache 2.0. GPLv3 is copyleft — directly vendoring or adapting their current source into GeneratorAI would create a real obligation to relicense the combined/derivative portion under GPLv3, which conflicts with shipping GeneratorAI under MIT. **Conclusion: study the architecture, do not copy the code.** Everything below is offered as an independently-reimplemented pattern, not a port.

**"Fluid Intelligence" — the AI-based enhancement layer, i.e. the part closest to what you actually asked for — is explicitly proprietary and lives outside the open-source repo entirely**, confirmed by the repo's own documentation: *"Fluid Intelligence adds a fully local, private AI layer... maintained privately to sustain free-tier dictation while remaining GPL-3.0 compliant for the core application."* It's a separate ~3.5GB download, not source you can read, under any license era — even the pre-2026 Apache release wouldn't have exposed it, since it's described as privately maintained independent of the core's license. **The honest answer to "how does their AI-level sentence-correction/intent-mapping work" is: unknown, by design — it's a closed black box, and no amount of digging into the GPLv3 repo will reveal it.**

**What *is* real, open, and directly inspected in `Sources/Fluid/Services/`** — and this is genuinely useful, independent of the license issue, because it reveals two concrete, deterministic (non-LLM) formatting techniques worth reimplementing in GeneratorAI's own local rule-based fallback tier (§4.3's no-cloud-key path):

1. **`ASRService+SpokenPunctuationFormatting.swift`** — a token-based (not naive regex) matcher recognizing **60+ spoken punctuation phrases** ("comma," "question mark," "new line," "open parenthesis," etc.), each mapped to a symbol with one of five spacing behaviors (`rightAttached`/`leftAttached`/`noSpaceAround`/`spaceAround`/toggle-for-quotes), applied as an ASR post-processing pass. This is the *explicit-command* half of "no dictation-app flatness" — a user who says "comma" gets a comma, deterministically, zero latency, zero cost, no model involved at all.
2. **`ASRService+DictationLiteralFormatting.swift`** — converts spoken patterns like "slash command"/"at username" into literal `/command` and `@username` syntax, with real validation logic (rejecting articles/prepositions, requiring 1–3-token names, checking surrounding context to disambiguate an intentional mention from incidental speech). **Directly relevant to GeneratorAI specifically**: the code explicitly special-cases this exact behavior for chat-style composers — its own logic lists Slack, Discord, Teams, ChatGPT, and Claude as target apps for this feature. GeneratorAI's chat composer is precisely this category of surface, and if it has its own slash-commands or @-mentions, this is a directly transferable idea. Confirmed to run on **final text only**, gated behind a user setting (`literalDictationFormattingEnabled`), not applied to live/interim text — the same "cheap partials live, real formatting only on finalize" split already designed into §4.1.

**Also worth noting as a Phase-4 idea, not previously in this plan:** FluidVoice has a personal-dictionary auto-correction system (`AutomaticDictionaryCorrectionTracker.swift`, `PronunciationDictionaryStore.swift`, `DictionaryTrainingEndpointDetector.swift`) that learns from the user's own post-dictation manual edits over time — detecting "user changed X to Y after dictation" and building a personal vocabulary/pronunciation correction table. This is a distinct, legitimate quality lever independent of both the ASR engine and the LLM-formatter stage, and it's a reasonable long-term addition once the core pipeline (§4) is working.

**Confirms, from a second independent angle, the STT engine strategy in §7.6:** FluidVoice's own provider list is Nemotron Speech 3.5, Parakeet Flash, Parakeet TDT v3, Cohere Transcribe, Apple Speech, and Whisper — behind a `TranscriptionProvider` protocol (their own version of GeneratorAI's `ISttEngine`). Critically, **their own stated hardware gating is "Apple Silicon primary; Intel support via Whisper models"** — i.e., the developers of the one real shipping product using Nemotron/Parakeet *also* concluded those models need accelerated (Apple Neural Engine) hardware and fall back to Whisper where that acceleration isn't available. That's independent, real-world confirmation of §7.6's caution: don't default the universal path to Nemotron/Parakeet; gate them behind detected hardware acceleration and keep a CPU-only model (Moonshine, in GeneratorAI's case, since GeneratorAI is cross-platform Electron and can't rely on CoreML/ANE the way a macOS-native app can) as the guaranteed-everywhere default.

### 7.7 Total footprint of the recommended local stack

Silero VAD (~2MB) + Moonshine Tiny/Base (~30–60MB) + a Q4-quantized 1.5–3B formatter LLM (~1–2GB) — all told, comfortably under ~2.5GB of additional disk and a similar RAM ceiling during inference, entirely CPU-viable, no GPU required, no API key, no per-use cost. This is dramatically lighter than a single 7B bidirectional model, and is the honest, evidence-backed answer to "without incurring any additional cost": every component above is open-weight, free to redistribute (Apache 2.0/MIT dominate this list), and runs offline.

---

## 9. Second-pass review — what changed from the first draft, and why

Doing exactly what was asked: a critical re-read of the plan above before calling it final, not a second parallel document.

1. **Caught and fixed an over-claim:** the first draft's instinct was to route the LLM cleanup stage through the existing `IAgentHarness` port for consistency with the rest of the codebase's "everything goes through the harness abstraction" pattern. On review, this is wrong — the performance review already established that both harness providers pay meaningful per-call subprocess overhead, and a punctuation-cleanup call firing every few seconds during dictation would multiply that cost far beyond what a chat turn pays. **Correction: an explicitly separate, lightweight `ITextFormatter` path**, not a reuse of the agentic harness — captured in §4.3 as it stands now.
2. **Caught and fixed a credential-storage risk before it was written down as fixed:** the first pass's BYOK extension for a cloud formatter model would, if implemented exactly as first sketched, add a *sixth* plaintext credential column, repeating the exact mistake the security review already flagged four times over (BYOK apiKey, GitHub PAT, MCP env/headers, automation webhook tokens — all still plaintext today). **Correction: explicit instruction to store it through the encrypted secrets vault from day one**, cross-referenced to that report's P0-2 finding, rather than silently reproducing the same gap in a brand-new feature.
3. **Caught an overpromise on "tone":** the first draft was tempted to describe acoustic-prosody-driven formatting as an achievable near-term feature because the request explicitly asked for it. On checking the actual research (OpenAI Realtime, Gemini Live, Wispr Flow, Superwhisper), none of them do this reliably in production — they infer intent from text and context, not raw acoustic tone. **Correction: §4.6 now explicitly scopes this as unproven/deferred** rather than promising something not supported by any reviewed system, current frontier or consumer product included.
4. **Verified the mobile scoping decision is honest, not just convenient.** Re-checked `useVoiceInput.ts`'s own comment before writing the mobile recommendation — it already documents *why* live streaming isn't feasible there today (`expo-audio` has no sample callback). The plan's mobile recommendation (server-side pipeline reuse without live streaming) was checked against this and kept as-is, since it's consistent with the existing code's own stated philosophy rather than contradicting it.
5. **Confirmed the VAD placement decision (server- vs. client-side) rather than asserting it.** The first draft leaned client-side by default (common in some references, e.g. to save bandwidth). On review, server-side is the better v1 choice specifically *for this codebase* because `onnxruntime-node` is already a runtime dependency (via the existing Whisper engine) — client-side VAD would add a new browser ML runtime dependency for a bandwidth optimization that matters far less than fixing the transcription-cost bug itself. Sequenced client-side VAD into Phase 4 instead of Phase 1.
6. **Re-checked that Phase 1 requires no protocol change**, to make sure the highest-leverage fix (VAD segmentation) can ship independently of the LLM-cleanup work, rather than bundling them and delaying the performance fix behind the larger feature — confirmed `interim`/`final` frame semantics can be computed correctly per-segment without any wire-format change, so Phase 1 and Phase 2 are genuinely independent, sequenceable pieces of work, not one inseparable change.

---

# Part II — Generalized architecture: a shared Speech↔Text core for STT (now) and TTS (forward-looking)

**Why this revision exists:** the requirement changed from "fix voice input for the chat composer" to "design one generic, bidirectional voice core that today's STT feature is the first consumer of, and tomorrow's TTS feature (and any voice-agent mode after that) plugs into without a redesign." That's a different design problem — not "add a feature," but "get the seam right so the next three features are additions, not rewrites." This section also **finalizes the STT model as Parakeet**, backed by CPU benchmark evidence gathered specifically to answer that question, and a survey of how OpenAI Codex, Claude Code, and the open-source Hermes Agent project actually structure this exact capability today.

## 10. Model finalization: Parakeet, with hard numbers — supersedes §7.6's "evaluate before committing"

§7.6 (original pass) recommended treating Parakeet as CPU-unverified and gating it behind detected hardware acceleration, based on Parakeet's own GPU-throughput marketing numbers (RTFx 3332×, an NVIDIA/H100 figure) and FluidVoice's choice to gate it to Apple Silicon. **New research specifically targeting the missing data point — independent CPU-only benchmarks — changes that conclusion.**

**The number that matters:** independent benchmarks put **Parakeet TDT 0.6B at RTF ≈0.033–0.05 on an Intel Core i7-12700K using ONNX Runtime INT8** — meaning it transcribes 1 second of audio in 33–50 milliseconds, i.e., **20–30× faster than real-time on an ordinary CPU**, with the same source reporting it *outperforms `faster-whisper` running on a discrete GPU (RTX 3070 Ti) by 2.25×* ([heyneo.com](https://heyneo.com/blog/parakeet-cpu-optimization-case-study), [snailtext.app](https://snailtext.app/blog/whisper-vs-parakeet-tdt/)). The INT8 ONNX build is ~640MB on disk, all three precision variants hit identical accuracy on LibriSpeech, and INT8 is the fastest — confirmed the right variant to ship. **On your 16GB Windows laptop specifically: 640MB disk + a CPU-inference RAM ceiling in the low single-digit GB is not a meaningful constraint on that machine — the binding question was always latency, not memory, and the latency question is now answered.**

**Why the earlier FluidVoice-based caution doesn't actually contradict this:** FluidVoice gates Nemotron/Parakeet to Apple Silicon, but that's a *packaging* decision (they ship a Swift/CoreML-native app and apparently hadn't built or didn't trust a CoreML port for Intel Macs), not evidence the *model* is CPU-slow — the direct ONNX/INT8 benchmark above is a more relevant, more direct answer for GeneratorAI's situation specifically, because GeneratorAI already runs on `onnxruntime-node` (via the existing Whisper engine) across Windows/macOS/Linux uniformly through Electron — the exact runtime the CPU benchmark was measured on, not a Swift/CoreML-only path.

**Which Parakeet variant, for which pipeline stage — this is the one refinement worth making, not a simple "swap Whisper for Parakeet":**

- **`nvidia/parakeet_realtime_eou_120m-v1`** — a 120M-parameter streaming variant purpose-built for exactly this use case, with **80–160ms latency** and, critically, **end-of-utterance detection built into the model itself** (it emits an `<EOU>` token when the speaker finishes) — its own model card states it's designed for "voice AI agent pipelines" ([huggingface.co/nvidia/parakeet_realtime_eou_120m-v1](https://huggingface.co/nvidia/parakeet_realtime_eou_120m-v1)). **This can replace both the Moonshine-based live path *and* the standalone Silero VAD component from §4.2 in one move** — endpointing is native to the model, not a bolted-on VAD stage. The one tradeoff: it outputs raw text with **no punctuation or capitalization** — which is fine, because that's exactly the job the already-designed formatter stage (§4.3/§4.5) exists to do; nothing about that stage's design changes.
- **`parakeet-tdt-0.6b-v3`** — the larger, more accurate variant (6.32% WER, beating Whisper large-v3's 7.44%), for a higher-quality pass if the 120M streaming model's accuracy isn't sufficient for your bar. Given the RTF numbers above, running *both* — 120M for live/interim display, 0.6B for the segment-final quality pass — is affordable even on CPU alone; it doesn't have to be an either/or choice.

**Finalized STT decision:** default to **Parakeet Realtime-EOU-120M for the live/streaming/endpointing stage, optionally backed by Parakeet-TDT-0.6B-v3 for the segment-final accuracy pass**, both via `onnxruntime-node` behind the existing `ISttEngine` port, with Moonshine kept as a documented, low-footprint fallback rather than the primary path. This replaces §7.6's tiered "evaluate before committing" framing — the evaluation is done, the numbers support it.

## 11. How the actual competition builds this — Codex, Claude Code, Hermes Agent, and the LiveKit/Pipecat reference architecture

**OpenAI Codex CLI/desktop:** push-to-talk voice input has been native since CLI v0.105.0 (hold spacebar, speak, release). As of July 2026, ChatGPT Voice is wired directly into the Codex desktop app — "speak a single instruction and watch multiple coding agents spin up." **Most relevant to your forward-looking TTS requirement: v0.145.0 shipped "Realtime V3," where "audio tool outputs stream back during agent execution, allowing an agent to speak its progress aloud whilst editing files"** ([digitalapplied.com](https://www.digitalapplied.com/blog/chatgpt-voice-desktop-codex-hands-free-agentic-coding), [codex.danielvaughan.com](https://codex.danielvaughan.com/2026/07/25/voice-first-agent-orchestration-guide-codex-cli-gpt-live-presence-realtime-v3/)). This is direct, shipped-in-production validation that "the agent speaks while it works" is a real, sought-after, achievable pattern — not a speculative nice-to-have you're inventing from scratch.

**Claude Code:** shipped native voice dictation in March 2026 — `/voice` to enable, hold spacebar to talk, text inserted ~450ms after release ([voicedash.ai](https://voicedash.ai/claude-voice-input/), [aquavoice.com](https://aquavoice.com/blog/voice-dictation-claude-code)). Two details worth adopting: **(1) domain-tuned recognition — terms like "regex," "OAuth," "JSON," "localhost" are recognized, and the project name and git branch are automatically added as recognition hints.** This is a directly transferable, cheap technique: most ASR engines (Whisper's `initial_prompt`, and Parakeet's decoding can similarly be biased) accept a "hint" string to bias recognition toward likely vocabulary — GeneratorAI could inject the current project name, recently-referenced file names, or defined skill/agent names the same way, for a real accuracy win with no architecture change. **(2) The explicit push-to-talk (not open-mic) interaction model** — matches what's already designed here (manual start/stop plus VAD-assisted endpointing), not continuous ambient listening.

**Hermes Agent** (`NousResearch/hermes-agent`, real open-source project) is the closest existing analogue to "one generic module, STT and TTS both pluggable, local-or-cloud, invoked independently": its own docs describe it as "a modular pipeline of Speech-to-Text (STT) and Text-to-Speech (TTS) components," defaulting to local Whisper (via `faster-whisper`) with cloud options as alternatives, and supporting "multiple voice engines... cloud options for quality or local engines for a fully private, offline pipeline" ([hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/docs/user-guide/features/voice-mode)). Independent confirmation, from yet another real product, that swappable-provider + local/cloud-tiered is the right shape — not a design being invented in isolation here.

**LiveKit Agents and Pipecat — the actual industry-standard pipeline shape**, and the most important architectural confirmation in this section: both frameworks converge on the exact same sequential pipeline — **Audio In → VAD → STT → LLM → TTS → Audio Out** — with *every stage implemented as an independently swappable plugin/adapter* ([livekit.com](https://livekit.com/blog/voice-agent-architecture-stt-llm-tts-pipelines-explained), [soniox.com](https://soniox.com/wiki/voice-agent-frameworks)). This is not a novel idea to invent for GeneratorAI — it's the established pattern, and it maps directly onto the ports-and-adapters convention GeneratorAI already uses everywhere else in this codebase (`IAgentHarness`, `IBrowserBridge`, `ITerminalHost`) — §12 below is that same pattern applied to voice, not a new architectural style. One more detail worth carrying forward: **Pipecat's "SmartTurnDetection" is an LLM-based classifier for end-of-turn, not just silence-based VAD, and reduces false interruptions by ~30% vs. pure VAD** — the Parakeet-EOU-120M model's built-in `<EOU>` token (§10) already gets much of this benefit at the model level for free, so this is noted as a Phase-4+ refinement, not a gap in the current plan.

## 12. The generalized core architecture

### 12.1 Design principle: two symmetric ports, one orchestrating service, following the codebase's own established pattern

```
packages/core/src/domain/ports/
  ISpeechToTextEngine.ts   (generalizes the existing ISttEngine — same shape, same seam)
  ITextToSpeechEngine.ts   (NEW — the symmetric counterpart)

packages/core/src/services/
  VoiceService.ts          (NEW — application-layer orchestrator)
```

**`ISpeechToTextEngine`** — audio in, text out. Same contract `ISttEngine` already has (§2's own comment: *"ship Whisper today... can drop in [another engine] later without touching the WebSocket route, the client hook, or the UI"*) — this port doesn't need to change shape, only gain a second concrete implementation (Parakeet, per §10) alongside the existing Whisper one.

**`ITextToSpeechEngine`** (new) — the mirror image: text in (ideally consumable incrementally, sentence-chunk by sentence-chunk, not just "whole string in, whole audio out"), audio out (streamed chunks, not one blocking file). Minimal shape:

```typescript
export interface TtsSynthesizeOptions {
  voice?: string;
  language?: string;
}

export interface ITextToSpeechEngine {
  readonly name: string;
  load(): Promise<void>;
  /** Streams audio chunks as they're synthesized — callers don't wait for the whole utterance. */
  synthesize(text: string, opts?: TtsSynthesizeOptions): AsyncIterable<Float32Array>;
  dispose(): Promise<void>;
}
```

**Why a `VoiceService` at the application layer, mirroring `BrowserService`/`TerminalService`, rather than leaving this purely inside `stt-ws.ts`:** GeneratorAI already has the *exact* right pattern for "a workspace/session-scoped, native-model-backed capability with its own lifecycle, caps, and idle-reaping" — that's precisely what `BrowserService` (owns `Map<workspaceId, SessionRecord>` for Chromium sessions, env-configurable concurrency cap) and `TerminalService` (ephemeral `Map<sid, TerminalRecord>`, idle reaper, per-workspace and global caps) already are. Voice I/O is the same shape of problem — model-backed, session-scoped, needs a concurrency cap (§9's earlier finding about a single shared Whisper engine contending across simultaneous users applies equally here) — so `VoiceService` should be built as a third instance of that same established pattern, not a one-off bolted onto the WS route file. This directly serves the "don't just fit changes into the current architecture and hope it integrates" instruction: it's adopting the codebase's own proven shape for exactly this class of problem, which is the more defensible kind of consistency than either a from-scratch design or cramming logic into `stt-ws.ts`.

`VoiceService`'s public surface is two independently-callable halves — this is the literal answer to "anytime I want TTS, I invoke that module; anytime I want STT, I invoke that module":

```typescript
class VoiceService {
  // STT half — today's chat-composer feature calls this.
  async startTranscription(sessionId: string, opts: TranscribeOptions): Promise<TranscriptionHandle>;

  // TTS half — not called by anything today; the architecture exists so that
  // ANY future caller (a "read aloud" button, a live speak-while-streaming
  // mode, a full voice-conversation mode) invokes the same entry point.
  async speak(sessionId: string, text: string | AsyncIterable<string>, opts?: SpeakOptions): Promise<SpeechHandle>;
}
```

Note `speak()` already accepts `text: string | AsyncIterable<string>` — accepting a *stream* of text chunks, not just a finished string, is what makes "speak while the agent is still generating" possible later without changing this signature. Design that in now, even though nothing calls it with a stream yet — that's the concrete meaning of "bear the implementation, don't require it in production yet" applied to an API surface rather than a runtime behavior.

### 12.2 The STT direction (built now)

```
Mic → capture (unchanged: getUserMedia + AudioWorklet)
   → VoiceService.startTranscription()
   → ISpeechToTextEngine = Parakeet-EOU-120M (native streaming + endpointing, §10)
        → live partial text (fast, rule-based cleanup only, per §4.1)
        → on <EOU> token: segment complete
   → optional ISpeechToTextEngine = Parakeet-TDT-0.6B-v3 accuracy pass on that segment
   → ITextFormatter (rule-based default / LLM opt-in, per §4.3 — unchanged)
   → segment_final appended to composer (per §4.4 protocol — unchanged)
```

Everything downstream of the engine choice is exactly what §§1–9 already designed — this section only changes *which model* sits behind `ISpeechToTextEngine`, and *removes* the separate Silero-VAD stage from §4.2 (superseded — the endpointing is now native to the chosen model, not bolted on).

### 12.3 The TTS direction (architected now, minimal reference implementation, not full production)

**The critical insight that avoids new plumbing:** GeneratorAI's agent responses already stream as a live event sequence — `harness.token` events on the `EventBus`, exactly the mechanism documented in `AGENTS.md`'s own "Add a new SSE event kind" recipe (*"Bridge auto-routes to all scopes. No route change required"*). **The TTS module does not need new infrastructure to know what the agent is saying as it says it — it needs to become a new subscriber to an event stream that already exists.**

```
Agent generates response → EventBus emits harness.token (already happens today, no change)
   → NEW: a sentence-boundary buffer subscribes to this stream (only when TTS is
     actively invoked for that session — see the gating note below)
   → on each completed sentence: VoiceService.speak(sessionId, sentence)
   → ITextToSpeechEngine (Kokoro, per §7.4) synthesizes that sentence's audio
     WHILE the LLM continues generating the next one — pipelined, not
     "wait for the full response, then speak" (which would feel laggy)
   → audio chunks streamed to the client, played as they arrive
```

This is precisely the pattern Codex's "Realtime V3" and the LiveKit/Pipecat reference architecture both converge on (§11) — sentence-chunked incremental synthesis overlapped with continued generation, not batch-then-speak.

**Gating, so this doesn't run by default:** the sentence-boundary subscriber should only attach when a session has actually invoked `speak()` in streaming mode — it must not become an always-on tax on every chat turn. This mirrors how `EventBus.subscribeAll`/`subscribe` already work (opt-in listeners, not a mandatory pipeline stage) — no new subscription mechanism needed, just a new, conditionally-attached listener.

**What ships now vs. later, concretely:**
- **Now (the "bear the implementation" piece):** `ITextToSpeechEngine` port defined; one minimal concrete implementation (Kokoro, per §7.4 — already researched, Apache 2.0, CPU-viable); `VoiceService.speak()` implemented and wired to ONE simple, low-risk caller — e.g. a manual "read this message aloud" button on a completed chat message (non-streaming input: the whole message text, already finished generating). This proves the whole chain — port, service, engine, audio playback — end-to-end, without touching the harder streaming-while-generating case yet.
- **Later (explicitly deferred, not required for production today):** the sentence-boundary EventBus subscriber for live speak-while-streaming; barge-in/interruption handling (user starts talking while the agent is speaking — needs its own turn-taking logic, not scoped here); voice selection/personalization UI.

### 12.4 What this generalization changes vs. the original (STT-only) design

| Original (§§1–9) | Generalized (§§10–13) |
|---|---|
| `ISttEngine` (STT-only port) | `ISpeechToTextEngine` (same shape, renamed for symmetry) + new `ITextToSpeechEngine` |
| Logic lived in `stt-ws.ts` + `SttSession` | Both directions owned by a new `VoiceService`, following the `BrowserService`/`TerminalService` pattern |
| Silero VAD bolted onto a batch/streaming model for endpointing | Endpointing is native to Parakeet-EOU-120M — no separate VAD component needed |
| Whisper `base.en`, tentative Parakeet as an "evaluate later" tier | **Parakeet finalized as the default**, backed by CPU RTF evidence (§10) |
| No TTS consideration | `ITextToSpeechEngine` port + minimal reference implementation, explicitly designed so the harder streaming case is an *additive* future change, not a redesign |

## 13. Revised phased plan

**Phase 0 — core seam, no user-visible change.** Define `ISpeechToTextEngine`/`ITextToSpeechEngine`, stand up `VoiceService` (mirroring `BrowserService`/`TerminalService`'s lifecycle/cap patterns), migrate the existing Whisper engine behind the renamed port with zero behavior change. This is pure refactor risk-reduction — proves the new seam compiles and wires correctly before any model swap.

**Phase 1 — STT model swap + native endpointing.** Implement `ParakeetSttEngine` (EOU-120M for live/streaming, optional TDT-0.6B-v3 for segment-final accuracy), remove the Silero-VAD stage (superseded), keep Whisper registered as a fallback engine. This directly fixes the original performance complaint, now with a *stronger, benchmarked* model choice than the original plan's Moonshine default.

**Phase 2 — text formatting.** Exactly as originally designed in §4.3/§4.5: rule-based local default + optional BYOK LLM cleanup (through the encrypted secrets vault, per the second-pass review's correction) + protocol extension (`segment_final`) + composer append-not-replace behavior. Unaffected by the STT model swap — this stage consumes text, not audio.

**Phase 3 — TTS foundation ("bear the implementation").** `ITextToSpeechEngine` + Kokoro implementation + `VoiceService.speak()` + one manual "read aloud" caller on a completed message. Proves the full chain end-to-end at the lowest-risk trigger point, with zero requirement to solve live-streaming speech or barge-in yet.

**Phase 4 — live speak-while-streaming (explicitly deferred, not required for this round).** Sentence-boundary `EventBus` subscriber, pipelined synthesis overlapped with continued generation, conditional attach-only-when-invoked gating, and (eventually) barge-in/interruption handling. This is the piece that turns "read a finished message aloud" into "the agent talks while it works," matching what Codex's Realtime V3 already ships — sequenced last because it's the only piece with real new turn-taking complexity, and the user's own framing ("bear one implementation done, but not required as of now for full production integration") explicitly scopes it as not blocking this round.

Phases 0–3 can be estimated and staffed independently of Phase 4 — that separation is the direct payoff of designing the `speak(text: string | AsyncIterable<string>)` signature generically in Phase 0 rather than deferring the interface design along with the deferred implementation.
