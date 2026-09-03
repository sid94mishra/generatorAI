# Feature: Integrated Browser

> A **workspace-scoped Chromium session** the user and the agent share. WebSocket-streamed JPEG frames at ~15 fps, click-through interaction, form typing, screenshots, DOM inspection, live-tracking scroll indicator, viewport that auto-matches the SPA panel, and per-agent-turn attach/detach. Enabled per-chat / per-workflow-run via `browserConfig` on the `ExecutionWorkspace`.

Prerequisites in your head: [feature-workspaces-files.md](./feature-workspaces-files.md), [feature-streaming-events.md](./feature-streaming-events.md).

---

## 1. What a "browser session" is

A single Chromium instance (headed or headless) bound 1:1 to an [`ExecutionWorkspace`](./feature-workspaces-files.md#2-entities). The same session is:

- **Rendered live** to the user in the right pane of the Chat or Workflow Run page.
- **Driven by the agent** through the built-in `playwright-cli` skill (which speaks to the browser's CDP endpoint).
- **Persisted** across page reloads until the workspace is deleted, the session is explicitly stopped, or the auto-shutdown idle timer fires.

Two host implementations exist behind the `IBrowserBridge` port:

| Bridge                    | When it's used                                           | Chromium runs where                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ServerPlaywrightHost`  | Web browser + server-only deployments                    | Playwright-launched Chromium**inside the server process** (headless by default; head-full when `visibility: 'visible'`). Frames are streamed to the SPA as MJPEG.                 |
| `ElectronBridgeAdapter` | Desktop app when`GENERATORAI_DESKTOP_NATIVE_BROWSER=1` | Electron's**own Chromium** hosts a `WebContentsView` in the desktop main process. The renderer sees native pixels; the agent attaches via Electron's `--remote-debugging-port`. |

The composition root tries `ElectronBridgeAdapter` first, then falls back to `ServerPlaywrightHost`. All downstream code (services, routes, SPA) is bridge-agnostic.

---

## 2. Entity & DB shape

Browser state lives on the `execution_workspaces` row — a session is a *resource* attached to a workspace, not its own table.

Columns (added in migration v13):

```
browserConfig     JSON     resolved BrowserConfig (see §3)
browserStatus     enum     'off' | 'starting' | 'active' | 'idle' | 'error'
browserSessionId? text     opaque handle from the bridge (used for reconnect)
browserUrl?       text     last-known page URL
browserMode?      enum     'native' | 'screencast' | 'off'
```

Any artefact produced by the browser (screenshot, HAR, DOM dump, video, inspector selection) is stored in the same `workspace_artifacts` table used for stage outputs, under one of these `artifactType`s:

```
'browser_screenshot' | 'browser_dom' | 'browser_har'
| 'browser_console_log' | 'browser_video' | 'browser_selection'
```

Consequence: **the Files & Uploads panel in the SPA shows browser artefacts alongside code-file artefacts** — no special surface required.

---

## 3. `BrowserConfig` (the opt-in shape)

Chats and workflow definitions can set `browserConfig` to enable the feature. Full schema in [packages/shared/src/types/BrowserSession.ts](../../packages/shared/src/types/BrowserSession.ts).

```typescript
interface BrowserConfig {
  enabled?: boolean;                             // master switch, default false
  mode?: 'auto' | 'native' | 'screencast';       // 'auto' picks native on desktop, else screencast
  visibility?: 'visible' | 'headless' | 'off';   // preferred over `headless` — see below
  headless?: boolean;                            // legacy; `visibility` wins if both set
  viewport?: { width: number; height: number };
  allowedHosts?: string[];                       // glob allowlist ("*.github.com"). Empty = allow-all.
  screencastFps?: number;                        // MJPEG framerate, default 5
  screencastQuality?: number;                    // JPEG quality 0–100, default 60
  idlePauseMinutes?: number;                     // auto-stop when no activity, default 5
  evalAllowed?: boolean;                         // allow the SPA to run `page.evaluate()` scripts, default false
  dialogPolicy?: 'dismiss' | 'accept' | 'prompt-user'; // default 'dismiss'
  piiRedaction?: boolean;                        // best-effort text scrubbing before persistence
  injectionDefense?: 'off' | 'block-scripts' | 'block-inline'; // CSP-style
}
```

`visibility` is the user-facing knob:

- **`visible`** → head-full Chromium; the SPA auto-opens the Browser tab when the session boots so the user watches the agent live.
- **`headless`** *(default)* → invisible OS window; the Browser tab is available but stays closed until the user opens it.
- **`off`** → do **not** auto-start on chat/run create. First tool invocation from the LLM lazily boots a headless session on demand.

Resolution helper: `BrowserService.resolveConfig(cfg)` fills in defaults and enforces `visibility → headless` mapping. Call it before persisting.

---

## 4. Server architecture

```
apps/server/src/routes/browser.ts        REST verbs (start / stop / actions / snapshots / capture)
apps/server/src/browser-ws.ts            WS: /api/workspaces/:id/browser/stream  (MJPEG frames + input)
             │
             ▼
packages/core/src/services/BrowserService.ts
             │  owns   Map<workspaceId, SessionRecord>
             │  emits  browser.* events on EventBus
             │
             ▼
packages/core/src/domain/ports/IBrowserBridge.ts
             │
             ├── infrastructure/browser/ServerPlaywrightHost.ts    (headless / server)
             └── infrastructure/browser/ElectronBridgeAdapter.ts   (WebContentsView)
```

### `BrowserService`

Central lifecycle:

- **`ensureStarted(workspace, config?)`** — idempotent; if a session exists and is compatible, returns it; else picks a bridge and boots Chromium. Pending starts are shared via `pendingStarts: Map<workspaceId, Promise>` so two racing callers don't spawn two Chromiums. `POST /start` returns as soon as Chromium is up — if the caller supplied an initial `url`, the navigate is fired **fire-and-forget** so the SPA can render the live view immediately instead of waiting for the full page load; the URL pill fills in when `browser.navigation` arrives over SSE.
- **`resize(workspaceId, w, h)`** — proxies to `page.setViewportSize`. Called by the SPA's `ResizeObserver`; agents don't normally invoke this.
- **`scrollState(workspaceId)`** — returns `{ scrollY, scrollHeight, clientHeight }` for the SPA's overlay scroll indicator. Cheap `page.evaluate`.
- **Capacity cap** — default 5 concurrent sessions server-wide (`GENERATORAI_BROWSER_MAX_CONCURRENT`). On overflow the LRU session (oldest `lastActivityAt`) is stopped before starting the new one.
- **Auto-restart** — up to `maxRestarts` (default 3) on crash, cooldown `restartCooldownMs` (default 10 s). Emits `browser.error` when the limit is hit.
- **Idle pause** — a `setInterval` sweep stops sessions where `now - lastActivityAt > idlePauseMinutes × 60 s` and `visibility !== 'visible'`.
- **`attachedToChat` flag** — per-session boolean tracking VSCode-style "Share with agent" state. When `false`, agent-driven action methods (`navigate` / `clickRef` / `screenshotRef` / etc.) throw via `assertAttachedForAgent`. User-driven actions (URL bar navigation, click-through in the live view) are unaffected. Flips back to `true` on the next user prompt (`reattachOnPrompt(ws)` called from `ChatManagementService.sendPrompt` and `StageExecutionService.executeStage`).
- **Skill output watcher** — a `fs.watch` on `<workspaceRoot>/browser/.playwright-cli/` catches files written by the agent skill and auto-registers them as `browser_screenshot` / `browser_dom` artefacts, emitting `browser.snapshot` events.
- **Chromium launch flags** — `ServerPlaywrightHost` boots Chromium with a curated flag set (`--disable-background-networking`, `--disable-sync`, `--disable-component-update`, `--disable-extensions`, `--disable-features=Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions,CalculateNativeWinOcclusion`, `--metrics-recording-only`, `--mute-audio`, `--no-first-run`) that shave several seconds off cold-start on Windows.
- **Click-settle delay** — the `interact()` implementation waits **120 ms** after dispatching a `mouse.click` before returning to its caller. Because the WS input chain (§4) is strictly serial, this gives any lazy-mounted modal / autocomplete / focus transition time to complete before the next event fires, so a click-then-type sequence lands in the intended input reliably. Users perceive the delay as "natural"; automated tests should not need to insert their own waits.
- **Always-on scrollbar CSS** — `context.addInitScript` injects a `!important` stylesheet that forces classic (always-visible) `::-webkit-scrollbar` chrome + `scrollbar-width: auto` on `html`/`body`. A `MutationObserver` re-injects it if a SPA replaces `<head>`. Overlay scrollbars in headless Chromium are otherwise hidden.

Per-workspace **FIFO emit queue** (`emitQueue: Promise<unknown>` on each `SessionRecord`) preserves ordering guarantee INV-2 across the EventBus — see [feature-streaming-events.md](./feature-streaming-events.md#2-eventbus-in-process).

### REST endpoints (`/api/workspaces/:id/browser`)

| Method   | Path                       | Purpose                                                                                                                      |
| -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/start`                 | Ensure + optionally seed with`{ url, config }`                                                                             |
| `POST` | `/stop`                  | Terminate session, clear artefacts optional                                                                                  |
| `POST` | `/actions`               | Discriminated union:`navigate` \| `reload` \| `back` \| `forward` \| `screenshot` \| `snapshot` \| `inspector` |
| `POST` | `/selection`             | **Inspector script → server**: element selection payload from injected `INSPECTOR_SCRIPT`                           |
| `POST` | `/attach` \| `/detach` | Flip`attachedToChat` (disabled while `agentBusy`)                                                                        |
| `POST` | `/capture`               | Rectangle crop from current viewport (returns PNG)                                                                           |
| `POST` | `/input`                 | Legacy REST input dispatch (superseded by WS but kept for tests)                                                             |
| `POST` | `/resize`                | Update viewport                                                                                                              |
| `GET`  | `/descriptor`            | Current mode / status / URL /`attachedToChat`                                                                              |
| `GET`  | `/snapshots`             | List`browser_*` artefacts for this workspace                                                                               |
| `GET`  | `/scroll`                | Absolute + max scroll positions                                                                                              |
| `GET`  | `/screencast.jpg`        | Single JPEG frame. Used by the mobile client and `client-core`'s admin surface, and by the web SPA only when the live-view socket cannot be opened at all |
| `GET`  | `/files/*`               | Serve a persisted browser artefact by relative path                                                                          |

### WebSocket transport (`/api/workspaces/:id/browser/stream`)

Registered via `noServer: true` in [apps/server/src/browser-ws.ts](../../apps/server/src/browser-ws.ts). Coexists with the terminal WS on the same HTTP server. This is the **only** live-view transport: `/screencast.mjpg` was deleted in W15 (it drove a second, concurrent CDP screencast alongside this socket), and `/screencast.jpg` is a single-frame endpoint, not a stream.

The socket carries **both** directions of a codec negotiation (D5, P1-33). On open the client sends `{type:'hello', accept:[…]}` — `['vp8','jpeg']` when `VideoDecoder.isConfigSupported({codec:'vp8'})` says so, `['jpeg']` otherwise. The server asks `BrowserService.screencastCapabilities(workspaceId)`; a bridge that cannot stream (native/desktop mode) is answered with `{type:'stream_unavailable'}` and the socket closes, rather than the client silently dropping to HTTP polling.

- **Server → client (binary)** — a 16-byte header plus one encoded frame. The header (magic `0x47`, version, codec id, keyframe flag, `uint16` width/height, `float64` presentation timestamp in µs) is what lets the two codecs share one socket: the seed screenshot and the paint-silence keepalive are JPEG on a stream whose steady state is VP8, and a mid-stream encoder failure needs no out-of-band signal because every frame states its own codec.

  Frames come from CDP `Page.startScreencast` (compositor-driven — the page pushes on paint), with **one pending slot per subscriber, latest wins**. The `Page.screencastFrameAck` for a frame is deferred until the consumer TAKES it, which is what throttles capture to the viewer's speed; a frame superseded in the slot is acked immediately, and a 1 s watchdog acks anyway so one wedged consumer cannot stall capture for everyone.

  > **VP8 (D5).** `ScreencastEncoder` runs a `VideoEncoder` inside a dedicated headless Chromium — Node has no WebCodecs and this repo has no native codec dependency, and CDP's only frame tap is JPEG, so the transcode has to happen somewhere with a codec. Measured on the reference machine (1280×720, 60 frames of a text page): **144 KB/frame JPEG vs 8.5 KB/frame VP8, 17× smaller**, at ~5 ms/frame in-page transcode. Inter-coded frames of a static page are 100–1500 bytes. The encoder browser is launched lazily on the first VP8-capable viewer and closes itself 60 s after the last stream; if it cannot launch, `openStream()` returns `null` and the socket sends JPEG — a returned value, never a throw.

- **Client → server (text JSON)** — `BrowserInputEvent` union: `mouse.click`, `mouse.move`, `mouse.wheel`, `mouse.down/up`, `key.type`, `key.press`. Each connection has an `inputChain: Promise<void>` and every message is `.then()`-appended to it, so a rapid **click-then-type sequence reaches Chromium in strict issue order** — without this, the click's target-focus transition races the first keystroke and the browser routes text to the previously-focused element (URL bar / body). Combined with the click-settle delay (§10) this makes typing into DocSearch-style lazy modals reliable.

Why WS (and not HTTP MJPEG): bypasses the Vite dev proxy's `multipart/x-mixed-replace` buffering + eliminates per-frame TLS/TCP handshake overhead + supports bidirectional input.

### Viewport-follows-panel (`POST /resize`)

Chromium's viewport is not fixed at boot. The SPA observes its live-view container with a `ResizeObserver`, debounces changes to 200 ms, and posts `{ width, height }` to `POST /browser/resize` which in turn calls `page.setViewportSize()` (clamped to 320×240 … 2560×1600). The panel therefore always renders **without letterbox bars** even after the split-pane drag handle or the outer window is resized, and Chromium never renders pixels the SPA would clip.

---

## 5. Agent access (via `playwright-cli` skill)

The agent never speaks to `BrowserService` directly. Instead:

1. When `browserConfig.enabled === true`, `ChatManagementService` / `StageExecutionService` inject the CDP endpoint into the harness system prompt.
2. The **built-in `playwright-cli` skill** ships with a small Node driver that reads the endpoint from the system prompt and speaks the CDP protocol directly. Files it produces land in `<workspaceRoot>/browser/.playwright-cli/`.
3. `BrowserService`'s FS watcher picks up those files and turns them into `workspace_artifacts` rows plus `browser.snapshot` events.

Consequence: **the agent's toolbelt does not change based on browser availability** — it's always the same skill; the skill silently no-ops when the CDP endpoint is missing.

**Function hooks** wired at boot:

- `browser.beforeAction` — allowlist enforcement + custom user gating.
- `browser.afterAction` — observability only.

Both are registered by the composition root — see [apps/server/src/composition-root.ts](../../apps/server/src/composition-root.ts). Hook authors extend the function hook by name (see [feature-hooks.md](./feature-hooks.md#function-hooks)).

---

## 6. Frontend (SPA)

**Right-pane tab** in `RightPane` (the tabbed dock — see [usage-web.md §4 / §7](./usage-web.md#4-chats)):

- Chat page — Browser is an add-able tab (`+` menu), disabled until the chat has a workspace.
- Workflow Run page — same, disabled until the run has a workspace.

**Component**: [apps/web/src/components/chat/BrowserPanel.tsx](../../apps/web/src/components/chat/BrowserPanel.tsx). VSCode-Simple-Browser-style top bar:

```
[◀] [▶] [↻]  ┌── URL pill ──┐  [Share] [Inspect] [Capture] [Start/Stop]
```

- **Share** — toggles `attachedToChat`. Disabled while `agentBusy` (a chat/stage turn is in flight).
- **Inspect** — auto-injects `INSPECTOR_SCRIPT` (from [`packages/core/src/infrastructure/browser/InspectorScript.ts`](../../packages/core/src/infrastructure/browser/InspectorScript.ts)) via `context.addInitScript` (server host) or an on-page `evaluate` (Electron host). User clicks an element → payload posts to `POST /selection` → arrives back over SSE as `browser.selection` → the SPA calls `onCapture(file, 'selection')` to add it to the chat's `pendingCaptures`.
- **Capture** — mouse-drag rectangle → `POST /capture` with viewport-relative clip → returns PNG → added to `pendingCaptures`.
- **URL pill** — bare hostnames (e.g. `google.com`) are auto-prefixed with `https://` before hitting the server's zod `.url()` validator, so a user typing a domain into either the URL pill or the Start dialog just works.
- **Web-only interactivity toggle** — [Settings → Integrated Browser](./usage-web.md#10-settings) card. Default OFF: user can only view + scroll + Inspect; click/type/navigate is blocked in the SPA. Desktop always runs at full interactivity. Persisted in `localStorage:generatorai:browser:webInteractivity`.

### Live-view interactivity

The live view is an `<img>` element (JPEG frames streamed over the WS above) with pointer + keyboard handlers:

- **Click-through** — `onClick` maps the CSS event location back to page pixels using the img's `naturalWidth/Height` + `getBoundingClientRect()` (accounting for object-contain letterboxing, though the auto-resize path usually eliminates it). The handler also calls `e.currentTarget.focus()` so subsequent keystrokes route through the img's `onKeyDown` — without this, the browser retains focus on whatever DOM element was focused before the click, and typing goes to the URL pill instead of the page's input.
- **Typing** — single printable characters with no modifiers dispatch as `key.type` (one message per char). Anything else — modifiers, arrow keys, Enter, Escape — dispatches as `key.press` with a `modifiers[]` array. The WS input chain (see §4) guarantees these arrive in issue order.
- **Scroll wheel** — `onWheel` dispatches `mouse.wheel` with `deltaX/deltaY`. React's wheel listeners are passive, so no `preventDefault` needed.
- **Mouse-move** — throttled to ~10 Hz to avoid hammering the input chain when the user is idly hovering.

### Overlay scroll indicator

Headless Chromium does not paint OS scrollbars into `page.screenshot()` output, so users have no visual cue that the page can scroll. The SPA compensates:

- Every 250 ms while the browser is `ready`, the panel calls `GET /browser/scroll` which returns `{ scrollY, scrollHeight, clientHeight }`. This is a cheap `page.evaluate(() => …)` — 5–15 ms round-trip.
- When `scrollHeight > clientHeight`, the panel renders a `pointer-events-none` overlay pinned to the right edge of the live view: a semi-transparent black track with a white thumb whose **height is `clientHeight / scrollHeight`** and whose **top offset is `scrollY / (scrollHeight - clientHeight)`**. As the user scrolls with the mouse wheel, the thumb slides in step.
- The indicator is read-only; scrolling itself happens via `mouse.wheel` events on the img (see above). Users get the visual signal without a second interactive control fighting for pointer events.

### Adaptive descriptor polling

`GET /browser/descriptor` is polled with a self-tuning cadence: **400 ms** while the session is transient (`starting`, or `active` but `ready === false`), **4 s** once settled, **2 s** on transient errors. The panel therefore flips out of the "Starting Chromium…" spinner within one poll cycle of readiness (typically < 500 ms after `ensureStarted()` resolves), while incurring almost no cost after that. `browser.session_created`, `browser.session_stopped`, `browser.navigation`, and `browser.error` events on the SSE stream also trigger an immediate descriptor refresh, so the URL pill and status pill react to server-side changes without waiting for the next tick.

**Auto-focus** on session boot — the ChatPage / WorkflowRunPage subscribe to `browser.session_created` on `/api/stream?scope=session&id=browser:<workspaceId>` and pop the Browser tab open when `visibility === 'visible'`.

**Native browser (desktop)** — [apps/web/src/components/chat/NativeBrowserView.tsx](../../apps/web/src/components/chat/NativeBrowserView.tsx) coordinates positioning of the Electron `WebContentsView` overlay inside the RightPane bounds; the panel body is a translucent placeholder that the WCV floats on top of.

---

## 7. Event flow (SSE + WS combined)

```
User clicks in the Browser panel
   └── input event → WS binary path → BrowserService.interact → CDP mouseEvent
                                                             │
                                                             ▼ (page mutation)
Chromium screencast frame → WS binary send → SPA <img>

BrowserService.navigate(workspace, url, 'user')
   ├── bridge.navigate(...)                                   (imperative)
   ├── emitBrowserEvent → EventBus.emit(scope=`browser:<wsId>`, kind='browser.action_started', …)
   └── on outcome:
         emitBrowserEvent → 'browser.action_completed' (ok:true|false, artifactId?)
```

Event kinds published by `BrowserService` (all under `browser.*` in [`AgentEvent`](../../packages/shared/src/types/AgentEvent.ts)):

| Kind                         | When                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `browser.session_created`  | After Chromium boots. Carries`mode: 'native' \| 'screencast'` + optional initial `url`.                    |
| `browser.session_stopped`  | On explicit stop / crash / idle-reap.                                                                         |
| `browser.session_updated`  | On`attachedToChat` flip + other descriptor mutations.                                                       |
| `browser.action_started`   | Before every user/agent action (`navigate`, `click`, `type`, `screenshot`, `inspector on/off`, …). |
| `browser.action_completed` | After each action, with`ok`, `durationMs`, `artifactId?`, `error?`.                                   |
| `browser.snapshot`         | Whenever a`browser_*` artefact is persisted.                                                                |
| `browser.selection`        | Inspector picked an element (both automated and user-triggered).                                              |
| `browser.error`            | Chromium crash / restart-cap hit / capacity refusal.                                                          |

All routed via `EventBus.emit(scopeSession=\`browser:<workspaceId></workspaceid>\`, event)`. The SPA subscribes to `scope=session&id=browser:<workspaceId></workspaceid>` to see them.

---

## 8. Lifecycle guarantees (invariants)

1. **INV-2 (event ordering)** — per-workspace `emitQueue` guarantees `browser.*` events are delivered in issue order.
2. **INV-3 (persist-before-event)** — for `browser.snapshot`, the artefact row is inserted **before** the event is emitted, so downstream consumers can always fetch the artefact.
3. **INV-7 (workspace-scoped)** — a session dies when the workspace is deleted (via `WorkspaceManager.registerBeforeDelete` → `BrowserService.stop`) or archived. Never orphans a Chromium process.
4. **agent-gate** — while `attachedToChat === false`, every agent-source method throws `BrowserNotAttachedError` early. User actions are unaffected.
5. **allowlist gate** — `browserConfig.allowedHosts` is enforced in the `browser.beforeAction` hook + at URL-bar preflight. Empty array / undefined = allow-all.

Break any of these and the SPA's Browser panel will corrupt state.

---

## 9. CLI

The browser is a graphical feature — there is intentionally no CLI surface. If you need programmatic control, use the SDK's `services.browserService` directly (advanced; see the composition root export).

---

## 10. Edge cases & gotchas

- **First send in a chat with `browserConfig.enabled: true` but `visibility: 'off'`** — no session is booted eagerly. The first LLM tool call that requires the browser lazy-starts a headless one; the SPA sees `browser.session_created` and shows the Browser tab as add-able but doesn't auto-open it.
- **Electron with `--remote-debugging-port` already in use** — `ElectronBridgeAdapter.isAvailable()` returns false and the composition root falls back to `ServerPlaywrightHost`. Log line: `[ElectronBridgeAdapter] CDP endpoint missing — falling back`.
- **Screenshot files written by the agent skill are auto-captured**, but files written elsewhere in the workspace are not — the FS watcher is scoped to `<workspaceRoot>/browser/.playwright-cli/`.
- **`ws.bufferedAmount` circuit-breaker** at 512 KB is per-connection. If two clients watch the same session, one slow client cannot back up frames for the fast one.
- **`page.evaluate` calls from the SPA** are refused with a validation error unless `evalAllowed: true`. This is a safety net against a malicious tenant using an injected script to exfiltrate data — meaningful even on loopback deployments.
- **`Origin: null` from the Electron shell** is accepted only for loopback requests — same rule as the terminal WS. See [operations.md](./operations.md#4-environment-variables) for the allowlist envs.
- **`/start` returns before the initial navigate finishes** — the route awaits `ensureStarted` but not the follow-up navigate. This is intentional (§4) so the panel renders the live view within a few hundred ms of session boot instead of blocking on TTFB of a slow site. Callers that need the destination URL to be settled should poll `/descriptor` or listen for `browser.navigation` on SSE.
- **CDP `Page.startScreencast` is not the primary source of frames** — `ServerPlaywrightHost.screencast()` still supports it (with ref-counted fan-out) but it did not fire reliably across Playwright + Chromium versions on Windows headless. The WS handler defaults to the `frame()` polling loop (§4). If you rewrite the transport, keep this in mind before assuming CDP screencast is available.
- **Rapid click-then-type used to lose the first few characters** — fixed by (a) serializing input dispatch on the per-connection promise chain and (b) inserting a 120 ms settle delay after every `mouse.click` in `interact()`. If you ever remove either, DocSearch-style lazy-loaded search modals will regress.
- **Panel resize during page load** — the SPA's `ResizeObserver` debounces to 200 ms and clamps its minimum delta at 8 px, so the mid-drag storm of resize events doesn't hammer `POST /resize`. Chromium's viewport reflow itself is fast (< 30 ms) but the site's own JS reflow can be slower; this is unavoidable and behaves the same as resizing a real browser window.
- **Overlay scroll indicator is read-only** — a decision, not a limitation. Scrolling still happens via `mouse.wheel` events on the img. If we ever add drag-to-scrub, it needs to POST a `mouse.wheel` event with a synthesized `deltaY` computed from the drag delta.

---

## 11. Files to know

- **Types + config**: [packages/shared/src/types/BrowserSession.ts](../../packages/shared/src/types/BrowserSession.ts)
- **Service**: [packages/core/src/services/BrowserService.ts](../../packages/core/src/services/BrowserService.ts)
- **Port**: [packages/core/src/domain/ports/IBrowserBridge.ts](../../packages/core/src/domain/ports/IBrowserBridge.ts) (`interact`, `resize`, `scrollState`, `screencast`, `frame`, …)
- **Bridges**: [packages/core/src/infrastructure/browser/](../../packages/core/src/infrastructure/browser/) — `ServerPlaywrightHost.ts` (Chromium launch flags, init-script scrollbar CSS, click-settle delay, screencast fan-out), `ElectronBridgeAdapter.ts`
- **REST**: [apps/server/src/routes/browser.ts](../../apps/server/src/routes/browser.ts) — start / stop / actions / input / resize / scroll / snapshots / files
- **WS**: [apps/server/src/browser-ws.ts](../../apps/server/src/browser-ws.ts) — frame-poll loop, input chain
- **SPA panel**: [apps/web/src/components/chat/BrowserPanel.tsx](../../apps/web/src/components/chat/BrowserPanel.tsx) — WS client, ResizeObserver, scroll indicator overlay, adaptive descriptor poll, focus-on-click
- **Right-pane wiring**: [apps/web/src/components/layout/RightPane.tsx](../../apps/web/src/components/layout/RightPane.tsx)
- **Composition root wiring**: [apps/server/src/composition-root.ts](../../apps/server/src/composition-root.ts) (search for `browserService`)
- **Inspector script (injected)**: [packages/core/src/infrastructure/browser/InspectorScript.ts](../../packages/core/src/infrastructure/browser/InspectorScript.ts)

For related surfaces: **terminal** in [feature-integrated-terminal.md](./feature-integrated-terminal.md), **RightPane host** in [usage-web.md](./usage-web.md).
