# GeneratorAI — CLI + TUI Ground-Up Overhaul

**Status:** Plan for review · **Scope:** `apps/cli` (full rewrite), new `packages/cli-core`, new `packages/tui-kit`, changes to `packages/client-core` / `client-transport` / `client-runtime` / `design-tokens`, one new server route group.
**Author:** analysis pass over `.github/AGENTS.md` + all linked feature docs, the full `apps/cli` source, the server route surface, the web SPA surface, and prior art from Codex CLI, Gemini CLI, Claude Code, OpenCode, Bubble Tea / Ink / ratatui.

---

# Part 0 — What this document is

Four things, in order:

1. **A verified map of what the application actually does today** (Part 1) — derived from `AGENTS.md` and every doc it links, cross-checked against source, not taken on faith.
2. **A critical, unbiased review of the current CLI** (Parts 2–3) — with severities, evidence, and the specific line-level reasons each finding is real.
3. **Prior-art research** (Part 4) — how Codex CLI, Gemini CLI, Claude Code, OpenCode and the Charm/Ink ecosystems build agentic CLIs and TUIs, and which of their decisions apply to us and which do not.
4. **The plan** (Parts 5–15) — target architecture, exact tech stack with rejected alternatives, workstreams broken to file level, the TUI design spec, the full new command surface, companion mode, testing, migration, risks, sequencing, and the decisions I need from you.

---

# Part 1 — The application, end to end

## 1.1 Execution objects

Everything in GeneratorAI reduces to three top-level execution objects, all observed through **one** SSE endpoint `GET /api/stream?scope=…&id=…` with `Last-Event-ID` resume and a REST replay fallback:

| Object | Definition | Nesting |
|---|---|---|
| **Chat** | 1:1 with a `Session`; long-lived conversation against a provider. | `Chat → Session → ExecutionWorkspace?` |
| **Workflow Run** | One execution of a DAG `WorkflowDefinition`. | `WorkflowRun → StageRun[] → Session (1:1 per stage)` |
| **Automation Execution** | A trigger fan-out into N workflow runs. | `Automation → AutomationExecution → AutomationExecutionRun → WorkflowRun` |

Underneath, `IAgentHarness` hides whether the model is Copilot CLI or Claude Code CLI, and `HarnessProxy` makes the provider hot-swappable.

## 1.2 The full feature surface (what a client must be able to reach)

Counted from `apps/server/src/routes/` — **~280 HTTP endpoints across 31 route modules**, plus 3 WebSocket paths and 1 SSE path:

| Route module | Endpoints | CLI coverage today |
|---|---:|---|
| `projects.ts` | 30 | ✅ good |
| `chats.ts` | 21 | ⚠️ partial (no attachments, no plan/question cards, no background tasks) |
| `workflowRuns.ts` | 20 | ✅ good |
| `workspaces.ts` | 19 | ⚠️ partial (no artifact upload/download, no file tree) |
| `auth.ts` | 18 | ✅ via `device` (best-in-class — see 2.6) |
| `browser.ts` | 16 | ⚠️ partial (`browser` cmd exists, no live view) |
| `orchestrator.ts` | 15 | ✅ good |
| `automations.ts` | 15 | ✅ good |
| `workflowDefinitions.ts` | 14 | ✅ good |
| `computer.ts` | 14 | ❌ **zero** |
| `agents.ts` | 9 | ✅ good |
| `extensions.ts` | 9 | ❌ **zero** |
| `widgets.ts` | 9 | ❌ **zero** |
| `workflowScripts.ts` | 9 | ✅ good |
| `terminals.ts` | 7 | ❌ **zero** |
| `review.ts` | 7 | ❌ **zero** |
| `webhooks.ts` | 5 | ✅ |
| `system.ts` | 5 | ✅ |
| `copilot.ts` | 5 | ✅ |
| `harness.ts` | 4 | ✅ |
| `hooks.ts` | 3 | ⚠️ `phases` + `test` only |
| `sourceControl.ts` | 3 | ❌ **zero** |
| `security.ts` | 3 | ❌ **zero** |
| `stream.ts` | 3 | ✅ |
| `templates.ts` | 2 | ✅ |
| `health.ts` | 2 | ✅ |
| `sessions.ts` | 1 | ✅ |

WebSocket surfaces (all `WebSocketServer({ noServer: true })` sharing the HTTP `upgrade` event):
- `/api/workspaces/:id/terminals/:sid/stream` — PTY bytes + resize, watermark flow control.
- Browser frame stream — MJPEG at `GENERATORAI_BROWSER_STREAM_FPS` (default 20), quality 60.
- Computer-use frames.

## 1.3 The web SPA surface (the parity target)

19 pages, ~150 components. The load-bearing ones for parity:

- **Pages:** Dashboard, ChatsList, Chat, WorkflowList, WorkflowDefinition, WorkflowBuilder, WorkflowRunV2, AutomationsList, AutomationDetail, CreateAutomation, ProjectsList, ProjectDetail, CreateProject, CodebaseDetail, ScriptsList, ScriptDetail, AgentsList, AgentEditor, Settings.
- **The `RightPane`** — the unified tabbed dock hosting `Changes` / `Inspector` / `Browser` / `Terminal`. This is the single most complex UI concept to bring to a terminal.
- **CommandPalette** (`components/layout/CommandPalette.tsx`) — already exists in web; a TUI must have the equivalent and should share the action registry.
- **Streaming chat rendering:** `StreamingMessage`, `ToolMessage`, `PlanCard`, `QuestionCard`, `StepRow`, `UsageChip`, `ContextUsageGauge`, `BackgroundTasksPanel`, `MarkdownRenderer`.
- **Diff/review stack:** `ChangesSurface`, `ChangesTree`, `DiffCodeView`, `CheckpointTimeline`, `ReviewThreadCard`, `ReviewComposerPopover`.
- **Settings:** 12 sections (General, Appearance, Providers, Agents, Catalogs, Extensions, Security, SourceControl, BrowserTerminal, ComputerUse, Diagnostics).

## 1.4 The shared client stack that already exists

This is the most important discovery of the whole analysis:

```
packages/client-core/        ← platform-agnostic; "shared by apps/web, apps/desktop and apps/mobile"
  api/client.ts              1057 LOC  typed API client
  stream/eventRouter.ts       578 LOC  SSE event → domain routing
  stream/reducer.ts           647 LOC  event stream → message timeline
  stream/contextUsage.ts      192 LOC  context-window gauge math
  stream/parseInlineToolCalls.ts
  stream/sseParser.ts
  diff/parseUnifiedDiff.ts    210 LOC

packages/client-transport/
  EndpointSupervisor.ts       225 LOC  multi-endpoint failover
  httpCodec.ts                263 LOC
  DirectTransport.ts / Backoff.ts

packages/client-runtime/
  AuthenticatedClientRuntime.ts 688 LOC  DPoP, refresh, host pinning
  connections.ts              211 LOC  multi-server connection catalog (serverId-keyed)
  deviceKey.ts / pairing.ts / nodeStores.ts / browserStores.ts

packages/design-tokens/
  18 themes (ayu, carbon, catppuccin, clay, contrast, dracula, everforest,
  flexoki, github, graphite, gruvbox, night-owl, nord, one, rose-pine,
  solarized, tokyo-night, …) + emit/css.ts + emit/native.ts
```

**`apps/cli/package.json` depends on `@generatorai/client-runtime` only.** It does not depend on `client-core` or `client-transport`. `apps/mobile` depends on all three. The CLI is the one client that never adopted the shared stack.

---

# Part 2 — Critical review of the current CLI

`apps/cli/src` is **~7,000 LOC across 57 files**. Verified inventory:

```
 933  platform/HttpPlatformClient.ts      826  commands/run.ts
 572  commands/workflow.ts                469  commands/device.ts
 400  streaming/EventRenderer.ts          357  commands/automation.ts
 325  commands/chat.ts                    320  commands/project.ts
 284  platform/DirectPlatformClient.ts    248  platform/types.ts
 214  commands/webhook.ts                 203  commands/browser.ts
 194  commands/config.ts                  187  commands/workflow-script.ts
 …
 TUI total: 601 LOC across 15 files
```

## 2.1 🔴 CRITICAL — The CLI is forked off the shared client stack

**Evidence.** `platform/HttpPlatformClient.ts` (933 LOC) and `platform/types.ts` (248 LOC) hand-roll an HTTP client with ~130 methods. `packages/client-core/src/api/client.ts` (1057 LOC) is the same thing, maintained separately, used by web + mobile. `streaming/EventRenderer.ts` (400 LOC) hand-rolls event→display logic; `packages/client-core/src/stream/reducer.ts` (647 LOC) + `eventRouter.ts` (578 LOC) do it properly and are shared. `streaming/SSEClient.ts` (99 LOC) hand-rolls reconnect/backoff; `client-transport/EndpointSupervisor.ts` + `Backoff.ts` do it and add multi-endpoint failover.

**Consequence.** Every new server capability must be implemented **twice**, and the CLI copy is always the one that lags. This single fact explains every other gap below. It is why `extensions`, `widgets`, `terminals`, `review`, `sourceControl`, `security` and `computer` — roughly 65 endpoints, all shipped in the last several sessions — have **zero** CLI presence.

**Severity: critical.** Not fixing this makes every other item in this plan a treadmill.

## 2.2 🔴 CRITICAL — The TUI is a stub, not a product

601 LOC total. Concretely:

- **Detail views do not exist.** `TUIApp.tsx` `ViewRouter`:
  ```tsx
  case 'chats':
  case 'chat-detail': return <ChatsView />;
  case 'workflows':
  case 'workflow-detail': return <WorkflowsView />;
  case 'runs':
  case 'run-detail': return <RunsView />;
  ```
  Pressing Enter on a chat "navigates" to `chat-detail` and renders **the same list**. There is no chat view, no run view, no stage view, no message view.
- **No streaming in the TUI at all.** `useDataLoader.ts` polls `listChats()` / `listDefinitions()` / `listRuns()` on a **5-second `setInterval`**. The TUI never opens an SSE connection. The one genuinely differentiating capability of the product — live token/tool/thinking streams — is absent from the interactive surface.
- **No input.** No text input component, no chat composer, no forms. You cannot send a message, start a run, or approve a HITL gate from the TUI.
- **Polling is unconditional and view-blind to errors.** A single failed fetch flips `serverStatus` to `disconnected` with no retry semantics and no error surface beyond one line.
- **Store is flat and global.** `appStore.ts` holds `chats[] / workflows[] / runs[] / recentEvents[]` and nothing else — no automations, projects, workspaces, agents, scripts, artifacts, extensions. No per-view loading/error state. No pagination. No cache invalidation.
- **No layout system.** Fixed `padding={1}`, `'─'.repeat(50)` hard-coded rules, `minHeight={20)`. It does not respond to terminal width; on an 80-col terminal it overflows, on a 200-col terminal it wastes 75% of the screen.
- **Not full-screen.** Rendered inline, no alternate screen buffer, so it scribbles over the user's scrollback and cannot be exited cleanly to a restored terminal.
- **No mouse, no scrolling, no search, no focus management, no command palette, no theming.**

**Severity: critical.** This cannot be incrementally improved into the thing you described. It is a rewrite.

## 2.3 🔴 CRITICAL — TUI bypasses the auth runtime

`tui/index.tsx`:
```ts
if (options?.apiKey ?? config.server.apiKey) {
  process.env['GENERATORAI_API_KEY'] = options?.apiKey ?? config.server.apiKey;
}
const { client } = await createClient({ mode: 'auto', serverUrl });
```
The TUI stuffs a **legacy shared API key into a process env var** and never touches `getCliAuthRuntime()`. Meanwhile `platform/authRuntime.ts` correctly warns that `GENERATORAI_API_KEY` "is deprecated and grants full access to this server."

So: the CLI has an excellent DPoP device-credential system, and the interactive surface routes around it. The TUI also cannot pair, cannot show which device it is, and cannot switch servers.

**Severity: critical** — it is a security regression relative to the CLI's own binary commands.

## 2.4 🟠 HIGH — No multi-server connection model

`authRuntime.ts` caches on `` `${endpoint}::${profile}` ``. `client-runtime/connections.ts` already implements the correct model — a catalog keyed on the server's **X25519 host fingerprint (`serverId`)**, with `endpoints[]` for multiple routes to the same machine, `kind: 'local' | 'remote'`, and host pinning. Its own header comment explains exactly why URL-keying is wrong: a laptop that moves DHCP lease or is reached over loopback at home and LAN from the sofa is the *same* server and must keep the same credential.

The CLI keys on URL. Your stated requirement — *"server can be any machine and CLI can connect to it"* — is precisely the case the catalog was built for, and the CLI does not use it. There is also `apps/relay` + `packages/relay-protocol` for tunnelled access that the CLI has no awareness of.

## 2.5 🟠 HIGH — Command surface has drifted from the docs

`.github/docs/usage-cli.md` documents a `19`-group tree. Reality from `commands/index.ts` is 17 registrations, and specific documented commands do not exist:

- Doc says `run … messages / workspace` and `run hitl {mode,pending,resume}`; source has `run interrupt` and no `run messages`.
- Doc says `workflow … from-template`; source has `import-template`.
- Doc lists `script|sc` with `list / show / profiles / materialize / run / validate / reload`; the file is `workflow-script.ts` at 187 LOC — thin for 9 server endpoints.
- Doc section 9 says direct mode "is not currently used; all commands go through HTTP" — but `index.tsx` ships `--local` and `DirectPlatformClient.ts` is 284 LOC and real.
- `completions.ts` (135 LOC) is **hand-maintained** and lists command names as string literals. It is guaranteed to drift and already has.

## 2.6 🟢 What is genuinely good — keep it

Do not throw these away:

- **`commands/device.ts` + `platform/authRuntime.ts`.** Device pairing with DPoP proofs, OS-backed secret vault via `@generatorai/secrets`, honest degradation to encrypted-file with 0600 perms, explicit deprecation warning on the legacy key, refusal to print resume secrets/tokens/private keys, and the cross-process `local-admin.json` contract with a documented reason for not importing the server package. This is better than most shipping products. It becomes the model for the whole rewrite.
- **5-layer config precedence** (`config/loadConfig.ts`) with Zod schema and named profiles. Correct design; just needs the connection catalog folded in.
- **`--json` on every command.** Keep as a hard invariant.
- **`utils/retry.ts`** withRetry on 429/5xx with exponential backoff.
- **Structured exit codes** (`utils/constants.ts` `EXIT_CODES`).
- **The `EventRenderer` verbosity model** (`minimal | normal | verbose`) and its filtering of internal turns (`__isInternalTurn` — hook context injection and validation feedback). That filtering logic is domain knowledge worth preserving; it should move into `client-core` so web/mobile get it too.

## 2.7 🟡 MEDIUM — Other findings

| # | Finding | Evidence |
|---|---|---|
| M1 | Ink 5 + React 18 while web is React 19 | `apps/cli/package.json`. Ink 6+ requires React 19; Ink 7 is current (v7.1.1). We are two majors behind and cannot use `alternateScreen`, `incrementalRendering`, `usePaste`, `useCursor`, `suspendTerminal`, kitty keyboard, or ARIA. |
| M2 | `run.ts` at 826 LOC and `HttpPlatformClient.ts` at 933 LOC are god-files | Options parsing, validation, profile loading, HTTP calls and rendering are all interleaved; nothing is unit-testable without a server. |
| M3 | Test coverage is one file | `__tests__/HttpPlatformClient.test.ts`, 117 LOC. The 601-LOC TUI has no tests in-tree (session-31 mentions `tui-e2e.test.tsx`; it is not present). |
| M4 | `getClient()` is a lazy singleton with no disposal | `index.tsx`. `shutdown()` calls `process.exit()` directly on SIGINT — no cleanup hook, so SSE sockets, WS sockets and PTYs would leak in a longer-lived process. |
| M5 | Multipart upload unimplemented | `uploadWorkflowFiles` / `uploadRunFiles` carry `// TODO: multipart`. Artifact upload is therefore impossible from the CLI. |
| M6 | No pagination anywhere | `listRuns()` with no cursor. Session-31 notes "119 workflows rendered correctly" — it renders all of them, every 5 s. |
| M7 | No OpenAPI-derived types | `apps/server/src/routes/openapi.ts` serves `/api/openapi.json` from `../openapi/spec.js`. Nothing consumes it. Client/server drift is caught only at runtime. |
| M8 | `--json` + prompts interaction is undefined behaviour | `usage-cli.md` §11.2 says `--json` "skips prompts and assumes defaults / refuses" — two different behaviours, unspecified per-command. |
| M9 | No version negotiation | `usage-cli.md` §11.5: "currently no strict compatibility check." With the CLI connecting to arbitrary remote servers, this becomes a real failure mode. |

---

# Part 3 — Gap matrix: server capability → CLI

Legend: ✅ full · ⚠️ partial · ❌ absent.

| Capability | Server | Web | CLI binary | TUI | Target |
|---|:--:|:--:|:--:|:--:|---|
| Chat CRUD / send / stream | ✅ | ✅ | ⚠️ | ❌ | ✅ / ✅ |
| Chat attachments, plan cards, question cards | ✅ | ✅ | ❌ | ❌ | ✅ / ✅ |
| Background tasks panel | ✅ | ✅ | ❌ | ❌ | ✅ / ✅ |
| Context-usage gauge | ✅ | ✅ | ❌ | ❌ | ✅ / ✅ |
| Workflow def CRUD + stages + edges | ✅ | ✅ | ✅ | ❌ | ✅ / ✅ |
| Visual DAG builder | — | ✅ | ❌ | ❌ | — / ✅ (read+edit, ASCII DAG) |
| Workflow runs + stage controls | ✅ | ✅ | ✅ | ❌ | ✅ / ✅ |
| HITL approve/reject + permission mode | ✅ | ✅ | ⚠️ | ❌ | ✅ / ✅ |
| Automations + executions | ✅ | ✅ | ✅ | ❌ | ✅ / ✅ |
| Projects / codebases / configs / MCP / worktrees | ✅ | ✅ | ✅ | ❌ | ✅ / ✅ |
| Workspaces + artifacts + file tree | ✅ | ✅ | ⚠️ | ❌ | ✅ / ✅ |
| **Integrated Terminal** | ✅ | ✅ | ❌ | ❌ | ✅ / ✅ (PTY attach) |
| **Integrated Browser** | ✅ | ✅ | ⚠️ | ❌ | ✅ / ✅ (graphics or ASCII) |
| **Computer Use** | ✅ | ✅ | ❌ | ❌ | ✅ / ✅ |
| **Extensions** | ✅ | ✅ | ❌ | ❌ | ✅ / ✅ |
| **Widgets** | ✅ | ✅ | ❌ | ❌ | ✅ (list/read) / ✅ |
| **Review threads** | ✅ | ✅ | ❌ | ❌ | ✅ / ✅ |
| **Source control / PR config** | ✅ | ✅ | ❌ | ❌ | ✅ / ✅ |
| **Security posture / secret backend** | ✅ | ✅ | ❌ | ❌ | ✅ / ✅ |
| Diff / changes / checkpoints | ✅ | ✅ | ⚠️ | ❌ | ✅ / ✅ |
| Agents (first-class) | ✅ | ✅ | ✅ | ❌ | ✅ / ✅ |
| Scripts (PWS) | ✅ | ✅ | ⚠️ | ❌ | ✅ / ✅ |
| Hooks | ✅ | ✅ | ⚠️ | ❌ | ✅ / ✅ |
| Device pairing / multi-server | ✅ | ✅ | ✅ | ❌ | ✅ / ✅ |
| Settings (12 sections) | ✅ | ✅ | ⚠️ | ⚠️ | ✅ / ✅ |
| Command palette | — | ✅ | ❌ | ❌ | — / ✅ |
| **Concurrent sessions / multiplexing** | — | ✅ (tabs) | ❌ | ❌ | ✅ (`--parallel`) / ✅ (panes) |
| **Companion / machine protocol** | — | — | ❌ | — | ✅ |

Roughly **65 endpoints and 9 whole feature areas** are unreachable from the CLI today.

---

# Part 4 — Prior art

## 4.1 OpenAI Codex CLI — *one protocol, many frontends*

The most instructive example. Codex began as TypeScript + Ink and was rewritten as a Rust workspace of ~100 crates. What matters is not the language, it is the **shape**:

- **`app-server` + `app-server-protocol` + `app-server-transport` + `app-server-client`.** A headless daemon speaking a versioned JSON-RPC protocol. The TUI, the IDE extension, the SDK, `exec` (headless) and `cloud-tasks` are *all clients of the same protocol*. `app-server-protocol-noop-macros` even precomputes protocol exports so the schema is generated, not hand-written.
- **`tui/` is a leaf crate** using **ratatui**. It has `styles.md` (a written style guide), a `frames/` directory, and `tests/` that were just decoupled from `codex-cli` (PR #38746) — i.e. the TUI is deliberately independent of the binary.
- **`terminal-detection/` is its own crate.** Commit history: *"Avoid requesting key-release events in Ghostty."* Terminal capability detection is treated as a first-class, testable concern — not `if (process.env.TERM)` sprinkled around.
- **`exec/` crate** = non-interactive mode, a peer of the TUI, not an afterthought.
- Separate crates for `hooks`, `skills`, `plugin`, `core-plugins`, `rollout` (session persistence/replay), `history`, `file-search`, `execpolicy`, `sandboxing`.

**Takeaways for us:** (a) a versioned machine protocol with many frontends is the correct spine — and we already have one, it is the REST+SSE API; (b) terminal capability detection deserves its own module; (c) non-interactive and interactive are peers.

## 4.2 Google Gemini CLI — *frontend/backend package split*

From the published architecture doc, explicitly two packages:

- **`packages/cli`** — "the user-facing portion": input processing, history management, display rendering, theme and UI customization, CLI configuration.
- **`packages/core`** — "the backend": API client, prompt construction, tool registration/execution, conversation/session state.

Stated design principle: *"Separating the CLI (frontend) from the Core (backend) allows for independent development and potential future extensions (e.g., **different frontends for the same backend**)."*

**Takeaway:** this is exactly the `cli-core` / `apps/cli` split proposed in Part 5, and it is what makes "binary + TUI + companion" three thin frontends instead of three codebases.

## 4.3 Claude Code, GitHub Copilot CLI, Canva CLI, Shopify CLI, Qodo Command — *Ink is the industry default for TS agents*

Ink's own README lists Claude Code, Gemini CLI and GitHub Copilot CLI first among its users. Ink is at **v7.1.1**, 39.7k stars, 98k dependents, actively maintained by Vadim Demedes and Sindre Sorhus. Relevant capabilities we currently cannot use on Ink 5:

| Ink 6/7 capability | Why we need it |
|---|---|
| `render(…, {alternateScreen: true})` | Full-screen app that restores the user's scrollback on exit. Table stakes. |
| `render(…, {incrementalRendering: true})` | Only redraw changed lines — required for token-rate streaming without flicker. |
| `render(…, {maxFps})` | Throttle re-render under high-frequency token events. |
| `render(…, {concurrent: true})` | Suspense + `useTransition` + `useDeferredValue` for interruptible updates. |
| `useApp().suspendTerminal(cb)` | **Hand the raw terminal to a child** (`$EDITOR`, `less`, `fzf`, **or a raw PTY proxy**) and restore Ink with a full repaint. This is how the integrated terminal pane becomes possible. |
| `usePaste` + bracketed paste | Multi-line prompt paste without it being read as 400 keystrokes. |
| `useCursor` | IME / CJK composition in the composer. |
| `useWindowSize` | Responsive layout on resize. |
| `useFocus` / `useFocusManager` (`focus(id)`, `activeId`) | Real Tab/Shift-Tab focus traversal — your "tabbing and everything". |
| `useBoxMetrics` / `measureElement` | Virtualized lists and scroll math. |
| kitty keyboard protocol (`mode: 'auto'`) | Disambiguate `Ctrl+I` vs `Tab`, `Shift+Enter` vs `Enter`, `Esc` vs `Ctrl+[`; key release events. Essential for a shortcut-dense UI. |
| ARIA props + `useIsScreenReaderEnabled` | Accessibility. |
| `renderToString()` | **Deterministic snapshot tests of the TUI** at a fixed column width. |

## 4.4 Charm / Bubble Tea — *what a TS TUI structurally lacks*

Bubble Tea v2 (44.4k stars, Elm architecture, cell-based renderer) plus Lip Gloss (styling), Bubbles (components), BubbleZone (mouse hit-testing), Harmonica (spring animation). It has native high-fidelity **mouse** handling, clipboard, focus/blur events.

Ink has **no built-in mouse support**. That is the one real capability gap and Part 6.4 says how we close it.

## 4.5 OpenCode — *client/server, many surfaces, one product*

TypeScript, 197k stars. A headless **opencode server** with a TUI client, a desktop app (Electron), a VS Code SDK, and per-language SDKs under `sdks/`. Built-in agent switching (`Tab` toggles `build` ↔ `plan`) and `@general` subagent invocation from the composer.

**Takeaways:** (a) our server-first architecture is already the winning one — we do not need to build a daemon, we have one; (b) a single-key agent/mode switch in the composer is a strong UX primitive we should copy directly onto our `agent` + `permissionMode` concepts; (c) `@mention` addressing inside the composer is the right way to reach agents/skills/files.

## 4.6 Terminal multiplexers — *what to copy and what not to*

Warp, tmux, Zellij. Your requirement is *"invoke multiple concurrent chat or workflow in parallel."*

**Do not** shell out to tmux/zellij or emit control-mode commands: it makes the product unusable for anyone not already running them and breaks on Windows.

**Do** copy the interaction grammar people already know:
- A **leader key** (`Ctrl+B` default, tmux-compatible, remappable) prefixing pane/tab operations.
- **Tabs** = one attached execution object each (chat / run / automation execution).
- **Splits** = horizontal/vertical panes within a tab.
- **Detach/attach** is free for us: runs live server-side, so "detach" is just closing the SSE subscription and "attach" is `Last-Event-ID` replay. That is strictly better than tmux, which must keep a process alive.
- **Zoom** (`leader z`) to temporarily maximize a pane.

---

# Part 5 — Target architecture

## 5.1 The shape

```
                       ┌──────────────────────────────────────────┐
                       │      apps/server  (any machine)          │
                       │  ~280 REST + /api/stream SSE + 3 WS      │
                       └──────────────────┬───────────────────────┘
                                          │  HTTPS + DPoP + SSE + WS
                     ┌────────────────────┴────────────────────┐
                     │                                          │
       ┌─────────────▼──────────────┐          ┌────────────────▼─────────────┐
       │  packages/client-transport │          │   apps/relay (optional)      │
       │  EndpointSupervisor,       │          │   tunnelled remote access    │
       │  httpCodec, Backoff        │          └──────────────────────────────┘
       └─────────────┬──────────────┘
                     │
       ┌─────────────▼──────────────┐   ┌──────────────────────────────┐
       │  packages/client-core      │   │  packages/client-runtime     │
       │  api/client, stream/       │   │  AuthenticatedClientRuntime, │
       │  eventRouter + reducer,    │   │  connections catalog,        │
       │  diff/parseUnifiedDiff     │   │  pairing, deviceKey          │
       └─────────────┬──────────────┘   └──────────────┬───────────────┘
                     └───────────────┬─────────────────┘
                                     │
                     ┌───────────────▼────────────────────┐
                     │   packages/cli-core   ★ NEW        │
                     │   ─────────────────────────────    │
                     │   • Command Registry (single       │
                     │     source of truth)               │
                     │   • Actions: pure async fns         │
                     │     (ctx, input) → Result<T>       │
                     │   • Session/pane model             │
                     │   • Ref resolution (id prefixes)   │
                     │   • Config + connection catalog    │
                     │   • Capability detection           │
                     │   • Renderer-agnostic view models  │
                     │   ZERO rendering. ZERO React.      │
                     └───┬──────────┬──────────┬──────────┘
                         │          │          │
       ┌─────────────────▼──┐  ┌────▼───────┐  ┌▼──────────────────────┐
       │  Surface A         │  │ Surface B  │  │  Surface C            │
       │  Scriptable binary │  │ TUI        │  │  Companion            │
       │  Commander 13      │  │ Ink 7 +    │  │  NDJSON/JSON-RPC      │
       │  --json, exit codes│  │ React 19 + │  │  over stdio           │
       │                    │  │ tui-kit ★  │  │  + host capabilities  │
       └────────────────────┘  └────────────┘  └───────────────────────┘
                                     │
                     ┌───────────────▼────────────────────┐
                     │   packages/tui-kit    ★ NEW        │
                     │   Ink component library:           │
                     │   Table, VirtualList, ScrollView,  │
                     │   TextInput/Composer, Select,       │
                     │   MultiSelect, Form, Tabs, Split,  │
                     │   Modal, Palette, Markdown, Diff,   │
                     │   DAG, Spinner, ProgressBar,        │
                     │   StatusBar, Toast, KeyHint         │
                     │   + theme from design-tokens/ansi   │
                     └────────────────────────────────────┘
```

## 5.2 The three surfaces

### Surface A — scriptable binary

```
generatorai <group> <verb> [args] [--flags]
```
Non-interactive, deterministic, pipeable. `--json` on everything. Structured exit codes. No TTY required. Works in CI. This is the surface the GeneratorAI app, shell scripts and other agents call.

### Surface B — TUI (`generatorai` with no args on a TTY, or `generatorai -i` / `generatorai tui`)

Full-screen, alternate-screen, multiplexed workbench. Web-app parity. Detailed in Part 8.

### Surface C — companion

```
generatorai companion --stdio            # NDJSON request/response over stdin/stdout
generatorai companion --socket <path>    # Unix socket / Windows named pipe
```

Two responsibilities:
1. **Machine gateway** — every registry action exposed as a callable method, so `apps/desktop` / `apps/server` / an agent tool can drive the CLI without parsing human output.
2. **Host-side capabilities the server cannot have** — because the server may be on another machine:
   - `host.openPath` / `host.revealInFileManager`
   - `host.openEditor` (`$EDITOR`, VS Code, etc.)
   - `host.spawn` (allowlisted, mirroring the `script` hook allowlist: `node`, `python`, `bash`, `git`, `echo`, `pwsh` — **never `cmd.exe`**, per AGENTS.md invariant #9)
   - `host.clipboard.{read,write}`
   - `host.notify` (OS notification on run completion / HITL gate)
   - `host.computerUse.*` (bridge to the local Orca computer-use daemon)
   - `host.pty.*` (a *local* PTY when the workspace is local)

**Security posture for Surface C:** the companion never accepts commands from the network. It binds stdio or a 0600 socket, requires a per-launch nonce handed to it by its parent (same pattern as `local-admin.json`), enforces an allowlist, and refuses any method not in the registry. Every `host.*` call is audit-logged.

## 5.3 Non-negotiable invariants

1. `packages/cli-core` **never imports Ink, React, chalk or any renderer.** Enforced by the existing ESLint boundaries config.
2. `apps/cli` **never makes a raw `fetch`.** All I/O goes through `client-core` / `client-transport` / `client-runtime`.
3. **One command registry.** CLI help, shell completions, TUI command palette, companion method list and the docs table are all generated from it. Hand-written completions are deleted.
4. **All three surfaces authenticate identically** through `AuthenticatedClientRuntime` + the connection catalog. `GENERATORAI_API_KEY` remains supported, warns once, and is documented as deprecated.
5. `--json` output is **schema-stable** and versioned (`{ apiVersion, kind, data }`), because scripts depend on it.
6. Every SSE/WS subscription is owned by a disposable and released on unmount — mirroring AGENTS.md invariant #6 (`acquireSseSlot()` release in `res.on('close')`).

---

# Part 6 — Tech stack, with rationale and rejected alternatives

## 6.1 Language & runtime

| Decision | Choice | Rationale | Rejected |
|---|---|---|---|
| Language | **TypeScript, Node ≥ 22** | Shares `@generatorai/shared` wire types, the `client-*` stack, `@generatorai/secrets`, and the SDK with zero marshalling. Ships in the same pnpm/turbo pipeline. | **Rust + ratatui** (Codex's path): best-in-class rendering and mouse, but forfeits every shared package, needs a duplicated type layer generated from OpenAPI, adds a second toolchain to CI and a per-platform release matrix. **Go + Bubble Tea**: same objection. The gains are rendering-quality only; the losses are architectural. |
| Module system | ESM, `"type": "module"` | Unchanged. | — |
| Bundling | **esbuild → single `.mjs`** (existing `esbuild.config.mjs` → `dist-bundle/generatorai.mjs`) | Already works; sub-100ms cold start matters for a CLI. | — |
| Standalone binary | **Node SEA** (`--experimental-sea-config`) for `generatorai` with no Node install | Official, no third-party packer. | `pkg` (deprecated), `bun build --compile` (adds a runtime). |

## 6.2 Surface A — scriptable binary

| Concern | Choice | Rationale |
|---|---|---|
| Arg parsing | **Commander 13** (keep) | Already in use; mature; supports nested commands, `exitOverride`, and per-command help. |
| **Command definition** | **New: declarative `CommandSpec` registry in `cli-core`** | The single most valuable structural change. `{ id, group, verb, summary, args: ZodSchema, flags: ZodSchema, scopes, handler, output }`. Commander commands, completions, the TUI palette and companion methods are all *derived*. |
| Validation | **Zod 3** (already a dep) | Reuse the exact schemas from `@generatorai/shared/config` where they exist so CLI validation cannot diverge from server validation. |
| Output | `output/` rewritten around a `Renderer` interface: `TableRenderer`, `JsonRenderer`, `NdjsonRenderer`, `YamlRenderer`, `QuietRenderer` | `--json` / `--ndjson` / `--yaml` / `--quiet` selected globally; handlers return data, never strings. |
| Tables | **`cli-table3`** + `string-width` | Correct CJK/emoji width; current `output/table.ts` (107 LOC) hand-rolls ANSI stripping. |
| Colour | **`picocolors`** replacing `chalk` | ~14× faster, 7× smaller, same API surface for our usage, respects `NO_COLOR`/`FORCE_COLOR`. Meaningful on cold start. |
| Prompts (non-TUI) | **`@inquirer/prompts`** | Only used when TTY *and* not `--json` *and* not `--yes`. |
| Spinners | `yocto-spinner` | Tiny, `NO_COLOR`-aware, degrades in CI. |
| Completions | **Generated** from the registry for bash/zsh/fish/pwsh/nushell, plus dynamic completion (`generatorai __complete <line>`) that can complete *IDs* by querying the server | Deletes 135 LOC of drift-prone literals and adds real ID completion. |

## 6.3 Surface B — TUI

| Concern | Choice | Rationale | Rejected |
|---|---|---|---|
| Renderer | **Ink 7** (from 5) + **React 19** (from 18) | Unlocks `alternateScreen`, `incrementalRendering`, `maxFps`, `concurrent`, `suspendTerminal`, `usePaste`, `useCursor`, `useWindowSize`, `useFocusManager.focus(id)`, kitty keyboard, ARIA, `renderToString`. Aligns CLI React with web React 19. | `blessed`/`neo-blessed` (unmaintained), `terminal-kit` (imperative), custom renderer (not worth it). |
| Layout | Ink's **Yoga flexbox** | Real responsive layout: `flexGrow`, `%` widths, `gap`, `overflow: hidden`, `position: absolute` for overlays. Replaces `'─'.repeat(50)`. |
| State | **Zustand vanilla** (keep) + `useSyncExternalStore` | Already correct, already used; works outside React for the binary surface too. Restructured into domain slices (Part 7.4). |
| Server cache | **`@tanstack/query-core`** + a ~120-LOC Ink adapter | *The same cache keys as `apps/web/src/hooks/queries.ts`.* Gives stale-while-revalidate, dedupe, retry, and — critically — **SSE-driven `invalidateQueries`** instead of 5-second polling. Framework-agnostic by design. ⚠️ *Decision point D3.* | Hand-rolled cache (we'd rebuild query-core badly); keep polling (rejected outright). |
| Streaming | **`client-core` `eventRouter` + `reducer`** | Delete `EventRenderer.ts` and `SSEClient.ts`. The reducer already turns a `PersistedEvent` stream into a message timeline for mobile; the TUI renders that timeline. Web/mobile/TUI then agree on ordering, interleaving and tool-call grouping by construction. |
| Text input | **Custom `Composer` in `tui-kit`** | `ink-text-input` is single-line and has no history/completion. We need: multi-line, bracketed paste (`usePaste`), `@`-mention autocomplete (agents/skills/files/codebases), `/`-slash commands, history ring with `↑`/`↓`, `Ctrl+E` → `$EDITOR` via `suspendTerminal`, IME via `useCursor`. |
| Lists | **Custom `VirtualList`** using `useBoxMetrics` | 119 workflows must not render 119 rows. Windowed rendering + scrollbar gutter + sticky header. |
| Markdown | **`marked` + custom Ink renderer** | Two-tier: raw text passthrough during streaming (cheap, no reflow jitter), full formatted re-render on `harness.message_complete`. This is what Claude Code and Gemini CLI do and it is the only way to keep token-rate rendering smooth. | `marked-terminal` (string-based, can't use Ink layout/focus). |
| Syntax highlight | **`cli-highlight`** (highlight.js) | Sync, no WASM, tiny. | `shiki` — 3+ MB and async; unacceptable for cold start. |
| Diff | **`client-core/diff/parseUnifiedDiff`** + new `DiffView` in `tui-kit` | Zero new parsing logic; reuses the exact model `ChangesSurface` uses in web. |
| DAG rendering | **`dagre` (layout only) + custom ASCII/Unicode box-drawing renderer** | React Flow can't run in a terminal; but the *layout* problem is solved. `dagre` gives node coordinates, we draw boxes + `─│┌┐└┘├┤┬┴┼` edges and route around collisions. Degrades to an indented tree at < 100 cols. |
| Images (browser/computer panes) | **Tiered by detected capability:** kitty graphics protocol → iTerm2 inline images → sixel → half-block Unicode (`▀` + 24-bit fg/bg) → ASCII luminance ramp | Ghostty/kitty/WezTerm users get real pixels; everyone else gets something. Driven by `cli-core/capabilities`. |
| Mouse | **Custom `useMouse` hook** in `tui-kit`: enable SGR mouse mode (`CSI ?1000;1002;1006 h`), parse `CSI < b ; x ; y M/m`, hit-test against `measureElement()` rects | Closes Ink's one real gap vs Bubble Tea. Opt-in (`tui.mouse: true`) because it disables native terminal text selection; `Shift`+drag remains the escape hatch and we tell the user so. |
| Theme | **New `design-tokens/emit/ansi.ts`** | Emits the existing **18 themes** to a `TerminalTheme` (24-bit + 256 + 16-colour + no-colour ladders). The TUI then ships gruvbox/nord/dracula/catppuccin/tokyo-night/etc. **for free**, semantically identical to the web app. |
| Keyboard | Ink kitty protocol `mode: 'auto'` + a **`Keymap` registry** in `cli-core` | Every binding declared as data → the help overlay, the palette hints and the docs are generated; bindings are user-remappable in config. |
| Terminal capabilities | **New `cli-core/capabilities/`** | Codex has a whole `terminal-detection` crate for this. Detect: truecolor (`COLORTERM`), 256-colour, graphics protocol, sixel, kitty keyboard, mouse, bracketed paste, unicode width mode 2027, hyperlinks (OSC 8), CI, screen reader, `NO_COLOR`, Windows Terminal vs conhost, WSL. |
| PTY pane | **Ink `suspendTerminal()` + raw WS proxy** | Attach: suspend Ink, put stdin in raw mode, pipe `stdin ⇄ WS ⇄ server PTY` byte-for-byte, forward `SIGWINCH` as a resize frame. Detach on the leader key: restore Ink, full repaint. **No `node-pty` client-side** — the PTY lives on the server. Falls back to a scrollback-only read view if the terminal can't do raw mode. |

## 6.4 Cross-cutting

| Concern | Choice |
|---|---|
| SSE | `client-transport` + `client-core/stream/sseParser`. Delete `eventsource` npm dep and `streaming/SSEClient.ts`. |
| WebSocket | **`ws`** for terminal / browser / computer frame streams, with the same `Backoff` policy as SSE. |
| Secrets | `@generatorai/secrets` (already). OS keychain → encrypted-file 0600 fallback, surfaced honestly in `device status` and Settings → Security. |
| Auth | `AuthenticatedClientRuntime` + `connections.ts` catalog + `pairing.ts`. **Used by all three surfaces, including the TUI.** |
| Config | Keep 5-layer precedence; add `connections` and `keymap` and `tui` sections; Zod-validated; `config migrate` for the URL-keyed → serverId-keyed move. |
| Logging | `pino` to a file (`~/.generatorai/logs/cli-*.log`), **never stdout** in TUI mode. `--verbose` mirrors to stderr in binary mode only. |
| Telemetry | Existing OTel setup (`instrumentation.ts`); keep opt-in, add TUI render-time spans behind `--verbose`. |
| Types | **Generate `openapi-typescript` types from `/api/openapi.json` in CI** and assert `client-core`'s client compiles against them. Closes finding M7. |
| Tests | `vitest` + `ink-testing-library` + `renderToString` snapshots + a `node-pty`-driven E2E harness. |
| Errors | One `CliError` hierarchy in `cli-core` mapping to `EXIT_CODES`; renderers decide presentation. |

---

# Part 7 — Workstreams

Fourteen workstreams. Each lists the files it creates/changes and its exit criteria.

## W0 — Foundations & upgrade

**Goal:** get the toolchain to a state where the rest is possible.

| Item | Detail |
|---|---|
| W0.1 | Bump `apps/cli`: `ink ^5.2.1 → ^7.1.1`, `react ^18.3.1 → ^19`, `@types/react ^18 → ^19`, `ink-testing-library ^4 → latest`. Remove `ink-spinner` (replaced by `tui-kit`), remove `eventsource` + `@types/eventsource`, replace `chalk` with `picocolors`. |
| W0.2 | Add deps: `@tanstack/query-core`, `ws`, `cli-table3`, `string-width`, `marked`, `cli-highlight`, `dagre`, `@inquirer/prompts`, `yocto-spinner`, `pino`. |
| W0.3 | Scaffold `packages/cli-core` and `packages/tui-kit` (package.json, tsconfig extending `tsconfig.base.json`, vitest config, turbo pipeline entries). |
| W0.4 | Add both to `eslint.config.mjs` boundary rules: `cli-core` may import `shared`, `client-core`, `client-transport`, `client-runtime`, `secrets`; **may not** import `react`, `ink`, `picocolors`, `core`, `db`, or any provider package. `tui-kit` may import `react`, `ink`, `cli-core`, `design-tokens`, `shared`; **may not** import `client-*` directly. |
| W0.5 | Add `packages/design-tokens/src/emit/ansi.ts` + `TerminalTheme` type + tests asserting all 18 themes emit valid 24-bit/256/16 ladders. |
| W0.6 | CI job: fetch `/api/openapi.json` from a booted server, run `openapi-typescript`, typecheck `client-core` against it, fail on drift. |

**Exit:** `pnpm build`, `pnpm typecheck`, `pnpm lint` green with the old CLI still functioning.

## W1 — `packages/cli-core`: the headless brain

```
packages/cli-core/src/
├── index.ts
├── registry/
│   ├── CommandSpec.ts          # { id, group, verb, summary, description, args, flags,
│   │                           #   scopes, examples, handler, output, sinceVersion }
│   ├── registry.ts             # register / resolve / list / groups / search
│   ├── toCommander.ts          # CommandSpec[] → Commander program
│   ├── toCompletions.ts        # CommandSpec[] → bash|zsh|fish|pwsh|nu scripts
│   ├── toPalette.ts            # CommandSpec[] → TUI palette entries
│   ├── toRpcMethods.ts         # CommandSpec[] → companion method table
│   └── toDocs.ts               # CommandSpec[] → usage-cli.md tables (CI-checked)
├── actions/                    # one file per domain; pure async (ctx, input) => Result<T>
│   ├── chat.ts        agent.ts        workflow.ts     run.ts
│   ├── stage.ts       automation.ts   project.ts      codebase.ts
│   ├── workspace.ts   artifact.ts     terminal.ts     browser.ts
│   ├── computer.ts    extension.ts    widget.ts       review.ts
│   ├── sourceControl.ts           security.ts         hook.ts
│   ├── webhook.ts     script.ts       template.ts     harness.ts
│   ├── system.ts      device.ts       connection.ts   config.ts
├── context/
│   ├── CliContext.ts           # { client, runtime, config, connection, capabilities,
│   │                           #   logger, signal, cache, renderer? }
│   └── createContext.ts
├── connection/
│   ├── ConnectionManager.ts    # wraps client-runtime connections catalog
│   ├── resolveEndpoint.ts      # endpoints[] failover via EndpointSupervisor
│   └── versionNegotiation.ts   # closes M9
├── refs/
│   └── resolveRef.ts           # "a3f2" | "#3" | "@last" | "chat:my-name" → full id
├── capabilities/
│   ├── detectTerminal.ts       # truecolor, graphics, sixel, kitty-kbd, mouse,
│   │                           # bracketed paste, OSC-8, unicode-2027, CI, screen reader
│   └── TerminalCapabilities.ts
├── keymap/
│   ├── defaults.ts             # every binding as data
│   └── Keymap.ts               # resolve, remap, conflict detection, render help
├── session/
│   ├── PaneModel.ts            # tab/split tree; the multiplexer's data model
│   ├── AttachmentManager.ts    # SSE/WS subscription lifecycle + Last-Event-ID resume
│   └── persistence.ts          # pane layout survives restart (~/.generatorai/tui-state.json)
├── viewmodels/                 # renderer-agnostic projections
│   ├── runTimeline.ts  chatTimeline.ts  dagLayout.ts  changesTree.ts
│   └── contextUsage.ts         # re-export of client-core
├── errors/CliError.ts
└── config/                     # moved from apps/cli, extended
    ├── schema.ts  loadConfig.ts  paths.ts  profileManager.ts  migrate.ts
```

**Key contract:**
```ts
export interface CommandSpec<A = unknown, F = unknown, R = unknown> {
  id: string;                          // 'run.start'
  group: string; verb: string; aliases?: string[];
  summary: string; description?: string; examples?: string[];
  args: z.ZodType<A>; flags: z.ZodType<F>;
  scopes?: string[];                   // required device scopes
  requiresServer: boolean;             // false for `config`, `device pair`, `completions`
  destructive?: boolean;               // forces confirm unless --yes
  sinceVersion: string;
  handler(ctx: CliContext, input: { args: A; flags: F }): Promise<Result<R>>;
  output: { kind: 'record' | 'list' | 'table' | 'stream' | 'void'; columns?: ColumnSpec[] };
}
```

**Exit:** every action unit-tested against a mocked `client-core`; **zero** React/Ink/renderer imports (lint-enforced).

## W2 — Adopt the shared client stack (deletes the fork)

| Step | Detail |
|---|---|
| W2.1 | Audit `apps/cli/src/platform/HttpPlatformClient.ts`'s ~130 methods against `client-core/src/api/client.ts`. Produce a delta list. |
| W2.2 | Add the missing methods **to `client-core`** (never back to the CLI): terminals (7), review (7), sourceControl (3), security (3), computer (14), extensions (9), widgets (9), plus workspace artifact upload/download (closes M5). Web and mobile gain them too. |
| W2.3 | Add cursor pagination to all list methods in `client-core` (closes M6). |
| W2.4 | Move the `__isInternalTurn` filtering and the `minimal/normal/verbose` verbosity model from `EventRenderer.ts` into `client-core/stream/` as a `TimelineFilter`. |
| W2.5 | **Delete** `apps/cli/src/platform/HttpPlatformClient.ts`, `platform/types.ts`, `streaming/SSEClient.ts`, `streaming/EventRenderer.ts`, `streaming/index.ts`, `utils/retry.ts`. **−1,932 LOC.** |
| W2.6 | Rework `DirectPlatformClient.ts` into `cli-core/transport/DirectAdapter.ts` on top of `client-transport/DirectTransport`, keeping `--local`. |
| W2.7 | Add `apps/cli` deps on `@generatorai/client-core` + `@generatorai/client-transport`. |

**Exit:** `apps/cli` contains **no `fetch(`, no `EventSource`, no `new WebSocket(` outside `tui-kit`'s PTY proxy**; grep-enforced in CI.

## W3 — Connections & auth unification

| Step | Detail |
|---|---|
| W3.1 | `ConnectionManager` over `client-runtime/connections.ts`: serverId-keyed catalog, `endpoints[]`, `kind`, `managed`, `lastConnectedAt`, host pinning. |
| W3.2 | New command group: `generatorai connect` — `add` · `list` · `use` · `rename` · `remove` · `test` · `endpoints add/remove`. |
| W3.3 | `device pair` writes into the catalog rather than the flat vault namespace; `config migrate` moves existing URL-keyed credentials to serverId keys without re-pairing where the fingerprint can be recovered, and prints an explicit re-pair instruction where it cannot. |
| W3.4 | **TUI uses `getCliAuthRuntime()`.** Delete the `process.env['GENERATORAI_API_KEY'] = …` assignment in `tui/index.tsx`. Fixes finding 2.3. |
| W3.5 | TUI first-run pairing flow: no credential → full-screen pairing wizard (enter short code / scan `invite` output / choose local server) instead of a dead `disconnected` status line. |
| W3.6 | Relay awareness: if `endpoint` is a relay URL, surface it in the status bar and in `connect test`. |
| W3.7 | `versionNegotiation.ts`: on connect, compare CLI version against `GET /api/health` server version; warn on minor mismatch, refuse + explain on major (closes M9). |

**Exit:** `generatorai connect add https://box.lan:3100 && generatorai device pair <code> && generatorai --interactive` works end-to-end against a remote machine, with two servers registered and switchable.

## W4 — `packages/tui-kit`

```
packages/tui-kit/src/
├── theme/  ThemeProvider.tsx  useTheme.ts  fromDesignTokens.ts  ansiLadder.ts
├── layout/ Screen.tsx  Split.tsx  Tabs.tsx  Panel.tsx  StatusBar.tsx
│           Overlay.tsx  Modal.tsx  Toast.tsx
├── data/   Table.tsx  VirtualList.tsx  ScrollView.tsx  Tree.tsx
│           EmptyState.tsx  Skeleton.tsx  Badge.tsx  StatusPill.tsx
├── input/  Composer.tsx        # multi-line, paste, @mention, /slash, history, $EDITOR
│           TextInput.tsx  Select.tsx  MultiSelect.tsx  Confirm.tsx
│           Form.tsx  SearchInput.tsx  KeyHint.tsx
├── content/ Markdown.tsx  Code.tsx  DiffView.tsx  JsonView.tsx  Image.tsx
├── viz/    DAG.tsx  Timeline.tsx  ProgressBar.tsx  Sparkline.tsx  Gauge.tsx
├── feedback/ Spinner.tsx  ErrorBoundary.tsx
└── hooks/  useMouse.ts  useScroll.ts  useVirtual.ts  useKeymap.ts
          useTerminalSize.ts  useDebounced.ts  usePtyAttach.ts  useGraphics.ts
```

Each component gets a `renderToString()` snapshot test at 80, 120 and 200 columns and in the no-colour ladder.

**Exit:** a storybook-equivalent (`pnpm --filter @generatorai/tui-kit gallery`) that renders every component to a golden file.

## W5 — TUI shell

- Alternate screen, `incrementalRendering`, `maxFps: 30` (configurable), `concurrent: true`, kitty keyboard `auto`.
- `AppShell`: `TitleBar` (connection + server label + device + theme) / `WorkbenchTabs` / `PaneTree` / `StatusBar` / overlays (`CommandPalette`, `Help`, `Toast`, `Modal`).
- Global keymap from `cli-core/keymap`, leader key, focus traversal via `useFocusManager` with **named focus IDs** so `focus('composer')` works directly.
- `SIGWINCH` handling, graceful `Ctrl+C` (confirm if streams are attached), clean unmount that disposes every subscription (fixes M4).
- Crash boundary that dumps state to `~/.generatorai/logs/` and restores the terminal rather than leaving it in raw mode.

## W6 — Multiplexing (the "invoke multiple concurrent chats/workflows in parallel" requirement)

- `PaneModel`: tabs, each a binary split tree; `zoom`; per-pane `AttachmentManager`.
- Leader-key grammar (`Ctrl+B` default): `c` new tab · `n`/`p` next/prev · `1..9` jump · `%` v-split · `"` h-split · `arrows` focus move · `z` zoom · `x` close · `,` rename · `d` detach · `[` scroll mode.
- **Attach/detach is free:** detach = drop the SSE subscription; attach = reconnect with `Last-Event-ID` + REST replay. Runs continue server-side regardless.
- Layout persisted to `~/.generatorai/tui-state.json`; `generatorai tui --restore` reattaches everything.
- Binary-surface counterpart: `generatorai run start <a> <b> <c> --parallel --watch` fans out and renders N interleaved, prefixed streams; `--json` emits NDJSON tagged with the run id.

## W7 — Chat surface (parity with `ChatPage`)

- **View:** message timeline from `client-core` reducer — `UserMessage`, `AssistantMessage` (streaming two-tier markdown), `ToolMessage` (collapsed, expand on Enter), reasoning/thinking blocks (toggle), `PlanCard`, `QuestionCard`, `StepRow`, `UsageChip`, `ContextUsageGauge`, `BackgroundTasksPanel`.
- **Composer:** multi-line, bracketed paste, `@` mentions (agents, skills, codebases, files, artifacts), `/` slash commands sourced from the registry, history ring, `Ctrl+E` → `$EDITOR` via `suspendTerminal`, model picker (`Ctrl+M`), agent picker (`Tab`, OpenCode-style), permission-mode cycle (`Ctrl+P`).
- **Attachments:** `chat attach <path>` and drag-equivalent via `/attach`; closes the upload gap from M5.
- **Voice:** out of scope for v1 (web has `VoiceRecorder`); tracked in Part 15.

## W8 — Workflow surfaces

- **Definition list** (virtualized, filter, search, tags) → **Definition detail**: metadata, variables, hooks, stages table, edges table, and an **ASCII DAG** via `dagre` + box-drawing; `<` `>` to fold; degrades to an indented tree below 100 cols.
- **Builder (edit mode):** add/update/delete stage, add/delete edge with all four edge types, edit prompt in `$EDITOR`, variables editor, hooks editor, harness config overrides, validate-on-save via `validateDefinition`.
- **Run view:** header bar (status, elapsed, cost, model), stage timeline, live per-stage streams, `RightInspector` equivalent, inline HITL controls, stage-level pause/resume/retry/cancel, run pause/resume/cancel/retry.
- **HITL:** `awaiting_input` stages raise a modal + a toast + optional `host.notify` via companion; approve/reject/edit-value inline. Permission-mode switcher covers all four modes.

## W9 — Right-pane parity: Changes · Inspector · Browser · Terminal · Computer

The hardest workstream; this is where the TUI stops being a list app.

| Tab | Approach |
|---|---|
| **Changes** | `ChangesTree` (virtualized file tree, status glyphs) + `DiffView` (unified default, side-by-side ≥ 160 cols) from `client-core/diff/parseUnifiedDiff` + `CheckpointTimeline`. Review threads: create/reply/resolve inline (the 7 `review.ts` endpoints). |
| **Inspector** | Stage/session detail, resolved config after `ConfigResolver` merge, tool-call tree, raw event log with filters, artifact list. |
| **Terminal** | `usePtyAttach`: leader-key or `Enter` → `suspendTerminal()` → raw `stdin ⇄ ws ⇄ /api/workspaces/:id/terminals/:sid/stream` → leader-key detaches and repaints Ink. Multi-tab mirrors the web. Non-attached state shows a scrollback tail. Respects `GENERATORAI_TERMINAL=0` (501 → clear message). |
| **Browser** | Controls always work (navigate/back/forward/reload/screenshot/snapshot/inspect). Live view is capability-tiered: kitty graphics → iTerm2 → sixel → half-block Unicode → "press `s` for a screenshot written to `<path>`". Frame rate clamped well below `GENERATORAI_BROWSER_STREAM_FPS`. |
| **Computer Use** | Same tiering for window frames; audit log list; consent prompts surfaced as modals. Honours the `GENERATORAI_COMPUTER_USE` kill switch. |

## W10 — Remaining domain surfaces

Automations (list/detail/executions/trigger/enable/disable/rotate token/data-source test) · Projects & codebases (link/fetch/branches/browse/file view/worktrees) · Workspaces & artifacts (tree, download, upload, commit, archive, cleanup) · Agents (list/editor/overrides/capabilities/tool policy/resolve preview) · Scripts (list/detail/profiles/materialize/run/validate/reload) · Extensions & widgets (list/enable/disable/install/read widget state) · Source control (provider, PR config) · Security (posture, secret backend, device list, audit) · Settings (all 12 web sections) · Dashboard (health, activity, stats, quick actions).

## W11 — Companion mode

```
apps/cli/src/companion/
├── server.ts          # stdio NDJSON + unix socket / named pipe
├── protocol.ts        # versioned envelope { v, id, method, params } / { v, id, ok|error }
├── methods.ts         # generated from registry via toRpcMethods()
├── host/              # capabilities the remote server cannot have
│   ├── openPath.ts  openEditor.ts  spawn.ts  clipboard.ts
│   ├── notify.ts    computerUse.ts  pty.ts
│   └── allowlist.ts   # node|python|bash|git|echo|pwsh — never cmd.exe
└── audit.ts
```

- Auth: per-launch nonce from the parent process, same pattern as `local-admin.json`; socket 0600; **never binds a network port**.
- Streaming methods emit `{ v, id, event }` frames; cancellation via `{ method: 'cancel', params: { id } }`.
- Consumed by `apps/desktop` (spawn the companion for host-side actions) and by the server as an agent tool (`companion.host.*`), gated by capability grants.
- **New server route group** `POST /api/companion/invoke` for the "server asks the paired CLI to do a host thing" direction, routed over the existing device channel and scope-gated. *Decision point D5.*

## W12 — Output, docs & completions generation

- `--json` envelope: `{ apiVersion: 1, kind, data, warnings?[] }`. Documented and snapshot-tested.
- `--ndjson` for streams; `--yaml`; `--quiet` (exit code only).
- `generatorai completions <shell>` generated from the registry; plus `generatorai __complete` for dynamic ID completion.
- `toDocs.ts` regenerates the command tables in `.github/docs/usage-cli.md`; **CI fails if the committed doc differs**. Fixes finding 2.5 permanently.
- `generatorai --help` and `generatorai <group> --help` are registry-derived.

## W13 — Testing

| Layer | Tool | What |
|---|---|---|
| Unit | vitest | Every `cli-core` action against a mocked `client-core`; ref resolution; keymap conflicts; config precedence + migration; capability detection matrix. |
| Component | `ink-testing-library` + `renderToString` | Golden snapshots for every `tui-kit` component at 80/120/200 cols × {truecolor, 256, 16, none}. |
| Integration | vitest + a mock server (msw or a real ephemeral server) | Full command flows; SSE resume with `Last-Event-ID`; WS reconnect; pagination. |
| E2E (binary) | vitest spawning `dist-bundle/generatorai.mjs` | Extend `agent-tests/cli-e2e.test.ts`. Every command × `--json`. Exit codes. |
| **E2E (TUI)** | **`node-pty` harness** | Spawn the real TUI in a pseudo-terminal at a fixed size, send keystrokes, assert on the rendered framebuffer. This is how Codex tests its TUI and it is the only honest way. New file: `agent-tests/tui-e2e.mjs`. |
| Companion | vitest | Protocol conformance, allowlist enforcement, nonce rejection, audit completeness. |
| Contract | CI | OpenAPI drift check (W0.6); docs drift check (W12); `no raw fetch in apps/cli` grep (W2). |

Target: **≥ 80% line coverage on `cli-core`**, every `tui-kit` component snapshotted, every command in `CLI_TEST_CATALOG.md` exercised.

## W14 — Packaging, migration & docs

- esbuild bundle + Node SEA binaries for win-x64, darwin-arm64, darwin-x64, linux-x64, linux-arm64.
- `generatorai upgrade` (self-update with signature check) — *Decision point D6.*
- Rewrite `.github/docs/usage-cli.md` (generated tables + hand-written narrative); new `.github/docs/feature-tui.md`; update `.github/docs/apps.md` and the AGENTS.md feature matrix.
- Deprecation shims: old command spellings (`workflow import-template`, `run interrupt`) alias to the new ones and print a one-line deprecation for one minor version.

---

# Part 8 — TUI design spec

## 8.1 Layout

```
┌─ GeneratorAI ── ● box.lan (remote) ── device: sid-laptop ── gruvbox ──── 14:22 ─┐
│ [1 chat:auth-refactor] [2 run:nightly-e2e ⟳] [3 wf:builder] [+]                 │  ← Workbench tabs
├──────────────────────────────┬──────────────────────────────────────────────────┤
│                              │  Changes  Inspector  Browser  Terminal  Computer │  ← RightPane tabs
│  ▌ user                      │  ┌──────────────────────────────────────────────┐│
│  │ refactor the auth module  │  │ M  src/auth/session.ts            +42 -11    ││
│  │                           │  │ A  src/auth/dpop.ts               +180 -0    ││
│  ▌ assistant        ⣾ 1.2k/s │  │ M  packages/core/src/…/Auth.ts     +8  -3    ││
│  │ I'll start by reading the │  ├──────────────────────────────────────────────┤│
│  │ existing session handling │  │ @@ -12,7 +12,9 @@                            ││
│  │                           │  │  export class SessionStore {                 ││
│  │  ▸ read_file  session.ts  │  │ -  private key: string;                      ││
│  │  ▸ grep  "refreshToken"   │  │ +  private key: CryptoKey;                   ││
│  │  ⣾ edit_file  dpop.ts     │  │ +  private thumbprint: string;               ││
│  │                           │  └──────────────────────────────────────────────┘│
├──────────────────────────────┴──────────────────────────────────────────────────┤
│ ▌ ▏                                                            claude-sonnet-4.6│  ← Composer
│   @mention  /command  ⏎ send  ⇧⏎ newline  ^E editor  ^M model  ⇥ agent          │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ● connected  ctx 42% ████░░░░░░  $0.31  ^B leader  ^K palette  ? help  ^C quit  │  ← Status bar
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 8.2 Responsive breakpoints

| Width | Layout |
|---|---|
| ≥ 160 cols | Main + RightPane side by side; diffs side-by-side; DAG full graph. |
| 120–159 | Main + RightPane; diffs unified; DAG full graph. |
| 100–119 | RightPane becomes an overlay toggled by leader-key; DAG full graph. |
| 80–99 | Single column; DAG → indented tree; tables drop low-priority columns. |
| < 80 | Compact mode; status bar collapses to icons; warn once. |
| < 60 or non-TTY | Refuse to launch the TUI; print "use `generatorai <command>` or resize". |

Rows < 20: composer shrinks to 1 line, status bar merges into the title bar.

## 8.3 Keymap (defaults, all remappable)

**Global**

| Key | Action |
|---|---|
| `Ctrl+K` / `Ctrl+P` | Command palette |
| `?` | Help overlay (generated from the keymap registry) |
| `Ctrl+B` | Leader (pane/tab ops) |
| `g` then `d/c/w/r/a/p/s/x` | Go to Dashboard/Chats/Workflows/Runs/Automations/Projects/Scripts/Settings |
| `Tab` / `Shift+Tab` | Focus next/previous region |
| `Ctrl+R` | Refresh active query |
| `/` | Search within the focused list |
| `Esc` | Close overlay / leave scroll mode / go back |
| `Ctrl+C` | Quit (confirm when streams are attached) |

**Leader (`Ctrl+B`, tmux grammar)** — `c` new tab · `n`/`p` next/prev tab · `1..9` jump · `%` v-split · `"` h-split · `←↑↓→` focus pane · `z` zoom · `x` close pane · `,` rename tab · `d` detach stream · `[` scroll mode · `t` toggle RightPane · `?` leader help

**Lists** — `↑↓`/`jk` move · `PgUp/PgDn` page · `Home/End` · `Enter` open · `n` new · `e` edit · `d` delete (confirm) · `Space` select · `f` filter · `s` sort · `y` yank id

**Chat** — `Enter` send · `Shift+Enter` newline · `Ctrl+E` `$EDITOR` · `Ctrl+M` model · `Tab` agent · `Ctrl+P` permission mode · `Ctrl+L` clear · `Ctrl+X` stop generation · `@` mention · `/` slash

**Run** — `p` pause · `r` resume · `c` cancel · `R` retry · `a` approve HITL · `x` reject HITL · `s` stage detail · `l` toggle log verbosity

## 8.4 Theming

`design-tokens/emit/ansi.ts` maps semantic tokens → ANSI. Same 18 theme names as the web app, so `Settings → Appearance → gruvbox` looks like gruvbox in both. Selection order: `config.tui.theme` → `GENERATORAI_THEME` → terminal background detection (OSC 11) → `auto`. Colour ladder chosen by `detectTerminal()`; `NO_COLOR` forces the glyph-only ladder where status is conveyed by symbols, not hue.

## 8.5 Accessibility

- ARIA props on every `tui-kit` component; `useIsScreenReaderEnabled` switches lists to a linear, announced form.
- Never colour-only: every status has a glyph (`⟳ ✓ ✗ ⊘ ○ ⏸ ⏳`).
- `--no-unicode` ASCII fallback glyph set.
- Motion: spinners honour `prefers-reduced-motion` equivalent (`GENERATORAI_REDUCED_MOTION=1`) and CI detection.

---

# Part 9 — Full command surface

25 groups. Bold = new or substantially expanded.

```
generatorai
├── connect ★         add · list · use · rename · remove · test · endpoints {add,remove}
├── device            pair · status · forget · list · revoke · invite · audit
├── config            show · get · set · edit · reset · migrate ★ · profile {list,create,use,delete}
├── system            health · health-config · models · status · artifacts · mcp-servers · version ★
├── security ★        posture · secret-backend · audit
├── chat              list · create · show · send · messages · watch · attach ★ · fork ★
│                     archive · delete · export ★
├── agent             list · show · create · update · delete · export · import · usage · resolve
├── workflow (wf)     list · create · show · update · delete · validate · export
│                     import-json · import-template (alias from-template) · clone ★
│                     stage {list ★,add,show ★,update,delete}
│                     edge {list ★,add,delete}
│                     var ★ {list,set,delete}   hook ★ {list,add,delete}
├── run               list · start · show · watch · messages ★ · pause · resume · cancel · retry
│                     stage {list,show ★,pause,resume,retry,cancel}
│                     hitl ★ {mode,pending,approve,reject}
│                     profile {list ★,generate,validate}
│                     diff ★ · changes ★ · artifacts ★
├── automation (auto) list · create · show · update · delete · enable · disable · trigger
│                     rotate-webhook-token · execution {list,show,cancel} · datasource test ★
├── project (proj)    list · create · show · update · delete
│                     codebase {list,link,fetch,branches,browse,file,update,unlink}
│                     config {list,upload,get,update,delete}
│                     mcp {list,add,update,remove}
│                     worktree {list,remove,cleanup}
├── workspace (ws)    list · show · archive · commit · delete · cleanup
│                     worktree list · files ★ · get ★ · put ★ · tree ★
├── artifact ★        list · get · put · delete
├── terminal ★        list · create · attach · send · resize · kill
├── browser           start · stop · status · navigate · back ★ · forward ★ · reload ★
│                     screenshot · snapshot · inspect · snapshots · tail · share ★
├── computer ★        apps · windows · state · read · click · type · key · scroll · frame · audit
├── extension ★       list · show · enable · disable · install · uninstall · reload
├── widget ★          list · show · read · close
├── review ★          list · create · reply · resolve · unresolve · delete
├── source-control ★  status · provider · pr-config {show,set}
├── hook              phases · test · list ★ · add ★ · delete ★
├── webhook           list · create · delete
├── script (sc)       list · show · profiles · materialize · run · validate · reload
├── template          list · show · apply ★
├── harness           show · switch · models ★
├── orchestrator      templates · template · create · start · context · runs · cancel
├── companion ★       --stdio · --socket <path>
├── tui  /  -i, --interactive ★
├── init              (bootstrap)
├── completions       bash · zsh · fish · powershell · nushell ★
└── upgrade ★
```

**Global flags:** `--json` · `--ndjson` ★ · `--yaml` ★ · `--quiet` ★ · `--server <url>` · `--connection <name>` ★ · `--api-key <key>` (deprecated) · `--local` · `--config-profile <name>` · `--verbose` · `--no-color` · `--no-unicode` ★ · `--yes` ★ · `--timeout <ms>` ★ · `-i/--interactive` ★

---

# Part 10 — Companion mode spec

**Wire format** — NDJSON, one JSON object per line.

```jsonc
// request
{ "v": 1, "id": "01J…", "method": "run.start",
  "params": { "definitionId": "…", "variables": { "topic": "caching" }, "watch": true } }

// streaming frames
{ "v": 1, "id": "01J…", "event": { "kind": "harness.token", "data": { "text": "Sure" } } }

// terminal
{ "v": 1, "id": "01J…", "ok": true, "data": { "runId": "…", "status": "completed" } }
{ "v": 1, "id": "01J…", "ok": false, "error": { "code": "VALIDATION", "message": "…" } }

// control
{ "v": 1, "id": "01J…", "method": "cancel", "params": { "target": "01J…" } }
{ "v": 1, "method": "describe" }   // → full method table, generated from the registry
```

**Method namespaces**

| Namespace | Source | Notes |
|---|---|---|
| `<group>.<verb>` | Generated from `CommandSpec[]` | 1:1 with the binary surface. |
| `host.*` | Hand-written, allowlisted | The whole reason companion mode exists. |
| `describe` / `cancel` / `ping` | Protocol built-ins | |

**Security**
- stdio, or a socket at 0600 (Unix) / a named pipe with a restrictive DACL (Windows). **Never a TCP port.**
- Handshake requires a nonce passed by the parent via env or the first frame; mismatched nonce → immediate exit 77.
- `host.spawn` allowlist = the hook allowlist (`node`, `python`, `bash`, `git`, `echo`, `pwsh`); `cmd.exe` explicitly denied, matching AGENTS.md invariant #9.
- Every `host.*` call appended to `~/.generatorai/logs/companion-audit.ndjson` with method, args hash, caller nonce id, result and timing.
- Path arguments are canonicalized and checked against configured roots; symlink escapes rejected.

**Consumers**
1. `apps/desktop` — spawns the companion for `openEditor`, `revealInFileManager`, `notify`, local PTY.
2. `apps/server` — an agent tool `companion.invoke` routed to the paired CLI over the device channel, scope-gated, requiring an explicit capability grant (reuse the session-110 capability-grant mechanism). *Decision D5.*
3. External agents / scripts — `generatorai companion --stdio` is a stable, documented integration point.

---

# Part 11 — Migration & compatibility

| Concern | Approach |
|---|---|
| Credentials | `config migrate` moves URL-keyed vault entries to serverId-keyed catalog entries; where the host fingerprint cannot be recovered, prints the exact `device pair` command to run. No silent credential loss. |
| Legacy API key | Keeps working through v1.x. Warns once per process (existing behaviour). Removed in v2.0 with a documented date. |
| Command spellings | `import-template`, `run interrupt`, and any other drifted names alias to the new spelling and print one deprecation line to **stderr** (never stdout, so `--json` pipes stay clean). |
| `--json` shape | v1 shape is the bare payload; new shape is the envelope. Gate on `GENERATORAI_JSON_ENVELOPE=1` for one minor version, then flip the default and offer `--json-legacy`. |
| Old TUI | `generatorai tui --legacy` retained for exactly one minor version, then deleted. |
| Config file | Zod schema versioned; `loadConfig` upgrades in place with a `.bak`. |
| Scripts in the wild | `agent-tests/cli-e2e.test.ts` and `.github/docs/CLI_TEST_CATALOG.md` are the regression net — every existing invocation must keep passing. |

---

# Part 12 — Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Ink 5→7 + React 18→19 breaks the existing TUI mid-migration | High | Medium | Do W0.1 first, behind `tui --legacy`; the new TUI is a new tree, not a patch. |
| R2 | `client-core` API client turns out to lag the CLI's client in coverage | Medium | High | W2.1 produces an explicit delta list *before* any deletion; nothing is deleted until parity is proven by test. |
| R3 | Rendering perf at token rate (Ink diffing on every token) | Medium | High | `incrementalRendering` + `maxFps` + batch tokens into ~50 ms frames in the reducer + `<Static>` for completed messages so only the live message re-renders. |
| R4 | Windows terminal fragmentation (conhost vs Windows Terminal vs WSL) | High | Medium | `detectTerminal()` matrix + a dedicated Windows CI leg + conservative defaults on conhost (no mouse, no graphics, 16-colour). |
| R5 | PTY attach leaves the terminal in raw mode after a crash | Medium | High | `suspendTerminal`'s own restore + a `process.on('exit'/'uncaughtException')` handler that emits the reset sequence; E2E test that kills the process mid-attach and asserts the tty is sane. |
| R6 | Graphics protocols unusable for most users → browser pane feels broken | Medium | Medium | Controls-first design: the pane is fully useful with zero pixels. Images are a bonus tier, and the fallback explicitly says what to press. |
| R7 | Mouse mode breaks native text selection and users blame us | Medium | Low | Off by default; when enabled, the status bar shows `mouse: on (Shift+drag to select)`. |
| R8 | `@tanstack/query-core` adds weight / complexity for a CLI | Low | Medium | ~13 kB gz, tree-shakeable, no React dep. If D3 says no, fall back to a hand-rolled cache with the same key shape. |
| R9 | Scope creep — the TUI tries to be the whole web app | High | High | Parity is defined by the Part 3 matrix and nothing else. Anything not in it is Part 15. |
| R10 | Two client stacks coexist during migration and drift again | Medium | High | W2 is a hard cut with a CI grep gate; it is not allowed to remain half-done across phases. |

---

# Part 13 — Sequencing

Each phase ends shippable.

| Phase | Workstreams | Deliverable |
|---|---|---|
| **P0 · Foundations** | W0 | Ink 7 + React 19, `cli-core` + `tui-kit` scaffolded, ANSI theme emitter, OpenAPI drift gate. Old CLI still works. |
| **P1 · Brain** | W1, W2 | `cli-core` with the registry + all actions on `client-core`. **−1,932 LOC deleted from `apps/cli`.** Binary surface rebuilt on the registry. Generated completions + generated docs. |
| **P2 · Connect** | W3 | Multi-server catalog, `connect` group, TUI on the real auth runtime, pairing wizard, version negotiation. Remote-machine story complete. |
| **P3 · Kit + Shell** | W4, W5 | `tui-kit` with golden snapshots; full-screen shell with tabs, focus, palette, help, themes. Read-only navigation across every domain. |
| **P4 · Live** | W6, W7 | Multiplexing (tabs/splits/attach/detach) + the chat surface with real streaming. **This is the first release that is better than the web app for its use case.** |
| **P5 · Workflows** | W8 | Definitions, ASCII DAG, builder, run view, HITL. |
| **P6 · Right pane** | W9 | Changes/diff/review, Inspector, Terminal attach, Browser, Computer Use. |
| **P7 · Completion** | W10 | Automations, projects, workspaces, artifacts, agents, scripts, extensions, widgets, source control, security, settings, dashboard. Part 3 matrix fully ✅. |
| **P8 · Companion** | W11 | Companion protocol + host capabilities + desktop/server integration. |
| **P9 · Harden** | W12, W13, W14 | Full test pyramid, packaging, SEA binaries, docs rewrite, deprecation shims. |

---

# Part 14 — Definition of done

1. Every row in the Part 3 matrix reads ✅ for both CLI and TUI.
2. `grep -rE "fetch\(|new EventSource|new WebSocket" apps/cli/src` returns nothing outside the PTY proxy — CI-enforced.
3. `packages/cli-core` has zero imports of `react`, `ink`, or any renderer — lint-enforced.
4. `.github/docs/usage-cli.md` command tables are generated; CI fails on drift.
5. OpenAPI drift check green.
6. `cli-core` ≥ 80% line coverage; every `tui-kit` component has golden snapshots at 3 widths × 4 colour ladders.
7. TUI E2E via `node-pty` passes on Windows (Windows Terminal + conhost), macOS and Linux.
8. TUI launches to first paint in < 400 ms on a warm cache.
9. Streaming holds ≥ 30 fps rendering at 2,000 tok/s without dropped frames.
10. `generatorai connect add <remote> && generatorai device pair <code> && generatorai -i` works against a server on another machine, over LAN and over the relay.
11. No credential, token or private key is ever printed by any surface (the `device.ts` standard, extended to all three surfaces).
12. AGENTS.md invariants 1–15 all still hold; the feature matrix in AGENTS.md §7 is updated.

---

# Part 15 — Decisions I need from you

| # | Decision | Options | My recommendation |
|---|---|---|---|
| **D1** | Language | (a) stay TypeScript/Ink; (b) Rust/ratatui like Codex | **(a).** Rust buys rendering quality and costs us the entire shared package stack, a duplicated type layer, a second toolchain, and a per-platform release matrix. The bottleneck today is architecture, not rendering. |
| **D2** | New packages | (a) `cli-core` + `tui-kit` as proposed; (b) keep everything in `apps/cli` | **(a).** It is exactly the Gemini CLI split, and it is what makes three surfaces cheap instead of three codebases. |
| **D3** | Server-state cache | (a) `@tanstack/query-core`; (b) hand-rolled | **(a)**, so TUI and web share cache-key shape and SSE-driven invalidation semantics. Cheap to reverse. |
| **D4** | Multiplexing model | (a) in-process panes with tmux-style leader key; (b) shell out to tmux/zellij | **(a).** (b) is unusable on Windows and for anyone not already a tmux user. |
| **D5** | Server → CLI companion channel | (a) build `POST /api/companion/invoke` + capability grant; (b) companion is desktop/local-only for v1 | **(b) for v1, (a) in P8.** The security design deserves its own review pass. |
| **D6** | Self-update | (a) `generatorai upgrade` with signature check; (b) defer to package managers | **(a)**, given the CLI talks to arbitrary servers and version skew is a real failure mode. |
| **D7** | Browser/computer live view | (a) tiered graphics as specced; (b) controls + screenshot-to-file only | **(a)**, but ship (b) first in P6 and add tiers behind capability detection. |
| **D8** | Voice input (web has `VoiceRecorder`) | (a) in scope; (b) defer | **(b).** Needs mic capture + the Whisper STT path; not core to the terminal use case. |
| **D9** | Legacy `--json` shape | (a) envelope with a one-minor opt-in; (b) breaking change now | **(a).** |
| **D10** | Timeline | Confirm P0–P9 phasing and whether any phase should be reordered | Ship P0–P4 as a unit; that is the point where the TUI becomes genuinely better than the alternatives. |

---

## Appendix A — Files deleted

| File | LOC | Replaced by |
|---|---:|---|
| `apps/cli/src/platform/HttpPlatformClient.ts` | 933 | `@generatorai/client-core` `api/client.ts` |
| `apps/cli/src/platform/types.ts` | 248 | `client-core` types |
| `apps/cli/src/streaming/EventRenderer.ts` | 400 | `client-core` `stream/reducer.ts` + `tui-kit` renderers |
| `apps/cli/src/streaming/SSEClient.ts` | 99 | `client-transport` `EndpointSupervisor` + `Backoff` |
| `apps/cli/src/streaming/index.ts` | 3 | — |
| `apps/cli/src/utils/retry.ts` | 52 | `client-transport/Backoff` |
| `apps/cli/src/commands/completions.ts` | 135 | generated by `registry/toCompletions.ts` |
| `apps/cli/src/tui/**` (15 files) | 601 | `tui-kit` + new TUI |
| `apps/cli/src/output/table.ts` | 107 | `cli-table3` + `Renderer` |
| **Total** | **~2,578** | |

## Appendix B — New packages

| Package | Est. LOC | Purpose |
|---|---:|---|
| `packages/cli-core` | ~4,500 | Registry, actions, context, connections, refs, capabilities, keymap, session/pane model, view models, config, errors |
| `packages/tui-kit` | ~5,000 | Ink component library + hooks + theme |
| `apps/cli` (rewritten) | ~4,000 | 3 thin surfaces: binary, TUI screens, companion |
| `packages/design-tokens/emit/ansi.ts` | ~250 | 18 themes → terminal palettes |
| `packages/client-core` additions | ~1,200 | ~65 missing endpoints, pagination, timeline filter |

## Appendix C — Prior-art summary

| Product | Language / TUI | Architecture | What we take |
|---|---|---|---|
| **Codex CLI** | Rust · ratatui | ~100 crates; `app-server` + versioned JSON-RPC protocol; TUI, IDE, SDK, `exec` all clients; dedicated `terminal-detection` crate | One protocol / many frontends; capability detection as a module; interactive and headless as peers |
| **Gemini CLI** | TS · Ink | `packages/cli` (frontend) + `packages/core` (backend), explicitly for "different frontends for the same backend" | The `cli-core` / `apps/cli` split |
| **Claude Code** | TS · Ink | Ink-based agentic TUI | Two-tier streaming markdown; Ink is production-viable at scale |
| **OpenCode** | TS · client/server | Headless server + TUI + desktop + SDKs; `Tab` toggles agent; `@general` subagent | Agent switch in the composer; `@mention` addressing; server-first is right |
| **Bubble Tea / Charm** | Go | Elm architecture; cell renderer; native mouse; Lip Gloss; BubbleZone | Mouse hit-testing model → our `useMouse` + `measureElement` |
| **tmux / Zellij** | C / Rust | Panes, leader key, detach/attach | The interaction grammar, not the dependency |
