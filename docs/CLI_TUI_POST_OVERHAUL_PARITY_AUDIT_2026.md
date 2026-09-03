# GeneratorAI CLI and TUI Post-Overhaul Parity Audit

**Date:** 2026-08-25  
**Status:** Current-state audit and implementation plan  
**Scope:** `packages/cli-core`, `packages/tui-kit`, `apps/cli`, shared client packages, server contracts, and parity with web, desktop, and mobile  
**Predecessor:** [CLI_TUI_GROUND_UP_OVERHAUL_PLAN.md](./CLI_TUI_GROUND_UP_OVERHAUL_PLAN.md)
**Live implementation tracker:** [CLI_TUI_PARITY_TRACKER.md](./CLI_TUI_PARITY_TRACKER.md) — per-item status, evidence, and test references for §12's phases, updated as work lands.

## 1. Executive verdict

The overhaul made the correct architectural move. The CLI is no longer a forked client: it now uses `cli-core`, `client-core`, `client-runtime`, `client-transport`, and `tui-kit`. The binary has a broad declarative command registry. The TUI has real alternate-screen rendering, tabs, split trees, themes, streaming timelines, a composer, a command palette, and terminal-emulator tests.

It has not achieved full feature parity.

The binary CLI is broad but contains security defects, stale wire contracts, ignored options, and commands whose names promise behavior their surface never implements. The TUI is a credible streaming chat and list client with an early multiplexer, not yet the terminal-native equivalent of the web workbench.

The next implementation must therefore proceed in this order:

1. Restore trust: fix the two security-critical paths and every false-success command.
2. Make contracts executable: validate requests and responses, add command-level integration tests, and gate generated docs.
3. Make streaming and pane ownership correct: one mux stream, cursor-based hydration, stable pane IDs, and bounded reducers.
4. Finish the terminal workbench: deterministic key ownership, pane-local dimensions, reattachable resources, raw PTY mode, and honest capability tiers.
5. Add feature workbenches in risk order: chat/HITL, runs, SCM/review, workflow authoring, browser/computer, and administration.
6. Ship and measure the actual executable: bundle, package, release, smoke-test, soak-test, and enforce coverage.

The correct goal is **capability parity**, not pixel parity. A cell grid should offer a terminal-native way to complete the same job. It should hand graphical or native-only work to the best available surface instead of pretending a textual approximation is equivalent.

## 2. Method and evidence

This audit used four independent passes:

- Product and feature inventory from [.github/AGENTS.md](../.github/AGENTS.md) and its linked feature documents, checked against routes and current clients.
- Binary CLI review across the registry, command handlers, auth, connections, output, companion protocol, packaging, and tests.
- TUI review across Ink rendering, store/reducers, keymaps, pane/session models, layouts, streaming, terminal capabilities, and terminal-emulator tests.
- Current primary-source research into Claude Code, Codex CLI, Kiro CLI, OpenCode, Gemini CLI, Pi, tmux, Zellij, WezTerm, and Herdr.

The deterministic Impeccable source detector returned no generic UI-rule findings for `apps/cli/src/tui` and `packages/tui-kit`. That is useful but limited: it does not test ANSI frames, terminal input routing, split geometry, stream replay, PTY takeover, or semantic action correctness. Those are the dominant risks here.

## 3. Project feature map

GeneratorAI has three server-owned execution objects:

- **Chat:** a long-lived harness session with streamed text, reasoning, tool calls, plans, questions, tasks, attachments, project/codebase context, and an optional execution workspace.
- **Workflow run:** a DAG execution with stage sessions, conditional edges, retries, hooks, profiles, validation, worktrees, artifacts, and HITL gates.
- **Automation execution:** scheduled, webhook, manual, loop, batch, or data-source fan-out into workflow runs.

The broader product surface includes:

- Copilot and Claude Agent harnesses with runtime switching.
- Projects, three codebase types, branches, files, project configs, skills, prompts, custom agents, and MCP servers.
- Isolated execution workspaces, worktrees, files, uploads, artifacts, changes, checkpoints, commits, and pull requests.
- Unified durable streaming with replay, multiplexed subscriptions, bounded queues, and adaptive coalescing.
- Integrated server-owned PTYs, browser sessions, and computer-use sessions.
- Review threads, source-control settings, hooks, webhooks, workflow scripts, templates, extensions, widgets, devices, security posture, diagnostics, and telemetry.
- Web, Electron desktop, mobile, SDK, MCP adapter, scriptable CLI, interactive TUI, and companion surfaces.

Desktop embeds the same web SPA and embedded server, so ordinary desktop parity is web parity. Desktop-native browser views, OS dialogs, updater, tray behavior, and installers are separate native capabilities, not reasonable TUI requirements.

## 4. Current architecture assessment

### 4.1 What should be retained

- `packages/cli-core` as the renderer-free command, auth, config, capability, view-model, keymap, and pane layer.
- `packages/tui-kit` as the reusable Ink component layer.
- A single `CommandSpec` registry generating Commander commands, help, completions, palette entries, companion methods, and documentation.
- Shared authenticated clients and the server-ID-keyed connection catalog.
- Server ownership of runs, durable event history, PTYs, browser sessions, and computer-use sessions.
- The alternate-screen TUI, terminal theme ladder, bounded timeline intent, and xterm-headless frame tests.
- JSON output and stable exit codes as hard CLI requirements.

### 4.2 What must change

- Registry presence must no longer count as feature completion. A command is complete only when its contract, side effect, output, cancellation, and test all work.
- TUI panes must be controllers attached to stable resources, not free-form records containing incidental fetched data.
- A tab, a pane, a stream attachment, and a server resource must have distinct identities and lifetimes.
- Input must have one consumable dispatch path. Parallel Ink listeners cannot provide reliable shortcut ownership.
- The TUI must consume the server's multiplexed stream protocol instead of opening one SSE transport per entity.
- Pane layout must be measured in pane coordinates. Terminal-wide width is not valid inside a split.
- Terminal, browser, computer, widgets, and workflow canvas need explicit capability tiers and honest fallback labels.

## 5. Critical code review findings

### 5.1 P0: local administrator token can be sent to a remote server

`device invite` searches local data directories for `local-admin.json`, then sends the bearer token to `ctx.baseUrl` without proving that the target is the local managed server. See [device.ts](../packages/cli-core/src/commands/device.ts#L24) and [device.ts](../packages/cli-core/src/commands/device.ts#L404).

The bootstrap request also targets `/api/auth/devices/invites`, while the current bootstrap route is `/api/auth/pair` with a different body. The legitimate first-device bootstrap is therefore broken while a malicious active endpoint can receive a privileged local token.

**Required correction**

- Delete generic remote-token fallback from `device invite`.
- Introduce a dedicated bootstrap client that only accepts a verified loopback origin.
- Bind `local-admin.json` to server ID, launch ID, and endpoint origin.
- Compare the probed server identity before transmitting the token.
- Use a shared request schema and the actual bootstrap route.
- Add tests for remote URL refusal, stale launch token refusal, host mismatch, happy-path loopback bootstrap, and token redaction.

### 5.2 P0: companion socket authentication leaks across clients

The companion creates one handler before accepting sockets. That handler closes over one `authenticated` boolean and one in-flight map. After one socket sends a valid nonce, later sockets inherit authenticated access. A bad nonce schedules termination of the whole companion process. See [server.ts](../apps/cli/src/companion/server.ts#L89) and [server.ts](../apps/cli/src/companion/server.ts#L214).

**Required correction**

- Create protocol state per accepted socket: authentication, in-flight requests, subscriptions, rate limits, and close cleanup.
- Reject and close only the offending connection.
- Consume or rotate launch nonces according to an explicit policy.
- Add concurrent two-client isolation, replay, cancel, disconnect, malformed-frame, and denial-of-service tests.
- Expand audit rows with peer identity, request ID, method, duration, argument hash, result, and denial reason without secrets.

### 5.3 P1: several commands violate current server contracts

Verified examples:

- `review create` sends `path`, `body`, `line`, and `side: old|new` through `as never`; the API requires checkpoint and anchor fields, start/end lines, and `additions|deletions`. See [platform.ts](../packages/cli-core/src/commands/platform.ts#L715) and [client.ts](../packages/client-core/src/api/client.ts#L1111).
- `workspace cat --alias` reads `content`, but `treeFile` returns `contents`. See [workspace.ts](../packages/cli-core/src/commands/workspace.ts#L168) and [client.ts](../packages/client-core/src/api/client.ts#L541).
- `workspace changes` expects `files`, while the response is grouped by repository; one-file mode stringifies the response object instead of returning its patch.
- `hook test` and `hook list` use stale request and response envelopes. See [platform.ts](../packages/cli-core/src/commands/platform.ts#L1150) and [hooks.ts](../apps/server/src/routes/hooks.ts#L68).

The root cause is boundary type erasure: command handlers contain many `as never` casts and the shared API client casts JSON without runtime validation.

**Required correction**

- Share or generate route schemas for every command boundary.
- Ban `as never` in `packages/cli-core/src/commands` with ESLint.
- Validate request and response envelopes at runtime for destructive, auth, review, hook, workspace, and streaming APIs.
- Add a table-driven command-contract suite that runs every registry handler against a fake typed transport.
- Add live-server scenarios for all mutating commands.

### 5.4 P1: advertised options and commands silently do less than requested

- `chat send --attach`, per-turn `--model`, and per-turn `--agent` are accepted but not uploaded or applied.
- `chat send --no-stream` returns after the POST rather than after turn completion.
- `run start --name` is accepted but ignored.
- `script run --watch` starts the run and prints a suggestion rather than watching it.
- `terminal attach` emits `terminal.attach_requested`, but no binary-surface consumer opens the WebSocket or proxies stdin/stdout.
- The TUI labels Enter as raw terminal attach, but only refreshes scrollback.
- The TUI command palette refuses commands with required flags instead of collecting a schema-driven form.

**Rule:** unsupported behavior must fail explicitly with a stable `UNSUPPORTED` error. No option may be accepted and ignored.

### 5.5 P1: machine-readable stream output is not a stable protocol

`--json` can emit raw stream frames followed by a final JSON envelope, YAML can mix stream chunks and YAML, and NDJSON rows are not consistently versioned. See [Renderer.ts](../apps/cli/src/render/Renderer.ts#L60) and [Renderer.ts](../apps/cli/src/render/Renderer.ts#L303).

**Required output contract**

- `--json`: exactly one valid versioned JSON document; buffer bounded operations or reject unbounded watch commands.
- `--ndjson`: one versioned frame per line, including lifecycle, data, warning, error, and completion frames.
- `--yaml`: one bounded document only; reject live watches.
- Human mode: progressive output is allowed.
- `--quiet`: no stdout or stderr on success; errors remain machine-actionable through the exit code unless explicitly redirected.

### 5.6 P1: the declared executable is not a release artifact

The package `bin` points to `dist-bundle/generatorai.mjs`, while the normal package build only emits `dist`. CI runs the normal build and release automation publishes desktop artifacts, not the CLI executable. Native dependencies remain external to the bundle. See [package.json](../apps/cli/package.json), [ci.yml](../.github/workflows/ci.yml), and [release.yml](../.github/workflows/release.yml).

**Required correction**

- Make `build` produce the declared bin or change `bin` to a produced artifact.
- Smoke-test the exact packaged artifact in a clean directory on Windows, Linux, and macOS.
- Decide explicitly between an npm package requiring Node and standalone platform binaries.
- If standalone is retained, implement and test the chosen SEA/Bun/native dependency strategy.
- Publish checksums, provenance, version metadata, and an upgrade path.

### 5.7 P1: generated documentation is currently stale

`pnpm --filter @generatorai/cli docs:check` fails. The surrounding narrative still names deleted files, the old five-view polling TUI, obsolete JSON examples, stale config paths, and nonexistent direct-mode plumbing. See [usage-cli.md](../.github/docs/usage-cli.md).

**Required correction**

- Run generated-doc checks in CI.
- Generate the command tree and keymap tables from registries.
- Keep conceptual documentation handwritten, but make examples executable in tests.
- Add a docs link checker and a clean-worktree check after generation.

## 6. TUI and multiplexer review

### 6.1 What exists

The current workbench is a list of tabs. Each tab owns a binary split tree, a focused pane, and an optional zoomed pane. Pane content can attach to a run, chat, session, or global stream. See [PaneModel.ts](../packages/cli-core/src/session/PaneModel.ts#L18).

Implemented foundations include:

- Tabs, vertical/horizontal splits, close, zoom, rename, and leader-key commands.
- Alternate-screen Ink rendering, terminal themes, status bars, toasts, overlays, tables, virtual lists, Markdown, diffs, and an ASCII DAG.
- Chat composer with history, multiline input, bracketed paste, slash completions, mentions, and external editor handoff.
- Chat/run timelines built through shared reducers.
- Entity list panes for chats, workflows, runs, automations, projects, workspaces, agents, scripts, and extensions.
- Changes, inspector, terminal scrollback, browser controls, and computer activity panes.
- Persisted tab content and terminal-emulator frame tests.

### 6.2 Correctness defects

#### Async pane replacement races focus

`openEntity` opens a placeholder, awaits detail, then replaces whichever pane is focused at resolution time. History also captures the focused pane after the detail fetch. Switching tabs during the request can place content and a stream into the wrong pane. See [open.ts](../apps/cli/src/tui/open.ts#L216).

The opening operation must return a stable `{tabId, paneId}` handle immediately, and every later patch must target that handle.

#### History and replay can duplicate chat turns

The stream subscribes from the beginning while REST history is fetched separately. `seedTimeline` blindly prepends history to any live items. See [store.ts](../apps/cli/src/tui/store.ts#L287).

Hydration must be atomic: fetch snapshot plus cursor, reduce once, subscribe after that cursor, and deduplicate by durable event/message identity.

#### Filtered rows and actions disagree

Panes render filtered rows, while open, edit, delete, select, and yank index the unfiltered cache. Sorting writes `sortBy` but does not sort rendered rows. The selected visual row can therefore operate on a different entity.

The selector must produce one pane-local `VisibleListModel`; both rendering and actions consume that exact object.

#### Shortcut ownership is ambiguous

The composer owns `Ctrl+K` for kill-line and `Ctrl+B` for backward-character, while global listeners also advertise palette and leader behavior on those chords. Ink does not provide DOM-style event consumption. See [Keymap.ts](../packages/cli-core/src/keymap/Keymap.ts#L32) and [input.tsx](../packages/tui-kit/src/input.tsx#L275).

Use one input router with this precedence:

1. Emergency terminal restoration and process signals.
2. Modal/overlay.
3. Focused control.
4. Focused pane mode.
5. Leader key state.
6. Global application commands.

Each key event is consumed once or passed onward once.

#### Splits use terminal-wide dimensions

Tables, chat wrapping, DAGs, and diffs often use terminal columns rather than their allocated pane rectangle. Half-width panes wrap and virtualize incorrectly.

Every leaf must receive a measured `{x, y, width, height}`. Geometry powers wrapping, virtualization, spatial focus, hit testing, PTY resize, and graphics placement.

#### Detach is destructive and has no reattach path

The leader detach command deletes attachment metadata. It does not retain the resource descriptor or replay cursor, and there is no attach command. Closing the app also quits immediately even with active resources.

Detach must change a view's attachment state, not erase its resource identity. Closing a pane, detaching a view, and terminating a server resource are three different commands.

### 6.3 Multiplexer gaps

- Directional focus maps left/up to previous and right/down to next, not geometric neighbors.
- Split ratios cannot be resized interactively.
- Persistence flattens geometry and reconstructs all saved panes as vertical splits.
- Tabs lack direct `1..9` selection, last-tab toggle, move, reorder, and active-tab visibility guarantees.
- Hidden tabs remain subscribed and keep reducer work active.
- There is no client/session list, attach chooser, resource resurrection state, or unseen-output marker.
- Copy mode is a five-row scroll jump, not searchable selectable scrollback.
- There is no raw PTY takeover or embedded terminal cell model.
- Mouse and graphics capabilities are detected/configured but not implemented.

### 6.4 Performance risks

- Token events clone timeline state and may scan/map retained items.
- Every store update reruns attachment reconciliation over the whole workbench.
- Distinct panes still create distinct SSE connections; only identical scope/id subscriptions are shared.
- Hidden tabs continue reducing events.
- Ink `maxFps` limits painting, not reducer, parsing, or store work.
- Variable-height chat items are treated like simple virtual rows.
- Final Markdown parsing and syntax highlighting are synchronous.
- Width calculations use multiple algorithms, creating emoji/CJK disagreement.
- REST hydration can push a timeline beyond its nominal retention bound.

**Performance budgets**

| Measure                                         |                                                  Target |
| ----------------------------------------------- | ------------------------------------------------------: |
| Cold start to first stable frame                |            p95 below 250 ms on supported local hardware |
| Keypress to visible response                    |              p95 below 50 ms without network dependency |
| Stream ingest to queued model update            |                                         p95 below 16 ms |
| Terminal paint rate                             |                             capped at 30 FPS by default |
| Idle CPU with ten attached quiet tabs           |                                        below 1% average |
| Heap growth during a two-hour 100 events/s soak |               bounded; below 10% after GC stabilization |
| Reconnect recovery                              |             no duplicates or gaps against cursor oracle |
| Resize recovery                                 | stable frame within two paints; no stale PTY dimensions |

## 7. Feature parity matrix

Legend: **F** full, **P** partial, **A** absent, **N** not applicable. Full means the platform can complete the job appropriately for that platform.

| Feature area                                | Web | Desktop | Mobile | CLI binary | TUI | Required TUI result                                  |
| ------------------------------------------- | :-: | :-----: | :----: | :--------: | :-: | ---------------------------------------------------- |
| Chat CRUD, send, cancel, history, stream    |  F  |    F    |   F    |     P      |  P  | Rich timeline, reliable stop/retry, cursor hydration |
| Attachments, plans, questions, tasks, usage |  F  |    F    |   F    |     P      |  P  | Typed cards, attachment picker/upload, task drawer   |
| Workflow definitions and validation         |  F  |    F    |   P    |     P      |  P  | Full forms plus textual DAG inspect/edit             |
| Run/stage lifecycle and streaming           |  F  |    F    |   P    |     P      |  P  | Stage tree, controls, hooks, variables, logs         |
| HITL and permission modes                   |  F  |    F    |   F    |     F      |  P  | Typed approvals/questions with audit context         |
| Automations and executions                  |  F  |    F    |   P    |     F      |  P  | CRUD forms, fan-out tree, execution watch            |
| Projects and codebases                      |  F  |    F    |   P    |     F      |  P  | Browse/edit/link/config workbench                    |
| Workspaces, files, artifacts, uploads       |  F  |    F    |   P    |     P      |  P  | Tree, viewer, upload/download, artifact actions      |
| Changes, checkpoints, review, PRs           |  F  |    F    |   P    |     P      |  P  | Correct diff/review/checkpoint workbench             |
| Integrated terminal                         |  F  |    F    |   P    |     P      |  P  | Raw attach plus cell-rendered scrollback pane        |
| Integrated browser                          |  F  |   F+    |   P    |     F      |  P  | Semantic tree/actions; optional image renderer       |
| Computer use                                |  P  |    F    |   A    |     F      |  P  | Consent, activity, semantic controls, frame fallback |
| Extensions and widgets                      |  F  |    F    |   P    |     P      |  P  | Management plus textual widget contract              |
| Agents, skills, prompts, MCP                |  F  |    F    |   P    |     F      |  P  | Search, inspect, edit, bind, resolve                 |
| Scripts, templates, hooks, webhooks         |  F  |    F    |   A    |     P      |  P  | Contract-correct commands and schema forms           |
| Settings, provider, diagnostics             |  F  |    F    |   P    |     F      |  P  | Editable settings and live capability diagnostics    |
| Devices, connections, security              |  F  |    F    |   F    |     P      |  P  | Safe pairing, scopes, posture, multi-server switch   |
| Tabs, splits, concurrent work               |  P  |    P    |   A    |     N      |  P  | Complete terminal-native workbench                   |
| Native dialogs, updater, tray               |  N  |    F    |   N    |     N      |  N  | Use OS/desktop handoff, not imitation                |

## 8. Terminal feasibility catalog

### 8.1 Fully feasible and required

- Chat streaming, reasoning, tool calls, plans, questions, tasks, usage, permissions, and attachments.
- Workflow and run forms, stage trees, variables, hooks, retries, HITL, and textual DAG editing.
- Automations, projects, codebases, files, artifacts, workspaces, checkpoints, commits, and PR actions.
- Unified and side-by-side diffs where width permits, review threads, search, copy mode, and external editor handoff.
- Tabs, splits, zoom, geometric focus, reattach, session restore, unseen output, and notifications.
- Raw PTY attach, scrollback, search, copy, resize, detach, and signal handling.
- Browser/computer accessibility-tree inspection and keyboard-driven actions.
- Settings, devices, connections, provider selection, security posture, diagnostics, extensions, and textual widget state.

### 8.2 Feasible with explicit degradation

- Browser/computer screenshots: Kitty/iTerm2/Sixel when supported, half-block/ASCII preview otherwise, file/external-browser fallback everywhere.
- Side-by-side diffs: use unified mode below a measured minimum width.
- DAG canvas: ASCII/Unicode graph at wide sizes, indented dependency tree when narrow.
- Arbitrary widget UIs: require extension-provided textual summary, schema actions, and external-open URL.
- Rich Markdown and syntax highlighting: simplified streaming render, full render on completion, plain-text low-capability mode.
- Mouse: optional SGR mouse mode with a visible selection escape; every action must have a keyboard equivalent.

### 8.3 Not faithfully portable to a general TUI

- Pixel-accurate live web pages, video, WebGL, canvas, and arbitrary iframe widgets.
- React Flow drag-and-drop and freeform node positioning.
- Monaco-grade editing, semantic minimaps, and graphical merge editors.
- Desktop `WebContentsView`, OS file dialogs, tray, updater, installer, and native window management.
- Touch gestures, camera capture, and mobile share-sheet behavior.

For these, parity means inspect metadata, perform core actions, save/open the artifact, and hand off to web/desktop/mobile without losing context.

## 9. External research and lessons

| System      | Verified pattern                                                                                                                           | GeneratorAI lesson                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Claude Code | One engine across terminal, IDE, desktop, and web; resumable sessions, parallel/background agents, headless scripting, and surface handoff | Preserve shared resource identity and let each surface specialize                         |
| Codex CLI   | Rust workspace with TUI, exec, app-server/protocol, terminal detection, persistence, and package smoke tests as separate concerns          | Keep interactive, headless, protocol, terminal capability, and release layers independent |
| Kiro CLI    | ACP over JSON-RPC stdio; capability exchange, session load, model/mode changes, typed stream notifications, JSONL persistence              | Companion should be a real capability-negotiated protocol, preferably ACP-compatible      |
| OpenCode    | Client/server product with terminal and desktop surfaces; quick agent-mode switch and `@` addressing                                       | Keep server-first architecture; make mode/agent switching a composer primitive            |
| Gemini CLI  | TypeScript terminal client, headless JSON and stream-JSON modes, checkpoints, MCP/extensions, and separate release channels                | Separate bounded JSON from streaming NDJSON and test installation artifacts               |
| Pi          | Separate agent core, coding CLI, and differential TUI package; release install smoke tests and a replaceable renderer                      | Keep `cli-core`/`tui-kit`; test cell semantics and packaged installs                      |
| tmux        | Server owns PTYs; clients detach/reattach; prefix grammar separates application and multiplexer input                                      | Copy the grammar and lifetimes, not the implementation dependency                         |
| Zellij      | Session server, pane/plugin model, serialized layouts, and client-specific rendering concerns                                              | Treat layout, resource, and client attachment as separate state                           |
| WezTerm     | Mux domains own panes across local, SSH, Unix, and TLS connections; explicit attach/detach and reconnect                                   | Model GeneratorAI servers as domains and make connection identity first-class             |
| Herdr       | Background server owns agent terminals; tmux-style keys, detach/reattach, status-aware panes, socket API, mouse, and remote use            | Add agent/run status to tabs and panes; support both human and agent control protocols    |

The user's “Herder” reference most likely means **Herdr** (`herdrdev/herdr`), a current Rust agent-oriented terminal multiplexer. It is not the unrelated Herd browser project.

Primary sources:

- [Claude Code overview](https://docs.anthropic.com/en/docs/claude-code/overview)
- [OpenAI Codex source](https://github.com/openai/codex)
- [Kiro ACP documentation](https://kiro.dev/docs/cli/acp/)
- [OpenCode source](https://github.com/anomalyco/opencode)
- [Gemini CLI source](https://github.com/google-gemini/gemini-cli)
- [Pi source](https://github.com/badlogic/pi-mono)
- [tmux wiki](https://github.com/tmux/tmux/wiki)
- [Zellij architecture](https://zellij.dev/documentation/)
- [WezTerm multiplexing](https://wezterm.org/multiplexing.html)
- [Herdr source and documentation](https://github.com/herdrdev/herdr)

## 10. Target terminal experience

### 10.1 Mental model

```text
Server / connection domain
└── durable resources
    ├── chats and harness sessions
    ├── workflow and automation runs
    ├── execution workspaces
    ├── PTYs
    ├── browser/computer sessions
    └── durable event cursors

TUI client
└── workbench
    ├── tab = saved task context
    │   └── split tree
    │       └── pane = view attached to zero or one resource
    ├── global command palette
    ├── notifications / blocked-work queue
    └── connection and capability status
```

Closing a view never implicitly kills a server resource. Resource termination is explicit and separately confirmed.

### 10.2 Default layout

Wide terminal, 120 columns or more:

```text
┌ GeneratorAI · connection · provider ───────────────────────────────────────┐
│ 1 chat/api-refactor ●  2 run/release !  3 project/core                    │
├────────────────────────────────────────────┬───────────────────────────────┤
│ Primary pane                               │ Tool dock                     │
│ chat / run timeline / workflow / files     │ changes / inspector /         │
│                                            │ terminal / browser / tasks    │
├────────────────────────────────────────────┴───────────────────────────────┤
│ Composer or pane command line                                              │
├────────────────────────────────────────────────────────────────────────────┤
│ connection  stream  mode  model       contextual keys     notifications   │
└────────────────────────────────────────────────────────────────────────────┘
```

Standard terminal, 80-119 columns: one visible pane, tool dock as a sibling tab/overlay, compact status. Tiny terminals below the supported minimum use inline/headless commands rather than a broken full-screen layout.

### 10.3 Tabs and panes

- Tabs represent user tasks: a chat, run, workflow edit, project, or ad hoc workspace.
- A tab stores resource references, split geometry, focused pane, zoom, cursor IDs, filters, and lightweight view state.
- Panes have typed controllers: chat, run, stages, files, changes, diff, review, terminal, browser, computer, inspector, settings, or notifications.
- Background tabs retain resource descriptors but can pause rendering and low-priority subscriptions.
- Unseen output, running, blocked/HITL, failed, and disconnected states appear in the tab label without relying on color alone.

### 10.4 Proposed key grammar

The keymap remains configurable. Defaults must avoid composer collisions.

| Keys                        | Action                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `Ctrl+K`                    | Command palette outside text input; readline kill-line inside composer                              |
| `Ctrl+P`                    | Command palette everywhere as the unambiguous fallback                                              |
| `Ctrl+B`                    | Backward character inside composer; leader only after explicit multiplexer mode or remapped default |
| `Ctrl+Space`                | Recommended default leader where terminal support is reliable                                       |
| `leader c`                  | New tab                                                                                             |
| `leader n` / `p`            | Next / previous tab                                                                                 |
| `leader 1..9`               | Select tab                                                                                          |
| `leader l`                  | Last active tab                                                                                     |
| `leader %` / `"`            | Vertical / horizontal split                                                                         |
| `leader arrows` / `h j k l` | Geometric pane focus                                                                                |
| `leader Alt+arrows`         | Resize pane                                                                                         |
| `leader z`                  | Zoom pane                                                                                           |
| `leader x`                  | Close view, not resource                                                                            |
| `leader d`                  | Detach view                                                                                         |
| `leader a`                  | Attach/re-attach resource                                                                           |
| `leader [`                  | Copy/search mode                                                                                    |
| `leader w`                  | Tab and pane navigator                                                                              |
| `leader ?`                  | Contextual key help                                                                                 |
| `Tab` / `Shift+Tab`         | Focus next/previous control within the active pane                                                  |
| `Alt+1..9`                  | Direct tabs when enhanced keyboard reporting is available                                           |
| `Esc`                       | Close overlay or cancel the current transient mode                                                  |
| `Ctrl+C`                    | First press cancels active operation; second press within a window requests quit                    |
| `Ctrl+Q`                    | Explicit quit with active-resource summary                                                          |

Do not claim tmux compatibility while `Ctrl+B` is also a composer motion. Either use a different default leader or make leader activation a mode with explicit precedence and test every focus context.

### 10.5 Chat representation

- Render user, assistant, reasoning, tool, plan, question, approval, task, error, and usage as typed timeline items.
- During token streaming, append plain wrapped text with coalesced updates.
- On completion, replace the item with formatted Markdown and highlighted code.
- Collapse tool details by default but keep status, duration, and affected resources visible.
- Keep pending questions/approvals pinned above the composer.
- Composer supports files/attachments, `@agent`, `@file`, `@codebase`, `/commands`, model/mode/agent switch, paste, history, shell intent, and `$EDITOR`.
- Show context usage, model, permission mode, branch/worktree, stream state, and cost/usage where available.

### 10.6 Workflow and orchestration representation

- Workflow definition: stage list plus ASCII DAG, validation panel, and schema-driven stage/edge/variable/hook forms.
- Run: stage tree on the left or in the tool dock, chronological event timeline in the primary pane, details/logs/variables/HITL in inspector panes.
- Automation: execution tree showing iterations/batches, concurrency slots, nested runs, error policy, and aggregate status.
- Parallel stages appear as grouped lanes or an indented time-ordered stream; do not interleave text without stage identity.
- Blocked/HITL work is globally discoverable through a notification queue, not only inside the attached run.

### 10.7 Terminal, browser, and computer panes

**Terminal**

- Phase 1: correct scrollback, search, copy, signals, create/kill, and resize.
- Phase 2: raw full-screen attach through terminal suspension and byte-for-byte WebSocket proxy.
- Phase 3: embedded xterm-headless cell rendering with bounded scrollback; raw attach remains the fidelity escape hatch.

**Browser/computer**

- Primary TUI mode is semantic: title/URL, accessibility tree, focused element, action palette, console/network summaries, and captured artifacts.
- Inline images are optional capability adapters, never the only representation.
- Live video is not a default TUI goal. It is expensive, terminal-specific, and inferior to web/desktop for inspection.

## 11. Target implementation architecture

### 11.1 Resource and view state

Introduce explicit types in `cli-core`:

```typescript
type ResourceRef =
  | { kind: 'chat'; chatId: string; sessionId?: string }
  | { kind: 'run'; runId: string }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'terminal'; workspaceId: string; terminalId: string }
  | { kind: 'browser'; workspaceId: string; browserId?: string }
  | { kind: 'computer'; workspaceId: string };

interface PaneDescriptor {
  paneId: string;
  controller: PaneControllerKind;
  resource?: ResourceRef;
  attachment: 'attached' | 'detached' | 'reconnecting' | 'stale';
  cursor?: string;
  viewState: SerializablePaneViewState;
}
```

Fetched payloads, callbacks, full transcripts, patches, terminal buffers, and secrets must not be persisted in layout state.

### 11.2 Streaming pipeline

```text
one mux transport
  -> frame parser
  -> sequence/cursor validator
  -> bounded per-scope queues
  -> normalized event router
  -> domain reducers/query invalidation
  -> coalesced view-model notifications
  -> active pane render at max FPS
```

Requirements:

- One connection per server/profile, not per pane.
- Subscribe/unsubscribe scopes over the mux control endpoint.
- Snapshot-plus-cursor hydration.
- Dedupe by durable sequence/event/message identity.
- Bounded queues and explicit dropped/coalesced counters.
- Active panes receive immediate updates; hidden panes receive reduced/coalesced state updates.
- Reconnect forever with capped backoff until the user disconnects; surface offline state and last cursor.
- Query caches are patched or invalidated by events so lists do not depend on polling.

### 11.3 Input architecture

- Parse terminal input once.
- Normalize Kitty/CSI-u, legacy keys, paste, mouse, focus, and resize events.
- Route through one state machine with consumption.
- Generate help and conflict diagnostics from the same resolved keymap.
- Refuse conflicting user overrides after considering context inheritance.
- Add an input trace mode to `system doctor` with sensitive text redaction.

### 11.4 Terminal capability profiles

Define tested profiles rather than a loose boolean bag:

- `dumb`: no color, ASCII, no raw input.
- `basic`: 16 color, Unicode optional, legacy keyboard.
- `modern`: truecolor, hyperlinks, bracketed paste, focus events.
- `enhanced`: Kitty/CSI-u keyboard, mouse, synchronized output.
- `graphics-kitty`, `graphics-iterm`, `graphics-sixel` adapters.
- `screen-reader`: inline/main-screen, stable linear order, no animation, explicit labels.

`system doctor` must show detected evidence, enabled features, and disabled fallbacks.

## 12. End-to-end implementation plan

### Phase 0: freeze claims and establish a baseline

1. Mark false-success options and commands as experimental or unsupported immediately.
2. Snapshot the current registry, keymap, OpenAPI, route inventory, and parity matrix.
3. Add CI jobs for docs drift, clean generation, exact bin build, and targeted coverage reports.
4. Record cold start, memory, idle CPU, event throughput, and frame timing baselines.
5. Convert this document into tracked issues with one owner and acceptance test per item.

**Exit gate:** every advertised command has a test status and owner; generated docs pass; no feature is called full based only on registry presence.

### Phase 1: security and correctness stabilization

1. Fix local-admin bootstrap origin/identity binding and route contract.
2. Move companion authentication and request state per connection.
3. Fix review, workspace, hook, connection probe, and all known stale contracts.
4. Remove boundary `as never` casts and add runtime schema validation.
5. Implement or reject ignored options explicitly.
6. Define JSON/NDJSON/YAML stream behavior and enforce it.
7. Add hermetic tests first, then live-server scenarios for every repaired command.

**Exit gate:** zero P0/P1 correctness findings; all command contract scenarios pass; security tests prove token and socket isolation.

### Phase 2: distribution and protocol hardening

1. Produce the declared executable in the standard build.
2. Add clean-directory install and smoke tests on all supported OSes.
3. Add CLI/server protocol negotiation with compatible version ranges and feature flags.
4. Version every machine output frame and companion method schema.
5. Decide whether companion adopts ACP directly or exposes an ACP adapter alongside GeneratorAI RPC.
6. Complete hierarchical shell completion and dynamic ID completion.
7. Publish artifact checksums and provenance in release automation.

**Exit gate:** a release candidate installs and runs `version`, `doctor`, one read command, one mutation, one stream, and companion handshake on each OS.

### Phase 3: stream and state correctness

1. Build a shared mux-stream client in `client-transport`/`client-core`.
2. Replace `SharedStreamPort` per-scope transports in the TUI.
3. Implement snapshot-plus-cursor hydration and identity dedupe.
4. Normalize list cache updates from events and retain polling only as repair.
5. Add bounded scope queues, coalescing, hidden-tab priority, and metrics.
6. Make open operations return stable pane handles and eliminate focus races.
7. Remove pane state when panes close and dispose every timer/subscription.

**Exit gate:** burst, reconnect, replay, out-of-order, duplicate, stale-poll, hidden-tab, and two-hour soak tests pass with bounded memory.

### Phase 4: multiplexer and input core

1. Replace parallel key listeners with the consumable input router.
2. Resolve the default leader conflict and add key conflict diagnostics.
3. Add measured pane rectangles and geometric focus.
4. Add pane resize, tab selection/reorder/navigator, last-tab, and active-tab visibility.
5. Persist versioned split geometry with responsive restore constraints.
6. Separate close, detach, attach, and terminate operations.
7. Implement real copy/search mode and unseen-output indicators.
8. Add `--inline` and screen-reader profiles.

**Exit gate:** every documented key performs the same semantic action in dashboard, list, composer, overlay, run, diff, terminal, and browser contexts; layout round-trips across resize.

### Phase 5: terminal resource parity

1. Finish binary `terminal attach` with WS auth, raw mode, resize, detach chord, signal handling, and guaranteed restoration.
2. Add the same takeover through Ink terminal suspension.
3. Add xterm-headless scrollback/cell rendering for embedded panes.
4. Preserve server watermark flow control and add client-side bounded buffers.
5. Define resize authority for multiple attached clients.
6. Add terminal session chooser, reattach, kill confirmation, and idle state.

**Exit gate:** interactive shells, full-screen apps, paste bursts, Unicode, resize storms, reconnect, detach/reattach, slow clients, and Windows ConPTY pass real-console smoke tests.

### Phase 6: chat, run, and HITL workbenches

1. Implement all typed timeline cards from shared event models.
2. Add attachment upload and composer mentions with real resource resolution.
3. Add pinned approvals/questions, background tasks, context usage, and stop/retry.
4. Add run stage tree, stage detail, hooks, variables, messages, and verbosity controls.
5. Add a global blocked-work/notification queue.
6. Add automation execution fan-out and nested run navigation.

**Exit gate:** representative chat, workflow run, parallel run, failed run, HITL, and automation workflows can be completed without leaving the TUI.

### Phase 7: workspace, SCM, review, and workflow authoring

1. Build a workspace tree with files, artifacts, uploads/downloads, and worktrees.
2. Build a correct changes/diff/checkpoint/review/commit/PR workbench.
3. Add `$EDITOR` handoff with resume and file-change refresh.
4. Build workflow stage/edge/variable/hook forms from schemas.
5. Add wide ASCII DAG editing and narrow dependency-tree mode.
6. Add validation navigation from errors to the responsible field/stage/edge.

**Exit gate:** users can author, validate, run, review, checkpoint, commit, and open a PR for a workflow entirely through terminal-native interactions.

### Phase 8: browser, computer, extensions, and administration

1. Add semantic browser and computer inspectors before image rendering.
2. Add capability-specific screenshot renderers and external-open fallback.
3. Add consent/grant workflows and visible security boundaries.
4. Define and implement a textual widget degradation contract.
5. Add complete extension, agent, skill, prompt, MCP, hook, webhook, provider, connection, device, security, and diagnostics panes.
6. Make settings editable and prove each setting changes behavior.

**Exit gate:** every non-native feature in the parity matrix is full or explicitly degraded with a tested handoff.

### Phase 9: performance, accessibility, and release closure

1. Profile reducer, store, layout, Markdown, diff, and terminal-cell hot paths.
2. Meet the performance budgets in section 6.4.
3. Test `NO_COLOR`, ASCII, 16/256/truecolor, legacy and enhanced keyboards, screen readers, Windows Terminal, conhost fallback, WSL, tmux, Zellij, Kitty, WezTerm, iTerm2, Ghostty, SSH, and high latency.
4. Add long-running reconnect and resource-leak tests.
5. Enforce at least 80% changed-line coverage and meaningful branch coverage for command contracts, input routing, pane state, and stream reconciliation.
6. Run packaging, migration, downgrade, and clean-uninstall tests.
7. Update AGENTS, usage docs, operations, changelog, and the parity matrix from executable evidence.

**Exit gate:** release checklist is green on every supported platform; no known P0/P1 finding; parity claims match automated scenarios.

## 13. Required test architecture

### Pure and hermetic

- Every command handler against typed fake APIs, including every flag and response variant.
- Command registry generation, keymap generation, output envelopes, and completion insertion.
- Pane tree operations, geometry, persistence migrations, focus, close/detach/attach, and cleanup.
- Input routing by context, chord, sequence timeout, paste burst, Unicode grapheme, and remapping conflict.
- Timeline reducers against duplicate, out-of-order, replay, truncation, and interleaved tool/token events.
- Capability profiles and degradation decisions.

### Terminal-emulator integration

- Assert painted cells, cursor position, focus border, status, tab visibility, overlays, wrapping, and split dimensions.
- Send keys in full bursts as well as paced input.
- Resize during streaming, overlays, completion menus, and PTY output.
- Assert semantics, not merely that the frame is nonblank.

### Live local integration

- Run the command registry scenario catalog against an ephemeral server/database.
- Exercise auth bootstrap, pairing, scopes, reconnect, mux subscriptions, uploads, review contracts, hooks, browser, computer, and terminal routes.
- Parse structured output; never use substring success assertions.

### Real-console and packaging smoke

- Use a real attached console for Windows ConPTY and raw terminal takeover.
- Install the produced artifact in a clean environment.
- Verify terminal restoration after normal exit, errors, signals, disconnect, and forced child termination.
- Verify no credentials, ANSI control traffic, or logs leak into machine output.

## 14. Documentation corrections required now

- Update [.github/AGENTS.md](../.github/AGENTS.md) to reflect the current command groups and TUI, while retaining the known full-mux gap.
- Regenerate the command block in [usage-cli.md](../.github/docs/usage-cli.md), then rewrite its stale config, TUI, streaming, JSON, and direct-mode sections.
- Update [.github/docs/apps.md](../.github/docs/apps.md) with the post-overhaul package boundaries and mobile inventory.
- Add truthful capability labels: `full`, `partial`, `degraded`, `experimental`, and `unsupported`.
- Generate a keymap reference and output protocol reference from source.
- Add this audit to the “Where to read what” table in AGENTS after the first stabilization phase lands.

## 15. Definition of full parity

CLI/TUI parity is complete only when all of the following are true:

1. Every applicable server capability has a tested binary command or a documented reason it is intentionally surface-only.
2. Every non-native web workflow has a terminal-native TUI path or an explicit, context-preserving handoff.
3. No accepted option is ignored and no command reports success before its promised outcome.
4. Auth, connection, request, response, stream, and output protocols are versioned and validated.
5. One multiplexed event connection supports concurrent tabs and panes with correct replay and bounded memory.
6. Tabs, splits, focus, resize, zoom, copy/search, detach/attach, restore, and resource termination have distinct tested semantics.
7. Chat, run, HITL, automation, workspace, review, terminal, browser/computer semantic controls, and administration scenarios pass end to end.
8. The exact distributed executable is built and smoke-tested in CI on supported platforms.
9. Accessibility and low-capability profiles remain fully operable by keyboard.
10. Documentation and parity tables are generated or checked against executable evidence.

Until those conditions hold, the honest status is: **broad CLI coverage, partial command correctness, and a promising but incomplete multiplexed TUI**.

## 16. Validation snapshot

The audit was validated against the current workspace on 2026-08-25:

| Check                                          | Result                                                |
| ---------------------------------------------- | ----------------------------------------------------- |
| `@generatorai/cli-core` unit tests             | 94 passed                                             |
| `@generatorai/tui-kit` unit/component tests    | 83 passed                                             |
| `@generatorai/client-core` unit/contract tests | 137 passed                                            |
| `@generatorai/cli` typecheck                   | Passed                                                |
| Full `@generatorai/cli` test suite             | 40 passed, 5 failed                                   |
| Generated CLI documentation check              | Failed: `usage-cli.md` is behind the command registry |
| Audit Markdown formatting                      | Passed                                                |
| Audit local file links                         | 26 resolved, 0 missing                                |

The five CLI failures are all in chat-surface tests. Their rendered frame reports `fetch failed` while trying to use `http://127.0.0.1:3100`, so they depend on external server state instead of a hermetic fake or fixture server. The same run emits `MaxListenersExceededWarning` for `uncaughtException` and `exit` listeners after repeated TUI mounts. These outcomes support two separate findings:

- Chat integration scenarios need an ephemeral owned server or an injected fake transport; a test must not pass or fail based on an unrelated developer server.
- TUI launch/unmount must unregister every process listener, and a repeated-mount test must assert listener counts return to baseline.

The pre-existing modification to `docs/V2_IMPLEMENTATION_TRACKER.md` was not changed during this audit.
