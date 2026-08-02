# Integrated Terminal — Final Implementation Plan (post-review)

**Status:** Ready for user approval • **Supersedes:** [INTEGRATED_TERMINAL_PLAN.md](INTEGRATED_TERMINAL_PLAN.md) (initial draft) • **Scope:** Web + Desktop parity, agentic-app quality

> This document reflects a full architect-review pass. Every P0/P1 issue raised in the review is either resolved inline or explicitly deferred with reasoning. Look for **⚑ Resolves R-##** markers referencing the review's risk-ranked list.

---

## 0 · TL;DR

Add an **integrated terminal** as a new `terminal` tab kind in the existing unified `RightPane`, next to `Changes`, `Browser`, `Inspector`. A **single server-hosted PTY service** powers both web and desktop via a WebSocket at `/api/workspaces/:id/terminals/:sid/stream`, consumed by an **xterm.js** renderer.

Key decisions, with rationale:

| #  | Decision                                                                                             | Why                                                                                                                                                                                      |
| -- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 | **Server-hosted PTY** (not Electron-main)                                                      | Desktop already runs the server as a child Node process; one code path, automatic parity.                                                                                                |
| D2 | **Ephemeral in-memory sessions** (no DB)                                                       | Matches Browser session lifecycle. Simpler. Server restart = fresh terminal, users understand. Can add DB layer later without breaking the port.                                         |
| D3 | **Workspace-scoped, host-only PTY** (never inside a run's sandbox in MVP)                      | Sandboxes are per-`runId`, workspaces are shared across runs. A workspace-scoped terminal has no sandbox to attach to on the Chat page. Sandbox-attached terminal is a Phase-2 opt-in. |
| D4 | **Close tab = kill session**                                                                   | Simplest mental model. Idle TTL still exists for orphaned reconnects.                                                                                                                    |
| D5 | **One terminal per workspace by default**, `allowMultiple` opt-in                            | Users usually want one shell. Multi-tab supported but not the primary UX.                                                                                                                |
| D6 | **`node-pty` + xterm.js + WebGL renderer + FitAddon**                                        | Industry standard (VSCode, Theia, Cursor, Replit, Codespaces, Zed backing).                                                                                                              |
| D7 | **Watermark flow control with client ACK**                                                     | Prevents`yes`-flood renderer stalls; official xtermjs.org pattern.                                                                                                                     |
| D8 | **Feature-flagged** (`GENERATORAI_TERMINAL=1`) until native builds proven on all target OSes | Same shape as`GENERATORAI_DESKTOP_NATIVE_BROWSER`. Zero-risk rollback.                                                                                                                 |

---

## 1 · Current architecture — recap

| Layer                      | Reference                                                                                                   | What we reuse                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Right pane shell           | [apps/web/src/components/layout/RightPane.tsx](apps/web/src/components/layout/RightPane.tsx)                   | Add`terminal` tab kind — no shell changes.                                                            |
| Chat page                  | [apps/web/src/pages/ChatPage.tsx](apps/web/src/pages/ChatPage.tsx#L458)                                        | Extend`addableTabTypes` from `['browser']` → `['browser', 'terminal']`.                           |
| Workflow run page          | [apps/web/src/pages/WorkflowRunPageV2.tsx](apps/web/src/pages/WorkflowRunPageV2.tsx#L430)                      | Extend`addableTabTypes` from `['inspector', 'browser']` → `['inspector', 'browser', 'terminal']`. |
| WS transport precedent     | [apps/server/src/browser-ws.ts](apps/server/src/browser-ws.ts)                                                 | Same`noServer: true` + `PATH_RE` upgrade router; sit behind Vite proxy identically.                  |
| Workspace root resolution  | [packages/core/src/services/WorkspaceManager.ts](packages/core/src/services/WorkspaceManager.ts#L127)          | `workspace.rootPath` is the cwd.                                                                       |
| Sandbox exec               | [packages/core/src/services/SandboxLifecycleManager.ts](packages/core/src/services/SandboxLifecycleManager.ts) | Read-only in MVP (not attached). Phase-2 hook only.                                                      |
| Desktop → server bridging | [apps/desktop/src/main/server-manager.ts](apps/desktop/src/main/server-manager.ts)                             | Server is a child process; native modules must ABI-match Electron.                                       |
| SSE bus                    | [packages/shared/src/types/AgentEvent.ts](packages/shared/src/types/AgentEvent.ts)                             | New event kinds`terminal.session_created` / `terminal.session_closed` for auto-focus + auditing.     |

---

## 2 · Research — how modern agentic apps do this

| App                          | Backend PTY                            | Transport        | Frontend        | Lifetime                                                                        |
| ---------------------------- | -------------------------------------- | ---------------- | --------------- | ------------------------------------------------------------------------------- |
| VSCode                       | `node-pty` in extension host         | in-process IPC   | xterm.js        | Persistent across window reload; ephemeral across host crash.                   |
| Cursor                       | Fork of VSCode                         | same             | xterm.js        | Adds*agent-typed* commands with per-command user confirm.                     |
| Zed                          | Rust`alacritty_terminal`             | in-process       | Custom GPU      | Terminal panel + center-pane tabs; persistent.                                  |
| Theia                        | `node-pty` in Node backend           | JSON-RPC over WS | xterm.js        | **Closest to our topology.** Persistent shell processes across reconnect. |
| Replit / Codespaces / Gitpod | `node-pty` inside per-user container | WS               | xterm.js        | Container-lifetime persistent.                                                  |
| Warp / Claude Code           | Local shell                            | native           | native/Electron | Agentic loops: model proposes, user confirms per-command.                       |

**Agentic patterns we're borrowing (MVP):**

1. **Attach-to-chat capture** — select xterm text → same `pendingCaptures` pipeline used by BrowserPanel's Inspect.
2. **Visual sandbox indicator** *(deferred)* — when a Phase-2 sandbox-attached terminal is opened, header is tinted.
3. **Explicit user-driven only** — no agent-typed input in MVP. Agent execution still goes through existing sandbox-exec tool path.

---

## 3 · Architecture

```
┌── apps/web (renderer) ───────────────────────────────────────┐
│  RightPane                                                    │
│    └── TerminalTab (per-tab; allowMultiple: true)             │
│         ├── xterm.js (WebGL, Fit, WebLinks, Search)           │
│         ├── WS client @ /api/workspaces/:id/terminals/:sid/…  │
│         └── localStorage: sessionId per (workspaceId,tabId)   │
└──────────────────────┬────────────────────────────────────────┘
                       │ ws (binary out, json in)
┌──────────────────────▼────────────────────────────────────────┐
│ apps/server                                                   │
│   terminal-ws.ts   ← noServer upgrade router                  │
│   routes/terminals.ts (REST: list, create, resize, kill,      │
│                        replay-scrollback)                     │
└──────────────────────┬────────────────────────────────────────┘
                       │
┌──────────────────────▼────────────────────────────────────────┐
│ packages/core                                                 │
│   services/TerminalService (in-memory Map<sid,TerminalHandle>)│
│   domain/ports/ITerminalHost (spawn/write/resize/kill/onData) │
└──────────────────────┬────────────────────────────────────────┘
                       │
┌───────────────┬──────▼──────────┬──────────────────────────────┐
│ NodePtyHost   │ (Phase-2)       │ FallbackChildProcessHost      │
│ (default)     │ SandboxPtyHost  │ (when node-pty fails to load) │
└───────────────┴─────────────────┴──────────────────────────────┘
```

### 3.1 Domain port — `packages/core/src/domain/ports/ITerminalHost.ts`

```ts
export interface TerminalSpawnOptions {
  workspaceId: string;
  cwd: string;              // resolved by TerminalService, never user-supplied
  cols: number;
  rows: number;
  env?: Record<string, string>;
  shell?: string;
  shellArgs?: string[];
  handleFlowControl?: boolean;
}

export interface ITerminalHandle {
  readonly id: string;
  readonly workspaceId: string;
  readonly pid: number | null;
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  readonly exitCode: number | null;

  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pause(): void;
  resume(): void;

  onData(cb: (chunk: Buffer) => void): () => void;
  onExit(cb: (info: { code: number; signal?: string }) => void): () => void;
}

export interface ITerminalHost {
  spawn(opts: TerminalSpawnOptions): Promise<ITerminalHandle>;
  get(id: string): ITerminalHandle | null;
  list(workspaceId?: string): ITerminalHandle[];
}
```

### 3.2 Application service — `packages/core/src/services/TerminalService.ts`

**⚑ Resolves R-2 (session persistence), R-3 (workspace cleanup), R-6 (SSE replay).**

- **State:** in-memory `Map<sid, {handle, scrollback, lastActivity, wsCount}>` — **ephemeral**, no DB.
- **Scrollback:** in-memory ring buffer, **default 10 000 lines / ~4 MB per session**. Explicitly not persisted; server restart clears everything. Documented behaviour, matches Browser sessions.
- **Idle reaper:**
  - "Idle" = `lastActivity` older than `TERMINAL_IDLE_TTL_MS` (default **30 min**) AND `wsCount === 0`.
  - `lastActivity` updated on **any** of: input msg, output byte, resize, ACK. This resolves R-10 — a `pnpm dev` writing 1 line/min keeps the session alive even with no attached WS.
- **Caps:**
  - 5 concurrent sessions **per workspace**.
  - 20 total server-wide.
  - Rejection returns `429` with reason string.
- **SSE lifecycle events (⚑ R-6):** on spawn/close, emit `terminal.session_created` / `terminal.session_closed` on the EventBus. These land in the same event table used by browser + stage events; TTL = 24 h (existing retention policy). SSE clients reconnecting with `Last-Event-ID` replay these fine.
- **Workspace cleanup hook (⚑ R-3):** wire `WorkspaceManager.deleteWorkspace(id)` to call `terminalService.killAllForWorkspace(id)`.
- **Session lifecycle:**
  - `spawn(...)` → returns `{ id, pid, cwd, cols, rows }`.
  - Handle emits `data` events (raw bytes) and `exit` events; TerminalService fans them out to attached WS clients.
  - `kill(sid, 'user')` on tab close (⚑ R-8: close tab kills session immediately, no zombie state).

### 3.3 Infrastructure adapters

**`NodePtyHost` (default)** — `packages/core/src/infrastructure/terminal/NodePtyHost.ts`

- `node-pty` v1.x. Windows → ConPTY; POSIX → forkpty.
- **Shell resolution (⚑ R-12):**
  ```
  POSIX:  process.env.SHELL ?? /bin/bash
  Windows: pwsh.exe (Program Files\PowerShell\7 or PATH) → powershell.exe → cmd.exe
  ```

  Detection cached at boot.
- **Windows PowerShell profile skip** — spawn with `-NoProfile` when using pwsh/powershell for fast startup (~200 ms vs 1–2 s). Configurable via `Settings → Terminal → Advanced → Load PowerShell profile`.
- **Env sanitisation (⚑ R-3.4):**
  - Base = `process.env`.
  - **Strip unconditionally:** `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`, `ELECTRON_RUN_AS_NODE`, `GENERATORAI_TOKEN`, `GENERATORAI_*_SECRET`, `DATABASE_URL`.
  - **Strip by default, opt-in via Settings:** `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`.
  - **Keep:** `HOME`, `USER`, `USERNAME`, `PATH`, `TERM`, `COLORTERM`, `LANG`, `LC_*`, `GIT_AUTHOR_*`, `GIT_COMMITTER_*`.
  - **Inject:** `TERM=xterm-256color`, `COLORTERM=truecolor`, `GENERATORAI_WORKSPACE_ID=<id>`.
- **PS1** on POSIX: `\[\e[36m\][genai]\[\e[0m\] \w \$ ` — makes it obvious you're in a GeneratorAI terminal.

**`FallbackChildProcessHost`** — used when `node-pty` fails to load.

- `child_process.spawn(shell, ['-i'], { stdio: 'pipe' })`. No PTY semantics.
- Header banner: **"Fallback mode (limited features)"**. Bugs like broken `vim` are expected.

**`SandboxPtyHost` (Phase 2, deferred)** — `docker exec -it` inside the run's sandbox container.

- Requires additive `SandboxExecOptions.tty?: boolean` on `ISandboxProvider`.
- **Not in MVP.** Called out in §8.

### 3.4 Transport — `apps/server/src/terminal-ws.ts`

**Mirrors `browser-ws.ts` exactly.**

```
Path:   /api/workspaces/:id/terminals/:sid/stream
Server → client:
  Binary WS frames  = raw PTY bytes (fed straight into xterm.write)
  JSON control:
    { t: 'exit', code, signal }
    { t: 'resized', cols, rows }
Client → server (JSON only):
    { t: 'input',  data: string }
    { t: 'resize', cols, rows }
    { t: 'ack',    bytes: number }
    { t: 'signal', name: 'SIGINT' | 'SIGTERM' }
```

**Auth (⚑ R-3.1) + Origin (⚑ R-14):**

- `noServer: true` upgrade handler validates:
  1. Cookie / bearer via the existing `assertAuthenticated(req)` helper (same one browser-ws will inherit once auth lands; today loopback-only, still checked).
  2. `Origin` header:
     - Dev: exact match `http://localhost:<VITE_PORT>` (from `VITE_DEV_PORT` env).
     - Prod-desktop: `Origin: null` allowed *only* when `req.socket.remoteAddress` is loopback.
     - All other origins → `socket.destroy()`.
- Rejection **before** `wss.handleUpgrade` — never hand off to WS.

**Input rate limit (⚑ R-15):**

- Max 200 input messages/sec per WS. Excess dropped with a warning log. Prevents keystroke-spam DoS.

**Vite dev proxy (⚑ R-11):**

- Vite proxies WS upgrades transparently *only if* `vite.config.ts` has `proxy['/api'].ws = true`. Verify this in the config; the same setting already routes `browser-ws.ts` — one line to add explicit test coverage in `agent-tests/terminal-dev-server.spec.ts`.

### 3.5 REST — `apps/server/src/routes/terminals.ts`

```
POST   /workspaces/:id/terminals              body: { cols, rows, shell? }         → { id, pid, cwd, cols, rows }
GET    /workspaces/:id/terminals                                                    → TerminalDescriptor[]
GET    /workspaces/:id/terminals/:sid                                               → TerminalDescriptor
GET    /workspaces/:id/terminals/:sid/scrollback?tailBytes=131072                   → application/octet-stream
POST   /workspaces/:id/terminals/:sid/resize  body: { cols, rows }                  → 204
POST   /workspaces/:id/terminals/:sid/signal  body: { name: 'SIGINT' | ... }        → 204
DELETE /workspaces/:id/terminals/:sid                                               → 204
```

- `cwd` **is not accepted** from the client in MVP (⚑ R-3.3 hardening).
- `TerminalDescriptor` also lands on SSE via `terminal.session_created` for auto-focus.

### 3.6 Frontend — `apps/web/src/components/terminal/TerminalPanel.tsx`

**Deps (new):** `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-search`, `@xterm/addon-webgl`.

**Component signature (mirrors `BrowserPanel`):**

```tsx
interface TerminalPanelProps {
  workspaceId: string | undefined;
  tabId: string;                                       // stable per RightPane tab
  embedded?: boolean;                                  // hides outer chrome in RightPane
  onCapture?: (file: File, kind: 'terminal') => void;
  agentBusy?: boolean;
}
```

**Session lookup (⚑ R-5):**

```
key = `generatorai:terminal:${workspaceId}:${tabId}`
1. read cached sid from localStorage
2. if cached, HEAD /terminals/:sid to verify still alive; else forget
3. if none, POST /terminals; store new sid
4. GET /scrollback → term.write(replayBytes)
5. open WS
```

**xterm lifecycle:**

1. `new Terminal({ scrollback: 5000, fontFamily: 'JetBrainsMono, ...', theme: currentAppTheme })`.
2. Load `FitAddon`, `WebglAddon` (fallback to Canvas on WebGL failure), `WebLinksAddon`, `SearchAddon`.
3. `onData → send { t:'input', data }`.
4. `onResize → send { t:'resize', cols, rows }` (debounced 60 ms via `FitAddon.fit`).
5. WS binary → `term.write(bytes, ackCallback)`; ACK every 64 KB written (⚑ flow control).
6. On unmount **and** on RightPane tab close → `DELETE /terminals/:sid` + clear localStorage.

**Header bar** (same VSCode-simple-browser style as BrowserPanel):

```
[+ New]  [Ⓒ Clear]  [🔍 Search]  cwd: ~/…/run-abc123   [📎 Attach to chat]  [⋮]
```

**CSP (⚑ R-2.9):** verify existing `default-src 'self'` allows `data:` for xterm's CSS-embedded glyphs and `ws:` for the WS connection. Both are already permitted (browser panel + Vite HMR use them today).

**Multi-worktree quick-cd (⚑ R-9):**

- When the tab is opened on a **workflow-run** page whose run has multiple worktrees, the header shows a dropdown `cd source/<alias>` that types `cd "<abs path>"\n` into the terminal.
- Single terminal in `rootPath` by default; user picks the worktree via dropdown, or types `cd` manually.
- MVP is deliberately not per-worktree tabs; multiplies complexity for marginal gain.

### 3.7 Right-pane tab registration

Add to both `ChatPage.tsx` and `WorkflowRunPageV2.tsx` `tabs={{}}` map:

```tsx
terminal: {
  label: 'Terminal',
  description: 'Integrated shell for this workspace',
  icon: <TerminalSquare className="h-3.5 w-3.5" />,
  allowMultiple: true,
  disabled: !chat?.workspaceId,          // same gate as browser
  disabledReason: 'Send a message first to create a workspace',
  render: () => (
    <TerminalPanel
      embedded
      workspaceId={chat?.workspaceId}
      tabId={activeTabId}                 // RightPane passes this in Phase 1 (see §3.7.1)
      onCapture={(file) => setPendingCaptures((p) => [...p, file])}
      agentBusy={isCopilotWorking}
    />
  ),
},
```

**§3.7.1 — small RightPane change:** the current `RightPaneTabDef.render()` takes no args. We extend it to `render(ctx: { id: string })` so `TerminalPanel` gets the stable per-tab id required by the session-lookup logic. Fully backwards compatible — existing tabs ignore the ctx.

### 3.8 Desktop

**⚑ Resolves R-4 (native module rebuild).**

`apps/desktop/package.json`:

```json
{
  "dependencies": {
    "node-pty": "^1.1.0-beta27",           // or latest stable at build time
    "better-sqlite3": "..."
  },
  "scripts": {
    "postinstall": "electron-rebuild -f -w better-sqlite3 -w node-pty"
  },
  "build": {
    "asarUnpack": [
      "**/node_modules/better-sqlite3/**",
      "**/node_modules/node-pty/**"
    ]
  }
}
```

**Platform support matrix:**

| Platform                       | node-pty status           | Fallback if rebuild fails           |
| ------------------------------ | ------------------------- | ----------------------------------- |
| Windows 10 1809+ (x64, arm64)  | ConPTY, rebuild required  | `FallbackChildProcessHost` banner |
| macOS 11+ (x64, arm64)         | forkpty, rebuild required | ditto                               |
| Linux glibc 2.29+ (x64, arm64) | forkpty, rebuild required | ditto                               |
| Linux musl (Alpine)            | **unsupported**     | forced fallback                     |

**Boot-time detection:** composition-root tries `require('node-pty')`. On failure, logs a warning + registers `FallbackChildProcessHost`. Never crashes the server.

No `apps/desktop/src/main/terminal-host.ts` for MVP — the server-in-child-process path is correct and the same as `better-sqlite3`.

---

## 4 · Sandbox coupling model

**⚑ Resolves R-1 (P0 blocker).**

**Decision: Terminals are workspace-scoped and always run on the host in MVP. Never inside a run's sandbox.**

**Rationale:**

- Sandboxes are per-`runId`; the chat page has no active run.
- A workspace outlives any single run.
- Users get one predictable execution surface: **host**.
- Agents keep using the existing sandbox-exec tool path for isolated code execution. Nothing changes for the agent contract.

**Implications spelled out:**

- Chat page terminal → runs on host in `workspace.rootPath`.
- Workflow-run page terminal (even when the run is sandboxed) → **also runs on host** in `workspace.rootPath` (which is where the worktrees live). Header shows a subtle note: *"Host shell — not inside the sandbox"* on sandboxed runs so users understand.
- If the workspace is deleted, the terminal exits (§3.2 cleanup hook).

**Phase-2 opt-in (deferred):** `SandboxPtyHost` accessible via a "Attach to run sandbox" header action on the workflow-run page when the run is active and sandboxed. Tracked separately.

---

## 5 · Lifecycle & state machine

**⚑ Resolves R-7 (pause/resume), R-8 (close-tab), R-10 (idle).**

```
                ┌─────────────┐
      spawn →   │   active    │  ← WS reconnect (fetch scrollback)
                └─────┬───┬───┘
   PTY exit ── ↓      │   │ ↑
                ┌─────▼───┴───┐
                │   exited    │   (terminal state, no transitions)
                └─────────────┘
                      ↑
        close-tab / kill / TTL reap / workspace delete
                      │
                ┌─────┴────────┐
                │    idle      │   wsCount == 0 && no activity 30m
                └──────────────┘
```

**Behaviour matrix:**

| Event                           | Terminal state →            | Notes                                                                                                                  |
| ------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| User closes RightPane tab       | active → exited (kill)      | ⚑ R-8: no zombie state.                                                                                               |
| Workspace deleted               | any → exited (kill)         | ⚑ R-3 cleanup hook.                                                                                                   |
| Workflow-run**paused**    | *no PTY change*            | Terminal PTY keeps running; user can still inspect.`terminal.session_paused` NOT emitted.                            |
| Workflow-run**cancelled** | *no PTY change*            | Same reasoning.                                                                                                        |
| Server crash                    | orphaned PTY                 | OS reaps; on restart new session; user sees WS 1006 → auto-reconnect fails → banner "Session lost, click to reopen". |
| Client WS disconnect            | active → active (wsCount--) | PTY continues, output buffered in ring. Idle clock starts only when wsCount == 0.                                      |
| Client WS reconnect             | active → active (wsCount++) | Client re-fetches scrollback tail.                                                                                     |
| No activity 30 min & no WS      | idle → exited (reap)        | Configurable.                                                                                                          |

---

## 6 · Performance

### 6.1 Server → browser flow control (**verified pattern from xtermjs.org**)

- **HIGH = 256 KB unacked**, **LOW = 64 KB unacked**, hysteresis 4×.
- Client ACKs every 64 KB written into xterm.
- Server calls `handle.pause()` when unacked > HIGH, `handle.resume()` when < LOW.
- `ws.bufferedAmount > 1 MB` → force-pause regardless (defensive against stuck TCP window).
- Server-side coalesce: buffer PTY chunks with `setImmediate`, flush every 4 ms up to 32 KB per WS frame. Trades ~4 ms latency for 4-10× fewer WS frames on log-heavy output.
- **Verification:** `agent-tests/terminal-performance.spec.ts` runs `yes | head -n 500000` and asserts:
  - Renderer stays responsive (input echo < 50 ms during flood).
  - `ws.bufferedAmount` never exceeds 2 MB.
  - Memory footprint of server stays under 40 MB.

### 6.2 Rendering

- WebGL renderer addon default; Canvas fallback.
- Client `scrollback: 5000` lines (~2 MB) — matches VSCode default.
- Skip `fit()` while `document.hidden`.

### 6.3 Memory bounds

- Ring buffer 10 000 lines × ~400 bytes/line ≈ 4 MB / session.
- 5 sessions × workspace × 4 MB = 20 MB max per workspace on server.
- Client 2 MB scrollback + xterm buffers ≈ 5 MB / tab.

---

## 7 · Security

**⚑ Resolves R-3.1..R-3.6, R-14, R-15.**

| Concern                       | Mitigation                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell access at server uid    | Auth on WS upgrade (same middleware as REST). Loopback-only binding in dev/desktop.                                                                                                                          |
| Origin spoofing               | Explicit Origin allowlist:`http://localhost:<VITE_PORT>`, `http://127.0.0.1:<APP_PORT>`, `null` **only** when loopback. No wildcards.                                                            |
| cwd path escape               | cwd is server-computed from`workspace.rootPath`. **No user-supplied cwd.**                                                                                                                           |
| Env leakage                   | Strip:`NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`, `ELECTRON_RUN_AS_NODE`, `GENERATORAI_TOKEN`, `GENERATORAI_*_SECRET`, `DATABASE_URL`. Opt-in strip: `SSH_AUTH_SOCK`, `AWS_SECRET_ACCESS_KEY`. |
| Sandbox bypass                | Terminal is documented as**host shell**, not sandbox. Header warning on sandboxed runs.                                                                                                                |
| DoS by keystroke spam         | 200 msgs/sec/WS input rate limit; excess dropped.                                                                                                                                                            |
| DoS by session spawn          | 5/workspace, 20/server caps → 429.                                                                                                                                                                          |
| DoS by output flood           | Server-side pause via watermark;`bufferedAmount` circuit-breaker.                                                                                                                                          |
| Windows encoded-command abuse | For MVP the terminal is user-driven only; no programmatic spawn API. Non-issue until Phase-2 agent-typed input.                                                                                              |

**Threat model doc** at `.github/docs/feature-terminal.md` will restate each row with an owning acceptance test.

---

## 8 · Deferred / Phase-2

| Item                                                                                  | Reason                                                                       |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Sandbox-attached terminal** (`SandboxPtyHost` + `SandboxExecOptions.tty`) | Non-trivial UX. Needs a`(runId, sid)` re-keying. Tracked separately.       |
| **Agent-typed commands** with per-command user confirm (Cursor-style)           | UX design + audit trail needed. Not blocking anything today.                 |
| **DB-backed session persistence** (survive server restart)                      | Requires`terminal_sessions` + `terminal_events` tables. Wait for demand. |
| **Session recording / playback**                                                | Adds storage. Wait for demand.                                               |
| **Path hyperlinks that open workspace files**                                   | Depends on future file-editor tab; premature.                                |
| **Terminal output as workflow validation source**                               | Couples workflow state to a UI surface; avoid.                               |
| **Renderer-owned PTY in Electron main**                                         | Optional perf win of ~1 ms over loopback; not worth the extra IPC surface.   |

---

## 9 · File-level change list

**New files**

- `packages/core/src/domain/ports/ITerminalHost.ts`
- `packages/core/src/services/TerminalService.ts`
- `packages/core/src/infrastructure/terminal/NodePtyHost.ts`
- `packages/core/src/infrastructure/terminal/FallbackChildProcessHost.ts`
- `packages/shared/src/types/Terminal.ts`
- `apps/server/src/routes/terminals.ts`
- `apps/server/src/terminal-ws.ts`
- `apps/web/src/components/terminal/TerminalPanel.tsx`
- `apps/web/src/components/terminal/TerminalHeader.tsx`
- `agent-tests/terminal-e2e.spec.ts`
- `agent-tests/terminal-ui.spec.ts`
- `agent-tests/terminal-workflow.spec.ts`
- `agent-tests/terminal-desktop-smoke.mjs`
- `agent-tests/terminal-performance.spec.ts`
- `agent-tests/terminal-dev-server.spec.ts`
- `.github/docs/feature-terminal.md`

**Edited files**

- `packages/core/src/domain/ports/index.ts` — export new port.
- `apps/server/src/composition-root.ts` — instantiate host + service; expose in Container.
- `apps/server/src/app.ts` — mount `createTerminalRoutes(container)`; `attachTerminalWebSocket(server, container)` next to browser.
- `apps/server/src/routes/index.ts` — register.
- `apps/web/src/components/layout/RightPane.tsx` — extend `RightPaneTabDef.render()` to `(ctx: { id: string }) => ReactNode` (backwards compatible).
- `apps/web/src/pages/ChatPage.tsx` — `addableTabTypes` + `tabs.terminal` entry.
- `apps/web/src/pages/WorkflowRunPageV2.tsx` — same.
- `apps/web/src/pages/Settings.tsx` — new **Terminal** section: default shell, scrollback size, "Allow SSH_AUTH_SOCK", "Load PowerShell profile".
- `packages/shared/src/types/AgentEvent.ts` — `terminal.session_created` + `terminal.session_closed` kinds.
- `packages/core/src/services/WorkspaceManager.ts` — call `terminalService.killAllForWorkspace(id)` in delete path.
- `apps/desktop/package.json` — add `node-pty`, extend `postinstall`, extend `asarUnpack`.
- `vite.config.ts` (web) — confirm `server.proxy['/api'].ws = true`.

**Package additions**

- SPA: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-search`, `@xterm/addon-webgl`.
- Server/desktop: `node-pty` (+ `@electron/rebuild` if not already present).

---

## 10 · Test plan

| File                                         | Level                         | Key assertions                                                                                          |
| -------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| Unit`TerminalService.test.ts`              | vitest                        | spawn/kill/list; idle reaper; caps; workspace cleanup fan-out; ACK-driven pause/resume.                 |
| `agent-tests/terminal-e2e.spec.ts`         | REST + WS                     | full lifecycle; scrollback replay; resize; signal SIGINT; DELETE.                                       |
| `agent-tests/terminal-ui.spec.ts`          | Playwright, ChatPage          | add tab, type`echo hi`, see `hi`, close tab kills session.                                          |
| `agent-tests/terminal-workflow.spec.ts`    | Playwright, WorkflowRunPageV2 | terminal available; multi-worktree cd dropdown; sandbox banner.                                         |
| `agent-tests/terminal-performance.spec.ts` | perf                          | `yes` flood → renderer responsive, `bufferedAmount < 2 MB`, memory bounded.                        |
| `agent-tests/terminal-desktop-smoke.mjs`   | Electron                      | native PTY loads; terminal tab opens; type + output roundtrip. Mirrors`right-pane-desktop-smoke.mjs`. |
| `agent-tests/terminal-dev-server.spec.ts`  | Vite proxy                    | WS upgrade succeeds through Vite dev proxy.                                                             |

**Selectors added to `agent-tests/helpers/`:**

- `[data-testid="right-pane-tab-terminal"]`
- `[data-testid="right-pane-add-terminal"]`
- `[data-testid="terminal-container"]`
- `[data-testid="terminal-header"]`
- `[data-testid="terminal-attach-to-chat"]`
- `[data-testid="terminal-cwd"]`

**Playwright + xterm nuance:** xterm renders into a Canvas. Tests should not screen-scrape; instead assert against WS traffic + expose a `window.__generatoraiTerminalBuffer` debug hook (dev-only, guarded by `import.meta.env.DEV`) that returns the current xterm buffer string.

**Manual verification checklist:**

- Windows: PowerShell 7 ConPTY, `Get-ChildItem` colours, `python -m http.server`.
- macOS: `top`, `htop`, `vim`, `less`, `bash -l`.
- Linux: `docker run`, curl-loop, resize while running.
- Web + Desktop: reload page mid-session (with idle reaper disabled) → scrollback replays.

---

## 11 · Rollout

**Phase 1 — Server groundwork (feature flag OFF by default)**

1. Domain port + `TerminalService` + `NodePtyHost` + `FallbackChildProcessHost`.
2. REST routes + WS transport.
3. Composition-root wiring.
4. Unit + e2e tests.
5. Manual smoke via `curl` + `wscat`.

**Phase 2 — Web UI**

1. `TerminalPanel` + xterm addons.
2. RightPane `render(ctx)` signature bump.
3. ChatPage + WorkflowRunPageV2 tabs.
4. Settings section.
5. Playwright UI tests.

**Phase 3 — Desktop parity**

1. `node-pty` dependency + `postinstall` electron-rebuild.
2. `asarUnpack` config.
3. Boot-time detection + fallback path.
4. Desktop smoke script.

**Phase 4 — Feature flag flip**

- Run all E2E on Windows/macOS/Linux desktop + web.
- Flip default to ON.
- Remove flag two releases later.

**Phase 5 — Deferred (§8)** as demand appears.

---

## 12 · Explicit open questions for the user

1. **Sandbox opt-in priority** — Should we schedule Phase 2 (SandboxPtyHost) in the next release, or wait for user demand? yes schedule phase 2 also in the plan
2. **PowerShell profile loading** — Off by default (fast startup) vs. on by default (matches user's normal terminal)? Recommended: **off by default**, toggle in Settings.
3. **Windows default shell** — pwsh 7 (nice) or `powershell.exe` (always present)? Recommended: **pwsh → powershell → cmd** cascade.
4. **Idle TTL** — 30 min default too aggressive for long-running `pnpm dev`? Should we go 4 h? Recommended: **30 min but bumped whenever there's output** (already in the plan).
5. **Multi-terminal by default** — allow multiple `terminal` tabs from day 1? Recommended: **yes** — the cost is zero, users will want it.

---

## Appendix A · Review resolution matrix

| Review ID                      | Severity | Where addressed                                    |
| ------------------------------ | -------- | -------------------------------------------------- |
| R-1 Sandbox coupling           | P0       | §0 (D3), §4                                      |
| R-2 Session persistence        | P0       | §0 (D2), §3.2                                    |
| R-3 Workspace cleanup          | P0       | §3.2, §9 (WorkspaceManager edit)                 |
| R-4 Desktop native rebuild     | P0       | §3.8                                              |
| R-5 Tab↔session mapping       | P0       | §3.6, §3.7.1                                     |
| R-6 SSE Last-Event-ID replay   | P0       | §3.2                                              |
| R-7 Pause/resume state machine | P1       | §5                                                |
| R-8 Close-tab semantics        | P1       | §0 (D4), §5                                      |
| R-9 Multi-worktree navigation  | P1       | §3.6                                              |
| R-10 Idle timeout reset        | P1       | §3.2                                              |
| R-11 Vite proxy WS             | P2       | §3.4, §10                                        |
| R-12 Windows shell detection   | P2       | §3.3                                              |
| R-13 Capture / artifacts       | P2       | §3.6 (attach-to-chat only; artifact deferred §8) |
| R-14 Origin check              | P2       | §3.4, §7                                         |
| R-15 Input rate limiting       | P2       | §3.4, §7                                         |
