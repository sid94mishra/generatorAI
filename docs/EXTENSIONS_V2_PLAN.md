# Extensions v2 — Implementation Plan

**Status:** Draft rev-2 for review
**Author:** GitHub Copilot (Claude Opus 4.7)
**Date:** 2026-07-14 (rev-2 same day)
**Supersedes (partially):** [EXTENSIONS_WIDGETS_CANVAS_PLAN.md](./EXTENSIONS_WIDGETS_CANVAS_PLAN.md) §§ 5, 8
**Change log rev-2:** Renamed entry function to `loadExtension`, renamed API handle
`pi` → `ai`, made `canvas` the default widget surface, added `search_widget`
tool + widget progressive disclosure, formalized widget↔agent↔user
communication architecture with sequence diagrams, deepened instance-id /
persistence rules.

---

## 0. Context & Non-Goals

This plan extends the widget/extension system already shipped in Phases 1–4 of
[EXTENSIONS_WIDGETS_CANVAS_PLAN.md](./EXTENSIONS_WIDGETS_CANVAS_PLAN.md). Widgets,
canvas surface, and the Settings UI are already live. What is missing:

- Only `widgets` and `tools` from the manifest are wired at boot; hooks / MCP /
  skills / commands / right-pane panels are declared but ignored.
- Widget CSP forbids external `<script src>` and `<link rel="stylesheet">`,
  forcing all widget code to be inlined into one HTML file.
- The `ui_render` / `ui_update` / `ui_close` tools are per-chat closures rather
  than first-class registered tools.
- There is no LLM-facing workflow for creating an extension from a chat prompt.
- The system prompt does not scale as more extension tools appear.
- Widgets are always inline in chat; users cannot influence where a widget
  lands by default. Discovery of *which widget to render* is not exposed to the
  agent (no equivalent of tool discovery).

**Non-goals for v2:**

- Sandboxing (fork+RPC, isolated-vm, Docker) — documented as a future path only.
- Public marketplace / signing / auto-updates.
- Codemod-style dynamic code execution (`exec_code` LLM tool). Deferred.
- Migrating existing v1 (`contributes.*`) extensions destructively. Both
  formats are supported for at least two releases.
- Multi-tenant hosting.

**Trust posture for v2:** local / self-hosted / user-VPC only. Dynamic
`import()` in-process with strict manifest and API validation. Sandbox is a
documented Phase 6+ item.

---

## 1. Consolidated Requirements

| # | Requirement | Source |
|---|---|---|
| R1 | No sandbox in v2; dynamic import with schema validation only. Sandbox path documented. | User confirmation, 2026-07-14 |
| R2 | Widget HTML can `<script src>` / `<link href>` files inside its own folder. Iframe stays sandboxed and null-origin. | User confirmation |
| R3 | Extension has **one entry file** with a **`loadExtension(ai)`** default export that receives the application registration surface and imperatively contributes widgets, MCP, tools, commands, hooks, skills, prompts, right-pane panels. | User confirmation rev-2 |
| R4 | Main app loads the entry file, collects contributions, merges into the tool/MCP/registry set sent to the provider. | User confirmation |
| R5 | Rename `ui_render` → `render_widget` and promote to a built-in application tool (not per-chat closure). | User confirmation |
| R6 | Dynamic tool loading via a "loader" tool — start with a small active set; loader activates matching tools on demand. | User confirmation |
| R7 | Agent skill that authors extensions from a chat prompt, writes files, triggers reload. | User confirmation |
| R8 | Everything must survive hot reload. | User confirmation |
| R9 | Widgets can declare their preferred render surface (`canvas` / `chat` / `right-pane`). **Default surface for a new widget is `canvas`.** | User confirmation rev-2 |
| R10 | Widgets are progressively disclosed to the agent via a `search_widget` tool alongside `render_widget`, not dumped into the system prompt. | User confirmation rev-2 |
| R11 | Formalize the widget ↔ agent ↔ user communication protocol, instance-id lifecycle, and persistence rules explicitly. | User confirmation rev-2 |
| R12 | Terminology: use **`ai`** (not `pi`) as the extension API handle inside code. | User confirmation rev-2 |

---

## 2. High-Level Architecture

```
                        ┌─────────────────────────────────────┐
                        │  User Extension (single folder)      │
                        │                                      │
                        │  manifest.json      ← required, tiny │
                        │  index.ts / .js     ← entry (default │
                        │                       export =       │
                        │                       loadExtension) │
                        │  ui/widget.html                      │
                        │  ui/bundle.js                        │
                        │  tools/*.ts                          │
                        │  skills/*.md                         │
                        │  mcp/*.json                          │
                        └─────────────────────────────────────┘
                                       │
                                       │ ExtensionManager.load()
                                       ▼
┌──────────────────────────────────────────────────────────────┐
│                 ExtensionRuntime (main process)               │
│                                                               │
│  ┌────────────────────┐   ┌──────────────────────────────┐   │
│  │ ExtensionManager   │──►│ ExtensionAPI (ai, per ext)   │   │
│  │  - discover        │   │  ├── ai.registerWidget(...)  │   │
│  │  - validate        │   │  ├── ai.registerTool(...)    │   │
│  │  - trust check     │   │  ├── ai.registerMcpServer()  │   │
│  │  - load entry      │   │  ├── ai.registerCommand()    │   │
│  │  - hot reload      │   │  ├── ai.registerHook()       │   │
│  └────────────────────┘   │  ├── ai.registerSkill()      │   │
│         │                 │  ├── ai.events               │   │
│         ▼                 │  └── ai.log(...)             │   │
│  ┌────────────────────┐   └──────────────────────────────┘   │
│  │ Registries         │            │                          │
│  │  - WidgetRegistry  │◄───────────┤ each register() call     │
│  │  - CustomTools     │◄───────────┤ mutates the right        │
│  │  - McpHub          │◄───────────┤ registry (staged then    │
│  │  - HookRegistry    │◄───────────┤ committed transactionally│
│  │  - CommandRegistry │◄───────────┘ per extension)           │
│  │  - SystemArtifacts │                                        │
│  └────────────────────┘                                        │
│         │                                                      │
│         ▼                                                      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ChatManagementService.createChat                       │  │
│  │  - queries registries                                   │  │
│  │  - assembles tool list (built-in + extension)           │  │
│  │  - injects always-active core tools:                    │  │
│  │       render_widget / update_widget / close_widget      │  │
│  │       search_widget / find_and_load_tool                │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                     Agent request to LLM provider
```

---

## 3. Extension Package Format

### 3.1 Minimum viable extension

```
my-extension/
├── manifest.json          ← REQUIRED (metadata only)
└── index.ts               ← REQUIRED (default export = loadExtension)
```

### 3.2 Full-featured extension

```
my-extension/
├── manifest.json
├── index.ts
├── ui/
│   ├── list.html
│   ├── styles.css
│   └── bundle.js          ← referenced by <script src="./bundle.js">
├── tools/
│   └── summarize.ts
├── skills/
│   └── my-skill.md
├── mcp/
│   └── my-mcp.json
└── node_modules/          ← if author bundled deps (optional)
```

### 3.3 `manifest.json` (thin — just enough for pre-execution)

```json
{
  "id": "acme.todo",
  "version": "1.0.0",
  "name": "Todo",
  "description": "Todo list widget and tools",
  "entry": "./index.ts",
  "engines": { "generatorai": "^1.0.0" },
  "author": { "name": "acme" },
  "capabilities": ["widgets", "tools", "mcp", "commands", "hooks", "skills"],
  "trustLevel": "user"
}
```

The manifest is intentionally thin. The runtime validates identity, entry
path, capabilities, and engine compatibility **before** it executes any of the
extension's code. Everything else (widget descriptors, tool defs, MCP configs)
is authored in the entry file.

### 3.4 Entry file example

```typescript
// index.ts
import type { ExtensionAPI } from '@generatorai/extension-sdk';
import { z } from 'zod';

// Called exactly once when the extension is activated. Runtime injects the
// per-extension `ai` handle. Async is supported. Optional return: an async
// disposer that runs on hot-reload / uninstall.
export default async function loadExtension(ai: ExtensionAPI) {
  // 1. Widget — defaults to canvas surface when the agent renders it
  ai.registerWidget({
    id: 'list',                              // final descriptor: acme.todo/list
    title: 'Todo List',
    description: 'Interactive todo list',
    entry: 'ui/list.html',                   // resolved against extension root
    preferredSurface: 'canvas',              // 'canvas' (default) | 'chat' | 'right-pane'
    propsSchema: z.object({ initialTasks: z.array(z.string()).optional() }),
    stateSchema: z.object({
      tasks: z.array(z.object({
        id: z.string(),
        text: z.string(),
        done: z.boolean(),
      })),
    }),
    permissions: ['widget.state', 'widget.action'],
    // Optional: keywords the search_widget tool uses to rank matches
    keywords: ['todo', 'task', 'checklist', 'sprint'],
  });

  // 2. Custom tool (progressively disclosed unless alwaysActive)
  ai.registerTool({
    name: 'summarize_todos',
    description: 'Summarize the current todo list',
    inputSchema: z.object({
      filter: z.enum(['all', 'done', 'open']).default('all'),
    }),
    async handler(args, ctx) {
      const state = await ctx.widget.getState('acme.todo/list');
      return { summary: `${state.tasks.length} tasks…` };
    },
    promptSnippet: 'Summarize the user\'s todo list',
    promptGuidelines: [
      'Use summarize_todos when the user asks about their tasks or progress.',
    ],
    // Rare, small, safe tools can opt out of progressive disclosure
    alwaysActive: false,
  });

  // 3. MCP server (subprocess or HTTP)
  ai.registerMcpServer({
    name: 'todo-mcp',
    command: 'node',
    args: ['./mcp/server.js'],
    cwd: ai.extensionDir,
  });

  // 4. Slash command
  ai.registerCommand('clear-todos', {
    description: 'Clear all completed todos',
    async handler(args, ctx) {
      await ctx.widget.dispatchAction('acme.todo/list', 'clearCompleted');
    },
  });

  // 5. Hook
  ai.registerHook('before_tool_call', async (event, ctx) => {
    if (event.toolName === 'bash' && event.input.command.includes('rm -rf')) {
      const ok = await ctx.ui.confirm('Dangerous', 'Allow rm -rf?');
      if (!ok) return { block: true };
    }
  });

  // 6. Skill
  ai.registerSkill({
    id: 'todo-tips',
    path: 'skills/todo-tips.md',
  });

  // 7. Right-pane panel (a widget shown as a permanent tab in the right pane)
  ai.registerRightPanePanel({
    id: 'todo-summary',
    title: 'Todos',
    widget: 'acme.todo/list',
    page: 'chat',
  });

  // 8. Cross-extension event bus
  ai.events.on('acme.todo:cleared', (data) =>
    ai.log.info('Todos cleared', data),
  );

  // Optional disposer for hot-reload cleanup
  return () => {
    ai.log.info('acme.todo deactivating');
  };
}
```

---

## 4. `ExtensionAPI` Surface Spec

```typescript
export interface ExtensionAPI {
  // Metadata
  readonly id: string;
  readonly version: string;
  readonly extensionDir: string;         // absolute path

  // Registration (imperative)
  registerWidget(descriptor: WidgetDescriptorInput): void;
  registerTool(definition: ToolDefinitionInput): void;
  registerMcpServer(config: McpServerConfig): void;
  registerCommand(name: string, options: CommandOptions): void;
  registerHook<E extends HookPhase>(phase: E, handler: HookHandler<E>): void;
  registerSkill(spec: SkillSpec): void;
  registerPrompt(spec: PromptSpec): void;
  registerRightPanePanel(spec: RightPanePanelSpec): void;

  // Optional: contribute to system prompt
  addPromptSnippet(text: string): void;
  addPromptGuidelines(bullets: string[]): void;

  // Cross-extension events
  readonly events: EventEmitter<Record<string, unknown>>;

  // Runtime helpers
  readonly log: Logger;
  readonly config: ExtensionConfigStore;   // scoped KV store, persisted per ext
  readonly fs: RestrictedFs;               // safe helpers within extensionDir
}

// Widget descriptor input — the `ai` handle validates this
export interface WidgetDescriptorInput {
  id: string;                              // becomes ${extensionId}/${id}
  title: string;
  description?: string;
  entry: string;                            // relative path to HTML
  preferredSurface?: WidgetSurface;         // default: 'canvas'
  propsSchema?: z.ZodType;
  stateSchema?: z.ZodType;
  permissions?: WidgetPermission[];
  keywords?: string[];                      // used by search_widget for ranking
}

export type WidgetSurface = 'canvas' | 'chat' | 'right-pane';
// Aliases accepted at parse time: 'inline' → 'chat', 'card' → 'chat'
```

The `ctx` object passed to tool/hook handlers is **separate** from `ai` and
gives access to session, chat, user, and agent-scoped services. Registration
happens at load time via `ai`; runtime work happens via `ctx`.

---

## 5. Loading, Validation & Activation Flow

```
Server boot
  ├─► ExtensionManager.discover()
  │   ├─► scan system dir  (templates/system/extensions)
  │   ├─► scan user dir    (~/.generatorai/extensions)
  │   └─► (workspace scan deferred, on trust)
  │
  ├─► for each candidate dir:
  │   ├─► read manifest.json
  │   ├─► ExtensionManifestSchema.safeParse (Zod)
  │   ├─► if invalid → mark errored, keep in list, skip execution
  │   └─► if valid → resolveEntry(dir + manifest.entry)
  │
  ├─► for each valid, scope-winning ext (workspace > user > system):
  │   ├─► create ExtensionAPI instance (ai = new ExtensionAPI(ext))
  │   ├─► await import(pathToFileURL(entryPath))
  │   ├─► const load = mod.default ?? mod.loadExtension
  │   ├─► await load(ai)                    ← factory runs, populates staging
  │   ├─► collect ai's staged contributions
  │   └─► store disposer if returned
  │
  └─► ExtensionManager.commit()
      ├─► WidgetRegistry.registerBatch(pendingWidgets)
      ├─► CustomToolRegistry.registerBatch(pendingTools)
      ├─► McpHub.registerBatch(pendingMcpServers)
      ├─► HookRegistry.registerBatch(pendingHooks)
      ├─► CommandRegistry.registerBatch(pendingCommands)
      ├─► SystemArtifactService.materializeBatch(pendingSkills/prompts)
      └─► emit `extension.installed` events for each ext
```

**Transactional contribution:** contributions are staged per extension; if the
entry file throws, staged items are discarded and never reach the registries.
This prevents ghost widgets/tools with dangling references.

Contributions become visible to the agent immediately after commit. If a
reload lands mid-session, the **next agent turn** picks up the new tool list;
in-flight turns finish with the previous tool list.

### 5.1 Reload flow

```
ExtensionManager.reload(id)
  ├─► locate extension record
  ├─► call stored disposer() if present
  ├─► WidgetRegistry.unregisterByExtension(id)
  ├─► CustomToolRegistry.unregisterByExtension(id)
  ├─► McpHub.unregisterByExtension(id)
  ├─► HookRegistry.unregisterByExtension(id)
  ├─► CommandRegistry.unregisterByExtension(id)
  ├─► cache-bust entry URL: `${pathToFileURL(entry)}?v=${Date.now()}`
  └─► re-run loadExtension()
```

---

## 6. Widget CSP Relaxation

### 6.1 Change to widget-assets route

`apps/server/src/routes/extensions.ts` widget-assets route: relax the CSP
from

```
script-src 'unsafe-inline' 'unsafe-eval';
style-src  'unsafe-inline';
```

to

```
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src  'self' 'unsafe-inline';
img-src    data: blob: 'self';
font-src   'self' data:;
connect-src 'none';
```

**Now enabled**
- `<script src="./bundle.js">`
- `<link rel="stylesheet" href="./styles.css">`
- `<link rel="modulepreload" href="./chunk-a.js">`

**Still blocked** (same security posture)
- `fetch('/api/…')` — `connect-src 'none'`
- `<script src="https://cdn.example.com/…">` — no external hosts
- Reading cookies / localStorage — iframe null-origin, no `allow-same-origin`

### 6.2 `<base href>` injection

To make relative URLs resolve correctly when HTML is served via `srcDoc`, the
widget-assets route injects a `<base>` tag into `<head>`:

```typescript
const baseHref = `${assetsBase}/api/widget-assets/${encodeURIComponent(extId)}/${dirname(entry)}/`;
const patchedHtml = html.replace(/<head[^>]*>/i, m => `${m}<base href="${baseHref}">`);
```

---

## 7. Progressive Disclosure: Widgets and Tools

### 7.1 The problem

If we dump every widget descriptor and every extension tool into the system
prompt on every request:
- 30 widgets × 200 tokens each = 6 000 tokens of "here's what you could
  render." Most requests need zero of these.
- 30 tools × 200 tokens each = 6 000 more tokens for tool schemas.
- On top of the built-in tool list, this doubles the prompt overhead and
  invalidates the initial prompt cache on every extension install/reload.

### 7.2 Two-tier disclosure

**Tier 1 — always active in every session** (small, cheap, must always be
callable):

| Tool | Purpose |
|---|---|
| `render_widget` | Instantiate a widget the agent already knows about |
| `update_widget` | Push new state into a live widget |
| `close_widget` | Close / dispose a widget instance |
| `search_widget` | Discover which widgets are installed and their metadata |
| `find_and_load_tool` | Discover and activate extension tools |

**Tier 2 — registered but inactive by default:**
- All extension-contributed tools (unless the extension flags a tool
  `alwaysActive: true`).
- All extension-contributed widgets are known to `search_widget` from the start
  (widget "activation" is not a thing — they're always callable by
  `render_widget` as long as the extension is loaded).

### 7.3 `search_widget` tool

```typescript
{
  name: 'search_widget',
  description:
    'Search for a widget you can render for the user. Returns a small ranked ' +
    'list of installed widgets that match the query, including each widget\'s ' +
    'descriptor id, title, description, preferred surface, and a summary of ' +
    'its props schema. Once you pick one, call render_widget with its ' +
    'descriptor id.',
  inputSchema: z.object({
    query: z.string().describe('What the widget should do or contain'),
    surface: z.enum(['canvas', 'chat', 'right-pane']).optional()
      .describe('Only return widgets that prefer this surface (optional)'),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  async handler({ query, surface, limit }, ctx) {
    const candidates = widgetRegistry.list().filter(w =>
      !surface || w.preferredSurface === surface
    );
    const ranked = rankWidgetsBySemantic(query, candidates, limit);
    return {
      widgets: ranked.map(w => ({
        descriptor: w.id,
        title: w.title,
        description: w.description,
        preferredSurface: w.preferredSurface,
        propsSummary: summarizeSchema(w.propsSchema),
        stateSummary: summarizeSchema(w.stateSchema),
      })),
      hint: 'Call render_widget with the chosen descriptor to render.',
    };
  },
}
```

Ranker starts as keyword match over `title + description + keywords`, upgradeable to embeddings later.

### 7.4 `render_widget` tool

```typescript
{
  name: 'render_widget',
  description:
    'Render an interactive widget for the user. Call this after choosing a ' +
    'widget with search_widget. The widget appears in the surface you specify ' +
    '(default: the widget\'s preferred surface, which is usually the canvas). ' +
    'Returns an instanceId you must remember to update or close the widget ' +
    'later. User interactions with the widget will appear as ' +
    'harness.widget.action events in subsequent context — read them to react.',
  inputSchema: z.object({
    descriptor: z.string().describe('Widget descriptor id, e.g. acme.todo/list'),
    props: z.record(z.unknown()).optional(),
    initialState: z.record(z.unknown()).optional(),
    surface: z.enum(['canvas', 'chat', 'right-pane']).optional()
      .describe('Override the widget\'s preferred surface'),
    title: z.string().optional(),
  }),
  async handler(args, ctx) {
    const descriptor = widgetRegistry.get(args.descriptor);
    if (!descriptor) throw new Error(`Unknown widget: ${args.descriptor}`);
    const surface = args.surface ?? descriptor.preferredSurface ?? 'canvas';
    const instance = await ctx.widgetService.createInstance({
      descriptorId: args.descriptor,
      sessionId: ctx.sessionId,
      chatId: ctx.chatId,
      workflowRunId: ctx.workflowRunId,
      surface,
      props: args.props,
      state: args.initialState,
      title: args.title,
    });
    return {
      instanceId: instance.id,
      descriptor: args.descriptor,
      surface,
      note:
        'Widget is now visible to the user. Watch for harness.widget.action ' +
        'events on subsequent turns.',
    };
  },
}
```

### 7.5 `find_and_load_tool` tool

Same design as before — activates matching extension tools so the LLM can call
them next turn. Anchored deferred loading is used on Anthropic / OpenAI
providers that support it.

---

## 7A. Widget ↔ Agent ↔ User Communication Architecture

This section formalizes the complete round-trip protocol.

### 7A.1 Data model recap

Widget instance row in `widget_instances` (SQLite):
```
id                w_<uuid-slice-12>       PK — passed to agent as instanceId
descriptorId      "acme.todo/list"
sessionId         session id (broadcast scope)
chatId            chat id or NULL for workflow-scoped
workflowRunId     nullable
stageRunId        nullable
messageId         id of the assistant message that spawned the widget
surface           'canvas' | 'chat' | 'right-pane'
props             JSON — initial props from the agent
state             JSON — mutable state, evolves via agent + user
status            'live' | 'closed' | 'error'
error             text, nullable
version           integer, incremented on each state write (concurrency guard)
createdAt         ms epoch
updatedAt         ms epoch
```

All persistence happens through `WidgetService`, which is the single entry
point for state writes. Nothing else writes to `widget_instances` directly.

### 7A.2 Agent → Widget → User (initial render)

```
LLM decides to render a widget
   │
   ▼
tool_call: render_widget({ descriptor, props, surface })
   │
   ▼
Server: render_widget handler
   ├─► WidgetService.createInstance()
   │     ├─► Zod-validate props against descriptor.propsSchema
   │     ├─► INSERT INTO widget_instances (...)
   │     └─► eventBus.emit('harness.widget.render', {
   │           chatId, workflowRunId, instanceId, descriptor,
   │           props, state, surface, title,
   │         })
   │
   ▼
StreamBroker routes to SSE subscribers on scope=chat:${chatId} + scope=session:${id}
   │
   ▼
Browser sseManager receives 'harness.widget.render'
   ├─► streamStore.addWidget({...})
   └─► React renders <WidgetFrame block={...} />
         ├─► WidgetFrame fetches HTML from /api/widget-assets/:extId/ui/...
         ├─► injects <base href> for relative asset resolution
         └─► iframe (null-origin sandbox) loads
              ├─► widget script sends postMessage 'widget:hello'
              ├─► widgetBridge receives, replies 'widget:init' {props, state}
              └─► widget renders, sends 'widget:ready'
   │
   ▼
User sees the widget in the surface (default = canvas)
   │
   ▼
Server: render_widget handler returns { instanceId, descriptor, surface, note }
The LLM tool result in its transcript contains the instanceId
```

### 7A.3 User → Widget → Agent (user interaction)

```
User clicks / types in widget
   │
   ▼
Widget script decides this is a semantically meaningful action
   │
   ▼
Widget sends postMessage 'widget:state' { state } and/or 'widget:action' { action, payload }
   │
   ▼
widgetBridge (browser) handles the message
   ├─► For 'widget:state':
   │     PATCH /api/widgets/:instanceId/state { state, version }
   │       └─► server enforces version check (409 on conflict)
   │       └─► WidgetService.updateState()
   │             ├─► UPDATE widget_instances SET state = ?, version = version+1
   │             └─► eventBus.emit('harness.widget.state', { chatId, instanceId, state, version })
   │
   └─► For 'widget:action':
         POST /api/widgets/:instanceId/actions { action, payload, from: 'user' }
           └─► WidgetService.dispatchAction()
                 ├─► optionally INSERT into widget_actions audit table (v3, not v2)
                 └─► eventBus.emit('harness.widget.action', { chatId, instanceId, action, payload, from: 'user' })
   │
   ▼
StreamBroker → SSE → all subscribers (including any listening agent turn)
   │
   ▼
For the AGENT: harness.widget.action events are folded into the next turn's
context as a synthetic assistant-observed event. The prompt builder appends
a short block like:
    <widget_event instanceId="w_a1b2c3d4">
      { action: "add_task", payload: { text: "Deploy to staging" }, from: "user" }
    </widget_event>
so the LLM can react on its next turn.
```

### 7A.4 Agent → Widget (agent-driven state update)

```
LLM decides to react to user action
   │
   ▼
tool_call: update_widget({ instanceId, state, mergeStrategy: 'replace' | 'merge' })
   │
   ▼
Server: update_widget handler
   ├─► WidgetService.updateState({ instanceId, state, source: 'agent' })
   │     ├─► SELECT current state; apply merge if requested
   │     ├─► Zod-validate merged state against descriptor.stateSchema
   │     ├─► UPDATE widget_instances SET state = ?, version = version+1
   │     └─► eventBus.emit('harness.widget.state', { ..., version })
   │
   ▼
Browser: sseManager → streamStore.updateWidgetState()
   │
   ▼
WidgetFrame effect on [block.state] fires
   ├─► widgetBridge.pushState(instanceId, state)
   └─► iframe receives postMessage 'widget:state' { state }
   │
   ▼
Widget re-renders, user sees update
```

### 7A.5 Message envelope specification (canonical)

Widget → host:

| Type | Direction | Payload | When |
|---|---|---|---|
| `widget:hello` | widget → host | `{}` | On mount, before any state |
| `widget:ready` | widget → host | `{}` | After first successful render |
| `widget:resize` | widget → host | `{ height: number }` | ResizeObserver fires |
| `widget:state` | widget → host | `{ state: unknown, version: number }` | User state change |
| `widget:action` | widget → host | `{ action: string, payload?: unknown }` | Semantic action |
| `widget:open-canvas` | widget → host | `{}` | Widget wants to promote itself to canvas |
| `widget:close` | widget → host | `{}` | Widget requests dismissal |
| `jsonrpc: chat.send` | widget → host | `{ text: string }` | Send a new user turn |
| `jsonrpc: tool.invoke` | widget → host | `{ name, args }` | Call a tool (Tier-1 only) |

Host → widget:

| Type | Payload | When |
|---|---|---|
| `widget:init` | `{ props, state, version }` | Reply to `widget:hello` |
| `widget:state` | `{ state, version }` | Agent pushed new state |
| `jsonrpc:response` | `{ id, result? | error? }` | Reply to widget JSON-RPC call |

### 7A.6 Concurrency & conflict resolution

- Each state write increments a monotonic `version` counter.
- Client must include the version it read from `widget:init`.
- Server rejects a PATCH with HTTP 409 if the client's version is stale.
- On 409, the client re-reads the latest state (`widget:state` push arrives via
  SSE anyway) and reconciles.
- **v2 policy is "last write wins after conflict":** the agent's write always
  wins over a stale user write, and vice versa. CRDT merging is out of scope.

### 7A.7 Failure modes

| Failure | Behavior |
|---|---|
| Widget crashes in browser | `WidgetFrame` catches load error → shows fallback banner → agent sees `harness.widget.error` on next turn |
| Extension uninstalled while widget live | Instance stays in DB with `status='error'`, descriptor lookup fails, WidgetFrame renders "extension unavailable" |
| Server restart | Widgets replay from `widget_instances` + `agent_events` on page load |
| Iframe loses connection | postMessage bridge auto-reconnects on next render cycle; no data loss (state lives in DB) |
| Chat deleted | Cascade-delete widget instances belonging to that chat |
| Session deleted | Cascade-delete widget instances belonging to that session |

---

## 8. Extension-Authoring Skill

### 8.1 Skill file

Ship `templates/system/skills/extension-author/SKILL.md`:

```markdown
---
name: extension-author
description: Author, install, and reload a GeneratorAI extension from the user's spec.
---

# Extension Author

When the user asks you to build a widget, custom tool, MCP integration, or
right-pane panel, invoke this skill.

Workflow:
1. Clarify user intent (widget vs tool vs both).
2. Decide extension id: <namespace>.<slug> (e.g. user.timer)
3. Write the manifest.json (thin — id, version, entry, capabilities).
4. Write the entry index.ts with a `loadExtension(ai)` default export.
5. Register widgets/tools/etc. imperatively via ai.register*.
6. Write widget HTML if any. CSP allows self-hosted scripts/styles.
7. Call the write_extension tool with the full file tree.
8. Call the reload_extension tool.
9. Verify by searching for the new widget with search_widget, then rendering it.

Widget defaults:
- Widgets render on the canvas surface by default. Use preferredSurface: 'chat'
  only if the widget is small and should live inline (e.g., a confirm button).

Constraints:
- Node built-ins allowed in tool handlers; no npm deps unless vendored.
- Widget iframe has connect-src 'none'; use widget:action/widget:state.
- Tools must return JSON-serializable results.
- Widget assets: <base href> auto-injected; relative URLs resolve correctly.
```

### 8.2 Built-in tools that support the skill

```typescript
writeExtensionTool: ToolDefinition = {
  name: 'write_extension',
  description: 'Create or overwrite files in a user-scope extension directory.',
  inputSchema: z.object({
    extensionId: z.string().regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/),
    files: z.array(z.object({
      path: z.string(),        // relative to extension root
      content: z.string(),
    })),
  }),
  handler: async (args, ctx) => {
    const root = path.join(ctx.config.extensionsDir, args.extensionId);
    for (const f of args.files) {
      if (!isSafeRelativePath(f.path)) {
        throw new Error(`unsafe path: ${f.path}`);
      }
      const abs = path.join(root, f.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, f.content, 'utf8');
    }
    return {
      extensionId: args.extensionId,
      root,
      filesWritten: args.files.length,
    };
  },
};

reloadExtensionTool: ToolDefinition = {
  name: 'reload_extension',
  description: 'Reload an extension after writing files.',
  inputSchema: z.object({ extensionId: z.string() }),
  handler: async ({ extensionId }, ctx) => {
    const before = ctx.extensionManager.get(extensionId);
    if (before) {
      await ctx.extensionManager.reload(extensionId);
    } else {
      await ctx.extensionManager.loadFromDir(
        path.join(ctx.config.extensionsDir, extensionId),
      );
    }
    return {
      status: 'ok',
      contributions: ctx.extensionManager.get(extensionId)?.contributions,
    };
  },
};
```

### 8.3 End-to-end user flow

> User: "Build me a Pomodoro timer widget with start/stop buttons that logs
> to chat when a session ends."

1. LLM invokes `extension-author` skill.
2. LLM asks 0–2 clarifying questions (only if genuinely ambiguous).
3. LLM emits `write_extension({ extensionId: 'user.pomodoro', files: [...] })`.
4. LLM emits `reload_extension({ extensionId: 'user.pomodoro' })`.
5. LLM emits `search_widget({ query: 'pomodoro timer' })` → confirms the new
   widget is visible.
6. LLM emits `render_widget({ descriptor: 'user.pomodoro/timer', props: { minutes: 25 } })`.
7. Timer appears on the canvas (default surface). User starts using it.

### 8.4 Guardrails

- `write_extension` refuses paths with `..` or absolute paths.
- Extension is always written to **user scope** (never system, never workspace).
- After reload, validate manifest immediately; on failure, roll back and
  surface the error to the LLM so it can retry.
- Track authored-by-LLM extensions with an `authoredByLlm` flag so users can
  review/remove them distinctly in Settings.

---

## 9. Hot Reload

### 9.1 Trigger points
1. Settings UI "Reload" button → `POST /api/extensions/:id/reload`
2. LLM tool `reload_extension`
3. Slash command `/reload` (reloads everything)
4. File watcher (dev mode only, opt-in via `GENERATORAI_DEV=1`)

### 9.2 What survives reload
- **Widget instances in DB** — unchanged. They reference descriptors by id,
  which are re-registered by the reload.
- **In-flight chats** — tools are looked up by name per invocation, not cached
  per chat.
- **Widget iframes** — remain mounted; iframe reloads only when the descriptor
  itself changed. The next `render_widget` call uses the new descriptor code.
- **Persisted state** — `widget_instances.state` is preserved across reload;
  widgets get their state back via `widget:init`.

### 9.3 What breaks (and we accept)
- MCP subprocess owned by the reloading extension is killed and respawned
  (cost: 200–500 ms).
- In-flight tool calls belonging to the reloading extension are cancelled with
  a specific error the LLM can retry.
- Widget schema-breaking changes (e.g., renaming a required prop) will fail
  validation on the next state write; UI shows a specific error surface.

---

## 10. Instance ID, Persistence & Application Architecture

### 10.1 Instance id lifecycle

| Event | Action |
|---|---|
| `render_widget` succeeds | New id `w_<uuid-slice-12>`; INSERT row; return in tool result |
| Agent stores in transcript | Tool result JSON with `instanceId` is naturally in message history; LLM references it on later turns |
| Any state write | `version++`, `updatedAt=Date.now()`, emit SSE |
| Widget closed | `status='closed'`, emit `harness.widget.closed`, row **not deleted** (needed for replay) |
| Chat deleted | Cascade `ON DELETE CASCADE` deletes all widget_instances for that chat |
| Session deleted | Cascade deletes all widget_instances for that session |
| Extension uninstalled | Rows stay; descriptor lookup fails; UI shows "extension unavailable"; instance is effectively frozen |
| Extension reloaded | Rows stay untouched; new descriptor registration makes the widget renderable again |

### 10.2 Scope determination for a new widget

```
if (chatId provided)                     surface scope = 'chat:{chatId}'   AND 'session:{sessionId}'
else if (workflowRunId provided)         surface scope = 'run:{runId}'      AND 'session:{sessionId}'
else                                     surface scope = 'session:{sessionId}'
```

SSE subscribers on these scopes receive `harness.widget.*` events for this
instance. This lets the same widget be visible in chat, canvas (session scope),
and workflow run panels simultaneously.

### 10.3 Delete-cascade rules (new migration v15)

```sql
ALTER TABLE widget_instances
  DROP CONSTRAINT IF EXISTS widget_instances_chat_fk;
ALTER TABLE widget_instances
  ADD CONSTRAINT widget_instances_chat_fk
  FOREIGN KEY (chatId) REFERENCES chats(id) ON DELETE CASCADE;

-- SQLite: rebuild table with cascade constraint (drizzle migration handles this).
```

### 10.4 Version counter for concurrency

Add `version INTEGER NOT NULL DEFAULT 0` to `widget_instances`. Client sends
current version with every PATCH. Server increments atomically:

```sql
UPDATE widget_instances
SET state = ?, version = version + 1, updatedAt = ?
WHERE id = ? AND version = ?;
```

Zero rows affected → 409 Conflict.

### 10.5 Query patterns

- `widgetService.findLiveByChatId(chatId)` — list active widgets in a chat.
- `widgetService.findLiveBySessionId(sessionId)` — list session-wide widgets
  (for canvas restoration on page load).
- `widgetService.findByWorkflowRunId(runId)` — for workflow run panels.
- Composite indexes: `(chatId, status)`, `(sessionId, status)`,
  `(workflowRunId, status)`.

---

## 11. Migration from Current System

Changes are additive.

| Current | New | Migration |
|---|---|---|
| `manifest.contributes.widgets[]` | `ai.registerWidget()` in entry | Support both; `manifest.contributes.*` treated as pre-declared shortcuts |
| `uiRenderTool` closure in `ChatManagementService` | Top-level tools in `customToolRegistry` | Delete `buildUiTools`; register once at composition root |
| `contributes.tools[].module` dynamic import | `ai.registerTool()` in entry | Both supported; deprecation warning on v1 |
| `contributes.mcpServers[]` declared, not wired | Wired via `ai.registerMcpServer()` and legacy manifest path | Support both |
| Hooks/skills/scripts/commands declared, not wired | Wired via `ai.registerX()` and legacy manifest path | Support both |
| Widget default surface = `'inline'` | Default surface = `'canvas'`; `'inline'` accepted as alias for `'chat'` | Alias mapping in Zod schema; log deprecation once per extension load |
| `ui_render` / `ui_update` / `ui_close` tool names | `render_widget` / `update_widget` / `close_widget` | Aliases kept for one release; system prompt updated to reference new names |

**Backward compatibility:** support v1 manifests alongside v2 for at least two
releases. Log a deprecation warning when a v1-only manifest is loaded.

---

## 12. Schema Validation

Every registration API validates its input with Zod at the boundary.

```typescript
// packages/shared/src/config/ExtensionSchemas.ts
export const WidgetDescriptorInputSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string(),
  description: z.string().optional(),
  entry: z.string().refine(
    p => !p.includes('..') && !path.isAbsolute(p),
    'must be a safe relative path',
  ),
  preferredSurface: z.enum(['canvas', 'chat', 'right-pane'])
    .or(z.literal('inline').transform(() => 'chat' as const))
    .default('canvas'),
  propsSchema: z.instanceof(z.ZodType).optional(),
  stateSchema: z.instanceof(z.ZodType).optional(),
  permissions: z.array(WidgetPermissionSchema).optional(),
  keywords: z.array(z.string()).optional(),
});

export const ToolDefinitionInputSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/),   // no dots (Copilot SDK)
  description: z.string().min(10),
  inputSchema: z.instanceof(z.ZodType),
  handler: z.function(),
  promptSnippet: z.string().optional(),
  promptGuidelines: z.array(z.string()).optional(),
  alwaysActive: z.boolean().default(false),
});
```

Validation runs at `ai.registerX()` call-time. Failure throws from the
specific `register*()` call — the author sees a clear per-registration error,
and the rest of the extension's contributions continue registering.

---

## 13. Future Sandboxing Path (documented, not built)

Priority order for future sandbox layering:

1. **Fork + JSON-RPC extension host.** Same `ExtensionAPI`, just serialized
   over IPC. Native modules work; extension crashes stay isolated. Add Node
   permission-model flags per extension.
2. **`isolated-vm`** for deny-by-default multi-tenant hosting. Requires
   migrating authors to a capability-based host API. Ship only if we host
   untrusted third-party extensions.
3. **Docker sandbox** for individual privileged tools (existing plumbing
   already in the codebase). Invoked via `manifest.tools[].execution: "docker"`.

Design constraints v2 imposes to stay sandbox-compatible:
- No synchronous host calls in the API.
- All I/O returns Promises.
- No direct `process` / global manipulation exposed by `ai`.
- All state ownership routed through `ai.config` (persistable) or `ai.events`
  (in-memory) — never module-level globals.

Attribution: the overall pattern (imperative registration, rich event/context
API, hot reload) is inspired by the PI Coding Agent extension model, adapted
to a sandboxed browser-widget world. This is a naming/aesthetic note only —
no code from PI is used.

---

## 14. Phased Implementation Plan

### Phase 1 — CSP relax + widget-tool promotion (1–2 days)
- Update widget-assets CSP: `script-src 'self'` etc.
- Inject `<base href>` into widget srcDoc (server-side).
- Convert `buildUiTools` closure into four top-level `ToolDefinition`s in
  `customToolRegistry`: `render_widget`, `update_widget`, `close_widget`,
  `search_widget`.
- Rename `ui_render` → `render_widget` (keep old alias for one release).
- Change default `preferredSurface` from `'inline'` to `'canvas'` in the SDK.
- Regression-test acme.todo widget still works.

### Phase 2 — Entry-file API & activation (3–4 days)
- Ship `@generatorai/extension-sdk` package (types + `ExtensionAPI` class).
- Add optional `manifest.entry` field to `ExtensionManifest`.
- Rewrite `ExtensionManager.activate` to
  `await import(entryPath); const load = mod.default ?? mod.loadExtension; await load(ai)`.
- Support both v1 (`contributes.*`) and v2 (entry file) simultaneously.
- Update `templates/system/extensions/genai.hello-world` to entry-file style
  (keep v1 sample side-by-side).
- Wire up all `ai.registerX()` methods to their registries (widgets ✅
  already; tools ✅; add MCP / hooks / commands / skills / prompts / right-pane
  panels).
- Add `keywords` field to widget contribution and index it.

### Phase 3 — Hot reload (2 days)
- `POST /api/extensions/:id/reload` → `ExtensionManager.reload(id)`.
- Cache-busting import URL trick.
- Disposer function support.
- Settings UI button.
- Watch mode for dev.

### Phase 4 — Progressive disclosure (2–3 days)
- `pi.getActiveTools()` / `pi.setActiveTools()` on session context. (**Note:**
  the runtime session context uses `ctx`, not `ai`; this is unrelated to the
  authoring API.)
- `find_and_load_tool` built-in with keyword-match ranker.
- `alwaysActive` flag on tool contributions.
- Detect provider capability for anchored deferred loading; emit
  `tool_reference` on Anthropic, `tool_search_call` on OpenAI.
- **`search_widget`** built-in tool with keyword-match ranker over widget
  descriptors.

### Phase 5 — Instance persistence & communication hardening (1–2 days)
- Migration v15: add `version` column, add `authoredByLlm` column, add
  cascade FKs.
- 409 conflict handling on state PATCH.
- Add `mergeStrategy: 'replace' | 'merge'` option to `update_widget` tool.
- Formalize the message envelope (§7A.5) in the widget bridge with type-safe
  senders/receivers.
- Add `harness.widget.error` handling in the client.

### Phase 6 — Extension-authoring skill + write/reload tools (2 days)
- Ship `templates/system/skills/extension-author/SKILL.md`.
- Ship `write_extension` and `reload_extension` built-in tools.
- Path traversal / scope guards.
- End-to-end demo: user asks for a Pomodoro widget, gets it on the canvas in
  one turn.

### Phase 7 — Polish (1–2 days)
- Settings UI: list authored-by-LLM extensions separately.
- Per-extension log surface — every `ai.log.*` capture viewable in Settings.
- Docs: "Writing an Extension" tutorial + "Migrating from v1".
- Update the design doc with the sandbox roadmap section (in this file § 13).

**Total: 12–17 days for the full plan.** Phase 1 alone unlocks React/framework
widgets and can ship on its own. Phase 5 is a small dedicated slice for
persistence hardening that can slot in after Phase 4 or after Phase 6
depending on priority.

---

## 15. Files Touched

| File | Change |
|---|---|
| `apps/server/src/routes/extensions.ts` | CSP relaxed; `<base href>` injection |
| `packages/core/src/services/ExtensionManager.ts` | New activate flow: `import(entry) → loadExtension(ai)`; disposer; reload |
| `packages/core/src/tools/uiRenderTool.ts` | Delete; replaced by top-level `builtinWidgetTools.ts` |
| `packages/core/src/tools/builtinWidgetTools.ts` | **NEW** — `render_widget`, `update_widget`, `close_widget`, `search_widget` |
| `packages/core/src/tools/toolLoaderTool.ts` | **NEW** — `find_and_load_tool` |
| `packages/core/src/tools/extensionAuthorTools.ts` | **NEW** — `write_extension`, `reload_extension` |
| `packages/core/src/services/ChatManagementService.ts` | Remove `buildUiTools`; use `customToolRegistry.list()` |
| `packages/core/src/services/ExtensionApi.ts` | **NEW** — `ExtensionAPI` class (the `ai` handle) |
| `packages/core/src/services/WidgetService.ts` | Add version-based concurrency, merge strategies, cascade cleanup |
| `packages/shared/src/types/ExtensionApi.ts` | **NEW** — public API types |
| `packages/shared/src/types/Widget.ts` | Add `WidgetSurface` alias `'inline' → 'chat'`; default `'canvas'` |
| `packages/shared/src/config/ExtensionManifestSchema.ts` | Add optional `entry` field |
| `packages/db/src/schema.ts` | Add `version` + `authoredByLlm` columns; cascade FKs |
| `packages/db/src/migrations/index.ts` | Migration v15 |
| `apps/server/src/composition-root.ts` | Register the five new built-in tools |
| `apps/web/src/components/widgets/WidgetFrame.tsx` | Ensure `<base href>` injection; version-aware state pushes |
| `apps/web/src/lib/widgetBridge.ts` | Include `version` in state envelope; handle 409 responses |
| `apps/web/src/stores/streamStore.ts` | Store `version` on `WidgetBlock`; last-write-wins by version |
| `templates/system/extensions/genai.hello-world` | Migrate to entry-file style |
| `templates/system/skills/extension-author/SKILL.md` | **NEW** — the authoring skill |
| `docs/EXTENSIONS_WIDGETS_CANVAS_PLAN.md` | Cross-reference this doc from §§ 5, 8 |

**Totals:** 21 files touched, 8 new. Nothing gets deleted destructively.

---

## 16. Open Questions for Review

1. Should widget CSP relaxation apply to **all** widgets or only ones whose
   manifest opts in with a `capabilities` field? Default recommendation: apply
   to all — the sandbox iframe is already the isolation boundary.
2. Should `find_and_load_tool` also allow **deactivating** tools, or is
   activation additive-only? Default recommendation: additive-only (matches
   Anthropic/OpenAI cache semantics).
3. Should the extension-authoring skill write **directly to disk** or stage
   into a "pending" folder that the user approves in Settings first? Default
   recommendation: direct write with a Settings surface for review/rollback.
4. Should we ship the CLI helper `genai package` in v2 or defer? Default: defer.
5. Right-pane panel contribution — new tab alongside built-ins, or replacement
   for one of them? Default recommendation: new tab.
6. Should `search_widget` return the **full JSON schema** for props/state or
   a **summary** (property names + types only)? Default recommendation:
   summary — cheaper on tokens; full schema is fetchable via
   `describe_widget` (Phase 5 add-on) if the LLM needs it.
7. Should `render_widget` **auto-open** the canvas tab in the right pane when
   surface is `'canvas'`? Default recommendation: yes, with a debounce so
   rapid renders don't cause the tab to flicker. This mirrors what
   `seenCanvasWidgetsRef` in `ChatPage.tsx` already does.
8. Widget version-conflict UX — should the client show a small "state updated
   from server" toast on 409, or silently reconcile? Default recommendation:
   silently reconcile; toast only for extension author's debug mode.

---

## 17. Acceptance Criteria

Phase 1
- [ ] `acme.todo` widget from prior demo continues to render.
- [ ] A React-based widget with external `bundle.js` renders correctly.
- [ ] `render_widget` tool is discoverable via `customToolRegistry.list()`.
- [ ] `ui_render` alias still works for one release.
- [ ] Default surface for new widget = `canvas`; verified by rendering a
      widget without an explicit `surface` argument and confirming it appears
      on the Canvas tab.

Phase 2
- [ ] New sample extension uses entry file with `export default function loadExtension(ai)`.
- [ ] Legacy v1 extension continues to load with deprecation warning.
- [ ] All six contribution registries wire correctly.
- [ ] Transactional failure: throw in entry file rolls back all contributions.

Phase 3
- [ ] Settings UI "Reload" button reloads a single extension without server
      restart.
- [ ] LLM can call `reload_extension` and see updated state on next turn.
- [ ] Disposer runs before unregistration.

Phase 4
- [ ] Initial LLM tool list contains only the five Tier-1 tools plus any
      `alwaysActive: true` extension tools.
- [ ] `find_and_load_tool` activates matching tools; they appear on next turn.
- [ ] `search_widget` returns ranked widget metadata.
- [ ] On Anthropic Sonnet 4.5+, activation preserves the prompt cache.

Phase 5
- [ ] Version conflict on state PATCH returns 409 and client reconciles.
- [ ] Cascade delete: deleting a chat removes its widget instances.
- [ ] Extension uninstall while widget live: instance persists with
      "unavailable" UI.
- [ ] `merge` strategy on `update_widget` combines fields correctly.

Phase 6
- [ ] User asks for "Pomodoro widget" → LLM authors, writes, reloads,
      `search_widget` confirms, and renders on canvas in one turn.
- [ ] Authored extension appears in Settings marked "created by AI".
- [ ] Path-traversal attempts (`../../etc/passwd`) rejected.

Phase 7
- [ ] Extension log viewer accessible from Settings.
- [ ] Migration guide published.

---

*End of plan.*
