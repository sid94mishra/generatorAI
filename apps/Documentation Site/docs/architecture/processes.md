---
title: Processes and native resources
description: What runs in the server, Electron, provider processes, and optional host applications.
---

# Processes and native resources

GeneratorAI contains several process-host implementations. Their presence in `apps/` does not mean every deployment starts all of them. The actual runtime is selected by the composition root and client platform.

## Current process topology

| Resource | Default/live path | Alternative or incomplete path |
| --- | --- | --- |
| API and domain services | Node server; desktop manages its embedded server lifecycle | Headless server or ACP entry point |
| Agent adapter routing | In-process `MultiHarness` with external provider runtimes as needed | `GENERATORAI_AGENT_HOST=true` plus built agent-host; currently bypasses full multi-provider routing |
| Desktop browser | Electron `NativeBrowserHost` owns WebContentsViews; server `ElectronBridgeAdapter` drives the attached tab | Server Playwright fallback |
| Browser without desktop | `ServerPlaywrightHost` in the server's capability layer | Standalone `apps/browser-host` implementation is not selected by the current composition root |
| Terminal | `NodePtyHost`, with a degraded child-process fallback | Opt-in `PtyHostAdapter` / `apps/pty-host`; sandbox PTY when explicitly requested and available |
| Computer use | `CuaDriverBridge` plus consent and null fallback | Standalone `apps/cua-host` is not the current live bridge |
| Speech | VoiceService, worker pool and selected engine; some engine paths use external runtime | Disabled engines or fallback cascade |
| Remote relay | Optional separate relay director/cell | Direct loopback/LAN access |

This table corrects architecture proposals that describe a fully split control plane as if it were already the default. Current source retains in-process paths deliberately.

## Agent host

`HostSupervisor` in core forks `apps/agent-host`, validates the protocol/build hello, correlates requests, captures errors, and restarts recoverable exits within a bounded budget. Restart is capped at five attempts within a minute; missing modules, syntax errors, or invalid executable permissions can be classified as unrecoverable instead of retried indefinitely.

The host owns provider handles through `AgentHostServer`. `SessionQueue` serializes work per session, `BoundedSemaphore` controls shared capacity, `SessionDemux` routes events, and `RuntimeSupervisor` can replace an aged or high-memory runtime. Parent liveness checks prevent cooperative child processes surviving a dead parent indefinitely.

This mode remains opt-in because it does not currently carry the entire MultiHarness instance-routing/ownership graph. It should be exercised with restart-mid-turn scenarios before being treated as equivalent to the default path.

## PTY host and fallback

`TerminalService` chooses an available terminal host. The optional `PtyHostAdapter` waits for host readiness, so a terminal created during startup does not arbitrarily land on another backend. If the host build is absent or startup fails, the server logs the fallback.

`PtyHostServer` owns `node-pty` sessions; `PtySession` and `HeadlessTerminalModel` preserve terminal state. Spawned shells receive a controlled environment rather than a clone of server credentials. The normal fallback `NodePtyHost` provides a real PTY inside the server process. `FallbackChildProcessHost` provides degraded shell execution when native PTY support is unavailable; it is not identical to a fully interactive terminal.

Terminal resources belong to a workspace, and their working directory resolves to its primary mount. They must be released before the workspace tree is removed.

## Browser paths

The desktop browser manager is `apps/desktop/src/main/browser-host.ts`, not the similarly named standalone application directory. It creates native browser views with hardened web preferences and navigation/popup handling. The server receives a scoped browser endpoint through the internal bridge so agent actions and the human's native browser tab target the same session.

`ServerPlaywrightHost` supplies the non-desktop implementation. `BrowserService` owns workspace-scoped lifecycle, capacity limits, action policies and artifacts. Its teardown is registered with WorkspaceManager.

`apps/browser-host` contains a forked Chromium-host server and IPC contract. The current server composition root does not instantiate a BrowserHostSupervisor for it; document it as an available implementation/prototype boundary, not a default deployment promise.

## Computer-use paths

`ComputerService` owns consent, audit, configuration, resource lifecycle, and the bridge chain. `CuaDriverBridge` can attach to a desktop-pushed endpoint or configured socket, spawn the available driver runtime, or use its supported fallback path. `NullComputerBridge` returns a typed unavailable/refusal result when no usable backend exists.

The standalone `CuaHostServer` has its own typed IPC implementation and connection descriptor. Its source explicitly records that fused action/settle/capture optimization is not implemented and its current capture path makes multiple driver calls. It is not the live bridge simply because its package builds successfully.

OS permissions and an interactive desktop session remain prerequisites for actual capture/control. The existence of a computer-use button or provider capability does not supply those permissions.

## Process isolation versus execution sandbox

`DockerSandboxProvider` integrates with the `docker sandbox` CLI when available and configured. `HostProcessSandboxProvider` is a fallback that executes directly on the host in selected working directories and explicitly reports **no hypervisor isolation**.

Separately, providers such as Codex have their own sandbox/approval options. These mechanisms are not interchangeable:

- A source worktree isolates changes from the user's current checkout.
- A child host isolates resource ownership and some failure modes.
- An execution sandbox restricts what a process can access.
- Tool/consent policy determines whether an action is permitted.

Inspect the effective backend and policy rather than inferring protection from the class name “sandbox.”

## Ordered resource teardown

Workspace teardown has two phases: `native` then `storage`. Browser sessions, PTYs, and computer-use sessions must close before derived files/rows and the workspace directory are removed. Archive also releases native resources.

If directory removal fails, WorkspaceManager preserves the database row and reports a `WorkspaceTreeBusyError`, keeping the leftover tree discoverable and retryable. Deleting metadata first would orphan the remaining directory permanently.

Server shutdown also stops providers, host processes, workers, timers and relay connections, and flushes durable writes. Host protocol/build checks detect mismatched stale build outputs before they become obscure runtime errors.

## Source evidence

`apps/server/src/composition-root.ts`; `packages/core/src/infrastructure/HostSupervisor.ts`; `packages/shared/src/protocol/hostProtocol.ts`; `packages/shared/src/ipc/`; all four host applications' `src/`; `apps/desktop/src/main/browser-host.ts`; `packages/core/src/services/TerminalService.ts`, `BrowserService.ts`, `ComputerService.ts`, and `WorkspaceManager.ts`.

Related: [Security](./security.md), [Workspaces](./workspaces.md), and [Voice and observability](./voice-and-observability.md).
