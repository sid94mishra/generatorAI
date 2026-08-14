# Orca — Complete Architecture & Security Analysis

> Reference project: `referenceProjects/orca` · Version **1.4.178-rc.2** · MIT · stablyai
> Analysis date: 2026-08-11
> Scale: **10,823** TS/TSX source files, **4,557** test files (~42% test-file ratio), ~33 MB TypeScript

**One-line identity:** an Electron desktop IDE that runs *many coding-agent CLIs in parallel*, each in its own isolated git worktree, with a detached terminal daemon, a remote-execution relay, a headless server mode, a web client, and a mobile companion app — all sharing one RPC surface.

---

## Table of Contents

1. [Repository Topology](#1-repository-topology)
2. [End-to-End Architecture](#2-end-to-end-architecture)
3. [Module-by-Module Deep Dive](#3-module-by-module-deep-dive)
4. [Concurrent Agent Sessions, Processes & Performance](#4-concurrent-agent-sessions-processes--performance)
5. [Concurrent Streaming to the UI](#5-concurrent-streaming-to-the-ui)
6. [Security](#6-security)
7. [Multi-Device Support & Authentication](#7-multi-device-support--authentication)
8. [API Key & Credential Storage (MCP / integrations)](#8-api-key--credential-storage)
9. [Computer Use — Full Implementation Deep Dive](#9-computer-use--full-implementation-deep-dive)
10. [Assessment & Patterns Worth Porting](#10-assessment--patterns-worth-porting)

---

# 1. Repository Topology

```
orca/
├── src/
│   ├── main/          Electron main process — ~60 domain folders, the bulk of the system
│   ├── renderer/      React 19 + zustand + xterm.js UI (also compiled to a web client)
│   ├── preload/       contextBridge IPC contract (index.ts 210 KB, api-types.ts 147 KB)
│   ├── shared/        Wire protocols, crypto, types shared by main/renderer/cli/relay
│   ├── cli/           `orca` binary — handlers/, specs/, runtime/
│   ├── relay/         The REMOTE HOST AGENT (runs on SSH box / WSL) — not the cloud relay
│   └── types/         Ambient build constants
├── native/
│   ├── computer-use-macos/     Swift package (main.swift 172 KB) — ZERO dependencies
│   ├── computer-use-linux/     Python runtime.py (44 KB) — AT-SPI2 via PyGObject
│   ├── computer-use-windows/   runtime.ps1 (53 KB) — UIAutomation via PowerShell
│   ├── notification-status-macos/
│   └── windows-cli-launcher/   C# launcher
├── mobile/            React Native / Expo companion app (own pnpm workspace)
├── skills/            Agent-facing skill stubs (computer-use, orchestration, orca-cli…)
├── config/            ~200 build/verify/benchmark scripts, lint configs, budgets
├── tests/             Playwright e2e (electron-headless / electron-headful)
└── docs/              STYLEGUIDE + reference/ (5 compatibility contracts)
```

### Naming discipline (AGENTS.md)

The project **bans** `helpers`, `utils`, `common`, `misc`, `shared-stuff` as file names, and **bans disabling `max-lines`** (enforced by `check:max-lines-ratchet`). Hence 300+ hyper-specific files in `src/main/ipc/`. Trade-off: high file count, near-zero hidden coupling.

---

# 2. End-to-End Architecture

## 2.1 Process model

```mermaid
flowchart TB
    subgraph Clients
      DESK["Electron Renderer<br/>(React+xterm, sandbox:true)"]
      WEB["Web client<br/>(same renderer, projected)"]
      MOB["Mobile app<br/>(React Native)"]
      CLI["orca CLI<br/>(agents script this)"]
    end

    subgraph HostMachine["Host machine"]
      MAIN["Electron MAIN process"]
      RPC["OrcaRuntimeRpcServer<br/>unix-socket + named-pipe + ws/wss"]
      DAEMON["TERMINAL DAEMON<br/>detached • survives app restart<br/>owns all node-pty + headless xterm"]
      VAULT["AI Vault service process"]
      PLUG["Plugin host workers (fork, scrubbed env)"]
      WATCH["Parcel-watcher child pool"]
      NATIVE["Computer-use native helper"]
    end

    subgraph Remote["Remote hosts"]
      RELAY["src/relay agent over SSH / WSL"]
      RPTY["remote node-pty + git + fs"]
    end

    subgraph Cloud
      CRELAY["Orca cloud relay (NAT traversal, E2EE passthrough)"]
    end

    DESK -- "Electron IPC (contextBridge)" --> MAIN
    CLI -- "NDJSON over unix socket / named pipe, authToken, 0600" --> RPC
    WEB -- "ws + JSON-RPC" --> RPC
    MOB -- "wss + NaCl E2EE v2, per-device token" --> RPC
    MOB -. "off-LAN" .-> CRELAY --> RPC

    MAIN --> RPC
    MAIN -- "NDJSON, per-launch UUID token" --> DAEMON
    MAIN --> VAULT
    MAIN --> PLUG
    MAIN --> WATCH
    MAIN -- "unix socket" --> NATIVE
    MAIN -- "SSH multiplex" --> RELAY --> RPTY
    DAEMON --> AGENTS["Agent CLIs: claude · codex · gemini · opencode · amp · droid · cursor · copilot · grok · kimi …"]
```

### Why the daemon exists (the core architectural bet)

PTYs are **not** owned by Electron main. They live in a **detached daemon** so that:

- Quitting/restarting/updating Orca does **not** kill running agents.
- A renderer crash, GPU crash, or main-process OOM doesn't take down 20 agent sessions.
- Multiple clients (desktop + web + phone) attach to the *same* live session.

The daemon holds a **headless xterm** (`@xterm/headless` + `@xterm/addon-serialize`) per session, so it can serialize a terminal's full visual state and replay it to a newly-attached client.

## 2.2 Endpoint-ownership protocol (daemon socket)

From `src/main/daemon/AGENTS.md`:

> **Only a daemon publishing itself onto the canonical endpoint may mutate that directory entry, and only by replacing an entry it has itself just proven dead. No actor removes a name it did not create.**

Protocol:

1. Bind a private `.p<hex>` name (`randomBytes(5)`).
2. Try exclusive `link()` to the canonical path.
3. On `EEXIST`, prove incumbent dead by connecting.
4. Re-check the entry hasn't changed hands.
5. Probe once more.
6. `rename()` in one syscall.
7. Verify we kept it.

Documented traps:

- **"Can't tell" ≠ "dead."** Only `refused`/`missing` prove death; `ETIMEDOUT`/`EPERM` must decline.
- **`link` first, never unconditional `rename`** — `rename` would let a starting daemon destroy a healthy one.
- **`rename`, never `unlink`-then-`link`** — measured: unlink+link gapped on essentially every observation during live handover; rename gapped on **none in ~14,500 probes**.
- **Never identify entries by `birthtimeMs`.**
- **No sweeper** — "the last one produced five defects, including deleting a live listener's only pathname."

Seven review rounds against the naive design produced **23 defects**, all the same interleaving.

## 2.3 Transport matrix

| Transport | Consumer | Framing | Auth | Hardening |
|---|---|---|---|---|
| Electron IPC | Desktop renderer | contextBridge | Process identity | `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false` |
| Unix socket / named pipe | `orca` CLI | NDJSON | Shared `authToken` from `orca-runtime.json` | `chmod 0600`, 1 MB max msg, 30 s idle, **32 max connections** |
| Daemon socket | Main ↔ daemon | NDJSON (16 MB max line) | Per-launch `randomUUID()` in `0600` token file | Endpoint-ownership protocol |
| `ws://` / `wss://` | Web + mobile | JSON-RPC + binary terminal frames | Per-device 192-bit token | Self-signed P-256 TLS, fingerprint pinned via QR |
| NaCl E2EE v2 | Mobile | Encrypted envelopes | X25519 ECDH + HKDF | Directional keys, transcript binding |
| Cloud relay | Off-LAN mobile | Relay control protocol | HMAC host-proof + Ed25519 | 10 s challenge window, 30 s clock skew |
| SSH multiplex | Remote worktrees | `src/relay` protocol | User's own SSH | Credit-based flow control |

## 2.4 Binary terminal stream protocol

`src/shared/terminal-stream-protocol.ts` — 16-byte header: kind `0x74`, version, opcode, reserved, `uint32 streamId`, `uint64 seq` (two LE uint32s).

```
Output=1  SnapshotStart=2  SnapshotChunk=3  SnapshotEnd=4  Resized=5  Error=6
Input=7   Resize=8  Subscribe=9  Unsubscribe=10  SnapshotRequest=11  Metadata=12
Ack=13    ClaimViewport=14  OutputSpan=15  SetOutputPaused=16  WriteUnavailable=17
```

**Wire-compatibility contract** (`docs/reference/remote-wire-compatibility.md`):

- **Rule 1:** new optional JSON field = safe (decoders `.strip()`).
- **Rule 2:** a new opcode is **not** safe — `decodeTerminalStreamFrame` returns `null` and the frame is *silently dropped*. New opcodes must be capability-negotiated (the `SetOutputPaused=16` pattern).
- **Rule 3:** changing *what the host publishes* breaks old clients with **no wire change at all**.
- Opcode numbers are **permanent** (`Ack=13` renumbered around `Metadata=12` which shipped to mobile in v1.4.120).

---

# 3. Module-by-Module Deep Dive

### Agent layer — 17 supported agents

`AI_VAULT_AGENTS` in `src/shared/ai-vault-types.ts`:
`claude · codex · hermes · pi · omp · prime-agent · cursor · gemini · antigravity · rovo · copilot · opencode · grok · openclaw · devin · droid · kimi`

Each has a dedicated main-process folder plus account/usage/rate-limit siblings. Agents are **not** SDK-integrated — Orca drives their real TUIs in real PTYs.

### Agent status detection — "hooks"

`src/main/agent-hooks/` + `src/relay/agent-hook-server.ts`. Orca installs *managed hooks* into each agent's config so the agent CLI reports lifecycle events (started / waiting-for-input / finished) over a local socket. Includes install locking, owner identity, and a WSL bridge.

### Workspace model

Three first-class kinds (AGENTS.md mandates all changes consider each):

1. **Git worktree** — APFS clone fast-path, sparse checkout, symlink reconciliation, lineage pruning, trash-based deletion.
2. **Folder workspace** — plain directory, no git.
3. **Remote** — SSH, WSL, Docker, ephemeral VM.

### Orchestration (multi-agent coordination)

`src/main/runtime/orchestration/` — a **255 KB `db.ts`** on SQLite. Coordinator, worker dispatch, run delivery, federation-sync, mutation ledger, question takeover, lifecycle reconciliation, retention pagination, version-skew migration. Uses `timingSafeEqual` for internal claim verification.

### Integrated browser

`src/main/browser/` (60+ files) — Electron `WebContentsView` guests with CDP bridge, screencast streaming, cookie import (Chrome/Safari/Comet/Helium), anti-detection UA shaping, WebAuthn, certificate trust controller, Design Mode. `agent-browser` ~0.27.0 as an npm dependency.

### Mobile emulator control

`src/main/emulator/` — Android via **scrcpy** + MJPEG frame parsing; iOS Simulator via `serve-sim-*` with an accessibility-tree normalizer.

### Plugin system

`src/main/plugins/` (~90 files) — marketplace, install provenance, content-hash integrity, **kill-list service** (remote revocation), audit log, language packs, per-plugin secret vault, panel bridge in a sandboxed iframe `srcdoc`.

### Other modules

- `src/main/ai-vault/` — cross-agent session history index.
- `src/main/native-chat/` — Orca's own chat UI over agents.
- `src/main/speech/` — dictation (OpenAI Whisper key stored encrypted).
- `src/main/skills/` + `skill-guides/` + `skill-stubs/` — version-matched agent guides served *by the binary*.
- `hang-watchdog/`, `crash-reporting/`, `observability/` — tracer, redactor, local file sink, GPU crash fallback tracker.
- `orca-profiles/` — multi-profile with separate userData paths and cloud sessions.
- i18n: 7 locales with 3 CI gates.

---

# 4. Concurrent Agent Sessions, Processes & Performance

## 4.1 Isolation strategy

Each agent session gets:

1. **Its own git worktree** — filesystem isolation.
2. **Its own PTY session in the daemon** — `pty-session-id.ts` mints `${worktreeId}\0${uuid8}`, partitioning session identity by worktree (used by `worktree-removal-session-partition-fencing.ts`).
3. **Its own agent CLI subprocess tree**, with descendant termination.

## 4.2 Three-stage backpressure chain

```mermaid
flowchart LR
    A["Agent CLI writes to PTY"] -->|kernel pipe| B["node-pty in DAEMON"]
    B -->|"pause()/resume()"| C["DaemonSession pendingOutput 2MB cap"]
    C -->|"2ms batch"| D["DaemonStreamDataBatcher NDJSON"]
    D --> E["MAIN PtyProducerFlowController"]
    E -->|"256KB high / 32KB low"| F["PtyPendingDataDrainQueue (3 lanes)"]
    F -->|"Electron IPC"| G["Renderer xterm"]
    E -.->|backpressure| B
```

**Stage 1 — Kernel-level (the only *real* backpressure).**
`src/main/ipc/pty-producer-flow-control.ts`:

```
PRODUCER_FLOW_HIGH_WATERMARK_CHARS  = 256 * 1024
PRODUCER_FLOW_LOW_WATERMARK_CHARS   =  32 * 1024
PRODUCER_PAUSE_REASSERT_INTERVAL_MS = 5_000
```

Above HIGH, main tells the daemon to `node-pty.pause()` → stops reading the fd → **kernel pipe fills → the flooding agent blocks on `write()`**.

**Stage 2 — Daemon coalescing** (`daemon-stream-data-batcher.ts`):

```
STREAM_DATA_BATCH_INTERVAL_MS     = 2       // half-window here + half in main
SHALLOW_SOCKET_WRITE_GATE_BYTES   = 128 KB  // above socket highWaterMark (~16KB)
BULK_WRITE_SLICE_CHARS            = 64 KB
HELD_WRITE_THROUGH_TOTAL_CHARS    = 32 MB   // safety valve
SMALL_SESSION_HOLD_BYPASS_CHARS   = 4 KB    // small sessions skip the FIFO
```

The 2 ms interval was chosen because the previous value cost "~8 ms of the measured ~19 ms DSR-under-load latency."

**Stage 3 — Priority scheduling in main.**
`PtyPendingDataDrainQueue` — hand-rolled intrusive doubly-linked multi-lane queue: **active / background / blocked**, plus round tracking, so a visible pane's bytes never queue behind 19 hidden panes.

## 4.3 Dropping output nobody can see

**Hidden delivery gate** (`pty-hidden-delivery-gate.ts`): drops renderer-bound bytes **after model ingestion** when no visible view consumes the PTY. Sidecar consumers register *delivery interest* to suppress it.

**Droppable-session keep-tail-drop**: background sessions' queued output can be dropped keeping only the tail — but `salvageDroppedData` extracts **reply-eliciting query bytes (DSR / DA / DECRQM / OSC probes)**, because "the hidden program blocks on the reply."

**Interactive fast-path** (`daemon-server.ts`):

```
INTERACTIVE_OUTPUT_WINDOW_MS  = 100
INTERACTIVE_OUTPUT_MAX_CHARS  = 1024
```

## 4.4 Terminal parking (the scale mechanism)

`terminal-hidden-view-parking.ts`:

```
TERMINAL_WORKTREE_COLD_PARK_DELAY_MS  = 30_000
TERMINAL_WORKTREE_HOT_RETAIN_MS       = 5 * 60_000
TERMINAL_WORKTREE_HOT_RETAIN_LIMIT    = 4          // ← PRIMARY evictor
TERMINAL_TAB_HOT_RETAIN_LIMIT         = 6
```

> "The cap (not the clock) is the primary evictor — 4 worktrees covers the ordinary working set… Reveal cost is a flat ~170ms remount regardless of buffer size, so cutting remount *frequency* beats shaving replay."

Parked panes are unmounted from DOM/xterm entirely; the PTY keeps running in the daemon; reveal replays the daemon's headless-xterm snapshot. `parked-terminal-mode2031-responder.ts` answers terminal queries while parked so the TUI doesn't hang.

## 4.5 Process isolation for expensive work

| Work | Isolation | Bounds |
|---|---|---|
| PTYs | Detached daemon | Endpoint ownership protocol |
| AI Vault scanning | Dedicated service process per host | 1 active request, **queue depth 16**, 130 s scan timeout, 15 s title timeout |
| Plugins | `fork()` per plugin, `ELECTRON_RUN_AS_NODE` | 64 max pending events, 2 s shutdown grace → SIGKILL |
| File watching | Parcel-watcher child **pool** | Capacity waits, crash fuse, quarantine queue, in-process fallback |
| Computer use | Native helper process | Unix socket, session ownership |

## 4.6 Priority semaphore

`src/main/daemon/priority-semaphore.ts` — FIFO-within-priority async semaphore; on release, scans for lowest priority number, FIFO among ties.

## 4.7 Performance as a CI gate

13 benchmark scripts, 9 perf e2e suites. Hard budgets in `config/scripts/check-terminal-perf-report-budgets.mjs`:

```
maxMedianKeyLatencyMs        = 75
maxWorstKeyLatencyMs         = 300
maxRevisitLatencyMs          = 300
maxTimerDriftMs              = 150      (2500 under injected multi-pane load)
maxScrollLatencyMs           = 150
maxRestoreLatencyMs          = 1000
maxRendererQueuedChars       = 2 MB
maxRendererPeakQueuedChars   = 2 MB
maxRendererDroppedBacklogs   = 0        ← zero tolerance
```

Plus `check:reliability-gates` — a manifest with maturity levels, flake status (`not-started|unknown|soaking|stable|flaky`), and a **blocking promotion policy** requiring minimum soak runs/days.

## 4.8 Renderer performance

One zustand store, ~50 slices.

**Store listener census** (`store-listener-census.ts`) — patches `api.subscribe` *inside* the state creator, because patching the bound hook counts only 16 imperative callers and misses **~2,200 React hook subscriptions**.

**Memory profile contributors** — registers by *count* and by *sampled KB*: "counts miss value-weight growth (97b9e86d leaked ~700MB while its biggest slice grew by 4 entries)."

---

# 5. Concurrent Streaming to the UI

## 5.1 Multi-client fanout

```mermaid
sequenceDiagram
    participant Agent
    participant Daemon
    participant Main
    participant Desktop
    participant Mobile
    Agent->>Daemon: PTY bytes
    Daemon->>Daemon: feed headless xterm (model)
    Daemon->>Daemon: batch 2ms, per-client queues
    Daemon->>Main: NDJSON stream event
    Main->>Desktop: IPC (lane-scheduled)
    Main->>Mobile: binary frame Output(seq) over E2EE ws
    Mobile-->>Main: Ack(13) with byte count
    Note over Main,Mobile: credit window grows 512KB → 2MB
```

`DaemonStreamDataBatcher` keys pending batches **by clientId**, so a slow phone on cellular cannot stall the desktop.

## 5.2 Remote multiplex credit flow control

`src/shared/terminal-multiplex-flow-control.ts`:

```
TERMINAL_STREAM_CHUNK_BYTES                          = 48 KB
TERMINAL_OUTPUT_BATCH_MAX_BYTES                      = 64 KB
ACK_STREAM_INITIAL_WINDOW_BYTES  = 512 KB → MAX 2 MB   (per stream)
ACK_TOTAL_INITIAL_WINDOW_BYTES   = 2 MB   → MAX 8 MB   (per connection)
TERMINAL_MULTIPLEX_PENDING_MAX_BYTES                 = 256 KB
TERMINAL_MULTIPLEX_ACK_BATCH_BYTES                   = 192 KB
TERMINAL_MULTIPLEX_ACK_FLUSH_MS                      = 4
MAX_ACTIVE_STREAMS_PER_CONNECTION                    = 128
MAX_PENDING_PTY_WAITS_PER_CONNECTION                 = 32
```

Windows grow **additively as acks arrive** (TCP-slow-start-like) up to a cap.

## 5.3 Fair scheduling

`drainTerminalMultiplexRoundRobin` — cursor-based round-robin; loop repeats while any stream progressed. No stream starves.

## 5.4 Lane scheduling (relay writer)

`src/relay/dispatcher-writer-lane-scheduler.ts` — six lanes with anti-starvation counters:

```
liveness > control > legacy-response > {fixed-bulk|bulk} > ordinary > interactive
PRODUCER_WRITES_BEFORE_BULK        = 4
INTERACTIVE_WRITES_BEFORE_ORDINARY = 4
```

## 5.5 Relay credit ledger (SSH)

`src/relay/pty-source-credit-record.ts` — per-delivery accounting in "SU" (source units):

```
DEFAULT_RETAINED_SOURCE_SU             = 512 KB   AGGREGATE = 48 MB
DEFAULT_RETAINED_DATA_BYTES            = 2 MB     AGGREGATE = 64 MB
DEFAULT_RETAINED_SPANS                 = 1_024    AGGREGATE = 64 K
MAX_SOURCE_SPAN_DATA_BYTES             = 1 MB
CLOSED_DELIVERY_TOMBSTONE_LIMIT        = 256
```

`DeliveryRecord` is a 4-state machine (`active → sealed-unsettled → closing → closed`) with `receivedEndSu / sentEndSu / creditedEndSu` — a full at-least-once ledger with resumable offsets across SSH reconnects.

## 5.6 Mobile payload diet

```
MOBILE_SUBSCRIBE_SCROLLBACK_ROWS = 1000    // vs 50,000 rows in the desktop renderer
MOBILE_SNAPSHOT_BYTE_BUDGET      = 512 KB
```

The dispatcher receives `clientKind: device.scope`, gating the mobile-only payload diet.

---

# 6. Security

## 6.1 Electron hardening

| Setting | Value |
|---|---|
| `sandbox` | `true` (main window, popout, browser guests, offscreen, html-to-pdf) |
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `nodeIntegrationInSubFrames` | `false` |
| `webSecurity` | `true` |
| `allowRunningInsecureContent` | `false` |
| `webviewTag` | `false` for popout/browser guests; `true` for main window (browser feature) |

`installPrivilegedWindowNavigationPolicy` — `setWindowOpenHandler` returns `{action:'deny'}` unconditionally; `will-navigate` calls `preventDefault()` on everything (dev-only same-origin exception). Rationale: *"Keep remote documents from inheriting an Orca window's privileged preload."*

## 6.2 Filesystem hardening — `writeSecureFile`

`src/shared/secure-file.ts`:

1. `mkdirSync(dir, {mode: 0o700})`
2. Write temp `${target}.${pid}.${Date.now()}.${randomBytes(4).hex}.tmp` with `mode: 0o600`
3. **On Windows, apply the ACL synchronously to the temp file before rename** (writeFileSync `mode` is a no-op on Windows)
4. `renameSync` (atomic publish)
5. Re-harden published path; cache **only on confirmed success**

Windows ACL application shells out to PowerShell (~1–1.5 s), so there's a bounded `SecurePathHardeningCache` (1024 entries / 64 KB per key / 512 KB total) keyed on `dev/ino/size/mode/ctime/mtime/birthtime` (issue #4901).

## 6.3 Log/telemetry redaction

`src/main/observability/redactor.ts` runs at **three** points — sink-write, bundle-collection, server-ingest: *"the server pass is defense-in-depth since the client runs on an attacker-controllable binary."*

```
anthropic-key  sk-ant-[a-zA-Z0-9_-]{40,}
openai-key     sk-(?:proj-)?[a-zA-Z0-9_-]{32,}
github-token   gh[pousr]_[A-Za-z0-9]{36,}
aws-access-key AKIA[0-9A-Z]{16}
aws-secret     aws_secret_access_key\s*[:=]\s*[A-Za-z0-9/+=]{40}
jwt            eyJ...
slack-token    xox[baprsoe]-[A-Za-z0-9-]{10,}
pem            -----BEGIN … -----END …   (lazy → back-to-back blocks redact independently)
```

Plus labeled-KV redaction, URL userinfo stripping (`https://user:pass@` **and** bare-token `<pat>@` "seen in failing git stderr"), per-line `.env` redaction, attribute-key blocklist. Server mode also strips `install_id`/`distinct_id`.

Telemetry is **compile-time gated**: `ORCA_BUILD_IDENTITY` / `ORCA_POSTHOG_WRITE_KEY` are substituted as literals by CI only. *"There is no runtime env-var fallback — so a curious contributor cannot spoof transmission with a shell export."* Consent honors `DO_NOT_TRACK` and 8 CI env vars.

## 6.4 Agent-facing hardening

**Git credential prompt guard** (`shared/terminal-git-credential-guard.ts`) — for recognized agent processes or unattended sessions, injects `GIT_ASKPASS`/`SSH_ASKPASS`/indexed `GIT_CONFIG_*` to **disable interactive credential UI**.

**Plugin worker env scrubbing** — the fork does *not* spread `process.env`: *"never `...process.env`, which can carry shell-exported secrets into third-party code."* `execArgv: []` because *"inspector/loader flags from Orca's own launch must never execute inside third-party plugin workers."*

**Plugin identity trust** — reserved `stablyai.orca-*` identities cannot be installed from a local path and must resolve to the stablyai GitHub org. Plus a **kill-list service** for remote revocation and content-hash integrity.

## 6.5 Input validation

- RPC params validated with **zod**.
- JSON structure limits: `TERMINAL_STREAM_JSON_MAX_BYTES = 8 MB`, `structuralTokens: 256K`, `nestingDepth: 32` — anti-JSON-bomb.
- `git-exec-validator.ts`, `git-buffer-overflow.ts` on the relay.
- Canonical base64 validation in the relay host proof (re-encodes and compares).

## 6.6 Honest weaknesses

| # | Finding | Severity | Detail |
|---|---|---|---|
| 1 | `DeviceRegistry.validateToken` is not constant-time | Low | Plain `===` on a 192-bit token; `relay-host-proof.ts` and `orchestration/db.ts` *do* use `timingSafeEqual`. Inconsistent, cheap to fix. |
| 2 | Plaintext fallback when `safeStorage` unavailable | Medium | Linear, Jira, MiniMax cookie, OpenAI speech key log a warning and write plaintext. Plugin secrets correctly **fail closed**. |
| 3 | Linear/Jira token files bypass `writeSecureFile` | Medium (Windows) | Raw `writeFileSync(..., {mode: 0o600})`; `mode` is a **no-op on Windows**. Contents are still DPAPI-encrypted, so impact is bounded — but 12 other stores do it correctly. |
| 4 | Self-signed TLS with no rotation story | Low | 3650-day P-256 cert, fingerprint pinned at QR-pairing. No revocation/re-pin flow. |
| 5 | `openssl` is a runtime dependency | Low | TLS cert generation shells out to `openssl` (Git-for-Windows path fallbacks). |
| 6 | MCP secrets are not Orca's to protect | By design | See §8.5. |
| 7 | Agent trust presets pre-write trust markers | By design, documented | Bypasses the agent's own "do you trust this folder?" prompt. |

---

# 7. Multi-Device Support & Authentication

## 7.1 Three authentication realms

```mermaid
flowchart TB
    subgraph R1["Realm 1 — Local (same machine)"]
      A1["orca CLI"] -->|"shared authToken from orca-runtime.json (0600)"| A2["Runtime RPC over unix socket / named pipe (0600, 32 conns)"]
      A3["Main"] -->|"randomUUID token in 0600 file"| A4["Daemon socket"]
    end
    subgraph R2["Realm 2 — Paired devices (LAN)"]
      B1["Phone / web"] -->|"per-device 192-bit token + NaCl E2EE v2 over wss (pinned cert)"| B2["Runtime RPC ws transport"]
    end
    subgraph R3["Realm 3 — Relay (off-LAN)"]
      C1["Phone"] --> C2["Orca cloud relay"] -->|"HMAC host-proof, Ed25519 identity, E2EE passes through opaque"| C3["Desktop"]
    end
```

## 7.2 Per-device tokens

`src/main/runtime/device-registry.ts`:

```ts
{
  deviceId: randomUUID(),
  name,
  token: randomBytes(24).toString('hex'),   // 192 bits
  scope: 'mobile' | 'runtime',
  pairedAt, lastSeenAt,
  relayBinding?, mobilePairingConnectionMode?,
  pairingReach: 'this-computer' | 'network'
}
```

- **Durability before validity** — `save()` runs *before* the in-memory swap: *"a credential is not valid until its durable registry write succeeds."*
- **QR regenerate coalescing** — reuses an unscanned entry, else every QR render orphans a live credential forever.
- **Explicit rotation** — `rotatePendingDevice` invalidates a token that was "screenshotted, copied to clipboard, or shown on a screen-share."
- **Reach widening only** — `this-computer` can widen to `network`, never narrow.
- **`lastSeen` coalescing** — 250 ms debounce (each Windows save spawns PowerShell for ACLs); the `0 → non-zero` transition persists inline.

## 7.3 E2EE handshake (v2)

`mobile-e2ee-v2-key-schedule.ts`:

```
sharedSecret   = X25519(clientPub, desktopSecret)      // nacl.box.before
transcriptHash = SHA256(transcript)
salt           = SHA256("orca-mobile-e2ee/v2/salt\0" || clientNonce || desktopNonce)
info           = "orca-mobile-e2ee/v2/session\0" || transcriptHash
expanded       = HKDF-SHA256(sharedSecret, salt, info, 96 bytes)
  → mobileToDesktopKey = expanded[0:32]
  → desktopToMobileKey = expanded[32:64]
  → sessionId          = expanded[64:96]
```

Properties: **directional keys**, **domain-separated labels**, **transcript binding**, **both nonces in the salt** (32 bytes each, length-checked), explicit `sessionId`.

State machine: `awaiting_hello → awaiting_auth → ready`, with handshake timer, `requireV2` flag, close codes `4001` (unauthorized) and `4003` (too many decrypt failures). Transport limits: 4 MB plaintext max; base64 length checked **before** decoding; public keys reject >44 base64 chars before parsing.

## 7.4 Authorization — scope-based method allowlist

```ts
if (device.scope === 'mobile' && !MOBILE_RPC_METHOD_ALLOWLIST.has(request.method)) {
  reply(error(request.id, 'forbidden', `Method '${request.method}' is not available to mobile clients`))
}
```

~250 explicitly listed methods. A phone gets a **capability subset**, not a full runtime. Also enforced: `deviceToken` in the body must match the E2EE-bound identity, else `'Device token mismatch'`.

## 7.5 Brute-force protection

`UnpairedDeviceAuthThrottle` — 3 failures in 60 s triggers exactly **one** user-facing signal per runtime session.

## 7.6 Cloud relay authentication

`relay-host-proof.ts`:

```
HOST_PROOF_TRANSCRIPT_DOMAIN       = 'orca-relay-host-proof/v1'
HOST_CHALLENGE_PLAINTEXT_DOMAIN    = 'orca-relay-host-challenge/v1'
RELAY_HOST_PROOF_CLOCK_SKEW_MS     = 30_000
MAX_HOST_PROOF_CHALLENGE_WINDOW_MS = 10_000
```

Length-prefixed transcript encoding (`uint32 nameLen | name | uint32 valLen | val`) with **duplicate-field rejection** and exact-length termination. Canonical base64 validation. `timingSafeEqual` throughout. Failure reporting is by **name only**: *"never receives field values."*

## 7.7 Network exposure defaults

```
WS_BIND_HOST_LOOPBACK       = '127.0.0.1'   // default
WS_BIND_HOST_ALL_INTERFACES = '0.0.0.0'     // only on explicit pairing widen
```

Widening fails safe. Headless `serve` advertises via `--pairing-address` (docs recommend **Tailscale**); the docs are explicit that it changes only the *advertised* address, never the bind.

---

# 8. API Key & Credential Storage

## 8.1 The primitive: Electron `safeStorage`

| OS | Backend |
|---|---|
| macOS | Keychain (`kSecClassGenericPassword`, item named after `app.setName`) |
| Windows | DPAPI (`CryptProtectData`, user+machine scoped) |
| Linux | libsecret / kwallet, falls back to `basic_text` |

## 8.2 Complete credential inventory

| Secret | Module | Encryption | Hardened write | Fallback |
|---|---|---|---|---|
| **Linear API key** (per workspace) | linear/client.ts | safeStorage | ✗ raw `writeFileSync 0600` | ⚠ plaintext + warn |
| **Jira API token** (per site) | jira/client.ts | safeStorage | ✗ raw `writeFileSync 0600` | ⚠ plaintext + warn |
| **Plugin secrets** (per plugin) | plugins/plugin-secrets-store.ts | safeStorage | ✓ `writeSecureFile` | ✅ **fail closed** |
| **Orca Cloud session** | orca-profiles/profile-cloud-session-store.ts | safeStorage | ✓ `writeSecureJsonFile` | dev-only, gated |
| **MiniMax session cookie** | minimax/minimax-cookie-store.ts | safeStorage | ✓ `writeSecureFile` | ⚠ plaintext + warn |
| **OpenAI speech key** | speech/openai-api-key-store.ts | safeStorage | ✗ `writeFileSync 0600` | ⚠ plaintext + warn |
| **Proxy URL, OpenCode cookie, Kagi link, SSH PTY leases** | protected-secret-persistence.ts | safeStorage | via persistence | fail-closed |
| **Device tokens** | runtime/device-registry.ts | plaintext (is the credential) | ✓ `writeSecureJsonFile` | — |
| **E2EE keypair** | runtime/e2ee-keypair.ts | plaintext (0600 + ACL) | ✓ `writeSecureJsonFile` | — |
| **TLS cert + key** | runtime/tls-certificate.ts | plaintext | `chmodSync 0600` | — |
| **Runtime authToken** | runtime/runtime-metadata.ts | plaintext | ✓ `writeSecureJsonFile` | — |
| **Daemon token** | daemon/daemon-server.ts | `randomUUID()` | `writeFileSync 0600` | — |
| **GitHub / GitLab / Bitbucket / Gitea / Azure DevOps** | */client.ts | **not stored** | — | delegates to user's `gh`/`glab` CLI |

**Orca never takes custody of git-provider tokens** — it shells out to the user's already-authenticated `gh`/`glab` CLI.

## 8.3 `ProtectedSecretPersistence` — the fail-closed engine

Problem: the settings file holds secrets *and* config. If the keychain is temporarily unavailable, a naive impl would **overwrite ciphertext with an empty string** on the next settings save.

Design:

- `retainedBlobs: Map<slot, ciphertext>` — keeps last-seen ciphertext.
- `sealedSlots: Set<slot>` — slots whose plaintext could not be obtained.
- Encrypt with encryption unavailable → returns **retained ciphertext** + `degraded: true`. Nothing lost.
- Decrypt failure → `{plaintext: '', status: 'failed'}` and seals the slot: *"retaining the protected value without exposing it."*
- Legacy plaintext migration is opt-in via a `LegacyPlaintextValidator` predicate.
- `isSealed(slot, value)` prevents the renderer's masked placeholder from being re-encrypted as the real value.

## 8.4 Legacy-plaintext detection

```ts
const plaintext = decodeUtf8(raw)                       // TextDecoder fatal:true
if (plaintext === null || hasControlCharacter(plaintext)) {
  throw new CredentialDecryptionError(service)          // it's ciphertext, not legacy
}
```

Any byte `< 0x20` or `0x7f` proves ciphertext.

## 8.5 MCP server credentials

**Orca does not store MCP credentials at all.** `src/shared/mcp-config.ts` is a *read-only inspector* over:

```
.mcp.json          (workspace)
.cursor/mcp.json   (Cursor)
.claude.json       (Claude)
.claude/mcp.json   (Claude workspace)
```

Masking (`mcp-server-inspection.ts`):

```ts
SENSITIVE_ENV_KEY_PATTERN =
  /(api[_-]?key|auth|bearer|cookie|credential|password|private[_-]?key|secret|session|token)/i
SENSITIVE_ENV_VALUE_PATTERN =
  /(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})/
// → masked[key] = '••••••••'
```

Masking triggers on **key name OR value shape**. Bounded by max-servers / max-env-fields / per-field size limits.

**Implication:** a Slack/Instagram key in an MCP `env` block sits in the user's own plaintext `.mcp.json`, exactly as it would without Orca. Orca's contribution: never copies it, masks it in UI, redacts it from telemetry.

For *managed* channel credentials, the model to copy is `PluginSecretsStore`:

```
<pluginsDataDir>/<qualifiedKey>/secrets.json.enc
{ version: 1, format: 'electron-safe-storage-v1', ciphertexts: { key: base64 } }
```

with **no plaintext fallback** — *"writes fail loudly instead of silently downgrading — plugin secrets are API-token grade."*

## 8.6 Threat table

| Threat | Outcome |
|---|---|
| Read credential file off disk | ✅ Blocked — DPAPI/Keychain-encrypted |
| Another local user | ✅ Blocked — `0600` / per-user ACL |
| Malicious plugin reads `process.env` | ✅ Blocked — scrubbed env allowlist |
| Agent exfiltrates via git credential prompt | ✅ Blocked — credential prompt guard |
| Passive LAN sniffing | ✅ Blocked — `wss` + NaCl E2EE |
| MITM on first pairing | ⚠ Mitigated — fingerprint delivered in-band via QR |
| Stolen phone | ✅ Per-device revocation + `terminateDeviceConnections` |
| Cloud relay operator | ✅ Cannot read traffic — E2EE terminates at endpoints |
| Secrets in crash reports | ✅ Three-stage redactor |
| Local process running as the user | ⚠ Standard desktop trust boundary |

---

# 9. Computer Use — Full Implementation Deep Dive

## 9.1 THE HEADLINE: no third-party automation framework

**Orca uses NO PyAutoGUI, NO `pynput`, NO Playwright-for-desktop, NO Anthropic CUA reference container, NO Selenium, NO `robotjs`/`nut.js`, NO OpenAI CUA SDK.**

Verified: `native/computer-use-macos/Package.swift` has **zero `.package(url:)` entries** — the Swift target depends only on its own local core module. The Linux script imports only `gi` (PyGObject, a system package). The Windows script is plain PowerShell + .NET assemblies already on the box.

Every platform talks **directly to the OS accessibility + synthetic-input APIs**.

### Platform stack table

| Platform | Language | Accessibility API | Synthetic input | Screenshots | Clipboard |
|---|---|---|---|---|---|
| **macOS** | Swift 6 (`.macOS(.v14)`) | **AXUIElement** (`ApplicationServices`) | **CGEvent** (`CoreGraphics`) | **ScreenCaptureKit** (`SCScreenshotManager`) | `NSPasteboard` |
| **Linux** | Python 3 + PyGObject | **AT-SPI2** (`gi.repository.Atspi`) | `Atspi.generate_mouse_event` / `generate_keyboard_event`, **`xdotool`** fallback | `Gdk` / `GdkPixbuf` | `wl-copy` / `wl-paste` / `xclip` / `xsel` |
| **Windows** | PowerShell 5+ | **UIAutomation** (`UIAutomationClient` / `UIAutomationTypes`) | `user32.dll` P/Invoke: `SendInput`, `mouse_event`, `SetCursorPos` | `System.Drawing` `CopyFromScreen` | `System.Windows.Forms.Clipboard` |

Measured API usage in `main.swift` (172 KB):

```
81 × AXUIElement*            12 × AXUIElementCopyAttributeValue
13 × kAXValueAttribute        9 × AXUIElementSetAttributeValue
 7 × kAXTitleAttribute        6 × CGEvent / 5 × CGEventFlags
 7 × kAXRoleAttribute         4 × AXUIElementCreateSystemWide
 6 × NSWorkspace              3 × AXUIElementPerformAction
 2 × CGWindowListCopyWindowInfo   1 × SCScreenshotManager / SCContentFilter
 1 × AXIsProcessTrusted
```

Windows UIAutomation control patterns used: `InvokePattern` (×4), `TogglePattern` (×4), `ValuePattern` (×3), `ScrollPattern`, plus `AutomationElement` tree walking.

### Why build it themselves?

1. **Accessibility trees, not pixels.** PyAutoGUI/CUA reference stacks are screenshot+coordinate driven. Orca reads the *semantic* AX tree (role, title, value, actions, traits) and hands the agent an indexed element list. Cheaper in tokens, far more reliable than pixel-matching, and resilient to theme/DPI changes.
2. **TCC attribution on macOS.** Accessibility + Screen Recording grants attach to the requesting process. A Python/Node library inside Electron would attach the grant to the whole IDE.
3. **Zero supply chain.** A desktop-automation dependency is the single most dangerous place to accept third-party code — it can move your mouse and read your screen.
4. **Signed helper.** Only a separately-signed executable can own its own TCC grant cleanly.

## 9.2 Two provider implementations, one interface

```mermaid
flowchart LR
    A["Agent CLI"] -->|"ORCA computer <verb> --json"| B["orca CLI"]
    B -->|"NDJSON over unix socket / named pipe (authToken)"| C["Runtime RPC"]
    C --> D["ComputerProviderLifecycle.current(platform)"]
    D -->|darwin + macOS 14+ + helper present| E["MacOSNativeProviderClient<br/>(persistent socket)"]
    D -->|otherwise| F["DesktopScriptProviderClient<br/>(one-shot exec)"]
    E -->|"unix socket, NDJSON + token"| G["Orca Computer Use.app<br/>signed Swift helper, detached"]
    G --> H["AXUIElement · CGEvent · ScreenCaptureKit"]
    F -->|"execFile + JSON op file"| I["python3 runtime.py (AT-SPI)<br/>powershell runtime.ps1 (UIAutomation)"]
```

`ComputerProviderLifecycle.current(platform)` lazily instantiates and caches; both are disposed on `shutdown()`:

```ts
if (platform === 'darwin') {
  if (this.nativeMacOSProvider) return this.nativeMacOSProvider
  if (this.deps.shouldUseMacOSNativeProvider()) { /* create + cache */ }
}
if (this.desktopScriptProvider) return this.desktopScriptProvider
if (this.deps.shouldUseDesktopScriptProvider()) { /* create + cache */ }
return null
```

Availability gate:

```ts
shouldUseMacOSNativeProvider() =
  process.platform === 'darwin' && isMacOS14OrNewer() && resolveMacOSComputerUseExecutablePath() !== null
```

## 9.3 macOS: persistent helper + socket handshake

**Helper resolution** (`macos-native-provider-paths.ts`) — env override → `process.resourcesPath/Orca Computer Use.app` → dev `.build/release` paths; the executable is `Contents/MacOS/orca-computer-use-macos`.

**Startup sequence** (`macos-native-provider-transport.ts`):

```ts
const socketDirectory = mkdtempSync(join(tmpdir(), 'orca-computer-use-'))
chmodSync(socketDirectory, 0o700)                      // private dir first
const socketPath      = join(socketDirectory, 'provider.sock')
const socketToken     = randomUUID()
const socketTokenPath = join(socketDirectory, 'provider.token')
writeFileSync(socketTokenPath, socketToken, { encoding: 'utf8', mode: 0o600 })

// direct spawn, NOT LaunchServices:
spawn(helperExecutablePath, ['--agent', socketPath, '--token-file', socketTokenPath],
      { detached: true, stdio: 'ignore' }).unref()
```

Two comments worth quoting:

> *"launching the nested helper via LaunchServices can make TCC evaluate Orca.app as responsible; the signed helper executable owns this grant."*

> *"connect failures happen after spawn; terminate the detached helper so repeated startup attempts do not leave orphan providers."*

The token file is **deleted immediately after the socket connects** — it exists only long enough for the helper to read it. Startup races `connectMacOSProviderSocket` against `waitForProviderLaunchFailure`, and a superseded start (`isCurrent(socketPath)` false) destroys its own socket + directory.

Every request line carries the token:

```
{"id":1,"method":"getAppState","params":{…},"token":"<uuid>"}\n
```

Client timeout: `REQUEST_TIMEOUT_MS = 60_000`. Shutdown sends `{method:'terminate'}` before `socket.end()`.

## 9.4 macOS: helper-side security

**Socket path safety** (`UnixSocketPathSafety.swift`):

```swift
shouldRejectExistingPathAfterBindFailure(bindErrno, existingMode) ->
    bindErrno == EADDRINUSE && !isSocketMode(existingMode)   // S_IFSOCK check
```

Refuses to clobber a non-socket at the bind path — a symlink/regular-file plant can't redirect the helper.

**Session ownership** (`AgentSessionOwnership.swift`):

```swift
registerConnection(id, authenticated) -> .rejected | .claimed | .retained
disconnect(id) -> Bool   // true only when the LAST authenticated conn drops

isAuthenticatedAgentSession(expectedToken, requestToken, authorizedPeer) -> Bool {
    guard authorizedPeer else { return false }     // peer credential check FIRST
    guard let expectedToken else { return true }
    return requestToken == expectedToken
}
```

Unauthenticated connections are `.rejected`. The first authenticated connection `.claimed`s; later ones are `.retained` (multi-client allowed). When the last disconnects, `sessionClosed = true` **permanently** — a dropped-then-reconnected attacker cannot inherit an owned session. `AuthenticatedConnectionHangupMonitor.swift` detects half-open connections.

## 9.5 Linux/Windows: one-shot file-based op protocol

`desktop-script-provider-bridge.ts` — deliberately **stateless**:

```ts
const command = platform === 'windows' ? 'powershell.exe' : 'python3'
const args = platform === 'windows'
  ? ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', scriptPath, operationPath]
  : [scriptPath, operationPath]

execFile(command, args, {
  env: process.env,
  maxBuffer: 20 * 1024 * 1024,   // screenshots are base64 in the JSON reply
  timeout: REQUEST_TIMEOUT_MS,   // 30_000
  windowsHide: true
})
```

Arguments are passed **as an argv array with a file path** — never string interpolation into a shell — so there is no command-injection surface even though the target app name comes from an LLM.

Two-stage kill:

```
30 s → SIGTERM → 1 s grace (FORCE_KILL_GRACE_MS) → SIGKILL
```

> *"native automation can hang inside platform APIs; reject promptly, then escalate cleanup if the bridge ignores the graceful termination."*

`mapBridgeError` translates stderr text into typed `RuntimeClientError` codes (`app_not_found`, `action_timeout`, `unsupported_capability`, `accessibility_error`, …).

The Python bridge documents its own contract:

> *"The Node sidecar owns Orca's public API. This process is intentionally a small AT-SPI adapter: read one JSON operation file, execute it in the user's desktop session, and print one JSON response."*

## 9.6 Sidecar process isolation

`src/main/computer/sidecar-entry.ts` runs the provider in a forked child with a tiny message protocol:

```ts
process.on('message', m => void handleMessage(m))
async function handleMessage(m) {
  try   { process.send?.({ id: m.id, ok: true,  result: await dispatch(m.method, m.params ?? {}) }) }
  catch { process.send?.({ id: m.id, ok: false, error: errorToResponse(error) }) }
}
process.once('disconnect', shutdownProviders)
process.once('SIGTERM', () => { shutdownProviders(); process.exit(0)   })
process.once('SIGINT',  () => { shutdownProviders(); process.exit(130) })
process.once('beforeExit', shutdownProviders)
```

So the chain is: **Electron main → sidecar (Node fork) → native helper (Swift/Python/PowerShell)** — two process boundaries between the IDE and any UI-driving code.

## 9.7 The action surface (14 CLI verbs)

`src/cli/specs/computer.ts`:

| Verb | Purpose |
|---|---|
| `capabilities` | Provider feature probe |
| `list-apps` | Running apps |
| `list-windows` | Windows for an app |
| `permissions` | Open macOS permission setup (`--id accessibility\|screenshots`) |
| `get-app-state` | **Compact AX snapshot** (+ optional screenshot) |
| `click` | Element index **or** x/y, click-count, mouse-button, modifiers |
| `perform-secondary-action` | Invoke an advertised AX action by name |
| `scroll` | Element or coordinate |
| `drag` | Drag gesture |
| `type-text` | Synthetic typing |
| `press-key` | Single key |
| `hotkey` | Modifier chord |
| `paste-text` | Clipboard-mediated insert |
| `set-value` | Direct AX value set (`AXUIElementSetAttributeValue`) |

App targeting: `--app <name|bundle|pid:N>`. Window targeting: `--window-id` or `--window-index`. Every action supports `--restore-window` and `--no-screenshot`.

**Element-index addressing is the key design.** `get-app-state` returns an indexed tree; the agent then says `click --element-index 12`. No pixel coordinates, no OCR, no vision model required — a *huge* reliability and cost win over screenshot-driven CUA loops.

`set-value` is especially notable: instead of simulating 40 keystrokes into a text field, it calls `AXUIElementSetAttributeValue(kAXValueAttribute)` directly. Instant, atomic, no focus-stealing.

## 9.8 The snapshot format

`SnapshotRendering.swift` normalizes each node to:

```swift
struct SnapshotRenderNode {
  role, roleDescription, title, label, linkText, value, placeholder, url
  traits: [String]
  rawActions: [String]      // advertised AX actions → drives perform-secondary-action
  childCount: Int
  summary, rowSummary       // collapsed representations for tables/lists
  webAreaDepth: Int?        // web content nesting inside a native window
}
```

Plus `SnapshotTabStripCompaction { retainedIndexes, omittedCount }` — tab strips are collapsed to a retained subset with a count of what was hidden, so a 40-tab browser doesn't blow the agent's context.

Linux caps the tree explicitly:

```python
MAX_NODES = 1200
MAX_DEPTH = 64
TEXT_LIMIT = 500
```

Screenshot budgets (Linux):

```python
MAX_SCREENSHOT_PNG_BYTES = 900_000
MAX_SCREENSHOT_EDGE      = 1280
MIN_SCREENSHOT_SCALE     = 0.25
SCREENSHOT_SCALE_STEP    = 0.85     # iteratively downscale until under budget
```

macOS capture uses ScreenCaptureKit with per-window filtering:

```swift
let content = try await SCShareableContent.current
let window  = content.windows.first { $0.windowID == windowId }
let filter  = SCContentFilter(desktopIndependentWindow: window)
let config  = SCStreamConfiguration()
config.width  = ceil(bounds.width  * backingScaleFactor)
config.height = ceil(bounds.height * backingScaleFactor)
config.scalesToFit = true; config.preservesAspectRatio = true
config.ignoreShadowsSingleWindow = true
config.ignoreGlobalClipSingleWindow = true
return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
```

Captures **only the target window**, not the whole screen — so unrelated windows (your email, another chat) never enter the agent's context. Wrapped in `BlockingAsync.run(timeout: 3)`.

## 9.9 Safety mechanisms (the best part)

### (a) Password-manager blocklist — all three platforms

macOS blocks by **bundle ID** (unspoofable):

```swift
private let blockedBundleIds: Set<String> = [
  "com.1password.1password", "com.1password.safari",
  "com.bitwarden.desktop", "com.dashlane.dashlanephonefinal",
  "com.lastpass.LastPass", "com.nordsec.nordpass",
  "me.proton.pass.electron", "me.proton.pass.catalyst",
]
```

Linux + Windows block by name fragment, checked against **both the app name and every window title**:

```python
BLOCKED_APP_FRAGMENTS = ("1password","bitwarden","dashlane","lastpass","nordpass","proton pass")

def reject_blocked_app(app):
    haystacks = [name_of(app).lower()] + [name_of(w).lower() for _, w in windows_for(app)]
    if any(frag in v for frag in BLOCKED_APP_FRAGMENTS for v in haystacks):
        raise RuntimeError(f'appBlocked("{name_of(app)}")')
```

Enforced inside `find_app()` — the agent cannot reach a blocked app by *any* code path (name, bundle, or PID). This is the single most important product decision in the feature: an agent with AX read access to 1Password could dump every credential the user owns.

### (b) Focus-gated synthetic input

`KeyboardInputSafety.swift`:

```swift
syntheticInputFocusFailure(targetWindowFocused, restoreWindowRequested) -> FocusFailure?
    // !targetWindowFocused → .targetNotFocused | .targetNotFocusedAfterRestore
```

Synthetic keystrokes are **refused** if the target window isn't focused. Without this, an agent typing into "Slack" while the user Cmd-Tabbed to their password manager would send keystrokes into the wrong app. This is the most important *safety* property in the feature, and they got it right.

### (c) Triple paste validation

Clipboard is the classic injection vector, so validation appears at three independent layers:

- `computer-clipboard-paste-validation.ts`
- `computer-sidecar-paste-validation.ts`
- `macos-native-provider-paste-validation.ts` (+ desktop-script equivalent)

Linux even paces the clipboard handoff:

```python
CLIPBOARD_COMMAND_TIMEOUT_SECONDS = 2
CLIPBOARD_OWNER_SETTLE_SECONDS    = 0.05
CLIPBOARD_PASTE_SETTLE_SECONDS    = 0.15
```

### (d) Argument validation on both sides of the wire

Swift (`ActionArgumentValidation.swift`):

```swift
positiveInteger(_:defaultValue:name:)  // requires isFinite && > 0 && boundedInteger conversion
positiveNumber(_:defaultValue:name:)   // rejects NaN / ∞ / overflow
scrollDirection(_:)                    // hard allowlist: up | down | left | right
```

TypeScript mirrors: `computer-provider-action-validation.ts`, `computer-action-verification-normalization.ts`, `computer-action-flag-validation.ts`. Required-field helpers (`requiredString`, `requiredNumber`, `requiredInteger`, `optionalInteger`) all throw `invalid_argument` rather than coercing.

### (e) Protocol version pinning

`REQUIRED_MACOS_PROVIDER_PROTOCOL_VERSION` + `assertMacOSProviderCapability()` — a stale helper binary is rejected rather than silently mis-executing actions. Capabilities are probed once (`ensureCompatible`) and cached; each action asserts its capability key before dispatch.

### (f) Empty entitlements

`resources/build/entitlements.computer-use.mac.plist` is an **empty `<dict/>`** — the helper requests **no** special entitlements. Its power comes purely from user-granted TCC (Accessibility + Screen Recording), which the user can revoke in System Settings at any time. No hardened-runtime exceptions, no JIT, no disabled library validation.

## 9.10 Permission UX

`macos-computer-use-permissions.ts` + `PermissionStatusSnapshot.swift` + `PermissionTrustSettling.swift`. IPC surface is tiny and **lazily imported** (so non-macOS builds never load it):

```
computerUsePermissions:openSetup   // deep-links to the right System Settings pane
computerUsePermissions:getStatus
computerUsePermissions:reset       // tccutil reset
```

`PermissionTrustSettling` handles the macOS quirk where a freshly-granted TCC permission isn't immediately observable. Supporting main-process modules: `macos-tcc-prompt-notice.ts`, `macos-tcc-prompt-watch.ts`, `macos-full-disk-access-status.ts`. The daemon PID file even carries `spawnerExecPath` — *"macOS pins the daemon's TCC responsible process to it (STA-3491)."*

## 9.11 The agent-facing contract

`skills/computer-use/SKILL.md` is deliberately a **stub, not a guide**:

> *"This file is a discovery stub, not the usage guide. The full, version-matched computer-use reference is served by the `orca` binary itself — kept out of this file on purpose so it can never drift from the binary that will actually run your commands."*

Agents must run `ORCA skills get computer-use`. Three details:

1. **Executable resolution pinned per session** — `ORCA_CLI_COMMAND` → `orca-dev` → `orca-ide` → `orca`. If the chosen binary fails, the agent must **report and stop**, never fall through: *"which could silently target a different Orca build."*
2. **Linux name-collision guard** — bare `orca` on Linux resolves to the **GNOME Orca screen reader** (`/usr/bin/orca`) and would start speech on the user's machine. Hence `orca-ide`.
3. **Bounded fallback** for pre-`skills get` binaries: exactly three read-only commands (`status`, `computer capabilities`, `computer list-apps`), then "ask the user rather than guessing."

## 9.12 Build & verification

```
build:computer-macos       → Swift package build
verify:computer-native     → gates release on the native binary being present/valid
verify:macos-entitlements  → entitlement audit
smoke:computer             → computer-use-smoke.mjs
test:e2e:computer          → vitest (tests/e2e/vitest.config.ts)
bench:macos-computer-helper-owner-loss
```

Release builds **fail** if the native helper is missing or invalid — no silent degradation. Swift unit tests cover every safety primitive: `SyntheticMouseClickDeliveryTests` (8.8 KB), `SnapshotRenderingTests` (8.2 KB), `AuthenticatedConnectionHangupMonitorTests` (6.0 KB), `AgentSessionOwnershipTests`, `ScreenCapturePermissionPreflightSafetyTests`, `UnixSocketPathSafetyTests`, `KeyboardInputSafetyTests`, `ActionArgumentValidationTests`, `PermissionStatusSnapshotTests`, `PermissionTrustSettlingTests`, `NumericArgumentParsingTests`, `AgentEntrypointSourceSafetyTests`.

## 9.13 Comparison to the alternatives

| Approach | Input model | Reliability | Token cost | Security |
|---|---|---|---|---|
| **PyAutoGUI / robotjs / nut.js** | Screenshot + pixel coords | Brittle (DPI, theme, scroll) | High (vision every step) | Full-screen capture; no app scoping |
| **Anthropic CUA reference container** | Screenshot + coords in Docker+VNC | Better (isolated) | High | Isolated, but can't touch the user's real apps |
| **OpenAI Operator / browser-use** | DOM (browser only) | Good | Medium | Browser-scoped only |
| **Playwright / Selenium** | DOM (browser only) | Excellent | Low | Browser-scoped only |
| **Orca** | **Native accessibility tree, index-addressed** | **Excellent** (semantic, DPI-independent) | **Low** (text tree; screenshot optional via `--no-screenshot`) | Per-window capture, app blocklist, focus gate, TCC-scoped helper |

Orca essentially built **"Playwright for the native desktop"**: a semantic element tree with stable indices, typed actions, and capability negotiation — while every mainstream desktop-CUA stack is still doing screenshot→coordinate loops.

## 9.14 If you replicate this in GeneratorAI

Minimum viable version of the same architecture:

1. **Separate helper process per platform.** Never run automation in your main process — permission attribution and crash blast radius both demand it.
2. **Accessibility tree over screenshots.** macOS `AXUIElement`, Windows `UIAutomation`, Linux `AT-SPI2`. Return an **indexed** element list; let the model address `--element-index N`.
3. **Ephemeral socket + token.** `mkdtemp` `0700` → `randomUUID` token in a `0600` file → spawn helper with `--token-file` → **delete the token file after connect**.
4. **Sensitive-app blocklist enforced inside app lookup**, matched on bundle ID where available and on name + *window titles* elsewhere.
5. **Focus gate before every synthetic input.** Refuse if the target window isn't frontmost.
6. **Two-stage kill with timeouts** (30 s → SIGTERM → 1 s → SIGKILL). Native automation APIs hang.
7. **argv arrays + a JSON op file**, never shell interpolation — the app name comes from an LLM.
8. **Per-window capture with an iterative downscale budget**, not full-screen grabs.
9. **Version-matched agent guide served by the binary**, not a static doc that drifts.
10. **`set-value` direct-write path** instead of simulating keystrokes wherever the AX API allows it.

---

# 10. Assessment & Patterns Worth Porting

## Scorecard

| Dimension | Grade | Notes |
|---|---|---|
| Process isolation | **A+** | Daemon, Vault service, plugin forks, watcher pool, native helper — each a separate failure domain |
| Concurrency / backpressure | **A+** | 3-stage chain ending in *real* kernel backpressure; every buffer bounded and named |
| Streaming to many clients | **A** | Per-client queues, ack credit windows, round-robin fairness, lane scheduling |
| Performance engineering | **A+** | Benchmarks + hard budgets as CI gates; `maxRendererDroppedBacklogs = 0` |
| Auth & multi-device | **A** | Per-device revocable tokens, E2EE v2 with directional keys, scope allowlist |
| Secret storage | **A−** | Excellent primitives + fail-closed engine; docked for inconsistent plaintext fallbacks and the Linear/Jira `writeSecureFile` bypass |
| Electron hardening | **A** | Sandbox + isolation everywhere, navigation deny-all, permission handlers |
| Computer use | **A+** | Zero-dependency native stack, AX-tree addressing, app blocklist, focus gate, TCC-scoped signed helper |
| Testability | **A+** | 42% test-file ratio, real-binary compatibility CI, wire-compat contract, reliability-gate manifest |
| Approachability | **C** | 10.8k files, 1.4 MB `orca-runtime.ts`, 255 KB `db.ts`, 210 KB preload |

## Nine patterns worth porting into GeneratorAI

1. **Detach long-lived work from the app process.** `SessionService` caps at `maxConcurrentSessions: 10` in-process; a supervisor process would let agent runs survive an app restart.
2. **Real backpressure, not just queue caps.** `Semaphore` limits *starts*; add HIGH/LOW watermarks with hysteresis + a resume failsafe on any agent output stream.
3. **Per-client output queues.** A shared fanout buffer is a head-of-line-blocking bug waiting to happen.
4. **Ack-based credit windows with additive growth.** 512 KB → 2 MB per stream, 2 MB → 8 MB per connection.
5. **Fail-closed secret persistence.** Retain ciphertext when the keystore is unavailable instead of writing empty.
6. **Redact at three points, with tagged patterns.** `[REDACTED:anthropic-key]` keeps triage useful; add a server-side pass.
7. **Per-device revocable tokens + a method allowlist.** Scope capabilities per client kind.
8. **Performance budgets as CI gates**, plus a reliability-gate manifest with soak requirements before promotion.
9. **Version-matched agent guides served by the binary.** Eliminates "agent uses flags from a cached doc" failures entirely.

## Two things I'd fix in Orca

1. Route Linear/Jira token writes through `writeSecureFile` (Windows ACL + atomic rename) — 12 other stores already do.
2. Make `DeviceRegistry.validateToken` constant-time, and make the plaintext fallback one explicit policy decision rather than four independent per-integration choices.

---

# 11. Codex Desktop App vs Orca — Computer Use Comparison

> Sources: `learn.chatgpt.com/docs/computer-use`, `/docs/appshots`, `/docs/extend/record-and-replay`,
> `/docs/plugins`, `/docs/changelog`, and `developers.openai.com/api/docs/guides/tools-computer-use`.
> Codex desktop internals are closed-source; mechanism claims below are marked **[documented]** or **[inferred]**.

## 11.1 The fundamental split

| | **Codex (ChatGPT desktop app)** | **Orca** |
|---|---|---|
| **Paradigm** | **Screenshot + absolute pixel coordinates** (vision loop) | **Accessibility tree + element index** (semantic) |
| **Intelligence lives in** | The **model** (GPT-5.4+ has native computer-use training) | The **harness** (hand-written AX adapters) |
| **Delivery** | MCP server + skill, installed as a **plugin** | First-class CLI surface compiled into the binary |
| **Third-party libs** | None shipped; model-native tool | None — zero-dependency native code |
| **macOS** | Screen Recording + Accessibility, separate helper "Codex Computer Use" | Screen Recording + Accessibility, separate helper "Orca Computer Use.app" |
| **Windows** | **Foreground takeover** — moves your real pointer | UIAutomation patterns — no pointer hijack required |
| **Linux** | Not supported | AT-SPI2 via Python |

## 11.2 Codex's actual action schema [documented]

From the Responses API `computer` tool (GA), which GPT-5.4/5.5/5.6 are natively trained on:

```json
{
  "type": "computer_call",
  "call_id": "call_002",
  "actions": [
    { "type": "click", "button": "left", "x": 405, "y": 157, "keys": ["SHIFT"] },
    { "type": "type", "text": "penguin" }
  ],
  "status": "completed"
}
```

Full action set: `click` · `double_click` · `scroll` · `type` · `wait` · `keypress` · `drag` · `move` · `screenshot`

Loop:
1. Send task with `tools: [{ type: "computer" }]`
2. Model returns `computer_call` (first turn is usually just `{"type":"screenshot"}`)
3. Harness runs every action in `actions[]` **in order**
4. Harness captures a screenshot, returns `computer_call_output` → `{ type: "computer_screenshot", image_url: "data:image/png;base64,…", detail: "original" }`
5. Repeat until no `computer_call` is returned

Notes from the docs:
- `detail: "original"` is **required practice** — "preserve resolution and improve click accuracy." Avoid `high`/`low`.
- Recommended downscale targets: **1440×900** and **1600×900**.
- If you downscale, you must **remap model coordinates back** to the original coordinate space.
- GA migration: `computer_use_preview` → `computer`; single `action` → batched `actions[]`; `truncation:"auto"` no longer required.

**This is unambiguously coordinate-based.** There is no element-ID, no role, no accessibility node in the schema.

## 11.3 Codex desktop architecture [documented + inferred]

```mermaid
flowchart LR
    A["GPT-5.6 (native computer-use training)"] -->|"computer_call actions[]"| B["ChatGPT desktop app"]
    B --> C["Computer Use plugin<br/>(MCP server + skill)"]
    C --> D["'Codex Computer Use' helper<br/>separate TCC identity"]
    D -->|macOS| E["Screen Recording → screenshot<br/>Accessibility → click / type / navigate"]
    D -->|Windows| F["Foreground input injection<br/>moves the real pointer"]
    E -->|"PNG @ detail:original"| A
    F -->|"PNG @ detail:original"| A
```

**Confirmed facts:**
- Installed via **Plugins > Computer Use**, with separate **server** and **skill** toggles [documented]
- Invoked with `@Computer` or `@AppName` mentions [documented]
- macOS grants: **Screen Recording** = "so ChatGPT can see the target app"; **Accessibility** = "so ChatGPT can click, type, and navigate" [documented]
- Helper appears in System Settings as **"Codex Computer Use"** — a distinct TCC principal, same pattern as Orca [documented]
- **Appshots** (macOS, double-Command hotkey) capture "an image of the visible window" **and** "available text from that window, including visible text and text the app makes available outside the visible scroll area" — so AX text extraction exists, but as *context*, not as an addressable element tree [documented]
- Timeline: Computer Use launched **2026-04-12** (macOS, 26.415) → **Windows 2026-05-27** (26.527) → EEA/UK/CH **2026-06-15** → "faster with GPT-5.6" **2026-07-09**

## 11.4 Where Codex is genuinely ahead

### (a) Locked use — macOS unlock integration [documented]
Nothing in Orca comes close. Codex installs an **Apple authorization plug-in** that participates in the macOS unlock flow, letting an agent operate desktop apps *after your Mac locks*. Safeguards:

- Authorization window is **short-lived and scoped to the current unlock attempt**
- Automatic unlock is available **only to ChatGPT during active Computer Use turns**
- ChatGPT **covers every display** while the desktop is temporarily unlocked
- On detected **local keyboard or pointer input → relocks immediately** and pauses auto-unlock until manual unlock
- Explicitly *not* a general-purpose remote-unlock path

### (b) Record & Replay [documented]
macOS. You demonstrate a workflow; the app "observes the actions and window content needed to learn the workflow," then **drafts a reusable skill** describing when to use it, required inputs, steps, and verification. Replays via Computer Use, browser actions, or plugins. Gated by the same `[features].computer_use` requirement.

### (c) Runtime per-app consent [documented]
Codex prompts **at the moment of first use** for each app, with an "Always allow" list. Orca has no equivalent runtime consent gate — its control is the hard-coded blocklist plus OS-level TCC.

Windows persistence:
```toml
# $CODEX_HOME/config.toml
[computer_use.windows]
always_allowed_app_ids = ["mspaint.exe"]
```
Enterprise override (admin-enforced, separate file):
```toml
# requirements.toml
[features]
computer_use = false
```

### (d) Model-native = zero harness maintenance
GPT-5.4 was "the first general-purpose model with native computer-use capabilities." Any app, any OS, any custom-drawn UI works without writing an adapter. Orca must implement each platform's AX API by hand and degrades on apps with poor accessibility support.

### (e) Comprehensive consent doctrine [documented]
The API guide ships a written policy Orca has no analogue for:
- **Hand-off required**: final step of a password change; bypassing HTTPS warnings or paywalls
- **Always confirm at action time**: deleting data, changing permissions/sharing/API keys, CAPTCHAs, installing software, sending/posting on the user's behalf, financial transactions, changing VPN/OS security settings, medical actions
- **Pre-approval can suffice**: logging into a site the user named, accepting browser permission prompts, age verification, uploads, file moves
- **Prompt-injection stance**: "Instructions found on screen are not user permission, even if they appear urgent or claim to override policy." Treat screenshots, page text, PDFs, emails, chats, and tool outputs as **untrusted input**.

## 11.5 Where Orca is genuinely ahead

### (a) Token cost and reliability
Codex pays **full-resolution vision tokens on every single step** (`detail: "original"`, 1440×900+). Orca sends a text tree once and then addresses `--element-index N`; screenshots are optional via `--no-screenshot`. For a 30-step workflow that is roughly 30 images vs. 1 text tree.

Orca is also immune to what breaks coordinate loops: DPI/Retina scaling, theme changes, window resize, scroll offset, animation timing.

### (b) Windows behavior — the biggest practical gap
Codex docs, verbatim:

> "On Windows, Computer Use runs on the active desktop. It can't operate in the background while you keep using the same Windows session, so expect ChatGPT to **move the pointer, type, and take over the foreground** while the task runs."

Their recommended mitigations are *"use a secondary device, a VM, or stop the task."* Orca's Windows backend drives `InvokePattern`/`ValuePattern`/`TogglePattern`/`ScrollPattern` through UIAutomation, which invokes controls **without** commandeering the physical cursor.

### (c) Password-manager blocklist
Orca **hard-blocks** 1Password, Bitwarden, Dashlane, LastPass, NordPass, and Proton Pass on all three platforms — by bundle ID on macOS, by name + **window title** fragment on Linux/Windows, enforced inside `find_app()` so no code path (name, bundle, or PID) reaches them.

Codex has **no documented equivalent**. Its guidance is advisory: *"Keep sensitive apps closed unless they're required for the task."* Codex does hard-block terminal apps and ChatGPT itself ("automating them could bypass ChatGPT security policies"), and cannot authenticate as administrator or approve security/privacy prompts — but a screenshot loop pointed at an unlocked password vault is not structurally prevented.

### (d) Direct semantic writes
Orca's `set-value` calls `AXUIElementSetAttributeValue(kAXValueAttribute, text)` — atomic, instant, no focus stealing, no IME race. Codex's only text path is `{"type":"type","text":"…"}`, i.e. simulated keystrokes into whatever currently has focus.

### (e) Focus gating
`KeyboardInputSafety.syntheticInputFocusFailure()` **refuses** synthetic input when the target window isn't focused. Codex has no documented equivalent — if focus shifts mid-task, keystrokes land wherever focus went. (Their guidance: *"Cancel the task if ChatGPT starts interacting with the wrong window."*)

### (f) Scriptability and inspectability
Orca exposes 14 CLI verbs any agent can call and audit. Codex's surface is an MCP tool inside the app — not independently scriptable, not inspectable, and unavailable in the IDE extension.

## 11.6 Head-to-head scorecard

| Dimension | Codex | Orca | Winner |
|---|---|---|---|
| Works on any app regardless of AX support | ✅ vision | ⚠️ needs AX tree | **Codex** |
| Token efficiency | ❌ image every step | ✅ text tree | **Orca** |
| DPI / theme / resize resilience | ❌ brittle | ✅ immune | **Orca** |
| Windows background operation | ❌ foreground takeover | ✅ UIAutomation | **Orca** |
| macOS background operation | ✅ | ✅ | Tie |
| Linux support | ❌ | ✅ AT-SPI2 | **Orca** |
| Locked / after-hours operation | ✅ authorization plug-in | ❌ | **Codex** |
| Runtime per-app consent | ✅ prompt + always-allow | ❌ | **Codex** |
| Password-manager hard block | ❌ advisory only | ✅ enforced 3 platforms | **Orca** |
| Focus-gated input | ❌ | ✅ | **Orca** |
| Terminal / self-automation block | ✅ | ✅ (skill-level) | Tie |
| Enterprise policy control | ✅ `requirements.toml` | ⚠️ settings only | **Codex** |
| Learn-by-demonstration | ✅ Record & Replay | ❌ | **Codex** |
| Direct semantic value writes | ❌ | ✅ `set-value` | **Orca** |
| Agent-scriptable CLI | ❌ MCP-only | ✅ 14 verbs | **Orca** |
| Documented consent doctrine | ✅ extensive | ⚠️ implicit | **Codex** |
| Zero third-party automation deps | ✅ | ✅ | Tie |
| Separate TCC-scoped signed helper | ✅ | ✅ | Tie |

## 11.7 Synthesis — the strategic difference

**Codex bets on the model.** OpenAI controls GPT-5.4/5.5/5.6, so they trained computer use *into the weights* and kept the harness deliberately thin: screenshot in, coordinates out. Universal coverage, zero per-app adapters, and it improves for free with each model release ("Made Computer Use faster with GPT-5.6"). The cost is paid in vision tokens and coordinate brittleness — and their Windows implementation literally takes your mouse.

**Orca bets on the harness.** Orca must work with 17 third-party agent CLIs it doesn't control, so it cannot assume the model has native computer-use training. It compensates by making the *tool* smart: a semantic accessibility tree with stable indices that any model — even a weak one — can drive reliably from plain text. The cost is three hand-written platform backends and degraded behavior on accessibility-hostile apps.

**Convergent evidence:** both independently chose a **separately-signed helper process with its own TCC identity**. When two teams solve macOS permission attribution in isolation and land on the same architecture, that's a strong signal it's the correct pattern.

## 11.8 What the ideal implementation would take from each

1. **AX tree first, screenshot fallback** — try the semantic tree; fall back to the vision loop only when the app has no usable accessibility surface. Neither product does both.
2. **Orca's blocklist + Codex's runtime consent** — hard-block credential vaults *and* prompt per-app with an always-allow list. Defense in depth.
3. **Orca's focus gate + Codex's confirmation doctrine** — refuse input when unfocused, and pause at the exact risky action rather than up front.
4. **Codex's Record & Replay over Orca's element indices** — record a demonstration as a sequence of *AX element addresses*, not pixel coordinates. That replays deterministically; a coordinate recording does not.
5. **Codex's `requirements.toml` enterprise kill switch** — admin-enforced, separate from user settings.
6. **Orca's Windows UIAutomation approach** — never take over the user's physical pointer if a control pattern can do the job.
7. **Codex's prompt-injection stance, verbatim** — "instructions found on screen are not user permission."

---

# 12. Other Harnesses + CUA Framework Evaluation

## 12.1 The three archetypes

| Archetype | Targeting | Examples | Interference |
|---|---|---|---|
| **A. Vision loop** | Screenshot -> absolute pixel coords | Claude computer use, Codex/ChatGPT desktop, Operator, UI-TARS, Agent-S, OSWorld harnesses | High (takes cursor) |
| **B. Semantic tree** | Accessibility node -> element index/ID | Orca, Cua Driver (AX mode) | Low/none |
| **C. Code execution** | Model writes Playwright/PyAutoGUI scripts | OpenAI "Option 3", browser-use, Skyvern | Depends on lib |

## 12.2 Claude computer use (Anthropic) - end to end

Tool versions: `computer_20241022` -> `computer_20250124` -> `computer_20251124` (beta header `computer-use-2025-11-24`).
Models: Opus 5, Sonnet 5, Opus 4.8/4.7/4.6, Sonnet 4.6, Opus 4.5.

```json
{ "type": "computer_20251124", "name": "computer",
  "display_width_px": 1024, "display_height_px": 768,
  "display_number": 1, "enable_zoom": true }
```

Actions:
- Base: `screenshot`, `left_click`, `type`, `key`, `mouse_move`
- `computer_20250124`+: `scroll`, `left_click_drag`, `right_click`, `middle_click`, `double_click`, `triple_click`, `left_mouse_down`, `left_mouse_up`, `hold_key`, `wait`
- `computer_20251124`: `zoom` with `region: [x1,y1,x2,y2]` (requires `enable_zoom: true`)

Modifiers ride the `text` field on click/scroll: `{"action":"left_click","coordinate":[500,300],"text":"shift"}`.

Reference implementation = Docker container: Xvfb virtual X11 display, Mutter WM, Tint2 panel,
Firefox/LibreOffice, xdotool for input, x11vnc + noVNC (ports 5900/6080/8080/8501), Streamlit UI.
Schema-less tool - the schema is baked into the model and cannot be modified.

Hard operational constraints:
- Screenshot limits: 2576 px long edge (Opus 5/Sonnet 5/4.8/4.7); 1568 px + ~1.15 MP (earlier).
- API silently downscales oversized images, which destroys your scale factor -> resize client-side and map coords back yourself.
- macOS Retina: DPR 2, so halve coordinates or downscale 2x.
- Recommended: XGA 1024x768; pad smaller displays with black to 1024x768.
- Screenshots cost ~1000-1800 input tokens each.
- Prompt-cache rule: prune screenshots in BATCHES (keep last 3, prune every 25 turns). Pruning one per turn changes the prefix every turn and kills the cache.
- Place instruction text BEFORE the image in the content array - improves click accuracy.
- Thinking effort: Opus 4.7 -> `high`; Sonnet 4.6 / Opus 4.6 -> `medium`; avoid `max`.
- Cost: +466-499 system prompt tokens, 735 tokens per tool definition.

Safety: Anthropic runs prompt-injection classifiers on screenshots; on detection they steer the
model to ask for user confirmation. Opt-out via support. Data is client-side (ZDR eligible).

Verdict: the canonical Archetype A. Designed for a disposable VM, not your daily driver.

## 12.3 Hermes and the other agent CLIs - they have no computer use

Verified from Orca's own adapter (`src/main/hermes/hook-service.ts`): Hermes is a TUI coding agent with
`~/.hermes/config.yaml` and a plugin directory `~/.hermes/plugins/<name>`. Orca installs a managed
`orca-status` plugin and toggles `plugins.enabled` / `plugins.disabled` in the YAML.

That is a lifecycle-hook system, not a computer-use system. The same is true for essentially all 17
agents Orca drives (claude, codex, hermes, pi, omp, prime-agent, cursor, gemini, antigravity, rovo,
copilot, opencode, grok, openclaw, devin, droid, kimi).

They acquire computer use by consuming an external MCP server or CLI. That is exactly why Orca ships
`orca computer` as a CLI + skill, and exactly why Cua ships `cua-driver mcp`.

## 12.4 Cua (trycua/cua) - the important find

MIT, ~21.2k stars, 609 releases, 113 contributors. Rust 21% / Python 17% / TS 5% / Swift 3.7% / Go 2.7%.

Packages:
| Package | Purpose |
|---|---|
| `cua-driver` | Background computer-use driver for macOS/Windows/Linux <- THE relevant one |
| `cua-agent` | Agent framework for computer-use tasks |
| `cua-sandbox` | SDK for VM/container sandboxes (`Sandbox.ephemeral(Image.linux())`) |
| `cua-computer-server` | In-sandbox driver for UI + code execution |
| `cua-bench` | OSWorld / ScreenSpot / WindowsArena benchmarks + RL envs |
| `lume` / `lumier` | macOS/Linux VMs on Apple Silicon via Virtualization.framework |

Cua Driver tagline: *"Drive native desktop apps in the background. Agents click, type, and verify
without stealing the cursor or focus."* Ships as MCP over stdio (`cua-driver mcp`) plus a CLI
(`cua-driver call`). Integrations documented for Claude Code, Cursor, Codex, OpenClaw, Muse Code.

### Architecture
- Rust core, versioned C ABI (`cua_driver_*_v1`), header generated from `#[repr(C)]` exports and CI-checked with `--check` so implementation and header cannot drift.
- UniFFI generates Python (`cua_driver`) and TypeScript (`@trycua/cua-driver`) SDKs over the same in-process native runtime. No daemon required for direct SDK use.
- MCP is the runtime-neutral agent boundary; language packages deliberately contain no MCP facade.

### macOS TCC identity (they solved this the same way Orca did)
- **Standalone**: install `CuaDriver.app`, grant Accessibility + Screen Recording to it, run `open -n -g -a CuaDriver --args serve`.
- **Embedded**: host app uses `EmbeddedCuaDriverHost` to spawn a private daemon that stays in the app's responsibility chain and inherits its grants. "A gateway, terminal, or unrelated helper must not spawn the daemon on the app's behalf."
- **Direct** (`cua-driver mcp --direct`): uses the spawning host's TCC attribution; on macOS this loses the AppKit cursor overlay without a certified host adapter.
- Explicitly unsupported: raw `cua-driver serve` outside the app bundle - "no stable bundle identity for TCC attribution."

### Permission modes
- `standard` - promptless default
- `bounded` - only tools/resources in a reviewed capability manifest
- `unrestricted` - requires `--dangerously-bypass-approvals`
Fixed at launch via `CUA_DRIVER_PERMISSION_MODE`, `CUA_DRIVER_CAPABILITY_MANIFEST_FILE`,
`CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED`. Changing it requires a daemon restart.

### Claude Code compatibility shim
```
claude mcp add --transport stdio cua-computer-use -- cua-driver mcp --claude-code-computer-use-compat
```
Changes only `screenshot`, which then requires `pid` + `window_id` and captures that window only -
i.e. it retrofits per-window capture onto Claude's vision loop.

### AX vs PX - the hybrid Orca and Codex both lack
From `docs/action-support.md`:
> "AX and PX describe how the target is selected. They do not require the same delivery backend:
> a PX target may be hit-tested and delivered through AX/UIA when that is the background-safe route."

A pixel coordinate from a vision model gets **hit-tested into an accessibility node** and delivered
semantically. That is Archetype A input with Archetype B delivery.

### Structured refusals instead of blind injection
`background_unavailable`, `background_occluded`, `background_uipi_blocked`. The driver refuses
**before dispatch** rather than injecting into the wrong window.

### Empirical evidence ledger (the standout artifact)
Taxonomy: **Delivered** (fixture-owned state change observed) / **Refused** (exact refusal code + all
side-effect oracles passed) / **Gap** (unproven; "a missing row is never evidence that an action is impossible").

Every background row requires fixture state + focus + z-order + **no-leaked-input** evidence.
Windows, macOS, and X11 additionally require a **cursor-preservation oracle** - they empirically prove
the user's pointer did not move.

Accepted baselines:
| Platform | Result |
|---|---|
| Windows/Win32 | 122/122 (99 delivered, 23 exact refusals) |
| macOS/Quartz | 145/145 effective (138 deliveries, 6 exact refusals) |
| Linux/X11 | 116/116 (75 delivered, 41 exact refusals) |
| Linux/Sway | 116/116 effective |
| GNOME/Mutter | GTK3 31/31 on real GNOME 46 Wayland (needs WinRects helper + one Shell restart) |
| KDE/KWin | No behavioral matrix accepted; foreground portal/libei input refuses rather than injecting into the wrong app |

Maintenance rule: *"When an OS API reports success but offers no effect read-back, retain a visible gap
rather than inventing a fixture-specific refusal in production code."*

### Honest gaps
- macOS AppKit: native `press key`, `hotkey`, AX-addressed right/double click "remain unproven"; PX background slider drag -> `background_unavailable`.
- Wayland: "Stock Wayland cannot target raw focus-bound input at an occluded surface." Cursor-preservation oracle unproven on Wayland (issue #2194).
- Windows Electron: scroll/type/hotkey background -> `background_unavailable`; drag -> `background_occluded`.
- `background_uipi_blocked` has no canonical elevated fixture; not counted as covered.
- Nested cua-compositor lane is experimental (10 failures in the accepted shared run).
- No documented password-manager blocklist (Orca's strongest safety feature).

## 12.5 Verdict for GeneratorAI

**Adopt `cua-driver`. Do not adopt `cua-agent` / `cua-sandbox` / `lume` unless you need VM fleets.**

Rationale:
1. It is the only OSS project that implements the tiered AX-first / PX-fallback ladder cross-platform.
2. MCP over stdio means zero coupling - swap it out later without touching your agent code.
3. It already solves macOS TCC attribution, which is the single hardest part.
4. The evidence ledger tells you exactly what will and will not work per platform before you ship.
5. Building the equivalent means three native backends (Swift + PowerShell/C# + Python/AT-SPI) plus a Wayland strategy. Orca spent enormous effort here and still only supports X11-style Linux.

Integration shape:
```
GeneratorAI agent -> MCP stdio -> cua-driver -> AX/UIA/AT-SPI (background)
                                             -> refuse with structured code when unsafe
```

Add on top (Cua does not provide these):
- Password-manager / credential-vault blocklist enforced inside app lookup (copy Orca).
- Runtime per-app consent prompt + always-allow list (copy Codex).
- Enterprise kill switch equivalent to `requirements.toml`.
- Your own audit log of every dispatched action + refusal.

Do not adopt if: you need Windows elevated-app automation (UIPI unproven), KDE/Wayland as a primary
target, or you cannot ship a signed macOS `.app` bundle.
