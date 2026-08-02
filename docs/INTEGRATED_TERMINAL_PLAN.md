# Integrated Terminal — Research & Implementation Plan

**Status:** Draft for review • **Author:** GeneratorAI planning pass • **Scope:** Web + Desktop parity, agentic-app quality

---

## 0 · Executive summary

Add an **integrated terminal** as a new tab kind (`terminal`) in the existing unified `RightPane`, sitting alongside `Changes`, `Browser`, and (workflow-only) `Inspector`. Both web and desktop use the **same server-hosted PTY service** exposed over a **WebSocket** (`/api/workspaces/:id/terminals/:sid/stream`), consumed by an **xterm.js** renderer in the SPA. This keeps the current "server is the single source of truth, desktop shells the SPA" model that already governs the browser tab, and gives us web/desktop parity for free.

Key design choices (rationale in §3):
- **`node-pty`** on the server for real PTY semantics (ConPTY on Windows, forkpty on POSIX).
- **Binary WebSocket** for output, JSON control frames for input/resize/ack — same shape as `browser-ws.ts`.
- **Server-side session store** so a terminal survives SPA reloads and tab switches (parity with existing Right Pane long-lived state).
- **xterm.js + WebGL renderer + FitAddon + WebLinksAddon + SearchAddon**.
- **Watermark-based flow control** (per xtermjs.org guide) to avoid renderer stalls on `yes`-style producers.
- **Scoped to a workspace**. `cwd` = workspace `rootPath` (or the first git worktree if present). Env inherits sanitized parent env.
- **Feature-flagged**: `GENERATORAI_TERMINAL=1` while stabilising; auto-on once native module builds are proven on all target platforms.

---

## 1 · Current architecture — recap

| Layer | Reference | What we reuse |
|---|---|---|
| Right pane shell | [apps/web/src/components/layout/RightPane.tsx](apps/web/src/components/layout/RightPane.tsx) | Add `terminal` tab kind — no shell changes, just a new `RightPaneTabDef`. |
| Chat page | [apps/web/src/pages/ChatPage.tsx](apps/web/src/pages/ChatPage.tsx#L458) | Extend `addableTabTypes` from `['browser']` → `['browser', 'terminal']`. |
| Workflow run page | [apps/web/src/pages/WorkflowRunPageV2.tsx](apps/web/src/pages/WorkflowRunPageV2.tsx#L430) | Extend `addableTabTypes` from `['inspector', 'browser']` → `['inspector', 'browser', 'terminal']`. |
| WebSocket transport precedent | [apps/server/src/browser-ws.ts](apps/server/src/browser-ws.ts) | Copy the `noServer + PATH_RE` upgrade router pattern (already handles input serialisation and back-pressure). |
| Workspace root resolution | [packages/core/src/services/WorkspaceManager.ts](packages/core/src/services/WorkspaceManager.ts#L127) | `workspace.rootPath` gives the exact working dir the agent already uses. |
| Sandbox exec (fallback path) | [packages/core/src/services/SandboxLifecycleManager.ts](packages/core/src/services/SandboxLifecycleManager.ts) + [ISandboxProvider](packages/core/src/domain/ports/ISandboxProvider.ts) | Attach the PTY to a running sandbox container when sandbox mode is on (parity with agent isolation). |
| Desktop → server bridging | [apps/desktop/src/main/server-manager.ts](apps/desktop/src/main/server-manager.ts) | The desktop ships the server as a child Node process; the terminal lives there. No new Electron-main IPC surface needed for MVP. |

**Implication:** we get web + desktop parity if we put the PTY in the server. The desktop's Electron main process only needs to make sure `node-pty` is present in the packaged server bundle and rebuilt against the correct ABI (same story as `better-sqlite3` today).

---

## 2 · Research — how modern agentic apps do this

| App | Backend PTY | Transport | Frontend | Notes |
|---|---|---|---|---|
| VSCode | `node-pty` in extension host | IPC (in-process) | xterm.js | Reference implementation. Persistent-process protocol for reload. |
| Cursor | Fork of VSCode | Same as VSCode | xterm.js | Adds *agent terminals* — model proposes commands, user confirms per-run or per-session. |
| Zed | Rust `alacritty_terminal` | In-process | Custom GPU renderer | Panel (bottom/left/right) or center-tab. Path hyperlinks + AI inline assist. |
| Theia | `node-pty` in Node backend | JSON-RPC over WebSocket | xterm.js | The web/desktop parity model closest to ours. Persistent shell processes across reconnect. |
| Replit / Codespaces / Gitpod | `node-pty` (or shell exec via container agent) | WebSocket | xterm.js | PTY runs inside per-user container; front-end streams over WS with flow control. |
| Claude Code / Warp | Local shell wrapping | N/A (local) | Native/Electron | Agentic loops = LLM proposes commands, terminal shows before/after. Sandboxing per-command via approval prompts. |

**Agentic-specific patterns worth borrowing:**
1. **Command proposals with confirmation** (Cursor, Claude Code) — the agent doesn't type into the raw PTY, it *proposes* a command line that the user confirms before it lands. We already have the `pendingCaptures` pattern for the browser; the same shape works here (`pendingCommands`).
2. **Structured terminal output as chat context** — Cursor lets the user select terminal output and pipe it into the agent. We can hook `xterm.js`'s selection API into `onCapture` just like the browser Inspect tab.
3. **Per-workspace persistent sessions** — required for "come back after 5 min and the `pnpm dev` is still running".
4. **Explicit visual isolation** — sandbox-mode runs get a tinted terminal header ("Running inside sandbox `genai-run-…`") so users understand the blast radius.

---

## 3 · Architecture

```
┌── apps/web (renderer) ───────────────────────────────────────┐
│  RightPane                                                    │
│    └── TerminalTab                                            │
│         ├── xterm.js (WebGL, Fit, WebLinks, Search)           │
│         ├── WS client @ /api/workspaces/:id/terminals/:sid/…  │
│         └── local state: dims, scrollback, dirty, capture buf │
└──────────────────────┬────────────────────────────────────────┘
                       │ ws (binary out, json in)
┌──────────────────────▼────────────────────────────────────────┐
│ apps/server                                                   │
│   terminal-ws.ts   ← noServer upgrade router (mirror of       │
│                      browser-ws.ts)                           │
│   routes/terminals.ts (REST: list, create, resize, kill,      │
│                        replay-scrollback)                     │
└──────────────────────┬────────────────────────────────────────┘
                       │ port call
┌──────────────────────▼────────────────────────────────────────┐
│ packages/core                                                 │
│   services/TerminalService.ts                                 │
│   domain/ports/ITerminalHost.ts   (spawn / write / resize /   │
│                                    kill / onData / onExit)    │
└──────────────────────┬────────────────────────────────────────┘
                       │ implementations
┌───────────────┬──────▼──────────┬──────────────────────────────┐
│ NodePtyHost   │ SandboxPtyHost  │ FallbackChildProcessHost      │
│ (default)     │ (docker exec -it inside genai-run-<runId>)     │
│               │  when sandbox=on and provider=docker sandbox)  │
└───────────────┴────────────────────────────────────────────────┘
```

### 3.1 Domain port

New file `packages/core/src/domain/ports/ITerminalHost.ts`:

```ts
export interface TerminalSpawnOptions {
  cwd: string;                       // resolved by TerminalService from workspaceId
  cols: number;                      // initial size
  rows: number;
  env?: Record<string, string>;      // merged over sanitized base env
  shell?: string;                    // override; else platform default
  shellArgs?: string[];
  encoding?: 'utf8';                 // default utf8, raw bytes for xterm.js
  handleFlowControl?: boolean;       // enable XON/XOFF pause/resume propagation
}

export interface ITerminalHandle {
  readonly id: string;               // session id, uuid
  readonly workspaceId: string;
  readonly pid: number | null;       // null when running via sandbox exec
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pause(): void;                     // xon/xoff flow control
  resume(): void;
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  readonly exitCode: number | null;
}

export interface ITerminalHost {
  spawn(opts: TerminalSpawnOptions & { workspaceId: string }): Promise<ITerminalHandle>;
  /** Rehydrate an existing session on reconnect. Returns null if unknown. */
  get(id: string): ITerminalHandle | null;
  list(workspaceId?: string): ITerminalHandle[];
}
```

Events are exposed via an `EventEmitter` on the handle: `onData(buf)`, `onExit({code, signal})`.

### 3.2 Application service

`packages/core/src/services/TerminalService.ts`:
- Owns a `Map<sessionId, TerminalHandle>` and per-workspace ownership index.
- Ring-buffer scrollback per session (default 10 000 lines, ~4 MB) so a reconnecting client can replay recent output without hitting the PTY again.
- Idle reaper: kill sessions with no attached WS for `TERMINAL_IDLE_TTL_MS` (default 30 min) — configurable via env.
- Enforces per-workspace concurrent-session cap (default 5) to bound resource use.
- Emits `terminal.data / terminal.exit / terminal.resized` on the existing `EventBus` so future auditing / recording can subscribe without touching the service.

### 3.3 Infrastructure adapters

**`NodePtyHost`** (default):
- `node-pty` v1.x. Windows → ConPTY; macOS/Linux → forkpty.
- Sanitised env: start from `process.env` minus `NODE_OPTIONS`, `SSH_*`, `AWS_*` (opt-in), plus injected `GENERATORAI_WORKSPACE_ID`, `TERM=xterm-256color`, `COLORTERM=truecolor`, `PS1` set to `${cyan}[genai]${reset} \w \$ ` on POSIX.
- Watermark flow control against xterm.js writes (see §4).

**`SandboxPtyHost`** (when the workspace is bound to an active sandbox session — same guard `SandboxLifecycleManager.getSession(runId)` already exposes):
- Uses `provider.exec(name, [shell, '-l'], { streamTo, tty: true })` — this needs a small extension of `ISandboxProvider.exec` to accept a `tty: true` flag that maps to `docker exec -it`. Additive change, backwards-compatible.
- No native PTY dependency for the container image; the container provides the PTY.

**`FallbackChildProcessHost`**:
- Pure `child_process.spawn` with `shell: true`, no PTY. Line-buffered only, no color/cursor semantics. Used when `node-pty` fails to load (build issue, unsupported platform). We surface a banner in the terminal tab telling the user they're on the fallback so they don't try to run `vim`.

### 3.4 Transport — `apps/server/src/terminal-ws.ts`

Mirror `browser-ws.ts`:

```
Path:   /api/workspaces/:id/terminals/:sid/stream
Server → client:
  • Binary WS frames = raw PTY bytes (identical to what node-pty emitted).
  • Text JSON frames = control:
      { t: 'exit', code, signal }
      { t: 'resized', cols, rows }
Client → server:
  • Text JSON frames only:
      { t: 'input', data: <string> }
      { t: 'resize', cols, rows }
      { t: 'ack', bytes: <number> }     // watermark ack
      { t: 'signal', name: 'SIGINT'|... }
```

- Same `noServer: true` upgrade router pattern as `browser-ws.ts`, both listening on the same HTTP server.
- Serial input chain (Promise queue) to prevent races between quick `resize` + `input`.

### 3.5 REST — `apps/server/src/routes/terminals.ts`

- `POST /workspaces/:id/terminals` → create a session; body `{ cols, rows, shell?, cwd? }` (cwd defaults to `rootPath`); returns `{ id, pid, cwd, cols, rows }`.
- `GET /workspaces/:id/terminals` → list active sessions.
- `GET /workspaces/:id/terminals/:sid` → describe.
- `GET /workspaces/:id/terminals/:sid/scrollback?tailBytes=` → replay for reconnect (raw ANSI bytes; browser writes them straight into xterm).
- `DELETE /workspaces/:id/terminals/:sid` → kill.
- `POST /workspaces/:id/terminals/:sid/resize` (optional; the WS path is primary but REST is useful for programmatic clients / the SDK).

Descriptor JSON also lands in the SSE bus as `terminal.session_created` / `terminal.session_closed` so the SPA can auto-focus the tab like Browser already does (`browser.session_created` in `session-79`).

### 3.6 Frontend — `apps/web/src/components/terminal/TerminalPanel.tsx`

Sibling to `BrowserPanel.tsx`:
- Deps (new): `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-search`, `@xterm/addon-webgl`.
- Lifecycle:
  1. On mount: if no `sid` in localStorage for this workspace, `POST /terminals` to create; else reuse.
  2. Fetch `/scrollback` once, `term.write(replayBytes)`.
  3. Open WS, wire `term.onData → send {t:'input'}`, `term.onResize → send {t:'resize'}`, WS binary → `term.write(bytes, () => enqueueAck())`.
  4. `FitAddon` on resize; debounced 60 ms.
- Header: `[+ New] [History] [Search] [Clear]  •  cwd  •  [Attach to chat]` — matching BrowserPanel's VS-Code-style bar.
- **`embedded` prop** (same convention as BrowserPanel/ChatFilesPanel) so the outer chrome is hidden inside `RightPane`.
- **Attach to chat** button — sends selected xterm text via `onCapture(file, 'terminal')`, wired into `pendingCaptures` in `ChatPage` (already exists).

### 3.7 Right-pane tab registration

New `TerminalPanel` gets a `RightPaneTabDef` in both `ChatPage.tsx` and `WorkflowRunPageV2.tsx`:

```tsx
terminal: {
  label: 'Terminal',
  description: 'Integrated shell in this workspace',
  icon: <TerminalSquare className="h-3.5 w-3.5" />,
  allowMultiple: true,                       // multiple terminals per workspace
  disabled: !chat?.workspaceId,              // same gate as browser
  disabledReason: 'Send a message first to create a workspace',
  render: () => (
    <TerminalPanel
      embedded
      workspaceId={chat?.workspaceId}
      onCapture={(file) => setPendingCaptures((p) => [...p, file])}
    />
  ),
}
```

The pane already supports `allowMultiple`; each new terminal becomes a fresh tab pill (`Terminal 1`, `Terminal 2`, …).

### 3.8 Desktop

- `apps/desktop/package.json`: add `node-pty` in `dependencies` and rebuild step in `postinstall` (using `electron-rebuild` or `@electron/rebuild` — same tool used for `better-sqlite3` today).
- `apps/desktop/src/main/index.ts`: no runtime code changes for MVP — the server subprocess already handles WS. **Optional future work**: a `terminal-host.ts` in main process mirroring `browser-host.ts` for a *renderer-owned* PTY when the SPA runs inside Electron; skip for MVP because parity via the server is already correct.
- Packaging: verify `node-pty`'s `.node` binary is copied by electron-builder's ASAR unpacking rules (same list already used for `better-sqlite3`).

---

## 4 · Performance

### 4.1 Producer-side (server → browser)
- **Flow control** via watermark (per xterm.js guide, §Flow control over websockets):
  - Server tracks `unackedBytes`; when `> HIGH (256 KB)` calls `handle.pause()` on the PTY (real OS-level XOFF, no phantom buffering).
  - Client's `term.write(bytes, ack)` sends `{t:'ack', bytes}` every N chunks (N = every 64 KB written).
  - Server resumes when `< LOW (64 KB)`.
- **Chunk coalescing**: PTY `onData` chunks are small; we buffer with `setImmediate` and flush every 4 ms up to 32 KB per WS frame — halves WS overhead on `yes`.
- **Backpressure via `ws.bufferedAmount`**: if `> 1 MB`, force a pause regardless of watermark; last resort against a stuck TCP window.

### 4.2 Renderer
- **WebGL renderer addon** — measured ~4× faster than DOM renderer on log-heavy output; falls back to Canvas if WebGL context fails.
- **Scrollback cap**: `term.options.scrollback = 5000` lines (~2 MB) — matches VSCode default. Anything older stays server-side in the ring buffer.
- **Rendering during hidden tab**: xterm's default `disableStdin` is fine but we also skip `fit()` while `document.hidden`.

### 4.3 Server memory
- Per-session ring buffer 10 000 lines cap → ~4 MB max.
- With 5-sessions-per-workspace cap and typical single-user desktop use: bounded < 20 MB per workspace.

### 4.4 Startup latency
- Native module load: `node-pty` `.node` is dlopen'd once at boot when the composition root wires `NodePtyHost`. Cold spawn ~30 ms on Linux, ~120 ms on Windows (ConPTY).

---

## 5 · Security

Terminals are **shell access at the server uid** — this is the single riskiest surface we've added since sandboxing. The plan:

1. **Auth on WS upgrade** — same session-cookie / bearer check the REST routes already use. Reject upgrade if `req` lacks `x-generatorai-token` / no valid cookie. (Today the server binds to `127.0.0.1` in dev + desktop; still, we treat it as authenticated.)
2. **Scoped to `workspaceId`** — `TerminalService.spawn` looks up the workspace and refuses if it doesn't exist / is deleted. cwd resolution goes through `PathResolver` — no user-supplied absolute cwd escape.
3. **Origin check on upgrade** — reject if the `Origin` header isn't the SPA's origin (desktop uses `file://`-loaded page → Origin is `null`, handled by an allow-list of `['http://localhost:*', 'null']` in dev; in prod-desktop the SPA is served same-origin from loopback).
4. **Env sanitisation** — strip `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`, `SSH_AUTH_SOCK`, `SSH_AGENT_*` from the child env unless the user has opted-in via `Settings → Terminal → Advanced`.
5. **Sandbox mode** — when the current run is sandboxed, the terminal *must* use `SandboxPtyHost` (attached to the same container). We refuse to open a plain host-PTY inside a sandboxed run to preserve the isolation contract.
6. **Rate-limits** — max 5 concurrent sessions per workspace, max 20 total per server, refuse new spawns beyond that.
7. **No agent-typed input in MVP** — the terminal is *user-driven*. Agent-driven commands go through the existing sandbox-exec / tool-call path with the current approval semantics. A future "agent terminal" surface (Cursor-style) is called out in §8 as a separate phase.
8. **Windows nuance** — refuse to spawn cmd/powershell with `-EncodedCommand` from any programmatic API path; only interactive user typing is allowed.

Threat model doc in `.github/docs/feature-terminal.md` will spell each of these out at review time.

---

## 6 · Failure modes & UX

| Failure | Detection | UX |
|---|---|---|
| `node-pty` load error at boot | try/catch in composition root, fall back to `FallbackChildProcessHost` | Terminal tab still opens; header banner: "Fallback mode (limited features)". Toast in Settings. |
| WS disconnect | client `onclose` | Auto-reconnect ×3 with jittered backoff; on success replay via `/scrollback`. |
| PTY exits (user typed `exit`) | `terminal.exit` control frame | Render `[Process exited with code N — press any key to close]`, tab remains open with dead terminal until user closes or restarts. |
| Server restart during dev | WS 1006 | Same as disconnect; new server has no memory of `sid` → spawn fresh. |
| Sandbox destroyed mid-session | `SandboxLifecycleManager.destroyForRun` emits event | TerminalService kills the associated `SandboxPtyHost` handle, emits exit code -1 with reason "sandbox destroyed". |
| Very large paste (>1 MB) | Client-side pre-check | Chunk into 64 KB writes with 4 ms gaps to avoid overloading the shell's readline. |

---

## 7 · Rollout & test plan

### 7.1 Phases
1. **Phase 1 (server groundwork)**  — port + service + `NodePtyHost` + REST + WS. Unit tests for `TerminalService`. Integration test with `ws` client hitting `bash -c "echo hi"`.
2. **Phase 2 (web UI)** — `TerminalPanel` + `RightPane` wiring + settings. Vitest for component, Playwright smoke that opens the tab, types `echo hi`, asserts output.
3. **Phase 3 (desktop)** — bundle `node-pty`, electron-rebuild step, desktop smoke script under `agent-tests/` (parity script mirroring `right-pane-desktop-smoke.mjs`).
4. **Phase 4 (sandbox path)** — extend `ISandboxProvider.exec` with `{ tty: true }`, wire `SandboxPtyHost`, tests for docker path.
5. **Phase 5 (agentic add-ons)** — `Attach to chat` capture, path hyperlink → open in Editor tab, propose-command UX (deferred, tracked in §8).

### 7.2 Test matrix (agent-tests)
- `agent-tests/terminal-e2e.spec.ts` — REST + WS lifecycle with ephemeral workspace.
- `agent-tests/terminal-ui.spec.ts` — Playwright, chat page.
- `agent-tests/terminal-desktop-smoke.mjs` — Electron dev launch, add tab, type command, assert output. Uses the same CDP + SPA-navigate pattern documented in `session-78-unified-right-pane.md`.

### 7.3 Manual verification
- Windows: PowerShell 7 + ConPTY renders 256-color `Get-ChildItem`.
- macOS: `top`, `htop`, `vim`, `less` — full ncurses.
- Linux: `docker run` from inside a workspace terminal completes.
- Web: open in Chrome, resize window, `yes | head -n 100000` stays snappy (flow control works).

---

## 8 · Deferred / follow-up work (called out on purpose)

| Item | Reason |
|---|---|
| **Agentic terminal proposals** (LLM → command → user confirm) | Needs its own UX + audit trail; MVP is user-driven. |
| **Cross-terminal search / task panel** (à la VSCode) | Only pays off with many terminals. |
| **Renderer-owned PTY in Electron main** (skip the server hop) | Optional perf win; server-hosted path is fine for local loopback (< 1 ms). |
| **Terminal output as validation source in workflow runs** | Would let `ResultValidator` grep last N lines. Nice, but couples workflow state to an ad-hoc UI surface. |
| **Recording / playback of terminal sessions** | Nice for audit, but adds storage cost; wait for demand. |
| **`AttachToRun` bookmark** | Auto-cd into a running workflow's worktree when opening a terminal on that run's page. Trivial once §3.7 lands. |

---

## 9 · Concrete file-level change list

**New files**
- `packages/core/src/domain/ports/ITerminalHost.ts`
- `packages/core/src/services/TerminalService.ts`
- `packages/core/src/infrastructure/terminal/NodePtyHost.ts`
- `packages/core/src/infrastructure/terminal/SandboxPtyHost.ts`
- `packages/core/src/infrastructure/terminal/FallbackChildProcessHost.ts`
- `apps/server/src/routes/terminals.ts`
- `apps/server/src/terminal-ws.ts`
- `apps/web/src/components/terminal/TerminalPanel.tsx`
- `apps/web/src/components/terminal/TerminalTabHeader.tsx`
- `agent-tests/terminal-e2e.spec.ts`
- `agent-tests/terminal-ui.spec.ts`
- `agent-tests/terminal-desktop-smoke.mjs`
- `.github/docs/feature-terminal.md`

**Edited files**
- `packages/core/src/domain/ports/index.ts` — export new port.
- `packages/core/src/composition-root.ts` (server side; the `apps/server/src/composition-root.ts`) — wire host + service + inject into routes/ws.
- `packages/shared/src/types/AgentEvent.ts` — add `terminal.session_created / .session_closed / .data` event kinds (SSE fan-out only for lifecycle, NOT raw output — output stays on WS).
- `packages/shared/src/types/Terminal.ts` (new) — descriptors + input event union.
- `apps/server/src/app.ts` — register new REST router; call `attachTerminalWebSocket(server, container)` next to `attachBrowserWebSocket`.
- `apps/server/src/routes/index.ts` — mount `/workspaces/:id/terminals`.
- `apps/web/src/pages/ChatPage.tsx` — add `terminal` to `addableTabTypes` and register `RightPaneTabDef`.
- `apps/web/src/pages/WorkflowRunPageV2.tsx` — same.
- `apps/web/src/pages/Settings.tsx` — new "Terminal" section (default shell override, scrollback size, env vars, sanitisation toggles).
- `apps/desktop/package.json` — add `node-pty`; wire `postinstall: electron-rebuild -f -w node-pty`.
- `apps/desktop/scripts/build.mjs` — ensure `.node` file is copied and ASAR-unpacked.
- `packages/core/src/domain/ports/ISandboxProvider.ts` — add optional `tty?: boolean` on `SandboxExecOptions` (Phase 4).
- `packages/core/src/infrastructure/DockerSandboxProvider.ts` (or the current impl) — honour `tty`.

**Package additions (SPA)** — `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-search`, `@xterm/addon-webgl`.

**Package additions (server / desktop)** — `node-pty`.

---

## 10 · Open questions for reviewer

1. **Sessions across page nav** — should terminals persist when the user navigates away from a chat/run page? Recommended: yes for the current workspace, kill on workspace deletion. Trivial to change later.
2. **Cwd default for Workflow Run page** — the workflow run has multiple worktrees (one per codebase). Do we open a terminal per-worktree, or one terminal at `workspace.rootPath` and let the user `cd`? Recommended: one terminal at `rootPath`, with a `cd source/<alias>` quick action in the header for each worktree.
3. **Sandbox coupling** — when a run is sandboxed, do we hide the terminal until the sandbox is up, or open a "pending" terminal? Recommended: hide, matching how the browser is gated on `workspaceId`.
4. **Windows shell default** — PowerShell 7 if present, else `powershell.exe`, else `cmd.exe`? (matches VSCode).
5. **Should we expose the terminal to the SDK / MCP** so external integrators can drive it? Recommended: **no** for MVP; agents should keep using the sandbox-exec tool.
