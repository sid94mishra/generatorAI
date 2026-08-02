# Feature: Skills, Custom Agents, Prompts & MCP Servers

> These are the "tool surfaces" a stage can configure. All four kinds plug into the harness via `CreateConversationParams` and are mergeable at four scopes (system, project, workflow, stage).

---

## 1. The four kinds

| Kind | What it is | Storage location | Harness param |
|---|---|---|---|
| **Skill** | A scoped behavior or rulebook (e.g., "review TypeScript safely"). Often a markdown or JSON instruction file the harness loads on demand. | `templates/system/artifacts/skills/` (system) + `<project>/config/skills/` (project) | `skillDirectories`, `disabledSkills` |
| **Custom Agent** | A named sub-agent with its own system prompt + tool whitelist. | `templates/system/artifacts/agents/` + `<project>/config/agents/` | `customAgents: CustomAgentConfig[]` |
| **Prompt template** | A reusable prompt body referenced via `PromptDefinition.source = 'file'`. | `templates/system/artifacts/prompts/` + `<project>/config/prompts/` | injected into `prompts[].text` at preprocessing |
| **MCP Server** | Model Context Protocol tool provider. JSON config (`http` or `stdio`). | `templates/system/mcp-servers.json` (system) + `<project>/config/mcp/<name>.json` (project) | `mcpServers: Record<name, McpServerConfig>` |

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

`SystemArtifactService` is the canonical merger. `GET /api/projects/:id/available-artifacts` returns the merged list to UIs.

### System
- **Loaded at server boot**, idempotently upserted into `system_configs`. Hot-reload via process restart only.
- 8 system MCP servers in `templates/system/mcp-servers.json`: GitHub, Filesystem, PostgreSQL, SQLite, Slack, Brave Search, Puppeteer, AWS Knowledge Base.
- System skills/agents/prompts shipped under `templates/system/artifacts/` — including the built-in **`extension-author`** skill that teaches the LLM how to author extensions + widgets from chat prompts. See [feature-extensions-widgets.md](./feature-extensions-widgets.md).

### Contributed by extensions

Any hot-loaded extension can register skills, prompts, custom agents, tools, and hooks on top of the same registries the scoping above resolves against. `ExtensionAPI.registerSkill(...)`, `.registerPrompt(...)`, `.registerTool(...)`, and `.registerHook(...)` stage the contribution at `loadExtension(ai)` time; `ExtensionManager.commitStagedContributions()` then merges them into `SystemArtifactService` (skills / prompts / agents) or the shared `customToolRegistry` (tools) atomically. See [feature-extensions-widgets.md](./feature-extensions-widgets.md#4-extensionmanager-source-of-truth).

### Project
- CRUD via `POST/PUT/DELETE /api/projects/:id/configs` (and `/mcp-servers` for MCP).
- Files saved to `<project>/config/<type>s/` with path traversal guards.

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

// MCP server
type McpServerConfig =
  | { type: 'http';  url: string;  headers?: Record<string,string>; enabled?: boolean }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string,string>; enabled?: boolean };
```

`StageDefinition.agentName` (string) maps to one of the merged custom agents — when present, `StageExecutionService` calls `harness.createConversation({ defaultAgent: agentName, customAgents: [...] })`.

---

## 4. UI selectors

In the workflow builder, Stage Properties panel → Properties tab:

- **`SkillSelector`** ([apps/web/src/components/workflow/SkillSelector.tsx](../../apps/web/src/components/workflow/SkillSelector.tsx)) — toggles checkboxes; writes to `harnessConfigOverrides.disabledSkills` (so checked = enabled by exclusion).
- **`AgentSelector`** ([apps/web/src/components/workflow/AgentSelector.tsx](../../apps/web/src/components/workflow/AgentSelector.tsx)) — single-select dropdown; writes `stage.agentName` AND `harnessConfigOverrides.customAgents = [theAgent]`.
- **`McpServerSelector`** ([apps/web/src/components/workflow/McpServerSelector.tsx](../../apps/web/src/components/workflow/McpServerSelector.tsx)) — toggles each server; merges into `harnessConfigOverrides.excludedTools` (TODO: dedicated `excludedMcpServers` field).

---

## 5. Provider-specific behavior

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

---

## 6. APIs

```
# System
GET /api/system/artifacts                              → all merged system artifacts
GET /api/system/mcp-servers                            → 8 system MCP server entries

# Project
GET /api/projects/:id/available-artifacts[?type=skill|prompt|agent]    → merged system+project
GET /api/projects/:id/configs[?type=...]               → project-only

# CRUD
POST   /api/projects/:id/configs   (multipart)         → upload
GET    /api/projects/:id/configs/:cid
PUT    /api/projects/:id/configs/:cid                  body: { content }
DELETE /api/projects/:id/configs/:cid

# MCP
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

---

## 9. Edge cases & gotchas

1. **Empty `templates/system/artifacts/`** — common in fresh installs. UI selectors show "No skills" — that's expected.
2. **Project artifact name collision with system** — both surface in `available-artifacts`; UI shows source badges (`system` vs `project`). Disabling a system one is via `disabledSkills`; project-level disabling requires deleting the project file.
3. **MCP server `enabled: false`** — server is NOT mounted at session creation. Equivalent to deletion for runtime purposes.
4. **`customAgents` size** — large `instructions` strings can blow past model context. Keep agent instructions under 4-8 KB.
5. **`agentName` referencing non-existent agent** — `StageExecutionService` falls back to the default agent (no error). Validation does not currently catch this.
6. **MCP `stdio` server fails to start** — appears as `harness.error` event with the spawn failure. The stage still proceeds without that server's tools.
7. **Path traversal on uploaded configs** — guarded; `..` in `filePath` returns `400 ValidationError`.
8. **System artifact hot reload** — not implemented; restart the server. Project artifacts are read on-demand so they hot-reload.
9. **Multiple agents in `customAgents`** — supported. `agentName` selects the default; the model can route to others via `@agentName` mentions where supported by the harness.
10. **Provider mismatch on MCP tool names** — when switching from `copilot` to `claude-agent`, stage `excludedTools` containing `mcp_*` (single underscore) need to be updated to `mcp__*` (double).
