# GeneratorAI Mobile Companion App — Architecture, UX and Implementation Plan

> **Status:** Proposal for review. No code has been written.
> **Scope:** `apps/mobile/` — a React Native (Expo) companion for iOS and Android with
> parity against `apps/web` and `apps/desktop`, connecting through the already-shipped
> pairing / DPoP / relay / E2EE security stack.
> **Prerequisite reading:** [.github/AGENTS.md](../.github/AGENTS.md),
> [docs/SECURITY_AUTH_RELAY_MOBILE_ARCHITECTURE_PLAN.md](./SECURITY_AUTH_RELAY_MOBILE_ARCHITECTURE_PLAN.md) §8, §11, §20.

---

## 0. Executive summary

| Question | Answer |
| --- | --- |
| Can React Native + Expo deliver this? | **Yes**, for ~85% of the surface at native quality. The remaining 15% needs deliberate re-design (DAG authoring, terminal, diff rendering) or is desktop-only by nature. |
| One binary for both platforms? | **One codebase, one EAS project, one build command → two artifacts.** A literal single binary is impossible: the App Store requires a signed `.ipa`, Play requires an `.aab`. You will never maintain two codebases; you will always ship two store artifacts. This is the correct and only interpretation. |
| Biggest risks | (1) terminal emulation, (2) diff + syntax highlighting at scale, (3) streaming render performance, (4) the DAG builder. All four have a concrete mitigation below. |
| Security posture | Mobile plugs into the **existing** device-pairing model with zero server protocol changes. Only two additive server features are needed: a push registry and (optionally) a server-side syntax-highlight endpoint. |
| Shape of the work | 6 phases, each independently shippable. Phase 1–3 give a genuinely useful companion; Phase 4–6 close parity. |

The single most important architectural decision in this plan is **extracting three
new shared packages** (`design-tokens`, `client-core`, `client-transport`) so that
web, desktop, CLI and mobile share one implementation of the theme, the API client,
the SSE event reducer and the transport/auth layer. Without that, mobile becomes a
second source of truth and drifts within one release.

---

## 1. What exists today (the baseline this plan builds on)

### 1.1 System shape

```
apps/server   Express + composition root + unified SSE (/api/stream) + WS (terminal, browser, STT)
apps/web      React 19 SPA (Vite, Tailwind 4, TanStack Query, Zustand, React Flow)
apps/desktop  Electron — spawns the real server on loopback and loads apps/web/dist (full parity)
apps/cli      Commander + Ink TUI
apps/relay    Blind WebSocket forwarder (director + cell)

packages/  shared · core · db · sdk · agent-harness-providers · mcp-server
           auth · secrets · client-runtime · relay-protocol
           changes · checkpoints · git · review · source-control
```

Three top-level execution objects — **Chat**, **Workflow Run**, **Automation** — all observed
through the same `GET /api/stream?scope=…&id=…` SSE endpoint with `Last-Event-ID`
resume and REST replay fallback. Everything below the service layer talks to
`IAgentHarness`, so the provider (Copilot SDK / Claude Agent SDK) is invisible to clients.

**Consequence for mobile:** the mobile app is a *pure client of the same HTTP + SSE + WS
contract the web app uses.* There is no new backend. This is the reason a companion app
is tractable at all.

### 1.2 Security stack (recently shipped — this is what mobile connects through)

| Layer | Mechanism |
| --- | --- |
| Device identity | P-256 keypair per device. Non-extractable where the platform allows. Only the public JWK is ever serialized. |
| Request auth | **DPoP (RFC 9449)** — `Authorization: DPoP <access-token>` + a `DPoP:` compact-JWS proof per request. Verifies `htm`/`htu`/`iat`/`jti`/`ath`/`cnf.jkt`. `alg` limited to `ES256`/`EdDSA`; `HS*` and `none` rejected. |
| Pairing | `POST /api/auth/pair` (admin) mints a `PairingOffer` → base64url JSON → QR. `POST /api/auth/pair/complete` is *unauthenticated but DPoP-proved*; the server re-checks that the registered thumbprint equals the DPoP-proven thumbprint and revokes on mismatch. |
| Session | Access token 1 h. Resume secret 7 d, **rotated on every refresh** (`POST /api/auth/token/refresh`). A leaked resume secret is useless without the device key. |
| Streams | Single-use, 30-second **stream tickets** (`?ticket=`) for `EventSource` and WS upgrades. Replaces `?apiKey=`. A fresh ticket is minted per reconnect. |
| Scopes | 22 scopes in [packages/auth/src/scopes.ts](../packages/auth/src/scopes.ts). Transport never implies authorization. |
| Host pinning | `serverId = base64url(sha512(serverPublicKey)[0..32])` (43 chars). Pinned at pairing; verified against `GET /api/auth/server-info` on every resume. Mismatch → `HostIdentityChangedError` **before** any credential is transmitted. |
| Relay | `apps/relay` is a blind forwarder. The host dials **outbound** and proves possession of its Ed25519 key over a transcript binding the relay origin, the relay's ephemeral X25519 key, the challenge nonce, the assignment epoch and the previous generation — so a captured proof cannot be replayed at another relay or rolled back. Invites are single-use, hash-stored, 5-attempt-limited, 10-min TTL. |
| E2EE | [packages/relay-protocol/src/e2ee.ts](../packages/relay-protocol/src/e2ee.ts) — X25519 agreement → HMAC-SHA-512/256 KDF over a transcript hash → XSalsa20-Poly1305 frames with a **deterministic nonce** (`sessionId ‖ version ‖ direction ‖ payloadKind ‖ counter`). Free replay/reorder/truncation resistance. Applies to LAN *and* relay. |
| CI guards | `scripts/check-security-invariants.mjs` (8 rules incl. no long-lived key in a URL, no credential logging, no parent-env clone into the harness) and `scripts/check-no-app-wide-cdp.mjs`. Both run under `pnpm lint`. |

**`DEFAULT_MOBILE_SCOPES` already exists** and is deliberately narrow:

```
read:status  read:projects  read:workspaces  read:chats
read:workflows  read:files  read:reviews
write:chats  write:reviews  stream:events  exec:agent
```

Explicitly **withheld**: `exec:terminal`, `exec:browser`, `write:files`, `write:projects`,
`write:workspaces`, `write:workflows`, `admin:*`.

This scope set is the spine of the mobile feature tiering in §3.

### 1.3 What `packages/client-runtime` already gives mobile for free

`AuthenticatedClientRuntime` handles device-key lifecycle, DPoP proof generation,
single-flight token refresh, server-nonce handling, pairing-code import, revocation
detection, stream-ticket minting and session persistence — behind two injectable SPIs
(`DeviceKeyStore`, session store). It is written against **WebCrypto `subtle`**, and the
comment in [deviceKey.ts](../packages/client-runtime/src/deviceKey.ts) explicitly says
P-256 was chosen over Ed25519 *because of React Native*.

> **The auth layer was designed for this app before it existed. Mobile supplies two adapters and inherits the rest.**

---

## 2. Complete feature inventory (web/desktop) with mobile disposition

Legend: **A** = full parity, ship in the core phases · **B** = adapted parity, different
interaction model · **C** = deferred to *Future Enhancements* (§11).

### 2.1 Chat

| Feature | Tier | Mobile treatment |
| --- | --- | --- |
| Chat list, search, tag filter, grid/list, bulk select | A | List + search sheet; bulk via long-press selection mode |
| Create chat (model, project, up to 3 codebases, worktree, browser cfg) | A | Full-screen wizard sheet |
| Streaming render: thinking / text / tool-call / tool-result / system blocks | A | Ported block model, see §5.3 |
| Markdown + code fences + tables | A | Custom `marked`→RN renderer, §5.6 |
| Plan blocks (`PlanCard`, `PlanDocumentPanel`), approve/modify | A | Inline card → full-screen plan sheet |
| Question cards / HITL approve-reject-answer | A | **Elevated to a first-class mobile surface** — push notification with inline actions |
| Model picker (live catalog, reasoning effort, context tier, pricing) | A | Bottom sheet with the same provider-driven catalog |
| Cancel / archive / delete / export | A | — |
| Context-usage gauge, cost label, token usage chips | A | — |
| Voice input (local Whisper over `/api/stt/stream`) | B | `expo-audio` capture + resample, same WS. §5.9 |
| Attachments (upload) | B | `expo-document-picker` / `expo-image-picker` / camera. Needs `write:files` grant |
| Background tasks panel (orchestrator workers) | B | Read + spawn; worker chats hidden as on web |
| Inline widgets (`render_widget`) | B | WebView card against the existing `WIDGET_PORT` origin. §5.7 |

### 2.2 Workflows

| Feature | Tier | Mobile treatment |
| --- | --- | --- |
| Workflow list, search, tags, import/export, templates | A | — |
| Workflow definition page (metadata, run history, triggers) | A | — |
| **Visual DAG authoring** (React Flow: drag nodes, draw edges, undo/redo) | **C** | Desktop/web only. Mobile gets a read-only Skia canvas + an *outline editor* (§5.4) |
| DAG read-only view with run status overlay | B | Skia canvas, pinch-zoom, tap-to-select |
| Stage properties (model, MCP, skills, reasoning, prompt, output schema) | B | Read + edit scalar fields; long-form prompt authoring is Tier C |
| Variable input modal before run | A | Sheet |
| Run: start / pause / resume / cancel / retry | A | — |
| Stage timeline + per-stage streaming output | A | Vertical timeline list |
| Run profiles | A | Picker |
| Hooks matrix (22 phases × 3 types × policies) | **C** | View-only summary; editing is desktop-only |

### 2.3 Automations

| Feature | Tier | Mobile treatment |
| --- | --- | --- |
| List, enable/disable, manual trigger, delete | A | — |
| Create (workflow picker, trigger type, cron editor, webhook URL) | B | Cron via a friendly picker + raw field; webhook URL copy/regenerate |
| Execution history + nested run drill-down | A | — |
| Live execution stream (`scope=automation`) | A | — |
| Data-source script selection | B | Pick from registry; no authoring |

### 2.4 Projects, codebases, workspaces, files

| Feature | Tier | Mobile treatment |
| --- | --- | --- |
| Project CRUD, settings (retention, max codebases) | A | — |
| Link codebase from **git remote URL** | A | — |
| Link codebase from **local dir / git-local** | **C** | The phone has no access to the host filesystem. Surfaced as an explicit "desktop only" affordance |
| Fetch latest, branches, unlink | A | — |
| Codebase file browser + code preview | B | Custom RN tree (§5.5) |
| Artifacts: skills / prompts / custom agents / MCP servers | B | Browse + toggle; **MCP JSON editing is Tier C** |
| Workspace files & artifacts, preview, download, share | A | `expo-file-system` + `expo-sharing` |
| Upload to workspace | B | Requires `write:files` grant |

### 2.5 Changes / diff / review

| Feature | Tier | Mobile treatment |
| --- | --- | --- |
| Changes tree with status badges | A | Custom RN tree |
| Unified diff view | A | Custom renderer (§5.2). Default on phone |
| Side-by-side diff | B | Tablet + landscape only |
| Syntax highlighting | A | Server-tokenized (§5.2) with an on-device fallback |
| Checkpoint timeline | A | — |
| Review comment threads, approve/request-changes | A | **Strong mobile fit** — this is the flagship "review from the sofa" flow |

### 2.6 Integrated terminal & browser

| Feature | Tier | Mobile treatment |
| --- | --- | --- |
| Terminal (xterm.js, PTY over WS, watermark ACK flow control, multi-tab, search) | B | WebView-hosted xterm.js + native key toolbar (§5.1). **Gated behind an explicit `exec:terminal` grant + biometric confirmation** |
| Attach terminal selection to chat | B | — |
| Browser live view (MJPEG over WS), click-through, typing, scroll | B | Read-first viewer + tap-to-click; **gated behind `exec:browser`** (§5.8) |
| Browser inspector / snapshot / share / capture | B | Capture + share yes; DOM inspector is Tier C |
| Desktop native `WebContentsView` browser | **C** | Electron-only by construction |

### 2.7 Extensions, widgets, scripts, settings, platform

| Feature | Tier | Mobile treatment |
| --- | --- | --- |
| Widget rendering (inline + full-page, `widget_action` / `widget_exec`) | B | WebView against the existing separate widget origin (§5.7) |
| Extension marketplace: browse, install, enable/disable, settings | B | — |
| **Extension authoring** (`write_extension` UI) | **C** | Desktop/web |
| Programmatic Workflow Scripts: list, run with profile | B | Run yes, author no |
| Settings: theme + accent, provider switch, catalogs, source control, diagnostics | A | — |
| Settings: **Security / devices / pairing / posture** | A | **Expanded on mobile** — this is where a phone earns its place |
| Command palette (⌘K) | **C** | Replaced by a global search sheet + deep links |
| Multi-pane layout (main + RightPane simultaneously) | **C** | Replaced by bottom sheet + segmented tabs |
| SDK, custom tools, MCP stdio | **C** | Not a client concern |
| **Push notifications** | — | **New capability, mobile-first.** No web equivalent |
| **Biometric lock** | — | **New capability, mobile-first** |
| **Live Activity / ongoing notification for run progress** | — | **New capability, mobile-first** |

### 2.8 Summary

- **Tier A (full parity): 41 features** — everything a person actually does while away from a desk.
- **Tier B (adapted): 24 features** — present, re-designed for touch.
- **Tier C (deferred): 12 features** — authoring-heavy or physically impossible on a phone. Listed in §11.
- **3 net-new mobile-only capabilities** that the web app cannot offer.

---

## 3. Web dependencies that do **not** port, and what replaces them

| Web dependency | Used for | Mobile replacement | Risk |
| --- | --- | --- | --- |
| `@xterm/xterm` + addons | Terminal | **xterm.js inside a WebView** with a byte bridge (§5.1) | Medium |
| `@xyflow/react` | DAG canvas | `@shopify/react-native-skia` renderer (read/inspect) + outline editor (§5.4) | Medium |
| `@pierre/diffs` (shadow DOM) | Diff AST + caching | Server-computed hunks + custom RN renderer (§5.2) | Medium |
| `@pierre/trees` (shadow DOM) | File tree + icons | Custom RN tree + `material-file-icons` SVGs via `react-native-svg` | Low |
| `highlight.js` / `shiki` | Syntax highlighting | Server-side tokenization endpoint, `shiki` JS-regex-engine fallback (§5.2) | Medium |
| `react-markdown` + rehype/remark | Markdown | `marked` tokens → RN component map (§5.6) | Low |
| `react-router-dom` | Routing | `expo-router` (file-based, typed, deep-linkable) | Low |
| `@radix-ui/*` | Headless primitives | In-house primitives on `react-native-reanimated` + `@gorhom/bottom-sheet` | Low |
| `cmdk` | Command palette | Search sheet (Tier C for the full palette) | — |
| `sonner` | Toasts | In-house toast on Reanimated | Low |
| `qrcode` | QR generation | `react-native-qrcode-svg` (mobile only *displays*; it *scans* with `expo-camera`) | Low |
| `@tanstack/react-virtual` | Virtual scrolling | `@legendapp/list` (native virtualization, dynamic heights, chat mode) | Low |
| `lucide-react` | Icons | `lucide-react-native` — identical icon set | None |
| `zustand`, `@tanstack/react-query`, `clsx`, `tailwind-merge`, `cva` | State/data/styling utils | **Unchanged** | None |

---

## 4. Proposed technology stack

### 4.1 Core

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | **Expo SDK 57** (React Native 0.86, React 19.2.3, New Architecture) | Matches the repo's React 19. Managed prebuild + config plugins remove all manual native work. SDK 57 targets iOS 16.4+ / Android 7+ / compileSdk 36 — inside current store requirements. |
| Language | TypeScript 5.8 (same as repo) | Shares `tsconfig.base.json` |
| Routing | **expo-router 6** | File-based, typed routes, every screen deep-linkable → push notifications land on the exact chat/run. Mirrors the web URL structure 1:1. |
| Styling | **NativeWind v4.2** (Tailwind 3.4 engine) | Same `className` mental model as web. `vars()` gives runtime CSS-variable theming — which is exactly how the web theme already works. *Migrate to NativeWind v5 (Tailwind 4 parity) when it leaves pre-release.* |
| Server state | **@tanstack/react-query 5** | Same version, same query keys, shared hooks |
| Client state | **zustand 5** | Same version, stores port nearly verbatim |
| Lists | **@legendapp/list 3** | Pure JS, dynamic item heights without measurement cost, `alignItemsAtEnd` + `maintainScrollAtEnd` + `maintainVisibleContentPosition` — purpose-built for streaming chat without an inverted list. `@shopify/flash-list@2` is the fallback. |
| Animation | `react-native-reanimated` 4 + `react-native-gesture-handler` 2 | UI-thread animation; required by NativeWind and bottom-sheet anyway |
| Sheets | `@gorhom/bottom-sheet` 5 | The RightPane replacement |
| Canvas | `@shopify/react-native-skia` | GPU DAG rendering, sparklines, the context gauge |
| Web content | `react-native-webview` 13.16 | Widgets, xterm, rich HTML previews |
| Icons | `lucide-react-native` + `react-native-svg` | Identical glyph set to web |

### 4.2 Security & storage

| Concern | Choice | Notes |
| --- | --- | --- |
| WebCrypto | **`react-native-quick-crypto` 1.x** (Nitro/JSI, OpenSSL) | Installed as a `global.crypto` polyfill so `packages/client-runtime` runs **unmodified**. Provides `subtle.sign/verify` for EC, plus HKDF (`hkdfExtract`/`hkdfExpand`), X25519 shared secrets and AEAD — everything `relay-protocol` needs, natively. |
| Device signing key | **New Expo module `expo-device-key`** (Swift + Kotlin, ~250 LOC) | iOS: `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave`, P-256, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Android: `KeyPairGenerator("EC","AndroidKeyStore")` on `secp256r1`, StrongBox when available. Implements the existing `DeviceKeyStore` SPI. **The private key never enters JS.** Falls back to quick-crypto + SecureStore on unsupported devices, and reports the degradation in the security-posture screen (mirroring the desktop `secretStore.secure` flag). |
| Tokens / resume secret | `expo-secure-store` | Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) / Keystore-encrypted SharedPreferences. `configureAndroidBackup: true`. **Never AsyncStorage.** |
| Offline cache | `react-native-mmkv` with an encryption key held in SecureStore | Chat/run snapshots, tokenized highlight cache, avatars |
| Durable event log | `expo-sqlite` (optional, Phase 5) | Only if we want offline replay beyond the MMKV snapshot budget |
| Biometrics | `expo-local-authentication` | App-open lock (opt-in) + mandatory re-auth before granting `exec:*` scopes or approving destructive HITL |
| QR pairing | `expo-camera` `CameraView` barcode scanner | Reads `generatorai://pair?code=…` |
| Deep links | `expo-linking` + `generatorai://` scheme + universal links | Pairing, notification routing |

### 4.3 Networking

| Concern | Choice | Notes |
| --- | --- | --- |
| HTTP | `expo/fetch` (WinterCG fetch with **streaming response bodies**) | Streaming support is the reason to prefer it over RN's XHR-backed `fetch` |
| SSE | **In-house `SseClient`** on `expo/fetch` + `ReadableStream` | RN has no `EventSource`. We need `Last-Event-ID`/`afterSeq` resume, per-connection ticket minting and the stall watchdog anyway — all of which the web `sseManager` already implements and which we are extracting to `packages/client-core`. `react-native-sse` is the fallback. |
| WebSocket | RN built-in `WebSocket` with `binaryType='arraybuffer'` | Terminal PTY, browser MJPEG frames, STT audio |
| E2EE / relay | `packages/relay-protocol` unchanged + quick-crypto | The frame format is already RN-friendly (no DOM APIs) |
| Reachability | `expo-network` + `@react-native-community/netinfo` | Drives the endpoint supervisor (LAN → relay failover) |
| LAN discovery | `react-native-zeroconf` (Phase 4) | Optional mDNS discovery of a host on the same Wi-Fi |

### 4.4 Platform integration

| Concern | Choice |
| --- | --- |
| Push | `expo-notifications` + `expo-task-manager` (headless background handler). Server-side: new push registry + dispatcher (§7) |
| iOS Live Activity / Dynamic Island | `@bacons/apple-targets` `widget` target (SwiftUI) fed via App Group `UserDefaults` — live workflow-run progress on the lock screen |
| Android ongoing notification | `expo-notifications` with `sticky: true` + progress, same data source |
| Background refresh | `expo-background-task` (WorkManager / BGTaskScheduler) — reconcile run state, badge counts |
| Screen-awake | `expo-keep-awake`, only while a run/terminal is actively streaming |
| Haptics | `expo-haptics` — approve/reject, stage completion, error |
| Audio | `expo-audio` — STT capture |
| Files | `expo-file-system`, `expo-document-picker`, `expo-image-picker`, `expo-sharing` |
| System chrome | `expo-system-ui` + `expo-status-bar` — theme-synced status/nav bars |
| Build & release | **EAS Build** (iOS + Android from one command), **EAS Update** (OTA JS/asset updates per channel), `expo-updates` |
| Crash/telemetry | Sentry (`@sentry/react-native`) wired into the repo's existing `packages/shared` logger/telemetry contract, with the same `redactDeep` scrubbing |

---

## 5. Solving the hard features

### 5.1 Integrated terminal

**Decision: xterm.js hosted in a `react-native-webview`, with React Native owning the socket.**

```
 PTY (server)  ──WS /api/workspaces/:id/terminals/:sid/stream──▶  RN TerminalScreen
                                                                     │  (owns WebSocket,
                                                                     │   watermark ACKs,
                                                                     │   reconnect, ticket)
                                                                     ▼
                                                    WebView(local bundle: xterm.js + addons)
                                                       ◀── postMessage {type:'data', b64}
                                                       ──▶ postMessage {type:'input', b64}
                                                                     │
                                       native key toolbar ───────────┘
                                  (Esc Tab Ctrl ↑↓←→ | ⌃C ⌃D ⌃Z, paste, search)
```

Why this and not a native emulator:

- We keep **the exact terminal** users see on desktop: same ANSI/xterm parser, same
  reflow, same search addon, same web-links addon, same theme derived from our tokens.
- The existing **watermark flow-control / ACK protocol stays on the RN side**, unchanged —
  no protocol fork, and the WebView never touches the network.
- Bytes cross the bridge base64-framed and **batched at 16 ms**, so bridge traffic is
  bounded by frame rate, not by PTY throughput.
- The WebView is loaded from a **local asset bundle**, `originWhitelist: []`,
  JavaScript enabled but no network — it is a renderer, not a browser.

Mobile-specific UX: a persistent key-accessory bar above the keyboard, tap-and-hold for
selection with a magnifier, swipe between tabs, "attach selection to chat", and a
worktree quick-`cd` chip row.

**Gating:** the Terminal tab is invisible unless the device holds `exec:terminal`.
Requesting it is an explicit, per-device, biometric-confirmed grant on the desktop/web
Security settings page. This preserves the guarantee proven by
[agent-tests/scope-enforcement-probe.mjs](../agent-tests/scope-enforcement-probe.mjs).

### 5.2 Diff viewer and syntax highlighting

Two independent problems; solve them separately.

**(a) Diff computation.** Move hunk computation server-side. `packages/changes` and
`packages/source-control` already centralize diff production (session 86). Add a
response shape that returns structured hunks rather than HTML:

```ts
type DiffHunk = {
  oldStart: number; oldLines: number;
  newStart: number; newLines: number;
  rows: Array<{ kind: 'add'|'del'|'ctx'; oldNo?: number; newNo?: number; text: string }>;
};
```

The RN renderer becomes a `LegendList` of rows — virtualized, dynamic-height,
zero-dependency. Word-level intra-line diff is computed client-side with `diff-match-patch`
only for the visible window.

**(b) Highlighting.** Three options were considered:

| Option | Verdict |
| --- | --- |
| Ship `shiki` with the WASM Oniguruma engine | ✗ WASM in RN is workable but heavy and slow to start |
| Ship `shiki` with the **JavaScript RegExp engine** (no WASM) | ✓ viable fallback; ~1–2 MB of grammars, acceptable CPU for ≤ 500-line windows |
| **Server-side tokenization endpoint** | ✓ **recommended primary** |

Recommended: add `GET /api/highlight?path=…&sha=…&theme=…` returning themed token runs
per line, produced by the *same* Shiki instance and *same* theme the desktop uses. This
gives byte-identical colors across desktop and mobile, costs the phone nothing, and caches
perfectly in MMKV keyed by `(blobSha, theme)`.

> **Cache-key note (from prior hard-won experience): the highlight cache key must include a content identity (blob SHA), not just the path.** A path-keyed cache with a long `staleTime` silently serves stale colors when the file changes.

The on-device `shiki` JS-engine path stays as an offline fallback and is feature-flagged.

**Layout:** unified diff by default on phones; side-by-side unlocked on ≥ 768 dp width or
landscape tablets. Pinch-to-zoom adjusts code font size (persisted). Sticky hunk headers.
Tap a line to open the review-comment composer.

### 5.3 Streaming render performance

This is where a naive RN port dies. The design:

1. **One shared reducer.** Extract `apps/web/src/stores/sseManager.ts::processEvent` and
   `streamStore.ts` into `packages/client-core/src/stream/`. Both web and mobile import it.
   The load-bearing cross-buffer flush that preserves thinking↔token interleaving
   (AGENTS.md invariant #4) is preserved verbatim and gains a shared test suite.
2. **Coalesce at the frame boundary.** Token deltas accumulate in a plain mutable buffer
   and flush into the Zustand store on a 16 ms `requestAnimationFrame` tick. The store
   therefore emits ≤ 60 updates/s regardless of token rate.
3. **Only the tail re-renders.** Completed blocks are `React.memo`'d on a stable
   `(blockId, revision)` pair. A 3,000-message chat re-renders exactly one component
   while streaming.
4. **`LegendList` with `recycleItems` + `alignItemsAtEnd` + `maintainScrollAtEnd`** — no
   inverted list, so animations and the keyboard behave.
5. **Markdown is parsed incrementally**: `marked` lexes the tail block only, and the last
   (possibly unterminated) fenced block renders as plain mono text until it closes.
6. **Cold start** hydrates from the MMKV snapshot, then reconciles via paginated REST
   replay, then attaches the live stream at `afterSeq`.

Budget: **60 fps sustained at 200 tok/s on a Pixel 6a / iPhone 12.** Enforced by a
Maestro + `react-native-performance` CI check (§9).

### 5.4 DAG workflow view

Full drag-and-drop graph authoring on a 6-inch screen is a bad product, not just a hard
build. Split it:

- **View / monitor (Tier B, ship it):** a Skia canvas. Layout comes from the existing
  server-side DAG ordering (Kahn's algorithm output) rendered as a layered graph; edges
  are quadratic Béziers colored by edge type (`on_success` / `on_failure` /
  `on_completion` / `always`). Pinch-zoom + pan via gesture-handler shared values, so
  the canvas never crosses the JS bridge during interaction. Node status animates from
  the same `run.stage_run.*` events the timeline uses. Tap a node → stage detail sheet.
- **Outline editor (Tier B, Phase 5):** a nested list representation of stages and edges —
  add stage, reorder, connect/disconnect, edit scalar config. Genuinely usable on touch,
  and it produces exactly the same `CreateStage` / `StageEdge` payloads.
- **Freeform canvas authoring (Tier C):** stays on web/desktop, with a "Continue on
  desktop" deep link from mobile.

### 5.5 File manager

- Codebase and workspace trees as a lazily-expanding `LegendList` (flatten the tree into
  a visible-rows array — the same technique `@pierre/trees` uses, minus the shadow DOM).
- File icons from `material-file-icons` SVG paths rendered through `react-native-svg`,
  colored by the existing `--file-icon-*` tokens.
- Preview by kind: code → highlighted viewer; markdown → renderer; image → `expo-image`;
  everything else → metadata + "Open with…" via `expo-sharing`.
- Download to the OS files app; share sheet; **upload gated on `write:files`**.

### 5.6 Markdown

An in-house renderer: `marked` produces a token tree; a `Record<TokenType, Component>` map
renders it. Same contract as the web renderer, so a block type added on web is a one-file
change on mobile. Handles: headings, lists, tables (horizontal scroll), blockquotes,
task lists, inline + fenced code (with copy button and the §5.2 highlighter), links
(`expo-web-browser`), images, and GFM strikethrough/autolink.

### 5.7 Extensions and widgets

This one is nearly free, because [feature-extensions-widgets.md](../.github/docs/feature-extensions-widgets.md)
already serves widget assets from a **separate origin** (`WIDGET_PORT`, default 3101) for a
genuine cross-origin iframe sandbox.

On mobile, that same origin is loaded in a `react-native-webview`:

- **Inline widget** → a fixed-height WebView card in the chat stream, auto-sized via a
  `postMessage` height report.
- **Full-page widget** → a route/sheet.
- `widget_action` / `widget_exec` / `read_widget` / `describe_widget` ride the existing
  HTTP API; the WebView only renders.
- Hardening: `originWhitelist` pinned to the widget origin, `javaScriptCanOpenWindowsAutomatically: false`,
  `setSupportMultipleWindows: false`, `allowsInlineMediaPlayback` off by default, no file
  access, and the same `WIDGET_CONNECT_SRC` CSP the server already emits.

### 5.8 Integrated browser

`ServerPlaywrightHost` already streams JPEG frames over WebSocket at
`GENERATORAI_BROWSER_STREAM_FPS` (default 20). On mobile:

- Render frames into an `expo-image` / Skia surface from an `arraybuffer` WS.
- Viewport negotiation already auto-matches the panel; mobile reports its own dp size so
  the remote Chromium renders at phone dimensions.
- Tap → click at scaled coordinates; long-press → context; two-finger drag → scroll;
  a text field focus event raises the native keyboard and forwards keystrokes.
- Capture / share / attach-to-chat: full parity.
- **Gated behind `exec:browser`.** Without the grant, the tab shows the last screenshot
  artifact read-only (which only needs `read:files`).
- Cheap alternative offered in settings: "Open URL in system browser" via `expo-web-browser`.

### 5.9 Voice input

`expo-audio` records PCM; a small JS resampler produces 16 kHz mono Float32 (RN has no
AudioWorklet, so we chunk in JS at ~100 ms — well within budget); frames go over the same
`/api/stt/stream` WebSocket with a stream ticket. Zero server change. The local Whisper
model stays on the host — the phone sends audio, never a cloud key.

---

## 6. Architecture

### 6.1 New shared packages (the core of this proposal)

```
packages/
├── design-tokens/          NEW — single source of truth for the visual language
│   ├── src/tokens.ts       surfaces, accents (6), status, sidebar, canvas, file-icons,
│   │                       radius, typography, spacing, motion
│   ├── build/emit-css.ts   → apps/web/src/styles/globals.css  (@theme inline)
│   └── build/emit-native.ts→ apps/mobile/theme/tokens.generated.ts + tailwind theme
│
├── client-core/            NEW — platform-agnostic client logic
│   ├── api/                typed client generated from apps/server/src/routes/openapi.ts
│   ├── queries/            TanStack query keys + hooks (no DOM)
│   ├── stream/             SSE event reducer (extracted from apps/web sseManager +
│   │                       streamStore) — block model, cross-buffer flush, replay
│   └── selectors/          derived state (activity feed, context usage, cost)
│
├── client-transport/       NEW — connection layer
│   ├── TransportAdapter.ts SPI: loopback | lan | ssh | relay
│   ├── EndpointSupervisor  candidate ordering, health, backoff, failover
│   ├── RelayTransport.ts   wraps packages/relay-protocol
│   └── E2eeSession.ts      handshake + framing (thin wrapper)
│
└── client-runtime/         EXISTING — gains a mobile adapter only
    └── nativeStores.ts     NEW: expo-secure-store session store +
                            expo-device-key DeviceKeyStore
```

`apps/web` is refactored to consume `design-tokens`, `client-core` and `client-transport`
**in the same phase that mobile starts using them.** This is non-negotiable: a fork here
guarantees drift.

Boundary rules follow the existing ESLint layering: these are **Presentation-adjacent**
packages. They may import `@generatorai/shared` types and nothing from `core`, `db` or
any provider SDK.

### 6.2 Mobile app layout

```
apps/mobile/
├── app.config.ts               Expo config + plugins (secure-store, notifications,
│                               camera, apple-targets, quick-crypto, sentry)
├── eas.json                    dev / preview / production profiles
├── app/                        expo-router — mirrors web URLs 1:1
│   ├── _layout.tsx             providers: Query, Theme, Auth, Transport, GestureHandler
│   ├── (auth)/pair.tsx         QR scan → consent → complete
│   ├── (auth)/locked.tsx       biometric gate
│   ├── (tabs)/_layout.tsx      bottom tabs
│   │   ├── index.tsx           Activity (dashboard)
│   │   ├── chats.tsx
│   │   ├── runs.tsx            workflows + runs + automations
│   │   └── projects.tsx
│   ├── chats/[id].tsx
│   ├── workflows/[id]/index.tsx
│   ├── workflows/[id]/runs/[runId].tsx
│   ├── automations/[id].tsx
│   ├── projects/[id]/index.tsx
│   ├── projects/[id]/codebases/[cid].tsx
│   ├── diff/[workspaceId]/[path].tsx
│   ├── terminal/[workspaceId].tsx
│   ├── browser/[workspaceId].tsx
│   ├── widget/[extensionId]/[widgetId].tsx
│   └── settings/…              appearance · providers · catalogs · extensions ·
│                               security(devices, posture, scopes) · diagnostics
├── src/
│   ├── auth/                   device-key module binding, DPoP, session, biometrics
│   ├── transport/              endpoint supervisor wiring, netinfo, background resume
│   ├── stream/                 SseClient (expo/fetch), WsClient, reconnect policy
│   ├── components/             ui/ chat/ workflow/ diff/ tree/ terminal/ browser/
│   │                           widget/ markdown/ layout/
│   ├── theme/                  tokens.generated.ts, ThemeProvider, useTheme
│   ├── notifications/          registration, categories, routing, live-activity bridge
│   └── native/                 expo-device-key (Swift + Kotlin)
├── assets/                     fonts (JetBrains Mono), xterm webview bundle, icons
└── e2e/                        Maestro flows
```

### 6.3 Connection lifecycle

```
launch
  └─ SecureStore: session? ──no──▶ /pair (QR)
        │yes
        ▼
  biometric gate (if enabled)
        ▼
  EndpointSupervisor.resolve()
        ├─ 1. pinned LAN endpoint          (fast, no relay)
        ├─ 2. private network endpoint     (Tailscale/VPN, optional)
        └─ 3. relay invite / resume        (E2EE, blind forwarder)
        ▼
  GET /api/auth/server-info → assert serverId == pinned
        │ mismatch ▶ HARD STOP, HostIdentityChangedError, no credential sent
        ▼
  POST /api/auth/token/refresh (DPoP over device key) → token + rotated resume secret
        ▼
  hydrate from MMKV → REST replay → mint stream ticket → attach SSE at afterSeq
        ▼
  on background: detach SSE, keep push subscription
  on foreground: revalidate token, re-mint ticket, resume at last afterSeq
```

Backoff is bounded exponential with jitter. A revoked device (401 + `DEVICE_REVOKED`)
wipes local state and returns to `/pair` with an explanation.

### 6.4 Where the mobile client differs from web

| Aspect | Web | Mobile |
| --- | --- | --- |
| Auth bootstrap | Same-origin, auto-pairs from the desktop shell | QR pairing, remote by default |
| Transport | Direct | LAN → relay failover with E2EE |
| SSE | `EventSource` | `expo/fetch` streaming reader |
| Lifecycle | Tab always alive | Backgrounded/killed by the OS; must resume by sequence |
| Key storage | Non-extractable WebCrypto in IndexedDB | Secure Enclave / Android Keystore |
| Notifications | None | APNs / FCM with actionable HITL |

---

## 7. Server-side work required

Deliberately minimal. The whole point of the existing design is that mobile is just
another paired device.

| # | Change | Size | Phase |
| --- | --- | --- | --- |
| S1 | **Push registry**: `POST /api/devices/:id/push-token`, `DELETE …`. Token stored against the device row; wiped on revoke. | S | 4 |
| S2 | **Push dispatcher**: subscribe to `EventBus` for `stage_run.awaiting_input`, `run.completed/failed`, `chat.question_asked`, `automation_execution.failed`; fan out to Expo Push / APNs / FCM. Respects device scopes and per-device mute settings. | M | 4 |
| S3 | **Highlight endpoint** `GET /api/highlight` returning Shiki token runs keyed by blob SHA (§5.2). | M | 3 |
| S4 | **Structured diff hunks** in the changes API (may already be derivable from `packages/changes`; verify before building). | S–M | 3 |
| S5 | **Per-device scope elevation** UI/API: request → approve on a trusted device → audit event. The scope model exists; the request/approve flow does not. | M | 4 |
| S6 | Extend `GET /api/security/posture` with `secretStore.secure` reporting for mobile devices (Secure Enclave vs. fallback). | XS | 2 |
| S7 | Route-policy audit: confirm every route mobile touches has the right scope mapping, and that `DEFAULT_MOBILE_SCOPES` is sufficient for Tier A. | S | 1 |

No changes to the relay, the E2EE protocol, the pairing protocol, DPoP, or the SSE
contract.

---

## 8. UI/UX design

### 8.1 Design language: one token set, three renderers

`packages/design-tokens` becomes the single source. It emits the web `globals.css`
(`@theme inline`) **and** the mobile token module, so the two can never diverge.

Ported verbatim from [apps/web/src/styles/globals.css](../apps/web/src/styles/globals.css):

**Surfaces**

| Token | Dark | Light |
| --- | --- | --- |
| `background` | `#0d1117` | `#ffffff` |
| `foreground` | `#e6edf3` | `#1f2328` |
| `card` | `#161b22` | `#f6f8fa` |
| `popover` / `overlay` | `#1c2129` | — |
| `subtle` | `#21262d` | — |
| `emphasis` | `#30363d` | — |
| `sidebar` | `#161b22` | — |

**Status (never accent-controlled)** — `success #3fb950`, `warning #d29922`,
`info #4493f8`, `danger #f85149`, `done #a371f7`, each with its `-muted` companion.

**Six accents**, identical to web: blue (default), violet, green, orange, rose, teal —
each with a dark and light `primary` plus a derived `primary-emphasis` (AA-safe button
background) and `accent` tint. On web these come from `color-mix()`; on mobile the build
step **pre-computes** them, so the emitted values are numerically identical.

**Radius** `6 / 8 / 10 px`. **Type**: system sans (SF Pro / Roboto) + **JetBrains Mono
bundled** for code so diffs and terminal look the same on every device.

### 8.2 Theme implementation

```tsx
// Runtime theming with NativeWind CSS variables — the same model as web.
<View style={vars(theme === 'dark' ? darkVars : lightVars)} className="flex-1 bg-background">
```

- Three selectable themes: **System / Light / Dark** (dark is the default, matching web).
- Six selectable accents.
- `useColorScheme()` drives System; `Appearance` change listener repaints live.
- `expo-system-ui` + `expo-status-bar` sync the status bar, Android nav bar and the
  root background so there is no flash on rotate or cold start.
- Theme choice is stored in MMKV and applied **before first paint** via the router's
  splash-screen hold — the mobile equivalent of the web's pre-hydration script.
- Full support for iOS/Android "Increase Contrast" and Dynamic Type: all sizing uses
  `PixelRatio.getFontScale()`-aware scales, capped at 1.35× in dense views (diff, terminal).

### 8.3 Navigation model

The web's **sidebar + main + RightPane** does not fit a phone. The mapping:

| Web | Mobile |
| --- | --- |
| Left sidebar nav | **Bottom tab bar**: Activity · Chats · Runs · Projects (Settings behind the avatar) |
| Main content | Stack screen |
| **RightPane** (Changes / Inspector / Browser / Terminal / Widgets) | **Bottom sheet** with a segmented control, snap points `[peek 12%, half 55%, full 92%]`, drag-to-expand. On tablets/landscape it becomes a true side pane, restoring the desktop layout. |
| Modals/dialogs | Sheets (`@gorhom/bottom-sheet`) or full-screen modal routes |
| Command palette ⌘K | Global search sheet (pull down on any list) |
| Toasts (sonner) | Top-anchored Reanimated toast, respecting safe-area |

### 8.4 Key screens

**Chat** — the flagship.
- Header: title, model chip, context-usage ring (Skia), overflow menu.
- Stream: `LegendList`, `alignItemsAtEnd`. Block types render as: user bubble ·
  assistant markdown · **collapsible thinking block** (dimmed, mono, auto-collapses when
  the next text block starts) · **tool call row** (icon + name + duration + expandable
  args/result) · plan card · question card · widget card · system note.
- A floating "N new" pill when scrolled up; tap to jump to the tail.
- Composer: growing input, mic, attach, model chip, send. Above the keyboard, a
  context row shows the attached project/codebases. Long-press send → "send with
  permission mode…".
- HITL question cards are **sticky** at the bottom until answered, with large
  Approve / Reject / Answer targets and a haptic confirmation.

**Workflow run.**
- Header: status badge, live elapsed timer, pause/resume/cancel/retry.
- Segmented: **Timeline** (default) / **Graph** (Skia) / **Changes**.
- Timeline: vertical stage list with status rail, duration, token/cost chips; tap a
  stage → full-screen stage stream (same renderer as chat).
- Stages awaiting input are pinned to the top with a badge.

**Changes / review.**
- File list grouped by directory with `+/−` counts and status badges.
- Tap → full-screen diff, swipe left/right to move between files.
- Tap a line → comment composer; thread view; Approve / Request changes at the top.
- Checkpoint timeline in a sheet.

**Activity (dashboard).**
- System health pill (from `/api/health` + `/api/security/posture`).
- "Needs attention" first (HITL gates, failed runs), then Running, then Today.
- Quick actions: New chat · Run workflow · Trigger automation.

**Security settings — mobile's signature screen.**
- This device: name, platform, granted scopes, key backing
  ("Secure Enclave" / "Keystore" / "software — degraded"), pairing date, transport in use.
- Other devices: list, last used, revoke (with biometric confirmation).
- Server: name, `serverId` fingerprint formatted `ABCD-1234-5678-90AB`, transport,
  relay state, secret-store backend, and the posture **warnings** list rendered as
  severity-colored cards.
- Scope requests: "Request terminal access" → approve on a trusted device.

### 8.5 Motion, haptics, accessibility

- Reanimated `LayoutAnimation` for list insertions (new message, new stage) — spring,
  ≤ 220 ms; disabled under "Reduce Motion".
- Shared-element transition from chat card → chat screen.
- Haptics: light on send, success on approve, warning on reject, error on run failure.
- Every interactive target ≥ 44×44 pt. Full VoiceOver/TalkBack labels including live
  regions for streaming text (announced on block completion, not per token).
- Contrast verified at AA for all six accents in both schemes — this is already true on
  web because `primary-emphasis` exists for exactly this reason; the token build asserts it.

---

## 9. Research: how modern agentic platforms build mobile companions

Findings from reviewing the current landscape (OpenAI Codex in the ChatGPT iOS app,
Cursor's web/mobile agent surface, Claude Code's remote surfaces, GitHub Copilot's mobile
presence, Devin, Replit, Warp), and the patterns that generalize:

1. **The phone is a control plane, not an IDE.** Every successful implementation
   optimizes for *delegate → monitor → review → approve*, not for authoring. Codex is
   explicitly positioned as working "in your terminal or IDE, on the web, in GitHub, and
   even in the ChatGPT iOS app" — the phone is the thinnest of the four. Our Tier A/B/C
   split follows this directly.
2. **Approval is the killer mobile feature.** Long-running agents block on human
   decisions. A push notification with inline Approve/Reject that resolves a gate in
   three seconds is worth more than a mobile DAG editor. This is why HITL is elevated to
   a first-class surface with actionable notifications, and why `write:reviews` is in the
   default mobile scope set.
3. **Code review reads well on a phone; code authoring does not.** Diff review with
   comment threads is the second-highest-value mobile surface. Codex's own product
   direction (automatic PR review, "@codex review") reinforces that review is where
   agentic value concentrates.
4. **Progressive trust, not a single permission wall.** Every mature implementation
   starts narrow and lets the user widen. Our scope model already does this; the mobile
   app makes the elevation flow visible instead of hidden.
5. **Session continuity across surfaces is the retention mechanic.** Codex "maintains
   context" when you move a cloud task into the IDE. Our equivalent is a
   "Continue on desktop" deep link from every mobile screen that hits a Tier C boundary,
   plus resumable SSE by sequence number so switching devices never loses stream state.
6. **Ambient progress beats polling.** Lock-screen Live Activities / ongoing
   notifications for a running workflow are the mobile-native answer to the web's
   always-open tab.
7. **Terminal on mobile is table stakes but rarely the primary surface.** Every remote
   dev tool that ships one uses a WebView-hosted emulator plus a key-accessory bar. Nobody
   writes a native ANSI parser. This validates §5.1.
8. **Screenshots and visual artifacts matter.** Codex "spins up its own browser, looks at
   what it built, and attaches a screenshot." Our browser-capture artifacts are already
   first-class; on mobile they should be a prominent, swipeable gallery in the run view.

---

## 10. Delivery plan

Each phase is independently shippable and independently valuable.

### Phase 0 — Foundations (shared packages)

| Deliverable | Detail |
| --- | --- |
| `packages/design-tokens` | Token module + web CSS emitter + native emitter + contrast assertions. **`apps/web` migrated to consume it in this phase.** |
| `packages/client-core` | OpenAPI-generated typed client; query keys + hooks; **stream reducer extracted from `apps/web`** with a ported test suite. `apps/web` migrated to consume it. |
| `packages/client-transport` | `TransportAdapter` SPI, `EndpointSupervisor`, relay + E2EE wrappers. |
| Exit criteria | `pnpm lint && pnpm typecheck && pnpm test` green; `agent-tests` Playwright suite unchanged and passing; **zero visual diff in the web app**. |

> This phase touches the web app. It is the highest-risk, highest-leverage phase and
> must land cleanly before any mobile code is written.

### Phase 1 — Mobile shell, pairing, security

| Deliverable | Detail |
| --- | --- |
| `apps/mobile` scaffold | Expo SDK 57, expo-router, NativeWind, theme provider, tab shell, EAS dev/preview profiles |
| `expo-device-key` native module | Secure Enclave (iOS) + Keystore (Android) P-256, `DeviceKeyStore` implementation, software fallback + degradation reporting |
| `nativeStores.ts` in `client-runtime` | SecureStore session store + device-key binding |
| Pairing flow | `expo-camera` QR scan → `parsePairingCode` → consent screen (host name, endpoint, **fingerprint**, requested scopes, transport options) → `pair/complete` |
| Transport | LAN + relay with E2EE; host-identity pinning enforced before any credential transmission |
| Security settings | This device, other devices, revoke, posture + warnings |
| Biometric lock | Optional app-open gate |
| Exit criteria | A physical phone pairs over LAN *and* over the relay, survives reboot via resume-secret rotation, refuses a substituted host, and is revocable from the desktop with immediate effect. New `agent-tests/mobile-security-e2e.mjs` mirrors `security-e2e.mjs` + `host-pinning-e2e.mjs` against the mobile runtime. |

### Phase 2 — Chat (the core loop)

Chat list/search/create · streaming renderer (all block types) · markdown renderer ·
model picker · composer · cancel/archive/delete · **HITL question cards and plan
review** · context/cost chips · offline snapshot + resume-by-sequence.

*Exit criteria:* 60 fps at 200 tok/s on a Pixel 6a; kill the app mid-stream and resume
with zero lost or duplicated events.

### Phase 3 — Runs, automations, diffs, review

Workflow list + definition · run monitor (timeline + Skia graph) · pause/resume/cancel/retry ·
variable input · automations list/trigger/history · **changes tree + diff viewer +
review threads + approve** · server highlight endpoint (S3) + structured hunks (S4) ·
projects + codebases + file browsing · workspace artifacts.

*Exit criteria:* a 5,000-line diff scrolls at 60 fps; a review can be completed end-to-end
from the phone.

### Phase 4 — Notifications, background, elevation

Push registry + dispatcher (S1, S2) · actionable HITL notifications · deep-link routing ·
iOS Live Activity + Android ongoing notification for run progress · background task
reconciliation · badge counts · per-device notification preferences · **scope elevation
request/approve flow (S5)** · mDNS LAN discovery.

*Exit criteria:* an approval gate raised while the app is killed produces a notification
that can be resolved from the lock screen.

### Phase 5 — Terminal, browser, widgets, voice

WebView xterm terminal + key toolbar (gated on `exec:terminal`) · browser viewer + input
(gated on `exec:browser`) · widget WebView host (inline + full-page + actions) ·
extensions browse/install/settings · voice input · attachments/upload · scripts list+run ·
DAG outline editor · orchestrator background-tasks view.

### Phase 6 — Polish, store readiness, hardening

Tablet/landscape two-pane layout · full accessibility pass · localization scaffold ·
Sentry + telemetry parity · App Store / Play listings, privacy manifests, export-compliance
(`usesNonExemptEncryption` — note we *do* use non-exempt crypto, so this needs a proper
declaration, not the shortcut) · EAS Update channels · performance regression gates in CI.

---

## 11. Future enhancements (explicitly deferred, with rationale)

These are **not** mobile v1. Each is listed with why, and what mobile offers instead.

| # | Feature | Why deferred | Mobile substitute |
| --- | --- | --- | --- |
| F1 | Visual DAG authoring (drag nodes, draw edges, undo/redo) | Precision pointing + large canvas are structural desktop advantages | Read-only Skia graph + outline editor + "Continue on desktop" |
| F2 | Long-form prompt / stage-instruction authoring | Sustained typing on glass | Read + short edits; voice dictation for drafts |
| F3 | Hook definition editing (22 phases × 3 types × policies) | Dense matrix UI | View-only summary of configured hooks |
| F4 | MCP server JSON editing | Raw JSON on a phone is an error factory | Enable/disable + view; edit on desktop |
| F5 | Extension authoring (`write_extension`) | Code authoring | Install/enable/configure only |
| F6 | Local-dir / git-local codebase linking | The phone cannot see the host filesystem | Explicit "desktop only" affordance |
| F7 | Command palette (⌘K) | No keyboard-first model on touch | Global search sheet + deep links |
| F8 | Simultaneous multi-pane layout | Screen size | Bottom sheet on phones; **restored on tablets in Phase 6** |
| F9 | Browser DOM inspector | Dense tree + hover semantics | Screenshot capture + element tap-to-identify |
| F10 | Sandbox / Docker controls | Host-level operation | Status display only |
| F11 | SDK, custom tool registration, MCP stdio | Not a client concern | — |
| F12 | Full offline authoring queue (compose offline, send on reconnect) | Conflict semantics need design | Read-only offline cache in v1 |
| F13 | Apple Watch / widget quick-approve | Post-v1 | Actionable notification covers 90% of the value |
| F14 | Multi-host switching (several paired servers in one app) | Adds transport + cache-partition complexity | Single active host in v1; the pairing model already supports more |

---

## 12. Risks and mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Phase 0 refactor destabilizes `apps/web` | **High** | Phase 0 ships behind the existing Playwright `agent-tests` suite; no behavior change permitted; the sseManager cross-buffer flush is moved verbatim with tests written *before* the move (AGENTS.md invariant #4) |
| Streaming performance below target | High | Frame-coalesced flush + memoized blocks + LegendList; performance gate in CI from Phase 2 |
| Diff/highlight cost | Medium | Server-side tokenization is the primary path; content-SHA cache keys; on-device engine only as a flagged fallback |
| WebView terminal latency | Medium | RN owns the socket; 16 ms batched base64 bridge; measure keystroke→echo, budget < 80 ms on LAN |
| NativeWind v4 (Tailwind 3) vs. web Tailwind 4 divergence | Medium | `design-tokens` is the contract, not the Tailwind version. Utility differences are absorbed in the primitive components. Re-evaluate NativeWind v5 at Phase 6 |
| Secure Enclave unavailable / biometric change invalidates keys | Medium | Documented failure mode: key invalidation → re-pair. Detected and surfaced, never silent. Software fallback reported in posture |
| Relay latency on mobile networks | Medium | Prefer LAN; supervisor failover; SSE resume by sequence makes drops non-destructive; show the active transport in the UI |
| Store review friction (encryption declaration, background modes) | Medium | Handle export compliance explicitly (we use non-exempt crypto); justify `remote-notification` + `processing` background modes in review notes |
| Scope creep into authoring | Medium | The Tier A/B/C table is the contract. Tier C changes require an explicit decision |
| Expo SDK / RN upgrade cadence (3 releases/yr) | Low | EAS Update for JS; schedule one SDK upgrade per quarter; the shared packages are RN-version-agnostic |

---

## 13. Open questions for you

1. **Highlighting**: confirm the server-side tokenization endpoint (S3) is acceptable, or
   do you want the app fully self-contained offline (heavier bundle, on-device Shiki)?
2. **Multi-host**: single paired server in v1 (F14), or is multi-host a day-one need?
3. **Push infrastructure**: Expo Push Service (fastest, adds a third party in the path for
   notification *metadata* only) vs. direct APNs/FCM from your server (more work, no third
   party)? Given the security posture of this project, I lean **direct APNs/FCM**.
4. **Tablet**: is iPad/Android-tablet two-pane layout a Phase 6 item as proposed, or does
   it need to be earlier?
5. **Terminal in v1**: Phase 5 as proposed, or is it important enough to pull into Phase 3?
6. **Distribution**: public App Store / Play, or internal (TestFlight + Play internal
   track / enterprise)? This changes the review and privacy-manifest burden materially.
7. **Phase 0 sequencing**: are you comfortable with a refactor that touches `apps/web`
   before any mobile code exists? The alternative — duplicating the stream reducer — is
   faster to start and much more expensive within two releases.

---

## 14. Documentation follow-ups (independent of the mobile app)

While reading, one gap surfaced: **`.github/AGENTS.md` does not document the auth,
pairing, relay, E2EE or secrets work at all.** `packages/auth`, `packages/secrets`,
`packages/client-runtime`, `packages/relay-protocol` and `apps/relay` are absent from the
repository map, the "where to read what" table and the invariants list — even though they
introduce several load-bearing invariants (DPoP `jti` replay store, stream-ticket
single-use, host-identity pinning before credential transmission, revocation outbox
durability).

Recommended, and cheap:

- Add `.github/docs/feature-security-auth-relay.md` and link it from AGENTS.md §2.
- Add `apps/relay` and the four packages to the repository map in §2.
- Add security invariants to §5 (they are currently only enforced by
  `scripts/check-security-invariants.mjs`, with no prose explanation).
- Add the mobile app to §7's feature matrix once Phase 1 lands.

I can do this as a separate, small change whenever you want.
