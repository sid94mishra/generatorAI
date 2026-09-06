# Feature: Skills, Custom Agents, Prompts & MCP Servers

> These are the "tool surfaces" a stage can configure. All four kinds plug into the harness via `CreateConversationParams` and are mergeable at four scopes (system, project, workflow, stage).

> **See also — [feature-agents.md](./feature-agents.md).** The **first-class Agent**
> entity (AGT-01) sits on top of this catalog: it bundles instructions with a fixed
> set of skill ids, MCP server ids and capability groups, and is bound to a chat
> or stage by a portable `scope:slug` ref. This document describes the raw
> assets; that one describes how an Agent selects from them and how the union
> algebra combines an agent with binding-site additions.
>
> A stage now has **two** ways to reach an agent:
> - `stage.agentRef` — a first-class Agent (preferred; brings its own skills,
>   MCP servers and tool policy).
> - `stage.agentName` — the legacy artifact-name lookup below, still resolved
>   for backwards compatibility.

---

## 0. MCP — what GeneratorAI actually is (read this first)

**GeneratorAI does not speak the Model Context Protocol.** It never opens an
MCP connection, never sends a JSON-RPC frame, never negotiates capabilities.
It is a **configuration forwarder**: it decides which servers a conversation
gets, resolves their credentials, and hands the finished
`Record<name, McpServerConfig>` map to the harness SDK
(`@anthropic-ai/claude-agent-sdk` / `@github/copilot-sdk`) via
`CreateConversationParams.mcpServers`. The harness SDK is the thing that
actually connects to a server, lists its tools, and calls them. If a claim in
this document sounds like GeneratorAI itself is running a server or dialing a
socket, that claim is wrong — file a correction.

The forwarder is built from four pieces, all under `packages/core/src/mcp/`
unless noted:

- **`ArtifactCatalog.listMcpServers(projectId?)`** (`packages/core/src/services/ArtifactCatalog.ts`)
  — the read model. Merges three registries (bundled, custom, project — §2)
  into `CatalogMcpServer[]`, each carrying a harness-ready `config` with
  credential **pointers**, never values, plus `enabled` (usable now),
  `userEnabled` (the toggle alone) and `needsConfiguration` (which required
  input or credential is still missing).
- **`McpCredentialVault`** — the only code that reads or writes a credential
  **value**. Values live in the encrypted secrets vault
  (`@generatorai/secrets`) under `mcp/<scope>/<id>`; every persisted row, JSON
  file, and GET response instead carries a `secretref:<namespace>/<name>`
  pointer or the redaction marker `••••` (`MCP_REDACTED_VALUE`, the same
  glyph as the app-wide `SECRET_MASK`). `injectSecrets()` swaps every pointer
  for its value, and only ever runs inside the hub below, immediately before
  a config reaches the SDK.
- **`IMcpHub` / `InMemoryMcpHub`** — resolves a run's effective config: drops
  disabled entries, calls `injectSecrets()`, and reports which servers were
  **dropped** (a stale/missing credential) so the caller can surface a
  warning instead of a silent gap.
- **`mergeMcpServers()`** — the ONE union rule (§2 restates it). Any code
  building a conversation's MCP map is required to produce
  `system ∪ project ∪ agent`, chat-level overrides last, by calling this
  function — not by hand-rolling the union again.

A server that "fails" in this document therefore always means one of two
things: the harness SDK couldn't start/reach the process it was configured
to run, or GeneratorAI itself declined to forward it (missing input, missing
credential, or the user's own kill switch). It never means GeneratorAI's own
MCP client failed, because there isn't one.

---

## 1. The four kinds

| Kind | What it is | Storage location | Harness param |
|---|---|---|---|
| **Skill** | A scoped behavior or rulebook (e.g., "review TypeScript safely"). Often a markdown or JSON instruction file the harness loads on demand. | `templates/system/artifacts/skills/` (system) + `<project>/config/skills/` (project) | `skillDirectories`, `disabledSkills` |
| **Custom Agent** | A named sub-agent with its own system prompt + tool whitelist. | `templates/system/artifacts/agents/` + `<project>/config/agents/` | `customAgents: CustomAgentConfig[]` |
| **Prompt template** | A reusable prompt body referenced via `PromptDefinition.source = 'file'`. | `templates/system/artifacts/prompts/` + `<project>/config/prompts/` | injected into `prompts[].text` at preprocessing |
| **MCP Server** | Model Context Protocol tool provider config (`http`, `sse` or `stdio`) forwarded to the harness SDK, which is the thing that actually speaks MCP. | bundled: `templates/system/mcp-servers.json`; custom: server-side `mcp-settings.json` (Settings → MCP Servers, **not** the browser); project: `project_configs` rows of type `mcp` | `mcpServers: Record<name, McpServerConfig>` |

---

## 2. Scoping

Each kind has four nested scopes (more specific wins / merges):

```
SYSTEM     templates/system/artifacts/* + templates/system/mcp-servers.json
   ↓ merged with
PROJECT    projects/<id>/config/*
   ↓ merged with
WORKFLOW   workflow_definitions.selectedArtifacts + orchestratorConfig
   ↓ merged with
STAGE      stage_definitions.harnessConfigOverrides.{customAgents,skillDirectories,disabledSkills,mcpServers}
```

`SystemArtifactService` is the canonical merger for skills/agents/prompts.
`GET /api/projects/:id/available-artifacts` returns the merged list to UIs.

**MCP servers have a THIRD registry the table above doesn't show: custom
servers**, added in global Settings → MCP Servers and persisted server-side
(`McpSettingsStore`, `mcp-settings.json` next to the database file) — not
project-scoped, not system-bundled. `ArtifactCatalog.listMcpServers` merges
all three (bundled + custom + project, when a `projectId` is given) into one
list.

**The MCP union rule**, implemented by `mergeMcpServers()`
(`packages/core/src/mcp/mergeMcpServers.ts`) and `AgentResolver.resolveMcpServers`:

```
effective = ( every globally-enabled, fully-configured bundled/custom server
              ∪ every enabled project server
              ∪ the bound agent's explicit server ids )
            , then chat-level overrides LAST
```

A later level wins on a name collision, and an override entry with
`enabled: false` REMOVES that name — that's how one chat opts out of a server
every level above turned on. **A chat with no agent bound still gets the
system ∪ project baseline** — `AgentResolver.empty()` (an MCP-server-free,
skill-free, all-defaults projection) is a synchronous fallback for callers
with *no resolver wired at all*, not a substitute for calling
`resolve({ scope: 'chat', projectId })` with an absent `agentRef`. See §9.11
for the one call site that still gets this wrong.

### System
- **Loaded at server boot**, idempotently upserted into `system_configs`. Hot-reload via process restart only.
- 8 system MCP servers in `templates/system/mcp-servers.json`: GitHub, Filesystem, PostgreSQL, SQLite, Slack, Brave Search, Puppeteer, AWS Knowledge Base.
  Six of the eight need the user to do something before they work — four need
  a credential (GitHub, Slack, Brave Search, AWS Knowledge Base — declared in
  the catalog entry's `credentials.env`/`credentials.headers`, entered in
  Settings → MCP Servers, stored via `McpCredentialVault`) and two need a
  required input filled in rather than shipping against an example value
  (Filesystem's allowed directory, PostgreSQL's connection string — declared
  via `inputs`, substituted for a `{{key}}` placeholder in `command`/`args`/`url`).
  An entry with an unfilled required input or credential reports
  `needsConfiguration` and is never sent to a harness, even if its own
  `enabled` flag is on — Puppeteer and SQLite are the two that work with zero
  configuration.
- System skills/agents/prompts shipped under `templates/system/artifacts/` — including the built-in **`extension-author`** skill that teaches the LLM how to author extensions + widgets from chat prompts. See [feature-extensions-widgets.md](./feature-extensions-widgets.md).

### Contributed by extensions

Any hot-loaded extension can register skills, prompts, custom agents, tools, and hooks on top of the same registries the scoping above resolves against. `ExtensionAPI.registerSkill(...)`, `.registerPrompt(...)`, `.registerTool(...)`, and `.registerHook(...)` stage the contribution at `loadExtension(ai)` time; `ExtensionManager.commitStagedContributions()` then merges them into `SystemArtifactService` (skills / prompts / agents) or the shared `customToolRegistry` (tools) atomically. See [feature-extensions-widgets.md](./feature-extensions-widgets.md#4-extensionmanager-source-of-truth).

### Project
- CRUD via `POST/PUT/DELETE /api/projects/:id/configs` (and `/mcp-servers` for MCP).
- Files saved to `<project>/config/<type>s/` with path traversal guards.
- A project MCP server's `headers` (http/sse) or `env` (stdio) is vaulted the
  same way as a bundled one: values go to `McpCredentialVault` under
  `mcp/project/<id>`, only the credential **names** persist on the
  `project_configs` row (`credential_refs` column, migration 48).

### Custom (global Settings)
- Added from Settings → MCP Servers, backed server-side by
  `McpSettingsStore` (`mcp-settings.json`) — **not** the browser's
  `localStorage`. Before this was true, a server added here only ever lived
  in that one browser tab and no harness config ever saw it; a one-time
  client-side migration moves any pre-existing localStorage entries to the
  server the first time Settings loads and shows a toast.
- CRUD via `POST/PUT/DELETE /api/system/mcp-servers/custom` (and
  `PUT /api/system/mcp-servers/system/:id` for a bundled server's own
  on/off + inputs + credentials — see §6).

### Workflow
- `workflow_definitions.selectedArtifacts: { skills?, agents?, prompts? }` — a list of artifact IDs that *must* be available (a "lockfile").
- `orchestratorConfig.selectedArtifacts` — same idea but for orchestrator-driven flows.
- Stage-scope overrides take precedence.

### Stage
- `harnessConfigOverrides.customAgents` (array of `CustomAgentConfig`).
- `harnessConfigOverrides.skillDirectories` (extra dirs to scan).
- `harnessConfigOverrides.disabledSkills` (names to exclude).
- `harnessConfigOverrides.mcpServers` (Record<name, McpServerConfig> to *add* or *override*).
- `harnessConfigOverrides.excludedTools` (blacklist; supports `mcp__<server>__<tool>` to exclude MCP tools).
- `harnessConfigOverrides.agentName` — convenience field; tells `StageExecutionService` to use that custom agent as the stage's "main" agent.

---

## 3. Type definitions

```typescript
// Skill (file + metadata)
type ProjectSkill = {
  id: string;
  type: 'skill';
  name: string;
  description?: string;
  filePath: string;          // relative to <project>/config/skills/
  metadata: Record<string, unknown>;
};

// Custom Agent
type CustomAgentConfig = {
  name: string;
  description: string;
  instructions: string;           // system prompt body
  tools?: string[];               // tool whitelist (otherwise inherits stage's tools)
};

// Prompt template (project_configs row with type='prompt')
// content stored as the file body; referenced from PromptDefinition.source='file' + filePath

// MCP server config — what actually reaches the harness SDK. Credential
// fields NEVER hold values here except in the last few milliseconds before
// the SDK call (see §0's McpCredentialVault / IMcpHub); everywhere else
// they are `secretref:` pointers.
type McpServerConfig = {
  type: 'http' | 'sse' | 'stdio';
  url?: string;                       // http/sse
  headers?: Record<string, string>;   // http/sse — pointer or value, never both contexts at once
  command?: string;                   // stdio
  args?: string[];                    // stdio
  env?: Record<string, string>;       // stdio — pointer or value
  cwd?: string;                       // stdio working directory
  tools?: string[];                   // include-list; omit for all tools the server exposes
  timeoutMs?: number;
  enabled?: boolean;                  // false = not mounted at session creation
};

// Bundled catalog entry (templates/system/mcp-servers.json)
type SystemMcpCatalogEntry = {
  id: string; name: string; description?: string;
  serverType: 'stdio' | 'http' | 'sse';
  command?: string; args?: string[]; url?: string; category?: string;
  enabled?: boolean;                                    // default true
  inputs?: Array<{ key: string; label: string; description?: string;
    kind?: 'path' | 'text' | 'url'; required?: boolean; placeholder?: string }>;
  credentials?: {
    env?: Array<{ name: string; label: string; description?: string; required?: boolean }>;
    headers?: Array<{ name: string; label: string; description?: string; required?: boolean }>;
  };
};

// What a GET returns for ANY of the three registries — never a value.
type McpServerEntry = {
  id: string; name: string; description?: string;
  serverType: 'http' | 'sse' | 'stdio';
  url?: string; command?: string; args?: string[]; timeoutMs?: number;
  source: 'system' | 'project' | 'custom';
  enabled: boolean;          // effective: toggle AND fully configured
  userEnabled?: boolean;     // the toggle alone
  headers?: Record<string, '••••'>;   // keys only; every value is the mask
  env?: Record<string, '••••'>;
  hasCredentials?: boolean;
  needsConfiguration?: { missingInputs: string[]; missingCredentials: string[] };
  inputs?: SystemMcpCatalogEntry['inputs'];
  inputValues?: Record<string, string>;
  credentials?: SystemMcpCatalogEntry['credentials'];
  category?: string;
};
```

`StageDefinition.agentName` (string) maps to one of the merged custom agents — when present, `StageExecutionService` calls `harness.createConversation({ defaultAgent: agentName, customAgents: [...] })`.

---

## 4. UI selectors

In the workflow builder, Stage Properties panel → Properties tab:

- **`SkillSelector`** ([apps/web/src/components/workflow/SkillSelector.tsx](../../apps/web/src/components/workflow/SkillSelector.tsx)) — toggles checkboxes; writes to `harnessConfigOverrides.disabledSkills` (so checked = enabled by exclusion).
- **`AgentSelector`** ([apps/web/src/components/workflow/AgentSelector.tsx](../../apps/web/src/components/workflow/AgentSelector.tsx)) — single-select dropdown; writes `stage.agentName` AND `harnessConfigOverrides.customAgents = [theAgent]`.
- **`McpServerSelector`** ([apps/web/src/components/workflow/McpServerSelector.tsx](../../apps/web/src/components/workflow/McpServerSelector.tsx)) — toggles each server; merges into `harnessConfigOverrides.excludedTools` (TODO: dedicated `excludedMcpServers` field).

Settings → MCP Servers (**`apps/web/src/components/settings/sections/Catalogs.tsx`**'s `McpSection`) is the global surface: it lists bundled + custom servers together (one `GET /api/system/mcp-servers` call), shows an inline "Needs setup" form for any server with `needsConfiguration` (fills `{{input}}` values and credentials, `PUT .../system/:id`), and the "Add server" sub-page creates a custom server server-side.

---

## 5. Provider-specific behavior

**Only two of the six harness types this app knows about are actually
selectable today: `copilot` and `claude-agent`.** `HarnessRegistry` lists
`codex` / `opencode` / `acp` too (they have real adapters — see
`packages/agent-harness-providers/src/providers/{codex,opencode,acp}`), but
`HarnessRegistry.isConfigurable(type)` / `.configurableTypes` report them as
selectable ONLY once the deployment's `buildConfig` actually supplies their
provider section (a binary path, a server URL, …) — nothing today wires that
by default, so in a stock install they exist but are not offered. When one
IS explicitly configured, `HarnessRegistry` logs at startup exactly which
capabilities that adapter drops relative to the two managed providers —
today that is always at least **hooks** (none of the three implement
`HookExecutor` wiring), plus whatever each adapter's own `capabilities()`
reports as `false` (e.g. `opencode`'s `skillDirectories: false`, every
breadth adapter's `fullToolGating: false`). A brand mark exists only for
`copilot` and `claude-agent`; the other three render a neutral glyph rather
than being shown under one of those two logos.

### CopilotProvider

- `skillDirectories` and `disabledSkills` mapped directly to `SessionConfig`.
- `customAgents` mapped to `SessionConfig.customAgents` (each has `name`, `description`, `prompt`, `tools`).
- `mcpServers` mapped to `SessionConfig.mcpServers` (Copilot SDK native MCP integration).
- Tool names visible to the model: native SDK tool names + `mcp_<server>_<tool>` for MCP-routed tools.

### ClaudeAgentProvider

- Skills mapped to `agents` config (no native "skills" concept in Claude Agent SDK).
- `customAgents` mapped to `agents` map (SDK shape).
- `mcpServers` merged with the in-process `generatorai-tools` MCP server. Tool names become `mcp__<server>__<tool>` (note the double-underscore — different from Copilot's single).
- `availableTools: ['*']` is detected and stripped (otherwise SDK would try to enable a literal tool named `*`).
- The SDK's `system`/`init` message reports one `{ name, status }` per
  configured MCP server (`connected | failed | needs-auth | pending | disabled`).
  `mcpStartupWarnings()` (`packages/shared/src/types/McpServer.ts`) turns a
  `failed`/`needs-auth` entry into a `harness.warning` event
  (`{code: 'MCP_SERVER_FAILED' | 'MCP_SERVER_NEEDS_AUTH', message, details}`)
  — see §9.6 for exactly which call sites still need to invoke it.

### codex / opencode / acp

Real adapters, not stubs, but see the provider-honesty paragraph above: not
selectable unless explicitly configured, and each drops capabilities a
Claude/Copilot chat takes for granted (always hooks; check each adapter's
`capabilities()` for the rest). `opencode` and `codex` both declare
`mcpServers: true` (native MCP support in their own protocols); `acp`
declares `mcpServers: false`.

---

## 6. APIs

```
# System
GET    /api/system/artifacts                              → all merged system artifacts
GET    /api/system/mcp-servers                             → bundled + custom MCP servers, merged and REDACTED
                                                               (credential values never appear; needsConfiguration
                                                               says what's still missing)
PUT    /api/system/mcp-servers/system/:id                  body: { enabled?, inputs?, headers?, env? }
                                                               → per-bundled-server prefs; headers/env values are
                                                                 vaulted, never stored inline
POST   /api/system/mcp-servers/custom                      body: McpServerBody (name, serverType, url|command,
                                                               args?, headers?, env?, timeoutMs?, enabled?)
                                                               → add a custom server (Settings → MCP Servers)
PUT    /api/system/mcp-servers/custom/:id                  body: McpServerBody (FULL desired state — an omitted
                                                               stored credential is deleted; resend the `••••`
                                                               marker from a prior GET to keep it)
DELETE /api/system/mcp-servers/custom/:id                  → also wipes its vaulted credentials

# Project
GET /api/projects/:id/available-artifacts[?type=skill|prompt|agent]    → merged system+project

# CRUD
POST   /api/projects/:id/configs   (multipart)         → upload
GET    /api/projects/:id/configs/:cid
PUT    /api/projects/:id/configs/:cid                  body: { content }
DELETE /api/projects/:id/configs/:cid

# Project MCP — same McpServerBody shape and credential semantics as the
# custom-server routes above, scoped to one project.
GET    /api/projects/:id/mcp-servers
POST   /api/projects/:id/mcp-servers
PUT    /api/projects/:id/mcp-servers/:mid
DELETE /api/projects/:id/mcp-servers/:mid
```

---

## 7. CLI

```powershell
# Project assets
generatorai project config list <projectId> [--type skill|prompt|agent]
generatorai project config upload <projectId> skill ./skills/review-ts.md
generatorai project config get <projectId> <configId>
generatorai project config update <projectId> <configId> ./skills/review-ts.md
generatorai project config delete <projectId> <configId>

# MCP
generatorai project mcp list <projectId>
generatorai project mcp add <projectId> --name notion --type http --config '{"url":"https://mcp.notion.so"}'
generatorai project mcp remove <projectId> <serverId>

# System
generatorai system artifacts [--type skill|prompt|agent]
generatorai system mcp-servers
```

---

## 8. PWS / SDK

In a `.workflow.mjs` script:

```js
b.stage('review', s => s
  .name('Code Review')
  .agentName('typescript-reviewer')                          // selects the custom agent
  .harnessConfig({
    customAgents: [
      {
        name: 'typescript-reviewer',
        description: 'Reviews TS code for safety + correctness',
        instructions: 'You are a senior TypeScript reviewer …',
        tools: ['read_file', 'list_dir', 'grep_search'],
      },
    ],
    skillDirectories: ['/path/to/extra/skills'],
    disabledSkills: ['general-coding'],
    mcpServers: {
      'project-db': { type: 'stdio', command: 'node', args: ['./mcp/project-db.mjs'] },
    },
    excludedTools: ['shell_exec'],
  })
  .prompts([{ text: 'Review {{filePath}} against the {{lang}} guidelines.' }])
);
```

In SDK:

```typescript
ai.tools.register(ai.tools.tool({
  name: 'compute_metric',
  description: 'Compute a custom metric',
  inputSchema: z.object({ x: z.number(), y: z.number() }),
  execute: async ({ x, y }) => ({ metric: x*y }),
}));
```

Registered tools appear on every subsequent stage's harness session (`params.tools`).

`@generatorai/mcp-server` (`packages/mcp-server`) is the other direction:
a real MCP **server** (`@modelcontextprotocol/sdk`, stdio transport) that
exposes GeneratorAI itself to an external MCP client — three built-in tools
(`generatorai_list_chats`, `generatorai_send_prompt`, `generatorai_run_workflow`)
plus every tool in a `CustomToolRegistry`. Run it with
`generatorai-mcp-server` (env: `GENERATORAI_MCP_HARNESS`, `_DB`,
`_ARTIFACTS`, `_TEMPLATES`) the same way you'd point a client at any bundled
MCP server. This is unrelated to §0-§7 above — those describe GeneratorAI
*consuming* MCP servers via a harness; this is GeneratorAI *being* one.

---

## 9. Edge cases & gotchas

1. **Empty `templates/system/artifacts/`** — common in fresh installs. UI selectors show "No skills" — that's expected.
2. **Project artifact name collision with system** — both surface in `available-artifacts`; UI shows source badges (`system` vs `project`). Disabling a system one is via `disabledSkills`; project-level disabling requires deleting the project file.
3. **MCP server `enabled: false`** — never mounted at session creation, equivalent to deletion for runtime purposes. Distinct from `needsConfiguration`: a server can be `userEnabled: true` (the toggle is on) and still not be sent because a required input or credential is missing — check `enabled` (the effective flag), not `userEnabled`, before assuming a server will actually reach a chat.
4. **`customAgents` size** — large `instructions` strings can blow past model context. Keep agent instructions under 4-8 KB.
5. **`agentName` referencing non-existent agent** — `StageExecutionService` falls back to the default agent (no error). Validation does not currently catch this.
6. **MCP `stdio` server fails to start** — `mcpStartupWarnings()` (§0, §5) exists and is unit-tested, but as of this writing **nothing calls it**: the Claude Agent SDK's `system`/`init` message (`mcp_servers: [{name, status}]`) is mapped in `packages/agent-harness-providers/src/providers/claude-agent/event-mapper.ts`'s `case 'init':`, which today only emits `harness.session_start` and drops `mcp_servers` entirely. Even once that call is added, the resulting `harness.warning` event still needs a rendering case in `packages/client-core/src/stream/eventRouter.ts` (the shared web/CLI live-event dispatcher), `apps/web/src/utils/replayEvents.ts` (page-reload replay), and `packages/cli-core/src/viewmodels/runTimeline.ts` (CLI TUI timeline) — none of the three currently has one. Until all of that lands, a failed MCP server is silent: the harness proceeds without its tools and nothing tells the user why.
7. **Path traversal on uploaded configs** — guarded; `..` in `filePath` returns `400 ValidationError`.
8. **System artifact hot reload** — not implemented; restart the server. Project artifacts are read on-demand so they hot-reload.
9. **Multiple agents in `customAgents`** — supported. `agentName` selects the default; the model can route to others via `@agentName` mentions where supported by the harness.
10. **Provider mismatch on MCP tool names** — when switching from `copilot` to `claude-agent`, stage `excludedTools` containing `mcp_*` (single underscore) need to be updated to `mcp__*` (double).
11. **A chat with no agent bound still needs the system ∪ project baseline** — `ChatManagementService.applyAgentProjection` short-circuits to `AgentResolver.empty()` (zero MCP servers) whenever no `agentRef` is present, instead of calling `agentResolver.resolve({ scope: 'chat', projectId, ... })` with `agentRef` simply omitted (which the resolver handles fine — `driving: null`, but still unions the enabled system/custom + project servers). The same function's create-path and resume-path also build the final MCP map two different ways instead of both calling `mergeMcpServers({ agent: projection.mcpServers, chatOverrides: <this call's own harnessConfig.mcpServers> })` — the create path passes only the chat's inline map to the hub (dropping the agent/baseline servers `applyAgentProjection` already wrote into `conversationConfig['mcpServers']`), while the resume path spreads both. `mergeMcpServers()` (§0, §2) exists specifically to be the one answer both paths call.
