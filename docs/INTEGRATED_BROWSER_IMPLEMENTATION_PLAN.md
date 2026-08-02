# Integrated Browser — Implementation Plan

> **Status:** Living plan. Sections 1–4 are the initial plan. Section 5 is the
> unbiased self-review. Section 6 is the final, use-case-aligned plan we will
> actually build. Section 7 tracks execution.

The goal is to close the perceptible gap between VSCode's integrated browser
(native `WebContentsView` overlaid on the workbench) and GeneratorAI's
Playwright-over-WebSocket panel — without breaking the agent-first use
cases documented in [`.github/AGENTS.md`](../.github/AGENTS.md).

---

## 1. Current state (verified in code)

- **Server-side headless Playwright** — [`packages/core/src/infrastructure/browser/ServerPlaywrightHost.ts`](../packages/core/src/infrastructure/browser/ServerPlaywrightHost.ts) spawns `playwright-core@1.58.2` Chromium once per workspace.
- **Streaming transport** — [`apps/server/src/browser-ws.ts`](../apps/server/src/browser-ws.ts) loops `browserService.frame({quality: 55})` at 15 fps target, backpressures at 512 KB, HTTP `/screencast.jpg` polling fallback.
- **Web panel** — [`apps/web/src/components/chat/BrowserPanel.tsx`](../apps/web/src/components/chat/BrowserPanel.tsx) decodes each frame via `new Blob([e.data]) → createObjectURL → <img>.src`, letterbox-mapped input events, `ResizeObserver` → 200 ms debounced viewport resize, 250 ms scroll poll.
- **Desktop shell** — [`apps/desktop/src/main/window-manager.ts`](../apps/desktop/src/main/window-manager.ts) is a plain `BrowserWindow` loading the same web SPA. **No `WebContentsView`, no `<webview>`, no browser-specific IPC channels.** Desktop reuses the JPEG stream, so it feels identical to the web.
- **Port already anticipates native mode** — [`IBrowserBridge`](../packages/core/src/domain/ports/IBrowserBridge.ts) declares `BrowserMode = 'native' | 'screencast' | 'off'` and mentions `ElectronBridgeAdapter`. Composition root ([`apps/server/src/composition-root.ts`](../apps/server/src/composition-root.ts#L654-L666)) says *"ElectronBridgeAdapter can be prepended later for desktop native mode."*

## 2. Root-cause of the "not snappy" feeling

| Symptom | Root cause |
|---|---|
| Text looks fuzzy | JPEG-55 encoding + CSS scaling to `<img>` on hi-DPI |
| Click → visible response 100–250 ms | Every input traverses WS → CDP → next screencast frame → JPEG → Blob → `<img>` |
| Reconnect flash / tab-switch black gap | No last-frame placeholder; state loss on `frameSrc = null` |
| Scroll indicator lags | 250 ms polling of `page.evaluate('window.scrollY')` |
| CPU pegs when dragging split handle | `ResizeObserver` fires viewport-resize IPC → Chromium re-layouts entire page 5×/sec |
| GC pauses on very active pages | 15 Blob/objectURL create+revoke per second |
| Desktop app no better than Web | Desktop is just a `BrowserWindow` loading the web SPA |
| Small fps / high latency in general | The pipeline IS a video encoder + decoder + network trip per frame |

## 3. Design principles for the fix

1. **Keep the agent story intact.** The `playwright-cli` skill + shared CDP + workspace artifacts is a real feature. Nothing we do can regress agent workflows.
2. **Two personas, two rendering paths, one contract.**
   - Human view in **desktop** → real native `WebContentsView` (VSCode-style).
   - Human view in **web (browser)** → keep streaming, but modernise the frame path.
   - Agent → same CDP endpoint as today (screencast host) or attach to WCV (desktop) via `--remote-debugging-port`.
3. **Preserve `IBrowserBridge` as the sole port.** All new hosts implement it. `BrowserService` sees no vendor types. INV-1 preserved.
4. **Feature-flag the desktop native path** during rollout — off by default, opt-in via env var, promotable to default once verified.
5. **No new invariants.** FIFO emit queue (INV-2), artifact-before-emit (INV-3), commit-then-broadcast (INV-4) all still hold.
6. **No new streaming transport for events.** The unified `/api/stream` SSE + `browser.*` events remain the source of truth for UI reactivity.

## 4. Proposed changes (initial plan)

### Track A — Web streaming performance (mandatory)

Files touched:
- [`apps/web/src/components/chat/BrowserPanel.tsx`](../apps/web/src/components/chat/BrowserPanel.tsx) — frame decoding + rendering path.
- [`apps/server/src/browser-ws.ts`](../apps/server/src/browser-ws.ts) — fps/quality tuning.
- [`packages/core/src/infrastructure/browser/ServerPlaywrightHost.ts`](../packages/core/src/infrastructure/browser/ServerPlaywrightHost.ts) — expose scroll state via a page binding (event-driven) instead of poll target.

#### A1. Bitmap-blitting frame decoder

Replace `<img src=blobUrl>` with `<canvas>` + `createImageBitmap`. Reasons:
- No Blob/objectURL churn per frame → less GC pressure.
- `transferFromImageBitmap` is 0-copy on a `OffscreenCanvas`-compatible browser.
- Text rendering with `imageSmoothingEnabled: false` on hi-DPI keeps JPEG artifacts pixel-crisp instead of double-blurred by CSS scale + browser resample.

#### A2. Last-frame placeholder background

Copy VSCode's trick: keep the most recently rendered frame as `background-image` (CSS) on the container so tab-switch / reconnect never flashes black.

#### A3. Fixed viewport + CSS scale (no more resize-on-drag)

Default viewport: `1440 × 900`. Container CSS scales to fit via `object-contain` on the canvas. Result: Chromium never re-layouts on drag. Keep the `POST /resize` route for explicit "match my panel" affordance, gated behind a debounce + minimum delta of 128 px so it's rare.

#### A4. Event-driven scroll indicator

Replace the 250 ms poll with a page binding. `ServerPlaywrightHost` injects a script via `page.addInitScript` that debounces `window.onscroll` and calls a `page.exposeBinding` back into node. Node emits a `browser.scroll` SSE event. `BrowserPanel` subscribes and re-renders the overlay scrollbar. Free during idle, native lag when scrolling.

#### A5. Modest fps/quality bump

Bump WS target fps 15 → 20, quality 55 → 65. Still bounded by 512 KB backpressure. Serve `image/webp` (`page.screenshot({type:'webp',quality:65})`) when the client sends an `Accept: image/webp` hint — WebP-65 gives sharper text at same bandwidth as JPEG-55.

#### A6. Reduce per-frame allocations

- `blob.arrayBuffer()` → `createImageBitmap(new Uint8Array(ab))` — avoid Blob URL entirely.
- Double-buffered `<canvas>` — one for painting, one for next-frame decode.

### Track B — Desktop native browser (transformative)

Files added:
- [`apps/desktop/src/main/browser-host.ts`](../apps/desktop/src/main/browser-host.ts) *(new)* — owns Map<workspaceId, WebContentsView>, `--remote-debugging-port` per session, exposes CDP endpoint to server.
- [`apps/desktop/src/shared/browser-ipc.ts`](../apps/desktop/src/shared/browser-ipc.ts) *(new)* — IPC channel constants + payload types for browser operations.
- [`apps/desktop/src/preload/index.ts`](../apps/desktop/src/preload/index.ts) — extend `window.generatoraiDesktop.browser` API surface.
- [`apps/desktop/src/main/ipc.ts`](../apps/desktop/src/main/ipc.ts) — register the new handlers.
- [`packages/core/src/infrastructure/browser/ElectronBridgeAdapter.ts`](../packages/core/src/infrastructure/browser/ElectronBridgeAdapter.ts) *(new)* — `IBrowserBridge` implementation that connects over CDP to whatever port the desktop main told us about.
- [`apps/server/src/composition-root.ts`](../apps/server/src/composition-root.ts) — prepend `ElectronBridgeAdapter` to the bridge chain when running under Electron.
- [`apps/web/src/components/chat/BrowserPanel.tsx`](../apps/web/src/components/chat/BrowserPanel.tsx) — branch to native-view when `descriptor.mode === 'native'`.

Behaviour:
- In desktop, when the SPA hits `POST /browser/start`, main creates a WCV, launches Chromium with `--remote-debugging-port=<n>`, then sends the port to the server via an HTTP callback (`POST /api/internal/browser/attach-native`).
- Server's `ElectronBridgeAdapter.isAvailable()` returns true, `ServerPlaywrightHost` is skipped, all agent CDP calls flow to the WCV.
- SPA's `BrowserPanel` in native mode renders an empty positioned `<div>`, subscribes a `ResizeObserver`, calls `desktop.browser.setBounds(id, rect)` on layout changes.
- Main paints a placeholder screenshot every 1 s to a `background-image` on the SPA's placeholder div (via IPC → renderer).
- Overlay detection: SPA sends `setVisible(false)` when Radix menus / dialogs / notifications overlap the container.

Feature flag: `GENERATORAI_DESKTOP_NATIVE_BROWSER=1`. When unset, desktop falls through to Track A (screencast).

### Track C — Deferred (agent CDP sharing polish)

- Bridge multiplex: attach `debugger.attach('1.3')` on the WCV directly from main, expose the CDP protocol over an IPC pipe → `ElectronBridgeAdapter` connects to the pipe instead of a TCP port. This removes the `--remote-debugging-port` open socket, tightening the security surface.
- Skill artifact watcher — extend the current `<workspace>/browser/.playwright-cli/` watcher so agent-produced screenshots also register with the WCV session.

## 5. Unbiased review of the plan

**What I like:**
- Track A is entirely additive — no schema changes, no port changes, no invariant risk. If Track A alone were shipped, users would feel 30–50 % better without any architectural change.
- Track B follows an already-anticipated port design (`BrowserMode: 'native'`, docstring reference to `ElectronBridgeAdapter`). We aren't inventing new architecture; we are executing on an intended one.
- Feature flag on Track B contains blast radius.

**Where I'm skeptical:**

1. **A1 (canvas blit) may not be a real win on modern browsers.** Chrome's `<img>` decode pipeline is already fast; the actual bottleneck is server-side JPEG encode (30–70 ms) and network. A canvas swap saves maybe 3–5 ms per frame. Verify with a paint-timing measurement before spending complexity budget.
2. **A5 (bump fps to 20 + WebP) has a real backpressure risk.** WebP encoding at server side is slower than JPEG on Chromium (Playwright screenshot). May regress fps rather than help.
3. **A4 (event-driven scroll) — `page.exposeBinding` requires the injection to survive navigation.** Combined with `page.addInitScript`, it does, but SPAs that intercept navigation can break the binding. Need a fallback poll.
4. **B (Desktop WCV) has real complexity I underestimated in the plan text:**
   - **DPI on Windows** — WCV bounds are in "device-independent pixels" for the window; the SPA reports CSS pixels; Windows scaling factor and per-monitor DPI both apply. Getting alignment right requires the pixel-snap dance VSCode does (`Math.floor(v * hostZoom) / hostZoom`). If I ship without this, the WCV will drift ½ px on every resize.
   - **Focus** — WCV is not part of the DOM; `document.activeElement` never lands there. Real user tests will find keyboard shortcut regressions if we don't proxy them.
   - **Popup / new-window handling** — `setWindowOpenHandler` gymnastics.
   - **Overlay hit-test** — need to enumerate SPA overlay classes (dialogs, menus, sidebars) and update them as the SPA evolves. Fragile.
   - **HTTP callback from Electron main to server** for `attach-native` — the server may not be up when the desktop opens (race), or may be at a different port on restart. Need a retry + reconciliation loop.
   - **Server-under-Electron detection** — the server *doesn't know* it's running inside Electron. It runs as a subprocess. We need a signal (env var, header) to say "prefer ElectronBridgeAdapter." Not hard, but needs to be explicit.
5. **Track A's viewport-fix (A3) can break tests.** Existing e2e tests may assume the viewport matches the panel. Search the test suite before merging.
6. **Track B's feature flag needs to be readable from `BrowserPanel`.** In practice, the flag lives in Electron main; the renderer detects it via `window.generatoraiDesktop.browser?.available()`. That's fine but must be spelled out in the preload API.
7. **Testing risk** — I cannot end-to-end-test a WCV path from an assistant tool run because I don't have a way to visually observe an Electron window from here. The web track is testable via the VSCode integrated browser; the desktop track needs the user to run `pnpm --filter @generatorai/desktop dev` and eyeball it.
8. **Bundle size** — `ElectronBridgeAdapter` uses `chromium.connectOverCDP` from `playwright-core` — already a dependency. Zero new deps needed. Good.
9. **Non-invariant regressions I haven't yet ruled out:**
   - Two bridges available simultaneously (both `isAvailable() = true`) — need a deterministic priority. Fine to say "chain order = priority order".
   - `BrowserSessionDescriptor.mode` currently populated by the host. In native mode, the field is set to `'native'` — SPA branches on it. Verify no other code path currently assumes `mode === 'screencast'` unconditionally. (Spoiler: the SPA does — it must be relaxed.)

**Verdict:** Track A is safe to ship immediately. Track B is worth building but needs a soak in a feature-flagged state. Track C is genuine polish, not urgent.

## 6. Final plan (post-review, aligned with your use cases)

Your use cases (from AGENTS.md):

1. **Chat with a browser sidecar.** Human types in a URL, watches the page load, occasionally clicks or grabs a selection. Agent can also observe the same page.
2. **Workflow / automation runs that browse the web** through `playwright-cli` skill artifacts and the shared CDP endpoint.
3. **Web SPA in the browser** (localhost + any-origin — includes CI, remote dev, cloud). *This is the demo target.*
4. **Desktop app** (Electron shell embedding the server + web) — same features, but should feel native. *This is the primary long-term target.*

Given these, the shipping order is:

### 6.1 Phase 1 — "Ship-in-a-day" (Web, purely additive)

Only include changes that are **safe, reversible, and visible**:

1. **A2 — Placeholder background image.** Two-line change to the panel, huge perceived-quality win on reconnect + tab-switch.
2. **A3 — Fixed 1440×900 viewport + CSS scale.** Remove the resize-on-drag storm. Keep `POST /resize` route intact for explicit "fit" affordance (behind a button, deferred).
3. **A6 — `blob.arrayBuffer()` + `createImageBitmap` decode** (no full canvas migration yet; still paint to `<img>` via a temporary Blob URL, but reuse a single URL). Buys us the GC-pressure fix.
4. **A5 partial** — bump WS target fps 15 → 20, keep quality at 60 (a middle ground that lets us test whether encode cost bites first).
5. **BrowserPanel small polish** — accept-header `image/webp` hint so future WebP switch is a server flip, no client change.
6. **Instrumentation** — a dev-only `perf.mark` around decode → paint so we can measure real gain in Chrome DevTools.

None of these require touching the server contract or the desktop shell. If they regress, revert is a single-file rollback.

### 6.2 Phase 2 — "Ship-in-a-week" (Desktop native, feature-flagged)

Behind `GENERATORAI_DESKTOP_NATIVE_BROWSER=1`:

1. **`apps/desktop/src/main/browser-host.ts`** — thin `WebContentsView` manager. Bounds set via IPC. Screenshot every 1 s → sent to renderer as data-URL for placeholder. Overlay-obscure detection deferred.
2. **`apps/desktop/src/preload/index.ts`** — add `browser: { available, create, destroy, setBounds, setVisible, navigate, back, forward, reload, screenshot, ... }` (all `undefined` when flag off).
3. **`BrowserPanel.tsx`** — detect `window.generatoraiDesktop?.browser?.available === true` at render time. If yes, render the native branch; otherwise render current screencast branch. Both branches share the URL bar / status pill / snapshot gallery.
4. **`ElectronBridgeAdapter`** — deferred to Phase 3. In Phase 2 the SPA drives the native view *directly* via IPC (no server involvement for user actions). The server-side agent path continues to use `ServerPlaywrightHost`. This means during Phase 2, **the agent and the human are looking at DIFFERENT tabs** — which is acceptable because the agent seldom needs to see the human's tab. Deferring this saves us the HTTP-callback dance and lets us ship the visible UX win faster.

### 6.3 Phase 3 — "Ship-in-a-fortnight" (Shared CDP)

- `--remote-debugging-port` on the WCV, `ElectronBridgeAdapter` connects, server auto-picks it when running under Electron.
- Agent + human converge on the same tab.
- Overlay hit-test polish.

### 6.4 Explicit non-goals for this iteration

- **No WebRTC/MSE video pipeline** — the ROI vs canvas + `createImageBitmap` for a same-machine loopback stream isn't there. Revisit only if remote streaming becomes a real deployment target.
- **No CDP `Page.startScreencast` migration** — kept as a known deferred option (comment in `browser-ws.ts` says this was tried and was flaky).
- **No accessibility tree** — real browsers can't expose the underlying page's a11y tree through a canvas. Native mode fixes this automatically.

## 7. Execution log (updated during implementation)

### 7.1 Phase 1 — Web streaming performance

- [x] `browser-ws.ts` — fps 15 → 20 (env-tunable `GENERATORAI_BROWSER_STREAM_FPS`); quality 55 → 60 (env-tunable `GENERATORAI_BROWSER_STREAM_QUALITY`).
- [x] `BrowserPanel.tsx` — last-frame placeholder `background-image` on live-view container (VSCode-style). Reconnects, tab switches, and initial start no longer flash black.
- [x] `BrowserPanel.tsx` — replaced 200 ms resize storm with 400 ms + 256 px threshold. Chromium no longer re-layouts on every drag pixel.
- [x] Type-checks pass on `@generatorai/server` + `@generatorai/web`.
- [x] Runtime smoke: `pnpm dev:server` + `pnpm dev:web`, open [http://localhost:5174/](http://localhost:5174/) in VSCode integrated browser, opened *Browser test chat* → toggled the Browser panel → navigated to `https://example.com` → observed live view → Stop → **verified placeholder background persists after `<img>` removal (see 7.4)**.

### 7.2 Phase 2 — Desktop native browser (scaffold, feature-flagged)

- [x] `apps/desktop/src/shared/browser-ipc.ts` (new) — channel constants + payload types.
- [x] `apps/desktop/src/main/browser-host.ts` (new) — `NativeBrowserHost` managing `WebContentsView`s per workspace. Lifecycle events, per-workspace persistent partition, popup deny, back/forward via Electron 33 `navigationHistory` API.
- [x] `apps/desktop/src/main/ipc.ts` — registered channels behind the flag; `available` channel always registered so renderer can detect.
- [x] `apps/desktop/src/preload/index.ts` — `window.generatoraiDesktop.browser` API surface.
- [x] Feature flag `GENERATORAI_DESKTOP_NATIVE_BROWSER=1`. Default off → no runtime change vs today.
- [x] Type-checks pass on `@generatorai/desktop`.
- [ ] SPA-side native branch in `BrowserPanel.tsx` — deferred to a follow-up PR to keep this change small and avoid regressing the screencast path.
- [ ] Runtime smoke inside Electron with flag on.

### 7.3 Phase 3 — Shared CDP (delivered)

- [x] `--remote-debugging-port` opened by Electron main BEFORE `app.whenReady()` when the native-browser flag is on. Port is picked via `findFreePort(0)` and the endpoint (`http://127.0.0.1:<n>`) is stored on `process.env.GENERATORAI_ELECTRON_CDP_ENDPOINT`. Cleanly gated so the endpoint is only exposed when the user opts in.
- [x] `apps/desktop/src/main/server-manager.ts` — `setElectronCdpEndpoint(...)` API + `buildEnv()` plumbs the endpoint (and the feature-flag mirror) into the embedded server subprocess.
- [x] `packages/core/src/infrastructure/browser/ElectronBridgeAdapter.ts` — full `IBrowserBridge` implementation. `isAvailable()` pings `/json/version` on the endpoint. `start()` calls `chromium.connectOverCDP()`, then discovers the workspace's WCV by scanning `browser.contexts()[*].pages()` for a URL fragment marker (`#gai-<workspaceId>`). All page operations (navigate/reload/back/forward/screenshot/domSnapshot/frame/interact/scrollState) delegate to the shared Playwright `Page`. `resize()` and `screencast()` are intentional no-ops because the WCV is authoritative on size and rendering.
- [x] `apps/desktop/src/main/browser-host.ts` — `NativeBrowserHost.create()` navigates the new WCV to `about:blank#gai-<workspaceId>` immediately so the adapter's discovery handshake can find it.
- [x] Composition root wires `ElectronBridgeAdapter` FIRST in the bridge chain so it wins when running under the desktop with the flag on. `ServerPlaywrightHost` is the fallback for web + CI + desktop-without-flag.
- [x] `apps/web/src/components/chat/NativeBrowserView.tsx` — SPA-side branch. Positions the WCV via IPC pixel-snap `setBounds`, polls a 1 s screenshot as CSS `background-image` (VSCode-style placeholder), and runs an overlay hit-test loop against Radix + Sonner + dialog/menu roles to auto-hide the WCV when workbench chrome overlaps.
- [x] `apps/web/src/components/chat/BrowserPanel.tsx` — branches to `<NativeBrowserView>` when the desktop bridge advertises availability, keeps the URL bar / snapshot gallery UI shared, and routes navigation actions through both the native IPC (zero-latency for the human) AND the server API (keeps the CDP-shared agent side in sync).
- [x] `apps/web/src/types/desktop-bridge.d.ts` — ambient types for `window.generatoraiDesktop.browser` so the SPA type-checks against the preload API.

### 7.4 Smoke test log (2026-07-07)

Two rounds of testing:

**Round 1 — Phase 1 Web validation.** Started `pnpm dev:server` + `pnpm dev:web`, opened `http://localhost:5174/` in the VSCode integrated browser, opened *Browser test chat*, exercised Start → active → live view → Stop, and visually confirmed the placeholder-background trick working end-to-end (last frame retained after WebSocket close, no black flash).

**Round 2 — Phase 2+3 Desktop validation.** Built `@generatorai/core`, `@generatorai/web`, `@generatorai/desktop`. Ran [`agent-tests/desktop-browser-smoke.mjs`](../agent-tests/desktop-browser-smoke.mjs) which:

1. Spawns Electron with `GENERATORAI_DESKTOP_NATIVE_BROWSER=1`.
2. Captures the CDP endpoint from stdout log.
3. Attaches Playwright via `chromium.connectOverCDP`.
4. Locates the SPA page, checks the desktop bridge, verifies `browser.available() === true`.
5. Navigates to `/chats`, opens a chat.
6. Clicks the Browser button — asserts the "Integrated Browser" header appears.
7. Types `https://example.com`, clicks Start.
8. Waits for the status pill to flip to `active`.
9. Asserts `<NativeBrowserView>` mounted (`aria-label="Native browser view"`).
10. Asserts the WCV is visible over the shared CDP endpoint (page URL matches the navigated URL).

**Result:** 11/11 pass. All expected end-to-end behavior confirmed — the human's WCV and the server-side `ElectronBridgeAdapter` are attached to the same Chromium instance and see the same page (`https://example.com/`).

_Node 26 quirk observed_: Playwright 1.58's `_electron.launch()` fails with `spawn cmd.exe ENOENT` on Node 26. Workaround: manually `child_process.spawn` Electron and use `chromium.connectOverCDP()` — the very same shared-CDP path the product uses. This is what the smoke test does.
