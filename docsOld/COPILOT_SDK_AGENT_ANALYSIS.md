# Copilot SDK & Autonomous AI Agent Integration Analysis

## Executive Summary

This document provides a comprehensive technical analysis of the GitHub Copilot SDK (Node.js), Copilot CLI, and modern AI coding agent architectures (Claude Code, Gemini CLI). The goal is to inform the design of an autonomous AI agent built on top of the Copilot SDK.

**Key Findings:**
- The Copilot SDK is a **thin client** that wraps the Copilot CLI process via JSON-RPC (stdio or TCP)
- The SDK manages CLI process lifecycle automatically; no need to build custom orchestration
- Streaming, custom tools, MCP servers, and custom agents are all first-class features
- Session persistence enables multi-turn, resumable conversations
- The architecture is remarkably similar to what Claude Code and Gemini CLI independently converged on

**Status:** The Copilot SDK is in **Technical Preview** and may have breaking changes.

---

## 1. Copilot SDK Node.js API Surface

### 1.1 Core Classes & Interfaces

| Class/Interface | Purpose |
|---|---|
| `CopilotClient` | Main entry point. Manages CLI process lifecycle and session creation |
| `CopilotSession` | Represents a conversation session. Sends prompts, receives events |
| `SessionEvent` | Discriminated union type for all events emitted by a session |
| `SessionConfig` | Configuration for creating sessions (model, tools, streaming, etc.) |
| `CopilotClientOptions` | Configuration for the client (CLI path, transport, ports, etc.) |
| `Tool` / `defineTool` | Helper for defining custom tools with type-safe schemas |
| `ToolResultObject` | Structured return type for tool handlers |

### 1.2 Client Configuration Options (`CopilotClientOptions`)

```typescript
const client = new CopilotClient({
  cliPath: string,       // Path to CLI executable (default: "copilot" from PATH)
  cliArgs: string[],     // Extra arguments prepended before SDK-managed flags
  cliUrl: string,        // URL of existing CLI server (e.g., "localhost:8080")
  port: number,          // Server port (default: 0 for random)
  useStdio: boolean,     // Use stdio transport instead of TCP (default: true)
  logLevel: string,      // Log level (default: "debug")
  autoStart: boolean,    // Auto-start server (default: true)
  autoRestart: boolean,  // Auto-restart on crash (default: true)
  cwd: string,           // Working directory for the CLI process
  env: object,           // Environment variables for the CLI process
});
```

### 1.3 Session Configuration Options (`SessionConfig`)

```typescript
const session = await client.createSession({
  sessionId: string,              // Custom session ID for persistence
  model: string,                  // "gpt-4.1", "claude-sonnet-4.5", etc.
  tools: Tool[],                  // Custom tool definitions
  systemMessage: SystemMessageConfig, // System prompt customization
  availableTools: string[],       // Allowlist of tool names
  excludedTools: string[],        // Blocklist of tool names
  provider: ProviderConfig,       // Custom API provider (BYOK)
  streaming: boolean,             // Enable streaming response chunks
  mcpServers: MCPServerConfig[],  // MCP server connections
  customAgents: CustomAgentConfig[], // Custom agent personas
  configDir: string,              // Config directory override
  skillDirectories: string[],     // Skill directories
  disabledSkills: string[],       // Disabled skills
  onPermissionRequest: PermissionHandler, // Permission request handler
});
```

### 1.4 Session Operations

```typescript
// Core operations
session.sessionId: string;                                          // Get session ID
await session.send({ prompt: "...", attachments: [...] });         // Send message (fire-and-forget)
await session.sendAndWait({ prompt: "..." }, timeout);             // Send and wait for idle
await session.abort();                                              // Abort current processing
await session.getMessages(): Promise<SessionEvent[]>;              // Get all events
await session.destroy();                                            // Clean up session

// Event subscription
const unsubscribe = session.on((event: SessionEvent) => { ... }); // Subscribe to events
unsubscribe();                                                      // Unsubscribe
```

### 1.5 Client Lifecycle Operations

```typescript
await client.start();                                    // Start CLI process
await client.stop();                                     // Graceful shutdown
await client.forceStop();                                // Force shutdown
const state = client.getState();                         // "disconnected" | "connecting" | "connected" | "error"
const response = await client.ping("health check");      // Connectivity test
const models = await client.getModels();                 // List available models
const sessions = await client.listSessions();            // List all sessions
await client.deleteSession(sessionId);                   // Delete a session
const lastId = await client.getLastSessionId();          // Get last session ID
const session = await client.resumeSession(sessionId);   // Resume session
```

### 1.6 Creating Sessions (Quick Start)

```typescript
import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient();
const session = await client.createSession({ model: "gpt-4.1" });

const response = await session.sendAndWait({ prompt: "What is 2 + 2?" });
console.log(response?.data.content);

await client.stop();
```

### 1.7 Streaming Responses

```typescript
import { CopilotClient, SessionEvent } from "@github/copilot-sdk";

const client = new CopilotClient();
const session = await client.createSession({
  model: "gpt-4.1",
  streaming: true,
});

session.on((event: SessionEvent) => {
  if (event.type === "assistant.message_delta") {
    process.stdout.write(event.data.deltaContent);
  }
  if (event.type === "session.idle") {
    console.log(); // New line when done
  }
});

await session.sendAndWait({ prompt: "Tell me a short joke" });
await client.stop();
```

### 1.8 Custom Tools (with JSON Schema and Zod)

**JSON Schema approach:**
```typescript
import { CopilotClient, defineTool, SessionEvent } from "@github/copilot-sdk";

const getWeather = defineTool("get_weather", {
  description: "Get the current weather for a city",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "The city name" },
    },
    required: ["city"],
  },
  handler: async (args: { city: string }) => {
    return { city: args.city, temperature: "72°F", condition: "sunny" };
  },
});

const session = await client.createSession({
  model: "gpt-4.1",
  streaming: true,
  tools: [getWeather],
});
```

**Zod schema approach:**
```typescript
import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";

const session = await client.createSession({
  tools: [
    defineTool({
      name: "get_weather",
      description: "Get weather for a location",
      parameters: z.object({
        location: z.string().describe("City name"),
        units: z.enum(["celsius", "fahrenheit"]).optional(),
      }),
      handler: async (args) => {
        return { temperature: 72, units: args.units || "fahrenheit" };
      },
    }),
  ],
});
```

**Tool Return Types:**
```typescript
// Simple: return any JSON-serializable value (automatically wrapped)
// Advanced: return ToolResultObject for full control
{
  textResultForLlm: string;                    // Result shown to LLM
  resultType: "success" | "failure";
  error?: string;                               // Internal error (not shown to LLM)
  toolTelemetry?: Record<string, unknown>;
}
```

### 1.9 File Attachments

```typescript
await session.send({
  prompt: "Analyze this file",
  attachments: [{
    type: "file",
    path: "./data.csv",
    displayName: "Sales Data"
  }]
});
```

### 1.10 System Message Customization

```typescript
// Append mode (preserves guardrails) - RECOMMENDED
const session = await client.createSession({
  model: "gpt-4.1",
  systemMessage: {
    mode: "append",
    content: `<workflow_rules>
- Always check for security vulnerabilities
- Suggest performance improvements when applicable
</workflow_rules>`,
  },
});

// Replace mode (full control, removes guardrails)
const session = await client.createSession({
  model: "gpt-4.1",
  systemMessage: {
    mode: "replace",
    content: "You are a helpful assistant.",
  },
});
```

### 1.11 MCP Server Integration

```typescript
const session = await client.createSession({
  model: "gpt-4.1",
  mcpServers: {
    github: {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
    },
  },
});
```

### 1.12 Custom Agents

```typescript
const session = await client.createSession({
  model: "gpt-4.1",
  customAgents: [{
    name: "pr-reviewer",
    displayName: "PR Reviewer",
    description: "Reviews pull requests for best practices",
    prompt: "You are an expert code reviewer. Focus on security, performance, and maintainability.",
  }],
});
```

### 1.13 BYOK (Bring Your Own Key)

```typescript
const session = await client.createSession({
  provider: {
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "your-api-key",
  },
});
```

---

## 2. Copilot CLI Commands & Capabilities

### 2.1 Modes of Operation

| Mode | Command | Description |
|---|---|---|
| **Interactive** | `copilot` | Full conversational interface with ask/execute and plan modes |
| **Programmatic** | `copilot -p "prompt"` | Single-shot prompt, completes and exits |
| **Server** | `copilot --server --port 4321` | Runs as a background server for SDK connections |

### 2.2 Key CLI Flags

| Flag | Description |
|---|---|
| `-p` / `--prompt` | Run a single prompt programmatically |
| `--server` | Run in server mode |
| `--port` | Specify server port |
| `--model` | Select model |
| `--allow-all-tools` | Allow all tools without approval |
| `--allow-tool 'NAME'` | Allow specific tool (e.g., `'shell(git)'`, `'write'`, `'MCP_SERVER'`) |
| `--deny-tool 'NAME'` | Deny specific tool (takes precedence) |

### 2.3 Interactive Slash Commands

| Command | Description |
|---|---|
| `/compact` | Manually compress conversation context |
| `/context` | Show token usage breakdown |
| `/model` | Change the model |
| `/mcp` | List MCP servers |
| `/allow-all` | Allow all tools |
| `/feedback` | Submit feedback |

### 2.4 Tool Approval Syntax

```bash
# Allow specific commands
copilot --allow-tool 'shell(git)'
copilot --allow-tool 'shell(git diff)'

# Allow file writes
copilot --allow-tool 'write'

# Allow MCP server tools
copilot --allow-tool 'My-MCP-Server'
copilot --allow-tool 'My-MCP-Server(tool_name)'

# Combine: allow everything except rm and git push
copilot --allow-all-tools --deny-tool 'shell(rm)' --deny-tool 'shell(git push)'
```

### 2.5 Copilot CLI Capabilities

**Local tasks:**
- Edit code in projects, make CSS/JS changes
- Run Git operations (commit, revert, branch)
- Scaffold entire applications from scratch
- Analyze, debug, and improve code
- Rewrite documentation

**GitHub.com tasks:**
- List open PRs and issues
- Create branches from issues
- Create PRs with file changes
- Create issues
- Review PR changes for errors
- Merge/close PRs
- Create GitHub Actions workflows

### 2.6 Context Management

- **Auto-compaction:** At ~95% of token limit, conversation history is compressed automatically
- **Manual compaction:** `/compact` command
- **Context visualization:** `/context` shows token usage breakdown
- **Effectively infinite sessions** through auto-compaction

### 2.7 ACP (Agent Client Protocol)

Copilot CLI supports ACP, an open standard for interacting with AI agents, enabling use in third-party tools, IDEs, or automation systems.

---

## 3. Integration Architecture

### 3.1 SDK Architecture Overview

```
┌─────────────────────────┐
│   Your Application      │
│  (Node.js / TypeScript)  │
└───────────┬─────────────┘
            │ SDK Client (async API)
            │
┌───────────▼─────────────┐
│   CopilotClient         │
│   - Process management  │
│   - Session management  │
│   - Event routing       │
└───────────┬─────────────┘
            │ JSON-RPC (stdio or TCP)
            │
┌───────────▼─────────────┐
│   Copilot CLI            │
│   (server mode)          │
│   - Agent runtime        │
│   - Planning & reasoning │
│   - Tool invocation      │
│   - File edits           │
└───────────┬─────────────┘
            │ HTTPS
            │
┌───────────▼─────────────┐
│   GitHub                 │
│   (models, auth, APIs)   │
└─────────────────────────┘
```

### 3.2 Pattern: Creating and Managing Multiple Concurrent Sessions

```typescript
import { CopilotClient } from "@github/copilot-sdk";

class AgentSessionManager {
  private client: CopilotClient;
  private sessions = new Map<string, CopilotSession>();

  constructor() {
    this.client = new CopilotClient({
      autoStart: true,
      autoRestart: true,
    });
  }

  async initialize() {
    await this.client.start();
  }

  async createAgentSession(agentId: string, config: Partial<SessionConfig>) {
    const session = await this.client.createSession({
      sessionId: `agent-${agentId}-${Date.now()}`,
      model: "gpt-4.1",
      streaming: true,
      ...config,
    });
    this.sessions.set(agentId, session);
    return session;
  }

  // Sessions are independent and can run concurrently
  async runParallel(tasks: Array<{ agentId: string; prompt: string }>) {
    return Promise.all(
      tasks.map(({ agentId, prompt }) => {
        const session = this.sessions.get(agentId);
        return session?.sendAndWait({ prompt });
      })
    );
  }

  async shutdown() {
    for (const [id, session] of this.sessions) {
      await session.destroy();
    }
    await this.client.stop();
  }
}
```

**Key insight from the SDK docs:** Sessions are independent and can run concurrently on a single client. The SDK manages the underlying CLI process lifecycle.

```typescript
// From SDK documentation - native concurrency:
const session1 = await client.createSession({ model: "gpt-4.1" });
const session2 = await client.createSession({ model: "claude-sonnet-4.5" });

await Promise.all([
  session1.send({ prompt: "Hello from session 1" }),
  session2.send({ prompt: "Hello from session 2" }),
]);
```

### 3.3 Pattern: Streaming Responses to a UI Layer

```typescript
import { CopilotClient, SessionEvent } from "@github/copilot-sdk";
import { EventEmitter } from "events";

class StreamingBridge extends EventEmitter {
  private session: CopilotSession;

  constructor(session: CopilotSession) {
    super();
    this.session = session;
    this.setupEventForwarding();
  }

  private setupEventForwarding() {
    this.session.on((event: SessionEvent) => {
      switch (event.type) {
        case "assistant.message_delta":
          // Forward incremental text to UI
          this.emit("text-delta", event.data.deltaContent);
          break;
        case "assistant.reasoning_delta":
          // Forward reasoning tokens (model-dependent)
          this.emit("reasoning-delta", event.data.deltaContent);
          break;
        case "assistant.message":
          // Final complete message
          this.emit("message-complete", event.data.content);
          break;
        case "tool.execution_start":
          this.emit("tool-start", event);
          break;
        case "tool.execution_complete":
          this.emit("tool-complete", event);
          break;
        case "session.idle":
          this.emit("idle");
          break;
        case "session.error":
          this.emit("error", event.data.message);
          break;
      }
    });
  }

  async send(prompt: string, attachments?: any[]) {
    return this.session.sendAndWait({ prompt, attachments });
  }
}

// Usage with WebSocket (example)
wss.on("connection", async (ws) => {
  const session = await client.createSession({ model: "gpt-4.1", streaming: true });
  const bridge = new StreamingBridge(session);

  bridge.on("text-delta", (delta) => ws.send(JSON.stringify({ type: "delta", text: delta })));
  bridge.on("tool-start", (ev) => ws.send(JSON.stringify({ type: "tool-start", ...ev })));
  bridge.on("idle", () => ws.send(JSON.stringify({ type: "done" })));
});
```

### 3.4 Pattern: Sending Attachments/Context to Copilot

```typescript
// File attachments
await session.send({
  prompt: "Analyze this file",
  attachments: [{
    type: "file",
    path: "./data.csv",
    displayName: "Sales Data"
  }]
});

// Rich context via system message
const session = await client.createSession({
  model: "gpt-4.1",
  systemMessage: {
    mode: "append",
    content: `
<project_context>
  <tech_stack>React, TypeScript, Node.js, PostgreSQL</tech_stack>
  <coding_standards>Follow eslint-config-airbnb. Use functional components with hooks.</coding_standards>
  <current_task>Implementing user authentication flow</current_task>
</project_context>`,
  },
});

// Context via MCP servers (live data)
const session = await client.createSession({
  model: "gpt-4.1",
  mcpServers: {
    github: {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
    },
    database: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres", connectionString],
    },
  },
});

// Message delivery modes
await session.send({
  prompt: "Next task instructions...",
  mode: "enqueue",    // Queue for processing (or "immediate")
});
```

### 3.5 Pattern: Using Skills and Tools

```typescript
// Custom tools
const codeAnalyzer = defineTool("analyze_code", {
  description: "Analyze code for patterns and issues",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Path to the file" },
      analysisType: { type: "string", enum: ["security", "performance", "style"] },
    },
    required: ["filePath", "analysisType"],
  },
  handler: async (args) => {
    // Your custom analysis logic
    return { issues: [], score: 95 };
  },
});

// Use skills and MCP server tools together
const session = await client.createSession({
  model: "gpt-4.1",
  tools: [codeAnalyzer],
  mcpServers: {
    github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
  },
  availableTools: ["analyze_code", "github_*"],  // Whitelist
  excludedTools: ["dangerous_tool"],              // Blacklist
  skillDirectories: ["./skills"],
});
```

---

## 4. Event Model

### 4.1 Complete Event Type Table

| Event Type | Description | Key Data Fields |
|---|---|---|
| `user.message` | User input added to session | Content of the message |
| `assistant.message` | Complete model response (always sent) | `data.content` (full text) |
| `assistant.message_delta` | Streaming response chunk | `data.deltaContent` (incremental text) |
| `assistant.reasoning` | Model reasoning (model-dependent) | `data.content` |
| `assistant.reasoning_delta` | Streaming reasoning chunk | `data.deltaContent` |
| `tool.execution_start` | Tool invocation started | Tool name, parameters |
| `tool.execution_complete` | Tool execution finished | Tool result |
| `session.start` | Session began | Session metadata |
| `session.idle` | No active processing (turn complete) | — |
| `session.error` | Error occurred | `data.message` |

### 4.2 Event Subscription Pattern

```typescript
// Subscribe with callback, returns unsubscribe function
const unsubscribe = session.on((event: SessionEvent) => {
  // Handle event
});

// Use Promise wrapper for async/await flow control
await new Promise<void>((resolve, reject) => {
  const unsubscribe = session.on((event) => {
    if (event.type === "assistant.message") {
      console.log(event.data.content);
    } else if (event.type === "session.idle") {
      unsubscribe();
      resolve();
    } else if (event.type === "session.error") {
      unsubscribe();
      reject(new Error(event.data.message));
    }
  });
  session.send({ prompt: "..." });
});
```

### 4.3 TypeScript Type Safety

```typescript
import type { SessionEvent, AssistantMessageEvent } from "@github/copilot-sdk";

// Discriminated union narrows types automatically
session.on((event: SessionEvent) => {
  if (event.type === "assistant.message") {
    // TypeScript knows event is AssistantMessageEvent here
    const content: string = event.data.content;
  }
});

// Generic helper for waiting on specific events
async function waitForEvent<T extends SessionEvent["type"]>(
  session: CopilotSession,
  eventType: T,
): Promise<Extract<SessionEvent, { type: T }>> {
  return new Promise((resolve) => {
    const unsubscribe = session.on((event) => {
      if (event.type === eventType) {
        unsubscribe();
        resolve(event as Extract<SessionEvent, { type: T }>);
      }
    });
  });
}

const message = await waitForEvent(session, "assistant.message");
console.log(message.data.content);
```

### 4.4 Important Event Behavior Notes

- **`assistant.message` (final) events are ALWAYS sent** regardless of streaming setting
- When streaming is enabled, you get both `*_delta` events AND the final events
- `session.idle` signals that the turn is complete (no more events for current prompt)
- Tool execution events fire during the assistant's reasoning loop (may happen multiple times per turn)

---

## 5. Process Model

### 5.1 Architecture: SDK ↔ CLI Relationship

```
┌─────────────────────┐         ┌─────────────────────┐
│  Your Node.js App    │         │   Copilot CLI        │
│                     │         │   (child process)     │
│  CopilotClient ─────┼── JSON-RPC ──▶  Agent Runtime  │
│  - Spawns CLI       │  (stdio/TCP)  │  - LLM calls  │
│  - Sends messages   │         │  - Tool execution    │
│  - Routes events    │         │  - File operations   │
│                     │         │  - Planning          │
└─────────────────────┘         └─────────────────────┘
```

**Key facts:**
1. **The SDK spawns the Copilot CLI as a child process** (by default)
2. Communication is via **JSON-RPC over stdio** (default) or **TCP**
3. The SDK manages the CLI process lifecycle automatically (start, restart, stop)
4. When `autoRestart: true` (default), the SDK automatically restarts the CLI on crashes
5. When `cliUrl` is provided, the SDK connects to an **existing** CLI server instead of spawning one

### 5.2 Transport Modes

| Mode | Flag | Description |
|---|---|---|
| **stdio** (default) | `useStdio: true` | JSON-RPC over stdin/stdout of child process |
| **TCP** | `useStdio: false` | JSON-RPC over TCP socket to CLI server |
| **External Server** | `cliUrl: "localhost:4321"` | Connect to pre-existing CLI instance |

### 5.3 External Server Mode

For resource sharing, debugging, or custom environments, run CLI separately:

```bash
# Start CLI in server mode
copilot --server --port 4321
```

```typescript
// SDK connects without spawning a process
const client = new CopilotClient({ cliUrl: "localhost:4321" });
const session = await client.createSession({ model: "gpt-4.1" });
```

**Important:** When `cliUrl` is provided, the SDK will NOT spawn or manage a CLI process.

### 5.4 Process Lifecycle

```typescript
// Manual control
const client = new CopilotClient({ autoStart: false });
await client.start();    // Explicitly start CLI
// ... use client ...
await client.stop();     // Graceful shutdown
await client.forceStop(); // When stop() takes too long

// Connection state monitoring
const state = client.getState();
// Returns: "disconnected" | "connecting" | "connected" | "error"

// Health check
const response = await client.ping("health check");
```

---

## 6. Best Practices (from Official Documentation)

### 6.1 SDK Best Practices

1. **Always cleanup:** Use `try-finally` to ensure `client.stop()` is called
2. **Set timeouts:** Use `sendAndWait` with timeout for long operations
3. **Handle events:** Subscribe to error events for robust error handling
4. **Use streaming:** Enable streaming for better UX on long responses
5. **Persist sessions:** Use custom session IDs for multi-turn conversations
6. **Define clear tools:** Write descriptive tool names and descriptions
7. **Use `defineTool`** for type-safe tool definitions
8. **Use Zod schemas** for runtime parameter validation
9. **Dispose event subscriptions** when no longer needed
10. **Use `systemMessage` with `mode: "append"`** to preserve safety guardrails
11. **Handle both delta and final events** when streaming is enabled

### 6.2 Resource Cleanup Pattern (Recommended)

```typescript
async function withClient<T>(fn: (client: CopilotClient) => Promise<T>): Promise<T> {
  const client = new CopilotClient();
  try {
    await client.start();
    return await fn(client);
  } finally {
    await client.stop();
  }
}

async function withSession<T>(
  client: CopilotClient,
  fn: (session: CopilotSession) => Promise<T>,
): Promise<T> {
  const session = await client.createSession();
  try {
    return await fn(session);
  } finally {
    await session.destroy();
  }
}

// Usage
await withClient(async (client) => {
  await withSession(client, async (session) => {
    await session.send({ prompt: "Hello!" });
  });
});
```

### 6.3 Graceful Shutdown Pattern

```typescript
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await client.stop();
  process.exit(0);
});
```

### 6.4 Error Handling Pattern

```typescript
try {
  const client = new CopilotClient();
  const session = await client.createSession({ model: "gpt-4.1" });
  const response = await session.sendAndWait(
    { prompt: "Hello!" },
    30000 // timeout in ms
  );
} catch (error) {
  if (error.code === "ENOENT") {
    console.error("Copilot CLI not installed");
  } else if (error.code === "ECONNREFUSED") {
    console.error("Cannot connect to Copilot server");
  } else {
    console.error("Error:", error.message);
  }
} finally {
  await client.stop();
}
```

### 6.5 Session Persistence Pattern

```typescript
// Create with custom ID
const session = await client.createSession({
  sessionId: "user-123-conversation",
  model: "gpt-4.1"
});

// Resume later
const session = await client.resumeSession("user-123-conversation");
await session.send({ prompt: "What did we discuss earlier?" });

// List and clean up
const sessions = await client.listSessions();
await client.deleteSession("old-session-id");
```

### 6.6 Abort Pattern

```typescript
const timeoutId = setTimeout(() => {
  session.abort();
}, 60000);

session.on((event) => {
  if (event.type === "session.idle") {
    clearTimeout(timeoutId);
  }
});
```

---

## 7. Comparative Analysis: Modern AI Coding Agent Architectures

### 7.1 Architecture Comparison Table

| Feature | Copilot SDK | Claude Code | Gemini CLI |
|---|---|---|---|
| **Language** | TS/Python/Go/.NET | TS (core), Python/TS (Agent SDK) | TypeScript (98%) |
| **Process model** | SDK spawns CLI child process | CLI process, Agent SDK wraps it | Direct CLI process |
| **Communication** | JSON-RPC (stdio/TCP) | CLI stdio, stream-json output | Direct API calls |
| **Streaming** | Event callbacks (`session.on`) | `--output-format stream-json` | `--output-format stream-json` |
| **Tool system** | Custom tools + MCP | Built-in tools + MCP | Built-in tools + MCP |
| **Session persistence** | Custom session IDs + resume | Session ID + `--continue`/`--resume` | Conversation checkpointing |
| **Multi-agent** | Custom agents per session | Subagents (foreground/background) | N/A (single agent) |
| **Context mgmt** | Auto-compaction at ~95% | Auto-compaction at ~95% | Token caching, 1M context |
| **Programmatic** | Full SDK API | `-p` flag + Agent SDK (Python/TS) | `-p` flag + `--output-format json` |
| **Server mode** | `copilot --server` | N/A (uses subprocess) | N/A |
| **Open source** | SDK in preview | Closed source (open repo/plugins) | Apache 2.0 (fully open) |
| **License** | GitHub Copilot subscription | Anthropic subscription | Free tier + paid |

### 7.2 Claude Code Architecture Patterns

**Key architectural insights from Claude Code:**

1. **Subagent Pattern:** Claude Code pioneered a sophisticated subagent system:
   - Built-in subagents: Explore (read-only, Haiku model), Plan (structured planning), General-purpose
   - Custom subagents: Defined as Markdown files with YAML frontmatter
   - Foreground (blocking) vs Background (concurrent) execution
   - Each subagent runs in its own context window with custom system prompt
   - Subagents CAN'T spawn other subagents (prevents recursion)

2. **Agent Teams:** For sustained parallelism, separate sessions coordinate:
   - Each worker has an independent context window
   - Overcomes single-session context limits
   - Workers communicate through the orchestrator

3. **Headless/SDK Mode:**
   - CLI flag `-p` runs non-interactively
   - `--output-format stream-json` for real-time event streaming
   - `--output-format json` for structured responses with `--json-schema`
   - Session continuation with `--continue` and `--resume`
   - Full Agent SDK available in Python and TypeScript

4. **Hook System:** Lifecycle hooks at key execution points:
   - `PreToolUse` / `PostToolUse` for validation and logging
   - `SubagentStart` / `SubagentStop` for agent lifecycle
   - `Stop` for cleanup

5. **Permission Model:**
   - Tool-level granular permissions: `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`
   - Permission modes: `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan`
   - Subagents inherit parent permissions but can restrict further

6. **Memory System:**
   - Persistent memory scoped to `user`, `project`, or `local`
   - Stored as files in `~/.claude/agent-memory/` or `.claude/agent-memory/`
   - Subagents can build knowledge bases across sessions

### 7.3 Gemini CLI Architecture Patterns

**Key architectural insights from Gemini CLI:**

1. **Monorepo TypeScript Architecture:** 98.2% TypeScript, organized in `packages/` directory
2. **Built-in Tools:** Google Search grounding, file ops, shell commands, web fetching
3. **Multimodal Input:** Can generate apps from PDFs, images, or sketches
4. **Headless Mode:** `-p` flag + `--output-format json|stream-json` for automation
5. **Checkpointing:** Save and resume complex sessions
6. **Context Files:** `GEMINI.md` files for persistent project context
7. **Custom Commands:** Reusable command definitions
8. **GitHub Action:** Official `google-github-actions/run-gemini-cli` for CI/CD
9. **MCP Integration:** Configure MCP servers in `~/.gemini/settings.json`

### 7.4 Common Patterns Across All Three Agents

All three agents have independently converged on remarkably similar patterns:

1. **CLI-first with SDK wrapper:** All provide a CLI as the core agent and programmatic access via SDKs or flags
2. **MCP for extensibility:** All support MCP (Model Context Protocol) servers for custom tool integration
3. **Streaming JSON for programmatic use:** All use newline-delimited JSON for real-time event streaming
4. **Session persistence:** All support saving and resuming conversations
5. **Auto-compaction/context management:** Automatic context window management for long sessions
6. **Custom instructions:** Project-level instruction files (`.copilot-instructions`, `CLAUDE.md`, `GEMINI.md`)
7. **Tool approval model:** Granular permission systems for tool execution
8. **Headless/non-interactive mode:** `-p` flag pattern for CI/CD and scripting

---

## 8. Recommended Architecture for Autonomous Agent on Copilot SDK

### 8.1 Proposed Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Agent Orchestrator                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐  │
│  │   Planner   │  │  Executor  │  │ Context Manager│  │
│  │  (Session)  │  │ (Sessions) │  │   (Memory)     │  │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────────┘  │
│         │               │               │             │
│  ┌──────▼───────────────▼───────────────▼──────────┐  │
│  │              Session Pool Manager                │  │
│  │  - Create/resume/destroy sessions                │  │
│  │  - Route events to appropriate handlers          │  │
│  │  - Manage concurrent execution                   │  │
│  └──────────────────┬──────────────────────────────┘  │
│                     │                                  │
│  ┌──────────────────▼──────────────────────────────┐  │
│  │              Streaming Event Bus                  │  │
│  │  - Captures all SessionEvents                    │  │
│  │  - Forwards to UI / logging / analytics          │  │
│  │  - Enables real-time monitoring                  │  │
│  └──────────────────┬──────────────────────────────┘  │
└─────────────────────┼──────────────────────────────────┘
                      │
┌─────────────────────▼──────────────────────────────────┐
│                CopilotClient (SDK)                       │
│  - Manages CLI process lifecycle                        │
│  - JSON-RPC communication                               │
│  - Auto-restart on failures                             │
└─────────────────────┬──────────────────────────────────┘
                      │
┌─────────────────────▼──────────────────────────────────┐
│                Copilot CLI (server mode)                 │
│  - Agent runtime (planning, reasoning, tool execution)  │
│  - Model access (gpt-4.1, claude-sonnet-4.5, etc.)      │
│  - GitHub auth & APIs                                   │
└────────────────────────────────────────────────────────┘
```

### 8.2 Implementation Skeleton

```typescript
import { CopilotClient, CopilotSession, defineTool, SessionEvent } from "@github/copilot-sdk";
import { EventEmitter } from "events";
import { z } from "zod";

// ─── Streaming Event Bus ───
class AgentEventBus extends EventEmitter {
  forwardSessionEvents(sessionId: string, session: CopilotSession) {
    session.on((event: SessionEvent) => {
      this.emit("session-event", { sessionId, event });
      this.emit(event.type, { sessionId, ...event });
    });
  }
}

// ─── Session Pool ───
class SessionPool {
  private client: CopilotClient;
  private sessions = new Map<string, CopilotSession>();
  private eventBus: AgentEventBus;

  constructor(eventBus: AgentEventBus) {
    this.eventBus = eventBus;
    this.client = new CopilotClient({ autoStart: true, autoRestart: true });
  }

  async init() { await this.client.start(); }

  async createSession(id: string, config: SessionConfig): Promise<CopilotSession> {
    const session = await this.client.createSession({ sessionId: id, ...config });
    this.sessions.set(id, session);
    this.eventBus.forwardSessionEvents(id, session);
    return session;
  }

  async resumeSession(id: string): Promise<CopilotSession> {
    const session = await this.client.resumeSession(id);
    this.sessions.set(id, session);
    this.eventBus.forwardSessionEvents(id, session);
    return session;
  }

  get(id: string) { return this.sessions.get(id); }

  async destroyAll() {
    for (const [, session] of this.sessions) await session.destroy();
    this.sessions.clear();
    await this.client.stop();
  }
}

// ─── Agent Orchestrator ───
class AutonomousAgent {
  private pool: SessionPool;
  private eventBus: AgentEventBus;

  constructor() {
    this.eventBus = new AgentEventBus();
    this.pool = new SessionPool(this.eventBus);
  }

  async start() {
    await this.pool.init();

    // Create specialized sessions
    const planner = await this.pool.createSession("planner", {
      model: "gpt-4.1",
      streaming: true,
      systemMessage: {
        mode: "append",
        content: "You are a planning agent. Break down tasks into steps.",
      },
    });

    const executor = await this.pool.createSession("executor", {
      model: "gpt-4.1",
      streaming: true,
      tools: [this.createFileAnalyzer(), this.createTestRunner()],
      mcpServers: {
        github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      },
    });

    // Monitor all events
    this.eventBus.on("session-event", ({ sessionId, event }) => {
      console.log(`[${sessionId}] ${event.type}`);
    });
  }

  private createFileAnalyzer() {
    return defineTool("analyze_file", {
      description: "Analyze a file for issues",
      parameters: z.object({ path: z.string().describe("File path") }),
      handler: async (args) => ({ path: args.path, issues: [] }),
    });
  }

  private createTestRunner() {
    return defineTool("run_tests", {
      description: "Run test suite",
      parameters: z.object({ pattern: z.string().optional() }),
      handler: async (args) => ({ passed: 42, failed: 0 }),
    });
  }

  async executeTask(task: string) {
    // Step 1: Plan
    const plan = await this.pool.get("planner")?.sendAndWait(
      { prompt: `Plan the following task: ${task}` },
      60000
    );

    // Step 2: Execute each step
    if (plan?.data.content) {
      await this.pool.get("executor")?.sendAndWait(
        { prompt: `Execute this plan:\n${plan.data.content}` },
        120000
      );
    }
  }

  async shutdown() {
    await this.pool.destroyAll();
  }
}

// ─── Entry Point ───
const agent = new AutonomousAgent();
process.on("SIGINT", async () => { await agent.shutdown(); process.exit(0); });
await agent.start();
await agent.executeTask("Add authentication to the Express API");
await agent.shutdown();
```

### 8.3 Key Design Decisions

| Decision | Recommendation | Rationale |
|---|---|---|
| **Transport** | Use default stdio | Simplest, no port management needed |
| **Sessions** | One per "role" (planner, executor, reviewer) | Isolates context, enables parallel work |
| **Streaming** | Always enable | Essential for UI responsiveness and monitoring |
| **System message mode** | Use `append` | Preserves Copilot's built-in safety guardrails |
| **Session IDs** | Use deterministic IDs | Enables resumption after crashes |
| **Error handling** | Listen to `session.error` + try-catch | Covers both async events and synchronous errors |
| **Tools** | Use Zod for schemas | Runtime validation + TypeScript inference |
| **MCP** | Use GitHub MCP server | Access to repos, issues, PRs natively |
| **External server** | Consider for production | Allows independent scaling/debugging of CLI |

---

## 9. Resources

### Official Documentation
- **Copilot SDK Repository:** https://github.com/github/copilot-sdk
- **Getting Started Tutorial:** https://github.com/github/copilot-sdk/blob/main/docs/tutorials/first-app.md
- **Cookbook:** https://github.com/github/copilot-sdk/tree/main/cookbook
- **Samples:** https://github.com/github/copilot-sdk/tree/main/samples
- **GitHub MCP Server:** https://github.com/github/github-mcp-server
- **MCP Servers Directory:** https://github.com/modelcontextprotocol/servers

### Reference Material (Fetched & Analyzed)
- **SDK Node.js Instructions:** https://github.com/github/awesome-copilot/blob/main/instructions/copilot-sdk-nodejs.instructions.md
- **SDK Skill Documentation:** https://github.com/github/awesome-copilot/blob/main/skills/copilot-sdk/SKILL.md
- **Copilot CLI Documentation:** https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli
- **Claude Code:** https://github.com/anthropics/claude-code | https://code.claude.com/docs
- **Gemini CLI:** https://github.com/google-gemini/gemini-cli

### Comparable Agent Architectures
- **Claude Code Agent SDK:** https://platform.claude.com/docs/en/agent-sdk/overview
- **Claude Code Subagents:** https://code.claude.com/docs/en/sub-agents
- **Claude Code Headless Mode:** https://code.claude.com/docs/en/headless
- **Gemini CLI Documentation:** https://geminicli.com/docs/

---

## 10. Inaccessible Resources & Gaps

| Resource | Status | Mitigation |
|---|---|---|
| Gemini CLI `docs/architecture.md` | 404 (file doesn't exist at that path) | Analyzed from README and repo structure |
| Claude Code Agent SDK full docs | Redirects to `platform.claude.com` (login required) | Covered via headless docs + subagent docs |
| Copilot SDK NPM package source | Not yet published publicly | Used awesome-copilot instructions as primary reference |

---

*Analysis generated from primary source documentation fetched on February 20, 2026. The Copilot SDK is in Technical Preview; APIs may change.*
