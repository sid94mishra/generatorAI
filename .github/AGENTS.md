# GeneratorAI — AGENTS.md

> **Audience:** AI coding agents (Claude, Copilot, GPT, Gemini, …) and human contributors who want a single, comprehensive entry point into the GeneratorAI codebase.
>
> **Purpose:** This file is the canonical onboarding map for the repository. Read it first, then drill into the linked feature/module docs under [.github/docs/](./docs/). Everything is current as of repo state circa 2026-06.

---

## 1. What GeneratorAI is

GeneratorAI is a **TypeScript monorepo** for building, running and observing AI agent workloads. It supports three top-level "execution objects":

| Object | What it is | Real-time? |
|---|---|---|
| **Chat** | A single long-lived conversation against a provider (Copilot SDK / Claude Agent SDK) with optional project + codebase context. | Yes — SSE stream of tokens, tool calls, thinking blocks. |
| **Workflow Run** | One execution of a multi-stage **DAG workflow definition**, with conditional edges, retries, hooks, HITL gates and artifacts. | Yes — SSE per run + per stage. |
| **Automation** | A scheduled / webhook-triggered / manual trigger that fans out into multiple workflow runs (single / loop / batch / data-source-driven). | Yes — SSE per automation execution + per nested run. |

All three are observed through the **same unified SSE endpoint** (`GET /api/stream?scope=…&id=…`) with `Last-Event-ID` resume and REST replay fallback.

Underlying everything is the **Agent Harness** abstraction (`IAgentHarness`), a port that hides whether the model lives behind GitHub Copilot CLI or Anthropic Claude Code CLI. Providers are runtime-switchable via `HarnessProxy`.

Layered on top, the runtime is **extensible without a rebuild**. Hot-loadable [extensions](./docs/feature-extensions-widgets.md) contribute widgets (sandboxed HTML surfaces the agent renders on the canvas / chat / right-pane), tools, skills, prompts, and hooks. The agent can even author new extensions from a chat prompt via built-in `write_extension` / `render_widget` / `read_widget` tools — the same primitives external contributors use.

---

## 2. Repository map

```
GeneratorAI/
├── apps/
│   ├── server/        Express API + composition root + SSE + OpenAPI
│   ├── web/           React 19 SPA (Vite, Tailwind 4, TanStack Query, Zustand, React Flow)
│   ├── cli/           Commander.js + Ink TUI, ships single binary `generatorai`
│   └── desktop/       Electron app — embeds the server + web SPA (full parity)
├── packages/
│   ├── shared/        Zod schemas, types, errors, logger, telemetry, builders
│   ├── core/          Domain (entities, ports, state machines, DAG) + services + infra adapters
│   ├── db/            Drizzle ORM + SQLite, ~25 repositories, migrations v1..v8
│   ├── agent-harness-providers/  CopilotProvider + ClaudeAgentProvider + HarnessProxy
│   ├── sdk/           Programmatic API: `createGeneratorAI()` + facades (chat/workflows/automations/events/scripts/tools)
│   └── mcp-server/    MCP tool adapter
├── templates/
│   ├── *.json                       v1 templates (legacy)
│   ├── system/*.json                v2 system DAG templates (5 built-ins)
│   ├── system/mcp-servers.json      System MCP registry
│   ├── system/artifacts/            System skills / agents / prompts (incl. `extension-author` skill)
│   ├── system/extensions/           System-scope extensions (loaded read-only at boot)
│   ├── scripts/*.workflow.mjs       Programmatic Workflow Scripts (PWS)
│   └── data-source-scripts/         Automation data source helpers (py/sh/js)
├── docs/CLI_SURFACE_SNAPSHOT.md     Generated from the CLI registry; diffed by CI
├── oldDocs/                         Superseded internal planning + audit notes.
│                                    NOT tracked (see .gitignore) and not published —
│                                    several name unfixed weaknesses in specific files.
├── agent-tests/                     Playwright E2E + helpers + feature catalog
├── docker/                          Sandbox + observability compose
├── scripts/db-backup.ts             Maintenance scripts
└── .github/
    ├── AGENTS.md                    ← this file
    └── docs/                        ← per-feature deep-dives (start here after AGENTS.md)
```

### Where to read what

| Topic | File |
|---|---|
| **Top-level architecture, layered model, dependency rules** | [docs/architecture.md](./docs/architecture.md) |
| **Every package** (shared, core, db, sdk, agent-harness-providers, mcp-server) | [docs/packages.md](./docs/packages.md) |
| **Every app** (server, web, cli, desktop) | [docs/apps.md](./docs/apps.md) |
| **Chat feature** lifecycle, configs, edge cases | [docs/feature-chat.md](./docs/feature-chat.md) |
| **Workflow definitions** (CRUD, builder, validation, templates) | [docs/feature-workflows.md](./docs/feature-workflows.md) |
| **Stage definitions** (every config / option / edge case) | [docs/feature-stages.md](./docs/feature-stages.md) |
| **Workflow runs** (state machine, DAG scheduling, profiles, HITL, retries, validation, predecessor summaries) | [docs/feature-workflow-runs.md](./docs/feature-workflow-runs.md) |
| **Automations** (triggers, input modes, data sources, concurrency, error policy) | [docs/feature-automations.md](./docs/feature-automations.md) |
| **Projects + codebases** (git-remote / git-local / local-dir, link / fetch / branches / files) | [docs/feature-projects-codebases.md](./docs/feature-projects-codebases.md) |
| **Workspaces + file management** (execution workspaces, worktrees, artifacts at run/stage/project/global level) | [docs/feature-workspaces-files.md](./docs/feature-workspaces-files.md) |
| **Integrated Browser** (workspace-scoped Chromium: WebSocket JPEG stream, viewport auto-matches the panel, click-through + typing, live scroll indicator, inspector, share/attach, VSCode-parity panel) | [docs/feature-integrated-browser.md](./docs/feature-integrated-browser.md) |
| **Integrated Terminal** (workspace-scoped PTY: xterm.js, WebSocket transport, watermark flow control, multi-tab) | [docs/feature-integrated-terminal.md](./docs/feature-integrated-terminal.md) |
| **Extensions & Widgets** (hot-loadable extensions contributing UI/tools/skills; sandboxed widget iframes on the canvas / chat / right-pane; `render_widget` / `update_widget` / `read_widget` tools; `write_extension` for LLM-authored extensions) | [docs/feature-extensions-widgets.md](./docs/feature-extensions-widgets.md) |
| **Hooks** (22 phases × 3 types × failure policies, HookBridge HKS-01) | [docs/feature-hooks.md](./docs/feature-hooks.md) |
| **Skills / custom agents / prompts / MCP servers** (per-stage selection, project vs system scope) | [docs/feature-skills-agents-mcp.md](./docs/feature-skills-agents-mcp.md) |
| **Templates + Programmatic Workflow Scripts** (`.workflow.mjs`, profiles, materialize) | [docs/feature-templates-scripts.md](./docs/feature-templates-scripts.md) |
| **Streaming + events** (SSE, StreamBroker, EventBus, durability) | [docs/feature-streaming-events.md](./docs/feature-streaming-events.md) |
| **SDK usage** (`@generatorai/sdk` for external integrators) | [docs/usage-sdk.md](./docs/usage-sdk.md) |
| **CLI usage** (every command + TUI) | [docs/usage-cli.md](./docs/usage-cli.md) |
| **Web UI usage** (every page + dialog + setting) | [docs/usage-web.md](./docs/usage-web.md) |
| **Build / deploy / env vars / troubleshooting** | [docs/operations.md](./docs/operations.md) |

---

## 3. Mental model in 60 seconds

```
PRESENTATION    apps/web   apps/cli   apps/server (routes)
       ↓ depends on
APPLICATION     packages/core/src/services         ← ChatService, WorkflowRunService, StageExecutionService, DAGScheduler, …
       ↓ depends on
DOMAIN          packages/core/src/domain           ← entities, ports, DAGValidator, state machines (pure TS, zero infra deps)
       ↓ adapts
INFRASTRUCTURE  packages/db (Drizzle repos)
                packages/agent-harness-providers   (CopilotProvider, ClaudeAgentProvider, HarnessProxy)
                packages/core/src/infrastructure   (GitManager, SandboxScriptRunner, FetchHttpClient)
                packages/mcp-server                (MCP tool adapter)
```

Dependency rules (enforced by ESLint boundaries):

- **Presentation** may import Application + Shared. Never Domain/Infrastructure concrete types.
- **Application** may import Domain ports + Shared. Never SDKs or infra directly.
- **Domain** may import Shared types only. **Zero** external deps.
- **Infrastructure** implements Domain ports; may import Shared. Never Application or Presentation.

The single most important boundary is **`IAgentHarness`** ([packages/core/src/domain/ports/IAgentHarness.ts](../packages/core/src/domain/ports/IAgentHarness.ts)) — every service talks to it; SDKs (`@github/copilot-sdk`, `@anthropic-ai/claude-agent-sdk`) only ever appear inside [packages/agent-harness-providers/src/providers/](../packages/agent-harness-providers/src/providers/).

---

## 4. Core domain model (v2 — DAG-based)

```
Project ──< ProjectCodebase ──< Worktree (per run)
Project ──< ProjectConfig  (agents / prompts / skills / mcp)

WorkflowDefinition ──< StageDefinition ──< PromptDefinition
                  ╰─< StageEdge (on_success | on_failure | on_completion | always)
                  ╰─< VariableDefinition
                  ╰─< HookDefinition (workflow-scope phases)

WorkflowRun ──< StageRun ──── allocated Session (1:1 conversation with harness)
            ╰─ ExecutionWorkspace (chat | workflow_run | automation_execution)
                ├─< WorkspaceWorktree (one per linked codebase)
                ├─< WorkspaceArtifact (code_file | response_md | attachment | browser_screenshot | …)
                ├── BrowserSession  (0..1, resource attached via workspace.browser* columns — see feature-integrated-browser.md)
                └── TerminalSession[] (0..N, ephemeral in-memory only — see feature-integrated-terminal.md)

Automation ──< AutomationExecution ──< AutomationExecutionRun ──> WorkflowRun

Chat ── 1:1 ── Session ── ExecutionWorkspace (optional)
```

State machines (all pure, in [packages/core/src/domain/state-machines/](../packages/core/src/domain/state-machines/)):

- `SessionStateMachine` — created → starting → running ⇄ paused → cancelling → cancelled / completed / error
- `WorkflowRunStateMachine` — pending → starting → running ⇄ paused → completed / failed / cancelled
- `StageRunStateMachine` — pending → queued → running ⇄ paused / sleeping / awaiting_input → completed / failed / cancelled / skipped

Stage run also supports the durable states `sleeping` (DUR-05 `wake_at` timestamp) and `awaiting_input` (HITL-02 `interrupt_data` payload).

---

## 5. Critical invariants to preserve

If you change anything below, you will break user-visible behavior. Confirm tests pass and re-read the relevant feature doc first.

1. **No SDK types leak out of `packages/agent-harness-providers/`.** Core / services / routes / SDK facade must only see `IAgentHarness`, `AgentEvent`, `ConversationResponse`, `HarnessClientEvent`, `HarnessModel`. See [docs/packages.md](./docs/packages.md#agent-harness-providers).
2. **EventBus per-session promise queue** must remain sequential — concurrent emits would cause out-of-order SSE on the wire. See [docs/feature-streaming-events.md](./docs/feature-streaming-events.md).
3. **StreamBroker commit-then-broadcast** order — DB insert into `stream_cursors` must happen *before* in-memory broadcast so replay is always at least as new as live. See [docs/feature-streaming-events.md](./docs/feature-streaming-events.md).
4. **`sseManager` cross-buffer flush (apps/web/src/stores/sseManager.ts lines ~160–183)** is load-bearing for thinking↔token interleaving. Do not "simplify".
5. **DAG cache invalidation** is hash-based by stages + edges; if you mutate definitions out-of-band, call `dagScheduler.clearCache(definitionId)`.
6. **`acquireSseSlot()` release** must be called in `res.on('close')` for every SSE handler, otherwise the per-(scope,id) cap leaks.
7. **`workflow.useWorktree`** and `chat.useWorktree` default to `true` when a project is attached. If you skip worktree creation, `__workingDirectory` falls back to the workspace root.
8. **`harnessConfigOverrides.model`** is provider-specific. `gpt-5.4-mini` works on `copilot` only; `claude-sonnet-4-6` works on `claude-agent` only. Switching `HARNESS_TYPE` mid-deploy without scrubbing overrides will fail stages.
9. **`script` hooks** must use commands on the allowlist (`node`, `python`, `bash`, `git`, `echo`, `pwsh`, …). `cmd.exe` is *not* allowed. See [docs/feature-hooks.md](./docs/feature-hooks.md#hook-types).
10. **`function` hooks** require `hookExecutor.registerFunctionHandler(name, fn)` at boot. Built-in handlers are wired in [apps/server/src/composition-root.ts](../apps/server/src/composition-root.ts).
11. **3-level config resolution** order: WorkflowDefinition.harnessConfig → StageDefinition.harnessConfigOverrides → RunProfile / runtime overrides. The `ConfigResolver` deep-merges; do not bypass it.
12. **JSON columns** in DB are validated *symmetrically* (`validateJsonColumn` on write, `safeJsonColumn` on read). Adding a new JSON column without both will eventually corrupt the DB. See [docs/packages.md](./docs/packages.md#db).
13. **DB migrations** are append-only via the `_schema_versions` ledger. Never re-number an existing migration.
14. **Integrated Browser + Terminal are workspace-scoped resources.** Both hook into `WorkspaceManager.registerBeforeDelete` so their native processes (Chromium / PTY) never outlive a deleted workspace. If you touch workspace deletion, keep this hook alive. See [docs/feature-integrated-browser.md](./docs/feature-integrated-browser.md) + [docs/feature-integrated-terminal.md](./docs/feature-integrated-terminal.md).
15. **Browser + Terminal WebSockets share the HTTP server's `upgrade` event with the SSE endpoint.** Both use `WebSocketServer({ noServer: true })` and match on a path regex so multiple WS paths coexist. Any new WS route must follow the same `noServer` pattern — do **not** add a second `http.createServer` or a naked `WebSocketServer` bound to `/`.

---

## 6. How to run the app

```powershell
# 1. Install (only after pulling new commits)
pnpm install

# 2. Start everything in dev (web + server with hot reload)
pnpm dev

# Targeted dev
pnpm dev:server
pnpm dev:web

# 3. CLI
pnpm start:cli -- workflow list
# or after `pnpm --filter @generatorai/cli build`
node apps/cli/dist/index.js workflow list

# 4. Tests
pnpm test                                       # all
pnpm --filter @generatorai/core test            # one package
pnpm --filter @generatorai/web test             # vitest + jsdom
pnpm --filter agent-tests test                  # Playwright E2E

# 5. Lint / typecheck / format
pnpm lint
pnpm typecheck
pnpm format
```

Critical env vars (full list in [docs/operations.md](./docs/operations.md)):

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_PORT` | `3100` | API server port |
| `GENERATORAI_WEB_PORT` | `5173` | Vite dev port |
| `GENERATORAI_DB_PATH` | `~/.generatorai/data.db` | SQLite path |
| `GENERATORAI_WORKSPACES_DIR` | `~/.generatorai/workspaces` | Worktree + workspace root |
| `GENERATORAI_ARTIFACTS_DIR` | `~/.generatorai/artifacts` | Project + artifact root |
| `GENERATORAI_TEMPLATES_DIR` | `~/.generatorai/templates` | System templates + system MCP / artifacts |
| `HARNESS_TYPE` | `copilot` | Default provider: `copilot`, `claude-agent` or `codex` |
| `CODEX_CLI_PATH` | auto-resolved | Codex CLI location (unset: PATH, then the ChatGPT desktop app's bundled CLI) |
| `COPILOT_GH_HOST` | (none) | Set for GHEC tenants (`https://<tenant>.ghe.com/`) |
| `COPILOT_CLI_PATH` | auto-resolved | Override the platform binary path |
| `SANDBOX_ENABLED` | `false` | Enable Docker sandbox for `script` hooks |
| `GENERATORAI_LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` |
| `GENERATORAI_SSE_CAP_PER_SCOPE` | per-scope defaults | Override SSE connection cap |
| `GENERATORAI_TERMINAL` | `1` | Set `0` to disable the Integrated Terminal (REST + WS return 501). |
| `GENERATORAI_TERMINAL_IDLE_TTL_MS` | `1800000` (30 min) | Idle-reap threshold; bumped on any activity. |
| `GENERATORAI_TERMINAL_MAX_PER_WORKSPACE` | `5` | Per-workspace concurrent PTY cap. |
| `GENERATORAI_TERMINAL_MAX_GLOBAL` | `20` | Server-wide concurrent PTY cap. |
| `GENERATORAI_TERMINAL_PWSH_PROFILE` | (unset) | `1` = load PowerShell `$PROFILE` (default off — fast startup). |
| `GENERATORAI_TERMINAL_ALLOW_SECRETS` | (unset) | `1` = inherit `SSH_AUTH_SOCK` / AWS session tokens into the shell env (default off). |
| `GENERATORAI_BROWSER_MAX_CONCURRENT` | `5` | Server-wide cap on concurrent Chromium sessions. |
| `GENERATORAI_BROWSER_STREAM_FPS` | `20` | Browser MJPEG framerate over the WS transport. |
| `GENERATORAI_BROWSER_STREAM_QUALITY` | `60` | JPEG quality 0–100 for browser frames. |
| `GENERATORAI_DESKTOP_NATIVE_BROWSER` | (unset) | `1` in the desktop shell = use Electron's native `WebContentsView` for the browser feature instead of the server-hosted Playwright. |
| `GENERATORAI_COMPUTER_USE` | (unset) | Kill switch for Computer Use. `0` / `false` / `off` / `no` / `disabled` hard-disables it regardless of the setting. `1` seeds the default only until Settings → Computer Use has been written once (persisted as `computer-use.json` next to the DB); after that the setting wins. Default off. |

---

## 7. Quick reference — feature matrix

| Feature | Web | CLI | SDK | Notes |
|---|---|---|---|---|
| Chats: create / list / send / archive / delete | ✅ | ✅ (`chat …`) | ✅ (`ai.chat`) | Streaming via SSE. Optional project + up to 3 codebases + worktree. |
| Workflow defs: CRUD / validate / import-json / import-template / export | ✅ | ✅ (`workflow …`) | ✅ (`ai.workflows.create/list/get`) | Visual DAG builder in web. |
| Workflow runs: start / pause / resume / cancel / retry / watch / messages / workspace | ✅ | ✅ (`run …`) | ✅ (`ai.workflows.run/stream/pause/resume/cancel/retry`) | Run profiles supported in CLI + SDK + script materialize. |
| Stage CRUD + edge CRUD | ✅ | ✅ (`workflow stage`, `workflow edge`) | via builder (`StageBuilder`) | All edge types (`on_success / on_failure / on_completion / always`). |
| HITL (permission mode + approve/reject) | ✅ | ✅ (`run hitl`) | via `services.hitlService` (advanced) | 4 modes: `bypassPermissions / default / acceptEdits / plan`. |
| Automations: CRUD / enable / disable / trigger / executions | ✅ | ✅ (`automation …`) | ✅ (`ai.automations`) | 3 triggers × 4 input modes + 7 data-source scripts shipped. |
| Projects + codebases (3 types) + configs (agents/prompts/skills/mcp) | ✅ | ✅ (`project …`) | partial (via `services.projectService`) | Worktree creation per run / chat / automation iteration. |
| Workspaces (per-run isolated filesystem + artifacts) | ✅ (Files & Uploads tab, ChatFilesPanel) | ✅ (`workspace …`) | via `services.workspaceManager` | `creating / active / completed / archived / failed`. |
| Integrated Browser (workspace-scoped Chromium: live view, click-through, inspector, share/detach, capture) | ✅ (RightPane → Browser tab) | n/a | via `services.browserService` (advanced) | Two hosts: `ServerPlaywrightHost` (default, MJPEG over WS) + `ElectronBridgeAdapter` (desktop, native `WebContentsView`). |
| Integrated Terminal (workspace-scoped PTY: xterm.js, multi-tab, search, attach-selection-to-chat, worktree quick-cd) | ✅ (RightPane → Terminal tab) | n/a | via `services.terminalService` (advanced) | `node-pty` on Win/mac/Linux with `FallbackChildProcessHost` degradation; ephemeral in-memory sessions. |
| Hooks (22 phases × script / http / function) | ✅ (Workflow Settings → Hooks; Stage Properties → Hooks) | ✅ (`hook phases`, `hook test`) | via `services.hookExecutor` | Failure policy + timeout + retries + priority. |
| Webhooks (incoming for automations + outgoing GH webhook) | ✅ | ✅ (`webhook …`) | ✅ (`services.webhookService`) | HMAC verification + delivery audit log. |
| MCP servers (system + per-project) | ✅ | ✅ (`project mcp …`, `system mcp-servers`) | passed via `params.mcpServers` to harness | 8 system servers by default. |
| Programmatic Workflow Scripts (PWS) | ✅ (Scripts page + Run with profile) | ✅ (`script …`) | ✅ (`ai.scripts`) | `.workflow.mjs` reloadable without restart. |
| Templates | ✅ | ✅ (`orchestrator templates`, `workflow from-template`) | ✅ via `services.templateRegistry` | 5 built-in v2 templates. |
| Provider switch (Copilot ↔ Claude Agent) | ✅ (Settings → Provider) | ✅ (`harness …`) | constructor option | Hot-swappable via `HarnessProxy.switchAdapter`. |
| Custom tools (Zod-typed) | n/a | n/a | ✅ (`ai.tools.register / tool()`) | SDK-only. |
| Custom event subscription | n/a | via `run watch` SSE | ✅ (`ai.events.onAll/onRun/onSession/replay/emit`) | |
| TUI (Ink) | n/a | ✅ (`generatorai tui`) | n/a | 5 views: Dashboard / Chats / Workflows / Runs / Settings. |

---

## 8. How to extend without breaking things

Common change patterns and the bare-minimum checklist:

**Add a new stage option** (e.g., a new validation rule type):
1. `packages/shared/src/types/StageDefinition.ts` — extend the union.
2. `packages/shared/src/config/WorkflowDefinitionSchemas.ts` — extend the Zod schema for `CreateStageSchema` *and* `ImportStageSchema`.
3. `packages/db/src/repositories/StageDefinitionRepository.ts` — read/write the new field (if it lives in its own column) or it inherits the JSON column.
4. `packages/core/src/services/ResultValidator.ts` (or related) — implement.
5. `apps/web/src/components/workflow/StagePropertiesPanel.tsx` — surface it in the Execution tab.
6. `apps/cli/src/commands/workflow.ts` — add a flag if it makes sense from CLI.
7. Add unit + Playwright E2E coverage.

**Add a new hook phase**:
1. `packages/shared/src/types/HookDefinition.ts` — extend `HookPhase` union.
2. `packages/core/src/services/HookInterceptor.ts` (or `WorkflowRunService` / `StageExecutionService`) — find the right call site and invoke `hookExecutor.executePhase(phase, ctx)`.
3. `apps/server/src/routes/hooks.ts` — confirm it surfaces in `GET /api/hooks/phases`.
4. `apps/web/src/components/workflow/settings/HooksTab.tsx` (or `StagePropertiesPanel`) — add to the dropdown.

**Add a new SSE event kind**:
1. `packages/shared/src/types/AgentEvent.ts` — extend `AgentEventKind` and create a typed payload variant.
2. Emit via `eventBus.emit(sessionId, { kind, data })` *or* `eventBus.emitGlobal({ kind, data })` for global scope.
3. Bridge auto-routes to all scopes (session / run / chat / global). No route change required for new kinds.
4. `apps/web/src/stores/sseManager.ts` `processEvent()` — handle the new kind if it should drive UI state.
5. `apps/cli/src/streaming/EventRenderer.ts` `handleEvent()` — handle if it should render in `run watch`.

**Add a new harness provider** — see the full checklist in [docs/packages.md](./docs/packages.md#adding-a-new-provider).

---

## 9. Where the live truth lives (for AI agents tracing changes)

When in doubt, **read the source** in this order:

1. **Types & schemas** — [packages/shared/src/types/](../packages/shared/src/types/) and [packages/shared/src/config/](../packages/shared/src/config/). These define the wire format.
2. **Domain ports** — [packages/core/src/domain/ports/](../packages/core/src/domain/ports/). These define what the rest of the system *can* do.
3. **Services** — [packages/core/src/services/](../packages/core/src/services/). These are the application layer.
4. **Composition root** — [apps/server/src/composition-root.ts](../apps/server/src/composition-root.ts). This is how everything is wired together and is the single point of truth for DI.
5. **Routes** — [apps/server/src/routes/](../apps/server/src/routes/). These translate HTTP/SSE → service calls.
6. **Frontend hooks** — [apps/web/src/hooks/queries.ts](../apps/web/src/hooks/queries.ts) and `projectQueries.ts`. These define what the UI fetches and how it caches.

When designing a new feature: start in `shared/types`, sketch the port, write the service, then wire the route + UI.

---

## 10. Status & known gaps (as of this commit)

- ✅ Copilot SDK 1.0 GA upgrade complete. `CopilotProvider` uses `RuntimeConnection.forStdio({ path })`.
- ✅ Claude Agent SDK 0.3.183 provider stable, includes its own bundled `claude` CLI.
- ✅ Workspace + worktree unification (migration v8) complete; per-run isolation in `<workspaces>/<runId>/source/<alias>/`.
- ✅ Programmatic Workflow Scripts (PWS): profiles propagate `stageOverrides` + `permissionMode`.
- ✅ Streaming Phase 4 complete: `stream_cursors` + unified `/api/stream`.
- ✅ **Architecture V2 streaming overhaul complete** (phases 0-7): delta/item event classification, DeltaLog ring buffer, adaptive coalescing (4-16 ms), encode-once fan-out, bounded per-client queues, multiplexed SSE (`POST /api/stream/connect` + `GET /api/stream`) replacing N per-scope EventSources. Web SPA now opens a single mux connection per tab (`apps/web/src/stores/sseManager.ts`). CLI mux adoption is a known gap — see `StreamReconciler` TODO in `apps/cli/src/tui/store.ts`.
- ✅ HITL (Phase HITL-02) wired end-to-end: 4 permission modes + approve / reject.
- ✅ **`apps/desktop/`** is a working Electron app: the main process spawns the real server (production mode, serving `apps/web/dist` same‑origin) on a loopback port and loads it in a window → full web + CLI(API) parity with zero UI divergence. See [docs/apps.md](./docs/apps.md#appsdesktop--electron-desktop-app) + [apps/desktop/README.md](../apps/desktop/README.md). Packaging into a signed installer still needs `better-sqlite3` rebuilt for Electron's ABI + the server dependency tree bundled.
- ✅ **Integrated Browser** shipped — workspace-scoped Chromium session with VSCode-style share/inspect/capture panel. Two host implementations (`ServerPlaywrightHost` + `ElectronBridgeAdapter`) behind the `IBrowserBridge` port. See [docs/feature-integrated-browser.md](./docs/feature-integrated-browser.md).
- ✅ **Integrated Terminal** shipped — workspace-scoped PTY via `node-pty` + xterm.js, WebSocket transport at `/api/workspaces/:id/terminals/:sid/stream`, watermark flow control, multi-tab support, attach-to-chat. Phase 2 items (sandbox-attached terminal, agent-typed commands, DB persistence, recording) tracked in [docs/INTEGRATED_TERMINAL_PHASE2_PLAN.md](../docs/INTEGRATED_TERMINAL_PHASE2_PLAN.md). See [docs/feature-integrated-terminal.md](./docs/feature-integrated-terminal.md).
- ⚠️ **`packages/mcp-server/`** exposes a tool adapter but does not yet ship a standalone MCP server binary; system MCP definitions live in [templates/system/mcp-servers.json](../templates/system/mcp-servers.json).
- ⚠️ **`StageDefinition.iterationConfig`** has a schema but the runtime "iteration" feature is deferred (use Automation `input mode: loop` or `batch` instead).
- ⚠️ **`auto` and `gpt-5.3-codex` Copilot models** hang on at least one GHEC tenant — default model was changed to `claude-sonnet-4.6`.

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Harness** | Abstraction over the underlying AI agent SDK. Implementations: `CopilotProvider`, `ClaudeAgentProvider`. |
| **HarnessProxy** | A wrapper that lets you `switchAdapter()` at runtime without restarting services. |
| **DAG** | Directed Acyclic Graph of `StageDefinition`s connected by `StageEdge`s. Cycle detection via Kahn's algorithm. |
| **PWS / Workflow Script** | `.workflow.mjs` programmatic alternative to JSON definitions. Lives in `templates/scripts/`. |
| **RunProfile** | A reusable preset of `{variables, sessionMode, permissionMode, stageOverrides, …}` applied at run start. |
| **HITL** | Human-In-The-Loop. Stage parks in `awaiting_input` until approved / rejected via the HITL API. |
| **Execution Workspace** | Per-run / per-chat isolated filesystem (`<workspacesDir>/<id>/{source, artifacts, cache}`). |
| **Worktree** | Git worktree carved from a project codebase clone, lifetime-scoped to a single run. |
| **StreamBroker** | Persistent SSE broker backed by `stream_cursors` + `stream_sequences`. |
| **Skill / Custom Agent / MCP server** | Per-stage configurable "tool surfaces" — see [docs/feature-skills-agents-mcp.md](./docs/feature-skills-agents-mcp.md). |
| **ConfigResolver** | Service that deep-merges WorkflowDefinition → StageDefinition → runtime overrides into a final resolved config. |
| **RightPane** | The unified tabbed dock on the right side of Chat / Workflow Run pages. Hosts `Changes`, `Inspector`, `Browser`, `Terminal` tabs. See [apps/web/src/components/layout/RightPane.tsx](../apps/web/src/components/layout/RightPane.tsx). |
| **BrowserSession** | Chromium instance attached to a workspace. `IBrowserBridge` port; two hosts: `ServerPlaywrightHost` + `ElectronBridgeAdapter`. Descriptor persisted on `execution_workspaces.browser*` columns. |
| **TerminalSession** | Server-side PTY attached to a workspace. `ITerminalHost` port; three hosts: `NodePtyHost` / `SandboxPtyHost` (Phase 2) / `FallbackChildProcessHost`. **Ephemeral** — no DB rows. |

---

**For deeper reading, every link in section 2 leads to an exhaustive feature doc.** AI agents: read this file first, then *the one or two docs that match the user's request*, before touching code.
