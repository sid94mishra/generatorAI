# Computer Use for GeneratorAI Desktop — Research & Integration Plan

> Deep analysis of the current GeneratorAI stack, industry research on
> **"computer use"** in modern agentic desktop apps (Claude, Codex, Copilot,
> Gemini, Operator, Open Interpreter), and a concrete technical plan to bring
> parity — and go beyond — inside the existing Electron shell.

Date: 2026-07-15 · Author: Copilot analysis

---

## 0. TL;DR

- GeneratorAI already ships **~80 % of the plumbing** required for a full
  computer-use loop: Electron shell + embedded server, workspace‑scoped
  `WebContentsView` browser, PTY terminal, SSE + WebSocket streaming, EventBus
  event replay, hexagonal ports/adapters, hook system, sandboxed script runner.
- What is **missing** is (a) a **screen/perception layer** (screenshot + optional
  DOM/ARIA extraction) exposed as an *agent tool* on the SDK, (b) an
  **input‑injection layer** that goes beyond a single `WebContentsView`
  (multi‑app, or full desktop via a virtual display), and (c) the
  **agent loop reshaping** so the LLM can call `screenshot → click → screenshot`
  actions in a bounded, auditable, human‑in‑the‑loop sandbox.
- The cleanest first slice is **"in‑app computer use"** — extend the existing
  workspace‑scoped `BrowserService` into a full `computer` tool exposed through
  `ICopilotPort`, matching the Anthropic `computer_20251124` / OpenAI
  `type: "computer"` schemas. This ships parity with Codex/Claude for the
  overwhelmingly common "drive a browser to complete a task" case, on the exact
  same architecture (`ServerPlaywrightHost` + `ElectronBridgeAdapter`) that is
  already deployed.
- Full **desktop computer use** (arbitrary Windows apps) is a Phase‑3 add‑on
  layered on top: a per‑workspace virtual display + `nut.js`/`RobotJS` (Windows
  native) or a Docker/VNC sidecar (parity with Anthropic's reference impl).
- The report ends with a **9‑phase implementation plan** (roughly 6–12 weeks),
  each phase deliverable independently and behind a feature flag.

---

## 1. Where GeneratorAI Stands Today (Baseline Analysis)

This section is a distilled architecture read; deep detail lives in
[docs/INTEGRATED_BROWSER_FINAL_ARCHITECTURE.md](INTEGRATED_BROWSER_FINAL_ARCHITECTURE.md),
[docs/INTEGRATED_TERMINAL_PLAN_FINAL.md](INTEGRATED_TERMINAL_PLAN_FINAL.md) and
the `session-77`..`session-82` memory notes.

### 1.1 High level

```
┌───────────────────────── Electron main (apps/desktop) ─────────────────────────┐
│  ServerManager  → spawns embedded @generatorai/server (loopback, prod mode)    │
│  WindowManager  → loads http://127.0.0.1:<port>/  (real web SPA, same origin)  │
│  NativeBrowserHost → per-workspace WebContentsView, opt-in via env flag        │
│  node-pty (electron-rebuilt)  →  used by TerminalService inside embedded server│
└───────────────────────┬─────────────────────────────────────────┬──────────────┘
                        │ HTTP + SSE + WS on 127.0.0.1            │ IPC (native browser bounds, dialogs)
                        ▼                                         ▼
                  React SPA (apps/web) ─────────── window.generatoraiDesktop bridge
```

- Same-origin embedding = **zero UI divergence** between web + desktop, and every
  new server capability lights up automatically on desktop.
- The desktop shell is **thin**: window/tray/menu/deep-link/updater + a
  `NativeBrowserHost` and a small IPC surface. All AI orchestration lives in the
  Node server, driven by `ICopilotPort` and its `CopilotAdapter` for GitHub
  Copilot SDK.

### 1.2 Domain model (relevant slices)

| Entity | Ownership | Runtime resources |
|---|---|---|
| `Session` | Chat / StageRun / WorkflowRun | 1 Copilot conversation |
| `Chat` | User | 1:1 Session |
| `WorkflowRun` → `StageRun[]` | Workflow engine | N sessions per allocation mode |
| `ExecutionWorkspace` | Workflow / Chat scope | `0..1 BrowserSession` + `0..N TerminalSession` + git worktree + artifacts dir |
| `BrowserSession` | `BrowserService` | Playwright persistent context (web) OR `WebContentsView` (desktop native) |
| `TerminalSession` | `TerminalService` | `node-pty` PTY (default) or docker-exec (Phase 2 sandbox) |

### 1.3 The two pieces already resembling computer use

**A. Integrated Browser** (session‑77, 79, 81):

- Port `IBrowserBridge` in domain: `navigate`, `readPage`, `screenshotRef`,
  `clickRef`, `hoverRef`, `typeRef`, `dragRef`, `interact`, `screencast`,
  `captureRegion`, `handleDialog`, `invokeFunction`.
- Two implementations:
  - `ServerPlaywrightHost` — Chromium launched with persistent context, screencast via `page.screenshot({type:'jpeg'})` polling loop over WebSocket at ~10 fps.
  - `ElectronBridgeAdapter` — connects Playwright over CDP to the Electron `WebContentsView` and pipes the same API through.
- REST at `POST /api/workspaces/:id/browser/*`; WS at `/api/workspaces/:id/browser/stream` (binary JPEG frames + JSON `BrowserInputEvent`).
- `BrowserService` guards every agent-facing method with `assertAttachedForAgent`; user can Detach/Reattach; auto‑re‑attach on next `sendPrompt` / stage run.
- Injected `INSPECTOR_SCRIPT` provides element selection + capture‑to‑chat back‑channel.

**B. Integrated Terminal** (session‑80, 81):

- Port `ITerminalHost` in domain; adapters `NodePtyHost` (default), `SandboxPtyHost` (Phase‑2 docker exec), `FallbackChildProcessHost` (degraded).
- Path: `ws://…/api/workspaces/:id/terminals/:sid/stream` with watermark flow‑control + rate limit + Origin allow-list.
- xterm.js WebGL renderer in `TerminalPanel.tsx`, multi-tab, attach-to-chat.
- Windows shell cascade: `pwsh → powershell → cmd`; env sanitisation strips secrets.

Both features already emit AgentEvent kinds (`browser.*`, `terminal.*`) into the
unified `EventBus → SSE` pipeline (§ session‑29 streaming overhaul), which is
crucial for the loop we describe later.

### 1.4 Copilot SDK & tool surface

- `ICopilotPort` wraps a single `CopilotClient` (SDK) with N `CopilotSession`
  instances (auto‑restart, `resumeAllConversations` on CLI crash).
- Domain `AgentEvent` is a **discriminated union** with 40+ kinds. `tool_start`
  / `tool_complete` already flow through EventBus.
- Hooks (`pre_tool_use`, `post_tool_use`, `on_permission.file_write/network/…`)
  give us a per‑action gate that maps 1:1 to the "confirm at point of risk"
  policy demanded by both OpenAI and Anthropic computer‑use guidance.

### 1.5 What is missing today

| Missing capability | Consequence for computer use |
|---|---|
| A **`computer` tool** on the SDK schema | LLM cannot request `screenshot` / `click(x,y)` in a first‑class way; it can only chat about the browser. |
| **Coordinate‑based** input (x/y clicks, key sequences) at the SDK layer | Selection today is CSS‑ref based via inspector; agents can't drive arbitrary pixel targets. |
| **Screenshot‑as‑tool‑result** flowing back through the loop | The SDK gets no image feedback; only the human sees the WS stream. |
| **Scoped agent loop** with iteration cap + budget | No `sampling_loop` semantics separate from the general chat streaming. |
| **Multi‑app / desktop‑wide input** injection | Everything is confined to a single `WebContentsView`. |
| **Prompt-injection classifier** on incoming screenshots | Anthropic recommends this; we have hooks but no classifier. |
| **Sensitive‑data policy layer** at action time | We have `assertAttachedForAgent` but no consent gate before typing secrets. |

---

## 2. Industry Research — Modern Agentic Computer‑Use Implementations

### 2.1 Anthropic — Claude Computer Use ("computer_20251124")

**Model side:**

- Claude models `sonnet 5`, `opus 4.5–4.8`, `sonnet 4.6` support native tool
  `type: "computer_20251124"` (previous: `computer_20250124`,
  `computer-use-2024-10-22`).
- Tool is **schema‑less** to the developer — Anthropic bakes the schema into
  the model. You just pass `display_width_px`, `display_height_px`,
  `display_number`, and optionally `enable_zoom`.
- Actions supported: `screenshot`, `left_click`, `right_click`, `middle_click`,
  `double_click`, `triple_click`, `mouse_move`, `left_click_drag`,
  `left_mouse_down`, `left_mouse_up`, `type`, `key`, `hold_key`, `scroll`,
  `wait`, and `zoom` (region crop, computer_20251124 only).
- Model adds a **~466–499 token** system prompt overhead + **735 tokens** for the
  tool descriptor itself on Claude 4.x.
- Beta header `computer-use-2025-11-24` required.

**Reference implementation shape** (`anthropic-quickstarts/computer-use-demo`):

```
┌─── Docker container ─────────────────────────────────────────────┐
│  Xvfb :1  (virtual X server)                                      │
│  Mutter (WM) + Tint2 (panel) + Firefox / LibreOffice / …          │
│  x11vnc → noVNC (port 6080) — human view                          │
│  Streamlit UI (8501) — chat + trajectory viewer                   │
│  Combined app on :8080                                            │
│                                                                   │
│  Python `loop.py`:                                                │
│     while True:                                                   │
│         response = client.beta.messages.create(                   │
│             model=…, tools=TOOLS, betas=[BETA_FLAG],              │
│             messages=messages, extra_body={thinking:…})           │
│         messages.append(response)                                 │
│         if not tool_use_blocks(response): return                  │
│         for tu in tool_use_blocks:                                │
│             result = handle(tu.name, tu.input)  # xdotool + PIL   │
│             messages.append(tool_result(tu.id, result))           │
└───────────────────────────────────────────────────────────────────┘
```

Key engineering details worth stealing:
- `_maybe_filter_to_n_most_recent_images` — **image budget compaction**. Keep
  only the last N screenshot tool_results; delete older images while keeping
  their text descriptions to preserve narrative without blowing up the prompt.
- `_inject_prompt_caching` — sets **cache breakpoints on the 3 most recent user
  turns** so screenshot-heavy conversations get 10× cache read pricing.
- **Adaptive thinking** — `extra_body = {thinking:{type:'adaptive'},
  output_config:{effort:'medium'}}`. Model decides its own reasoning budget.
- Screenshots are **downscaled to XGA 1024×768** inside the tool implementation
  before send; coordinates from Claude are then scaled back up. Retina/HiDPI
  needs 0.5× coordinate remapping.
- Isolated environment is mandatory. Anthropic **added a classifier** that
  scans screenshots for prompt‑injection patterns and forces confirmation.

**Claude Desktop app itself:** the shipping consumer app currently exposes
computer use through the same API contract — the model calls the tool, the
harness (in this case Anthropic's cloud sandbox or a local Docker) executes it.
The desktop app is fundamentally a chat client + tool‑result renderer + preview
of the sandbox stream; it does **not** drive the *user's own machine* directly
in the public build.

### 2.2 OpenAI — Codex Desktop + CUA / Operator

**Two products, one architecture:**

1. **CUA / Operator** (Jan 2025) — cloud sandbox model. GPT‑4o‑derived
   `computer-use-preview`, now migrated to a first-class `type: "computer"` tool
   on `gpt-5.4+`. Operator runs the sandbox for you inside `operator.chatgpt.com`.
2. **Codex Desktop app** (Apr 2026) — macOS & Windows Electron/native shell for
   the Codex CLI/agent. Added **background computer use** ("Codex operates *your*
   Mac alongside you") and an **in‑app browser** for iterating on frontend / games
   with agent commentary on live pages. Multiple agents can run in parallel
   without stealing focus from the user's other apps.

**Tool schema on the Responses API:**

```jsonc
tools: [{ "type": "computer" }]
// per turn model emits:
{
  "type": "computer_call",
  "call_id": "call_002",
  "actions": [
    { "type": "click", "button": "left", "x": 405, "y": 157, "keys": ["Ctrl"] },
    { "type": "keypress", "keys": ["ENTER"] },
    { "type": "type", "text": "penguin" }
  ]
}
// developer replies with:
{ "type": "computer_call_output", "call_id": "call_002",
  "output": { "type": "computer_screenshot",
              "image_url": "data:image/png;base64,…",
              "detail": "original" } }
```

Distinguishing bits from Anthropic:
- **Batched actions per turn** (`actions[]`) — saves round trips versus
  Anthropic's older one‑action‑per‑call shape (`computer_20241022`). New
  `computer_20251124` also allows batching.
- **`detail: "original"`** on screenshot inputs — GPT‑5.6 does **not** resize;
  preserves click accuracy at the cost of tokens. Recommended dev resolution
  1440×900 or 1600×900.
- Three explicit **integration paths**:
  1. Built‑in `type:"computer"` loop (screenshot → actions → screenshot).
  2. **Custom tool / harness** — keep your Playwright / Selenium / VNC / MCP;
     expose actions as ordinary function tools. `gpt-5.4+` is trained to work
     across arbitrary custom harnesses.
  3. **Code‑execution harness** — expose a JS/Python REPL with `browser`,
     `context`, `page`, `display()`, `ask_user()` primitives; the model writes
     small Playwright/PyAutoGUI scripts. This is the mode Codex Desktop uses
     internally for "computer use across your apps" — the agent literally
     writes code that operates the machine.
- **Explicit consent taxonomy** with three tiers: *hand‑off required*
  (password change, HTTPS/paywall bypass), *always confirm at action time*
  (deletion, payments, CAPTCHAs, permission changes, third‑party posts),
  *pre‑approval sufficient* (login, permission prompts, file uploads).
- Extra defenses: **cautious navigation** (ignore prompt injection instructions
  on-page), **screen monitor model** in Operator that can pause execution when
  suspicious content is detected, detection pipelines for suspicious access.

### 2.3 Nous "Hermes" — clarification

The public **Hermes** family (Nous Research: Hermes 2, 3, 4) is an **LLM series**,
not a desktop application. There is no first‑party "Hermes Desktop" shipping
computer use. Community and third‑party desktop shells (LM Studio, Ollama +
Open WebUI, OpenChat) can serve Hermes models but they do **not** implement
a computer‑use loop out of the box. If the intent was a specific Hermes‑powered
agent, the closest analog is:

- **Open Interpreter** (65 k stars, now the community Codex fork): ships a QA
  computer‑use skill built on **Vercel `agent-browser`** and **`trycua/cua`**.
- **trycua/cua**: open source computer‑use sandbox with macOS/Linux/Windows
  drivers, VM management, and an agent SDK.
- **Autonomous browser agents** (Browser Use, Bytedance UI‑TARS, Adept ACT‑1,
  Microsoft OmniParser + PowerAutomate): all follow the same
  "screenshot → LLM → action" loop with product‑specific twists (DOM +
  screenshot hybrid, set‑of‑marks, SoM prompting).

### 2.4 Microsoft & Google

- **Microsoft Copilot Studio "Computer Use"** (Ignite 2025): agents drive
  Windows apps + websites via a **hosted Cloud PC** (Windows 365) sandbox.
  Credentials brokered through Entra, tenant‑scoped monitoring.
- **Google Gemini Computer Use API** (Jul 2026): browser/mobile/desktop control
  via screenshots + UI action generation. Same primitive shape as CUA.
- **Windows 11 Copilot Actions** (Oct 2025): OS‑level agent runtime with
  per‑app permissioning; think of it as macOS Accessibility API + a policy
  broker + an on‑device SLM for grounding.

### 2.5 Canonical pattern (what all of these have in common)

```
                 ┌────────────────────┐
     user prompt │  Perception layer  │ ← screenshot(s) + optional DOM/ARIA
                 └────────┬───────────┘
                          ▼
                 ┌────────────────────┐
                 │  LLM reasoning     │ ← chain-of-thought / adaptive thinking
                 └────────┬───────────┘
                          ▼
                 ┌────────────────────┐
                 │  Action generator  │ ← batched actions[] or single
                 └────────┬───────────┘
                          ▼
     harness executes actions in sandboxed environment
                          │
                          ▼
              new screenshot back to LLM
                          │
                          ▼
                loop until model emits no tool_call
                (or iteration cap / budget hit)
```

Non‑negotiable engineering pillars every serious implementation shares:

1. **Sandbox** — VM, container, or at minimum a per‑workspace persistent
   browser profile. Never let the model drive the user's real Chrome profile
   without an explicit opt‑in.
2. **Screenshot budget** — dedupe / keep last N; scale to model‑friendly
   resolution; cache breakpoints for prompt caching.
3. **Action policy** — confirm at point of risk (destructive, financial,
   sensitive‑data transmission); pre‑approve for opt‑in flows.
4. **Prompt‑injection resistance** — treat on‑screen content as untrusted; add
   a screen monitor / classifier when possible.
5. **Trajectory recording** — every screenshot + action pair persisted for
   replay + audit; also fuels prompt-caching and post‑hoc debugging.
6. **Human‑in‑the‑loop escape hatch** — pause + hand‑off UI on any suspicious
   or destructive event.

---

## 3. Concrete Architecture Plan for GeneratorAI Desktop

The plan below is intentionally staged so each phase can ship independently
behind a feature flag (Env: `GENERATORAI_COMPUTER_USE=1`) and behind an in‑app
**Settings → Computer Use** card (default *off*).

### 3.1 Target end‑state (Phase 6+)

```
┌─── apps/desktop (Electron main) ───────────────────────────────────────────┐
│  NativeBrowserHost (existing)                                              │
│  DesktopInputHost  ← new: mouse/keyboard via nut.js on host (opt-in)       │
│  DisplayCaptureHost ← new: desktopCapturer.getSources('screen') → JPEG     │
│                                                                            │
│  IPC surface (contextBridge): screenshot / click / type / cursor / focus   │
└─────────────────────────┬──────────────────────────────────────────────────┘
                          │
┌─── @generatorai/server (embedded Node) ────────────────────────────────────┐
│  ComputerUseService  ← new: agent‑facing tool orchestrator                 │
│     • perceive(workspaceId, opts) → { image, viewport, dom?, marks? }      │
│     • act(workspaceId, action) → ActionResult                              │
│     • loop(sessionId, task) → runs the sampling loop                       │
│  ↓ depends on                                                              │
│  IComputerDriver (port)                                                    │
│  ↳ BrowserComputerDriver  (uses existing BrowserService)                   │
│  ↳ ElectronDesktopDriver  (talks to DesktopInputHost/DisplayCaptureHost)   │
│  ↳ VmComputerDriver       (docker sidecar w/ Xvfb + xdotool — parity with  │
│                             anthropic-quickstarts, opt‑in Phase 6)         │
│                                                                            │
│  ComputerUseTool  ← ICopilotPort.registerTool('computer', schema, handler) │
│  ScreenshotBudget  ← keeps last N images, dedup on hash, prompt caching    │
│  PolicyBroker  ← maps action → confirmation tier (hand‑off / confirm / pre)│
│  InjectionClassifier ← optional; runs on every incoming screenshot         │
└────────────────────────────────────────────────────────────────────────────┘
                          │
┌─── apps/web (SPA) ─────────────────────────────────────────────────────────┐
│  RightPane → new "Computer" tab (allowMultiple: false, workspace-scoped)   │
│     • Live view (MJPEG) — reuses BrowserPanel stream infra                 │
│     • Trajectory strip — screenshot ↔ action pairs, click to replay        │
│     • Consent modal — "Codex wants to click Submit at (405,157)"           │
│     • Cursor overlay — synthetic cursor sprite over the live view          │
│  Settings → Computer Use card                                              │
│     • Driver: browser / electron-webview / desktop / vm-sandbox            │
│     • Confirmation policy tier defaults                                    │
│     • Domain allow‑list                                                    │
│     • Max iterations, max time, max spend                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 The `computer` tool contract (shared across drivers)

To keep the SDK layer stable while we swap drivers, define one tool JSON
schema that spans the union of Anthropic + OpenAI actions:

```ts
type ComputerAction =
  | { type: 'screenshot'; region?: [number, number, number, number] }
  | { type: 'click'; x: number; y: number; button?: 'left'|'right'|'middle';
      keys?: string[] /* modifiers */ }
  | { type: 'double_click' | 'triple_click' | 'right_click' | 'middle_click';
      x: number; y: number }
  | { type: 'mouse_down' | 'mouse_up'; x: number; y: number;
      button?: 'left'|'right'|'middle' }
  | { type: 'mouse_move'; x: number; y: number }
  | { type: 'drag'; path: Array<[number, number]>; button?: 'left' }
  | { type: 'scroll'; x: number; y: number;
      direction?: 'up'|'down'|'left'|'right'; amount?: number;
      dx?: number; dy?: number }
  | { type: 'type'; text: string }
  | { type: 'key' | 'keypress'; keys: string[] }
  | { type: 'hold_key'; keys: string[]; duration_ms: number }
  | { type: 'wait'; duration_ms?: number }
  | { type: 'zoom'; region: [number, number, number, number] }; // computer_20251124

interface IComputerDriver {
  init(workspaceId: string, opts: DriverOptions): Promise<DriverDescriptor>;
  perceive(workspaceId: string,
           opts?: { region?: Rect; format?: 'png'|'jpeg'; quality?: number })
    : Promise<{ base64: string; width: number; height: number;
                dpr: number; dom?: unknown; marks?: SetOfMarks }>;
  act(workspaceId: string, action: ComputerAction): Promise<ActionResult>;
  dispose(workspaceId: string): Promise<void>;
}
```

The tool descriptor sent to the SDK is generated at register time based on
which driver is currently active (`display_width_px` and `display_height_px`
are the *scaled* values used for coordinate normalization). Coordinates
returned by the LLM are scaled back inside `ComputerUseService.act()` using the
`dpr` reported by the driver.

### 3.3 Sampling loop (server‑side)

Modeled on Anthropic `loop.py` + OpenAI Responses `previous_response_id` idiom
and grafted onto our existing `StageExecutionService` / `ChatManagementService`
send path.

```ts
async function computerUseLoop(sessionId, initialUserMessage, opts) {
  await copilot.sendPrompt(sessionId, initialUserMessage);
  const iterations = opts.maxIterations ?? 40;

  for (let i = 0; i < iterations; i++) {
    const response = await copilot.waitForNextTurn(sessionId);
    const toolCalls = response.toolCalls.filter(t => t.name === 'computer');
    if (toolCalls.length === 0) return;                       // done

    for (const call of toolCalls) {
      for (const action of call.arguments.actions) {
        const gated = await policy.evaluate(action, workspace);
        if (gated.requiresConfirmation) await ui.requestConsent(gated);
        if (gated.blocked) return copilot.sendToolResult(call.id,
          { is_error: true, content: gated.reason });
        await driver.act(workspace.id, action);
      }
      const shot = await driver.perceive(workspace.id, opts.perceive);
      budget.push(sessionId, shot);
      await copilot.sendToolResult(call.id,
        { content: [{ type: 'image', source: {…shot} }] });
    }
  }
  throw new IterationLimitError();
}
```

Notes:
- **`policy.evaluate`** is the concrete implementation of OpenAI's confirmation
  taxonomy (§ 2.2). It looks at the action + current URL/window title + a
  configurable allow‑list and returns `{tier: 'pre-approved'|'confirm'|'handoff',
  blocked?: true, reason?: string}`.
- **`budget.push`** trims to the last N screenshots for the outbound context
  (default N=3), matching Anthropic's `only_n_most_recent_images` behaviour.
- Every step emits `AgentEvent` kinds `computer.perception`,
  `computer.action_start`, `computer.action_complete`, `computer.policy_gate`,
  `computer.iteration` on the workspace's event stream — replayable via the
  existing `Last-Event-ID` mechanism.

### 3.4 Drivers — implementation notes

**A. `BrowserComputerDriver`** (Phase 1‑3 — easiest, biggest win)

- Wraps existing `BrowserService`. `perceive` = `screenshotRef` on the
  full page (or `captureRegion` for zoom). `act` maps to the existing
  `interact` primitives + a new `keyboard.combo` primitive.
- **Coordinate space:** browser viewport (CSS pixels). Already properly
  handled by `eventToPageCoords()` for the human side; agent path stays in
  raw viewport pixels — no letterbox math because there is no `<img>` in
  between.
- Add DOM + ARIA extraction to `perceive` as an optional payload for the
  code‑execution harness (§ 2.2 option 3): serialize accessible tree, then
  emit "set-of-marks" numbered overlays for grounded clicks — a known trick
  (e.g. Browser Use, Bytedance UI‑TARS) that dramatically lifts small‑model
  click accuracy on complex pages.

**B. `ElectronDesktopDriver`** (Phase 4 — full desktop)

- Uses `desktopCapturer.getSources({ types: ['screen'] })` +
  `nativeImage.toJPEG(60)` for perception at whatever DPR the display reports.
- Input side: `nut-tree/nut.js` (native, works on Win/Mac/Linux) via a
  worker process spawned by the main process. Elevate carefully on Windows
  (UIA elevation not needed for standard user apps, only for admin windows).
- Focus management: bring the target window forward via `BrowserWindow.focus()`
  when the target is our own window; use `nut.js` window‑manager API for
  external targets.
- **Consent model is stricter** here: default `handoff` for every action on
  a window whose title/executable is not in the user's allow-list.

**C. `VmComputerDriver`** (Phase 6 — parity with Anthropic reference)

- Docker Compose sidecar spawned via the same infrastructure that already
  runs the Phase‑2 sandbox in `SandboxPtyHost`.
- Image based on `ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest`
  or a custom slim variant. Ports mapped on 127.0.0.1 only.
- Live view = MJPEG over WebSocket (same infra as browser screencast); noVNC
  optional secondary channel for full input handoff to the human.

### 3.5 UI/UX (`RightPane → "Computer" tab`)

- Reuses `RightPane` (session‑78). Tab kind `computer`, singleton,
  workspace‑scoped, keeps state on switch so the MJPEG feed doesn't tear.
- Top bar mirrors the Browser tab: `[Share] [Inspect] [Capture] [Stop Agent]`
  plus a **Trajectory** toggle that swaps the live view for the timeline of
  screenshot‑action pairs.
- Bottom strip: current iteration count / max, cumulative token spend, per‑turn
  latency badge.
- Consent modal: chevron style toast at the bottom of the tab with the
  proposed action, the target region highlighted in the live view, and
  Approve / Skip / Cancel / Always for this session buttons.

### 3.6 Data model additions

New Drizzle table `computer_use_sessions` (thin — most state lives in EventBus):

```
id, workspace_id, chat_id?, stage_run_id?, driver_kind,
started_at, ended_at, status,
max_iterations, max_wallclock_ms, allowlist_json,
consent_policy_json, total_tokens, total_screenshots, aborted_reason
```

New AgentEvent kinds under `computer.*` extending the taxonomy in
[docs/feature-streaming-events.md](feature-streaming-events.md).

New artifact type `computer_screenshot` in `workspace_artifacts` so
trajectories persist across restarts and can be replayed post‑hoc.

### 3.7 Security & policy

- **Default off.** Feature flag + settings toggle. Fresh install has zero
  computer‑use capability.
- **Per‑workspace scope.** A stage or chat can only drive the browser bound to
  its workspace. Enforced by the existing `assertAttachedForAgent` gate,
  extended to cover `DesktopInputHost`.
- **Allow-list & block-list** for domains (browser driver) and executable
  paths/window titles (desktop driver). Enforced *before* we hand the action
  to the driver.
- **Sensitive-input firewall.** `type` actions whose text matches
  `secretPatterns` (regexes covering AWS keys, JWTs, credit cards, bearer
  tokens, common password labels) are blocked and demand explicit consent
  with the exact string shown to the user first.
- **Prompt-injection classifier.** In Phase 5, a lightweight classifier runs on
  every screenshot before the tool_result goes back to the LLM — e.g. detect
  `ignore previous instructions`, `you are now …`, embedded fake system
  prompts. Match → force `confirm` tier on the *next* action irrespective of
  its natural tier.
- **Trajectory audit.** Every screenshot + action pair persisted; replayable
  from the Chats or Runs page for compliance review.

### 3.8 Cost/context management

- Screenshot **downscale to 1440×900** (default) at driver level; store the
  scale factor per session so click coordinates are always mapped back to
  device pixels correctly.
- **Deduplicate identical consecutive screenshots** (hash the JPEG bytes):
  drop the newer duplicate, emit `computer.no_change` event, count against a
  configurable stuck-loop budget.
- **Prompt caching**: at CopilotAdapter registration time, mark the last 3
  user turns as `cache_control: ephemeral` (Anthropic) or rely on Responses
  API `previous_response_id` (OpenAI). Save the tool descriptor once and reuse.
- **Extended / adaptive thinking**: opt-in via `RunProfile` (already exists in
  session‑45 for stage overrides); default `low` for cost‑sensitive loops,
  `medium` for interactive chat, `high` for standalone stages that must not
  fail.

---

## 4. 9‑Phase Roll‑out (feature‑flagged; each phase shippable on its own)

| Phase | Deliverable | Depends on | Rough effort |
|---|---|---|---|
| **P0** | Feature flag scaffold, Settings card (disabled placeholder), `ComputerUseService` skeleton with `IComputerDriver` port, dummy driver returning canned actions | — | 2–3 days |
| **P1** | `BrowserComputerDriver` — wraps `BrowserService`; `perceive` returns real `page.screenshot`; `act` executes existing `interact` + new key/keyboard combo primitives; unit tests | P0, existing BrowserService | 4–5 days |
| **P2** | Sampling loop + `ScreenshotBudget` + Prompt caching; wire `computer` tool to `ICopilotPort` via a new `IToolRegistry` extension | P1 | 4–5 days |
| **P3** | Right-pane **Computer** tab: live view (reuse `BrowserPanel` MJPEG), trajectory strip, consent modal, cursor overlay; end‑to‑end demo on `example.com`/`playwright.dev` | P2 | 5–7 days |
| **P4** | `PolicyBroker` full implementation (three tiers), domain allow-list, sensitive-input firewall, all consent UX flows; e2e Playwright spec `computer-use-consent.spec.ts` | P3 | 4–5 days |
| **P5** | Prompt-injection classifier (rule-based v1 + optional LLM-based v2); trajectory persistence via `workspace_artifacts`; replay UI on `WorkflowRunPageV2` | P4 | 3–4 days |
| **P6** | `ElectronDesktopDriver` (opt-in): `desktopCapturer` perceive + `nut.js` input in a helper worker; stricter default policy; Windows‑only screenshot DPR handling | P5 | 5–8 days |
| **P7** | `VmComputerDriver` docker sidecar for parity with `anthropic-quickstarts`; noVNC handoff for human take-over; used by Phase‑2 sandbox stages | P5 (parallel to P6) | 5–7 days |
| **P8** | **Model‑agnostic providers**: extend `CopilotAdapter` (or add a sibling `AnthropicAdapter` + `OpenAICUAdapter`) so users can BYOK to Claude/GPT-5.6 for the computer tool exclusively while keeping Copilot for coding tasks | P2 | 4–6 days |

Total estimated engineering: **6–10 weeks** for a single engineer, or ~4 weeks
for a small team parallelizing P4/P5 with P6/P7.

---

## 5. File-level pointers (where each piece will land)

- `packages/shared/src/types/ComputerUse.ts` — new: `ComputerAction`,
  `DriverDescriptor`, `ActionResult`, `PolicyDecision`.
- `packages/shared/src/types/AgentEvent.ts` — add `computer.*` variants.
- `packages/core/src/domain/ports/IComputerDriver.ts` — new port.
- `packages/core/src/services/ComputerUseService.ts` — new service (mirrors
  `BrowserService`).
- `packages/core/src/services/ComputerUsePolicyBroker.ts` — new.
- `packages/core/src/infrastructure/computer/BrowserComputerDriver.ts` — new;
  thin adapter over `BrowserService`.
- `packages/core/src/infrastructure/computer/ElectronDesktopDriver.ts` — new;
  talks to desktop main via existing preload bridge (`window.generatoraiDesktop`
  gets `computer.*` methods).
- `packages/core/src/infrastructure/computer/VmComputerDriver.ts` — new;
  docker child process; reuses the Phase‑2 sandbox infra.
- `apps/server/src/routes/computer-use.ts` — new REST for consent responses,
  session start/stop, allowlist admin.
- `apps/server/src/composition-root.ts` — wire `ComputerUseService`, register
  `computer` tool with `CopilotAdapter`, call `shutdown()` on graceful stop.
- `apps/web/src/components/computer/ComputerPanel.tsx` — new right‑pane tab;
  reuses `BrowserPanel.tsx`'s live-view rendering.
- `apps/web/src/components/computer/TrajectoryStrip.tsx` — new; timeline UI.
- `apps/web/src/components/computer/ConsentModal.tsx` — new.
- `apps/web/src/pages/Settings.tsx` — new **Computer Use** card (driver
  selection, policy tiers, allow-list, budgets).
- `apps/desktop/src/main/desktop-input-host.ts` — new (P6); nut.js worker.
- `apps/desktop/src/main/display-capture-host.ts` — new (P6);
  `desktopCapturer` wrapper.
- `apps/desktop/src/shared/computer-ipc.ts` — new IPC contract.
- `packages/db/src/schema.ts` — add `computer_use_sessions` table + migration.
- `docs/feature-computer-use.md` — new deep-dive doc (to be authored during P3).

---

## 6. Open questions to resolve before starting

1. **Model provider strategy for the tool.** Copilot SDK currently proxies
   to GitHub Copilot with limited models. For true computer use we likely
   need **BYOK to Claude and/or GPT‑5.6**. Do we introduce a sibling adapter
   (`AnthropicAdapter`, `OpenAIResponsesAdapter`) reachable via `RunProfile`
   overrides, or do we lobby the Copilot SDK team to expose a compatible tool?
2. **Desktop scope.** Do we want Phase‑6 desktop‑wide input on Windows, or
   scope P6 strictly to native `WebContentsView` (i.e. still browser‑only
   but full‑fidelity Chromium) and defer OS‑level clicking to a later
   "trusted mode" release?
3. **Screenshot storage retention.** Screenshots can leak sensitive data. Do
   we always persist as artifacts (with retention config), or default to
   ephemeral (in‑memory ring) and only persist on explicit user opt-in?
4. **Injection classifier: rule‑based or LLM‑based?** A tiny local classifier
   (e.g. `Xenova/transformers.js` running a distilled BERT) buys us <10 ms
   per screenshot. An LLM classifier is more accurate but adds cost and
   latency. Recommendation: ship rule‑based in P5, add optional LLM in P8.
5. **Consent UX cadence.** Show every action to a first‑time user, then
   auto‑learn per (domain, action‑type) pair via "always allow this for this
   site" toggles? Or stay stricter and force per‑action confirmation for
   destructive tiers regardless of history?

---

## 7. Reference material used

- Anthropic — [Computer use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool),
  [Developing computer use](https://www.anthropic.com/news/developing-computer-use),
  [computer-use-demo repo](https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-demo)
  (`loop.py` inspected line-by-line for prompt caching + image budget).
- OpenAI — [Computer‑Using Agent research post](https://openai.com/index/computer-using-agent/),
  [Codex for (almost) everything](https://openai.com/index/codex-for-almost-everything/),
  [Computer use guide (Responses API)](https://developers.openai.com/api/docs/guides/tools-computer-use)
  (Options 1/2/3 read in full; batched-action schema, `previous_response_id`,
  code‑execution harness sample lifted).
- Microsoft — [Copilot Studio Computer Use](https://learn.microsoft.com/en-us/microsoft-copilot-studio/computer-use),
  [Windows 11 AI PC](https://blogs.windows.com/windowsexperience/2025/10/16/making-every-windows-11-pc-an-ai-pc/).
- Google — [Gemini Computer Use API](https://ai.google.dev/gemini-api/docs/computer-use).
- Open source — [Open Interpreter](https://github.com/openinterpreter/openinterpreter)
  (harness emulation + `agent-browser` + `trycua/cua`).
- Internal — `docs/INTEGRATED_BROWSER_FINAL_ARCHITECTURE.md`,
  `docs/INTEGRATED_TERMINAL_PLAN_FINAL.md`, memory notes
  `session-77`..`session-82`, `session-45-runprofile-stage-overrides`,
  `session-55-hook-system-complete-analysis`, `session-29-streaming-overhaul`.
