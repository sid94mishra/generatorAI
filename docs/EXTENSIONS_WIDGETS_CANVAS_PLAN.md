# GeneratorAI — Extensions, In-Chat Widgets & Agent-Driven Canvas

> **Status:** DRAFT PROPOSAL — for user review. Nothing here is implemented yet.
>
> **Author:** GitHub Copilot (Opus 4.7), synthesized from an end-to-end read of `.github/AGENTS.md`, all feature docs, and industry research on Vercel AI SDK Generative UI, Anthropic Artifacts, OpenAI Apps SDK, the MCP Apps (`text/html;profile=mcp-app`) specification, and `mcp-ui`.

---

## 0. TL;DR

Add three tightly-related capabilities to GeneratorAI as a single, coherent surface:

1. **Widgets** — inline, interactive UI blocks the agent emits mid-stream that render as first-class message parts in Chat / Stage timelines. Users interact; interactions feed back into the same conversation as structured tool results.
2. **Extensions** — a versioned, manifest-driven package format (`.generatorai/extensions/<name>/`) that can *contribute* widgets, tools (MCP+custom), skills, agents, prompts, hooks, PWS scripts, right-pane panels and canvas apps. Installable per-workspace (workspace-local) or per-user.
3. **Canvas** — a dedicated right-pane surface where a widget graduates into a full-window "app" (Anthropic Artifacts / ChatGPT Apps / v0 style). Canvas apps are just extensions rendered in a sandboxed iframe with a bidirectional JSON-RPC bridge to the agent and host.

The critical insight is that **all three are the same primitive rendered in different frames**:

```
Widget       = ExtensionWidget rendered inline in a message
Canvas app   = ExtensionWidget rendered in the RightPane
Right-pane
  contribution = ExtensionWidget rendered as a full tab
```

Everything is a *UI Resource* (HTML/JS/CSS from an extension) hosted in a sandboxed iframe, addressed by a `widget://<extension-id>/<component>` URI, wired to the agent via the existing tool-call event stream + a new `harness.widget.*` event family, and gated by the existing `PermissionPolicy`.

This mirrors the direction the whole industry converged on in 2025: **MCP Apps / MCP-UI** (`text/html;profile=mcp-app`), **ChatGPT Apps SDK**, **Claude Artifacts**, **v0**, **Cursor Composer inline diffs**, and **Vercel AI SDK generative UI**.

---

## 1. Fit with existing architecture

GeneratorAI is exceptionally well-positioned for this feature because most of the plumbing already exists:

| Requirement | Existing plumbing we reuse | Notes |
|---|---|---|
| Server-authored UI messages | `EventBus` → `StreamBroker` → SSE `/api/stream` | Just add new `AgentEvent` kinds, no route change. See AGENTS.md §8 "Add a new SSE event kind". |
| Client-side timeline of blocks | `streamStore` `StreamBlock` union + `StreamPanel` + `deriveTimeline` | Add a `WidgetBlock` variant; extend `deriveStreamView` to route it. |
| Historic replay of the same UI | `chatMessageToBlocks` + `ChatMessageMetadata` | Persist a `widgetInstances` field so refresh replays the same UI. |
| Right-pane host | `RightPane` + `RightPaneTabDef` with `allowMultiple`, `focusTabRequest` | Canvas app is a new tab kind whose renderer is the same `<WidgetFrame>` component. |
| Tool→UI binding | `CustomToolRegistry` (`ToolDefinition`) + MCP servers | Tools gain an optional `ui.resourceUri` (MCP-Apps compatible). |
| Sandbox for untrusted code | `docker/sandbox-template/` + `SANDBOX_ENABLED` for scripts | Extend to run extension backend workers optionally; front-end is browser sandbox (iframe). |
| Per-workspace state | `WorkspaceManager`, `.workspace.json`, workspace lifecycle events | `<workspace>/.generatorai/extensions/` is added to the workspace layout. |
| Per-project overrides | `SystemArtifactService` 4-scope merge (system→project→workflow→stage) | Extensions slot in as a **fifth scope prefix** and can be scoped globally, project, or workspace. |
| Permission gating | `PermissionPolicy` (already used for tools + HITL modes) | Widget→tool calls go through same policy. Same 4 permission modes apply. |
| PWS/skill authoring loop | `.workflow.mjs` reloadable + skills/agents/prompts under project config | Extensions ship the same file kinds as an atomic bundle. |
| Skill for agent-authored features | Existing skills/subagents + hook system | We add a **"Build an Extension" skill** driven by a new prompt template. |

**In short: we do not need to invent a runtime.** We layer a small manifest + iframe host + a couple of SSE event kinds on top of what's already there.

---

## 2. Requirements (as I understood them) & who they map to

| # | User requirement | Solution surface |
|---|---|---|
| R1 | *Custom widgets rendered inline in chat as part of the flow, interactive, feeding back to the agent* | **Widgets** (§4). Emitted via a `widget.render` tool or a `harness.widget.render` event; rendered as a `WidgetBlock` in `StreamPanel`; interactions POST back and become `harness.tool_start` events. |
| R2 | *An external extension system installed into `.generatorai/extensions/` per workspace* | **Extensions** (§5). Workspace layout gets `.generatorai/extensions/<pkg>@<ver>/`; global fallback at `~/.generatorai/extensions/`. |
| R3 | *Manifest describes capabilities the extension contributes* | **`extension.json` manifest** (§5.2) with a `contributes` object modeled after VS Code + MCP Apps. |
| R4 | *A skill that lets the agent author extensions from a chat / workflow prompt* | **`extension-authoring` skill + `create-extension` custom tool** (§7). Emits a scaffold into workspace, hot-loads it, and streams the result as a canvas widget the user can immediately try. |
| R5 | *A canvas surface for rendering generated apps that both user and agent can interact with; install-to-workspace or keep-in-session* | **Canvas** (§6). Same widget frame in a `RightPane` tab. "Save to Workspace" and "Install as Extension" are two commit actions. |

---

## 3. High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BROWSER (apps/web)                                   │
│                                                                              │
│  ChatMessageList                                                             │
│    └─ StreamPanel                                                            │
│        ├─ StepRow (existing thinking/tool timeline)                          │
│        └─ WidgetBlock ─┐                                                     │
│                        ▼                                                     │
│                 <WidgetFrame extensionId=… component=… state=… />            │
│                  (sandboxed <iframe> with postMessage bridge)                │
│                        ▲                                                     │
│                        │ RPC (JSON-RPC 2.0 over postMessage)                 │
│                        ▼                                                     │
│                 WidgetBridge (in host page):                                 │
│                   • callTool(name, args)     → POST /api/tools/invoke        │
│                   • sendMessage(userText)    → POST /api/chats/:id/prompt    │
│                   • updateState(patch)       → PATCH /api/widgets/:iid       │
│                   • openInCanvas()           → RightPane focusTab            │
│                                                                              │
│  RightPane (existing)                                                        │
│    └─ tab "canvas-<id>" → <WidgetFrame … fullscreen />                       │
└────────────────────────▲────────────────────────────────────────────────────┘
                         │ SSE (existing /api/stream)
                         │ new events: harness.widget.*
                         │
┌────────────────────────┴────────────────────────────────────────────────────┐
│                         SERVER (apps/server)                                 │
│                                                                              │
│  Routes                                                                      │
│    /api/extensions/*        (install, list, enable, uninstall, reload)       │
│    /api/widgets/*           (instance CRUD + state; state served for replay) │
│    /api/widget-assets/*     (static asset proxy, CSP-locked)                 │
│    /api/tools/invoke        (bridge for widget→tool RPCs; policy-gated)      │
│                                                                              │
│  Services (packages/core)                                                    │
│    ExtensionManager   ────  loads manifests, resolves capability graph,      │
│                             hot-reloads, uninstalls, verifies signatures     │
│    WidgetService      ────  instance lifecycle, state persistence, RPC      │
│    WidgetToolAdapter  ────  registers "widget.render" as a first-class tool  │
│                             the agent can call; renders inline               │
│    ExtensionSandbox   ────  iframe CSP + optional Docker backend for JS bg   │
│                                                                              │
│  Composition root wiring — mirrors CustomToolRegistry pattern (TOL-01)       │
└────────────────────────▲────────────────────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────────────────────┐
│                         FILESYSTEM                                           │
│                                                                              │
│  ~/.generatorai/extensions/<pkg>@<ver>/       (user-scope, all workspaces)   │
│  <workspacesDir>/<wsId>/.generatorai/         (workspace-scope, higher prio) │
│      └─ extensions/<pkg>@<ver>/                                              │
│                                                                              │
│  Each extension has:                                                         │
│    extension.json                              (manifest)                    │
│    LICENSE  README.md                                                        │
│    ui/*.html *.js *.css                        (widget bundles, sandboxed)   │
│    server/*.mjs                                (optional Node hooks/tools)   │
│    mcp/*.json                                  (contributed MCP servers)     │
│    skills/*.md  agents/*.md  prompts/*.md      (contributed artifacts)       │
│    scripts/*.workflow.mjs                      (contributed PWS)             │
│    tools/*.mjs                                 (custom Zod tools)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Widgets — the inline UI primitive

### 4.1 Data model

Add to `packages/shared/src/types/`:

```ts
// Widget.ts
export interface WidgetDescriptor {
  /** Fully-qualified: "<extensionId>/<component>" */
  id: string;
  extensionId: string;
  component: string;         // manifest key
  title?: string;
  /** Where the widget prefers to render. Runtime may override. */
  preferredSurface: 'inline' | 'canvas' | 'right-pane';
  /** JSON Schema for initial props; validated by the server. */
  propsSchema?: Record<string, unknown>;
  /** JSON Schema for the widget's persistent state. */
  stateSchema?: Record<string, unknown>;
  /** Permissions this widget requests. Enforced by PermissionPolicy. */
  permissions?: WidgetPermission[];
}

export type WidgetPermission =
  | 'tools:invoke'         // may call any tool the user has (subject to allowlist)
  | 'tools:invoke:<name>'  // may call a specific tool
  | 'chat:send'            // may send new user messages
  | 'workspace:read'       // may read files under workspace
  | 'workspace:write'      // may write files (HITL prompt each time unless bypass)
  | 'browser:navigate'     // may drive the integrated browser
  | 'network:fetch:<host>' // outbound fetch to a whitelisted host
  | 'canvas:open'          // may promote itself to canvas
  | 'clipboard:read' | 'clipboard:write';

export interface WidgetInstance {
  instanceId: string;                    // stable across replays
  descriptorId: string;                  // WidgetDescriptor.id
  sessionId: string;                     // owning session/chat
  stageRunId?: string;                   // when emitted from a workflow stage
  messageId?: string;                    // for inline widgets, the assistant message
  surface: 'inline' | 'canvas' | 'right-pane';
  props: unknown;                        // validated against propsSchema
  state: unknown;                        // validated against stateSchema
  status: 'active' | 'suspended' | 'closed';
  createdAt: string;
  updatedAt: string;
}
```

Persist `WidgetInstance` in a new `widget_instances` table (Drizzle migration v9) plus mirror the `instanceId` in `ChatMessageMetadata.widgetInstanceIds: string[]` so `chatMessageToBlocks` can reconstitute them on replay (exactly like `metadata.toolCalls`).

### 4.2 Stream events

Extend `AgentEvent` in `packages/shared/src/types/AgentEvent.ts`:

```ts
| { kind: 'harness.widget.render';   data: { instanceId: string; descriptorId: string; props: unknown; surface: WidgetInstance['surface']; callId?: string; parentToolCallId?: string } }
| { kind: 'harness.widget.state';    data: { instanceId: string; state: unknown; patch?: unknown } }
| { kind: 'harness.widget.action';   data: { instanceId: string; action: string; payload?: unknown; from: 'agent' | 'user' } }
| { kind: 'harness.widget.closed';   data: { instanceId: string; reason?: string } }
| { kind: 'harness.widget.error';    data: { instanceId: string; error: string } }
```

These follow the exact same pattern as `browser.*` events (which already ride on the unified `/api/stream` and are auto-routed to `session`, `chat`, `run` scopes). No route changes required — the bridge already fans out based on `sessionId`/`chatId`.

### 4.3 How the agent emits a widget

Two mutually-compatible paths (a widget looks identical either way to the UI):

**Path A — First-class tool `ui.render` (recommended default).**
Register a synthetic tool in `CustomToolRegistry` at boot:

```ts
tool({
  name: 'ui.render',
  description: 'Render an interactive widget inline in the chat. Prefer this over long tables or when the user should interact.',
  inputSchema: z.object({
    widget: z.string().describe('extensionId/component identifier, e.g. "core/weather-card"'),
    props: z.record(z.unknown()),
    surface: z.enum(['inline','canvas','right-pane']).optional().default('inline'),
    title: z.string().optional(),
  }),
  execute: async (input, ctx) => WidgetService.createInstance(input, ctx),
});
```

When the agent calls `ui.render`, `WidgetService` validates props against the descriptor's schema and emits `harness.widget.render`. The tool result the agent receives is `{ instanceId, hint: "widget rendered; wait for widget.action or user input" }` — this keeps the LLM aware that a UI is up.

**Path B — MCP Apps `_meta.ui.resourceUri` (interop).**
Any MCP tool contributed by an extension can attach `_meta.ui.resourceUri` per the MCP Apps spec. `WidgetToolAdapter` intercepts tool results that carry that field and auto-issues `harness.widget.render` on the client's behalf. This gives us drop-in compatibility with the wider MCP ecosystem (Anthropic + OpenAI Apps SDK + `mcp-ui` extensions).

### 4.4 How a widget calls back into the agent

Iframe → host bridge is JSON-RPC 2.0 over `postMessage`, with a `Sec-WidgetOrigin` handshake (nonce assigned at frame mount). Host exposes:

```ts
interface WidgetHostAPI {
  callTool(name: string, args: unknown): Promise<unknown>; // gated by permissions
  sendChatMessage(text: string, opts?: { asUser?: boolean }): Promise<void>;
  updateState(patch: unknown): void;                        // debounced → PATCH
  emitAction(action: string, payload?: unknown): void;      // → harness.widget.action
  requestClose(): void;
  openInCanvas(): void;
  requestPermission(perm: WidgetPermission): Promise<boolean>;
  getWorkspaceInfo(): Promise<{ workspaceId: string; cwd: string; codebases: string[] }>;
  getContext(): Promise<{ chatId: string; stageRunId?: string; }>;
}
```

Every call that hits a tool goes through the existing `PermissionPolicy`. On `default` permission mode the user gets the existing HITL "approve tool call" prompt; on `acceptEdits`/`bypassPermissions` it flows through. Widget→chat messages appear in the timeline with `ChatMessageMetadata.origin = 'widget'` for auditability.

### 4.5 Client rendering

- New `WidgetBlock` variant in `streamStore.ts`:
  ```ts
  export interface WidgetBlock {
    type: 'widget';
    blockId: number;
    instanceId: string;
    descriptorId: string;
    surface: 'inline' | 'canvas' | 'right-pane';
    props: unknown;
    status: 'active' | 'closed' | 'error';
  }
  ```
- `deriveStreamView` maps `WidgetBlock` to a new "widget" step type and, for `surface: 'inline'`, renders `<WidgetFrame>` directly inline (not in the step timeline).
- `chatMessageToBlocks` reconstructs `WidgetBlock`s from `message.metadata.widgetInstanceIds`.
- The initial `sseManager` cross-buffer invariant (AGENTS.md §5.4) is preserved — widget events are treated exactly like tool events for interleaving.

### 4.6 `<WidgetFrame>` component

- `<iframe sandbox="allow-scripts allow-forms" srcdoc="…" referrerpolicy="no-referrer">` — no `allow-same-origin`, so the frame is a null origin.
- CSP: `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob: /api/widget-assets/; connect-src 'none'; frame-ancestors 'self';` — connect-src is empty because the *only* channel back is `postMessage`. This is the same pattern MCP-UI's `AppFrame` uses and matches Claude Artifacts / ChatGPT Apps.
- Auto-height messaging (widget posts `{type:'resize', height}`).
- Theme forwarding — host sends CSS variables from the current theme on mount + on theme change.
- Loading skeleton until first `ready` postMessage.
- Focus trap + Esc-to-close when in canvas.

---

## 5. Extensions — the packaging & distribution primitive

### 5.1 Directory layout

**Workspace-scope (higher priority — matches AGENTS.md §14 workspace-lifecycle rules):**
```
<workspacesDir>/<wsId>/.generatorai/extensions/<pkg>@<ver>/
```

**User-scope (fallback):**
```
~/.generatorai/extensions/<pkg>@<ver>/
```

**System-scope (shipped with the app, read-only):**
```
<GENERATORAI_TEMPLATES_DIR>/system/extensions/<pkg>@<ver>/
```

Precedence when the same `pkg` exists at multiple scopes: **workspace > user > system**. This mirrors the `SystemArtifactService` 4-scope merger already documented in `feature-skills-agents-mcp.md` §2.

Env var: `GENERATORAI_EXTENSIONS_DIR` — override for the user-scope root (default `~/.generatorai/extensions`).

### 5.2 `extension.json` manifest

```jsonc
{
  "$schema": "https://generatorai.dev/schemas/extension.v1.json",
  "id": "acme.pdf-annotator",                       // globally unique
  "name": "PDF Annotator",
  "version": "1.2.0",                                // semver
  "description": "Renders PDFs inline with agent-driven highlights.",
  "author": { "name": "ACME", "email": "dev@acme.io", "url": "https://acme.io" },
  "license": "MIT",
  "repository": "https://github.com/acme/genai-pdf-annotator",
  "engines": { "generatorai": ">=1.0.0 <2.0.0" },
  "publisher": "acme",                               // used for signature verification later
  "signature": "sha256-BASE64...",                   // optional; verified against a pinned key

  "activationEvents": [
    "onChat",                                        // on every new chat
    "onWorkflowRun:workflow-id-here",                // scoped
    "onCommand:acme.pdfAnnotator.open",
    "onTool:ui.render:acme.pdf-annotator/*"          // lazy-load when agent calls
  ],

  "permissions": [                                   // super-set for user consent on install
    "workspace:read",
    "network:fetch:api.acme.io",
    "canvas:open"
  ],

  "contributes": {
    "widgets": [
      {
        "id": "viewer",
        "title": "PDF Viewer",
        "entry": "ui/viewer.html",                   // relative to extension root
        "preferredSurface": "canvas",
        "propsSchema": "schemas/viewer.props.json",
        "stateSchema": "schemas/viewer.state.json",
        "permissions": ["workspace:read", "canvas:open"]
      }
    ],
    "tools": [
      { "name": "pdf.extractText", "module": "server/tools.mjs", "export": "extractText" }
    ],
    "mcpServers": [
      { "name": "pdf-mcp", "config": "mcp/pdf.json" }  // path to McpServerConfig JSON
    ],
    "skills":   [{ "file": "skills/pdf-review.md" }],
    "agents":   [{ "file": "agents/annotator.md" }],
    "prompts":  [{ "file": "prompts/summarize.md" }],
    "scripts":  [{ "file": "scripts/pdf-review.workflow.mjs" }],
    "hooks":    [{ "phase": "on_run_start", "type": "function", "function": "pdfBootstrap", "module": "server/hooks.mjs" }],
    "rightPanePanels": [
      { "id": "pdf-outline", "title": "Outline", "widget": "acme.pdf-annotator/outline", "icon": "list" }
    ],
    "commands": [
      { "id": "acme.pdfAnnotator.open", "title": "Open PDF", "when": "workspaceHasFile:*.pdf" }
    ],
    "configuration": {                                 // exposed in Settings UI
      "acme.pdfAnnotator.defaultZoom": {
        "type": "number", "default": 1.0, "minimum": 0.25, "maximum": 4
      }
    }
  }
}
```

Design notes:

- The `contributes` object is deliberately modeled after **VS Code's** — familiar and battle-tested.
- `activationEvents` mirror VS Code's lazy-loading model. `onTool:ui.render:*` supports wildcard suffix matching so the agent triggers the load implicitly.
- `permissions` are enforced by `PermissionPolicy`. Install-time consent is displayed as a diff vs. any prior install.
- `tools`/`hooks` `module` paths execute in the **server sandbox** (§8.3) when `SANDBOX_ENABLED=true`; otherwise in-process with the same isolation as PWS scripts today.
- Everything is optional — a "widgets-only" extension needs only the `widgets` key.

### 5.3 Install / uninstall / update

New CLI:
```
generatorai extension install <name-or-tarball-or-git-url> [--workspace|--user] [--force]
generatorai extension list [--enabled|--disabled]
generatorai extension enable  <id>
generatorai extension disable <id>
generatorai extension uninstall <id> [--workspace|--user]
generatorai extension reload  <id>              # hot-reload without restart
generatorai extension pack    <path>            # zip a folder into .genext tarball
generatorai extension inspect <id>              # dump merged manifest + capability graph
```

New REST + Web UI (Settings → Extensions):
```
GET    /api/extensions
POST   /api/extensions                          # install by URL/tarball/id
GET    /api/extensions/:id
DELETE /api/extensions/:id
PATCH  /api/extensions/:id                      # enable/disable/configure
POST   /api/extensions/reload                   # rescan disk (hot-reload)
```

Install flow (`ExtensionManager.install`):

1. Fetch source (npm-style tarball, local zip, `git://`, or directory).
2. Validate `extension.json` against `ExtensionManifestSchema` (Zod).
3. Compute permission diff vs. previously-installed version; prompt the user if new perms.
4. Extract to `<targetScope>/extensions/<pkg>@<ver>/` atomically (temp dir → rename).
5. Verify signature if `publisher` matches a trusted publisher key.
6. Register with `CustomToolRegistry` / `McpHub` / `SystemArtifactService` / `HookRegistry` / `WidgetRegistry` per `contributes`.
7. Emit `extension.installed` event on `EventBus`.

Uninstall reverses steps 6–4 and calls each contributed component's `dispose()`. Reload = uninstall + install without deleting user config (`configuration` values are keyed by `id`).

### 5.4 Manifest validation & capability graph

`ExtensionManager` builds a capability graph so we can detect and surface conflicts (two extensions contributing the same MCP server name, same tool name, same skill id, …). Conflicts follow **workspace > user > system** precedence with a UI warning; the losing contribution is disabled with a reason surfaced in Settings.

### 5.5 Configuration & secrets

- `contributes.configuration` schema → auto-generated form in Settings UI (`react-jsonschema-form`-style; already used implicitly by our workflow variable UI).
- Secrets: extensions declare `contributes.secrets: [{ id, description }]`. Values live in the existing OS keychain via `keytar` (**not** in `.generatorai/`). Delivered to the widget/server code as `env.EXT_<id>`.

---

## 6. Canvas — extensions as full-window apps

Canvas is not a new subsystem. It's a *routing decision*: any widget instance with `surface: 'canvas'` (or promoted via `openInCanvas()`) is opened as a new tab in the existing `RightPane`:

- Add a canvas tab kind to `RightPane` on Chat + Workflow Run pages: `{ label: 'Canvas', allowMultiple: true, render: ctx => <WidgetFrame instanceId={ctx.id} /> }`.
- On `harness.widget.render` with `surface: 'canvas'`, the client dispatches `focusTabRequest={type: 'canvas', payload: { instanceId }, token: Date.now()}` — this reuses the existing pattern that pops the Browser tab on `browser.session_created`.
- The tab title uses `descriptor.title || descriptor.component`. Multiple canvases can coexist (like multiple terminals today).
- Header actions on the canvas tab:
  - **Save to Workspace Artifact** — snapshots the current state as a `WorkspaceArtifact` of type `canvas_snapshot` (a new artifact type — negligible schema addition).
  - **Install as Extension** — freezes the generated code as `<workspace>/.generatorai/extensions/<generated>@<ver>/` and reloads.
  - **Share to Chat** — inserts a `WidgetBlock` reference back into the chat timeline.
  - **Pop out** (desktop only, later) — reopen in an Electron `BrowserWindow`.

**Why this is optimal:** users already know how the right pane works (Browser + Terminal shipped there). We get multi-canvas, per-page persistence, drag-resize and keyboard focus for free.

---

## 7. Agent-authored extensions — "Build me an app" flow

Two artifacts wire this end-to-end:

### 7.1 Skill: `extension-authoring.md`

Ships in `templates/system/artifacts/skills/`. Body summarizes:
1. The manifest schema and directory layout.
2. Best practices for widget HTML (single self-contained file, CSP-safe, use `WidgetHostAPI`).
3. How to test locally (`callTool('ui.render', …)` inline vs. `openInCanvas()`).
4. How to iterate ("stream updates via `updateState`, don't tear down").

Enabled on demand via existing skill toggle. When enabled, the agent knows the recipe.

### 7.2 Custom tools (registered in composition root)

```
extension.scaffold({ id, name, contributes })            → writes manifest + entry files, returns absolute paths
extension.writeFile({ id, relativePath, contents })      → path-traversal guarded write inside the extension dir
extension.hotReload({ id })                              → reload manifest + reregister capabilities
extension.previewInCanvas({ id, component, props })      → creates a widget instance + opens canvas tab
extension.publish({ id, scope: 'workspace' | 'user' })   → commit the ephemeral scaffold to a persistent scope
```

Typical prompt flow:
1. User: *"Build me an interactive Kanban board tied to my TODOs."*
2. Agent enables the `extension-authoring` skill (auto-suggested when the user's intent matches the skill's `activationHints`).
3. Agent calls `extension.scaffold` — writes `~/.generatorai/scratch/extensions/kanban@0.0.1/` (ephemeral scratch scope).
4. Agent writes `ui/board.html`, `server/tools.mjs`, `extension.json` via `extension.writeFile`.
5. Agent calls `extension.previewInCanvas({ id: 'kanban', component: 'board' })` — canvas tab opens; user sees the app; interactions round-trip through `WidgetHostAPI`.
6. Iteration: user says "add a due-date column"; agent edits files and calls `extension.hotReload` — canvas re-mounts.
7. User clicks **Install as Extension → Workspace** (or agent calls `extension.publish({ scope: 'workspace' })`). Now it lives in `<workspace>/.generatorai/extensions/`.

### 7.3 Ephemeral vs. persisted

Widgets rendered without a scaffolded extension use an anonymous system-scope extension called `inline-scratch` — same code path as Claude Artifacts. Publishing an inline scratch widget copies it to a real extension dir with a proper `id`.

---

## 8. Security model

This is the section I care about most, and the one that eats the majority of the design budget.

### 8.1 Threat surface

Extensions run untrusted third-party code with access to (potentially) the user's tools + workspace. The mitigations:

| Threat | Mitigation |
|---|---|
| Widget XSS / DOM access to host page | Sandboxed iframe, no `allow-same-origin`. |
| Data exfiltration via `fetch` | CSP `connect-src 'none'`. All network calls must go through `WidgetHostAPI.callTool` — subject to permissions. |
| Token/keystore theft from `localStorage` | Null-origin iframe has its own storage; no access to host `localStorage`. |
| Malicious backend module (`server/*.mjs`) | Same allowlist as `script` hooks (`node`/`python`/`bash`/…). When `SANDBOX_ENABLED=true`, backend code runs in the existing Docker sandbox. |
| Escalating from `default` to `bypassPermissions` | Widgets cannot change `permissionMode`. Only the user (via existing HITL controls) can. |
| Prompt injection from widget-generated messages | Messages sent via `sendChatMessage` are stamped with `origin: 'widget'` in metadata and displayed with a chip in the UI. HITL policy can require confirmation for widget-originated messages. |
| Path traversal via extension writes | Every FS op goes through the existing `resolveWithin(baseDir, requestedPath)` guard from `WorkspaceManager`. |
| Signature spoofing | Manifest `signature` field is verified against publisher keys. Publisher trust is opt-in per user (Settings → Extensions → Trusted publishers). |
| Denial of service via runaway JS | Iframe watchdog: if no `heartbeat` postMessage in 30s, host shows a "Reload widget?" banner. |

### 8.2 Permission negotiation

- Install-time: user sees the manifest permissions and clicks Approve.
- Runtime: if a widget requests a permission not in the manifest, `WidgetHostAPI.requestPermission` opens a HITL prompt (same UI as tool-call approval).
- Permissions are scoped: `network:fetch:api.acme.io` only allows exact host matches; wildcards require explicit approval.

### 8.3 Backend runtime

Two modes:

- **Trust mode** (default, matches current PWS/hooks story): `server/*.mjs` runs in the server process under the same `HookInterceptor` allowlist as today's function hooks.
- **Sandbox mode** (`SANDBOX_ENABLED=true`, matches current sandbox story for `script` hooks): backend module runs inside `docker/sandbox-template/` — CPU/mem quotas, no host FS mount except the extension dir + workspace `source/`.

---

## 9. Concrete file-by-file plan (single source of truth for implementation)

> Sequenced into 5 phases to keep each PR reviewable. Each phase ends in a green build + Playwright smoke.

### Phase 1 — Extension backbone (no UI yet)

**New files:**
- `packages/shared/src/types/Extension.ts` — manifest types + activation + capability types
- `packages/shared/src/types/Widget.ts` — descriptor + instance + permission types
- `packages/shared/src/config/ExtensionManifestSchema.ts` — Zod validators
- `packages/shared/src/config/WidgetSchemas.ts` — descriptor + permission Zod
- `packages/core/src/domain/ports/IExtensionRegistry.ts`
- `packages/core/src/domain/ports/IWidgetRegistry.ts`
- `packages/core/src/services/ExtensionManager.ts`
- `packages/core/src/services/WidgetService.ts`
- `packages/core/src/services/ExtensionSandbox.ts` (thin wrapper over existing `SandboxScriptRunner`)
- `packages/db/src/repositories/WidgetInstanceRepository.ts`
- `packages/db/src/migrations/0009_extensions_widgets.sql` — `extensions` + `widget_instances` tables
- `apps/server/src/routes/extensions.ts`
- `apps/server/src/routes/widgets.ts`

**Edits:**
- `packages/shared/src/types/AgentEvent.ts` — add `harness.widget.*` variants
- `apps/server/src/composition-root.ts` — wire `ExtensionManager`, `WidgetService`, seed `ui.render` tool into `CustomToolRegistry`
- `packages/core/src/services/ChatManagementService.ts` — thread widget events through the existing `chatExtensions` scope
- `packages/shared/src/types/ChatMessage.ts` — add `metadata.widgetInstanceIds?: string[]` and `metadata.origin?: 'user' | 'widget' | 'system'`

**Exit criteria:** unit tests + a fake extension in `templates/system/extensions/` renders a "hello" instance via `POST /api/widgets` and shows up in `GET /api/widgets/:id`.

### Phase 2 — Inline widget rendering

**New files:**
- `apps/web/src/components/widgets/WidgetFrame.tsx`
- `apps/web/src/components/widgets/WidgetBridge.ts` (JSON-RPC over postMessage)
- `apps/web/src/hooks/useWidgetInstance.ts`

**Edits:**
- `apps/web/src/stores/streamStore.ts` — add `WidgetBlock`, wire event kinds
- `apps/web/src/stores/sseManager.ts` — route `harness.widget.*` (respect the load-bearing flush at lines 160–183)
- `apps/web/src/components/agent/deriveTimeline.ts` — surface `WidgetBlock` (inline surface renders below the answer, not in the step timeline)
- `apps/web/src/components/agent/chatMessageToBlocks.ts` — reconstruct `WidgetBlock`s from `metadata.widgetInstanceIds`
- `apps/web/src/components/agent/StreamPanel.tsx` — insert `<WidgetFrame>` slots
- `apps/cli/src/streaming/EventRenderer.ts` — text-only fallback ("[widget: PDF Viewer opened — open in web to interact]")

**Exit criteria:** Playwright test where a stub extension emits a counter widget; user clicks +1 twice; both increments appear as `harness.widget.state`; refresh replays state.

### Phase 3 — Canvas + right-pane tabs

**Edits:**
- `apps/web/src/components/layout/RightPane.tsx` — no code changes; consumers add tabs
- `apps/web/src/pages/ChatPage.tsx` + `WorkflowRunPageV2.tsx` — register `canvas` tab kind (`allowMultiple: true`), listen for `harness.widget.render` with `surface: 'canvas' | 'right-pane'` and dispatch `focusTabRequest`
- `apps/web/src/components/widgets/CanvasHeader.tsx` (Save/Install/Share actions)

**Exit criteria:** Playwright test where `surface: 'canvas'` widget pops the pane; header actions round-trip through the server; multiple canvas tabs coexist.

### Phase 4 — Manifest install + capabilities

**New files:**
- `packages/core/src/services/ExtensionInstaller.ts` — fetch (tarball/git/dir), verify, extract
- `packages/core/src/services/ExtensionCapabilityGraph.ts` — merges contributions; conflict detection
- `apps/cli/src/commands/extension.ts` — CLI subcommands
- `apps/web/src/pages/settings/ExtensionsPage.tsx`
- Sample first-party extension: `templates/system/extensions/genai.hello-world/`
- Sample first-party extension: `templates/system/extensions/genai.markdown-notes/` (a canvas-first note editor)

**Edits:**
- `packages/core/src/services/SystemArtifactService.ts` — accept "extensions" as a fifth merger scope
- `packages/core/src/services/CustomToolRegistry.ts` — accept `owner: { extensionId }` so uninstall cleanly removes tools
- `packages/core/src/services/McpHub.ts` — same ownership tag
- `packages/core/src/services/HookRegistry.ts` — same

**Exit criteria:** `generatorai extension install ./templates/system/extensions/genai.hello-world` from a fresh workspace lights up the widget, the contributed tool, and the settings panel.

### Phase 5 — Agent-authored extensions (the R4 skill loop)

**New files:**
- `templates/system/artifacts/skills/extension-authoring.md`
- `packages/core/src/services/ExtensionAuthoringTools.ts` — the `extension.*` custom tools
- `apps/web/src/components/widgets/InlineScratchBadge.tsx` — chip on ephemeral widgets with a "Publish" CTA

**Edits:**
- `apps/server/src/composition-root.ts` — register `extension.*` tools when the `extension-authoring` skill is enabled for the chat/stage
- `docs/EXTENSIONS_WIDGETS_CANVAS_PLAN.md` — this document, updated with implementation notes

**Exit criteria:** end-to-end Playwright: user prompt → agent scaffolds → previews in canvas → user clicks Publish → extension appears in `.generatorai/extensions/` and survives reload.

---

## 10. Example — a working `weather-card` widget

**`templates/system/extensions/genai.weather/extension.json`:**
```jsonc
{
  "id": "genai.weather",
  "name": "Weather Card",
  "version": "0.1.0",
  "engines": { "generatorai": ">=1.0.0" },
  "activationEvents": ["onTool:ui.render:genai.weather/*"],
  "permissions": ["network:fetch:api.open-meteo.com"],
  "contributes": {
    "widgets": [{
      "id": "card",
      "title": "Weather",
      "entry": "ui/card.html",
      "preferredSurface": "inline",
      "propsSchema": "schemas/card.props.json"
    }],
    "tools": [
      { "name": "weather.current", "module": "server/tools.mjs", "export": "current" }
    ]
  }
}
```

**Agent turn:**
```
Assistant → tool_call ui.render {
  widget: "genai.weather/card",
  props: { city: "Bangalore", units: "metric" }
}
Server   → harness.widget.render { instanceId: "w_9…", descriptorId: "genai.weather/card", props: … }
Browser  → WidgetFrame mounts card.html; card calls host.callTool("weather.current", {city:"Bangalore"})
Server   → runs tools.mjs current(), gated by permission "network:fetch:api.open-meteo.com"
Browser  → card renders 24° / Partly cloudy; user clicks "Show week"
Widget   → host.emitAction("show-week")
Server   → harness.widget.action fires; agent sees it in the event stream and can respond
Assistant → "Here's the 7-day forecast — I'll refresh the card." → calls weather.forecast → widget updates state
```

Nothing about this pattern is new — it's the exact playbook Vercel AI SDK, MCP Apps, ChatGPT Apps SDK, and Claude Artifacts converged on. The value we add is *the packaging*: this whole thing lives in a folder the user can install, share, version, and hot-reload.

---

## 11. Why this design is optimal (self-review)

**Alignment with existing invariants (AGENTS.md §5):**
- Event addition is drop-in — no bridge changes (§5.2, §5.3 preserved).
- SSE cross-buffer flush order is respected (§5.4).
- Widget lifecycle hooks into `WorkspaceManager.registerBeforeDelete` (§5.14) so canvases/backends terminate cleanly.
- WebSocket paths untouched (§5.15) — everything rides SSE + REST.

**Alignment with the mental model (AGENTS.md §3):**
- Presentation only touches Application via a facade (`WidgetService`).
- Domain gets 2 new ports (`IExtensionRegistry`, `IWidgetRegistry`) and 0 new SDK imports — the `IAgentHarness` boundary stays clean.
- Infrastructure additions are just an installer + a sandbox wrapper, both re-using existing services.

**Interop:**
- Extensions can host MCP servers, and MCP tools with `_meta.ui.resourceUri` render as widgets out of the box → we're compatible with any tool built for MCP Apps / MCP-UI / ChatGPT Apps SDK.
- The manifest is `contributes`-shaped so people familiar with VS Code extensions can port their mental model directly.

**Extensibility from user's POV:**
- Same UX for author + consumer: an "extension" that ships a canvas app looks the same whether Anthropic-style Artifacts made it, v0 generated it, or a marketplace author published it.
- Ephemeral → published is one click; publication scope (workspace vs. user) is user's choice.
- Right-pane multi-canvas means users can keep several generated apps open like tabs.

**Rejected alternatives:**
- *"Just use markdown code blocks with react-live"* — no server round-trip, can't do tool calls securely, no lifecycle, no permissions.
- *"Ship each extension as a separate iframe URL served by the extension itself"* — introduces network dependency, breaks offline, breaks CSP model, breaks workspace-local privacy.
- *"Use Web Components in the host page"* — same-origin means any extension can steal tokens; no sandbox = no third-party extensions.
- *"Extend PWS to include UI"* — `.workflow.mjs` doesn't need to grow a UI runtime; extensions can *contribute* a PWS script instead, keeping concerns separate.

**Risks & mitigations:**
- *iframe sandbox nuances differ by browser* → we test against the top-3 Chromium versions in CI (Playwright is already there).
- *Extension marketplace social-engineering* → v1 ships with **no marketplace**; installs are explicit URL/tarball only. A signed publisher registry can come later.
- *Widget→tool RPC latency* → same p95 as our tool timeline today (SSE-back); acceptable for most UIs. High-frequency (60fps) canvases can `updateState` locally and periodically sync.

---

## 12. What I'd like you to check before we implement

1. **Scope of Phase 1.** Are you comfortable landing the backbone (types, DB, routes, one hello-world extension, no UI) in a single PR? If you'd rather have a "vertical slice" (crappy end-to-end first), I'll reorder.
2. **Sandbox stance for backend code.** Do you want `SANDBOX_ENABLED=true` to be the default for extension backends (safer, slower boot) or opt-in like today?
3. **Workspace-scope default.** When the user runs `generatorai extension install X` inside a workspace, do we default to `--workspace` (privacy, ephemeral) or `--user` (share across workspaces)? My recommendation: `--workspace` by default, matching the request in R2.
4. **Canvas placement.** Right pane (matches Browser/Terminal today) or a full-height Artifacts-style overlay? I chose the right pane for consistency; happy to reconsider.
5. **MCP Apps compatibility as a hard requirement.** I've made it drop-in (Path B in §4.3). Confirm you want this so we can charter the manifest fields accordingly.
6. **Agent-authored extension scope defaults.** Should the "Build me an app" flow default to ephemeral (auto-cleanup) or persist-to-workspace on first run? My recommendation: ephemeral, with an obvious "Install to workspace" chip on the canvas.

---

## 13. Estimated impact per package

| Package | LOC additions (rough) | Risk |
|---|---|---|
| `packages/shared` | ~600 (types + Zod) | Low |
| `packages/core` | ~1800 (services + ports + capability graph) | Medium (new subsystem) |
| `packages/db` | ~300 (migration v9 + repo) | Low |
| `apps/server` | ~700 (routes + wiring) | Low |
| `apps/web` | ~2000 (widget frame + bridge + canvas + settings UI) | Medium (net-new UI surface) |
| `apps/cli` | ~400 (extension commands) | Low |
| `templates/system/extensions/*` | ~500 (hello-world + weather + notes) | Low |
| Tests | ~1500 (unit + Playwright) | Low |

Total ≈ 7.8k LoC net-new. No changes to `IAgentHarness` or any harness provider.

---

**End of proposal. Awaiting your review before any implementation begins.**
