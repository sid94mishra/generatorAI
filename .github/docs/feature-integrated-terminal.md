# Feature: Integrated Terminal

> A **workspace-scoped PTY session** with an xterm.js front-end. Real shell (`pwsh` / `bash` / `zsh` / `cmd`) running on the server host (or, opt-in Phase 2, inside a run's docker sandbox). Live IO over a dedicated WebSocket; scrollback and reload survive across the SPA's lifetime.

Prerequisites in your head: [feature-workspaces-files.md](./feature-workspaces-files.md), [feature-streaming-events.md](./feature-streaming-events.md), [feature-integrated-browser.md](./feature-integrated-browser.md) (the terminal borrows its topology).

---

## 1. What a "terminal session" is

A running PTY on the server, keyed by an opaque `sid`, owned by an [`ExecutionWorkspace`](./feature-workspaces-files.md#2-entities). The same session is:

- **Rendered live** in the right pane of the Chat or Workflow Run page via xterm.js (WebGL renderer + Fit + WebLinks + Search addons).
- **User-driven only** in MVP. The agent does not type into user terminals — it goes through the existing sandbox-exec tool path. Agent-typed commands with per-command confirm are a Phase 2 opt-in (see the internal terminal Phase 2 plan).
- **Ephemeral** by design — sessions live in an in-memory `Map<sid, TerminalRecord>` on the server; server restart wipes them. Matches the Browser session model.
- **Multi-tab** — up to 5 concurrent sessions per workspace, 20 server-wide (both env-tunable).

Four host implementations exist behind the `ITerminalHost` port. `TerminalService.selectHost()` takes the first host that (a) `canServe()` this particular spawn and (b) `isAvailable()` — awaiting `whenReady()` for a host that is still starting, so a terminal opened during boot lands on the same host as one opened a second later:

| Host | When it's picked | Semantics |
|---|---|---|
| `SandboxPtyHost` *(Phase 2, opt-in)* | Workflow-run page + docker sandbox present + `attachToSandbox: true` in spawn body — gated by `canServe()`, **not** `isAvailable()` (which takes no arguments, cannot see the spawn options, and reports true whenever docker is on PATH) | `docker exec -it <sandboxName> …` wrapped in a host-side `node-pty` so xterm sees an outer PTY. |
| `PtyHostAdapter` *(opt-in, `GENERATORAI_PTY_HOST=true`)* | The `apps/pty-host` child process has acknowledged readiness and has not exhausted its restart budget | Real PTY, but every file descriptor lives in a separate process (L5). Adds credit flow control and a headless VT model. If the host dies, live sessions get a synthesised `exit` (`SIGHUP`); if it exhausts its restart budget, the adapter reports unavailable and selection falls through to `NodePtyHost`. |
| `NodePtyHost` *(default)* | `node-pty` native module loads (Win/mac/Linux glibc) | Real PTY — `vim`, `htop`, colors, cursor addressing, alternate-screen buffer all work. |
| `FallbackChildProcessHost` | Everything above unavailable (musl Linux, native build failed) | Plain `child_process.spawn` — line-buffered, no color/cursor. UI shows a yellow *"Fallback mode"* banner in the header. |

---

## 2. Data model (nothing in the DB)

The terminal is deliberately **ephemeral**. There is *no* `terminal_sessions` table.

- **Session registry**: in-memory `Map<sid, TerminalRecord>` inside `TerminalService`. Cleared on server restart.
- **Scrollback**: in-memory ring buffer, default 4 MiB (~10 000 lines) per session. Older bytes are trimmed on append.
- **Lifecycle events**: fanned out through the unified `EventBus` under a synthetic session id `terminal:<workspaceId>` — same pattern the Browser uses, so SPA clients can subscribe via `/api/stream?scope=session&id=terminal:<workspaceId>`.

Phase 2 will add optional DB-backed persistence (behind `GENERATORAI_TERMINAL_PERSIST=1`). Ephemeral remains the default.

---

## 3. Server architecture

```
apps/server/src/routes/terminals.ts    REST verbs (create / list / describe / scrollback / resize / signal / delete)
apps/server/src/terminal-ws.ts         WS: /api/workspaces/:id/terminals/:sid/stream
             │
             ▼
packages/core/src/services/TerminalService.ts
             │  owns  Map<sid, TerminalRecord>
             │  emits terminal.* events on EventBus
             │  runs  the idle reaper + workspace-cleanup hook
             │
             ▼
packages/core/src/domain/ports/ITerminalHost.ts
             │
             ├── infrastructure/terminal/NodePtyHost.ts               (default)
             ├── infrastructure/terminal/SandboxPtyHost.ts            (Phase 2)
             └── infrastructure/terminal/FallbackChildProcessHost.ts  (last resort)
```

### `TerminalService`

- **`spawn({ workspaceId, cols?, rows?, shell?, attachToSandbox?, runId? })`** — enforces caps (per-workspace 5, global 20; overflow returns HTTP 429), resolves `cwd` from the workspace exposure (the primary mount — the same directory the agent works in; the managed root only when the chat has no mounts), delegates to the first available host, wires `onData`/`onExit` → ring buffer + fanout.
- **Idle reaper** — a `setInterval` (60 s default) kills sessions where `wsCount === 0` **and** `now - lastActivityAt > TERMINAL_IDLE_TTL_MS` (default 30 min). `lastActivityAt` bumps on CLIENT activity (attach/detach, input, resize, ACK) — **not** on PTY output, since a process printing into a terminal nobody is watching is not evidence that a human is present (P1-38).
- **`kill(sid, reason)`** — sets `closeReason` for the outgoing SSE, then `handle.kill()`, then drops the record after a short drain window.
- **`killAllForWorkspace(workspaceId, reason?)`** — invoked by `WorkspaceManager.registerBeforeDelete` so PTYs never outlive a deleted workspace.
- **Session-owned watermark (P1-28)** — the watermark lives on the SESSION, not on a WebSocket. `attachViewer(sid)` hands each connection its own ack cursor; outstanding work is `emitted - min(acked across viewers)`, so the **slowest attached viewer governs** and the service — never the transport — calls `handle.pause() / resume()` (real OS-level XOFF). A viewer that attaches mid-stream starts caught up; one that leaves stops holding the session back; with nobody attached there is nothing to wait for and the PTY is never paused. There is no public `pause`/`resume` on the service any more.
- **Host credit (P0-23)** — a second, deliberately *unchained* loop: `handle.ack(n)` returns credit to the out-of-process pty-host the moment the gateway takes the bytes. The host's own low watermark (5 000 chars) sits far below the client's 64 KiB ack batch, so making host credit wait on a viewer would wedge a terminal on the tail of the last partial batch. In-process hosts do not implement `ack` — they hold the PTY directly and have nothing to credit.

### REST endpoints (`/api/workspaces/:id/terminals`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/` | Spawn a new session; body `{ cols?, rows?, shell?, attachToSandbox?, runId? }`; returns full `TerminalSessionDescriptor` |
| `GET`  | `/` | List active sessions for this workspace (excludes exited) |
| `GET`  | `/:sid` | Descriptor (`pid`, `cwd`, `shell`, `host`, `exitCode`, `lastActivityAt`, …) |
| `GET`  | `/:sid/scrollback?tailBytes=N` | Raw PTY bytes for reconnect replay (`application/octet-stream`) |
| `GET`  | `/:sid/scrollback?format=text&tailLines=N` | Rendered lines from the host's headless VT model (`{ lines: string[] }`) — bounded at O(lines × columns) however much the command printed. **409** on a host that keeps no VT model; today only the out-of-process pty-host does. |
| `POST` | `/:sid/resize` | `{ cols, rows }` |
| `POST` | `/:sid/signal` | `{ name: 'SIGINT' \| 'SIGTERM' \| … }`; best-effort on Windows |
| `DELETE` | `/:sid` | Kill (idempotent — DELETE of an unknown sid returns 204) |

**Feature-flag gate**: every route returns HTTP 501 when `GENERATORAI_TERMINAL=0`. Default is on.

### WebSocket transport (`/api/workspaces/:id/terminals/:sid/stream`)

Registered via `noServer: true` in [apps/server/src/terminal-ws.ts](../../apps/server/src/terminal-ws.ts). Sits next to the browser WS on the same HTTP server.

**Server → client**:

- **Binary WS frames** = raw PTY bytes. Fed straight into `xterm.write(bytes, ackCallback)`.
- **JSON control frames**:

  ```
  { t: 'ready',   descriptor }           // sent once on connect
  { t: 'exit',    code, signal? }        // PTY exited
  { t: 'resized', cols, rows }           // resize acknowledged
  { t: 'error',   message }              // out-of-band error
  ```

**Client → server (JSON only)**:

```
{ t: 'input',  data: string }
{ t: 'resize', cols: number, rows: number }
{ t: 'ack',    bytes: number }        // watermark ACK
{ t: 'signal', name: string }
{ t: 'kill'   }                       // reliable "kill this session" (survives DELETE-fetch aborts on unmount)
```

### Flow control (watermark + circuit breaker)

Two independent guards, both defensive:

- **Watermark (per SESSION, not per connection)**: `TerminalService` tracks bytes emitted against each attached viewer's ack cursor. Once the slowest viewer is `GENERATORAI_TERMINAL_HIGH_WATERMARK_BYTES` (default 256 KiB) behind, `handle.pause()` (OS-level XOFF); it resumes at `GENERATORAI_TERMINAL_LOW_WATERMARK_BYTES` (default 64 KiB). The client ACKs from **inside** `term.write(bytes, onParsed)`, so credit reflects what the terminal has parsed rather than what TCP delivered, batched at ~64 KiB — which is why the low watermark must stay **≥ the client's ack batch size**, or the tail of the last partial batch is never acked and the session never resumes.
  This was previously per-WebSocket while acting on the *shared* PTY, so two viewers oscillated against each other and neither one's bound was actually enforced (P1-28).
- **`ws.bufferedAmount` circuit breaker**: genuinely per-connection — `bufferedAmount` is a property of one socket. Above 1 MB (stalled TCP window) the connection reports a **stall** into the session watermark rather than pausing the PTY itself, so it is arbitrated alongside every other viewer; cleared at half the threshold.

Server also **coalesces** PTY chunks with `setImmediate` and flushes every ~4 ms, up to 32 KB per WS frame — 4–10× fewer WS frames on log-heavy output with imperceptible latency cost.

### Security controls (all on the WS upgrade path, before `handleUpgrade`)

| Control | What it blocks |
|---|---|
| **`GENERATORAI_TERMINAL=0` feature flag** | Full kill-switch — upgrade destroyed. |
| **API-key auth** (`x-generatorai-token` / `?apiKey` / `Authorization: Bearer`) | Anyone without the token when `GENERATORAI_API_KEY` is set. Loopback fallback when unset. |
| **Origin allowlist** | Cross-origin requests. Only `localhost`, `127.0.0.1`, `::1`, plus `CORS_ORIGINS` entries. Electron's `Origin: null` accepted only for loopback. |
| **Workspace scoping** | Any URL not matching `/api/workspaces/:id/terminals/:sid/stream` with an existing session. |
| **Input rate limit** | 200 msgs/sec sliding window per WS. Excess dropped silently. |
| **Session caps** | 5/workspace, 20/server → HTTP 429. |

---

## 4. Host adapters (`ITerminalHost`)

### `NodePtyHost`

Located at [packages/core/src/infrastructure/terminal/NodePtyHost.ts](../../packages/core/src/infrastructure/terminal/NodePtyHost.ts). Loads `node-pty` lazily via `createRequire(import.meta.url)` so ESM builds resolve the native module correctly; on failure logs a warning and reports `isAvailable() === false`.

- **Shell resolution** (Windows cascade): `%ProgramFiles%\PowerShell\7\pwsh.exe` → `%ProgramFiles(x86)%\PowerShell\7\pwsh.exe` → `%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe` → `cmd.exe`. POSIX: `$SHELL ?? /bin/bash`.
- **PowerShell profile skip**: `-NoLogo -NoProfile` injected by default (fast startup); opt-in via `GENERATORAI_TERMINAL_PWSH_PROFILE=1` (or Settings toggle).
- **Env sanitisation** (see `buildEnv`):
  - **Always stripped**: `NODE_OPTIONS`, `LD_PRELOAD`, `ELECTRON_RUN_AS_NODE`, `GENERATORAI_TOKEN`, `GENERATORAI_API_KEY`, `DATABASE_URL`, prefixes `DYLD_` + `GENERATORAI_` (except a small allowlist).
  - **Opt-in strip** (default ON): `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. Flip via `GENERATORAI_TERMINAL_ALLOW_SECRETS=1` or Settings toggle.
  - **Injected**: `TERM=xterm-256color`, `COLORTERM=truecolor`, `GENERATORAI_WORKSPACE_ID=<uuid>`. POSIX also gets a cyan `[genai] \w $` `PS1` when the user's env didn't already define one.

### `SandboxPtyHost` *(Phase 2, opt-in)*

Located at [packages/core/src/infrastructure/terminal/SandboxPtyHost.ts](../../packages/core/src/infrastructure/terminal/SandboxPtyHost.ts). Delegates to `NodePtyHost` internally to spawn:

```
docker exec -it <sandboxName> /bin/sh -lc 'exec bash -l 2>/dev/null || exec sh -l'
```

The outer `node-pty` provides the host-side PTY that xterm sees; the `-t` flag hands the container a nested PTY so the shell inside sees a real terminal.

**Availability requires**: `node-pty` loaded, `docker` on PATH, `SandboxLifecycleManager.getSession(runId)` returns a session. Callers must set `attachToSandbox: true` **and** `runId` in the spawn body.

### `FallbackChildProcessHost`

Plain `child_process.spawn(shell, ['-i'])` with piped stdio. Reports `host: 'fallback-child-process'` in the descriptor. Emits a one-line banner into the output stream at spawn:

```
[GeneratorAI] Fallback terminal — full PTY features (colors, vim, htop) are unavailable.
```

Selected when `node-pty` fails to load (Alpine Linux, missing native toolchain, etc.).

---

## 5. Frontend (SPA)

**Right-pane tab** in `RightPane` — same tabbed dock the Browser lives in:

- **Chat page** — Terminal is an add-able tab (`+` menu). `allowMultiple: true` — multiple terminals per workspace supported from day one.
- **Workflow Run page** — same, plus a header **`[cd ▾]`** dropdown listing the run's worktrees so users can jump into `source/<alias>` with one click.

**Component**: [apps/web/src/components/terminal/TerminalPanel.tsx](../../apps/web/src/components/terminal/TerminalPanel.tsx).

**Header layout**:

```
[🖥️] cwd-pill  [pty|sandbox|fallback badge]  [agent ⚡]     [cd ▾] [✈ Attach] [🔍] [🧽 Clear] [🗑 Kill]
```

- **cwd pill** — shortened path, tooltip shows the full one.
- **Host badge** — `pty` (green-ish) / `sandbox` (purple ring) / `fallback` (yellow banner).
- **`agent ⚡`** — visible while `agentBusy === true` (a chat/stage turn is in flight); purely informational.
- **`[cd ▾]`** (workflow-run only) — dropdown listing every worktree; clicking types `cd "<abs path>"\r` into the shell.
- **`[✈ Attach]`** — attaches the current xterm mouse-selection to the chat's `pendingCaptures` (a `text/plain` File). Button turns primary-coloured when a selection exists. Empty-selection click shows a *"Select text first"* toast; success shows *"Attached to chat (N bytes)"*.
- **`[🔍]`** — opens an inline VSCode-style search bar in the terminal viewport. Ctrl/⌘+F also opens it (intercepted before xterm hands the keystroke to the shell). Live incremental highlight-as-you-type, Enter = next, Shift+Enter = previous, Esc = close and return focus to xterm.
- **`[🧽 Clear]`** — clears the visible scrollback + any active search decorations.
- **`[🗑 Kill]`** — `DELETE /:sid`. Fires an in-terminal exit banner via the WS.

**Persistent pending-capture banner** above `ChatInput`:

```
📎 1 capture pending — will attach to the next message.    Clear
```

Rendered once at the ChatPage level so it's visible regardless of which right-pane tab is active. Consumed on the next `customSendFn` call — attachments are merged and `pendingCaptures` clears.

### Lifecycle inside the panel

```
Mount
 ├── new Xterm({ scrollback: 5000, WebGL, WebLinks, Search, Fit })
 ├── sessionInitStarted guard  (React StrictMode double-mount protection)
 ├── Cached sid in localStorage:generatorai:terminal:<workspaceId>:<tabId>?
 │     yes → HEAD /:sid (validate not exited) → reuse
 │     no  → POST /terminals → cache new sid
 ├── GET /:sid/scrollback → term.write(bytes)     (replay history)
 ├── Open WS
 │     onOpen: send initial { t:'resize', cols, rows }
 │     term.onData → send { t:'input', data }
 │     term.onResize → send { t:'resize', cols, rows }
 │     ws.onmessage(binary) → term.write(bytes, ackCallback)
 │     ws.onmessage(json)   → dispatch ready / exit / resized / error
 └── ResizeObserver on container → fit.fit()  (RightPane drag re-flow)

Unmount / tab close
 ├── WS.send({ t: 'kill' })         ← reliable path; survives DELETE-fetch aborts
 ├── DELETE /:sid                   (best-effort backup)
 └── localStorage.removeItem(sid key)
```

Two engineering details that carry the whole thing:

- **`sessionInitStarted` ref** — React StrictMode double-invokes effects in dev. Without this guard, mount would `POST /terminals` twice per tab and leak a session. The ref survives the immediate unmount/remount cycle because it lives on the fiber, not per-effect.
- **`{ t: 'kill' }` WS message** — Vite's dev proxy sometimes aborts the in-flight `DELETE` with `net::ERR_ABORTED` when the tab is closed. Sending a WS text frame right before `ws.close()` reaches the server reliably; the server calls `terminalService.kill(sid)` before the socket fully drains.

**Settings** ([Settings → Integrated Terminal](./usage-web.md#10-settings) card):

- **Default shell** — free-form text; blank = platform default.
- **Load PowerShell profile** — off by default (fast).
- **Allow SSH_AUTH_SOCK / AWS session tokens** — off by default (safe).

All three persist to localStorage keys `generatorai:terminal:{shell|loadPwshProfile|allowSecrets}`. Changes apply the next time you open a Terminal tab.

---

## 6. Event flow (SSE + WS combined)

```
User types 'l' in xterm
   └── SPA WS.send({ t:'input', data:'l' })
           └── terminal-ws.ts → serial inputChain
                   └── terminalService.input(sid, 'l')
                           └── handle.write('l')
                                   └── node-pty → ConPTY/forkpty → shell
                                                                     │
Shell echoes 'l' → node-pty onData → handle emits 'data'             │
                                                                     ▼
   TerminalService: append to ring buffer, bump lastActivityAt,
     fan-out to attached WS listeners
           └── terminal-ws.ts: ws.send(chunk, { binary: true }),
                                unackedBytes += chunk.length
                                (pause if crossed HIGH watermark)

TerminalService.spawn(...)
   └── emit EventBus scope=`terminal:<wsId>`  kind='terminal.session_created'
```

Event kinds published by `TerminalService` (all under `terminal.*` in [`AgentEvent`](../../packages/shared/src/types/AgentEvent.ts)):

| Kind | When |
|---|---|
| `terminal.session_created` | Immediately after `handle` is registered. Carries `host`, `pid`, `cwd`, `shell`, `sessionId`. |
| `terminal.session_closed`  | When the PTY exits (user typed `exit`, kill signal, workspace deleted, sandbox destroyed, idle-reap). Carries `code`, `signal?`, `reason?`. |
| `terminal.session_resized` | Every accepted resize. Carries `cols`, `rows`. |

Raw output bytes are **not** in SSE — they'd blow up the event store. They live on the dedicated WS.

The SPA subscribes to `scope=session&id=terminal:<workspaceId>` when it wants tab-lifecycle notifications (e.g., auto-focus a new terminal when a workflow stage spawned one). For live output the SPA uses the WS directly.

---

## 7. Lifecycle guarantees (invariants)

1. **Session ownership** — every session belongs to exactly one workspace; deleting the workspace kills the session (`WorkspaceManager.registerBeforeDelete`).
2. **Ephemeral by default** — server restart terminates all PTYs and drops the registry. Client localStorage `sid`s become stale and are cleaned up on the next `HEAD /:sid` (404 → forget).
3. **Ordering** — per-session serial `inputChain` on the WS side prevents a race between rapid `resize` + `input`.
4. **Cleanup on tab close** — the WS `{ t: 'kill' }` message plus the `DELETE` fetch together guarantee no zombie PTYs even under aggressive Vite HMR aborts.
5. **StrictMode safe** — `sessionInitStarted` ref plus the post-POST `cancelled` check guarantee at most one PTY per (workspaceId, tabId) even under React double-mount.

Break any of these and users will see leaked pwsh processes in Task Manager.

---

## 8. CLI

There is no `generatorai terminal …` CLI command. The terminal is a graphical feature bound to xterm.js. If you need programmatic shell access from a script, use `IScriptRunner` (via a hook) or a plain `child_process.spawn`.

---

## 9. Edge cases & gotchas

- **`node-pty` failed to load** — the composition-root wiring silently degrades to `FallbackChildProcessHost`. The SPA panel renders a yellow banner *"Fallback shell — full-screen apps (vim, htop) will not render correctly. Install `node-pty` for a proper PTY."* Real fix: ensure the `node-pty` prebuild for the current OS/arch is present under `packages/core/node_modules/node-pty/prebuilds/` (added as `optionalDependencies` on `@generatorai/core` so pnpm links it correctly).
- **Two Terminal tabs on the same chat** — each has its own `tabId` (from `RightPane.render(ctx)`), its own localStorage sid key, its own PTY. Closing one does not affect the other.
- **Workflow-run page terminal even when the run is sandboxed** — MVP always runs on the **host** in the workspace root, not inside the sandbox. Users see a distinct execution surface from the agent's sandboxed code. Phase 2 adds an opt-in *"Sandbox attached"* toggle.
- **Windows PowerShell profile is slow** — off by default. If you need it, flip the Settings toggle.
- **Sensitive env leakage** — the default env stripper hides `SSH_AUTH_SOCK` and AWS tokens even on trusted hosts. Enable per-workspace via Settings only when you actually need SSH-key forwarding.
- **`yes | head -n 500000` stress test** — verified: watermark + `bufferedAmount` circuit-breaker keep xterm responsive (input echo < 50 ms during flood), memory bounded. See `agent-tests/terminal-ws-smoke.mjs` for the harness.

---

## 10. Files to know

- **Types + WS frames**: [packages/shared/src/types/Terminal.ts](../../packages/shared/src/types/Terminal.ts)
- **Event kinds**: `terminal.*` variants in [packages/shared/src/types/AgentEvent.ts](../../packages/shared/src/types/AgentEvent.ts)
- **Service**: [packages/core/src/services/TerminalService.ts](../../packages/core/src/services/TerminalService.ts)
- **Port**: [packages/core/src/domain/ports/ITerminalHost.ts](../../packages/core/src/domain/ports/ITerminalHost.ts)
- **Hosts**: [packages/core/src/infrastructure/terminal/](../../packages/core/src/infrastructure/terminal/)
- **REST**: [apps/server/src/routes/terminals.ts](../../apps/server/src/routes/terminals.ts)
- **WS**: [apps/server/src/terminal-ws.ts](../../apps/server/src/terminal-ws.ts)
- **SPA panel**: [apps/web/src/components/terminal/TerminalPanel.tsx](../../apps/web/src/components/terminal/TerminalPanel.tsx)
- **Right-pane wiring**: `terminal` tab kind in [apps/web/src/pages/ChatPage.tsx](../../apps/web/src/pages/ChatPage.tsx) + [apps/web/src/pages/WorkflowRunPageV2.tsx](../../apps/web/src/pages/WorkflowRunPageV2.tsx)
- **Composition root wiring**: [apps/server/src/composition-root.ts](../../apps/server/src/composition-root.ts) (search for `terminalService`)
- **Smoke tests**: `agent-tests/terminal-ws-smoke.mjs`, `agent-tests/terminal-desktop-smoke.mjs`
- **Phase 2 plan**: tracked internally; not part of the published docs.

For the sibling surface see: [feature-integrated-browser.md](./feature-integrated-browser.md).
