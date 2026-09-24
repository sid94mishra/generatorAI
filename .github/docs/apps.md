# Apps

> Every user-facing application: server, web, cli, desktop. What it owns, what it depends on, how to extend.

---

## `apps/server` — Express API + SSE

**Path:** [apps/server/](../../apps/server/)

Single Node process binding to `$GENERATORAI_PORT` (default 3100). Owns:

- **Composition root** ([apps/server/src/composition-root.ts](../../apps/server/src/composition-root.ts)) — wires every service together.
- **Express app** ([apps/server/src/app.ts](../../apps/server/src/app.ts)) — JSON body parsing, CORS, request logging, error middleware, OpenAPI doc generator.
- **~23 route files** under [apps/server/src/routes/](../../apps/server/src/routes/):

| File | Endpoints | Service |
|---|---|---|
| `health.ts` | `GET /api/health`, `GET /api/health/config` | direct (`container.config`) |
| `system.ts` | `GET /api/system/artifacts`, `GET /api/system/mcp-servers` | `SystemArtifactService` |
| `copilot.ts` | `GET /api/copilot/models`, `GET /api/copilot/state`, `GET /api/copilot/conversations`, `GET /api/copilot/conversations/:id/messages`, `POST /api/copilot/ping` | `harness` directly |
| `harness.ts` | `GET /api/harness`, `POST /api/harness/switch` | `harnessProxy.switchAdapter` |
| `sessions.ts` | v1 `POST/GET/DELETE /api/sessions`, `/{id}/{start,pause,resume,cancel}`, `/{id}/messages` | `SessionService` |
| `chats.ts`, `chat.ts`, `chats-list.ts` | v2 `POST /api/chats`, `GET /api/chats[/:id]`, `PUT/DELETE /api/chats/:id`, `POST /api/chats/:id/prompt`, `GET /api/chats/:id/messages`, `GET /api/chats/:id/workspace`, `GET /api/chats/:id/workspace/files`, `POST /api/chats/:id/archive` | `ChatManagementService` |
| `workflows.ts` | v1 legacy CRUD | `WorkflowService` |
| `workflowDefinitions.ts` | `POST/GET/PATCH/DELETE /api/workflow-definitions`, `POST /api/workflow-definitions/import-json`, `POST /api/workflow-definitions/:id/validate`, `GET /api/workflow-definitions/:id/export`, stage CRUD, edge CRUD | `WorkflowDefinitionService` |
| `workflowRuns.ts` | `POST /api/workflow-runs`, `GET /api/workflow-runs[/:id]`, `/{id}/{start,pause,resume,cancel,retry}`, `/{id}/stages`, `/{id}/scratchpad`, `/{id}/workspace`, `/{id}/messages`, HITL approval & rejection | `WorkflowRunService` + `HitlService` |
| `workflowScripts.ts` | `GET /api/workflow-scripts`, `/:id`, `/:id/profiles`, `POST /:id/validate`, `POST /:id/materialize`, `POST /:id/run`, `POST /reload` | `WorkflowScriptLoader` + `WorkflowDefinitionService` + `WorkflowRunService` |
| `orchestrator.ts` | `GET /api/orchestrator/templates`, `POST /api/orchestrator/runs`, `/{id}/{start,pause,cancel}`, `/{id}/context`, `/{id}/runs` | `WorkflowOrchestrator` |
| `automations.ts` | `POST/GET/PUT/DELETE /api/automations`, `/{id}/{enable,disable,trigger,rotate-webhook-token}`, `/{id}/executions`, `/executions/{execId}`, `/executions/{execId}/cancel`, `POST /api/automations/data-source/test` | `AutomationService` + `DataSourceResolver` |
| `projects.ts` | `POST/GET/PUT/DELETE /api/projects`, `/{id}/codebases/*`, `/{id}/configs/*`, `/{id}/mcp-servers/*`, `/{id}/worktrees/*`, `/{id}/available-artifacts` | `ProjectService`, `CodebaseService`, `ProjectConfigService`, `WorktreeService`, `SystemArtifactService` |
| `workspaces.ts` | `GET /api/workspaces`, `/:id`, `POST /:id/{archive,commit}`, `DELETE /:id`, `POST /api/workspaces/cleanup`, `/:id/worktrees` | `WorkspaceManager` + `WorktreeService` |
| `browser.ts` | `POST /api/workspaces/:id/browser/{start,stop,actions,selection,attach,detach,capture,input,resize}`, `GET /api/workspaces/:id/browser/{descriptor,snapshots,scroll,screencast.jpg,files/*}` — user + inspector-script surface for the Integrated Browser | `BrowserService` |
| `terminals.ts` | `POST/GET/DELETE /api/workspaces/:id/terminals[/:sid]`, `GET /:sid/scrollback`, `POST /:sid/{resize,signal}` — REST surface for the Integrated Terminal (WS handles live IO) | `TerminalService` |
| `extensions.ts` | `GET /api/extensions[/:id]`, `GET /api/extensions/widgets`, `POST /api/extensions`, `PATCH /api/extensions/:id`, `DELETE /api/extensions/:id`, `POST /api/extensions/reload`, `POST /api/extensions/:id/reload`, `GET /api/widget-assets/:extensionId/*` — extension install / reload + widget bundle serving | `ExtensionManager` |
| `widgets.ts` | `GET /api/widgets[?sessionId=&chatId=]`, `GET /api/widgets/:id`, `POST /api/widgets`, `PATCH /api/widgets/:id/state`, `POST /api/widgets/:id/actions`, `DELETE /api/widgets/:id` — widget-instance lifecycle backing the postMessage bridge (see [feature-extensions-widgets.md](./feature-extensions-widgets.md)) | `WidgetService` |
| `webhooks.ts` | `POST/GET/DELETE /api/webhooks`, `POST /api/webhooks/github`, `POST /api/automations/webhook/:token` | `WebhookService` + `AutomationService` |
| `hooks.ts` | `GET /api/hooks/phases`, `POST /api/sessions/:id/hooks/test` | `HookExecutor` introspection |
| `stream.ts` | **`GET /api/stream?scope=&id=&afterSeq=&filter=`** (SSE), **`GET /api/stream/replay?scope=&id=&afterSeq=&limit=`** | `StreamBroker` |
| `templates.ts` | `GET /api/templates[/:id]` | `TemplateRegistry` |

OpenAPI: [apps/server/src/openapi/](../../apps/server/src/openapi/) auto-generates `/api/openapi.json` from `zod-to-openapi`. Served as Swagger UI at `/api/docs`.

### Middleware

- `pino-http` request logger
- CORS (configurable origins)
- Body parsing (JSON, multipart for file uploads)
- Error handler middleware mapping `GeneratorAIError` to HTTP status codes
- Security: HMAC verification for GitHub webhooks; webhook-token verification for automation webhooks

### SSE handler architecture

For every SSE connection ([apps/server/src/routes/stream.ts](../../apps/server/src/routes/stream.ts)):

```typescript
1. Validate query params (scope, id, filter, afterSeq)
2. acquireSseSlot(scope, id)                                 // SEC-04 cap
3. Send initial comment frame (for proxy buffering)
4. Set headers: text/event-stream, no-cache, X-Accel-Buffering: no
5. streamBroker.subscribe(scope, scopeId, deliver, opts)     // 3-phase: buffer → replay → live
6. On res.on('drain') → wake blocked publisher
7. Heartbeat interval (unref'd, default 15s)
8. On res.on('close') → unsubscribe + release slot + clear interval
```

Backpressure: queued frame count caps at 256; on overrun the server sends `slow_consumer_dropped` and disconnects.

### WebSocket transports (integrated browser + terminal)

Two long-lived WebSocket paths share the same `http.Server` as the SSE endpoint. Both use `WebSocketServer({ noServer: true })` and attach via `server.on('upgrade')` with a path regex:

| Path | Handler | Purpose |
|---|---|---|
| `/api/workspaces/:id/browser/stream` | [apps/server/src/browser-ws.ts](../../apps/server/src/browser-ws.ts) | Streams Chromium screencast JPEG frames (binary WS) and dispatches user input events (text JSON). Bypasses the Vite dev proxy's `multipart/x-mixed-replace` buffering. |
| `/api/workspaces/:id/terminals/:sid/stream` | [apps/server/src/terminal-ws.ts](../../apps/server/src/terminal-ws.ts) | Streams raw PTY output (binary WS) and dispatches user input / resize / ACK / signal / kill frames (text JSON). Watermark flow control drives OS-level `handle.pause()` / `resume()` on the shell. |

Both handlers perform auth (bearer token / API key) and Origin allowlist checks **before** `wss.handleUpgrade`. Coexisting on the same HTTP server means: **any new long-lived WS must follow the same `noServer` + path-regex pattern** — do not add a second `http.createServer` and do not bind a naked `WebSocketServer` to `/`.

See [feature-integrated-browser.md](./feature-integrated-browser.md) + [feature-integrated-terminal.md](./feature-integrated-terminal.md) for protocol details.

### Boot recovery

On startup, `StartupRecoveryService.recoverInFlightRuns()`:
1. Selects `workflow_runs` where `status IN ('starting', 'running', 'paused')`.
2. For each, transitions through state machine to `cancelled` if `started_at` older than `recoveryThresholdMs` (default 1h), otherwise resumes via `workflowRunService.resumeRun(runId)`.

---

## `apps/web` — React 19 SPA

**Path:** [apps/web/](../../apps/web/)

Vite-bundled SPA served by Vite in dev and statically from server in prod (`/web/*` mounted under server in prod build).

### Tech stack

- React 19
- React Router (file-based routes via `apps/web/src/router.tsx`)
- TanStack Query v5 (server state cache + mutations)
- Zustand (UI state — 6+ stores: ui, chat, workflow, session, stream, settings)
- Tailwind CSS 4 + CSS custom properties (light/dark themes)
- React Flow (visual DAG canvas)
- `lucide-react` icons
- `react-markdown` + `remark-gfm` + `rehype-highlight`

### Pages (18 routes)

| Route | Component |
|---|---|
| `/` | `DashboardPage` — 4 stat cards + 3 quick actions + 3 recent panels |
| `/projects`, `/projects/new`, `/projects/:id`, `/projects/:id/codebases/:cid` | `ProjectsListPage`, `CreateProjectPage`, `ProjectDetailPage`, `CodebaseDetailPage` |
| `/chats`, `/chats/new`, `/chats/:id` | `ChatsListPage`, `CreateChatDialog` (modal in ChatsList), `ChatPage` |
| `/workflows`, `/workflows/new`, `/workflows/:id` (read-only), `/workflows/:id/edit` (builder), `/workflows/:id/runs/:rid` | `WorkflowListPage`, `WorkflowBuilderPage`, `WorkflowDefinitionPage`, `WorkflowRunPage` |
| `/scripts`, `/scripts/:id` | `ScriptsListPage`, `ScriptDetailPage` |
| `/automations`, `/automations/new`, `/automations/:id` | `AutomationsPage`, `CreateAutomationPage`, `AutomationDetailPage` |
| `/templates` | `TemplateExplorer` |
| `/settings` | `Settings` (4 tabs: General, Provider, Copilot, Advanced) |

### Component organization

```
components/
├── layout/            AppLayout, Sidebar (8 nav items), Header, Breadcrumb,
│                     RightPane (unified tabbed dock — hosts Changes / Inspector / Browser / Terminal tabs
│                                on both ChatPage and WorkflowRunPage; state persisted per-page in localStorage)
├── chat/              ChatView, ChatList, ChatMessageList, ChatInput, ChatFilesPanel,
│                     BrowserPanel (Integrated Browser — VSCode-style share/inspect/capture UI),
│                     NativeBrowserView (desktop overlay coordinator for Electron's WebContentsView),
│                     StreamingMessage (live blocks: thinking, text, tool calls, system),
│                     AssistantMessage, UserMessage, SystemMessage, ToolMessage,
│                     MarkdownRenderer, CreateChatDialog
├── terminal/          TerminalPanel (xterm.js + WebGL + Fit + WebLinks + Search; multi-tab; inline search bar;
│                                     attach-selection-to-chat; worktree quick-cd on workflow-run pages)
├── workflow/          DAGCanvas (React Flow with StageNode, StageEdge),
│                     StagePropertiesPanel (Properties + Execution tabs),
│                     WorkflowConfigPanel (Settings dialog with 5 tabs),
│                     RuntimeDAGCanvas + RuntimeStageNode/Edge (live colors during run),
│                     WorkflowMessages, RunTimeline, RunArtifactsPanel, RunHistoryPanel,
│                     RunStatusBadge, RunControls,
│                     HitlPanel, HitlNotificationBanner,
│                     AgentSelector, SkillSelector, McpServerSelector,
│                     PromptEditor, PromptFilePicker,
│                     VariableInputModal, NumberStepper, ToggleSwitch, StyledSelect,
│                     CollapsibleSection, StageOutput,
│                     settings/{GeneralTab, VariablesTab, HooksTab, TagsMetadataTab, ProjectCodebasesTab}
├── codebase/          CodebaseFileBrowser (tree view + file viewer)
├── common/            ProjectPicker, CodebasePicker, SourceBadge, SyntaxHighlightedCode
├── shared/            FileViewerComponents (modal + grid view)
├── artifacts/         ArtifactBrowser, ArtifactPicker
└── (root)             ConfirmDialog, ErrorBoundary, PageErrorBoundary,
                       Skeleton, Toast, Tooltip
```

### State management

- **TanStack Query** — all server reads/writes go through `apps/web/src/hooks/queries.ts` (and `projectQueries.ts`, `chatQueries.ts`, etc.). Cache keys are `[domain, …id]`.
- **Zustand stores** in `apps/web/src/stores/`:
  - `uiStore` — sidebar open/close, current breadcrumb
  - `chatStore` — current chat, streaming blocks per session
  - `workflowStore` — current canvas state, selected stage, undo/redo
  - `streamStore` — global stream/connection state
  - `settingsStore` — theme, verbosity, persisted in localStorage
- **SSE manager** (`apps/web/src/stores/sseManager.ts`) — long-lived multi-scope EventSource manager with dedup, replay-then-live, cross-buffer flush for thinking↔token interleaving (load-bearing comment around lines 160–183).

### Platform client

[apps/web/src/platform/](../../apps/web/src/platform/) implements the `IPlatformClient` interface (defined in `@generatorai/shared/types/IPlatformClient.ts`) using `fetch` + native `EventSource`. The same interface is implemented for CLI by `HttpPlatformClient`. Web app components depend only on the interface, never on `fetch` directly.

### Theme

Tailwind 4 + custom `:root` CSS variables. Light/dark mode via `<html class="dark">`. The theme picker in Settings → General toggles between `Light / Dark / System`. The `System` option reads `prefers-color-scheme`.

### Build

```powershell
pnpm --filter @generatorai/web dev      # Vite dev server on $GENERATORAI_WEB_PORT (5173)
pnpm --filter @generatorai/web build    # Vite production build → apps/web/dist
pnpm --filter @generatorai/web test     # vitest + jsdom
```

In production, the server statically serves `apps/web/dist`.

---

## `apps/cli` — Commander.js + Ink TUI

**Path:** [apps/cli/](../../apps/cli/)

Single-binary CLI installed via `pnpm --filter @generatorai/cli build` then run as `generatorai <command>`. One mode:

- **HTTP + WebSocket client** of a running server (`createCliClient()` in `packages/cli-core`). There is no in-process / `direct` / `--local` mode: the CLI never imports `@generatorai/core`, `@generatorai/db` or a harness provider, and its bundle (`apps/cli/esbuild.config.mjs`) is fully self-contained with no native addons. Earlier revisions of this doc described a `direct` mode "framework"; it was never in the tree.

### Top-level commands (18)

```
generatorai
├── system / health / models / status / artifacts / mcp-servers
├── config / config profile {list,create,use,delete}
├── copilot {conversations, messages, ping}
├── chat {list, create, show, send, messages, watch, archive, delete}
├── workflow|wf {list, create, show, update, delete, validate,
│                 import-json, import-template, export, from-template,
│                 stage {add,update,delete}, edge {add,delete}}
├── run {list, start, show, watch, pause, resume, cancel, retry, messages, workspace,
│         stage {pause,resume,retry,cancel,list},
│         hitl {mode, pending, resume},
│         profile {generate, validate, list}}
├── orchestrator|orch {templates, template, create, start, context, runs, cancel}
├── automation|auto {list, create, show, update, delete, enable, disable, trigger,
│                     rotate-webhook-token, execution {list, show, cancel}}
├── project|proj {list, create, show, update, delete,
│                  codebase {list, link, fetch, branches, browse, file, update, unlink},
│                  config {list, upload, get, update, delete},
│                  mcp {list, add, update, remove},
│                  worktree {list, remove, cleanup}}
├── workspace|ws {list, show, archive, commit, delete, cleanup, worktree list}
├── webhook {list, create, delete}
├── hook {phases, test}
├── harness {show, switch}
├── script|sc {list, show, profiles, materialize, run, validate, reload}
├── init [--force]
├── completions {bash, zsh, fish, powershell}
└── tui
```

Global flags: `--json`, `--server <url>`, `--api-key <key>`, `--config-profile <name>`, `--verbose`, `--no-color`.

### Streaming subsystem

- [apps/cli/src/streaming/SSEClient.ts](../../apps/cli/src/streaming/SSEClient.ts) — EventSource wrapper with exponential-backoff reconnect (1s → 30s, ±500ms jitter, 20 attempts).
- [apps/cli/src/streaming/EventRenderer.ts](../../apps/cli/src/streaming/EventRenderer.ts) — renders 10+ event kinds to terminal (tokens, reasoning deltas, tool start/complete, usage, error, completion).

### TUI (Ink React)

`generatorai tui` launches an Ink app with 5 views (`Dashboard`, `Chats`, `Workflows`, `Runs`, `Settings`). Zustand vanilla store backs it. Keyboard shortcuts: `1-5` switch views, `?` help overlay, `Esc/Ctrl+B` back. Data refresh every 5s.

### Config (5-layer precedence)

`apps/cli/src/config/loadConfig.ts`:

```
1. CLI flags
2. Environment variables (GENERATORAI_*)
3. Project config (./.generatorai/config.json)
4. User config (~/.generatorai/config.json)
5. Built-in defaults
```

Profiles are scoped subtrees of the user config (e.g., `pnpm cli --config-profile prod ...`).

---

## `apps/desktop` — Electron desktop app

**Path:** [apps/desktop/](../../apps/desktop/) · see [apps/desktop/README.md](../../apps/desktop/README.md)

Native Electron shell with **full parity** to the web UI and (via the shared server API) the CLI. It does **not** reimplement the UI: the Electron main process spawns the real GeneratorAI server in production mode (which serves the built `apps/web/dist` SPA same‑origin at `/` and the REST + SSE API at `/api`) on a private loopback port, then loads `http://127.0.0.1:<port>/` in a `BrowserWindow`. The web app runs unmodified — relative `/api`, `EventSource`, `localStorage` and routing all work with no CORS and no web edits.

Main process modules: `server-manager` (spawn / health‑gate / crash‑restart / graceful `SIGTERM`), `window-manager` (splash + main window + state persistence + History‑API navigation), `menu` (every route + actions), `tray`, `ipc` (native dialogs, theme, server status, settings), `downloads` (native Save‑As), `deep-link` (`generatorai://`), `updater` (electron‑updater scaffold). The `preload` exposes `window.generatoraiDesktop` and shims `showDirectoryPicker` to a native dialog. Built with `tsup` (CJS main/preload); packaged with `electron-builder`.

Runtime data is isolated under the OS user‐data dir (`<userData>/data/{generatorai.db,workspaces,artifacts}`). Run standalone with `pnpm preview:desktop` (after `pnpm --filter @generatorai/web build`), or in dev with `pnpm dev:desktop` against the Vite dev server. E2E smoke: `node agent-tests/desktop-smoke.mjs`.

**Integrated Browser + Terminal parity**: because the desktop main process spawns the same server binary the web build talks to, both features work identically inside Electron — no re-implementation. Two desktop-specific niceties:

- Setting `GENERATORAI_DESKTOP_NATIVE_BROWSER=1` before launch enables the `ElectronBridgeAdapter`, which hosts a `WebContentsView` in the main process and lets the SPA render *native* Chromium pixels (as opposed to the MJPEG screencast used on the web). The main process module owning this is `apps/desktop/src/main/browser-host.ts` — **not** the separate `apps/browser-host` process described below; they are unrelated despite the similar name.
- `node-pty` is a native dependency added to `apps/desktop/package.json`. `pnpm --filter @generatorai/desktop rebuild` (which runs `electron-rebuild -f -w better-sqlite3 -w node-pty`) recompiles it against Electron's ABI; both `better-sqlite3` and `node-pty` are then `asarUnpack`'d so the packaged app loads them at runtime.

> Note: the embedded production server relies on `apps/server/src/middleware/staticFiles.ts`, which now (a) honours a `WEB_DIST_DIR` override for deterministic SPA resolution and (b) uses an Express‑5‑valid catch‑all route (the previous bare `'*'` threw under path‑to‑regexp@8). Packaging into a signed installer additionally needs `better-sqlite3` rebuilt for Electron's ABI (`pnpm --filter @generatorai/desktop rebuild`) — see the README.

---

## Host processes — `agent-host`, `pty-host`, `browser-host`, `cua-host`

The V2 architecture (V2 master plan §3.2, internal) moves anything owning a **native handle** out of the gateway process. The rule (L5) is that the gateway never holds a PTY file descriptor, a Chromium instance or a computer-use driver directly: a crash in any of them must not take the API down, and a gateway restart must not orphan them.

All four share one shape:

- Started by a gateway-side supervisor via `child_process.fork()`, so the channel is Node IPC — structured JSON, no socket to secure and no port to collide.
- Protocol types live in `packages/shared/src/ipc/` (`AgentHostIpc.ts`, `PtyHostIpc.ts`, `BrowserHostIpc.ts`, `CuaHostIpc.ts`), so gateway and host cannot drift apart silently.
- **Parent-PID heartbeat**: each host signals `0` to its parent every 5 s and exits if the parent is gone. With the boot-time reaper in `packages/agent-harness-providers/src/childRegistry.ts`, this is what makes "zero orphans after a kill" achievable.
- Restart with backoff under a cap, supervised by `HostSupervisor` (`packages/core/src/infrastructure/`).

| App | Work item | Owns | Gateway-side client | Status |
|---|---|---|---|---|
| [apps/agent-host](../../apps/agent-host/) | W12 | Provider harness runtimes (Copilot, Claude, …) | `AgentHostClient` | **Opt-in**, `GENERATORAI_AGENT_HOST=true` — not the default path |
| [apps/pty-host](../../apps/pty-host/) | W14 | All `node-pty` handles | `PtyHostAdapter` / `PtyHostClient` | **Opt-in**, `GENERATORAI_PTY_HOST=true`; default is the in-process `NodePtyHost` |
| [apps/browser-host](../../apps/browser-host/) | W15 | One Chromium instance, N contexts | *(none — deleted)* | Standalone only. `BrowserHostClient` had zero callers and covered 8 of `IBrowserBridge`'s ~30 operations; it was **deleted** rather than left exported as if it were usable |
| [apps/cua-host](../../apps/cua-host/) | W17 | The `@trycua/cua-driver` session | *(none — deleted)* | Standalone only. **Must not be wired**: its protocol carries no app/window identity, so every action targets whatever is frontmost. `CuaHostClient` was **deleted**; see `packages/shared/src/ipc/CuaHostIpc.ts` |

> Two of these are deliberately not the live path, and two are opt-in with known gaps. An internal remaining-work audit records what is and is not finished for each — read it before turning any of them on.

Child environments are built from an **allowlist** (`packages/shared/src/config/childEnv.ts`), never by cloning `process.env`. A host that spawns a shell — `pty-host` — runs model-authored commands, so inheriting the gateway's environment would hand the agent the vault key, the desktop admin token and every provider credential.

---

## `apps/relay` — self-hostable rendezvous

**Path:** [apps/relay/](../../apps/relay/)

A small, deliberately boring process you run somewhere a GeneratorAI server and a phone can both reach (a $5 VPS is enough). The **server dials out to it**, so the machine holding your code never needs an inbound firewall rule.

| Endpoint | Purpose |
|---|---|
| `GET /relay/assignment?relayHostId=…` | Director — tells a host which cell to use |
| `WS /relay/host` | Host control channel |
| `WS /relay/client` | Client connection |
| `WS /relay/data?streamId=…` | Per-stream byte pipe |
| `GET /healthz` | Liveness + capacity |

The relay is a byte pipe: it reads no application payloads. Identity and authorisation are end-to-end between the client and the GeneratorAI server (see the auth/relay implementation notes, internal). Frame lanes mirror `AdmissionController`'s interactive/ordinary/bulk classes so a bulk artifact transfer cannot starve interactive input.

---

## `apps/mobile` — Expo / React Native companion

**Path:** [apps/mobile/](../../apps/mobile/) · see [apps/mobile/README.md](../../apps/mobile/README.md) for the EAS build profiles (`eas.json`), the `EAS_PROJECT_ID` requirement for push, and the Android cleartext rationale.

A companion client for chats and run monitoring, reaching the server directly on the LAN or through `apps/relay`. It shares `packages/client-core`'s stream reducer and types, but has its own transport (`src/stream/SseClient.ts`) and event router (`src/stream/useChatStream.ts`).

> Mobile uses the multiplexed stream connection (one socket, `chat` + `global` scopes). The `global` lifecycle feed needs the `read:activity` scope (in every default preset since Sept 2026); a device paired without it sees an explanatory strip with Retry while its chat streams keep working. Standalone-client overhaul status is tracked internally (mobile standalone plan §12).

---

## Cross-app patterns

- **Single `IPlatformClient` interface** — both web (`HttpPlatformClient` based on `fetch + EventSource`) and CLI (`HttpPlatformClient` based on `node-fetch + eventsource`) implement the same TypeScript interface, defined in `@generatorai/shared/types/IPlatformClient.ts`. This is what enables sharing query hooks between UI surfaces and lets you do `cli --json` to get the same wire format the UI uses.
- **OpenAPI** — `apps/server/src/openapi/` generates the spec from Zod schemas via `zod-to-openapi`. Use `pnpm --filter @generatorai/server generate:openapi` to refresh; the spec is also served live at `/api/openapi.json`.
- **OTel instrumentation** — both server and CLI ship an `instrumentation.ts` loaded before any other module. Auto-instruments HTTP, Express, fetch, and better-sqlite3.
