# Claude Agent SDK Integration Plan for GeneratorAI

**Version:** 1.1 — Post Multi-Subagent Review  
**Date:** April 30, 2026  
**Status:** REVIEWED — Ready for implementation  
**Related Docs:** [architecture.md](architecture.md), [copilot-bridge.md](copilot-bridge.md), [core.md](core.md)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Claude Agent SDK Overview](#2-claude-agent-sdk-overview)
3. [Feature Parity Comparison](#3-feature-parity-comparison)
4. [Industry Research — How Others Integrate Claude Agent SDK](#4-industry-research)
5. [Architecture Design](#5-architecture-design)
6. [Implementation Plan](#6-implementation-plan)
7. [Event Mapping Design](#7-event-mapping-design)
8. [Session & Conversation Lifecycle](#8-session--conversation-lifecycle)
9. [Tool Integration Strategy](#9-tool-integration-strategy)
10. [Hook System Mapping](#10-hook-system-mapping)
11. [Permission System Translation](#11-permission-system-translation)
12. [Streaming & SSE Integration](#12-streaming--sse-integration)
13. [Configuration & DI Wiring](#13-configuration--di-wiring)
14. [CLI & Web API Parity](#14-cli--web-api-parity)
15. [Migration & Coexistence Strategy](#15-migration--coexistence-strategy)
16. [Testing Strategy](#16-testing-strategy)
17. [Risk Assessment](#17-risk-assessment)
18. [Phase Breakdown & Timeline](#18-phase-breakdown--timeline)
19. [Open Questions](#19-open-questions)

---

## 1. Executive Summary

GeneratorAI currently orchestrates AI agent workflows via the **GitHub Copilot SDK** (`@github/copilot-sdk@^0.3.0`) through a clean port/adapter pattern (`ICopilotPort` → `CopilotAdapter` in `packages/copilot-bridge`). A scaffold `AnthropicAdapter` package exists (`packages/anthropic-bridge`) proving the pattern works but with placeholder messaging/streaming/tools.

This plan details the integration of the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk@^0.2.123`) as a first-class alternative backend. The Claude Agent SDK is fundamentally different from the existing Anthropic SDK (`@anthropic-ai/sdk`) — it wraps Claude Code as a library with built-in tool execution, an autonomous agent loop, hooks, sessions, subagents, MCP native support, and streaming. It bundles a native Claude Code binary and manages the full agent lifecycle.

**Key distinctions from the raw Anthropic SDK:**
- **Built-in tool execution** — Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch, etc. are included
- **Autonomous agent loop** — Claude decides which tools to call and loops until task completion
- **Native MCP support** — Both in-process SDK MCP servers and external MCP servers
- **Session persistence** — Sessions stored on disk as JSONL, with resume/fork/continue
- **Hooks system** — PreToolUse, PostToolUse, Stop, SubagentStart/Stop, Notification, etc.
- **Subagent architecture** — Programmatic agent definitions with context isolation
- **Permission modes** — default, acceptEdits, bypassPermissions, dontAsk, plan, auto
- **Structured output** — Validated JSON output with retry
- **File checkpointing** — Snapshot and revert file changes

**Goal:** Enable users to select `harness.type = 'claude-agent'` (distinct from `'anthropic'`) and get full Claude Agent SDK capabilities through the same workflow DAG engine, SSE streaming, and web/CLI interfaces.

---

## 2. Claude Agent SDK Overview

### 2.1 Package Details

| Property | Value |
|---|---|
| NPM Package | `@anthropic-ai/claude-agent-sdk` |
| Latest Version | `0.2.123` (April 28, 2026) |
| TypeScript Repo | `anthropics/claude-agent-sdk-typescript` |
| Node.js Requirement | 18+ |
| Auth | `ANTHROPIC_API_KEY` env var (also Bedrock, Vertex AI, Azure Foundry) |
| CLI Binary | Bundled per-platform as optional dependency (no separate install required) |
| License | Anthropic Commercial Terms of Service |

### 2.2 Core API Surface (TypeScript)

#### `query()` — Stateless One-Shot Function
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Fix the bug in auth.ts",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits",
    maxTurns: 30,
    maxBudgetUsd: 5.0,
    effort: "high",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a code assistant.",
    cwd: "/path/to/project",
    mcpServers: { /* external/SDK MCP */ },
    hooks: { PreToolUse: [...], PostToolUse: [...] },
    agents: { "reviewer": AgentDefinition },
    settingSources: ["project"],
    continue: false,
    resume: "session-id",
    forkSession: false,
    persistSession: true,
    sessionId: "custom-uuid",
    includePartialMessages: true,
    env: { ...process.env, CUSTOM: "value" },
    tools: ["Read", "Edit", "Bash"],       // built-in subset
    disallowedTools: ["WebSearch"],
    sessionStore: mySessionStore,          // alpha: external storage
  }
})) {
  // Handle: SystemMessage, AssistantMessage, UserMessage, StreamEvent, ResultMessage
}
```

#### `createSdkMcpServer()` — In-Process Custom Tools
```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const myTool = tool("my_tool", "Does something", z.object({ input: z.string() }), async (args) => {
  return { content: [{ type: "text", text: `Result: ${args.input}` }] };
});

const server = createSdkMcpServer({ name: "custom", version: "1.0.0", tools: [myTool] });
```

#### Session Management
```typescript
import { query, listSessions, getSessionMessages, forkSession, deleteSession } from "@anthropic-ai/claude-agent-sdk";

// Continue: picks up most recent session in cwd
for await (const msg of query({ prompt: "...", options: { continue: true } })) { ... }

// Resume: specific session ID
for await (const msg of query({ prompt: "...", options: { resume: "session-id" } })) { ... }

// Fork: branch from existing session
for await (const msg of query({ prompt: "...", options: { resume: "session-id", forkSession: true } })) { ... }

// List + inspect
const sessions = await listSessions({ cwd: "/project" });
const messages = await getSessionMessages("session-id", { cwd: "/project" });
```

#### V2 Preview (Unstable)
```typescript
import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";
// createSession() → send/stream pattern (closer to Python ClaudeSDKClient)
```

### 2.3 Message Types

| Type | Description | Key Fields |
|---|---|---|
| `SystemMessage` (subtype: `init`) | Session start | `session_id`, tools, skills, slash_commands |
| `SystemMessage` (subtype: `compact_boundary`) | Context compacted | n/a |
| `AssistantMessage` | Claude response with possible tool calls | `message.content` (TextBlock, ToolUseBlock) |
| `UserMessage` | Tool results sent back to Claude | `message.content` (ToolResultBlock) |
| `StreamEvent` | Real-time deltas (when `includePartialMessages`) | Raw API streaming events |
| `ResultMessage` | Loop termination | `result`, `subtype`, `total_cost_usd`, `usage`, `session_id`, `num_turns`, `stop_reason` |

### 2.4 Built-in Tools

| Tool | Purpose |
|---|---|
| Read | Read files |
| Write | Create new files |
| Edit | Precise file edits |
| Bash | Shell commands, scripts, git |
| Glob | Find files by pattern |
| Grep | Regex search in files |
| WebSearch | Web search |
| WebFetch | Fetch/parse web pages |
| Monitor | Watch background scripts |
| Agent | Spawn subagents |
| Skill | Invoke skills |
| AskUserQuestion | Interactive user questions |
| TodoWrite | Track tasks |
| ToolSearch | On-demand tool discovery |

### 2.5 Hooks (18+ event types)

| Hook | Python | TypeScript | Purpose |
|---|---|---|---|
| PreToolUse | ✓ | ✓ | Block/modify/approve tool calls |
| PostToolUse | ✓ | ✓ | Audit tool results |
| PostToolUseFailure | ✓ | ✓ | Handle tool errors |
| PostToolBatch | ✗ | ✓ | After batch of tool calls |
| UserPromptSubmit | ✓ | ✓ | Inject context into prompts |
| Stop | ✓ | ✓ | On agent finish |
| SubagentStart | ✓ | ✓ | Subagent initialization |
| SubagentStop | ✓ | ✓ | Subagent completion |
| PreCompact | ✓ | ✓ | Before context compaction |
| PermissionRequest | ✓ | ✓ | Custom permission handling |
| SessionStart | ✗ | ✓ | Session init |
| SessionEnd | ✗ | ✓ | Session cleanup |
| Notification | ✓ | ✓ | Status messages |
| Setup | ✗ | ✓ | Session setup |
| TeammateIdle | ✗ | ✓ | Teammate idle |
| TaskCompleted | ✗ | ✓ | Background task done |
| ConfigChange | ✗ | ✓ | Config file changes |
| WorktreeCreate/Remove | ✗ | ✓ | Git worktree lifecycle |

---

## 3. Feature Parity Comparison

### 3.1 Copilot SDK → Claude Agent SDK Feature Matrix

| Feature | Copilot SDK (Current) | Claude Agent SDK | Parity Notes |
|---|---|---|---|
| **Client Lifecycle** | `initialize()`, `stop()`, `forceStop()`, `ping()` | Implicit (CLI subprocess spawns on first `query()`, `startup()` for pre-warm) | Different model: stateful client vs. per-query subprocess |
| **Model Discovery** | `getModels()` → `CopilotModel[]` | N/A (model set via option string) | Need to hardcode/fetch model list |
| **Conversation Create** | `createConversation(params)` with tools, skills, agents, MCP, permissions | `query({ options })` — all config per-query | Config-at-query vs. config-at-session |
| **Conversation Resume** | `resumeConversation(id)` | `resume: "session-id"` option | Direct mapping |
| **Send Prompt** | `sendPrompt(id, text)` fire-and-forget | `query({ prompt })` returns async iterator | Different paradigm: event callback vs. async iterator |
| **Send Prompt & Wait** | `sendPromptAndWait(id, text)` → complete response | Iterate `query()` to `ResultMessage` | Equivalent via collecting messages |
| **Abort** | `abortConversation(id)` | `query.close()` method | Direct mapping |
| **Event Subscription** | `onConversationEvent(id, handler)` → unsubscribe fn | `includePartialMessages` + iterate stream | Different model: callback vs. iterator |
| **Client Events** | `onClientEvent(handler)` — started/stopped/error/restarting | N/A (stateless subprocess) | Must synthesize from subprocess lifecycle |
| **Message History** | `getMessages(id)` | `getSessionMessages(id)` | Direct mapping |
| **Conversation List** | `listConversations()` | `listSessions()` | Direct mapping |
| **Delete Conversation** | `deleteConversation(id)`, `destroyConversation(id)` | `deleteSession(id)` | Direct mapping |
| **Tool Definitions** | Domain `ToolDefinition[]` → SDK `Tool[]` via `buildSdkTools()` | `createSdkMcpServer()` with `tool()` helper | Different pattern: direct tools vs. MCP server wrapping |
| **Permission Handling** | `PermissionRequest` → approved/denied | `permissionMode` + `hooks.PreToolUse` + `canUseTool` callback | Richer permission model in Claude Agent SDK |
| **Streaming Events** | 16+ SDK events mapped to domain `AgentEvent` | 5 message types + `StreamEvent` for deltas | Need new event mapper |
| **Extended Thinking** | `reasoningEffort` param | `effort` option (low/medium/high/xhigh/max) | Direct mapping |
| **MCP Servers** | Config-driven pass-through | Native `mcpServers` option (in-process + external) | Richer — in-process MCP is unique to Claude Agent SDK |
| **Custom Agents/Subagents** | Sub-agent nesting via config | `agents` option with `AgentDefinition` | More structured in Claude Agent SDK |
| **System Prompt** | Via `CreateConversationParams.systemMessage` | `systemPrompt` option | Direct mapping |
| **Working Directory** | Via `__workingDirectory` variable | `cwd` option | Direct mapping |
| **Cost Tracking** | `assistant.usage` event | `ResultMessage.total_cost_usd`, `usage` | Richer cost data in Claude Agent SDK |
| **Session Fork** | N/A | `forkSession: true` | New capability |
| **File Checkpointing** | N/A (manual via workspace) | Built-in file checkpoint/revert | New capability |
| **Context Compaction** | N/A | Automatic, with `PreCompact` hook | New capability |
| **Structured Output** | N/A | Built-in with retry | New capability |
| **Built-in Tools** | None (all custom via ICopilotPort tools) | 14+ built-in tools (Read, Write, Edit, Bash...) | Major new capability |
| **Web Search/Fetch** | N/A | WebSearch, WebFetch tools | New capability |
| **Sandbox** | Docker/HostProcess providers | `sandbox` option (built-in) | Simpler model |

### 3.2 What We Gain with Claude Agent SDK

1. **Autonomous Agent Loop** — The SDK handles the entire tool-call → result → re-evaluate cycle. No need for `StageExecutionService` to manually orchestrate prompt-response-tool loops.
2. **Built-in File Operations** — Read/Write/Edit tools reduce custom code for workspace management.
3. **Native MCP Support** — In-process MCP servers for custom tools without subprocess management.
4. **Session Persistence & Fork** — Disk-based sessions with resume/fork enable new workflow patterns.
5. **Rich Permission Model** — 6 permission modes + hooks + canUseTool for fine-grained control.
6. **Subagent Architecture** — Context-isolated sub-tasks with tool restrictions and model selection.
7. **Structured Output** — Validated JSON responses with automatic retry.
8. **Cost Tracking** — Per-query cost and usage metrics.
9. **Web Search/Fetch** — Built-in internet access for research-oriented workflows.
10. **Context Compaction** — Automatic summarization prevents context overflow in long sessions.

### 3.3 What We Lose / Must Accommodate

1. **Stateless Per-Query Model** — No persistent `CopilotClient` with N sessions. Each `query()` call is independent (unless resumed).
2. **No Built-in Model Discovery** — Must maintain our own model list or query the Anthropic API.
3. **Subprocess Architecture** — The SDK spawns a Claude Code CLI binary. This has resource implications.
4. **Event Model Change** — Callback-based event subscription → async iterator. Core `EventBus` integration needs new adapter pattern.
5. **No Client State Polling** — No equivalent to `CopilotAdapter.startClientStatePolling()`. Must infer health from query success/failure.

---

## 4. Industry Research

### 4.1 How Other Agents Use Claude Agent SDK

#### Augment Code
- **Approach:** IDE-focused AI agent with proprietary Context Engine
- **Architecture:** MCP-based tool integration, multi-model routing
- **Key Insight:** Uses MCP as the universal tool interface; context engine provides semantic understanding
- **Relevance:** Their MCP-first approach validates our strategy of wrapping domain tools as MCP servers for the Claude Agent SDK

#### Mastra (by Gatsby team)
- **Approach:** TypeScript framework for AI agents and workflows
- **Architecture:** `Agent` class with model routing (`provider/model-name`), graph-based workflows (`.then()`, `.branch()`, `.parallel()`), human-in-the-loop via suspend/resume
- **Key Insight:** Clean separation of agent definition (instructions, model, tools) from execution runtime. Supports 40+ model providers through single interface.
- **Relevance:** Their model-routing pattern and workflow graph engine are directly analogous to our `DAGScheduler` + `SessionAllocator`. Their `Agent.generate()` / `Agent.stream()` pattern maps to our `StageExecutionService.executeStage()`.

#### OpenClaw / Open-Source Agent Frameworks
- **Approach:** LangChain/LangGraph-style composable agents
- **Architecture:** Nodes and edges forming execution graphs, with tool nodes and LLM nodes
- **Key Insight:** Graph-based orchestration with checkpointing at node boundaries
- **Relevance:** Validates our DAG approach. Their checkpoint pattern maps to Claude Agent SDK's session persistence.

### 4.2 Best Practices Distilled

1. **Adapter Pattern (Port/Adapter)** — All frameworks isolate SDK specifics behind an interface. Our `ICopilotPort` pattern is the gold standard.
2. **MCP as Universal Tool Layer** — The Claude Agent SDK's native MCP support means we should wrap our domain tools as MCP servers rather than translating to a proprietary tool format.
3. **Event Translation Layer** — Every framework has a mapping layer between SDK events and domain events. Our `event-mapper.ts` pattern should be replicated.
4. **Session-Per-Stage** — Claude Agent SDK sessions are lightweight (JSONL files). Using one session per stage (like our `per-stage` allocation mode) is natural.
5. **Cost-Aware Scheduling** — Claude Agent SDK's `maxBudgetUsd` enables per-stage cost limits, which is a new capability for `StageExecutionService`.

---

## 5. Architecture Design

### 5.1 Package Structure

```
packages/
  claude-agent-bridge/               # NEW PACKAGE
    package.json                     # deps: @anthropic-ai/claude-agent-sdk, zod
    tsconfig.json
    src/
      index.ts                       # Public API barrel
      ClaudeAgentAdapter.ts          # ICopilotPort implementation
      event-mapper.ts                # SDK messages → AgentEvent
      tool-factory.ts                # Domain ToolDefinition → SDK MCP server
      session-manager.ts             # Session lifecycle (create/resume/fork/delete)
      hook-bridge.ts                 # Domain hooks → SDK hooks translation
      permission-mapper.ts           # Domain permissions → SDK permission modes
      types.ts                       # Claude Agent SDK specific types
    __tests__/
      ClaudeAgentAdapter.test.ts
      event-mapper.test.ts
      tool-factory.test.ts
      session-manager.test.ts
```

### 5.2 Dependency Graph

```
apps/server/                         # Composition root selects adapter
  └─> packages/core/               
       └─> ICopilotPort (domain port)
            ├─> packages/copilot-bridge/     # @github/copilot-sdk (existing)
            ├─> packages/anthropic-bridge/   # @anthropic-ai/sdk (existing scaffold)
            └─> packages/claude-agent-bridge/ # @anthropic-ai/claude-agent-sdk (NEW)

packages/claude-agent-bridge/
  ├─> @anthropic-ai/claude-agent-sdk  (external)
  ├─> @generatorai/shared             (types, errors)
  └─> zod                             (tool schemas)
```

### 5.3 Port Interface Mapping

The `ICopilotPort` interface defines 16 methods across 4 categories. Here's how each maps to Claude Agent SDK:

```typescript
// packages/claude-agent-bridge/src/ClaudeAgentAdapter.ts

export class ClaudeAgentAdapter implements ICopilotPort {
  // === Client Lifecycle ===
  // The Claude Agent SDK uses per-query subprocesses. There's no persistent client.
  // We simulate client lifecycle by tracking subprocess health.
  
  async initialize(): Promise<void>           // startup() pre-warm (optional)
  async stop(): Promise<void>                 // No-op (stateless)
  async forceStop(): Promise<void>            // Kill any running queries
  getClientState(): CopilotClientState        // Derived from internal tracking
  async ping(): Promise<boolean>              // Run minimal query to verify
  async shutdown(): Promise<void>             // Cleanup all active queries

  // === Model Discovery ===
  async getModels(): Promise<CopilotModel[]>  // Hardcoded list + optional API check
  
  // === Conversation Lifecycle ===
  // Claude Agent SDK sessions ≈ Copilot conversations
  async createConversation(params): Promise<string>      // Store config, return UUID
  async resumeConversation(id): Promise<string>          // resume: id
  async listConversations(): Promise<string[]>           // listSessions()
  async getLastConversationId(): Promise<string | null>  // Most recent session
  async deleteConversation(id): Promise<void>            // deleteSession()
  async destroyConversation(id): Promise<void>           // deleteSession() + cleanup
  
  // === Messaging ===
  async sendPrompt(id, text): Promise<void>              // query() fire-and-forget
  async sendPromptAndWait(id, text): Promise<ConversationResponse>  // query() → collect
  async getMessages(id): Promise<ConversationMessage[]>  // getSessionMessages()
  async abortConversation(id): Promise<void>             // query.close()
  
  // === Events ===
  onConversationEvent(id, handler): () => void   // Wire into query() iterator
  onClientEvent(handler): () => void             // Synthesized events
}
```

### 5.4 Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Package naming | `claude-agent-bridge` (not `claude-code-bridge`) | Per Anthropic branding — "Claude Agent SDK" not "Claude Code SDK" |
| `query()` lifecycle | One `query()` per `sendPrompt()` call, with resume for multi-turn | Aligns with SDK's stateless-per-query model |
| Session storage | Default disk persistence + optional `SessionStore` adapter | Enables future external storage (Redis, S3) |
| Tool wrapping | Domain tools → in-process MCP server | Leverages SDK's native MCP; avoids custom tool format |
| Permission translation | Map domain `PermissionRequest` to SDK hooks | SDK hooks are more powerful than simple approve/deny |
| Streaming | `includePartialMessages: true` → map `StreamEvent` to domain events | Enables real-time token streaming to SSE |
| Harness type | `'claude-agent'` (new, distinct from `'anthropic'`) | Clear differentiation from raw Anthropic SDK adapter |

---

## 6. Implementation Plan

### Phase 1: Foundation (Core Adapter + Basic Query)

**Goal:** `ClaudeAgentAdapter` can initialize, send a prompt, and return a response.

#### 6.1.1 Package Setup
- Create `packages/claude-agent-bridge/` with `package.json`, `tsconfig.json`
- Add dependency: `@anthropic-ai/claude-agent-sdk@^0.2.123`
- Configure workspace in `pnpm-workspace.yaml`
- Add to `turbo.json` build pipeline

#### 6.1.2 Core Types (`types.ts`)
```typescript
export interface ClaudeAgentAdapterOptions {
  apiKey?: string;                    // ANTHROPIC_API_KEY
  defaultModel?: string;             // e.g., "claude-sonnet-4-6"
  defaultCwd?: string;               // Working directory
  defaultTimeoutMs?: number;         // Per-query timeout
  defaultEffort?: EffortLevel;       // low | medium | high | xhigh | max
  defaultPermissionMode?: PermissionMode;
  defaultMaxTurns?: number;
  defaultMaxBudgetUsd?: number;
  usePrewarm?: boolean;              // Call startup() on init
  verbose?: boolean;
  env?: Record<string, string>;
  settingSources?: SettingSource[];
}

export interface ActiveQuery {
  queryId: string;
  conversationId: string;
  abortController: AbortController;
  eventHandlers: Set<(event: AgentEvent) => void>;
  status: 'running' | 'completed' | 'failed' | 'aborted';
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'plan' | 'auto';
export type SettingSource = 'user' | 'project' | 'local';
```

#### 6.1.3 ClaudeAgentAdapter Core
- Implement `initialize()` with optional `startup()` pre-warm
- Implement `createConversation()` storing config in an in-memory map
- Implement `sendPromptAndWait()` using `query()` with full message collection
- Implement basic `getClientState()` tracking
- Implement `stop()`, `forceStop()`, `shutdown()`

#### 6.1.4 Composition Root Registration
- Update `apps/server/src/composition-root.ts` to handle `harness.type = 'claude-agent'`
- Update `apps/cli/src/platform/createClient.ts` with same
- Add `ClaudeAgentAdapterOptions` to shared config Zod schema

### Phase 2: Event Mapping & Streaming

**Goal:** Full streaming support with domain event translation.

#### 6.2.1 Event Mapper (`event-mapper.ts`)

```typescript
// Claude Agent SDK Message → Domain AgentEvent mapping

export function mapClaudeAgentMessageToAgentEvents(
  message: SDKMessage,
  sessionId: string
): AgentEvent[] {
  switch (message.type) {
    case 'system':
      return mapSystemMessage(message, sessionId);
    case 'assistant':
      return mapAssistantMessage(message, sessionId);
    case 'user':
      return mapUserMessage(message, sessionId);
    case 'result':
      return mapResultMessage(message, sessionId);
    default:
      return [{ kind: 'copilot.unknown', data: message }];
  }
}

// Detail mappings:
// SystemMessage (init)     → copilot.session_start
// SystemMessage (compact)  → copilot.session_info (compaction)
// AssistantMessage (text)  → copilot.token (per content block) + copilot.message_complete
// AssistantMessage (tools) → copilot.tool_start (per ToolUseBlock)
// UserMessage (tool_result)→ copilot.tool_complete (per ToolResultBlock)
// StreamEvent (text_delta) → copilot.token
// StreamEvent (thinking)   → copilot.reasoning_delta
// ResultMessage (success)  → copilot.idle + copilot.usage
// ResultMessage (error_*)  → copilot.error
```

#### 6.2.2 Streaming Integration
- Implement `sendPrompt()` (fire-and-forget) with `includePartialMessages: true`
- Wire `onConversationEvent()` to emit events from the `query()` async iterator
- Run the iterator in a background async task, pushing events to registered handlers
- Handle `StreamEvent` messages for real-time text deltas and thinking blocks
- Map to existing `copilot.token`, `copilot.reasoning_delta` event kinds

#### 6.2.3 EventBus Integration
- Events from the adapter flow through `StageExecutionService` → `EventBus` → `StreamBroker` → SSE
- No changes needed to `EventBus` or `StreamBroker` — they consume domain `AgentEvent`s
- The new event-mapper produces the same `AgentEvent` discriminated union

### Phase 3: Tool Integration

**Goal:** Domain `ToolDefinition[]` work with Claude Agent SDK via MCP servers.

#### 6.3.1 Tool Factory (`tool-factory.ts`)

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ToolDefinition } from "@generatorai/shared";

export function buildClaudeAgentTools(
  toolDefs: ToolDefinition[]
): { mcpServer: McpServer; toolNames: string[] } {
  const serverName = "generatorai-tools";
  
  const sdkTools = toolDefs.map(def => {
    // Convert domain JSON Schema → Zod schema
    const zodSchema = jsonSchemaToZod(def.inputSchema);
    
    return tool(
      def.name,
      def.description,
      zodSchema,
      async (args) => {
        // Call the domain handler
        const result = await def.handler(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: result.error ? true : undefined,
        };
      },
      def.readOnly ? { readOnlyHint: true } : undefined
    );
  });

  const mcpServer = createSdkMcpServer({
    name: serverName,
    version: "1.0.0",
    tools: sdkTools,
  });

  const toolNames = toolDefs.map(d => `mcp__${serverName}__${d.name}`);
  
  return { mcpServer, toolNames };
}
```

#### 6.3.2 Built-in Tool Passthrough
- Claude Agent SDK built-in tools (Read, Write, Edit, Bash, etc.) can be directly included
- `StageExecutionService` configures which built-in tools are available per stage
- `allowed_tools` in `CreateConversationParams` maps to `allowedTools` + `tools` options
- Domain `ToolDefinition[]` from hooks/config are wrapped as MCP server tools

#### 6.3.3 Tool Event Correlation
- `ToolUseBlock` in `AssistantMessage` provides `id`, `name`, `input`
- `ToolResultBlock` in `UserMessage` provides `tool_use_id`, `content`
- Map to `copilot.tool_start` + `copilot.tool_complete` with correlation via `tool_use_id`

### Phase 4: Session Management

**Goal:** Full session lifecycle with resume, fork, and list operations.

#### 6.4.1 Session Manager (`session-manager.ts`)

```typescript
export class ClaudeAgentSessionManager {
  private sessions: Map<string, SessionConfig>;  // conversationId → config
  private activeQueries: Map<string, ActiveQuery>;
  
  createSession(params: CreateConversationParams): string;
  resumeSession(conversationId: string): string;
  forkSession(conversationId: string): string;
  listSessions(cwd?: string): Promise<SessionInfo[]>;
  getSessionMessages(id: string): Promise<ConversationMessage[]>;
  deleteSession(id: string): Promise<void>;
  getActiveQuery(conversationId: string): ActiveQuery | undefined;
  abortQuery(conversationId: string): void;
}
```

#### 6.4.2 Session Allocation Integration
- `SessionAllocator` calls `createConversation()` → creates session config
- For `per-stage` mode: each stage gets a fresh `query()` with its own config
- For `single` mode: stages share a session via `resume: sessionId`
- For `auto` mode: independent stages get fresh sessions; dependent stages resume

#### 6.4.3 Session Persistence
- Default: Claude Agent SDK persists to `~/.claude/projects/<encoded-cwd>/`
- Our `SessionAllocator` stores `conversationId` (= SDK session ID) in the Session entity
- On restart, `StartupRecoveryService` can resume sessions via stored IDs

### Phase 5: Hooks & Permissions

**Goal:** Domain hooks system maps to Claude Agent SDK hooks.

#### 6.5.1 Hook Bridge (`hook-bridge.ts`)

```typescript
import type { HookCallback, HookMatcher } from "@anthropic-ai/claude-agent-sdk";
import type { HookDefinition } from "@generatorai/shared";

export function buildClaudeAgentHooks(
  domainHooks: HookDefinition[]
): Record<string, HookMatcher[]> {
  const sdkHooks: Record<string, HookMatcher[]> = {};
  
  for (const hook of domainHooks) {
    switch (hook.phase) {
      case 'pre_tool_use':
        sdkHooks.PreToolUse ??= [];
        sdkHooks.PreToolUse.push({
          matcher: hook.toolPattern,
          hooks: [createPreToolCallback(hook)],
          timeout: hook.timeoutMs ? hook.timeoutMs / 1000 : 60,
        });
        break;
      case 'post_tool_use':
        sdkHooks.PostToolUse ??= [];
        sdkHooks.PostToolUse.push({
          hooks: [createPostToolCallback(hook)],
        });
        break;
      case 'on_message':
        sdkHooks.UserPromptSubmit ??= [];
        sdkHooks.UserPromptSubmit.push({
          hooks: [createPromptCallback(hook)],
        });
        break;
      case 'on_session_start':
        sdkHooks.SessionStart ??= [];
        sdkHooks.SessionStart.push({
          hooks: [createSessionStartCallback(hook)],
        });
        break;
      case 'on_session_idle':
        sdkHooks.Stop ??= [];
        sdkHooks.Stop.push({
          hooks: [createStopCallback(hook)],
        });
        break;
      // ... map remaining domain hook phases
    }
  }
  
  return sdkHooks;
}
```

#### 6.5.2 Permission Mapper (`permission-mapper.ts`)

```typescript
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { CreateConversationParams } from "@generatorai/core";

export function mapPermissions(params: CreateConversationParams): {
  permissionMode: PermissionMode;
  allowedTools: string[];
  disallowedTools: string[];
} {
  // Default: auto-approve all tools for workflow execution (matches Copilot behavior)
  if (params.autoApproveAll) {
    return {
      permissionMode: 'bypassPermissions',
      allowedTools: [],
      disallowedTools: [],
    };
  }
  
  // Map domain permissions to SDK permission mode
  const allowedTools = (params.permissions?.allowedTools ?? [])
    .map(t => t.name);
  const disallowedTools = (params.permissions?.blockedTools ?? [])
    .map(t => t.name);
  
  return {
    permissionMode: params.permissionMode as PermissionMode ?? 'acceptEdits',
    allowedTools,
    disallowedTools,
  };
}
```

### Phase 6: CLI & Web API Integration

**Goal:** Both CLI and Web UI can use Claude Agent SDK seamlessly.

#### 6.6.1 Server Composition Root
```typescript
// apps/server/src/composition-root.ts
function createHarnessPort(config: AppConfig): ICopilotPort {
  switch (config.harness.type) {
    case 'copilot':
      return new CopilotAdapter(config.harness.copilotOptions);
    case 'anthropic':
      return new AnthropicAdapter(config.harness.anthropicOptions);
    case 'claude-agent':  // NEW
      return new ClaudeAgentAdapter(config.harness.claudeAgentOptions);
    default:
      const _exhaustive: never = config.harness.type;
      throw new Error(`Unknown harness type: ${_exhaustive}`);
  }
}
```

#### 6.6.2 Config Schema Extension
```typescript
// packages/shared/src/config/
export const claudeAgentHarnessSchema = z.object({
  type: z.literal('claude-agent'),
  apiKey: z.string().optional(),
  model: z.string().default('claude-sonnet-4-6'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'plan']).default('acceptEdits'),
  maxTurns: z.number().default(50),
  maxBudgetUsd: z.number().optional(),
  cwd: z.string().optional(),
  usePrewarm: z.boolean().default(true),
  settingSources: z.array(z.enum(['user', 'project', 'local'])).optional(),
  env: z.record(z.string()).optional(),
});
```

#### 6.6.3 CLI DirectPlatformClient
- When CLI uses `mode: 'direct'`, it embeds `ClaudeAgentAdapter` in-process
- `createClient()` factory instantiates the correct adapter based on config
- All CLI commands (workflow run, chat, session inspect) work identically

#### 6.6.4 Web API — No Route Changes Needed
- All API routes use `ICopilotPort` through the composition root
- SSE streaming works via `EventBus` → `StreamBroker` — no changes
- The only change is in `composition-root.ts` and the config schema

---

## 7. Event Mapping Design

### 7.1 Complete Event Translation Table

| Claude Agent SDK Message | Domain AgentEvent Kind | Payload Mapping |
|---|---|---|
| `SystemMessage` (init) | `copilot.session_start` | `{ sessionId, tools, model }` |
| `SystemMessage` (compact_boundary) | `copilot.session_info` | `{ type: 'compaction' }` |
| `SystemMessage` (status: requesting) | `copilot.session_info` | `{ type: 'requesting' }` |
| `AssistantMessage` (TextBlock) | `copilot.message_complete` | `{ content: block.text }` |
| `AssistantMessage` (ToolUseBlock) | `copilot.tool_start` | `{ callId: block.id, tool: block.name, args: block.input }` |
| `UserMessage` (ToolResultBlock) | `copilot.tool_complete` | `{ callId: block.tool_use_id, result, success }` |
| `StreamEvent` (text delta) | `copilot.token` | `{ text: delta.text }` |
| `StreamEvent` (thinking delta) | `copilot.reasoning_delta` | `{ text: delta.thinking }` |
| `ResultMessage` (success) | `copilot.idle` + `copilot.usage` | `{ result }` + `{ model, cost, tokens }` |
| `ResultMessage` (error_max_turns) | `copilot.error` | `{ error: 'max_turns_exceeded' }` |
| `ResultMessage` (error_max_budget) | `copilot.error` | `{ error: 'budget_exceeded' }` |
| `ResultMessage` (error_during_execution) | `copilot.error` | `{ error: message }` |
| Hook: SubagentStart | `copilot.session_info` | `{ type: 'subagent_start', agentId }` |
| Hook: SubagentStop | `copilot.session_info` | `{ type: 'subagent_stop', agentId }` |
| Hook: Notification | `copilot.session_info` | `{ type: 'notification', message }` |

### 7.2 New Event Kinds (Optional Phase 7)

If we want to expose Claude Agent SDK-specific features:

| New Event Kind | Source | Purpose |
|---|---|---|
| `claude.context_compacted` | `compact_boundary` | Signal context was summarized |
| `claude.cost_update` | `ResultMessage` | Real-time cost → budget tracking for UI |
| `claude.subagent_started` | `SubagentStart` hook | Show subagent activity in UI |
| `claude.subagent_completed` | `SubagentStop` hook | Show subagent results in UI |
| `claude.permission_requested` | `PermissionRequest` hook | HITL permission prompts |

---

## 8. Session & Conversation Lifecycle

### 8.1 Lifecycle Flow (per-stage mode)

```
WorkflowRun starts
  │
  ├─ DAGScheduler → getReadyStages()
  │
  ├─ StageRun 1: "Code Review"
  │   ├─ SessionAllocator.allocateSession() 
  │   │   └─ ClaudeAgentAdapter.createConversation(params)
  │   │       └─ Stores: { conversationId, options, hooks, tools }
  │   │
  │   ├─ StageExecutionService.executeStage()
  │   │   ├─ sendPrompt(conversationId, stagePrompt)
  │   │   │   └─ query({ prompt, options: { ... } })
  │   │   │       for await (message of query) {
  │   │   │         events → EventBus → StreamBroker → SSE
  │   │   │       }
  │   │   └─ Extract artifacts from message content
  │   │
  │   └─ SessionAllocator.releaseSession()
  │       └─ ClaudeAgentAdapter.destroyConversation()
  │           └─ deleteSession(conversationId)
  │
  ├─ StageRun 2: "Code Generation" (depends on Stage 1)
  │   └─ Same flow, possibly with resume: previousSessionId (single mode)
  │
  └─ DAGScheduler.isDAGComplete() → WorkflowRun completes
```

### 8.2 Chat Mode Lifecycle

```
User creates Chat → ChatManagementService.createChat()
  │
  ├─ createConversation(params) → conversationId stored in Session
  │
  ├─ User sends message
  │   ├─ sendPrompt(conversationId, message)
  │   │   └─ query({ prompt: message, options: { resume: conversationId } })
  │   └─ Events stream via SSE
  │
  ├─ User sends follow-up
  │   └─ query({ prompt: followup, options: { resume: conversationId } })
  │       // Full conversation context from prior session
  │
  └─ Chat closed → destroyConversation(conversationId)
```

---

## 9. Tool Integration Strategy

### 9.1 Three-Tier Tool Model

```
┌────────────────────────────────────────────┐
│ Tier 1: Claude Agent SDK Built-in Tools     │
│   Read, Write, Edit, Bash, Glob, Grep,      │
│   WebSearch, WebFetch, Agent, Skill,         │
│   AskUserQuestion, TodoWrite, Monitor        │
│                                              │
│   → Configured via 'tools' and              │
│     'allowedTools' options                   │
└────────────────────────────────────────────┘
         ↕ available alongside
┌────────────────────────────────────────────┐
│ Tier 2: Domain Custom Tools (In-Process MCP)│
│   Wrapped via createSdkMcpServer()          │
│   Names: mcp__generatorai-tools__<name>     │
│                                              │
│   → Stage-specific tools from workflow def  │
│   → Hook-injected tools                     │
│   → Git operations, script execution         │
└────────────────────────────────────────────┘
         ↕ available alongside
┌────────────────────────────────────────────┐
│ Tier 3: External MCP Servers                │
│   Configured via mcpServers option           │
│   stdio/http/SSE transport                   │
│                                              │
│   → User-configured services                │
│   → Database, browser, API connectors        │
└────────────────────────────────────────────┘
```

### 9.2 Tool Configuration Per Stage

```typescript
// In StageExecutionService, when building query options:
const queryOptions = {
  // Tier 1: Built-in tools
  tools: stageConfig.builtinTools ?? ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  allowedTools: [
    ...stageConfig.allowedBuiltinTools,
    ...domainToolNames.map(n => `mcp__generatorai-tools__${n}`),
    ...externalMcpToolNames,
  ],
  
  // Tier 2: Domain tools as MCP
  mcpServers: {
    "generatorai-tools": domainMcpServer,
    ...externalMcpServers,
  },
  
  // Tier 3: External MCP from configuration
  // Merged from workflow definition + stage overrides
};
```

---

## 10. Hook System Mapping

### 10.1 Domain Hook Phase → Claude SDK Hook Event

| Domain Hook Phase | SDK Hook Event | Notes |
|---|---|---|
| `pre_run` | Custom (before `query()`) | Execute before query starts |
| `post_run` | `Stop` | After agent loop finishes |
| `pre_clone` | Custom (before git ops) | Not an SDK hook — execute in orchestrator |
| `post_clone` | Custom (after git ops) | Not an SDK hook — execute in orchestrator |
| `pre_prompt` | `UserPromptSubmit` | Before prompt sent |
| `post_prompt` | Process `AssistantMessage` | After Claude responds |
| `pre_commit` | Custom (before git ops) | Execute in orchestrator |
| `post_commit` | Custom (after git ops) | Execute in orchestrator |
| `on_error` | Process `ResultMessage` (error subtypes) | Error handling |
| `on_cancel` | Abort handling | When `abortConversation()` called |
| `pre_tool_use` | `PreToolUse` | **Direct mapping** |
| `post_tool_use` | `PostToolUse` | **Direct mapping** |
| `on_message` | `UserPromptSubmit` | Prompt injection |
| `on_reasoning` | Process `StreamEvent` (thinking) | Reasoning extraction |
| `on_session_start` | `SessionStart` | **Direct mapping** (TS only) |
| `on_session_idle` | `Stop` | Closest equivalent |
| `on_session_error` | Error result handling | Process error results |
| `on_permission` | `PermissionRequest` | **Direct mapping** |

---

## 11. Permission System Translation

### 11.1 Domain → SDK Permission Mapping

| Domain Permission State | SDK Action |
|---|---|
| Auto-approve all (workflow execution) | `permissionMode: 'bypassPermissions'` |
| Auto-approve file edits | `permissionMode: 'acceptEdits'` |
| Approve specific tools | `allowedTools: [...]` |
| Block specific tools | `disallowedTools: [...]` |
| Require approval for all | `permissionMode: 'default'` + no `allowedTools` |
| HITL (human-in-the-loop) | `PermissionRequest` hook → emit to EventBus → SSE → web UI → respond |

### 11.2 HITL Integration

```typescript
// In hook-bridge.ts
function createPermissionRequestHook(
  eventBus: EventBus,
  responseWaiters: Map<string, (approved: boolean) => void>
): HookCallback {
  return async (input, toolUseId, context) => {
    // Emit permission request to web UI via EventBus
    const requestId = crypto.randomUUID();
    eventBus.emit(sessionId, {
      kind: 'permission.requested',
      data: { requestId, tool: input.tool_name, args: input.tool_input },
    });
    
    // Wait for user response (via API endpoint)
    const approved = await new Promise<boolean>((resolve) => {
      responseWaiters.set(requestId, resolve);
      setTimeout(() => resolve(false), 60_000); // 60s timeout
    });
    
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: approved ? 'allow' : 'deny',
        permissionDecisionReason: approved ? 'User approved' : 'User denied',
      },
    };
  };
}
```

---

## 12. Streaming & SSE Integration

### 12.1 Data Flow

```
Claude Agent SDK query()
  │ (async iterator)
  ▼
ClaudeAgentAdapter
  │ iterates messages, calls event-mapper
  ▼
AgentEvent (domain type)
  │ emitted via registered handlers
  ▼
StageExecutionService
  │ calls EventBus.emit()
  ▼
EventBus
  ├─ SQLite persist (monotonic sequenceId)
  └─ broadcast to subscribers
      │
      ├─ StreamBroker → SSE clients (web)
      ├─ RunLogger → stream-log.jsonl
      └─ In-process listeners (CLI direct mode)
```

### 12.2 No Changes Required

The beauty of the port/adapter pattern is that:
- `EventBus`, `StreamBroker`, and SSE endpoints are **unchanged**
- The web `sseManager` is **unchanged** (it consumes `AgentEvent`)
- CLI event rendering is **unchanged**
- The only new code is in `packages/claude-agent-bridge/`

---

## 13. Configuration & DI Wiring

### 13.1 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Claude API key |
| `GENERATORAI_HARNESS_TYPE` | `copilot` | Set to `claude-agent` |
| `CLAUDE_AGENT_MODEL` | `claude-sonnet-4-6` | Default model |
| `CLAUDE_AGENT_EFFORT` | `high` | Default effort level |
| `CLAUDE_AGENT_PERMISSION_MODE` | `acceptEdits` | Default permission mode |
| `CLAUDE_AGENT_MAX_TURNS` | `50` | Default max turns |
| `CLAUDE_AGENT_MAX_BUDGET_USD` | (none) | Per-query cost limit |
| `CLAUDE_CODE_USE_BEDROCK` | `0` | Enable AWS Bedrock |
| `CLAUDE_CODE_USE_VERTEX` | `0` | Enable Google Vertex |
| `CLAUDE_CODE_USE_FOUNDRY` | `0` | Enable Azure Foundry |

### 13.2 Config File Integration

```json
// generatorai.config.json
{
  "harness": {
    "type": "claude-agent",
    "model": "claude-sonnet-4-6",
    "effort": "high",
    "permissionMode": "acceptEdits",
    "maxTurns": 50,
    "maxBudgetUsd": 10.0,
    "usePrewarm": true,
    "settingSources": ["project"]
  }
}
```

---

## 14. CLI & Web API Parity

### 14.1 CLI Commands — No Changes Required

All CLI commands work through `ICopilotPort`. Switching to `claude-agent` harness:

| Command | Behavior Change |
|---|---|
| `generatorai workflow run` | Uses Claude Agent SDK for stage execution |
| `generatorai chat start` | Creates Claude Agent session |
| `generatorai chat send` | Sends prompt via Claude Agent SDK |
| `generatorai session list` | Lists Claude Agent sessions |
| `generatorai session inspect` | Shows session details |
| `generatorai health` | Checks Claude Agent SDK availability |
| `generatorai config` | Shows/sets harness type |

### 14.2 Web API Routes — No Changes Required

All routes use `ICopilotPort` via composition root:

| Route | Behavior |
|---|---|
| `POST /api/orchestrator/runs` | Creates workflow run with Claude Agent SDK |
| `GET /api/stream?scope=run&id=X` | SSE streams Claude Agent events |
| `POST /api/chats/:id/messages` | Sends message to Claude Agent session |
| `GET /api/copilot/models` | Returns Claude model list |
| `GET /api/copilot/health` | Returns Claude Agent SDK health |

### 14.3 Web UI — Minimal Changes

The web UI should display Claude Agent SDK-specific info:

| Component | Change |
|---|---|
| Settings page | Add `claude-agent` option to harness selector |
| Run monitoring | Show cost (`total_cost_usd`) if available |
| Stage execution | Show `num_turns` in stage summary |
| Chat view | No changes (events are same `AgentEvent` types) |
| Model selector | Show Claude models when harness is `claude-agent` |

---

## 15. Migration & Coexistence Strategy

### 15.1 Coexistence Model

Both Copilot SDK and Claude Agent SDK will coexist as selectable harnesses:

```
generatorai.config.json
  harness.type = 'copilot'        → CopilotAdapter (existing)
  harness.type = 'anthropic'      → AnthropicAdapter (existing scaffold)
  harness.type = 'claude-agent'   → ClaudeAgentAdapter (NEW)
```

### 15.2 Per-Workflow Override (Future)

Allow workflows to specify their preferred harness:

```json
{
  "workflowDefinition": {
    "harness": "claude-agent",
    "copilotConfig": {
      "model": "claude-opus-4-6",
      "effort": "max"
    }
  }
}
```

### 15.3 No Breaking Changes

- Existing Copilot SDK workflows continue to work unchanged
- The new harness type is opt-in via configuration
- Database schema unchanged (sessions, events, artifacts all schema-agnostic)
- All `AgentEvent` kinds remain backward-compatible

---

## 16. Testing Strategy

### 16.1 Unit Tests

| Test File | Coverage |
|---|---|
| `ClaudeAgentAdapter.test.ts` | All 16 ICopilotPort methods |
| `event-mapper.test.ts` | All message types → AgentEvent translations |
| `tool-factory.test.ts` | Domain tools → MCP server wrapping |
| `session-manager.test.ts` | Create/resume/fork/delete lifecycle |
| `hook-bridge.test.ts` | Domain hooks → SDK hooks translation |
| `permission-mapper.test.ts` | All permission mode translations |

### 16.2 Integration Tests

| Test | Description |
|---|---|
| `adapter-lifecycle.test.ts` | Initialize → createConversation → sendPrompt → idle → destroy |
| `streaming-integration.test.ts` | Verify events flow through EventBus → StreamBroker |
| `tool-execution.test.ts` | Custom tools called via MCP server |
| `session-resume.test.ts` | Create → prompt → resume → follow-up |
| `multi-stage-dag.test.ts` | Run a 3-stage DAG workflow with Claude Agent SDK |

### 16.3 E2E Tests

| Test | Description |
|---|---|
| `claude-agent-workflow-e2e.spec.ts` | Full workflow: create → run → stream → complete |
| `claude-agent-chat-e2e.spec.ts` | Chat: create → send → stream → follow-up |
| `harness-switching-e2e.spec.ts` | Switch between copilot and claude-agent harnesses |

### 16.4 Mock Strategy

For unit tests, mock the `query()` function:
```typescript
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'test-session' };
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } };
    yield { type: 'result', subtype: 'success', result: 'Hello', session_id: 'test-session', total_cost_usd: 0.001 };
  }),
}));
```

---

## 17. Risk Assessment

### 17.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Claude Code binary compatibility issues (Windows/Mac/Linux) | High | Medium | Test on all 3 platforms in CI; provide fallback error messages |
| Subprocess resource overhead (one per query) | Medium | High | Use `startup()` pre-warm; document resource requirements |
| Event timing differences (iterator vs callback) | Medium | Medium | Thorough event-mapper testing; race condition analysis |
| Session file conflicts (multiple stages writing to same cwd) | High | Low | Each stage gets unique cwd via run workspace directory |
| API key exposure in subprocess env | High | Low | Use `env` option to pass only required env vars |
| Rate limiting (API-level) | Medium | Medium | Implement exponential backoff in adapter; expose `maxBudgetUsd` |
| Context window overflow in long sessions | Medium | Medium | Use `maxTurns` limit; leverage built-in auto-compaction |

### 17.2 Organizational Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Anthropic license/terms changes | High | Review Commercial ToS; don't depend on undocumented features |
| SDK breaking changes (0.x version) | Medium | Pin version; follow CHANGELOG; test on upgrade |
| Branding requirements | Low | Follow Anthropic branding guidelines (no "Claude Code" branding) |

---

## 18. Phase Breakdown & Timeline

### Phase 1: Foundation
**Scope:** Package setup, core adapter, basic query, composition root
**Files:** 8-10 new files  
**Dependencies:** None  

**Deliverables:**
- [ ] `packages/claude-agent-bridge/package.json` + `tsconfig.json`
- [ ] `ClaudeAgentAdapter.ts` — all 16 methods with basic implementations
- [ ] `types.ts` — adapter-specific types
- [ ] `composition-root.ts` updated for `claude-agent` harness
- [ ] Shared config Zod schema updated
- [ ] Basic unit tests for adapter lifecycle

### Phase 2: Event Mapping & Streaming
**Scope:** Full event translation, real-time streaming
**Dependencies:** Phase 1  

**Deliverables:**
- [ ] `event-mapper.ts` — complete message → AgentEvent mapping
- [ ] Streaming support in `sendPrompt()` via `includePartialMessages`
- [ ] Event handler registration via `onConversationEvent()`
- [ ] Unit tests for all event mappings

### Phase 3: Tool Integration
**Scope:** Domain tools → MCP servers, built-in tool configuration
**Dependencies:** Phase 2  

**Deliverables:**
- [ ] `tool-factory.ts` — `ToolDefinition[]` → `createSdkMcpServer()`
- [ ] Built-in tool passthrough configuration
- [ ] Tool event correlation (start/complete)
- [ ] Unit tests for tool wrapping

### Phase 4: Session Management
**Scope:** Full session lifecycle, SessionAllocator integration
**Dependencies:** Phase 3  

**Deliverables:**
- [ ] `session-manager.ts` — create/resume/fork/delete/list
- [ ] SessionAllocator integration for all 3 modes
- [ ] Chat session lifecycle
- [ ] Unit + integration tests

### Phase 5: Hooks & Permissions
**Scope:** Hook bridge, permission mapping, HITL support
**Dependencies:** Phase 4  

**Deliverables:**
- [ ] `hook-bridge.ts` — domain hooks → SDK hooks
- [ ] `permission-mapper.ts` — permission mode translation
- [ ] HITL permission flow (EventBus → SSE → API → response)
- [ ] Unit tests

### Phase 6: CLI & Web Integration
**Scope:** CLI DirectPlatformClient, web UI updates, e2e tests
**Dependencies:** Phase 5  

**Deliverables:**
- [ ] CLI `createClient()` support for `claude-agent`
- [ ] Web Settings page: harness selector
- [ ] Web Run page: cost display
- [ ] E2E test suite
- [ ] Documentation updates

### Phase 7: Advanced Features (Optional)
**Scope:** Subagent UI, structured output, cost dashboards
**Dependencies:** Phase 6  

**Deliverables:**
- [ ] Subagent progress tracking in web UI
- [ ] Structured output support in stage definitions
- [ ] Cost tracking dashboard
- [ ] Per-workflow harness override
- [ ] Session fork UI

---

## 19. Open Questions

| # | Question | Impact | Options |
|---|---|---|---|
| 1 | Should we support the V2 preview session API (`unstable_v2_createSession`)? | Medium | a) Wait for stable release, b) Implement behind feature flag |
| 2 | How should we handle Claude Agent SDK's built-in tool output in artifact extraction? | High | a) Parse from event content blocks, b) Hook into PostToolUse for Write/Edit |
| 3 | Should `maxBudgetUsd` be configurable per-stage or per-workflow-run? | Medium | a) Per-run only, b) Both (stage overrides run default) |
| 4 | Do we need a model discovery API, or is a hardcoded list sufficient? | Low | a) Hardcoded, b) Fetch from Anthropic API, c) Config-driven |
| 5 | How should we handle the Claude Code binary size (~200MB)? | Medium | a) Accept as dependency, b) Make it a devDependency, c) Document minimum requirements |
| 6 | Should sessions persist across server restarts (using SessionStore)? | High | a) Disk persistence (default), b) SQLite-backed SessionStore adapter, c) Both |
| 7 | How to handle concurrent `query()` calls (multiple stages in parallel)? | High | a) One subprocess per query (SDK default), b) Pool with `startup()` pre-warm |
| 8 | Should we expose Claude Agent SDK-specific features (subagents, skills) in the web UI? | Medium | a) Phase 7, b) Not in v1 scope |

---

## Appendix A: Key Source Files to Create

| File | Package | Purpose |
|---|---|---|
| `packages/claude-agent-bridge/package.json` | claude-agent-bridge | Package manifest |
| `packages/claude-agent-bridge/tsconfig.json` | claude-agent-bridge | TypeScript config |
| `packages/claude-agent-bridge/src/index.ts` | claude-agent-bridge | Public API barrel |
| `packages/claude-agent-bridge/src/ClaudeAgentAdapter.ts` | claude-agent-bridge | Main ICopilotPort impl |
| `packages/claude-agent-bridge/src/event-mapper.ts` | claude-agent-bridge | Message → AgentEvent |
| `packages/claude-agent-bridge/src/tool-factory.ts` | claude-agent-bridge | Tools → MCP server |
| `packages/claude-agent-bridge/src/session-manager.ts` | claude-agent-bridge | Session lifecycle |
| `packages/claude-agent-bridge/src/hook-bridge.ts` | claude-agent-bridge | Hooks translation |
| `packages/claude-agent-bridge/src/permission-mapper.ts` | claude-agent-bridge | Permissions translation |
| `packages/claude-agent-bridge/src/types.ts` | claude-agent-bridge | Type definitions |

## Appendix B: Key Source Files to Modify

| File | Package | Change |
|---|---|---|
| `apps/server/src/composition-root.ts` | server | Add `claude-agent` harness case |
| `apps/cli/src/platform/createClient.ts` | cli | Add `claude-agent` client creation |
| `packages/shared/src/config/index.ts` | shared | Add `claudeAgentHarnessSchema` |
| `packages/shared/src/types/AgentEvent.ts` | shared | (Optional) Add new event kinds |
| `pnpm-workspace.yaml` | root | Add `claude-agent-bridge` |
| `turbo.json` | root | Add to build pipeline |
| `apps/web/src/pages/Settings.tsx` | web | Add harness type selector |
| `apps/web/src/components/workflow/StageRunView.tsx` | web | Show cost/turns if available |

---

---

## Appendix C: Multi-Subagent Review Findings

Three review subagents analyzed this plan against the actual codebase. Below is a synthesis of all findings with dispositions.

### Critical Findings (Must Address Before Phase 1)

| ID | Finding | Reviewer | Severity | Disposition |
|---|---|---|---|---|
| **R-01** | **Async Iterator → Callback Bridge.** `StageExecutionService` uses `onConversationEvent()` callbacks (push model). Claude Agent SDK uses `query()` async iterators (pull model). The adapter must internally consume the iterator and push events to registered handlers. | StageExecution Reviewer | CRITICAL | **Accepted.** `ClaudeAgentAdapter.sendPrompt()` must spawn a background async task that iterates `query()` and calls registered event handlers. Add to Phase 2 design. |
| **R-02** | **Session Config Timing.** `SessionAllocator` calls `createConversation()` once per allocation. In single-session mode, stages 2+ reuse the session without re-applying config (maxTurns, effort, etc.). Claude Agent SDK passes config per `query()` call — must reconcile. | StageExecution Reviewer | HIGH | **Accepted.** Store per-stage config overrides in the session manager. When `sendPrompt()` is called, merge stored session config with any stage-level overrides and pass to `query()`. |
| **R-03** | **Client State Polling.** Existing `CopilotAdapter` polls client health every 5 seconds. Claude Agent SDK is stateless (subprocess per query). Plan doesn't specify health tracking. | Interface Reviewer | HIGH | **Accepted.** Track success/failure of last N queries. Return `'running'` when queries succeed, `'error'` after consecutive failures. Add `startup()` pre-warm as optional health check. |
| **R-04** | **Built-in Tool Output Not Captured.** Current artifact extraction only parses fenced code blocks from assistant message text. Claude Agent SDK's `Write`/`Edit` built-in tools produce output in `ToolResultBlock`, not as fenced blocks. | StageExecution Reviewer | HIGH | **Accepted.** Extend event-mapper to emit `copilot.tool_complete` events with structured metadata for Write/Edit tools. Extend `StageExecutionService.persistStageArtifacts()` to also extract artifacts from tool result metadata. Add to Phase 3. |
| **R-05** | **Cost/Budget Persistence.** Plan mentions showing cost in the UI and `maxBudgetUsd` config but doesn't define where/how costs are persisted or how budget is enforced. | SSE/Streaming Reviewer | HIGH | **Accepted.** Store per-stage costs in `stage_runs.metadata` JSON field. Per-run cost = sum of stages. `maxBudgetUsd` enforced by Claude Agent SDK natively via `query()` option. Add cost display via `harness.usage` event in `streamStore`. |

### Medium-Priority Findings (Address in Phase 2-3)

| ID | Finding | Reviewer | Severity | Disposition |
|---|---|---|---|---|
| **R-06** | Listener leak detection missing. `CopilotAdapter` warns when >50 handlers accumulate per conversation (ORC-05). Adapter must replicate. | Interface Reviewer | MEDIUM | Add to Phase 1. Track handler count per conversationId. |
| **R-07** | `harness.turn_start` / `harness.turn_end` events exist but plan doesn't map them. Used by web streamStore for chat dedup. | SSE/Streaming Reviewer | MEDIUM | Map Claude Agent SDK turn boundaries (each message in the iterator) to these events. |
| **R-08** | `harness.user_message` event not mentioned. Stores expect it when user sends a prompt. | SSE/Streaming Reviewer | MEDIUM | Emit `harness.user_message` from `sendPrompt()` before starting `query()`. |
| **R-09** | Error subtype encoding missing. `harness.error` event only has `message: string` — plan lists `error_max_turns`, `error_max_budget` etc. but no encoding strategy. | SSE/Streaming Reviewer | MEDIUM | Encode as `{ message: string, errorType: 'max_turns'|'max_budget'|'execution', provider: 'claude-agent' }`. Extend `harness.error` data shape. |
| **R-10** | HITL state machine transition not detailed. `running → awaiting_input` triggered by `sys:input_request`. Plan's `PermissionRequest` hook must trigger this transition. | StageExecution Reviewer | MEDIUM | In `hook-bridge.ts`, emit `stage_run.permission_requested` event which triggers `StageExecutionService` state transition logic. |
| **R-11** | Context passing between stages — `predecessorSummaries` parameter exists on `executeStage()` but injection into prompt not verified. | StageExecution Reviewer | MEDIUM | This is pre-existing (works same for both SDKs). Verify implementation in non-visible portion of `executeStage()`. No plan change needed. |

### Low-Priority / Confirmed Findings

| ID | Finding | Status |
|---|---|---|
| **R-12** | EventBus is fully provider-agnostic. No changes needed. | ✅ Confirmed |
| **R-13** | StreamBroker is fully provider-agnostic. No changes needed. | ✅ Confirmed |
| **R-14** | SSE pipeline + sseManager cross-buffer flush will work correctly if adapter preserves SDK event ordering. | ✅ Confirmed — adapter must emit events in iterator order |
| **R-15** | All Zustand stores consume `harness.*` events — 12/12 mapped correctly. | ✅ Confirmed |
| **R-16** | Last-Event-ID replay works with monotonic sequenceIds from EventBus. | ✅ Confirmed |
| **R-17** | DAG Scheduler is completely adapter-agnostic. No changes needed. | ✅ Confirmed |
| **R-18** | Composition root pattern is correct and compatible. | ✅ Confirmed |
| **R-19** | Config schema extension is straightforward. | ✅ Confirmed |
| **R-20** | All 16 ICopilotPort methods correctly mapped in plan. | ✅ Confirmed (100% interface accuracy) |

### Revised Phase 1 Scope (Post-Review)

Based on the review, Phase 1 must additionally include:

1. **Async iterator → callback bridge** (R-01) — Core adapter pattern
2. **Client health tracking** (R-03) — Query success/failure tracking
3. **Listener leak detection** (R-06) — ORC-05 compliance
4. **`harness.user_message` emission** (R-08) — Store compatibility

### Review Verdict

> **Plan is architecturally sound.** All 3 reviewers confirmed the port/adapter approach works, no breaking changes to EventBus/StreamBroker/SSE/Zustand stores are needed, and all 16 ICopilotPort methods map correctly. The 5 critical/high findings are implementation details within the adapter, not architectural blockers. The plan can proceed to Phase 1 implementation after incorporating these findings.

---

*End of Plan — Version 1.1 (Post-Review)*
