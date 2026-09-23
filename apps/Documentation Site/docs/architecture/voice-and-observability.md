---
title: Voice, performance, and observability
description: Speech pipelines, runtime capacity, telemetry, health diagnostics, and honest performance boundaries.
---

# Voice, performance, and observability

Speech and diagnostics are shared server capabilities, with platform-specific capture/playback controls in clients. Their resource behavior matters because model loading, browser sessions, provider startup, and long event histories all compete with interactive work.

## Speech architecture

```text
Client microphone
  → authenticated STT WebSocket
  → VoiceService session
  → activity detection / segmentation
  → selected speech-to-text engine
  → optional text formatting
  → client transcript / composer

Text or live agent token stream
  → sentence boundary buffering
  → VoiceService speech session
  → text-to-speech engine
  → audio stream to client
```

`VoiceService` supplies capacity-limited lifecycle management over `ISpeechToTextEngine` and `ITextToSpeechEngine`. `SttSessionRunner` handles listening/pause/resume and transcript delivery. `TtsSessionRunner` can synthesize a finished string or an async text stream; stop/barge-in cancels further synthesis. Sentence boundaries prevent a new synthesis job for every token.

Unlike browsers and terminals, dictation is **connection-scoped**, not necessarily workspace-scoped. A user can dictate before attaching a project. The WebSocket closing cancels the session; workspace deletion is not its primary cleanup trigger.

## Engine choices in source

| Engine ID | Role | Implementation notes |
| --- | --- | --- |
| `auto` | STT selection/cascade | Prefers the configured/default engine and falls back to Whisper when loading fails |
| `moonshine` | STT | Lightweight short-form dictation path; current source default preference |
| `whisper` | STT | Whisper fallback/explicit selection |
| `parakeet` | STT | Available alternative; source records output quality limitations in its measured fixtures |
| `nemotron` | STT | Opt-in Nemotron implementation paths and model/runtime availability checks |
| `disabled` | STT/TTS | Explicitly disabled capability |
| `kokoro` | TTS | Local synthesis engine used for speech playback |

`VoiceEngineFactory` keeps descriptors, availability and constructors together. Native runtime/model download requirements differ by engine. Repository benchmark numbers describe their specific fixture/reference machine and should not be presented as universal latency or accuracy guarantees.

Activity detection has energy-based and Silero-related paths. Text formatting has rule-based and optional LLM-assisted implementations. These are independent stages; a formatter cannot guarantee recovery of speech the recognizer omitted.

## Capacity and lifecycle

| Resource | Capacity / protection |
| --- | --- |
| Agent turns | Provider supervisor execution permits and cold-start limits |
| Workflow stages | Shared stage semaphore across runs |
| Browser sessions | BrowserService concurrency cap and workspace teardown |
| PTYs | TerminalService lifecycle and workspace ownership |
| STT | Concurrent-session cap, idle TTL, connection cleanup |
| TTS | Concurrent speech cap and completion/stop cleanup |
| Event streams | Bounded queues, batched database writes, retention and replay reset |
| Native hosts | Restart budgets, protocol/build checks and parent-liveness handling |

Limits should be read from the effective configuration because individual deployments can override them. A service reporting an idle cached provider is different from one actively executing a turn. Diagnostics should separate parked and running work rather than labeling every retained resource a leak.

Pending workflow reviews release stage concurrency capacity but still retain an execution frame, agent session, awakeable bookkeeping, and timer. This is a current implementation limit, not evidence of a zero-resource suspended workflow. See [Human decisions](./execution.md#human-decisions) before estimating capacity for many long-lived approval gates.

## Event performance

The stream path batches writes before broadcasting and suppresses known renderer noise. It still writes durable SQL rows for user-visible events and deltas. The optional delta file log is a dual-write experiment with no current replay reader; enabling it does not remove SQL event volume.

The web/mobile/terminal layers use shared stream reduction and may use virtualization or block delivery for long/high-latency transcripts. Server-side multiplexing avoids unnecessary physical connections per subscription. Cross-tab sharing is not shipped and must not be counted as a performance improvement.

Health metrics, controlled fixtures and a profiler answer different questions. A healthy response does not prove responsive scrolling, and a fast empty chat does not prove performance with a large transcript or many active workflows.

## Logging and telemetry

`packages/shared/src/logging/Logger.ts` builds Pino logging with redaction and optional rotating file output. Log level and rotation configuration are read at runtime. Redaction uses configured key paths; arbitrary free-form text should not be assumed sanitized just because the logger has redaction enabled.

`apps/server/src/instrumentation.ts` initializes OpenTelemetry when `OTEL_ENABLED=true`. It must load before other application modules for auto-instrumentation to attach. The implementation exports traces and metrics through OTLP, supports sampling/export interval settings, and instruments HTTP, Express and Pino.

Core/database/provider code also records explicit metrics and spans through shared telemetry helpers. This lets a trace connect request, execution and persistence costs instead of treating client loading time as a single undifferentiated delay.

## Health and recovery diagnostics

`apps/server/src/routes/health.ts` reports component health, execution counts and pressure indicators, including queued stream writes and provider runtime diagnostics where available. A loop-turn probe supports detection of a wedged main execution loop from a worker-based observer.

`WedgeDetector`, host supervisors and process reapers address different failure classes:

- A liveness probe detects whether work can still advance.
- A restart policy determines whether replacing a failed child is useful.
- Recovery reconciles persisted execution state after interruption.
- Reapers clean up owned orphan processes/resources.

None should convert an uncertain task outcome into a successful one merely because a replacement process is healthy.

## Diagnosing a slow or incomplete turn

1. Check provider readiness, account state, selected model and effective instance.
2. Check whether work is queued behind stage/turn/cold-start capacity.
3. Inspect whether the provider is emitting events and whether durable write depth is growing.
4. Distinguish a client reconnect/replay reset from a provider cancellation or crash.
5. Check workspace/native-resource startup, particularly browser, terminal and speech first-use loading.
6. Compare the server's authoritative terminal status and stored transcript with the client's rendered result.

Capture timings and IDs without copying credentials or private transcript content into public diagnostics. Use the [security page](./security.md) and [configuration reference](../reference/configuration.md) for the relevant boundaries and settings.

## Source evidence

`packages/core/src/services/VoiceService.ts`; `packages/core/src/infrastructure/voice/`; `apps/server/src/stt-ws.ts` and `tts-ws.ts`; `apps/server/src/instrumentation.ts`; `apps/server/src/routes/health.ts`; `packages/shared/src/logging/Logger.ts`; `packages/shared/src/telemetry/`; `packages/core/src/infrastructure/WedgeDetector.ts`; `packages/core/src/services/StreamBroker.ts` and `StreamWriteBatcher.ts`.
