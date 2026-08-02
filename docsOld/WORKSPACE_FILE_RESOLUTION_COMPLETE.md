# GeneratorAI — Complete Workspace & File Resolution System

> **End-to-end reference for how workspaces are scaffolded, files resolved, prompts interpolated, and sent to the Copilot SDK — covering Chat, Workflow, and Automation for both Web and CLI.**

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Directory Structure & Scaffolding](#2-directory-structure--scaffolding)
3. [File Resolution Hierarchy (4-Level Priority)](#3-file-resolution-hierarchy-4-level-priority)
4. [Prompt Resolution & Interpolation](#4-prompt-resolution--interpolation)
5. [Skill Directories Resolution](#5-skill-directories-resolution)
6. [Custom Agents Resolution](#6-custom-agents-resolution)
7. [MCP Servers Resolution](#7-mcp-servers-resolution)
8. [Prompt Directories Resolution](#8-prompt-directories-resolution)
9. [Hook Scripts & Custom Scripts](#9-hook-scripts--custom-scripts)
10. [Pre/Post Processing & Validation Scripts](#10-prepost-processing--validation-scripts)
11. [Copilot SDK Session Config Assembly](#11-copilot-sdk-session-config-assembly)
12. [Scenario Catalog](#12-scenario-catalog)
13. [Scenario A: Workflow Run (Web) — With Project](#13-scenario-a-workflow-run-web--with-project)
14. [Scenario B: Workflow Run (Web) — No Project (Local)](#14-scenario-b-workflow-run-web--no-project-local)
15. [Scenario C: Chat (Web) — With Project](#15-scenario-c-chat-web--with-project)
16. [Scenario D: Chat (Web) — No Project](#16-scenario-d-chat-web--no-project)
17. [Scenario E: Automation — Batch/Loop/Manual](#17-scenario-e-automation--batchloopmanual)
18. [Scenario F: Workflow Run (CLI)](#18-scenario-f-workflow-run-cli)
19. [Scenario G: Chat (CLI)](#19-scenario-g-chat-cli)
20. [Scenario H: Automation (CLI)](#20-scenario-h-automation-cli)
21. [Working Directory Priority Chain](#21-working-directory-priority-chain)
22. [Key Files Reference](#22-key-files-reference)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │   Web App    │  │     CLI      │  │   Webhook    │                      │
│  │  (React/Vite)│  │ (Commander)  │  │  (external)  │                      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                      │
└─────────┼──────────────────┼──────────────────┼─────────────────────────────┘
          │ HTTP/SSE         │ HTTP/SSE         │ HTTP POST
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXPRESS SERVER (Port 3100)                             │
│  Routes: /chats, /workflow-definitions, /workflow-runs, /automations,        │
│          /orchestrator, /projects, /events/stream                            │
└─────────────────────────────────────────┬───────────────────────────────────┘
                                          │
┌─────────────────────────────────────────▼───────────────────────────────────┐
│                          CORE SERVICES                                        │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
│  │ChatManagementService│  │WorkflowOrchestrator│  │ AutomationService  │    │
│  │                    │  │                    │  │                    │    │
│  │ createChat()       │  │ orchestrateRun()   │  │ executeAutomation()│    │
│  │ sendPrompt()       │  │ 6-phase pipeline   │  │ runExecution()     │    │
│  └────────┬───────────┘  └────────┬───────────┘  └────────┬───────────┘    │
│           │                       │                        │                │
│  ┌────────▼───────────────────────▼────────────────────────▼───────────┐    │
│  │                    SHARED INFRASTRUCTURE                              │    │
│  │  ┌────────────┐ ┌────────────┐ ┌──────────────┐ ┌──────────────┐   │    │
│  │  │ Workspace  │ │ Worktree   │ │   Session    │ │    Stage     │   │    │
│  │  │  Manager   │ │  Service   │ │  Allocator   │ │  Execution   │   │    │
│  │  └─────┬──────┘ └─────┬──────┘ └──────┬───────┘ └──────┬───────┘   │    │
│  │        │               │               │                │           │    │
│  │  ┌─────▼───────────────▼───────────────▼────────────────▼────────┐  │    │
│  │  │              CopilotAdapter (ICopilotPort)                      │  │    │
│  │  │  createConversation() → Copilot SDK SessionConfig              │  │    │
│  │  └────────────────────────────┬───────────────────────────────────┘  │    │
│  └───────────────────────────────┼──────────────────────────────────────┘    │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │   @github/copilot-sdk 0.1.25 │
                    │   (Session → LLM Agent)      │
                    └──────────────────────────────┘
```

---

## 2. Directory Structure & Scaffolding

### 2.1 Per-Workspace Structure (Created by WorkspaceManager)

When ANY execution starts (chat, workflow, automation), `WorkspaceManager.createWorkspace()` creates:

```
{workspacesDir}/executions/{ownerId}/
├── source/                    ← Git worktrees go here (one per codebase alias)
│   ├── {alias1}/             ← e.g., "frontend/" — checked out worktree
│   └── {alias2}/             ← e.g., "backend/" — checked out worktree
├── output/                    ← Default working directory for SDK (if no worktrees)
├── artifacts/                 ← Stage responses, attachments
│   ├── stage-responses/
│   └── attachments/
├── config/                    ← Resolved config files
│   ├── agents/               ← Agent definition files (.json, .md)
│   ├── prompts/              ← Prompt files (.prompt.md)
│   ├── skills/               ← Skill directories with SKILL.md
│   └── mcp/                  ← MCP server configs
├── scripts/                   ← Hook scripts, validation scripts
└── manifest.json              ← Workspace metadata
```

### 2.2 Legacy Artifacts Directory Structure (WorkflowOrchestrator)

For backward compatibility, the orchestrator also creates:

```
{artifactsDir}/
├── runs/
│   └── {runId}/
│       ├── workspace/          ← SDK working directory (code generation target)
│       ├── artifacts/          ← Non-code responses (markdown reviews, etc.)
│       └── uploads/            ← Linked from workflow-level + user uploads
│           ├── skills/
│           ├── agents/
│           └── prompts/
└── workflows/
    └── {definitionId}/
        └── uploads/            ← Workflow-level shared uploads (persisted)
            ├── skills/
            ├── agents/
            └── prompts/
```

### 2.3 Project Directory Structure

```
{artifactsDir}/projects/{projectId}/
├── config/                     ← Project-level configuration
│   ├── agents/                ← Project agent definitions
│   ├── prompts/               ← Project prompt files
│   ├── skills/                ← Project skill directories
│   └── mcp/                   ← Project MCP server configs
├── clones/                     ← Bare git clones of project codebases
│   └── {alias}.git/           ← Bare repo (used as template for worktrees)
└── worktrees/                  ← Per-run worktree checkouts
    └── {runId}/
        └── {alias}/           ← Checked-out branch copy
```

---

## 3. File Resolution Hierarchy (4-Level Priority)

Files are resolved with the following priority (first found wins for scalars; arrays merge/append):

| Priority | Source | Location | Applies To |
|----------|--------|----------|-----------|
| **1 (Highest)** | Run-level uploads | `runs/{runId}/uploads/{category}/` | Per-run overrides |
| **2** | Workflow-level uploads | `workflows/{definitionId}/uploads/{category}/` | Shared across all runs of this workflow |
| **3** | Project-level configs | `projects/{projectId}/config/{category}s/` | Shared across all workflows in project |
| **4 (Lowest)** | Global defaults | `ConfigResolver` + system templates | Fallback |

**For arrays (skillDirectories, customAgents, promptDirectories):** All levels are **concatenated**, not replaced. Run-level content is added to workflow-level which is added to project-level.

**For scalars (model, systemMessage):** Stage > Workflow > Template (latest wins via deepMerge).

### How Files Flow Through the System

```
Phase 2.5: Workflow uploads → copied/linked to run uploads
Phase 2.6: Project configs → copied to run uploads (if not already overridden)
Phase 3:   Run uploads scanned → variables set:
           - uploads/skills/   → __skillDirectories = [path]
           - uploads/agents/   → __customAgents = [parsed objects]
           - uploads/prompts/  → __promptDirectories = [path]
```

---

## 4. Prompt Resolution & Interpolation

### 4.1 Variable Interpolation

**Engine:** `interpolateVariables()` in `packages/shared/src/utils/index.ts`

```typescript
// Pattern: {{variableName}} or {{user.profile.name}} (dotted paths)
const regex = /\{\{([\w.\-]+)\}\}/g;

// Rules:
// 1. Single-pass (no re-scanning after replacement — prevents recursion)
// 2. Exact-key priority ({{a.b}} checks variables['a.b'] before variables.a.b)
// 3. Max path depth: 16 (prevents deep recursion attacks)
// 4. Unresolved placeholders remain literal (preserved in output)
```

### 4.2 System-Injected Variables

These are automatically set by the orchestrator before execution:

| Variable | Source | Example Value |
|----------|--------|---------------|
| `__workingDirectory` | WorkspaceManager or Worktree | `/tmp/workspace/output/` or `/projects/myproj/worktrees/run-123/frontend/` |
| `__artifactsDirectory` | WorkflowOrchestrator | `/tmp/workspace/artifacts/` |
| `__workflowRunId` | Runtime | `"run-abc123"` |
| `__skillDirectories` | Upload scanning (Phase 3) | `["/path/to/skills-dir"]` |
| `__customAgents` | Upload scanning (Phase 3) | `[{name, description, instructions}]` |
| `__promptDirectories` | Upload scanning (Phase 3) | `["/path/to/prompts-dir"]` |
| `repo_path_{alias}` | Git clone / worktree | `/projects/myproj/worktrees/run-123/frontend/` |
| `repo_branch_{alias}` | Git clone / worktree | `"generatorai/run-abc-frontend"` |
| `repo_subdir_{alias}` | Codebase config | `"src/"` (optional subdirectory focus) |

### 4.3 Prompt Composition Order (Per Stage)

```
1. System Message (from harnessConfig.systemMessage)
   ├── Workflow-level systemMessage (base)
   └── Stage-level override (replaces or appends via mode: 'append'|'replace')

2. Predecessor Context (injected as first user message for dependent stages)
   └── Summary of completed upstream stages (auto-generated)

3. Stage Prompts (from StageDefinition.prompts[])
   ├── Each prompt.text goes through interpolateVariables()
   ├── Variables sourced from: stage.variables + run.variables + system variables
   └── File-naming instruction appended (ensures proper code fence format)
```

### 4.4 Example Interpolation

```
// Stage prompt text:
"Refactor the authentication module in {{frontend}}/src/auth/. 
 Use {{language}} best practices. The repo branch is {{repo_branch_frontend}}."

// After interpolation with variables:
// { frontend: "/worktrees/run-123/frontend", language: "TypeScript", repo_branch_frontend: "generatorai/run-abc-frontend" }

"Refactor the authentication module in /worktrees/run-123/frontend/src/auth/. 
 Use TypeScript best practices. The repo branch is generatorai/run-abc-frontend."
```

---

## 5. Skill Directories Resolution

### 5.1 Upload & Storage

Skills are directories containing `SKILL.md` files that the Copilot SDK uses to provide domain-specific context.

**Upload sources:**
1. **Project-level:** `POST /projects/:id/configs` with type=`skill`
2. **Workflow-level:** `POST /orchestrator/workflows/:id/uploads` with category=`skills`
3. **Run-level:** `POST /orchestrator/runs/:id/uploads` with category=`skills`

### 5.2 Linking Strategy (Phase 2.5)

When a run starts, workflow-level uploads are linked to the run directory:
```typescript
// Priority: hardlink → symlink → file copy
// Prevents duplicating large files across every run
await fs.link(sourcePath, destPath);      // Try hardlink (same filesystem)
await fs.symlink(sourcePath, destPath);   // Fallback symlink
await fs.copyFile(sourcePath, destPath);  // Last resort
```

### 5.3 Scanning (Phase 3)

```typescript
// WorkflowOrchestrator.scanAndWireUploads()
const skillsDir = path.join(uploadsDir, 'skills');
const skillFiles = await fs.readdir(skillsDir);
if (skillFiles.length > 0) {
  const existing = (context.resolvedVariables['__skillDirectories'] as string[]) ?? [];
  context.resolvedVariables['__skillDirectories'] = [...existing, skillsDir];
}
```

### 5.4 Session Config Wiring

```typescript
// StageExecutionService — merges into session config
if (variables?.['__skillDirectories'] && Array.isArray(variables['__skillDirectories'])) {
  const existingSkills = (sessionConfig['skillDirectories'] as string[]) ?? [];
  sessionConfig['skillDirectories'] = [...existingSkills, ...variables['__skillDirectories']];
}
```

### 5.5 SDK Handoff

```typescript
// CopilotAdapter.createConversation()
sessionConfig.skillDirectories = params.skillDirectories;
// SDK expects absolute paths to directories containing SKILL.md files
```

---

## 6. Custom Agents Resolution

### 6.1 Agent File Formats

Two formats supported:

**JSON format** (`agents/reviewer.json`):
```json
{
  "name": "reviewer",
  "description": "Code review specialist",
  "instructions": "You are a senior code reviewer...",
  "tools": ["read_file", "grep_search"]
}
```

**Markdown/Text format** (`agents/security.md`):
- Filename becomes `name` (without extension)
- Content becomes `instructions`
- Description auto-generated: `"Custom agent from security.md"`

### 6.2 Scanning & Parsing (Phase 3)

```typescript
const agents: Array<{ name: string; description: string; instructions: string }> = [];
for (const file of agentFiles) {
  const content = await fs.readFile(path.join(agentsDir, file), 'utf-8');
  if (file.endsWith('.json')) {
    agents.push(JSON.parse(content));
  } else {
    agents.push({
      name: path.basename(file, path.extname(file)),
      description: `Custom agent from ${file}`,
      instructions: content,
    });
  }
}
context.resolvedVariables['__customAgents'] = [...existing, ...agents];
```

### 6.3 SDK Translation

```typescript
// CopilotAdapter — domain field → SDK field mapping
sessionConfig.customAgents = params.customAgents.map((a) => ({
  name: a.name,
  description: a.description,
  prompt: a.instructions,    // Domain uses 'instructions', SDK expects 'prompt'
  tools: a.tools,
}));
```

---

## 7. MCP Servers Resolution

### 7.1 Definition-Level Config

```typescript
// WorkflowDefinition.harnessConfig.mcpServers
mcpServers: Record<string, {
  type: 'http' | 'stdio';
  url?: string;         // For HTTP-type MCP servers
  command?: string;     // For stdio-type MCP servers
  args?: string[];      // CLI args for stdio
}>;
```

### 7.2 Stage-Level Override (Deep Merge)

```typescript
// StageExecutionService — mcpServers MERGES (not replaces)
if (key === 'mcpServers' && typeof value === 'object') {
  sessionConfig[key] = { ...(sessionConfig[key] ?? {}), ...value };
} else {
  sessionConfig[key] = value;  // Scalar: replace
}
```

**Example:**
```
Workflow: { mcpServers: { git: {...}, db: {...} } }
Stage:    { harnessConfigOverrides: { mcpServers: { security: {...} } } }
Result:   { mcpServers: { git: {...}, db: {...}, security: {...} } }
```

### 7.3 McpHub Resolution

```typescript
// ChatManagementService — dynamic resolution via McpHub
if (this.extensions.mcpHub) {
  const resolved = await this.extensions.mcpHub.resolveForRun({
    workflowDefinitionId,
    workflowRunId,
    declared: harnessConfig?.mcpServers,
  });
  conversationConfig['mcpServers'] = resolved.servers;
} else {
  conversationConfig['mcpServers'] = declaredMcp; // Pass-through
}
```

### 7.4 SDK Pass-Through

```typescript
// CopilotAdapter — pass as-is (shapes coincide)
sessionConfig.mcpServers = params.mcpServers as SessionConfig['mcpServers'];
```

---

## 8. Prompt Directories Resolution

### 8.1 Purpose

Prompt directories contain `.prompt.md` files that the SDK makes available as reusable prompt fragments.

### 8.2 Scanning

```typescript
const promptsDir = path.join(uploadsDir, 'prompts');
if (promptFiles.length > 0) {
  context.resolvedVariables['__promptDirectories'] = [...existing, promptsDir];
}
```

### 8.3 SDK Status

**Note:** Copilot SDK 0.1.25 does NOT yet consume `promptDirectories`. The variable is staged for future SDK versions. Currently prompt files are discovered by the SDK only if placed in the `workingDirectory` tree.

---

## 9. Hook Scripts & Custom Scripts

### 9.1 Hook Lifecycle (22+ Phases)

| Category | Phases | When |
|----------|--------|------|
| **Run lifecycle** | `pre_run`, `post_run` | Before/after stage or workflow execution |
| **Git operations** | `pre_clone`, `post_clone`, `pre_commit`, `post_commit` | Around git operations |
| **Prompt lifecycle** | `pre_prompt`, `post_prompt` | Before/after sending to model |
| **Tool lifecycle** | `pre_tool_use`, `post_tool_use` | Before/after tool execution (can block!) |
| **Message events** | `on_message`, `on_reasoning` | After assistant message/reasoning |
| **Session lifecycle** | `on_session_start`, `on_session_idle`, `on_session_error` | Session state changes |
| **Client lifecycle** | `on_client_start`, `on_client_stop`, `on_client_error`, `on_client_restart` | CLI client events |
| **Error/Cancel** | `on_error`, `on_cancel` | Error occurred, run cancelled |
| **Permission** | `on_permission` | Permission check needed |

### 9.2 Hook Types

**Script Hook:**
```typescript
{
  type: 'script',
  command: 'npm',
  args: ['run', 'validate'],
  cwd: '.',           // Relative to workspacePath
  env: { NODE_ENV: 'test' }
}
// Executed via IScriptRunner (sanitized, no shell injection)
// Environment: SESSION_ID, WORKFLOW_ID + custom env + GEN_VAR_* variables
```

**HTTP Hook:**
```typescript
{
  type: 'http',
  url: 'https://webhook.example.com/notify',
  method: 'POST',
  headers: { 'Authorization': 'Bearer {{api_token}}' },
  bodyTemplate: '{"stage": "{{stageName}}", "status": "{{status}}"}'
}
// URL and body support {{variable}} interpolation
// Aborts on HTTP status >= 400
```

**Function Hook:**
```typescript
{
  type: 'function',
  // Option A: In-process handler (trusted, registered at startup)
  handlerName: 'metrics-collector',
  // Option B: User-supplied Node module (sandbox-safe subprocess)
  modulePath: 'hooks/my-validation.js',   // Relative to workspace
  args: { threshold: 80 }
}
```

### 9.3 Hook Execution Flow

```
HookExecutor.executePhase(phase, hooks, context)
  │
  ├── Filter: hooks matching phase + enabled=true
  ├── Sort by priority (lower = first)
  │
  └── For each hook:
      ├── executeHookWithRetry()
      │   ├── Retry with exponential backoff (1s, 2s, 4s... up to 60s)
      │   └── Respects abortSignal
      │
      ├── On failure:
      │   ├── failurePolicy: 'abort' → return false (stops workflow)
      │   ├── failurePolicy: 'skip'  → skip remaining hooks
      │   └── failurePolicy: 'continue' → log warning, proceed
      │
      └── executeHook(hook, context) [with timeout via Promise.race]
          ├── 'script' → scriptRunner.run(command, args, {cwd, env, abortSignal})
          ├── 'http'   → httpClient.request({method, url, body, signal})
          └── 'function' → registry lookup OR subprocess node execution
```

### 9.4 Two-Path Hook Execution

**Passive Path (Post-Execution via HookInterceptor):**
- Observes AgentEvents AFTER the SDK emits them
- Maps SDK events → HookPhases
- Cannot modify events, only react

**Active Path (Pre-Execution via HookBridge — HKS-01):**
- Synchronous interceptors installed in SDK SessionConfig.hooks
- **Can block tool calls** (return `decision: 'deny'`)
- **Can modify tool args** (return `modifiedArgs`)
- **Can add context** to prompts (return `additionalContext`)
- Domain HookBridge → CopilotAdapter translates to SDK SessionHooks

### 9.5 Script Security

```typescript
// SandboxedScriptRunner security measures:
// 1. Command allowlist: node, npm, git, sh, python, etc.
// 2. Dangerous pattern rejection: rm -rf, $(), backticks, /dev/
// 3. spawn({shell: false}) — never uses shell
// 4. Variables via GEN_VAR_* environment (never in shell strings)
// 5. Output buffer limit: 1MB
// 6. Timeout enforcement via SIGKILL
// 7. AbortSignal forwarding for cancellation
```

---

## 10. Pre/Post Processing & Validation Scripts

### 10.1 Preprocessing Steps (Before DAG)

Defined in `WorkflowDefinition.orchestratorConfig.preprocessingSteps`:

| Type | Purpose | Example |
|------|---------|---------|
| `clone_repo` | Git clone a codebase | `{ repoAlias: "frontend" }` |
| `run_script` | Execute shell command | `{ script: "npm install", cwd: ".", timeoutMs: 60000 }` |
| `validate_input` | Check variable constraints | `{ variableName: "email", rules: [{type:'regex', pattern:'@'}] }` |
| `set_variable` | Compute/set a variable | `{ variableName: "timestamp", value: "${Date.now()}" }` |
| `conditional` | Branch on condition | `{ condition: "#{env}==='prod'", thenSteps: [...] }` |

**Execution:**
```
WorkflowPreprocessor.execute(steps, context)
  ├── Sort by order (ascending)
  ├── Execute sequentially
  ├── Emit events: workflow_run.preprocessing_step_started/completed/failed
  ├── If failOnError=true and step fails → abort workflow
  └── Variables set by steps are available to subsequent steps + DAG stages
```

**Script Variable Security:**
```typescript
// Variables flow via GEN_VAR_* environment, NEVER into shell strings
const env = {};
for (const [key, value] of Object.entries(variables)) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;  // Skip invalid names
  let str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (Buffer.byteLength(str) > 32 * 1024) str = str.slice(0, 32768) + '…[truncated]';
  env[`GEN_VAR_${key}`] = str;
}
// Scripts access: process.env.GEN_VAR_myVariable
```

### 10.2 Result Validation (After Stage Completes)

Defined in `StageDefinition.resultValidation` or `OrchestratorConfig.resultValidations`:

| Rule Type | Behavior |
|-----------|----------|
| `contains` | `output.includes(value)` |
| `not_contains` | `!output.includes(value)` |
| `min_length` | `output.length >= value` |
| `max_length` | `output.length <= value` |
| `regex` | `new RegExp(value).test(output)` |
| `custom_script` | Execute command; exitCode=0 means pass |

**Execution:**
```typescript
ResultValidator.validateStageResult(runId, stageRunId, validation, workspacePath)
  ├── Fetch stage messages (assistant role)
  ├── Combine as stage output text
  ├── For each rule:
  │   ├── evaluateRule(output, rule) → boolean
  │   └── custom_script: scriptRunner.run(command, [], {
  │         env: { STAGE_OUTPUT, STAGE_RUN_ID, VALIDATION_RULE_MESSAGE },
  │         timeout: 60000
  │       })
  ├── Emit workflow_run.stage_validation event
  └── Return { passed: boolean, failures: string[] }
```

### 10.3 Post-Processing Steps (After DAG Completes)

| Type | Purpose |
|------|---------|
| `commit_and_push` | Git commit all changes and push feature branch |
| `create_pr` | Create a GitHub PR via `gh` CLI |
| `run_script` | Execute cleanup or notification script |

---

## 11. Copilot SDK Session Config Assembly

### 11.1 Three-Level Config Merge

```
┌─────────────────────────────────────────────────────┐
│  Level 1: Workflow Definition (harnessConfig)        │
│  model, systemMessage, mcpServers, skills, tools    │
└─────────────────────────┬───────────────────────────┘
                          │ deepMerge (objects recursive, scalars overwrite)
┌─────────────────────────▼───────────────────────────┐
│  Level 2: Stage Overrides (harnessConfigOverrides)   │
│  model override, extra mcpServers (merged), tools   │
└─────────────────────────┬───────────────────────────┘
                          │ array append (not replace)
┌─────────────────────────▼───────────────────────────┐
│  Level 3: Runtime Variables (system-injected)        │
│  __skillDirectories, __customAgents, __promptDirs   │
└─────────────────────────┬───────────────────────────┘
                          ▼
              Final SessionConfig for SDK
```

### 11.2 Final SessionConfig Sent to SDK

```typescript
const sessionConfig: SessionConfig = {
  sessionId: conversationId,
  model: 'gpt-4.1',                          // or stage override
  streaming: true,
  workingDirectory: '/path/to/workspace',     // Where SDK file ops happen
  systemMessage: { mode: 'append', content: '...' },
  
  // Tools
  tools: [...customToolObjects],              // Custom tool definitions
  availableTools: undefined,                  // undefined = all tools (wildcard)
  excludedTools: ['dangerous_tool'],
  
  // Skills & Agents
  skillDirectories: ['/project/skills', '/workflow/skills', '/run/skills'],
  customAgents: [{ name: 'reviewer', description: '...', prompt: '...', tools: [...] }],
  disabledSkills: ['unused-skill'],
  
  // MCP Servers
  mcpServers: {
    git: { type: 'stdio', command: 'git-mcp' },
    db: { type: 'http', url: 'http://localhost:9000/mcp' }
  },
  
  // Hooks (HKS-01)
  hooks: {
    onPreToolUse: async (input, invocation) => { /* can deny/modify */ },
    onPostToolUse: async (input, invocation) => { /* observe results */ },
    onUserPromptSubmitted: async (input, invocation) => { /* modify prompt */ },
    onSessionStart: async (input, invocation) => { /* setup actions */ },
    onSessionEnd: async (input, invocation) => { /* cleanup actions */ },
    onErrorOccurred: async (input, invocation) => { /* retry/abort/skip */ },
  },
  
  // BYOK Provider (optional)
  provider: { baseUrl: 'https://api.openai.com/v1', apiKey: '...' },
  
  // Permissions
  onPermissionRequest: approveAll,            // Auto-approve all tool permissions
  
  // Config directory
  configDir: '/path/to/config/',             // For additional SDK configuration
};
```

### 11.3 DeepMerge Semantics

```typescript
// packages/shared/src/utils/index.ts
function deepMerge<T>(target: T, source: Partial<T>): T {
  // Non-array objects: recursive merge (source wins on conflict)
  // Arrays: REPLACED entirely (not concatenated)
  // Cycle detection: WeakSet prevents infinite loops
  // Prototype pollution: Skip __proto__, constructor, prototype
}

// Exception: Runtime arrays (__skillDirectories, __customAgents) are
// manually concatenated in StageExecutionService (not via deepMerge)
```

---

## 12. Scenario Catalog

| # | Scenario | Client | Project? | Worktrees? | Key Difference |
|---|----------|--------|----------|------------|----------------|
| A | Workflow Run (Web) + Project | Web | Yes | Yes | Full cascade: project → workflow → run |
| B | Workflow Run (Web) No Project | Web | No | No | Working dir = workspace output/ |
| C | Chat (Web) + Project | Web | Yes | Yes | Persistent session, worktree for codebase |
| D | Chat (Web) No Project | Web | No | No | Working dir = workspace output/ |
| E1 | Automation Manual/Cron | Web/Server | Optional | Optional | Creates workflow runs per iteration |
| E2 | Automation Webhook | External | Optional | Optional | Payload → variables → workflow runs |
| E3 | Automation Batch/Loop | Web/Server | Optional | Optional | Per-item iteration with variable injection |
| F | Workflow Run (CLI) | CLI | Optional | Optional | HTTP to server, SSE for streaming |
| G | Chat (CLI) | CLI | Optional | Optional | HTTP to server, EventRenderer for tokens |
| H | Automation (CLI) | CLI | Optional | Optional | HTTP trigger/manage, SSE for progress |

---

## 13. Scenario A: Workflow Run (Web) — With Project

### Running Example

**Setup:** Project "MyApp" has codebase `frontend` (GitHub repo), workflow "Refactor Auth" with 2 stages.

### Step-by-Step Flow

```
1. USER: Clicks "Run" on workflow "Refactor Auth"
   ├── Web shows VariableInputModal
   ├── User fills: { feature: "OAuth2", language: "TypeScript" }
   └── User clicks "Start Run"

2. WEB APP: POST /api/orchestrator/runs
   {
     workflowDefinitionId: "def-123",
     projectId: "proj-456",
     variables: { feature: "OAuth2", language: "TypeScript" }
   }
   → Returns 202 Accepted + { runId: "run-789" }
   → Navigates to /workflows/def-123/runs/run-789

3. WEB APP: Subscribes to SSE
   GET /api/events/stream?scope=run&id=run-789
   → EventSource opens, events stream in

4. SERVER: WorkflowOrchestrator.orchestrateRun()

   PHASE 0 — Workspace Creation:
   ├── WorkspaceManager.createWorkspace({ ownerType: 'run', ownerId: 'run-789', projectId: 'proj-456' })
   ├── Creates: /workspaces/executions/run-789/{source/, output/, artifacts/, config/, scripts/}
   ├── Sets: __workingDirectory = /workspaces/executions/run-789/output/
   ├── Sets: __artifactsDirectory = /workspaces/executions/run-789/artifacts/
   └── Sets: __workflowRunId = "run-789"

   PHASE 1 — Worktree Creation:
   ├── Query project codebases → [{alias: "frontend", url: "github.com/myapp/frontend", branch: "main"}]
   ├── WorktreeService.createRunWorktrees("proj-456", "run-789", codebases, 'workflow')
   │   ├── GitManager.createWorktree() → /projects/proj-456/worktrees/run-789/frontend/
   │   └── Branch: generatorai/run-789-frontend (from main)
   ├── OVERRIDE: __workingDirectory = /projects/proj-456/worktrees/run-789/frontend/
   ├── Sets: repo_path_frontend = /projects/proj-456/worktrees/run-789/frontend/
   └── Sets: repo_branch_frontend = "generatorai/run-789-frontend"

   PHASE 1.5 — Project Config Cascade:
   ├── Read project configs: /projects/proj-456/config/{agents,prompts,skills,mcp}/
   └── Copy to run uploads (if not overridden at workflow/run level)

   PHASE 2 — Preprocessing:
   ├── orchestratorConfig.preprocessingSteps = [
   │     { type: 'run_script', name: 'install-deps', config: { script: 'npm ci', cwd: '.' } }
   │   ]
   ├── WorkflowPreprocessor.execute(steps, context)
   │   ├── Emit: workflow_run.preprocessing_step_started
   │   ├── ScriptRunner.run('sh', ['-c', 'npm ci'], { cwd: worktreePath, env: { GEN_VAR_feature: 'OAuth2' } })
   │   └── Emit: workflow_run.preprocessing_step_completed
   └── Variables from scripts stored in context

   PHASE 2.5 — Copy Workflow Uploads:
   ├── Source: /artifacts/workflows/def-123/uploads/{skills,agents,prompts}/
   ├── Destination: /artifacts/runs/run-789/uploads/
   └── Strategy: hardlink → symlink → copy

   PHASE 3 — Scan & Wire Uploads:
   ├── Scan: /artifacts/runs/run-789/uploads/skills/ → __skillDirectories += [path]
   ├── Scan: /artifacts/runs/run-789/uploads/agents/ → __customAgents += [parsed agents]
   └── Scan: /artifacts/runs/run-789/uploads/prompts/ → __promptDirectories += [path]

   PHASE 4 — Update Run Variables:
   └── Save all resolved variables to database

   PHASE 5 — Start DAG:
   ├── DAGScheduler.buildDAGForDefinition("def-123")
   ├── WorkflowRunService.startRun("run-789")
   │   ├── Compute ready stages (topological sort)
   │   ├── Stage 1 "Analyze Auth" → ready (no dependencies)
   │   └── Stage 2 "Implement OAuth" → blocked (depends on Stage 1)
   └── Emit: workflow_run.running

5. SERVER: DAG Execution Loop

   STAGE 1: "Analyze Auth"
   ├── StageExecutionService.executeStage(stageRun1Id)
   │   ├── Build sessionConfig:
   │   │   ├── Workflow harnessConfig: { model: 'gpt-4.1', mcpServers: { git: {...} } }
   │   │   ├── Stage override: { model: 'gpt-4-turbo' }  (if specified)
   │   │   ├── Runtime: skillDirectories = [...], customAgents = [...], workingDirectory = worktree
   │   │   └── Final: { model: 'gpt-4-turbo', workingDirectory: '/worktrees/.../frontend/', ... }
   │   │
   │   ├── SessionAllocator.allocateSession(mode='per-stage')
   │   │   └── CopilotAdapter.createConversation(sessionConfig) → conversationId
   │   │
   │   ├── Run pre_run hooks (Phase: pre_run)
   │   │
   │   ├── Interpolate prompt: "Analyze the auth system in {{frontend}}/src/auth/..."
   │   │   → "Analyze the auth system in /worktrees/run-789/frontend/src/auth/..."
   │   │
   │   ├── CopilotAdapter.sendPromptAndWait(conversationId, interpolatedPrompt)
   │   │   ├── SDK processes prompt
   │   │   ├── Events stream: token, reasoning, tool_start, tool_complete, message_complete
   │   │   └── EventBus broadcasts → SSE → Web client
   │   │
   │   ├── Extract code blocks from response → write to workspace
   │   ├── Generate stage summary (auto-summarize via SDK)
   │   ├── Run post_run hooks
   │   ├── ResultValidator.validateStageResult() (if validation rules exist)
   │   └── Mark stageRun1 status = 'completed'
   │
   └── DAGScheduler detects completion → Stage 2 now ready

   STAGE 2: "Implement OAuth"
   ├── Receives predecessor summary from Stage 1
   ├── Summary injected as first user message: "Context from 'Analyze Auth': ..."
   ├── Same flow as Stage 1 but with Stage 1's insights as context
   └── Completes → DAG complete

   POST-DAG:
   ├── If autoCommit: GitManager.commitAndPush(worktreePath, "Generated by GeneratorAI")
   ├── If autoCreatePR: GitManager.createPullRequest(...)
   ├── Emit: workflow_run.completed
   └── WorkspaceManager.completeWorkspace() → auto-commit workspace

6. WEB APP: Receives events via SSE
   ├── sseManager routes events by stageRunId/sessionId
   ├── Token events → real-time streaming in stage output panel
   ├── Stage status → DAG canvas updates node colors
   ├── Timeline events → bottom timeline panel
   └── Run complete → stop duration timer, show final status
```

---

## 14. Scenario B: Workflow Run (Web) — No Project (Local)

### Running Example

**Setup:** User creates a workflow "Generate API" without linking a project. No git repos.

### Key Differences from Scenario A

```
1. USER: Creates workflow without projectId set

2. WEB APP: POST /api/orchestrator/runs
   { workflowDefinitionId: "def-abc", variables: { framework: "Express" } }
   → No projectId in request

3. SERVER: WorkflowOrchestrator.orchestrateRun()

   PHASE 0 — Workspace Creation:
   ├── WorkspaceManager.createWorkspace({ ownerType: 'run', ownerId: 'run-xyz' })
   │   └── NO projectId → no project config lookup
   ├── Creates: /workspaces/executions/run-xyz/{source/, output/, artifacts/, config/, scripts/}
   └── Sets: __workingDirectory = /workspaces/executions/run-xyz/output/
       (No worktree override — stays as output/)

   PHASE 1 — Worktree Creation: SKIPPED
   ├── No projectId → no codebases to resolve
   ├── No worktrees created
   └── __workingDirectory remains: /workspaces/executions/run-xyz/output/

   PHASE 1.5 — Project Config Cascade: SKIPPED
   └── No project → no project-level skills/agents/prompts/mcp

   PHASE 2 — Preprocessing: (only if orchestratorConfig has steps)
   └── E.g., validate_input steps may still run

   PHASE 2.5 — Copy Workflow Uploads: (if any uploaded at workflow level)
   
   PHASE 3 — Scan & Wire: Same scanning, but fewer sources

   PHASE 5 — DAG Execution:
   ├── SDK's workingDirectory = /workspaces/executions/run-xyz/output/
   ├── All generated code lands in output/ directory
   └── No git operations (no repo to commit to)

Result:
- Generated files live in /workspaces/executions/run-xyz/output/
- User downloads via GET /orchestrator/runs/run-xyz/workspace
- No git commit, no PR
```

---

## 15. Scenario C: Chat (Web) — With Project

### Running Example

**Setup:** User creates a chat in project "MyApp" with codebase "backend" linked.

```
1. USER: Clicks "New Chat" in project context
   ├── Selects model: gpt-4.1
   ├── Selects codebases: ["backend"]
   └── Enables: createWorktree = true

2. WEB APP: POST /api/chats
   {
     name: "Refactor database layer",
     model: "gpt-4.1",
     projectId: "proj-456",
     codebaseIds: ["codebase-789"],
     createWorktree: true,
     harnessConfig: { availableTools: ['*'] }
   }

3. SERVER: ChatManagementService.createChat()

   a) Generate IDs: chatId, sessionId, conversationId

   b) Create Session entity in DB

   c) Create execution workspace:
      WorkspaceManager.createWorkspace({
        ownerType: 'chat',
        ownerId: chatId,
        projectId: 'proj-456',
        codebaseIds: ['codebase-789'],
        useWorktree: true
      })
      → /workspaces/executions/{chatId}/{source/, output/, ...}
      → conversationConfig.workingDirectory = output/

   d) Create worktrees (project + codebases):
      WorktreeService.createRunWorktrees('proj-456', chatId, codebases, 'manual')
      → /projects/proj-456/worktrees/{chatId}/backend/
      → Branch: generatorai/chat-{chatId}-backend
      → OVERRIDE workingDirectory = /projects/proj-456/worktrees/{chatId}/backend/

   e) Apply harnessConfig:
      ├── systemMessage → conversationConfig.systemMessage
      ├── availableTools: ['*'] → undefined (wildcard handling)
      ├── skillDirectories → conversationConfig.skillDirectories
      └── customAgents → conversationConfig.customAgents

   f) Resolve MCP servers via McpHub:
      mcpHub.resolveForRun({ declared: harnessConfig.mcpServers })
      → conversationConfig.mcpServers = resolved

   g) Build HookBridge (HKS-01):
      buildHookBridge({chatId, sessionId, conversationId})
      → conversationConfig.hooks = bridge

   h) Create SDK conversation:
      CopilotAdapter.createConversation(conversationConfig)
      → SDK session alive, ready for prompts

   i) Create Chat entity in DB + emit chat.created

4. USER: Types "Show me the database connection pool code"

5. WEB APP: POST /api/chats/{chatId}/prompt
   { prompt: "Show me the database connection pool code" }

6. SERVER: ChatManagementService.sendPrompt()
   ├── Save user message to DB
   ├── Emit: harness.user_message (with turnId)
   ├── Subscribe to conversation events
   ├── CopilotAdapter.sendPrompt(conversationId, prompt)
   │   └── SDK processes, uses workingDirectory as context
   └── Events stream: reasoning → token → tool_start → tool_complete → message_complete → idle

7. WEB APP: Receives events via SSE
   ├── Tokens buffered (100ms flush) → render in chat panel
   ├── Tool calls shown as badges
   ├── Final message persisted on 'idle' event
   └── Chat history updated
```

---

## 16. Scenario D: Chat (Web) — No Project

### Key Differences

```
- No projectId → no worktrees
- No codebase context
- workingDirectory = /workspaces/executions/{chatId}/output/
- SDK has no source files to read — operates on generated content only
- No git operations possible
- No project-level skills/agents/prompts/MCP
- Only workflow-level or run-level uploads available (if any)
```

---

## 17. Scenario E: Automation — Batch/Loop/Manual

### Running Example: Batch Automation

**Setup:** Automation "Code Reviews" processes a CSV of PRs, running "Code Review" workflow per row.

```
1. CREATION: POST /api/automations
   {
     name: "Weekly Code Reviews",
     triggerType: "schedule",
     cronExpression: "0 9 * * MON",           // Every Monday 9am
     workflowIds: ["def-review"],
     inputMode: "batch",
     batchData: "repo,branch,focus\nmyapp,feat-1,security\nmyapp,feat-2,perf",
     batchColumns: ["repo", "branch", "focus"],
     batchColumnMapping: { "git_url": "repo", "branch": "branch", "review_focus": "focus" },
     maxConcurrency: 3,
     onError: "continue",
     projectId: "proj-456"
   }

2. TRIGGER: Cron fires at Monday 9am
   ├── AutomationService.initializeCronJobs() registered this on boot
   ├── node-cron tick fires
   ├── tryAcquireCronLease(automationId) → conditional UPDATE (multi-pod safe)
   ├── If lease acquired: executeAutomation(automation, 'schedule')
   └── Otherwise: skip (another pod handles it)

3. EXECUTION: AutomationService.executeAutomation()
   ├── Create execution record (status: 'pending')
   ├── Parse batch data (CSV → rows):
   │   Row 0: { repo: "myapp", branch: "feat-1", focus: "security" }
   │   Row 1: { repo: "myapp", branch: "feat-2", focus: "perf" }
   ├── Apply batchColumnMapping:
   │   Iteration 0: { git_url: "myapp", branch: "feat-1", review_focus: "security" }
   │   Iteration 1: { git_url: "myapp", branch: "feat-2", review_focus: "perf" }
   └── Start background runExecution()

4. BACKGROUND: runExecution()
   ├── Emit: automation_execution.started
   ├── Split iterations into batches of maxConcurrency=3
   │
   ├── Batch 1 (all 2 iterations fit):
   │   ├── Promise.allSettled([
   │   │     Iteration 0:
   │   │       ├── createRun("def-review", variables + iteration vars)
   │   │       ├── startRun(runId) → full orchestration (Phase 0-5)
   │   │       ├── waitForRunCompletion(timeout: 2 hours)
   │   │       └── Record: { status: 'completed', variables snapshot }
   │   │     Iteration 1:
   │   │       ├── createRun("def-review", variables + iteration vars)
   │   │       ├── startRun(runId)
   │   │       ├── waitForRunCompletion()
   │   │       └── Record: { status: 'completed' }
   │   │   ])
   │   └── Update: completedIterations = 2
   │
   ├── Emit: automation_execution.completed
   └── releaseCronLease()

5. EACH ITERATION'S WORKFLOW RUN follows Scenario A or B flow entirely
   (just with different variables per iteration)
```

### Loop Automation Variant

```
inputMode: "loop",
loopVariable: "repo_name",
loopItems: ["frontend", "backend", "shared"],

// Each iteration gets:
variables = { ...baseVariables, repo_name: "frontend", __iteration_index: 0, __iteration_total: 3 }
```

### Manual Trigger Variant

```
// From web: POST /api/automations/{id}/trigger
// From CLI: generatorai automation trigger {id}
// From webhook: POST /api/automations/webhooks/{token} with JSON body
//   → body fields merged into variables
```

---

## 18. Scenario F: Workflow Run (CLI)

### Running Example

```bash
$ generatorai orchestrator start --definition def-123 --project proj-456 \
    --vars '{"feature": "OAuth2", "language": "TypeScript"}' --watch
```

### Step-by-Step Flow

```
1. CLI: Parse command flags
   ├── Resolve definition ID (prefix matching: "def-123" → full UUID)
   ├── Load CLI config from ~/.generatorai/cli.json
   └── Create HttpPlatformClient (lazy singleton)

2. CLI → SERVER: POST /api/orchestrator/runs
   {
     workflowDefinitionId: "def-123-full-uuid",
     projectId: "proj-456",
     variables: { feature: "OAuth2", language: "TypeScript" }
   }
   → Returns: { runId: "run-xyz" }

3. CLI → SERVER: (implicit — server starts orchestration immediately)
   └── Server runs FULL Phase 0-5 orchestration (same as Scenario A)

4. CLI: Subscribe to SSE (--watch flag)
   ├── GET /api/events/stream?scope=run&id=run-xyz
   ├── SSEClient opens EventSource with reconnection logic
   │   ├── Exponential backoff: 1s → 30s
   │   └── Tracks lastSequenceId for gap-free replay
   └── EventRenderer processes events:

5. CLI: EventRenderer output
   ┌────────────────────────────────────────────────┐
   │ ⟳ Stage: Analyze Auth (running)                │
   │                                                │
   │ Analyzing the authentication module...         │
   │ I can see the current implementation uses...   │
   │                                                │
   │ 🔧 read_file: src/auth/index.ts               │
   │ 🔧 grep_search: "passport"                    │
   │                                                │
   │ Based on my analysis, here are the key...      │
   │                                                │
   │ ✓ Stage: Analyze Auth (completed)              │
   │                                                │
   │ ⟳ Stage: Implement OAuth (running)             │
   │ Context: Analysis revealed JWT middleware...   │
   │                                                │
   │ Implementing OAuth2 integration...             │
   └────────────────────────────────────────────────┘

6. CLI: On workflow_run.completed
   ├── Close SSE connection
   ├── Display final summary
   └── Exit code 0

Key Differences from Web:
- No real-time DAG canvas (text-based stage status)
- No variable input modal (--vars JSON flag)
- EventRenderer handles: tokens, thinking, tool calls, errors
- Verbosity: --verbosity minimal|normal|verbose
- --thinking flag shows reasoning output
- --no-stream disables streaming (waits for final result)
```

---

## 19. Scenario G: Chat (CLI)

### Running Example

```bash
$ generatorai chat create "Debug session" --model gpt-4.1 --project proj-456 --worktree
$ generatorai chat send chat-abc "Find the memory leak in the connection pool"
```

### Step-by-Step Flow

```
1. CLI: chat create
   ├── POST /api/chats { name, model, projectId, createWorktree: true }
   ├── Server: ChatManagementService.createChat() (same as Scenario C)
   └── Display: "Chat created: chat-abc"

2. CLI: chat send
   ├── POST /api/chats/chat-abc/prompt { prompt: "Find the memory leak..." }
   ├── Server returns 202 (fire-and-forget)
   ├── CLI subscribes to SSE: GET /api/events/stream?scope=chat&id=chat-abc
   └── EventRenderer processes stream:

   Terminal output:
   ┌──────────────────────────────────────────────────────┐
   │ You: Find the memory leak in the connection pool     │
   │                                                      │
   │ Assistant:                                           │
   │ Let me examine the connection pool implementation... │
   │                                                      │
   │ 🔧 read_file: src/db/pool.ts                        │
   │ 🔧 grep_search: "connection"                        │
   │                                                      │
   │ I found the issue. In `pool.ts` line 45, the...     │
   └──────────────────────────────────────────────────────┘

3. CLI: Subsequent messages
   $ generatorai chat send chat-abc "Can you fix it?"
   ├── Same flow, same session (multi-turn)
   └── SDK maintains conversation context

Key Differences from Web:
- Sequential text interaction (not live-updating panel)
- No thinking panel (--thinking flag to show)
- Messages paginated via: generatorai chat messages chat-abc
- File operations shown as tool call badges
```

---

## 20. Scenario H: Automation (CLI)

### Running Example

```bash
# Create
$ generatorai automation create --name "Nightly Reviews" \
    --definition def-review --trigger schedule \
    --schedule "0 2 * * *" --project proj-456

# Manual trigger
$ generatorai automation trigger auto-123

# Watch executions
$ generatorai automation executions auto-123
```

### Step-by-Step Flow

```
1. CLI: automation create
   ├── POST /api/automations { name, workflowIds, triggerType, cronExpression, projectId }
   ├── Server registers cron job
   └── Display: "Automation created: auto-123"

2. CLI: automation trigger
   ├── POST /api/automations/auto-123/trigger
   ├── Server: AutomationService.triggerManual(id) → executeAutomation()
   ├── Returns 202 (execution started)
   └── Display: "Triggered execution: exec-456"

3. CLI: Monitor progress
   $ generatorai automation executions auto-123
   ├── GET /api/automations/auto-123/executions
   └── Display table:
       ID        Status     Iterations  Started
       exec-456  running    2/5         30s ago
       exec-123  completed  5/5         1h ago

Key CLI-only features:
- generatorai automation rotate-token auto-123  (webhook security)
- generatorai automation enable/disable auto-123
- --watch flag for live execution monitoring
```

---

## 21. Working Directory Priority Chain

The working directory sent to the Copilot SDK determines **where the AI agent operates** — reading files, writing code, running commands.

```typescript
function getEffectiveWorkingDirectory(): string {
  // Priority 1: Worktrees exist (project with codebases)
  if (worktrees.length > 0) {
    return worktrees[0].worktreePath;
    // e.g., /projects/proj-456/worktrees/run-789/frontend/
    // SDK can read/write the actual source code
  }

  // Priority 2: Project linked but no worktrees
  if (workspace.projectId) {
    return path.join(workspace.rootPath, 'output');
    // e.g., /workspaces/executions/run-789/output/
    // SDK generates code in isolation
  }

  // Priority 3: No project (local/isolated mode)
  return path.join(workspace.rootPath, 'output');
  // e.g., /workspaces/executions/run-789/output/
  // All generated code lands here
}
```

**Impact on SDK behavior:**
- **With worktree:** SDK can `read_file`, `grep_search`, `list_dir` on actual repo files. Tool calls operate on real source code.
- **Without worktree:** SDK starts with an empty directory. Can only operate on files it generates.

---

## 22. Key Files Reference

| Component | File Path | Key Functions |
|-----------|-----------|---------------|
| **WorkflowOrchestrator** | `packages/core/src/services/WorkflowOrchestrator.ts` | `orchestrateRun()`, `scanAndWireUploads()`, `wireProjectConfigs()`, `copyWorkflowUploadsToRun()` |
| **WorkspaceManager** | `packages/core/src/services/WorkspaceManager.ts` | `createWorkspace()`, `getWorkingDirectory()`, `setupDirectories()` |
| **WorktreeService** | `packages/core/src/services/WorktreeService.ts` | `createRunWorktrees()`, `removeWorktree()` |
| **StageExecutionService** | `packages/core/src/services/StageExecutionService.ts` | `executeStage()`, `persistStageArtifacts()`, session config building |
| **SessionAllocator** | `packages/core/src/services/SessionAllocator.ts` | `allocateSession()`, `createSession()`, `releaseAll()` |
| **CopilotAdapter** | `packages/copilot-bridge/src/CopilotAdapter.ts` | `createConversation()`, `sendPrompt()`, `sendPromptAndWait()` |
| **ChatManagementService** | `packages/core/src/services/ChatManagementService.ts` | `createChat()`, `sendPrompt()`, `archiveChat()` |
| **AutomationService** | `packages/core/src/services/AutomationService.ts` | `executeAutomation()`, `runExecution()`, cron management |
| **WorkflowPreprocessor** | `packages/core/src/services/WorkflowPreprocessor.ts` | `execute()`, preprocessing steps |
| **ResultValidator** | `packages/core/src/services/ResultValidator.ts` | `validateStageResult()`, rule evaluation |
| **HookExecutor** | `packages/core/src/services/HookExecutor.ts` | `executePhase()`, script/http/function execution |
| **HookInterceptor** | `packages/core/src/services/HookInterceptor.ts` | `buildHookBridge()`, event-to-phase mapping |
| **ConfigResolver** | `packages/core/src/services/ConfigResolver.ts` | `resolveStageConfig()`, 3-level merge |
| **ProjectConfigService** | `packages/core/src/services/ProjectConfigService.ts` | `uploadConfig()`, `listConfigs()` |
| **CodebaseService** | `packages/core/src/services/CodebaseService.ts` | Codebase CRUD, type resolution |
| **GitManager** | `packages/core/src/infrastructure/GitManager.ts` | `clone()`, `createWorktree()`, `commitAndPush()` |
| **SandboxedScriptRunner** | `packages/core/src/infrastructure/SandboxedScriptRunner.ts` | `run()`, command allowlist |
| **HttpPlatformClient** | `apps/cli/src/platform/HttpPlatformClient.ts` | CLI → Server HTTP calls |
| **EventRenderer** | `apps/cli/src/streaming/EventRenderer.ts` | CLI token/event rendering |
| **sseManager** | `apps/web/src/stores/sseManager.ts` | Web SSE multiplexing, event routing |
| **workflowBuilderStore** | `apps/web/src/stores/workflowBuilderStore.ts` | DAG canvas state, validation |

---

## Summary: Complete File Resolution Pipeline

```
                    ┌──────────────────────────┐
                    │     USER REQUEST         │
                    │  (Web/CLI/Webhook)        │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  CREATE WORKSPACE         │
                    │  WorkspaceManager         │
                    │  (source/output/config/)  │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  CREATE WORKTREES         │
                    │  (if project + codebases) │
                    │  WorktreeService          │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  CASCADE CONFIGS          │
                    │  Project → Workflow → Run │
                    │  (skills, agents, prompts)│
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  PREPROCESS               │
                    │  (scripts, validations)   │
                    │  WorkflowPreprocessor     │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  SCAN & WIRE UPLOADS      │
                    │  skills → __skillDirs     │
                    │  agents → __customAgents  │
                    │  prompts → __promptDirs   │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  BUILD SESSION CONFIG     │
                    │  3-level merge:           │
                    │  Workflow + Stage + Runtime│
                    │  ConfigResolver           │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  CREATE SDK SESSION       │
                    │  CopilotAdapter           │
                    │  (workingDir, skills,     │
                    │   agents, mcp, hooks)     │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  EXECUTE PROMPTS          │
                    │  interpolateVariables()   │
                    │  sendPromptAndWait()      │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  PERSIST ARTIFACTS        │
                    │  Code → workspace/        │
                    │  Text → artifacts/        │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  VALIDATE RESULTS         │
                    │  ResultValidator          │
                    │  (rules + custom scripts) │
                    └─────────┬────────────────┘
                              │
                    ┌─────────▼────────────────┐
                    │  POST-PROCESS             │
                    │  (commit, push, PR)       │
                    └──────────────────────────┘
```
