# GeneratorAI — Definitive Architecture Analysis

> **Author**: Principal Architect  
> **Date**: February 20, 2026  
> **Status**: Architecture Decision Record — Pre-Implementation  
> **Inputs**: baseprompt.txt, COPILOT_SDK_AGENT_ANALYSIS.md, TECH_STACK_RESEARCH_ANALYSIS.md

---

## Table of Contents

1. [Layered Architecture Design](#1-layered-architecture-design)
2. [Session-Workflow State Machine](#2-session-workflow-state-machine)
3. [Event Architecture](#3-event-architecture)
4. [Concurrency Model](#4-concurrency-model)
5. [Hooks System Design](#5-hooks-system-design)
6. [Platform Abstraction Layer](#6-platform-abstraction-layer)
7. [Codebase Management](#7-codebase-management)
8. [Artifact & Attachment System](#8-artifact--attachment-system)
9. [Error Handling Strategy](#9-error-handling-strategy)
10. [Configuration Architecture](#10-configuration-architecture)
11. [Database Schema](#11-database-schema-complete)
12. [Domain Entity Models](#12-domain-entity-models)
13. [REST API Specification](#13-rest-api-specification)
14. [Webhook System](#14-webhook-system)
15. [WorkflowService — Core Execution Engine](#15-workflowservice--core-execution-engine)
16. [Client State Management (TanStack Query + Zustand)](#16-client-state-management-tanstack-query--zustand)
17. [UI Architecture & Design](#17-ui-architecture--design)
18. [Testing Strategy](#18-testing-strategy)
19. [Logging & Observability](#19-logging--observability)
20. [Deployment & Packaging](#20-deployment--packaging)
21. [Session Resumption After App Restart](#21-session-resumption-after-app-restart)
22. [ScriptRunner Interface](#22-scriptrunner-interface)

**Appendices**
- [Appendix A: Complete Monorepo Package Map](#appendix-a-complete-monorepo-package-map)
- [Appendix B: Data Flow Summary Diagram](#appendix-b-data-flow-summary-diagram)
- [Appendix C: Architecture Decision Records (ADR)](#appendix-c-architecture-decision-records-adr)

---

## 1. Layered Architecture Design

### 1.1 Layer Definitions

The system follows a strict four-layer architecture with an additional cross-cutting **Bridge Layer** that adapts the Copilot SDK into domain-friendly abstractions. Dependencies flow strictly downward; no layer may reference a layer above it.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                            │
│  apps/web  ·  apps/desktop  ·  apps/cli  ·  apps/server(routes) │
│                                                                  │
│  React components, Ink components, Express/Fastify routes,       │
│  SSE endpoints, webhook receivers, IPC handlers                  │
│  ─────────────────────────────────────────────────────────────── │
│  ALLOWED DEPS: Application Layer (via injected services)         │
│  FORBIDDEN:    Domain Layer directly, Infrastructure Layer       │
└────────────────────────────┬────────────────────────────────────┘
                             │ calls
┌────────────────────────────▼────────────────────────────────────┐
│                    APPLICATION LAYER                              │
│  packages/core/src/services/                                     │
│                                                                  │
│  SessionService · WorkflowService · ChatService ·                │
│  CodebaseService · ArtifactService · WebhookService              │
│                                                                  │
│  Orchestrates domain objects, drives state machines,             │
│  coordinates cross-aggregate flows, maps DTOs                    │
│  ─────────────────────────────────────────────────────────────── │
│  ALLOWED DEPS: Domain Layer, Bridge Layer (via ports/interfaces) │
│  FORBIDDEN:    Presentation Layer, concrete Infrastructure       │
└────────────────────────────┬────────────────────────────────────┘
                             │ uses
┌────────────────────────────▼────────────────────────────────────┐
│                      DOMAIN LAYER                                │
│  packages/core/src/domain/                                       │
│                                                                  │
│  Session (aggregate root) · Workflow (entity) ·                  │
│  ChatMessage (value object) · WorkflowStep (value object) ·     │
│  AgentEvent (value object) · HookDefinition (value object)       │
│                                                                  │
│  State machines, business rules, invariant enforcement,          │
│  event definitions, domain events                                │
│  ─────────────────────────────────────────────────────────────── │
│  ALLOWED DEPS: None (pure TypeScript — zero external imports)    │
│  FORBIDDEN:    All other layers, Node.js APIs, third-party libs  │
└────────────────────────────┬────────────────────────────────────┘
                             │ implemented by
┌────────────────────────────▼────────────────────────────────────┐
│               INFRASTRUCTURE LAYER                               │
│  packages/db/ · packages/copilot-bridge/ · packages/streaming/   │
│                                                                  │
│  Drizzle/SQLite repos · CopilotBridge (SDK wrapper) ·            │
│  SSE transport · Git/GH CLI executor · File system ·             │
│  ProcessManager · Script executor                                │
│  ─────────────────────────────────────────────────────────────── │
│  ALLOWED DEPS: Domain Layer (implements domain interfaces/ports) │
│  FORBIDDEN:    Application Layer, Presentation Layer             │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 The Copilot Bridge Layer — Detailed Design

The Copilot SDK is Infrastructure. But it has deep behavioral implications (streaming, session lifecycle, tool registration) that must be exposed to the Application Layer without leaking SDK types. We solve this with a **Port/Adapter pattern**.

```
  Application Layer                Bridge Layer (packages/copilot-bridge/)
  ─────────────────                ──────────────────────────────────────
                                   
  SessionService ──uses──▶  ICopilotPort  ◀──implements──  CopilotAdapter
                           (domain port)                   (wraps SDK)
                                                              │
                                                              ▼
                                                     CopilotClient (SDK)
                                                     CopilotSession (SDK)
```

**Domain Port (interface in Domain Layer):**

```typescript
// packages/core/src/domain/ports/ICopilotPort.ts

import type { AgentEvent } from '../events/AgentEvent';

/** Domain-level abstraction over the Copilot SDK. No SDK types leak here. */
export interface ICopilotPort {
  // ── Client Lifecycle ──

  /** Initialize and start the underlying Copilot client (wraps client.start()) */
  initialize(): Promise<void>;

  /** Stop the Copilot CLI process gracefully (wraps client.stop()) */
  stop(): Promise<void>;

  /** Force-kill the Copilot CLI process immediately (wraps client.forceStop()) */
  forceStop(): Promise<void>;

  /** Get the current client state: 'starting' | 'running' | 'stopped' | 'error' */
  getClientState(): CopilotClientState;

  /** Health check — pings the Copilot CLI process */
  ping(): Promise<boolean>;

  /** Graceful shutdown — destroys all conversations then stops the client */
  shutdown(): Promise<void>;

  // ── Model Discovery ──

  /** List all available models from the Copilot backend */
  getModels(): Promise<CopilotModel[]>;

  // ── Conversation Lifecycle ──

  /** Create a new Copilot conversation (wraps client.createSession()) */
  createConversation(params: CreateConversationParams): Promise<string>; // returns conversationId

  /** Resume an existing conversation after restart (wraps client.resumeSession()) */
  resumeConversation(conversationId: string): Promise<void>;

  /** List all known conversation IDs in the Copilot CLI (wraps client.listSessions()) */
  listConversations(): Promise<string[]>;

  /** Get the last active conversation ID (wraps client.getLastSessionId()) */
  getLastConversationId(): Promise<string | null>;

  /** Delete a conversation from the Copilot CLI (wraps client.deleteSession()) */
  deleteConversation(conversationId: string): Promise<void>;

  /** Destroy a conversation, freeing local resources and unsubscribing events */
  destroyConversation(conversationId: string): Promise<void>;

  // ── Messaging ──

  /** Send a prompt (fire-and-forget — responses arrive via onConversationEvent) */
  sendPrompt(conversationId: string, prompt: string, attachments?: AttachmentRef[]): Promise<void>;

  /** Send a prompt and wait for the complete response (wraps session.sendAndWait()) */
  sendPromptAndWait(conversationId: string, prompt: string, attachments?: AttachmentRef[]): Promise<ConversationResponse>;

  /** Get all messages from a conversation's history (wraps session.getMessages()) */
  getMessages(conversationId: string): Promise<ConversationMessage[]>;

  /** Abort the current turn in a conversation */
  abortConversation(conversationId: string): Promise<void>;

  // ── Event Subscription ──

  /** Subscribe to events from a conversation. Returns unsubscribe fn. */
  onConversationEvent(conversationId: string, handler: (event: AgentEvent) => void): () => void;

  /** Subscribe to client-level lifecycle events (start, stop, error, restart) */
  onClientEvent(handler: (event: CopilotClientEvent) => void): () => void;
}

export type CopilotClientState = 'starting' | 'running' | 'stopped' | 'error';

export interface CopilotClientEvent {
  type: 'client.started' | 'client.stopped' | 'client.error' | 'client.restarting';
  data?: { message?: string };
}

export interface CopilotModel {
  id: string;
  name: string;
  provider?: string;
}

export interface ConversationResponse {
  content: string;
  toolCalls?: { tool: string; args: unknown; result: unknown }[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: Date;
}

export interface CreateConversationParams {
  conversationId: string;
  model?: string;

  // ── System Message (SDK supports append or full replace) ──
  systemMessage?: SystemMessageConfig;
  /** @deprecated — use systemMessage instead. Kept for backward compat. */
  systemPromptAppend?: string;

  // ── Tools ──
  tools?: ToolDefinition[];
  /** Restrict which built-in Copilot tools are available (allowlist) */
  availableTools?: string[];
  /** Exclude specific built-in Copilot tools (denylist) */
  excludedTools?: string[];

  // ── Skills & Agents ──
  /** Custom agent configurations (SDK customAgents) */
  customAgents?: CustomAgentConfig[];
  /** Directories to load skill definitions from */
  skillDirectories?: string[];
  /** Skills to disable for this conversation */
  disabledSkills?: string[];

  // ── MCP Servers ──
  mcpServers?: Record<string, McpServerConfig>;

  // ── Provider / BYOK ──
  /** Bring-Your-Own-Key provider config for non-Copilot LLM backends */
  provider?: BYOKProviderConfig;

  // ── Behavior ──
  /** Enable streaming (default: true) */
  streaming?: boolean;
  /** Working directory for Copilot file operations */
  workingDirectory?: string;
  /** Custom config directory path (SDK configDir) */
  configDir?: string;

  // ── Permission Handling ──
  /** Handler called when Copilot requests permission (e.g., file write, shell exec) */
  onPermissionRequest?: PermissionRequestHandler;
}

export interface SystemMessageConfig {
  /** 'append' adds to default system prompt; 'replace' overrides it entirely */
  mode: 'append' | 'replace';
  content: string;
}

export interface CustomAgentConfig {
  name: string;
  description: string;
  /** Instructions/system prompt for the custom agent */
  instructions: string;
  /** Tools available to this agent */
  tools?: string[];
}

export interface BYOKProviderConfig {
  /** Provider name (e.g., 'openai', 'anthropic', 'azure') */
  name: string;
  /** API base URL */
  baseUrl: string;
  /** API key or token */
  apiKey: string;
  /** Model identifier for the provider */
  model?: string;
}

export type PermissionRequestHandler = (
  request: PermissionRequest,
) => Promise<PermissionResponse>;

export interface PermissionRequest {
  type: 'file_write' | 'file_read' | 'shell_exec' | 'network' | 'other';
  description: string;
  details?: Record<string, unknown>;
}

export interface PermissionResponse {
  granted: boolean;
  reason?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>; // JSON Schema (not Zod — domain stays pure)
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface McpServerConfig {
  type: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
}

export interface AttachmentRef {
  type: 'file';
  path: string;
  displayName?: string;
}
```

**Infrastructure Adapter (in copilot-bridge package):**

```typescript
// packages/copilot-bridge/src/CopilotAdapter.ts

import { CopilotClient, CopilotSession, defineTool, SessionEvent } from '@github/copilot-sdk';
import { z } from 'zod';
import type {
  ICopilotPort, CreateConversationParams, AgentEvent,
  CopilotClientState, CopilotClientEvent, CopilotModel,
  ConversationResponse, ConversationMessage,
} from '@generatorai/core';

export class CopilotAdapter implements ICopilotPort {
  private client: CopilotClient;
  private conversations = new Map<string, CopilotSession>();
  private clientEventHandlers = new Set<(event: CopilotClientEvent) => void>();
  private clientStatePollingInterval?: ReturnType<typeof setInterval>;

  constructor(private options: CopilotAdapterOptions) {
    this.client = new CopilotClient({
      autoStart: false,
      autoRestart: true,
      useStdio: options.useStdio ?? true,
      cwd: options.defaultCwd,
    });
  }

  // ── Client Lifecycle ──

  async initialize(): Promise<void> {
    await this.client.start();
    this.emitClientEvent({ type: 'client.started' });
    this.startClientStatePolling();
  }

  async stop(): Promise<void> {
    this.stopClientStatePolling();
    await this.client.stop();
    this.emitClientEvent({ type: 'client.stopped' });
  }

  async forceStop(): Promise<void> {
    this.stopClientStatePolling();
    await this.client.forceStop();
    this.emitClientEvent({ type: 'client.stopped', data: { message: 'Force stopped' } });
  }

  getClientState(): CopilotClientState {
    const sdkState = this.client.getState();
    // Map SDK states to domain states
    const stateMap: Record<string, CopilotClientState> = {
      starting: 'starting',
      running: 'running',
      connected: 'running',
      stopped: 'stopped',
      error: 'error',
      disconnected: 'error',
    };
    return stateMap[sdkState] ?? 'error';
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping('health');
      return true;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.stopClientStatePolling();
    for (const [id, session] of this.conversations) {
      await session.destroy();
    }
    this.conversations.clear();
    await this.client.stop();
    this.emitClientEvent({ type: 'client.stopped' });
  }

  // ── Model Discovery ──

  async getModels(): Promise<CopilotModel[]> {
    const sdkModels = await this.client.getModels();
    return sdkModels.map((m: any) => ({
      id: m.id ?? m.name,
      name: m.name ?? m.id,
      provider: m.provider,
    }));
  }

  // ── Conversation Lifecycle ──

  async createConversation(params: CreateConversationParams): Promise<string> {
    const sdkTools = (params.tools ?? []).map(t =>
      defineTool(t.name, {
        description: t.description,
        parameters: t.parametersSchema,
        handler: t.handler as any,
      })
    );

    // Resolve system message (new API takes precedence over deprecated field)
    const systemMessage = params.systemMessage
      ? { mode: params.systemMessage.mode, content: params.systemMessage.content }
      : params.systemPromptAppend
        ? { mode: 'append' as const, content: params.systemPromptAppend }
        : undefined;

    const sessionConfig: Record<string, unknown> = {
      sessionId: params.conversationId,
      model: params.model ?? 'gpt-4.1',
      streaming: params.streaming ?? true,
      tools: sdkTools,
      systemMessage,
      mcpServers: params.mcpServers as any,
      skillDirectories: params.skillDirectories,
      disabledSkills: params.disabledSkills,
      availableTools: params.availableTools,
      excludedTools: params.excludedTools,
      customAgents: params.customAgents as any,
      configDir: params.configDir,
    };

    // BYOK provider support
    if (params.provider) {
      sessionConfig.provider = {
        name: params.provider.name,
        baseUrl: params.provider.baseUrl,
        apiKey: params.provider.apiKey,
        model: params.provider.model,
      };
    }

    // Permission request handler
    if (params.onPermissionRequest) {
      sessionConfig.onPermissionRequest = async (sdkRequest: any) => {
        const result = await params.onPermissionRequest!({
          type: sdkRequest.type ?? 'other',
          description: sdkRequest.description ?? '',
          details: sdkRequest,
        });
        return result.granted;
      };
    }

    const session = await this.client.createSession(sessionConfig as any);
    this.conversations.set(params.conversationId, session);
    return params.conversationId;
  }

  async resumeConversation(conversationId: string): Promise<void> {
    const session = await this.client.resumeSession(conversationId);
    this.conversations.set(conversationId, session);
  }

  async listConversations(): Promise<string[]> {
    return await this.client.listSessions();
  }

  async getLastConversationId(): Promise<string | null> {
    return await this.client.getLastSessionId() ?? null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    // Destroy local resources first
    const session = this.conversations.get(conversationId);
    if (session) {
      await session.destroy();
      this.conversations.delete(conversationId);
    }
    // Delete from Copilot CLI
    await this.client.deleteSession(conversationId);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    const session = this.conversations.get(conversationId);
    if (session) {
      await session.destroy();
      this.conversations.delete(conversationId);
    }
  }

  // ── Messaging ──

  async sendPrompt(conversationId: string, prompt: string, attachments?: AttachmentRef[]): Promise<void> {
    const session = this.getSession(conversationId);
    await session.send({
      prompt,
      attachments: attachments?.map(a => ({
        type: a.type as 'file',
        path: a.path,
        displayName: a.displayName,
      })),
    });
  }

  async sendPromptAndWait(conversationId: string, prompt: string, attachments?: AttachmentRef[]): Promise<ConversationResponse> {
    const session = this.getSession(conversationId);
    const result = await session.sendAndWait({
      prompt,
      attachments: attachments?.map(a => ({
        type: a.type as 'file',
        path: a.path,
        displayName: a.displayName,
      })),
    });
    return {
      content: result.content ?? '',
      toolCalls: result.toolCalls?.map((tc: any) => ({
        tool: tc.tool,
        args: tc.args,
        result: tc.result,
      })),
    };
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const session = this.getSession(conversationId);
    const messages = await session.getMessages();
    return messages.map((m: any) => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content,
      timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
    }));
  }

  async abortConversation(conversationId: string): Promise<void> {
    const session = this.conversations.get(conversationId);
    if (session) await session.abort();
  }

  // ── Event Subscription ──

  onConversationEvent(conversationId: string, handler: (event: AgentEvent) => void): () => void {
    const session = this.getSession(conversationId);
    return session.on((sdkEvent: SessionEvent) => {
      handler(this.mapSdkEvent(sdkEvent));
    });
  }

  onClientEvent(handler: (event: CopilotClientEvent) => void): () => void {
    this.clientEventHandlers.add(handler);
    return () => { this.clientEventHandlers.delete(handler); };
  }

  // ── Private ──

  private getSession(id: string): CopilotSession {
    const s = this.conversations.get(id);
    if (!s) throw new Error(`No active conversation: ${id}`);
    return s;
  }

  private emitClientEvent(event: CopilotClientEvent): void {
    for (const handler of this.clientEventHandlers) {
      handler(event);
    }
  }

  /** Poll Copilot CLI state for crash detection and emit lifecycle events */
  private startClientStatePolling(): void {
    let previousState = this.getClientState();
    this.clientStatePollingInterval = setInterval(() => {
      const currentState = this.getClientState();
      if (currentState !== previousState) {
        if (currentState === 'error') {
          this.emitClientEvent({ type: 'client.error', data: { message: 'CLI process error detected' } });
        }
        if (previousState === 'error' && currentState === 'running') {
          this.emitClientEvent({ type: 'client.restarting', data: { message: 'CLI process auto-restarted' } });
        }
        previousState = currentState;
      }
    }, 5_000);
  }

  private stopClientStatePolling(): void {
    if (this.clientStatePollingInterval) {
      clearInterval(this.clientStatePollingInterval);
      this.clientStatePollingInterval = undefined;
    }
  }

  /** Map SDK SessionEvent → domain AgentEvent */
  private mapSdkEvent(sdkEvent: SessionEvent): AgentEvent {
    switch (sdkEvent.type) {
      case 'user.message':
        return { kind: 'copilot.user_message', data: { content: sdkEvent.data.content } };
      case 'assistant.message_delta':
        return { kind: 'copilot.token', data: { text: sdkEvent.data.deltaContent } };
      case 'assistant.message':
        return { kind: 'copilot.message_complete', data: { content: sdkEvent.data.content } };
      case 'assistant.reasoning_delta':
        return { kind: 'copilot.reasoning_delta', data: { text: sdkEvent.data.deltaContent } };
      case 'assistant.reasoning':
        return { kind: 'copilot.reasoning_complete', data: { content: sdkEvent.data.content } };
      case 'tool.execution_start':
        return { kind: 'copilot.tool_start', data: { tool: sdkEvent.data?.tool, args: sdkEvent.data?.args } };
      case 'tool.execution_complete':
        return { kind: 'copilot.tool_complete', data: { tool: sdkEvent.data?.tool, result: sdkEvent.data?.result } };
      case 'session.idle':
        return { kind: 'copilot.idle', data: {} };
      case 'session.error':
        return { kind: 'copilot.error', data: { message: sdkEvent.data.message } };
      case 'session.start':
        return { kind: 'copilot.session_start', data: {} };
      default:
        return { kind: 'copilot.unknown', data: { raw: sdkEvent } };
    }
  }
}
```

### 1.3 Dependency Injection Wiring

All layers are wired at composition root (app startup). This is the only place that knows about concrete implementations.

```typescript
// apps/server/src/composition-root.ts

import { CopilotAdapter } from '@generatorai/copilot-bridge';
import { DrizzleSessionRepository, DrizzleEventRepository } from '@generatorai/db';
import { SessionService, WorkflowService, ChatService } from '@generatorai/core';
import { SSETransport } from '@generatorai/streaming';
import { EventBus, HookInterceptor } from '@generatorai/core';
import { GitManager } from '@generatorai/core';

export function createContainer(config: AppConfig) {
  // Infrastructure
  const db = createDrizzleDB(config.dbPath);
  const copilot = new CopilotAdapter({ useStdio: true, defaultCwd: config.workspacesDir });
  const eventBus = new EventBus();
  const sseTransport = new SSETransport(eventBus);
  const gitManager = new GitManager(config.workspacesDir);

  // Repositories (Infrastructure implementing Domain ports)
  const sessionRepo = new DrizzleSessionRepository(db);
  const eventRepo = new DrizzleEventRepository(db);
  const workflowRepo = new DrizzleWorkflowRepository(db);
  const artifactRepo = new DrizzleArtifactRepository(db);

  // Additional repositories
  const chatRepo = new DrizzleChatMessageRepository(db);
  const webhookRepo = new DrizzleWebhookRepository(db);

  // Infrastructure services
  const hookExecutor = new HookExecutor(new SandboxedScriptRunner(config.allowedCommands), eventBus);
  const hookInterceptor = new HookInterceptor(hookExecutor, eventBus);
  const configResolver = new ConfigResolver(new TemplateRegistry(config.templatesDir));
  const templateRegistry = configResolver.templateRegistry;

  // Application Services
  const sessionService = new SessionService(sessionRepo, workflowRepo, eventBus, copilot, gitManager);
  const workflowService = new WorkflowService(
    workflowRepo, sessionRepo, chatRepo, copilot, eventBus,
    hookExecutor, hookInterceptor, configResolver, gitManager,
  );
  // Resolve circular dependency
  workflowService.setSessionService(sessionService);
  sessionService.setWorkflowService(workflowService);

  const chatService = new ChatService(sessionRepo, eventRepo, copilot, eventBus);
  const artifactService = new ArtifactService(artifactRepo, config.artifactsDir);
  const webhookService = new WebhookService(
    webhookRepo, sessionService, templateRegistry, eventBus, config.webhooks,
  );
  const recoveryService = new StartupRecoveryService(
    sessionRepo, workflowRepo, copilot, eventBus, logger,
  );

  return {
    copilot,
    eventBus,
    sseTransport,
    sessionService,
    workflowService,
    chatService,
    artifactService,
    webhookService,
    gitManager,
    recoveryService,
    hookInterceptor,
    async initialize() {
      await copilot.initialize();

      // Register global Copilot CLI lifecycle hooks
      const globalHooks = configResolver.resolveGlobalHooks();
      hookInterceptor.registerClientLifecycleHooks(copilot, globalHooks, {
        sessionId: '__global__',
        workspacePath: config.workspacesDir,
        variables: {},
        eventBus,
      });

      await recoveryService.recover();
    },
    async shutdown() {
      await copilot.shutdown();
    },
  };
}
```

### 1.4 Package → Layer Mapping

```
packages/
├── core/                    # APPLICATION + DOMAIN layers
│   └── src/
│       ├── domain/          # DOMAIN LAYER — pure TS, zero deps
│       │   ├── entities/    #   Session, Workflow, ChatMessage
│       │   ├── value-objects/#  WorkflowStep, AgentEvent, HookDef
│       │   ├── events/      #   Domain event definitions
│       │   ├── ports/       #   ICopilotPort, ISessionRepo, IEventRepo
│       │   └── state-machines/ # Session SM, Workflow SM
│       ├── services/        # APPLICATION LAYER
│       │   ├── SessionService.ts
│       │   ├── WorkflowService.ts
│       │   ├── ChatService.ts
│       │   ├── CodebaseService.ts
│       │   ├── ArtifactService.ts
│       │   └── HookExecutor.ts
│       └── events/          # EventBus (application-level wiring)
│           └── EventBus.ts
├── shared/                  # Cross-cutting types, constants, utils
│   └── src/
│       ├── types/           #   DTOs, API contracts, shared enums
│       ├── constants/       #   Event names, status enums
│       └── utils/           #   ID generators, date helpers
├── db/                      # INFRASTRUCTURE — persistence
│   └── src/
│       ├── schema.ts        #   Drizzle table definitions
│       ├── migrations/      #   Generated migrations
│       └── repositories/    #   DrizzleSessionRepo, etc.
├── copilot-bridge/          # INFRASTRUCTURE — Copilot SDK adapter
│   └── src/
│       ├── CopilotAdapter.ts
│       └── tool-factory.ts  #   Helpers for building defineTool calls
├── streaming/               # INFRASTRUCTURE — SSE transport
│   └── src/
│       ├── SSETransport.ts
│       └── DurableStreamManager.ts
└── ui/                      # PRESENTATION — shared React components
    └── src/
        ├── components/
        └── hooks/
```

### 1.5 Dependency Rules (Enforced by ESLint `boundaries` plugin)

| Source Layer | Can Import From | Cannot Import From |
|---|---|---|
| Presentation | Application, Shared | Domain directly, Infrastructure |
| Application | Domain, Shared | Presentation, Infrastructure (concrete) |
| Domain | Shared (types only) | Everything else |
| Infrastructure | Domain (ports), Shared | Application, Presentation |

**Rationale**: The Domain Layer is the most stable, change-resistant code. It contains business rules that survive framework migrations. The Copilot SDK could be replaced with another AI runtime without touching Domain or Application code — only the `copilot-bridge` adapter changes.

---

## 2. Session-Workflow State Machine

### 2.1 Session State Machine

```
                          ┌──────────────────────────────────────────────────────┐
                          │                SESSION STATE MACHINE                  │
                          │                                                      │
  ┌─────────┐  user:     │  ┌──────────┐  user:start    ┌──────────┐           │
  │         │  create    │  │          │ ─────────────▶ │          │           │
  │  (none) │──────────▶│  │ CREATED  │                │ STARTING │           │
  │         │           │  │          │ ◀───────────── │          │           │
  └─────────┘           │  └──────────┘  sys:start_fail └────┬─────┘           │
                         │       │                            │                 │
                         │       │ user:delete                │ sys:started     │
                         │       ▼                            ▼                 │
                         │  ┌──────────┐             ┌──────────┐              │
                         │  │ DELETED  │             │ RUNNING  │              │
                         │  └──────────┘             │          │              │
                         │       ▲                   └──┬──┬───┘              │
                         │       │                      │  │    ▲              │
                         │       │ user:delete          │  │    │              │
                         │       │ (from any terminal)  │  │    │ user:resume  │
                         │       │                      │  │    │ sys:wf_resume│
                         │       │    ┌─────────────────┘  │    │              │
                         │       │    │ user:pause         │    │              │
                         │       │    │ sys:wf_paused      │  ┌─┴────────┐    │
                         │       │    │                    │  │          │    │
                         │       │    ▼                    │  │  PAUSED  │    │
                         │       │  ┌──────────┐          │  │          │    │
                         │       ├──│  PAUSED  │          │  └──────────┘    │
                         │       │  └──────────┘          │       ▲          │
                         │       │                        │       │          │
                         │       │                        │ user:cancel      │
                         │       │    ┌───────────────────┘       │          │
                         │       │    │                           │          │
                         │       │    ▼                           │          │
                         │       │  ┌────────────┐               │          │
                         │       ├──│ CANCELLING │───────────────┘          │
                         │       │  └──────┬─────┘ (if wf running,         │
                         │       │         │        abort then cancel)      │
                         │       │         │ sys:all_stopped                │
                         │       │         ▼                                │
                         │       │  ┌────────────┐                         │
                         │       ├──│ CANCELLED  │                         │
                         │       │  └────────────┘                         │
                         │       │                                          │
                         │       │  sys:all_wf_done                        │
                         │       │  ┌────────────┐                         │
                         │       └──│ COMPLETED  │                         │
                         │          └────────────┘                         │
                         └──────────────────────────────────────────────────┘
```

**Session States:**

```typescript
// packages/core/src/domain/state-machines/SessionStateMachine.ts

export type SessionStatus =
  | 'created'      // Session defined, workflows attached, not yet started
  | 'starting'     // Codebase clone / prerequisites in progress
  | 'running'      // At least one workflow is actively executing
  | 'paused'       // All activity suspended (user-initiated or workflow-cascaded)
  | 'cancelling'   // Abort signal sent, waiting for running workflows to stop
  | 'cancelled'    // User cancelled — chat mode becomes available
  | 'completed'    // All workflows finished successfully — chat mode available
  | 'deleted';     // Soft-deleted, pending cleanup

export type SessionTransition =
  | 'user:start'       // User clicks Start
  | 'user:pause'       // User clicks Pause
  | 'user:resume'      // User clicks Resume
  | 'user:cancel'      // User clicks Cancel
  | 'user:delete'      // User clicks Delete
  | 'sys:started'      // Prerequisites done, first workflow starting
  | 'sys:start_fail'   // Prerequisites failed (clone error, etc.)
  | 'sys:wf_paused'    // Running workflow was paused (cascade up)
  | 'sys:wf_resume'    // Paused workflow resumed (cascade up)
  | 'sys:all_stopped'  // All workflows have stopped after cancel signal
  | 'sys:all_wf_done'  // All workflows completed successfully
  | 'sys:wf_failed';   // A workflow failed (cascade up to paused)

const SESSION_TRANSITIONS: Record<SessionStatus, Partial<Record<SessionTransition, SessionStatus>>> = {
  created:    { 'user:start': 'starting', 'user:delete': 'deleted' },
  starting:   { 'sys:started': 'running', 'sys:start_fail': 'created', 'user:cancel': 'cancelling', 'user:delete': 'deleted' },
  running:    { 'user:pause': 'paused', 'user:cancel': 'cancelling', 'sys:wf_paused': 'paused', 'sys:wf_failed': 'paused', 'sys:all_wf_done': 'completed' },
  paused:     { 'user:resume': 'running', 'user:cancel': 'cancelling', 'user:delete': 'deleted', 'sys:wf_resume': 'running' },
  cancelling: { 'sys:all_stopped': 'cancelled' },
  cancelled:  { 'user:delete': 'deleted' },
  completed:  { 'user:delete': 'deleted' },
  deleted:    {}, // terminal state
};

export class SessionStateMachine {
  constructor(private currentStatus: SessionStatus) {}

  get status(): SessionStatus { return this.currentStatus; }

  transition(event: SessionTransition): SessionStatus {
    const nextStatus = SESSION_TRANSITIONS[this.currentStatus]?.[event];
    if (!nextStatus) {
      throw new InvalidTransitionError(
        `Cannot apply '${event}' to session in '${this.currentStatus}' state`
      );
    }
    this.currentStatus = nextStatus;
    return nextStatus;
  }

  canTransition(event: SessionTransition): boolean {
    return !!SESSION_TRANSITIONS[this.currentStatus]?.[event];
  }

  /** Is chat input allowed? Only after workflows done or cancelled. */
  get isChatEnabled(): boolean {
    return this.currentStatus === 'completed' || this.currentStatus === 'cancelled';
  }
}
```

### 2.2 Workflow State Machine

```
  ┌─────────┐  sys:session_start  ┌──────────┐  sys:turn  ┌───────────┐
  │ PENDING │ ──────────────────▶ │ QUEUED   │ ────────▶ │  RUNNING  │
  └─────────┘                     └──────────┘           └──┬──┬──┬──┘
                                                            │  │  │
                              ┌──────────────────────────────┘  │  │
                              │ user:pause / sys:parent_pause   │  │
                              ▼                                 │  │
                        ┌──────────┐                            │  │
                        │  PAUSED  │                            │  │
                        └──┬───────┘                            │  │
                           │ user:resume / sys:parent_resume    │  │
                           │ ─────────────────────────────────▶ │  │
                           │                                    │  │
                           │  user:cancel / sys:parent_cancel   │  │
                           │  ─────────────────▶ ┌────────────┐ │  │
                           │                     │ CANCELLED  │◀┘  │
                           │                     └────────────┘    │
                           │                                       │
                           │                     ┌────────────┐    │
                           │                     │  FAILED    │◀───┘ sys:error
                           │                     └────────────┘
                           │
                           │                     ┌────────────┐
                           └────────────────────▶│ COMPLETED  │  sys:done
                                                 └────────────┘
```

```typescript
// packages/core/src/domain/state-machines/WorkflowStateMachine.ts

export type WorkflowStatus =
  | 'pending'      // Attached to session, awaiting its turn
  | 'queued'       // Session started, this workflow is next in sequence
  | 'running'      // Actively executing (Copilot conversation in progress)
  | 'paused'       // Suspended (user or parent cascade)
  | 'completed'    // Finished successfully
  | 'failed'       // Encountered an unrecoverable error
  | 'cancelled';   // Cancelled by user or parent session

export type WorkflowTransition =
  | 'sys:session_start'    // Session started, workflow moves to queue
  | 'sys:turn'             // Previous workflow done, this one is next
  | 'user:pause'           // User paused this workflow
  | 'sys:parent_pause'     // Parent session pause cascaded
  | 'user:resume'          // User resumed this workflow
  | 'sys:parent_resume'    // Parent session resume cascaded
  | 'user:cancel'          // User cancelled this workflow
  | 'sys:parent_cancel'    // Parent session cancel cascaded
  | 'sys:done'             // Workflow execution completed
  | 'sys:error';           // Unrecoverable error during execution

const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, Partial<Record<WorkflowTransition, WorkflowStatus>>> = {
  pending:   { 'sys:session_start': 'queued' },
  queued:    { 'sys:turn': 'running', 'sys:parent_cancel': 'cancelled' },
  running:   { 'user:pause': 'paused', 'sys:parent_pause': 'paused', 'user:cancel': 'cancelled', 'sys:parent_cancel': 'cancelled', 'sys:done': 'completed', 'sys:error': 'failed' },
  paused:    { 'user:resume': 'running', 'sys:parent_resume': 'running', 'user:cancel': 'cancelled', 'sys:parent_cancel': 'cancelled' },
  completed: {}, // terminal
  failed:    {}, // terminal
  cancelled: {}, // terminal
};
```

### 2.3 Parent-Child Cascade Rules

These rules are **enforced in `SessionService`** (Application Layer), never in the state machines themselves (state machines are pure transition logic):

| Session Action | Effect on Workflows | Cascade Direction |
|---|---|---|
| **Session Pause** | Running workflow receives `sys:parent_pause` → paused. Queued workflows stay queued. Pending workflows stay pending. | Parent → Child |
| **Session Resume** | Paused workflow receives `sys:parent_resume` → running. Queued workflows stay queued. | Parent → Child |
| **Session Cancel** | Running workflow gets `session.abort()` then `sys:parent_cancel`. All queued/pending workflows get `sys:parent_cancel`. | Parent → Child |
| **Workflow Paused** (by user clicking workflow's pause) | Session checks: any running workflows left? If none, session transitions `sys:wf_paused` → paused. | Child → Parent |
| **Workflow Done** | Session checks: any remaining queued/pending? If yes, next workflow moves `sys:turn` → running. If none, session transitions `sys:all_wf_done` → completed. | Child → Parent |
| **Workflow Failed** | Session checks hook `onWorkflowFailure`: if `'abort_session'` → cancel remaining; if `'skip'` → advance to next workflow; if `'retry'` → re-run (max 3). | Child → Parent |

```typescript
// packages/core/src/services/SessionService.ts (excerpt)

export class SessionService {
  async pauseSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.getById(sessionId);
    const sm = new SessionStateMachine(session.status);
    sm.transition('user:pause');

    // Cascade to running workflow
    const workflows = await this.workflowRepo.getBySessionId(sessionId);
    const running = workflows.find(w => w.status === 'running');
    if (running) {
      const wfSm = new WorkflowStateMachine(running.status);
      wfSm.transition('sys:parent_pause');
      await this.copilot.abortConversation(running.conversationId);
      await this.workflowRepo.updateStatus(running.id, wfSm.status);
    }

    await this.sessionRepo.updateStatus(sessionId, sm.status);
    this.eventBus.emit(sessionId, { kind: 'session.paused', data: { sessionId } });
  }

  /** Called by WorkflowService when a workflow completes */
  async onWorkflowCompleted(sessionId: string, workflowId: string): Promise<void> {
    const workflows = await this.workflowRepo.getBySessionId(sessionId);
    const nextQueued = workflows
      .filter(w => w.status === 'queued')
      .sort((a, b) => a.order - b.order)[0];

    if (nextQueued) {
      // Advance to next workflow
      await this.workflowService.startWorkflow(nextQueued.id);
    } else {
      // All done
      const sm = new SessionStateMachine('running');
      sm.transition('sys:all_wf_done');
      await this.sessionRepo.updateStatus(sessionId, sm.status);
      this.eventBus.emit(sessionId, { kind: 'session.completed', data: { sessionId } });
    }
  }

  /** Called by WorkflowService when a workflow fails */
  async onWorkflowFailed(sessionId: string, workflowId: string, error: string): Promise<void> {
    // Cancel remaining queued workflows
    const workflows = await this.workflowRepo.getBySessionId(sessionId);
    for (const wf of workflows) {
      if (wf.status === 'queued') {
        await this.workflowRepo.updateStatus(wf.id, 'cancelled');
      }
    }

    // Transition session to paused (user can inspect and retry)
    const sm = new SessionStateMachine('running');
    sm.transition('sys:wf_failed');
    await this.sessionRepo.updateStatus(sessionId, sm.status);
    this.eventBus.emit(sessionId, {
      kind: 'session.paused',
      data: { sessionId, reason: `Workflow failed: ${error}` },
    });
  }

  /** Circular dependency: set by composition root */
  private workflowService!: WorkflowService;
  setWorkflowService(svc: WorkflowService) { this.workflowService = svc; }
}
```

### 2.4 Workflow Sequential Execution Within a Session

```
Session S1 starts → Workflows execute in order:

  W1 (pending → queued → running → completed)
       │
       └── completion triggers ──▶ W2 (queued → running → completed)
                                        │
                                        └── completion triggers ──▶ W3 (queued → running → ...)
```

Only **one workflow runs at a time** within a session. This is intentional — workflows within a session share the same codebase context and may depend on previous outputs.

---

## 3. Event Architecture

### 3.1 Complete Event Pipeline

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                     EVENT PIPELINE (per session)                         │
  │                                                                          │
  │  SOURCE                PROCESS              PERSIST          DELIVER     │
  │  ──────                ───────              ───────          ───────     │
  │                                                                          │
  │  CopilotSession.on()──▶ CopilotAdapter ──▶ ┌───────────┐               │
  │  (SDK events)            .mapSdkEvent()     │           │               │
  │                                      ┌─────▶│  EventBus │──▶ persist ──▶│
  │  GitManager ──────────────────────────┤     │  (in-proc │    to SQLite  │
  │  (git clone, git commit, etc.)       │     │  emitter)  │               │
  │                                      │     │           │──▶ broadcast ─▶│
  │  ScriptExecutor ──────────────────────┤     │           │    to SSE     │
  │  (stdout, stderr, exit)              │     └───────────┘    clients    │
  │                                      │          │                       │
  │  WorkflowEngine ─────────────────────┘          │                       │
  │  (step start/complete, hooks)                   ▼                       │
  │                                          ┌─────────────┐               │
  │                                          │  SQLite      │               │
  │                                          │  events      │               │
  │                                          │  table       │               │
  │                                          │  (seq_id,    │               │
  │                                          │   type,      │               │
  │                                          │   payload,   │               │
  │                                          │   timestamp) │               │
  │                                          └──────┬──────┘               │
  │                                                 │                       │
  │  ┌──── SSE Client ◀──── SSE Endpoint ◀─────────┤                       │
  │  │     (Web/Desktop)    /sessions/:id/stream    │                       │
  │  │                      Last-Event-ID replay    │                       │
  │  │                                              │                       │
  │  ├──── IPC Channel ◀── Electron Main ◀──────────┤                       │
  │  │     (Desktop)       process forward          │                       │
  │  │                                              │                       │
  │  └──── Direct Sub ◀── EventBus.on() ◀──────────┘                       │
  │        (CLI/Server)    (in-process)                                     │
  └──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Unified AgentEvent Type

All events across the system are normalized to this discriminated union. This is the **single event contract** shared by server, clients, and persistence.

```typescript
// packages/shared/src/types/AgentEvent.ts

export type AgentEvent =
  // ── Copilot SDK Events (mapped from SessionEvent) ──
  | { kind: 'copilot.token';            data: { text: string } }
  | { kind: 'copilot.message_complete'; data: { content: string } }
  | { kind: 'copilot.user_message';     data: { content: string } }
  | { kind: 'copilot.reasoning_delta';  data: { text: string } }
  | { kind: 'copilot.reasoning_complete'; data: { content: string } }
  | { kind: 'copilot.tool_start';       data: { tool: string; args: unknown } }
  | { kind: 'copilot.tool_complete';    data: { tool: string; result: unknown } }
  | { kind: 'copilot.idle';             data: Record<string, never> }
  | { kind: 'copilot.error';            data: { message: string } }
  | { kind: 'copilot.session_start';    data: Record<string, never> }
  | { kind: 'copilot.unknown';          data: { raw: unknown } }
  // ── Copilot Client Lifecycle Events ──
  | { kind: 'copilot.client_started';   data: Record<string, never> }
  | { kind: 'copilot.client_stopped';   data: { message?: string } }
  | { kind: 'copilot.client_error';     data: { message: string } }
  | { kind: 'copilot.client_restarting'; data: { message?: string } }
  // ── Workflow Events ──
  | { kind: 'workflow.started';         data: { workflowId: string; name: string } }
  | { kind: 'workflow.step_started';    data: { workflowId: string; step: string } }
  | { kind: 'workflow.step_completed';  data: { workflowId: string; step: string } }
  | { kind: 'workflow.completed';       data: { workflowId: string } }
  | { kind: 'workflow.failed';          data: { workflowId: string; error: string } }
  | { kind: 'workflow.paused';          data: { workflowId: string } }
  | { kind: 'workflow.cancelled';       data: { workflowId: string } }
  // ── Session Events ──
  | { kind: 'session.starting';         data: { sessionId: string } }
  | { kind: 'session.running';          data: { sessionId: string } }
  | { kind: 'session.paused';          data: { sessionId: string } }
  | { kind: 'session.completed';       data: { sessionId: string } }
  | { kind: 'session.cancelled';       data: { sessionId: string } }
  | { kind: 'session.error';           data: { sessionId: string; message: string } }
  // ── Git Events ──
  | { kind: 'git.clone_start';         data: { repoUrl: string } }
  | { kind: 'git.clone_progress';      data: { percent: number; message: string } }
  | { kind: 'git.clone_complete';      data: { localPath: string } }
  | { kind: 'git.commit';              data: { sha: string; message: string } }
  | { kind: 'git.push';                data: { branch: string } }
  | { kind: 'git.pr_created';          data: { url: string; number: number } }
  // ── Script Events ──
  | { kind: 'script.stdout';           data: { line: string; scriptId: string } }
  | { kind: 'script.stderr';           data: { line: string; scriptId: string } }
  | { kind: 'script.exit';             data: { code: number; scriptId: string } }
  // ── Hook Events ──
  | { kind: 'hook.started';            data: { hookName: string; phase: HookPhase } }
  | { kind: 'hook.completed';          data: { hookName: string; phase: HookPhase; result?: unknown } }
  | { kind: 'hook.failed';             data: { hookName: string; phase: HookPhase; error: string } }
  | { kind: 'hook.skipped';            data: { hookName: string; phase: HookPhase; reason: string } }
  // ── Artifact Events ──
  | { kind: 'artifact.created';        data: { artifactId: string; name: string; mimeType: string } }
  | { kind: 'artifact.available';      data: { artifactId: string; downloadUrl: string } }
  // ── Permission Events ──
  | { kind: 'permission.requested';    data: { type: string; description: string } }
  | { kind: 'permission.granted';      data: { type: string } }
  | { kind: 'permission.denied';       data: { type: string; reason?: string } };

export type AgentEventKind = AgentEvent['kind'];

/** Persisted event with metadata */
export interface PersistedEvent {
  id: number;                  // auto-increment PK
  sessionId: string;
  sequenceId: number;          // per-session monotonic counter
  kind: AgentEventKind;
  data: unknown;               // JSON payload
  timestamp: number;           // unix ms
}
```

### 3.3 EventBus Implementation

```typescript
// packages/core/src/events/EventBus.ts

import { EventEmitter } from 'events';
import type { AgentEvent, PersistedEvent } from '@generatorai/shared';

export class EventBus {
  private emitter = new EventEmitter();
  private sequenceCounters = new Map<string, number>();

  constructor(private eventRepo?: IEventRepository) {
    // Allow many listeners (one per SSE connection per session)
    this.emitter.setMaxListeners(1000);
  }

  /** Emit an event for a session. Persists to DB and broadcasts to subscribers. */
  async emit(sessionId: string, event: AgentEvent): Promise<PersistedEvent> {
    const seq = (this.sequenceCounters.get(sessionId) ?? 0) + 1;
    this.sequenceCounters.set(sessionId, seq);

    const persisted: PersistedEvent = {
      id: 0, // assigned by DB
      sessionId,
      sequenceId: seq,
      kind: event.kind,
      data: event.data,
      timestamp: Date.now(),
    };

    // 1. Persist to SQLite (synchronous with better-sqlite3 — microseconds)
    if (this.eventRepo) {
      persisted.id = await this.eventRepo.insert(persisted);
    }

    // 2. Broadcast to in-process subscribers
    this.emitter.emit(`session:${sessionId}`, persisted);
    this.emitter.emit('session:*', persisted);

    return persisted;
  }

  /** Subscribe to events for a specific session. Returns unsubscribe function. */
  subscribe(sessionId: string, handler: (event: PersistedEvent) => void): () => void {
    this.emitter.on(`session:${sessionId}`, handler);
    return () => this.emitter.off(`session:${sessionId}`, handler);
  }

  /** Subscribe to all events across all sessions (monitoring, logging). */
  subscribeAll(handler: (event: PersistedEvent) => void): () => void {
    this.emitter.on('session:*', handler);
    return () => this.emitter.off('session:*', handler);
  }

  /** Load sequence counter from DB on startup (for resumption). */
  async restoreCounters(): Promise<void> {
    if (!this.eventRepo) return;
    const maxSeqs = await this.eventRepo.getMaxSequencePerSession();
    for (const { sessionId, maxSeq } of maxSeqs) {
      this.sequenceCounters.set(sessionId, maxSeq);
    }
  }
}
```

### 3.4 Durable Stream / SSE Endpoint with Replay

```typescript
// packages/streaming/src/SSETransport.ts

import type { Request, Response } from 'express';
import type { EventBus, IEventRepository, PersistedEvent } from '@generatorai/core';

export class SSETransport {
  constructor(
    private eventBus: EventBus,
    private eventRepo: IEventRepository,
  ) {}

  /** Express handler for GET /api/sessions/:sessionId/stream */
  createHandler() {
    return async (req: Request, res: Response) => {
      const { sessionId } = req.params;
      const lastEventId = parseInt(req.headers['last-event-id'] as string) || 0;

      // SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',  // nginx
      });

      // Phase 1: Replay missed events from SQLite
      const missed = await this.eventRepo.getAfterSequence(sessionId, lastEventId);
      for (const event of missed) {
        this.writeSSE(res, event);
      }

      // Phase 2: Live stream new events
      const unsubscribe = this.eventBus.subscribe(sessionId, (event) => {
        // Only send events the client hasn't seen
        if (event.sequenceId > lastEventId) {
          this.writeSSE(res, event);
        }
      });

      // Phase 3: Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15_000);

      // Cleanup on disconnect
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    };
  }

  private writeSSE(res: Response, event: PersistedEvent): void {
    res.write(`id: ${event.sequenceId}\n`);
    res.write(`event: ${event.kind}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }
}
```

### 3.5 Backpressure Handling

Backpressure arises when a client can't consume events fast enough (slow network, tab frozen).

**Strategy: Write-buffer check + SQLite as overflow**

```typescript
// In SSETransport, enhanced writeSSE:
private writeSSE(res: Response, event: PersistedEvent): boolean {
  const payload = `id: ${event.sequenceId}\nevent: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`;

  // Node.js writable.write() returns false when the internal buffer is full
  const drained = res.write(payload);

  if (!drained) {
    // Buffer is full — client is slow. Two options:
    // 1. Skip high-frequency events (copilot.token deltas) — client will get final message
    // 2. Continue — Node.js will buffer in memory (bounded)
    // We opt for (1) in production by tracking a "slow" flag
    this.markClientSlow(res);
  }

  return drained;
}

// For slow clients, batch token deltas:
// Instead of sending every copilot.token event, accumulate and send every 100ms
```

**Rationale**: SQLite persistence is the ultimate backpressure relief valve. If a client disconnects entirely, it reconnects with `Last-Event-ID` and replays from SQLite. We never drop events from the persistence layer. We only throttle the live SSE stream to slow clients.

### 3.6 Event Filtering (Client-Side Optimization)

Not all clients need all events. High-frequency `copilot.token` events are needed for the chat view but not for the session list.

```typescript
// Server-side: accept filter query parameters
// GET /api/sessions/:id/stream?filter=workflow,session,git

createHandler() {
  return async (req: Request, res: Response) => {
    const filterParam = (req.query.filter as string) ?? '';
    const filterPrefixes = filterParam ? filterParam.split(',') : []; // empty = all

    const shouldSend = (event: PersistedEvent): boolean => {
      if (filterPrefixes.length === 0) return true;
      return filterPrefixes.some(prefix => event.kind.startsWith(prefix));
    };

    // ... SSE setup ...

    const unsubscribe = this.eventBus.subscribe(sessionId, (event) => {
      if (shouldSend(event)) {
        this.writeSSE(res, event);
      }
    });
  };
}
```

---

## 4. Concurrency Model

### 4.1 Decision: Single CopilotClient, Multiple Sessions

**Recommendation: One `CopilotClient` instance per application process, with multiple `CopilotSession` instances.**

```
┌────────────────────────────────────────────────┐
│               Application Process               │
│                                                  │
│   ┌──────────────────────────────────────────┐  │
│   │           CopilotClient (single)          │  │
│   │  Manages ONE Copilot CLI child process    │  │
│   │  JSON-RPC multiplexed over stdio/TCP      │  │
│   └───┬──────────┬──────────┬────────────┬───┘  │
│       │          │          │            │       │
│  ┌────▼───┐ ┌───▼────┐ ┌───▼────┐ ┌────▼───┐  │
│  │Session1│ │Session2│ │Session3│ │Session4│  │
│  │(wf-A)  │ │(wf-B)  │ │(chat)  │ │(wf-C)  │  │
│  └────────┘ └────────┘ └────────┘ └────────┘  │
└────────────────────────────────────────────────┘
```

### 4.2 Tradeoff Analysis

| Factor | Single Client + N Sessions | N Clients (one per session) |
|---|---|---|
| **Resource usage** | 1 CLI process, ~100-200MB RAM | N CLI processes, N × 100-200MB |
| **Startup time** | One-time ~2-5s CLI boot | 2-5s per session start |
| **Session independence** | Sessions are independent (SDK design) | Fully isolated |
| **Failure blast radius** | CLI crash = all sessions lost | CLI crash = one session lost |
| **SDK support** | First-class (native concurrent sessions) | Extra code, not recommended |
| **Complexity** | Low — SDK manages everything | High — process pool management |
| **Port management** | One port or stdio pipe | N ports or N stdio pipes |
| **Session limit** | Depends on CLI capacity | Limited by system resources |

**Why Single Client wins:**

1. **The SDK is designed for it.** The documentation explicitly shows `Promise.all([session1.send(), session2.send()])` — sessions are independent and concurrent on one client.

2. **Resource efficiency.** With 10 concurrent sessions, the multi-client approach uses ~1-2GB RAM just for CLI processes. Single client: ~200MB.

3. **The CLI crash risk is mitigated** by `autoRestart: true`. If the CLI crashes, the SDK auto-restarts it. All sessions can be resumed via `client.resumeSession(id)`.

### 4.3 Failure Recovery Protocol

```typescript
// packages/copilot-bridge/src/CopilotAdapter.ts — Recovery extension
// (This logic is integrated into the main CopilotAdapter class shown in §1.2)

// The CopilotAdapter now uses client state polling (startClientStatePolling)
// to detect CLI crashes and emit client lifecycle events. Recovery is handled
// by the SDK's autoRestart:true option combined with our conversation resumption.

// Recovery flow:
// 1. clientStatePolling detects state change to 'error'
// 2. emitClientEvent({ type: 'client.error' }) → triggers on_client_error hooks
// 3. SDK auto-restarts CLI (autoRestart: true)
// 4. clientStatePolling detects state change to 'running'
// 5. emitClientEvent({ type: 'client.restarting' }) → triggers on_client_restart hooks
// 6. resumeAllConversations() attempts to resume each active session

export class CopilotAdapter implements ICopilotPort {
  // ... (full implementation in §1.2) ...

  private async resumeAllConversations(): Promise<void> {
    // Wait for auto-restart to complete
    let retries = 0;
    while (this.getClientState() !== 'running' && retries < 10) {
      await sleep(1_000);
      retries++;
    }

    if (this.getClientState() !== 'running') {
      // Manual restart as fallback
      await this.client.start();
      this.emitClientEvent({ type: 'client.started' });
    }

    // Resume all active conversations
    for (const [conversationId] of this.conversations) {
      try {
        await this.resumeConversation(conversationId);
      } catch (err) {
        // Conversation may have expired — will create new one on next workflow step
      }
    }
  }
}
```

### 4.4 Concurrency Within a Session

Within a single session, the Copilot SDK handles only one active turn at a time. `session.send()` while a turn is in progress will queue the message. This aligns with our design: workflows within a session run sequentially.

```
Session S1 timeline:
  ───[Workflow1 prompt]──[idle]──[Workflow2 prompt]──[idle]──[Chat prompt]──[idle]──▶
```

### 4.5 Cross-Session Isolation Guarantees

| Concern | Guarantee |
|---|---|
| **Model context** | Each session has its own conversation history — fully isolated |
| **Tool execution** | Tools are registered per-session — sessions can have different toolsets |
| **System prompt** | Set per-session — different workflows get different system prompts |
| **Working directory** | Set via `cwd` in CopilotClient — shared, but file ops are scoped by session's repo path |
| **Abort** | `session.abort()` only affects that session's current turn |
| **Streaming events** | `session.on()` only fires for that session's events |

### 4.6 Resource Limits

```typescript
// packages/core/src/services/SessionService.ts

const MAX_CONCURRENT_SESSIONS = 10;  // configurable

export class SessionService {
  async startSession(sessionId: string): Promise<void> {
    const activeSessions = await this.sessionRepo.countByStatus(['running', 'starting']);
    if (activeSessions >= MAX_CONCURRENT_SESSIONS) {
      throw new ResourceLimitError(
        `Maximum concurrent sessions (${MAX_CONCURRENT_SESSIONS}) reached. ` +
        `Pause or complete an existing session first.`
      );
    }
    // ... proceed with start
  }
}
```

---

## 5. Hooks System Design

### 5.1 Hook Architecture Overview

Hooks are extension points that allow tapping into **both workflow lifecycle phases and Copilot CLI/SDK lifecycle events**. They enable running arbitrary logic (scripts, custom functions, HTTP calls) at specific points without modifying the core engine. This design is influenced by Claude Code's hook system (PreToolUse/PostToolUse/SubagentStart/SubagentStop/Stop) and extended to cover the full Copilot SDK event surface.

**Two categories of hooks:**

1. **Workflow Phase Hooks** — triggered at specific workflow execution phases (pre_run, post_clone, pre_prompt, etc.)
2. **SDK Lifecycle Hooks** — triggered by Copilot CLI/SDK events (tool execution, session events, client lifecycle, permission requests)

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │  HOOKS SYSTEM — DUAL CATEGORY ARCHITECTURE                            │
  │                                                                        │
  │  CATEGORY 1: WORKFLOW PHASE HOOKS                                      │
  │  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐            │
  │  │ PRE_RUN  │  │  RUNNING      │  │  POST_RUN            │            │
  │  │ hooks    │  │  (Copilot SDK │  │  hooks               │            │
  │  │ execute  │──▶  conversation) │──▶  execute             │            │
  │  └──────────┘  └──────────────┘  └──────────────────────┘            │
  │       │                                    │                           │
  │  ── Additional phase hooks: ──                                         │
  │  PRE_CLONE / POST_CLONE / PRE_PROMPT / POST_PROMPT                    │
  │  PRE_COMMIT / POST_COMMIT / ON_ERROR / ON_CANCEL                      │
  │                                                                        │
  │  CATEGORY 2: SDK LIFECYCLE HOOKS (Copilot CLI & SDK events)           │
  │  ┌──────────────────────────────────────────────────────────────┐     │
  │  │  pre_tool_use    → Before Copilot executes any tool          │     │
  │  │  post_tool_use   → After Copilot completes a tool execution  │     │
  │  │  on_message      → When assistant sends a complete message    │     │
  │  │  on_reasoning    → When assistant sends reasoning content     │     │
  │  │  on_session_start → When Copilot session starts              │     │
  │  │  on_session_idle  → When Copilot turn completes (idle)       │     │
  │  │  on_session_error → When Copilot session encounters error    │     │
  │  │  on_client_start  → When Copilot CLI process starts          │     │
  │  │  on_client_stop   → When Copilot CLI process stops           │     │
  │  │  on_client_error  → When Copilot CLI process crashes/errors  │     │
  │  │  on_client_restart → When Copilot CLI auto-restarts          │     │
  │  │  on_permission    → When Copilot requests a permission       │     │
  │  └──────────────────────────────────────────────────────────────┘     │
  │                                                                        │
  │  SDK hooks can:                                                        │
  │  • Inspect event data (tool name, args, results, messages)            │
  │  • Run custom scripts (e.g., lint after file write)                   │
  │  • Send HTTP notifications (e.g., Slack on error)                     │
  │  • Log/audit tool usage                                                │
  │  • Block/modify behavior via 'abort' failure policy                   │
  │  • Pre_tool_use can DENY tool execution (like Claude Code)            │
  │  └──────────────────────────────────────────────────────────────┘     │
  └────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Hook Type Definitions

```typescript
// packages/core/src/domain/value-objects/HookDefinition.ts

export type HookPhase =
  // ── Workflow Phase Hooks ──
  | 'pre_run'            // Before workflow execution starts
  | 'post_run'           // After workflow execution completes
  | 'pre_clone'          // Before repo clone
  | 'post_clone'         // After repo clone
  | 'pre_prompt'         // Before each Copilot prompt send
  | 'post_prompt'        // After each Copilot turn completes (idle)
  | 'pre_commit'         // Before git commit
  | 'post_commit'        // After git commit
  | 'on_error'           // On any workflow error
  | 'on_cancel'          // On workflow cancellation (cleanup)
  // ── SDK Lifecycle Hooks (Copilot CLI & SDK events) ──
  | 'pre_tool_use'       // Before Copilot executes a tool (can block)
  | 'post_tool_use'      // After Copilot completes a tool execution
  | 'on_message'         // When assistant sends a complete message
  | 'on_reasoning'       // When assistant produces reasoning content
  | 'on_session_start'   // When Copilot SDK session starts
  | 'on_session_idle'    // When Copilot SDK turn completes
  | 'on_session_error'   // When Copilot SDK session encounters error
  // ── Copilot CLI Lifecycle Hooks ──
  | 'on_client_start'    // When Copilot CLI process starts
  | 'on_client_stop'     // When Copilot CLI process stops
  | 'on_client_error'    // When Copilot CLI process crashes
  | 'on_client_restart'  // When Copilot CLI auto-restarts after crash
  // ── Permission Hooks ──
  | 'on_permission';     // When Copilot requests a permission (file write, shell exec, etc.)

export type HookType =
  | 'script'        // Execute a shell script / command
  | 'http'          // Make an HTTP request (webhook-out)
  | 'function';     // Execute an inline TypeScript function

export type HookFailurePolicy =
  | 'abort'         // Abort the workflow (mark as failed)
  | 'skip'          // Log failure, continue workflow
  | 'continue';     // Ignore failure entirely

export interface HookDefinition {
  id: string;
  name: string;
  phase: HookPhase;
  type: HookType;
  priority: number;           // Lower = runs first. Default 100.
  enabled: boolean;
  failurePolicy: HookFailurePolicy;
  timeoutMs: number;          // Max execution time. Default 30_000.
  retries: number;            // Retry count on failure. Default 0.
  config: HookConfig;
}

export type HookConfig =
  | ScriptHookConfig
  | HttpHookConfig
  | FunctionHookConfig;

export interface ScriptHookConfig {
  type: 'script';
  command: string;             // e.g., "npm run lint"
  args?: string[];
  cwd?: string;                // relative to workspace root
  env?: Record<string, string>;
}

export interface HttpHookConfig {
  type: 'http';
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: string;       // JSON template with {{variables}}
}

export interface FunctionHookConfig {
  type: 'function';
  /** Path to a .ts/.js module that exports a default async function */
  modulePath: string;
}
```

### 5.3 Hook Executor

```typescript
// packages/core/src/services/HookExecutor.ts

import type { HookDefinition, HookPhase, HookFailurePolicy } from '../domain/value-objects/HookDefinition';

export interface HookContext {
  sessionId: string;
  workflowId: string;
  workspacePath: string;        // absolute path to cloned repo
  variables: Record<string, string>; // template variables for HTTP hooks
  eventBus: EventBus;
}

export class HookExecutor {
  constructor(
    private scriptRunner: IScriptRunner,
    private httpClient: IHttpClient,
    private eventBus: EventBus,
  ) {}

  /**
   * Execute all hooks for a given phase, in priority order.
   * Returns true if workflow should continue, false if it should abort.
   */
  async executePhase(phase: HookPhase, hooks: HookDefinition[], context: HookContext): Promise<boolean> {
    const phaseHooks = hooks
      .filter(h => h.phase === phase && h.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const hook of phaseHooks) {
      this.eventBus.emit(context.sessionId, {
        kind: 'hook.started',
        data: { hookName: hook.name, phase },
      });

      const result = await this.executeHookWithRetry(hook, context);

      if (result.success) {
        this.eventBus.emit(context.sessionId, {
          kind: 'hook.completed',
          data: { hookName: hook.name, phase },
        });
      } else {
        this.eventBus.emit(context.sessionId, {
          kind: 'hook.failed',
          data: { hookName: hook.name, phase, error: result.error! },
        });

        switch (hook.failurePolicy) {
          case 'abort':
            return false; // caller should abort the workflow
          case 'skip':
            break; // continue to next hook
          case 'continue':
            break; // continue silently
        }
      }
    }

    return true; // all hooks passed (or were skipped)
  }

  private async executeHookWithRetry(
    hook: HookDefinition,
    context: HookContext,
  ): Promise<{ success: boolean; error?: string }> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= hook.retries; attempt++) {
      try {
        await this.executeHook(hook, context);
        return { success: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < hook.retries) {
          // Exponential backoff: 1s, 2s, 4s...
          await sleep(1000 * Math.pow(2, attempt));
        }
      }
    }

    return { success: false, error: lastError };
  }

  private async executeHook(hook: HookDefinition, context: HookContext): Promise<void> {
    const timeoutPromise = sleep(hook.timeoutMs).then(() => {
      throw new HookTimeoutError(`Hook '${hook.name}' timed out after ${hook.timeoutMs}ms`);
    });

    const executionPromise = (async () => {
      switch (hook.config.type) {
        case 'script':
          return this.executeScript(hook.config, context);
        case 'http':
          return this.executeHttp(hook.config, context);
        case 'function':
          return this.executeFunction(hook.config, context);
      }
    })();

    await Promise.race([executionPromise, timeoutPromise]);
  }

  private async executeScript(config: ScriptHookConfig, context: HookContext): Promise<void> {
    const cwd = config.cwd
      ? path.resolve(context.workspacePath, config.cwd)
      : context.workspacePath;

    const { exitCode, stdout, stderr } = await this.scriptRunner.run(
      config.command,
      config.args ?? [],
      {
        cwd,
        env: { ...config.env, SESSION_ID: context.sessionId, WORKFLOW_ID: context.workflowId },
        streamTo: (line, stream) => {
          context.eventBus.emit(context.sessionId, {
            kind: stream === 'stdout' ? 'script.stdout' : 'script.stderr',
            data: { line, scriptId: `hook:${config.command}` },
          });
        },
      },
    );

    if (exitCode !== 0) {
      throw new HookScriptError(`Script exited with code ${exitCode}: ${stderr}`);
    }
  }

  private async executeHttp(config: HttpHookConfig, context: HookContext): Promise<void> {
    const body = config.bodyTemplate
      ? this.interpolateTemplate(config.bodyTemplate, context.variables)
      : undefined;

    const response = await this.httpClient.request({
      method: config.method,
      url: config.url,
      headers: config.headers,
      body,
    });

    if (response.status >= 400) {
      throw new HookHttpError(`HTTP hook returned ${response.status}: ${response.body}`);
    }
  }

  private async executeFunction(config: FunctionHookConfig, context: HookContext): Promise<void> {
    const modulePath = path.resolve(context.workspacePath, config.modulePath);
    const mod = await import(modulePath);
    const fn = mod.default ?? mod;
    if (typeof fn !== 'function') {
      throw new HookConfigError(`Module ${config.modulePath} must export a default function`);
    }
    await fn(context);
  }

  private interpolateTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
  }
}
```

### 5.4 Hook Registration (via Workflow Configuration)

Hooks are defined in workflow templates and can be overridden per-session:

```typescript
// Example workflow template with hooks
const codeGenWorkflow: WorkflowTemplate = {
  id: 'code-generation-v1',
  name: 'Code Generation',
  hooks: [
    {
      id: 'lint-check',
      name: 'Run ESLint',
      phase: 'post_prompt',
      type: 'script',
      priority: 100,
      enabled: true,
      failurePolicy: 'skip',
      timeoutMs: 60_000,
      retries: 0,
      config: { type: 'script', command: 'npx', args: ['eslint', '.', '--fix'] },
    },
    {
      id: 'notify-slack',
      name: 'Slack Notification',
      phase: 'post_run',
      type: 'http',
      priority: 200,
      enabled: true,
      failurePolicy: 'continue', // non-critical
      timeoutMs: 10_000,
      retries: 2,
      config: {
        type: 'http',
        url: 'https://hooks.slack.com/services/xxx',
        method: 'POST',
        bodyTemplate: '{"text": "Workflow {{workflowName}} completed for session {{sessionId}}"}',
      },
    },
  ],
  // ... other fields
};
```

### 5.5 SDK Lifecycle Hook Interceptor

The `HookInterceptor` sits between the `CopilotAdapter` event stream and the `EventBus`, intercepting SDK events and executing matching hooks. This is how users tap into Copilot CLI/SDK lifecycle events.

```typescript
// packages/core/src/services/HookInterceptor.ts

import type { AgentEvent, CopilotClientEvent } from '@generatorai/shared';
import type { HookDefinition, HookPhase } from '../domain/value-objects/HookDefinition';

/**
 * Maps SDK events to hook phases and intercepts the event pipeline.
 * Registered hooks run on matching SDK events before the event reaches the EventBus.
 * 
 * Inspired by Claude Code's hook model:
 *   - PreToolUse → our 'pre_tool_use' (can block execution)
 *   - PostToolUse → our 'post_tool_use' (can run scripts/notify)
 *   - Stop → our 'on_session_idle'
 */
export class HookInterceptor {
  constructor(
    private hookExecutor: HookExecutor,
    private eventBus: EventBus,
  ) {}

  /**
   * Wraps a CopilotAdapter's onConversationEvent to intercept SDK events.
   * For each event, matching SDK lifecycle hooks are executed before
   * the event is forwarded to the EventBus.
   */
  createInterceptedEventHandler(
    sessionId: string,
    workflowId: string,
    hooks: HookDefinition[],
    context: HookContext,
  ): (event: AgentEvent) => Promise<void> {
    return async (event: AgentEvent) => {
      const phase = this.mapEventToHookPhase(event);

      if (phase) {
        // Build enriched context with SDK event data
        const enrichedContext: SDKHookContext = {
          ...context,
          sdkEvent: event,
          toolName: this.extractToolName(event),
          toolArgs: this.extractToolArgs(event),
          toolResult: this.extractToolResult(event),
          messageContent: this.extractMessageContent(event),
          errorMessage: this.extractErrorMessage(event),
        };

        // Execute matching hooks for this phase
        const shouldContinue = await this.hookExecutor.executePhase(
          phase,
          hooks,
          enrichedContext,
        );

        // If pre_tool_use hook aborted, we should signal tool denial
        if (!shouldContinue && phase === 'pre_tool_use') {
          this.eventBus.emit(sessionId, {
            kind: 'hook.skipped',
            data: {
              hookName: `pre_tool_use:${this.extractToolName(event)}`,
              phase: 'pre_tool_use',
              reason: 'Hook denied tool execution',
            },
          });
          return; // Do NOT forward the event — tool use was blocked
        }
      }

      // Forward event to EventBus
      await this.eventBus.emit(sessionId, event);
    };
  }

  /**
   * Register hooks for Copilot CLI client lifecycle events.
   * These fire regardless of any specific session/workflow.
   */
  registerClientLifecycleHooks(
    copilot: ICopilotPort,
    hooks: HookDefinition[],
    context: Omit<HookContext, 'workflowId'>,
  ): () => void {
    return copilot.onClientEvent(async (clientEvent: CopilotClientEvent) => {
      const phase = this.mapClientEventToHookPhase(clientEvent);
      if (phase) {
        const clientContext: HookContext = {
          ...context,
          workflowId: '__client__',  // sentinel — not tied to a workflow
          variables: {
            ...context.variables,
            clientEventType: clientEvent.type,
            clientEventMessage: clientEvent.data?.message ?? '',
          },
          eventBus: this.eventBus,
        };

        await this.hookExecutor.executePhase(phase, hooks, clientContext);
      }

      // Also emit as AgentEvent for observability
      const agentEvent = this.mapClientEventToAgentEvent(clientEvent);
      if (agentEvent) {
        // Client events are session-agnostic — emit to a global channel
        await this.eventBus.emitGlobal(agentEvent);
      }
    });
  }

  /** Map SDK conversation events → hook phases */
  private mapEventToHookPhase(event: AgentEvent): HookPhase | null {
    switch (event.kind) {
      case 'copilot.tool_start':       return 'pre_tool_use';
      case 'copilot.tool_complete':    return 'post_tool_use';
      case 'copilot.message_complete': return 'on_message';
      case 'copilot.reasoning_complete': return 'on_reasoning';
      case 'copilot.session_start':    return 'on_session_start';
      case 'copilot.idle':             return 'on_session_idle';
      case 'copilot.error':            return 'on_session_error';
      default:                         return null;
    }
  }

  /** Map client lifecycle events → hook phases */
  private mapClientEventToHookPhase(event: CopilotClientEvent): HookPhase | null {
    switch (event.type) {
      case 'client.started':     return 'on_client_start';
      case 'client.stopped':     return 'on_client_stop';
      case 'client.error':       return 'on_client_error';
      case 'client.restarting':  return 'on_client_restart';
      default:                   return null;
    }
  }

  private mapClientEventToAgentEvent(event: CopilotClientEvent): AgentEvent | null {
    switch (event.type) {
      case 'client.started':    return { kind: 'copilot.client_started', data: {} };
      case 'client.stopped':    return { kind: 'copilot.client_stopped', data: { message: event.data?.message } };
      case 'client.error':      return { kind: 'copilot.client_error', data: { message: event.data?.message ?? 'Unknown error' } };
      case 'client.restarting': return { kind: 'copilot.client_restarting', data: { message: event.data?.message } };
      default:                  return null;
    }
  }

  // ── Event data extractors ──
  private extractToolName(e: AgentEvent): string | undefined {
    if (e.kind === 'copilot.tool_start' || e.kind === 'copilot.tool_complete') return (e.data as any).tool;
    return undefined;
  }
  private extractToolArgs(e: AgentEvent): unknown | undefined {
    if (e.kind === 'copilot.tool_start') return (e.data as any).args;
    return undefined;
  }
  private extractToolResult(e: AgentEvent): unknown | undefined {
    if (e.kind === 'copilot.tool_complete') return (e.data as any).result;
    return undefined;
  }
  private extractMessageContent(e: AgentEvent): string | undefined {
    if (e.kind === 'copilot.message_complete') return (e.data as any).content;
    return undefined;
  }
  private extractErrorMessage(e: AgentEvent): string | undefined {
    if (e.kind === 'copilot.error') return (e.data as any).message;
    return undefined;
  }
}

/** Extended hook context with SDK event data for SDK lifecycle hooks */
export interface SDKHookContext extends HookContext {
  /** The raw SDK event that triggered this hook */
  sdkEvent: AgentEvent;
  /** Tool name (for pre_tool_use / post_tool_use) */
  toolName?: string;
  /** Tool arguments (for pre_tool_use) */
  toolArgs?: unknown;
  /** Tool result (for post_tool_use) */
  toolResult?: unknown;
  /** Message content (for on_message) */
  messageContent?: string;
  /** Error message (for on_session_error / on_client_error) */
  errorMessage?: string;
}
```

### 5.6 Hook Configuration Examples

#### Workflow Phase Hooks (existing)

```typescript
// Example: Lint check after each Copilot prompt
{
  id: 'lint-check',
  name: 'Run ESLint',
  phase: 'post_prompt',
  type: 'script',
  config: { type: 'script', command: 'npx', args: ['eslint', '.', '--fix'] },
}
```

#### SDK Lifecycle Hooks (new — tap into Copilot events)

```typescript
// Example 1: Log all tool usage to a custom analytics endpoint
{
  id: 'tool-analytics',
  name: 'Log Tool Usage',
  phase: 'post_tool_use',
  type: 'http',
  priority: 100,
  enabled: true,
  failurePolicy: 'continue',
  timeoutMs: 5_000,
  retries: 1,
  config: {
    type: 'http',
    url: 'https://analytics.internal/copilot-tools',
    method: 'POST',
    bodyTemplate: '{"tool": "{{toolName}}", "session": "{{sessionId}}", "workflow": "{{workflowId}}"}',
  },
}

// Example 2: Block dangerous tool execution (like Claude Code's PreToolUse)
{
  id: 'block-rm-rf',
  name: 'Block Dangerous Shell Commands',
  phase: 'pre_tool_use',
  type: 'function',
  priority: 1,  // Run first
  enabled: true,
  failurePolicy: 'abort',  // Abort = deny tool execution
  timeoutMs: 1_000,
  retries: 0,
  config: {
    type: 'function',
    modulePath: './hooks/block-dangerous-tools.ts',
    // Module exports: (ctx: SDKHookContext) => {
    //   if (ctx.toolName === 'shell' && String(ctx.toolArgs).includes('rm -rf')) {
    //     throw new Error('Blocked dangerous command');
    //   }
    // }
  },
}

// Example 3: Run custom validation after each assistant message
{
  id: 'validate-output',
  name: 'Validate Assistant Output',
  phase: 'on_message',
  type: 'function',
  priority: 100,
  enabled: true,
  failurePolicy: 'skip',
  timeoutMs: 10_000,
  retries: 0,
  config: {
    type: 'function',
    modulePath: './hooks/validate-output.ts',
    // Module exports: (ctx: SDKHookContext) => {
    //   // Check assistant message for quality, compliance, etc.
    //   console.log('Assistant said:', ctx.messageContent);
    // }
  },
}

// Example 4: Notify Slack on Copilot CLI crash/restart
{
  id: 'cli-crash-notify',
  name: 'Notify on CLI Crash',
  phase: 'on_client_error',
  type: 'http',
  priority: 1,
  enabled: true,
  failurePolicy: 'continue',
  timeoutMs: 5_000,
  retries: 2,
  config: {
    type: 'http',
    url: 'https://hooks.slack.com/services/xxx',
    method: 'POST',
    bodyTemplate: '{"text": "⚠️ Copilot CLI crashed: {{clientEventMessage}}"}',
  },
}

// Example 5: Audit permission requests
{
  id: 'permission-audit',
  name: 'Audit Permission Requests',
  phase: 'on_permission',
  type: 'function',
  priority: 1,
  enabled: true,
  failurePolicy: 'continue',
  timeoutMs: 2_000,
  retries: 0,
  config: {
    type: 'function',
    modulePath: './hooks/audit-permissions.ts',
  },
}
```

### 5.7 Integration with WorkflowService

The `WorkflowService` uses `HookInterceptor` to wire SDK lifecycle hooks into the event pipeline:

```typescript
// In WorkflowService.startWorkflow() — updated integration

// 4. Subscribe to events via HookInterceptor (replaces direct subscription)
const interceptor = new HookInterceptor(this.hookExecutor, this.eventBus);
const interceptedHandler = interceptor.createInterceptedEventHandler(
  session.id,
  workflowId,
  config.hooks,  // includes both workflow phase hooks AND SDK lifecycle hooks
  hookCtx,
);

const unsubscribe = this.copilot.onConversationEvent(conversationId, interceptedHandler);
```

### 5.8 EventBus Global Channel for Client Lifecycle Events

```typescript
// packages/core/src/events/EventBus.ts — new method

export class EventBus {
  // ... existing per-session emit/subscribe ...

  /** Emit a global event not tied to any session (e.g., client lifecycle) */
  async emitGlobal(event: AgentEvent): Promise<void> {
    const persisted = await this.eventRepo.persistGlobal({
      kind: event.kind,
      data: event.data,
      timestamp: Date.now(),
    });
    
    // Notify all global subscribers
    for (const handler of this.globalHandlers) {
      handler(persisted);
    }
  }

  /** Subscribe to global events (client lifecycle, etc.) */
  subscribeGlobal(handler: (event: PersistedEvent) => void): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  private globalHandlers = new Set<(event: PersistedEvent) => void>();
}
```

---

## 6. Platform Abstraction Layer

### 6.1 Architecture Goal

The same core business logic (session management, workflow execution, Copilot SDK integration) must work across four interfaces: Web, Desktop, CLI, and Webhook. The UI code (React components) should be shared between Web and Desktop with minimal platform branching.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PLATFORM ABSTRACTION MODEL                          │
│                                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│  │   Web    │ │ Desktop  │ │   CLI    │ │ Webhook  │   ← Interfaces   │
│  │ (React)  │ │(Electron)│ │  (Ink)   │ │ (HTTP)   │                  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘                  │
│       │             │            │             │                        │
│       ▼             ▼            ▼             ▼                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    IPlatformClient interface                      │  │
│  │  createSession() · startSession() · pauseSession() · ...        │  │
│  │  subscribeToEvents() · sendPrompt() · getWorkflows() · ...      │  │
│  └─────────┬──────────────┬──────────────┬─────────────────────────┘  │
│            │              │              │                              │
│       ┌────▼─────┐  ┌────▼─────┐  ┌────▼──────┐                      │
│       │ HttpClient│  │ IPCClient│  │DirectClient│  ← Implementations  │
│       │ (Web)    │  │ (Desktop)│  │ (CLI/Hook) │                      │
│       └────┬─────┘  └────┬─────┘  └────┬──────┘                      │
│            │              │              │                              │
│            ▼              ▼              ▼                              │
│  ┌──────────┐   ┌─────────────┐  ┌──────────────┐                    │
│  │ Server   │   │ Electron    │  │  In-process   │                    │
│  │ HTTP API │   │ Main Process│  │ core services │                    │
│  │ + SSE    │   │ IPC Bridge  │  │ (no server)   │                    │
│  └──────────┘   └─────────────┘  └──────────────┘                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 IPlatformClient Interface

```typescript
// packages/shared/src/types/IPlatformClient.ts

export interface IPlatformClient {
  // ── Platform Info ──
  readonly platform: 'web' | 'desktop' | 'cli' | 'webhook';

  // ── Session Management ──
  createSession(params: CreateSessionParams): Promise<Session>;
  getSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session>;
  startSession(id: string): Promise<void>;
  pauseSession(id: string): Promise<void>;
  resumeSession(id: string): Promise<void>;
  cancelSession(id: string): Promise<void>;
  deleteSession(id: string): Promise<void>;

  // ── Workflow Management ──
  getWorkflows(sessionId: string): Promise<Workflow[]>;
  pauseWorkflow(workflowId: string): Promise<void>;
  resumeWorkflow(workflowId: string): Promise<void>;

  // ── Chat ──
  sendPrompt(sessionId: string, prompt: string, attachments?: File[]): Promise<void>;
  getChatHistory(sessionId: string): Promise<ChatMessage[]>;

  // ── Event Streaming ──
  subscribeToEvents(sessionId: string, handler: (event: PersistedEvent) => void): Unsubscribe;
  subscribeToSessionList(handler: (sessions: Session[]) => void): Unsubscribe;

  // ── Templates ──
  getWorkflowTemplates(): Promise<WorkflowTemplate[]>;

  // ── Artifacts ──
  getArtifacts(sessionId: string): Promise<Artifact[]>;
  downloadArtifact(artifactId: string): Promise<Blob | Buffer>;

  // ── Platform-specific (optional) ──
  selectDirectory?(): Promise<string | null>;  // Desktop/CLI only
  openInEditor?(filePath: string): Promise<void>;  // Desktop only
}

export type Unsubscribe = () => void;
```

### 6.3 Web Implementation (HTTP + SSE)

```typescript
// apps/web/src/platform/HttpPlatformClient.ts

export class HttpPlatformClient implements IPlatformClient {
  readonly platform = 'web' as const;
  private baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async createSession(params: CreateSessionParams): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async startSession(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/sessions/${id}/start`, { method: 'POST' });
  }

  subscribeToEvents(sessionId: string, handler: (event: PersistedEvent) => void): Unsubscribe {
    const source = new EventSource(`${this.baseUrl}/api/sessions/${sessionId}/stream`);

    // Listen to all event kinds
    source.onmessage = (e) => {
      handler(JSON.parse(e.data));
    };

    // Also listen by event name for typed handling
    const kinds: AgentEventKind[] = [
      'copilot.token', 'copilot.message_complete', 'workflow.started',
      'workflow.completed', 'session.completed', /* ... */
    ];
    for (const kind of kinds) {
      source.addEventListener(kind, (e: MessageEvent) => {
        handler({ kind, sequenceId: parseInt(e.lastEventId), data: JSON.parse(e.data), sessionId, timestamp: Date.now(), id: 0 });
      });
    }

    return () => source.close();
  }

  async sendPrompt(sessionId: string, prompt: string, attachments?: File[]): Promise<void> {
    const formData = new FormData();
    formData.append('prompt', prompt);
    if (attachments) {
      for (const file of attachments) {
        formData.append('attachments', file);
      }
    }
    await fetch(`${this.baseUrl}/api/sessions/${sessionId}/prompt`, {
      method: 'POST',
      body: formData,
    });
  }

  // ... other methods follow same pattern
}
```

### 6.4 Desktop Implementation (Electron IPC)

```typescript
// apps/desktop/src/preload/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('platform', {
  platform: 'desktop',
  createSession: (params: any) => ipcRenderer.invoke('session:create', params),
  startSession: (id: string) => ipcRenderer.invoke('session:start', id),
  pauseSession: (id: string) => ipcRenderer.invoke('session:pause', id),
  // ... all IPlatformClient methods mapped to IPC

  subscribeToEvents: (sessionId: string, handler: Function) => {
    const channel = `session:events:${sessionId}`;
    const listener = (_event: any, data: any) => handler(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  openInEditor: (path: string) => ipcRenderer.invoke('shell:openInEditor', path),
} satisfies IPlatformClient);
```

```typescript
// apps/desktop/src/main/ipc-handlers.ts
import { ipcMain, dialog } from 'electron';
import { createContainer } from './composition-root';

export function registerIpcHandlers(container: ReturnType<typeof createContainer>) {
  const { sessionService, workflowService, chatService, eventBus } = container;

  ipcMain.handle('session:create', async (_, params) => {
    return sessionService.createSession(params);
  });

  ipcMain.handle('session:start', async (_, id) => {
    return sessionService.startSession(id);
  });

  // Forward events to renderer
  eventBus.subscribeAll((event) => {
    mainWindow.webContents.send(`session:events:${event.sessionId}`, event);
  });

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
}
```

### 6.5 CLI Implementation (Direct In-Process)

The CLI runs on the user's machine — it doesn't need HTTP or IPC. It calls core services directly.

```typescript
// apps/cli/src/platform/DirectPlatformClient.ts

import { createContainer } from './composition-root';

export class DirectPlatformClient implements IPlatformClient {
  readonly platform = 'cli' as const;
  private container: ReturnType<typeof createContainer>;

  constructor() {
    this.container = createContainer({ dbPath: '~/.generatorai/data.db', ... });
  }

  async initialize(): Promise<void> {
    await this.container.initialize();
  }

  async createSession(params: CreateSessionParams): Promise<Session> {
    return this.container.sessionService.createSession(params);
  }

  async startSession(id: string): Promise<void> {
    return this.container.sessionService.startSession(id);
  }

  subscribeToEvents(sessionId: string, handler: (event: PersistedEvent) => void): Unsubscribe {
    // Direct EventBus subscription — no HTTP/SSE overhead
    return this.container.eventBus.subscribe(sessionId, handler);
  }

  selectDirectory(): Promise<string | null> {
    // CLI: use inquirer or simple path input
    // Or accept from command-line argument
    return Promise.resolve(process.cwd());
  }

  // ... all other methods delegate to container services directly
}
```

### 6.6 Key Architectural Difference: CLI vs Web/Desktop

```
  WEB / DESKTOP                           CLI
  ─────────────                           ───
  Client ──HTTP/IPC──▶ Server             Client IS the Server
  React renders UI    Server runs core     Ink renders TUI
  SSE for streaming   EventBus → SSE      EventBus → direct callback
  Session DB on server Session DB local    Session DB local
  Server manages       Server manages      CLI manages
  Copilot SDK          Copilot SDK         Copilot SDK directly
```

The CLI doesn't need a separate server process. It instantiates the `packages/core` services directly, the same way the server does, but in-process. This is why the core logic is in a shared package, not embedded in the server app.

### 6.7 Shared React Components (Web + Desktop)

```typescript
// packages/ui/src/hooks/usePlatform.ts

import type { IPlatformClient } from '@generatorai/shared';

const PlatformContext = React.createContext<IPlatformClient | null>(null);

export const PlatformProvider = PlatformContext.Provider;

export function usePlatform(): IPlatformClient {
  const ctx = React.useContext(PlatformContext);
  if (!ctx) throw new Error('PlatformProvider not found');
  return ctx;
}
```

```typescript
// packages/ui/src/components/SessionView.tsx — works on Web AND Desktop unchanged

export function SessionView({ sessionId }: { sessionId: string }) {
  const platform = usePlatform();
  const [events, setEvents] = useState<PersistedEvent[]>([]);
  const [streamText, setStreamText] = useState('');

  useEffect(() => {
    const unsub = platform.subscribeToEvents(sessionId, (event) => {
      if (event.kind === 'copilot.token') {
        setStreamText(prev => prev + event.data.text);
      }
      setEvents(prev => [...prev, event]);
    });
    return unsub;
  }, [sessionId, platform]);

  return (
    <div>
      <EventList events={events} />
      <StreamingText text={streamText} />
      {platform.platform === 'desktop' && (
        <button onClick={() => platform.openInEditor?.('/some/file')}>
          Open in Editor
        </button>
      )}
    </div>
  );
}
```

---

## 7. Codebase Management

### 7.1 Subsystem Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                  CODEBASE MANAGEMENT SUBSYSTEM                       │
│                                                                      │
│  ┌───────────────┐                                                  │
│  │ CodebaseService│ (Application Layer)                              │
│  │               │                                                  │
│  │ cloneRepo()   │──▶ GitManager.clone()                           │
│  │ setupRepo()   │──▶ ScriptRunner.run(setupScript)                │
│  │ cleanupRepo() │──▶ fs.rm(workDir)                               │
│  │ createPR()    │──▶ GitManager.commitAndPush() → GhCli.createPR()│
│  └───────┬───────┘                                                  │
│          │                                                           │
│  ┌───────▼──────────────────────────────────────────────────────┐   │
│  │ Workspace Directory Structure                                 │   │
│  │                                                               │   │
│  │ <workspacesDir>/                                              │   │
│  │ ├── <sessionId>/                                              │   │
│  │ │   ├── repo/              ← cloned repository                │   │
│  │ │   ├── artifacts/         ← generated files, outputs         │   │
│  │ │   └── .metadata.json     ← clone metadata (url, branch)    │   │
│  │ ├── <sessionId>/                                              │   │
│  │ │   └── ...                                                   │   │
│  │ └── .gitkeep                                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 GitManager

```typescript
// packages/core/src/services/GitManager.ts

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import type { EventBus } from '../events/EventBus';

export interface CloneOptions {
  repoUrl: string;
  branch?: string;       // default: default branch
  depth?: number;        // shallow clone depth (1 for quick, undefined for full)
  targetDir: string;     // absolute path
}

export class GitManager {
  constructor(
    private workspacesDir: string,
    private eventBus: EventBus,
  ) {}

  /** Resolve the workspace directory for a session */
  getSessionWorkspace(sessionId: string): string {
    return path.join(this.workspacesDir, sessionId);
  }

  getRepoDir(sessionId: string): string {
    return path.join(this.getSessionWorkspace(sessionId), 'repo');
  }

  getArtifactsDir(sessionId: string): string {
    return path.join(this.getSessionWorkspace(sessionId), 'artifacts');
  }

  /** Clone a repository for a session */
  async clone(sessionId: string, options: CloneOptions): Promise<string> {
    const repoDir = this.getRepoDir(sessionId);
    await fs.mkdir(repoDir, { recursive: true });

    this.eventBus.emit(sessionId, {
      kind: 'git.clone_start',
      data: { repoUrl: options.repoUrl },
    });

    const args = ['clone', '--progress'];
    if (options.branch) args.push('--branch', options.branch);
    if (options.depth) args.push('--depth', String(options.depth));
    args.push(options.repoUrl, repoDir);

    await this.execGit(sessionId, args, this.workspacesDir);

    // Write metadata
    await fs.writeFile(
      path.join(this.getSessionWorkspace(sessionId), '.metadata.json'),
      JSON.stringify({
        repoUrl: options.repoUrl,
        branch: options.branch,
        clonedAt: new Date().toISOString(),
      }),
    );

    this.eventBus.emit(sessionId, {
      kind: 'git.clone_complete',
      data: { localPath: repoDir },
    });

    return repoDir;
  }

  /** Stage, commit, and push changes */
  async commitAndPush(sessionId: string, message: string, branch?: string): Promise<string> {
    const repoDir = this.getRepoDir(sessionId);

    if (branch) {
      await this.execGit(sessionId, ['checkout', '-b', branch], repoDir);
    }

    await this.execGit(sessionId, ['add', '-A'], repoDir);
    await this.execGit(sessionId, ['commit', '-m', message], repoDir);

    const sha = await this.execGitOutput(['rev-parse', 'HEAD'], repoDir);

    this.eventBus.emit(sessionId, {
      kind: 'git.commit',
      data: { sha: sha.trim(), message },
    });

    await this.execGit(sessionId, ['push', '-u', 'origin', branch ?? 'HEAD'], repoDir);

    this.eventBus.emit(sessionId, {
      kind: 'git.push',
      data: { branch: branch ?? 'HEAD' },
    });

    return sha.trim();
  }

  /** Create a pull request using GitHub CLI */
  async createPullRequest(
    sessionId: string,
    title: string,
    body: string,
    baseBranch?: string,
  ): Promise<{ url: string; number: number }> {
    const repoDir = this.getRepoDir(sessionId);
    const args = ['pr', 'create', '--title', title, '--body', body];
    if (baseBranch) args.push('--base', baseBranch);

    const output = await this.execGhCli(sessionId, args, repoDir);
    // gh pr create outputs the PR URL
    const url = output.trim();
    const prNumber = parseInt(url.split('/').pop() ?? '0');

    this.eventBus.emit(sessionId, {
      kind: 'git.pr_created',
      data: { url, number: prNumber },
    });

    return { url, number: prNumber };
  }

  /** Clean up workspace for a session */
  async cleanup(sessionId: string): Promise<void> {
    const workspace = this.getSessionWorkspace(sessionId);
    await fs.rm(workspace, { recursive: true, force: true });
  }

  // ── Private Helpers ──

  private execGit(sessionId: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stderr?.on('data', (data: Buffer) => {
        const line = data.toString();
        // Git progress goes to stderr
        const progressMatch = line.match(/(\d+)%/);
        if (progressMatch) {
          this.eventBus.emit(sessionId, {
            kind: 'git.clone_progress',
            data: { percent: parseInt(progressMatch[1]), message: line.trim() },
          });
        }
        // Stream all git output
        this.eventBus.emit(sessionId, {
          kind: 'script.stderr',
          data: { line: line.trim(), scriptId: 'git' },
        });
      });

      proc.on('exit', (code) => {
        code === 0 ? resolve() : reject(new GitError(`git ${args[0]} failed with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  private execGhCli(sessionId: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('gh', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        this.eventBus.emit(sessionId, {
          kind: 'script.stderr',
          data: { line: data.toString().trim(), scriptId: 'gh' },
        });
      });

      proc.on('exit', (code) => {
        code === 0 ? resolve(output) : reject(new GitError(`gh ${args[0]} failed with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  private async execGitOutput(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
      proc.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`git failed`)));
      proc.on('error', reject);
    });
  }
}
```

### 7.3 Integration with Session Lifecycle

```typescript
// packages/core/src/services/SessionService.ts (excerpt)

async startSession(sessionId: string): Promise<void> {
  const session = await this.sessionRepo.getById(sessionId);
  const sm = new SessionStateMachine(session.status);
  sm.transition('user:start');
  await this.sessionRepo.updateStatus(sessionId, 'starting');

  try {
    // Phase 1: Codebase setup (if required)
    if (session.requiresCodebase && session.repoUrl) {
      await this.eventBus.emit(sessionId, { kind: 'session.starting', data: { sessionId } });

      const repoDir = await this.gitManager.clone(sessionId, {
        repoUrl: session.repoUrl,
        targetDir: this.gitManager.getRepoDir(sessionId),
      });

      // Run post-clone hooks (e.g., npm install)
      const hooks = await this.getSessionHooks(sessionId);
      const hookCtx = { sessionId, workflowId: '', workspacePath: repoDir, variables: {}, eventBus: this.eventBus };
      const hookOk = await this.hookExecutor.executePhase('post_clone', hooks, hookCtx);
      if (!hookOk) throw new HookAbortError('post_clone hook aborted');
    }

    // Phase 2: Start first workflow
    sm.transition('sys:started');
    await this.sessionRepo.updateStatus(sessionId, 'running');

    const workflows = await this.workflowRepo.getBySessionId(sessionId);
    const sorted = workflows.sort((a, b) => a.order - b.order);

    // Move all to queued
    for (const wf of sorted) {
      await this.workflowRepo.updateStatus(wf.id, 'queued');
    }

    // Start first one
    if (sorted.length > 0) {
      await this.workflowService.startWorkflow(sorted[0].id);
    } else {
      // No workflows — go straight to completed (chat mode)
      await this.sessionRepo.updateStatus(sessionId, 'completed');
    }

    this.eventBus.emit(sessionId, { kind: 'session.running', data: { sessionId } });
  } catch (err) {
    sm.transition('sys:start_fail');
    await this.sessionRepo.updateStatus(sessionId, 'created');
    this.eventBus.emit(sessionId, {
      kind: 'session.error',
      data: { sessionId, message: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
```

### 7.4 Cleanup Protocol

```
  Session DELETED or COMPLETED+TTL:
  
  1. sessionService.deleteSession(id)
  2.   → copilot.destroyConversation(id)     // free SDK session
  3.   → gitManager.cleanup(id)              // rm -rf workspace/<id>/
  4.   → eventRepo.deleteBySession(id)       // (optional: keep for audit)
  5.   → sessionRepo.delete(id)              // remove from DB
  6.   → artifactRepo.deleteBySession(id)    // remove artifact records
```

Cleanup is idempotent. Any step can fail without corrupting state — the session is already marked `deleted` in the DB.

---

## 8. Artifact & Attachment System

### 8.1 Inbound Attachments (User → Copilot SDK)

```
  User uploads file              Server receives          SDK gets file ref
  ──────────────────            ─────────────────        ──────────────────
  
  Web:   FormData POST    ──▶   Save to session's    ──▶  session.send({
  Desktop: IPC + fs path         artifacts/<name>          attachments: [{
  CLI:   file path arg                                       type:'file',
                                                             path: savedPath
                                                           }]
                                                         })
```

```typescript
// packages/core/src/services/AttachmentService.ts

export class AttachmentService {
  constructor(
    private gitManager: GitManager,
    private artifactRepo: IArtifactRepository,
  ) {}

  /**
   * Store an uploaded file in the session workspace and return
   * the local path for Copilot SDK attachment.
   */
  async storeUpload(sessionId: string, fileName: string, content: Buffer): Promise<string> {
    const dir = this.gitManager.getArtifactsDir(sessionId);
    await fs.mkdir(dir, { recursive: true });

    // Sanitize filename
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(dir, `upload_${Date.now()}_${safeName}`);
    await fs.writeFile(filePath, content);

    // Record in DB
    await this.artifactRepo.create({
      id: generateId(),
      sessionId,
      name: fileName,
      path: filePath,
      mimeType: mime.getType(fileName) ?? 'application/octet-stream',
      size: content.length,
      direction: 'inbound',
      createdAt: new Date(),
    });

    return filePath;  // This path is what we pass to Copilot SDK
  }

  /**
   * Convert session attachment refs to Copilot SDK format.
   */
  toCopilotAttachments(filePaths: string[]): AttachmentRef[] {
    return filePaths.map(p => ({
      type: 'file' as const,
      path: p,
      displayName: path.basename(p),
    }));
  }
}
```

### 8.2 Outbound Artifacts (Copilot SDK / Scripts → User)

Generated artifacts are files created by Copilot (via tool execution) or by hook scripts. They're stored in the workspace and tracked in the DB.

```typescript
// Detect new artifacts by watching the workspace directory
// OR by intercepting tool.execution_complete events for file-write tools

export class ArtifactWatcher {
  private watcher: FSWatcher | null = null;

  /**
   * Watch a session's repo directory for new/modified files.
   * Called when a workflow starts.
   */
  async startWatching(sessionId: string, repoDir: string): Promise<void> {
    // Use chokidar for cross-platform file watching
    const chokidar = await import('chokidar');

    this.watcher = chokidar.watch(repoDir, {
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.git/**'],
    });

    this.watcher.on('add', async (filePath) => {
      await this.registerArtifact(sessionId, filePath, 'created');
    });

    this.watcher.on('change', async (filePath) => {
      await this.registerArtifact(sessionId, filePath, 'modified');
    });
  }

  private async registerArtifact(sessionId: string, filePath: string, action: string): Promise<void> {
    const stat = await fs.stat(filePath);
    const artifact = await this.artifactRepo.upsert({
      id: generateId(),
      sessionId,
      name: path.basename(filePath),
      path: filePath,
      mimeType: mime.getType(filePath) ?? 'application/octet-stream',
      size: stat.size,
      direction: 'outbound',
      createdAt: new Date(),
    });

    this.eventBus.emit(sessionId, {
      kind: 'artifact.created',
      data: { artifactId: artifact.id, name: artifact.name, mimeType: artifact.mimeType },
    });
  }

  async stopWatching(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
```

### 8.3 Serving Artifacts to UI

```typescript
// apps/server/src/routes/artifacts.ts

router.get('/api/sessions/:sessionId/artifacts', async (req, res) => {
  const artifacts = await artifactService.getBySession(req.params.sessionId);
  res.json(artifacts.map(a => ({
    id: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    downloadUrl: `/api/artifacts/${a.id}/download`,
    createdAt: a.createdAt,
  })));
});

router.get('/api/artifacts/:id/download', async (req, res) => {
  const artifact = await artifactService.getById(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Not found' });

  res.setHeader('Content-Type', artifact.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${artifact.name}"`);
  res.setHeader('Content-Length', artifact.size);

  const stream = createReadStream(artifact.path);
  stream.pipe(res);
});
```

### 8.4 Persistence to DB (Optional: Store File Content in SQLite)

For small artifacts (< 1MB), we can optionally store content directly in SQLite as a BLOB for portability. For large files, keep on filesystem and store only the path.

```typescript
// packages/db/src/schema.ts

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  path: text('path').notNull(),                // filesystem path
  mimeType: text('mime_type'),
  size: integer('size').notNull(),
  direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
  content: blob('content', { mode: 'buffer' }),  // nullable — only for small files
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

---

## 9. Error Handling Strategy

### 9.1 Error Taxonomy

```typescript
// packages/shared/src/errors/index.ts

/** Base error with classification */
export abstract class GeneratorAIError extends Error {
  abstract readonly category: ErrorCategory;
  abstract readonly severity: ErrorSeverity;
  abstract readonly recoverable: boolean;
  readonly timestamp = Date.now();

  constructor(message: string, public readonly code: string, public readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;
  }
}

export type ErrorCategory =
  | 'copilot'      // Copilot SDK / CLI errors
  | 'network'      // HTTP, SSE, connectivity errors
  | 'process'      // Child process, spawn, git/gh failures
  | 'storage'      // SQLite, filesystem errors
  | 'validation'   // Input validation, schema errors
  | 'state'        // Invalid state transitions
  | 'resource'     // Resource limits (max sessions, disk space)
  | 'hook'         // Hook execution failures
  | 'user';        // User-facing logical errors

export type ErrorSeverity =
  | 'fatal'        // Application must stop (DB corruption, OOM)
  | 'error'        // Operation failed, session/workflow affected
  | 'warning'      // Degraded but operational (hook skipped, slow clone)
  | 'info';        // User action blocked (validation failure)
```

### 9.2 Concrete Error Classes

```typescript
// ── Copilot Errors ──
export class CopilotConnectionError extends GeneratorAIError {
  readonly category = 'copilot';
  readonly severity = 'error';
  readonly recoverable = true; // autoRestart will handle
  constructor(message: string, cause?: Error) { super(message, 'COPILOT_CONNECTION', cause); }
}

export class CopilotSessionError extends GeneratorAIError {
  readonly category = 'copilot';
  readonly severity = 'error';
  readonly recoverable = false; // session may be corrupted
  constructor(message: string, cause?: Error) { super(message, 'COPILOT_SESSION', cause); }
}

export class CopilotTimeoutError extends GeneratorAIError {
  readonly category = 'copilot';
  readonly severity = 'warning';
  readonly recoverable = true; // can retry the prompt
  constructor(message: string) { super(message, 'COPILOT_TIMEOUT'); }
}

// ── Process Errors ──
export class GitError extends GeneratorAIError {
  readonly category = 'process';
  readonly severity = 'error';
  readonly recoverable = true; // can retry clone
  constructor(message: string, cause?: Error) { super(message, 'GIT_ERROR', cause); }
}

export class ScriptError extends GeneratorAIError {
  readonly category = 'process';
  readonly severity = 'error';
  readonly recoverable = false;
  constructor(message: string, public exitCode: number) { super(message, 'SCRIPT_ERROR'); }
}

// ── State Errors ──
export class InvalidTransitionError extends GeneratorAIError {
  readonly category = 'state';
  readonly severity = 'info';
  readonly recoverable = false; // user needs to change approach
  constructor(message: string) { super(message, 'INVALID_TRANSITION'); }
}

// ── Validation Errors ──
export class ValidationError extends GeneratorAIError {
  readonly category = 'validation';
  readonly severity = 'info';
  readonly recoverable = false;
  constructor(message: string, public fields?: Record<string, string[]>) {
    super(message, 'VALIDATION_ERROR');
  }
}

// ── Resource Errors ──
export class ResourceLimitError extends GeneratorAIError {
  readonly category = 'resource';
  readonly severity = 'warning';
  readonly recoverable = true; // user can free resources
  constructor(message: string) { super(message, 'RESOURCE_LIMIT'); }
}

// ── Hook Errors ──
export class HookTimeoutError extends GeneratorAIError {
  readonly category = 'hook';
  readonly severity = 'warning';
  readonly recoverable = true;
  constructor(message: string) { super(message, 'HOOK_TIMEOUT'); }
}

export class HookAbortError extends GeneratorAIError {
  readonly category = 'hook';
  readonly severity = 'error';
  readonly recoverable = false;
  constructor(message: string) { super(message, 'HOOK_ABORT'); }
}

// ── Security Errors ──
export class SecurityError extends GeneratorAIError {
  readonly category = 'validation';
  readonly severity = 'error';
  readonly recoverable = false;
  constructor(message: string) { super(message, 'SECURITY_VIOLATION'); }
}

// ── Storage Errors ──
export class StorageError extends GeneratorAIError {
  readonly category = 'storage';
  readonly severity = 'error';
  readonly recoverable = false;
  constructor(message: string, cause?: Error) { super(message, 'STORAGE_ERROR', cause); }
}
```

### 9.3 Error Handling Matrix

| Error Type | Detection | Recovery Action | UI Surfacing |
|---|---|---|---|
| **Copilot CLI not installed** | `ENOENT` on spawn | Fatal — show setup instructions | Modal: "Copilot CLI not found. Install it with..." |
| **Copilot CLI crash** | `autoRestart` → client state `error` | Auto-restart + `resumeSession` for active sessions | Toast: "Copilot agent restarting..." + auto-recovery |
| **Copilot session error** | `session.error` event | Log, emit `copilot.error` event, mark workflow as failed | Chat bubble: "Error: {message}" with retry button |
| **Copilot timeout** | `sendAndWait` timeout | Abort + retry once. If still fails, pause workflow. | Chat bubble: "Response timed out. Retrying..." |
| **Network disconnect (SSE)** | EventSource `error` event | Auto-reconnect with `Last-Event-ID` (built-in) | Banner: "Reconnecting..." → replays missed events |
| **Git clone failure** | Non-zero exit code | Retry with exponential backoff (3 times). Then fail session start. | Event stream: git stderr output + error toast |
| **Git auth failure** | `128` exit + "Authentication" in stderr | Prompt user to run `gh auth login` | Modal: "GitHub authentication required" |
| **Script failure** | Non-zero exit code | Depends on hook `failurePolicy` | Stream stderr to chat, mark hook as failed |
| **SQLite error** | Synchronous exception | Fatal for writes, retry for reads | Error page: "Database error. Check disk space." |
| **Invalid state transition** | `InvalidTransitionError` | Block the action, inform user | Toast: "Cannot pause — session is not running" |
| **Validation error** | Zod parse failure | Return 400, highlight fields | Form validation errors inline |
| **Max sessions reached** | `ResourceLimitError` | Block creation | Toast: "Max 10 concurrent sessions. Close one first." |

### 9.4 Error Pipeline

```typescript
// packages/core/src/services/ErrorHandler.ts

export class ErrorHandler {
  constructor(
    private eventBus: EventBus,
    private logger: ILogger,
  ) {}

  /** Central error handler. All caught errors flow through here. */
  handle(error: unknown, context: { sessionId?: string; workflowId?: string }): void {
    const gaiError = this.normalize(error);

    // 1. Log with context
    this.logger[gaiError.severity](
      `[${gaiError.category}:${gaiError.code}] ${gaiError.message}`,
      { sessionId: context.sessionId, workflowId: context.workflowId, stack: gaiError.stack },
    );

    // 2. Surface to UI via event stream
    if (context.sessionId) {
      this.eventBus.emit(context.sessionId, {
        kind: 'session.error',
        data: {
          sessionId: context.sessionId,
          message: gaiError.message,
          code: gaiError.code,
          category: gaiError.category,
          recoverable: gaiError.recoverable,
        },
      });
    }

    // 3. Trigger recovery if possible
    if (gaiError.recoverable) {
      this.attemptRecovery(gaiError, context);
    }
  }

  private normalize(error: unknown): GeneratorAIError {
    if (error instanceof GeneratorAIError) return error;

    if (error instanceof Error) {
      // Map common Node.js errors
      if ((error as any).code === 'ENOENT') {
        return new ProcessNotFoundError(`Process not found: ${error.message}`, error);
      }
      if ((error as any).code === 'ECONNREFUSED') {
        return new CopilotConnectionError(`Connection refused: ${error.message}`, error);
      }
      return new UnknownError(error.message, error);
    }

    return new UnknownError(String(error));
  }

  private attemptRecovery(error: GeneratorAIError, context: { sessionId?: string }): void {
    switch (error.code) {
      case 'COPILOT_CONNECTION':
        // CopilotAdapter handles this via auto-restart monitoring
        break;
      case 'COPILOT_TIMEOUT':
        // Could queue a retry - handled at WorkflowService level
        break;
      case 'GIT_ERROR':
        // Log for debugging, user can retry manually
        break;
    }
  }
}
```

### 9.5 API Error Responses

```typescript
// apps/server/src/middleware/errorMiddleware.ts

export function errorMiddleware(err: Error, req: Request, res: Response, next: NextFunction): void {
  const gaiError = err instanceof GeneratorAIError
    ? err
    : new UnknownError(err.message, err);

  const statusCode = ERROR_STATUS_MAP[gaiError.category] ?? 500;

  res.status(statusCode).json({
    error: {
      code: gaiError.code,
      category: gaiError.category,
      message: gaiError.message,
      recoverable: gaiError.recoverable,
      // Never include stack traces in production
      ...(process.env.NODE_ENV === 'development' ? { stack: gaiError.stack } : {}),
    },
  });
}

const ERROR_STATUS_MAP: Record<ErrorCategory, number> = {
  validation: 400,
  state: 409,
  user: 400,
  resource: 429,
  copilot: 502,
  network: 503,
  process: 502,
  storage: 500,
  hook: 502,
};
```

---

## 10. Configuration Architecture

### 10.1 Configuration Layers

```
  Priority (highest wins)
  ────────────────────────

  1. Environment Variables       GENERATORAI_DB_PATH=/custom/path.db
  2. CLI Arguments               --port 3001 --max-sessions 20
  3. User Config File            ~/.generatorai/config.json
  4. Project Config File         .generatorai/config.json (in workspace)
  5. Default Values              Hardcoded in schema
```

### 10.2 Configuration Schema

```typescript
// packages/shared/src/config/AppConfig.ts

import { z } from 'zod';

// ── Application-level Config ──
export const AppConfigSchema = z.object({
  /** Server port (web/API server) */
  port: z.number().min(1024).max(65535).default(3100),

  /** SQLite database path */
  dbPath: z.string().default('~/.generatorai/data.db'),

  /** Directory for session workspaces (cloned repos, artifacts) */
  workspacesDir: z.string().default('~/.generatorai/workspaces'),

  /** Directory for artifact storage */
  artifactsDir: z.string().default('~/.generatorai/artifacts'),

  /** Maximum concurrent running sessions */
  maxConcurrentSessions: z.number().min(1).max(50).default(10),

  /** Log level */
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Copilot SDK configuration */
  copilot: z.object({
    /** Path to Copilot CLI binary (null = use PATH) */
    cliPath: z.string().nullable().default(null),
    /** Default model */
    defaultModel: z.string().default('gpt-4.1'),
    /** Use stdio transport (true) or TCP (false) */
    useStdio: z.boolean().default(true),
    /** Timeout for sendAndWait (ms) */
    defaultTimeoutMs: z.number().default(120_000),
    /** Auto-restart CLI on crash */
    autoRestart: z.boolean().default(true),
  }).default({}),

  /** SSE streaming configuration */
  streaming: z.object({
    /** Heartbeat interval (ms) */
    heartbeatIntervalMs: z.number().default(15_000),
    /** Maximum events to replay on reconnect */
    maxReplayEvents: z.number().default(10_000),
  }).default({}),

  /** Security configuration */
  security: z.object({
    /** Allowed commands for script execution */
    allowedCommands: z.array(z.string()).default(['git', 'gh', 'node', 'npm', 'npx', 'pnpm']),
    /** Maximum script execution time (ms) */
    maxScriptTimeoutMs: z.number().default(300_000),
    /** Maximum output buffer size (bytes) */
    maxOutputBufferBytes: z.number().default(10 * 1024 * 1024), // 10MB
  }).default({}),

  /** Webhook configuration */
  webhooks: z.object({
    /** Enable webhook receiver */
    enabled: z.boolean().default(false),
    /** GitHub webhook secret for signature verification */
    githubSecret: z.string().optional(),
    /** Rate limit: max requests per minute */
    rateLimitPerMinute: z.number().default(60),
  }).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
```

### 10.3 Workflow Template Schema

```typescript
// packages/shared/src/config/WorkflowTemplate.ts

export const WorkflowTemplateSchema = z.object({
  /** Unique template identifier */
  id: z.string(),

  /** Human-readable name */
  name: z.string(),

  /** Description shown in template picker */
  description: z.string(),

  /** Category for grouping */
  category: z.enum(['code-generation', 'code-review', 'testing', 'refactoring', 'documentation', 'deployment', 'custom']),

  /** Version for template evolution */
  version: z.string().default('1.0.0'),

  /** Icon name (for UI) */
  icon: z.string().optional(),

  /** Whether this workflow requires a codebase */
  requiresCodebase: z.boolean().default(false),

  /** Copilot session configuration — maps to all SDK CreateConversationParams */
  copilotConfig: z.object({
    /** Model to use */
    model: z.string().default('gpt-4.1'),

    /** System message configuration (replaces systemPromptAppend) */
    systemMessage: z.object({
      mode: z.enum(['append', 'replace']).default('append'),
      content: z.string(),
    }).optional(),

    /** @deprecated — use systemMessage instead */
    systemPromptAppend: z.string().optional(),

    /** Enable streaming (default: true) */
    streaming: z.boolean().default(true),

    /** MCP servers to attach */
    mcpServers: z.record(z.object({
      type: z.enum(['http', 'stdio']),
      url: z.string().optional(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
    })).default({}),

    /** Built-in tool allowlist (empty = all allowed). Maps to SDK availableTools */
    availableTools: z.array(z.string()).default([]),

    /** Built-in tool blocklist. Maps to SDK excludedTools */
    excludedTools: z.array(z.string()).default([]),

    /** Skill directories to load */
    skillDirectories: z.array(z.string()).default([]),

    /** Skills to disable */
    disabledSkills: z.array(z.string()).default([]),

    /** Custom agent configurations */
    customAgents: z.array(z.object({
      name: z.string(),
      description: z.string(),
      instructions: z.string(),
      tools: z.array(z.string()).optional(),
    })).default([]),

    /** BYOK provider configuration */
    provider: z.object({
      name: z.string(),
      baseUrl: z.string().url(),
      apiKey: z.string(),
      model: z.string().optional(),
    }).optional(),

    /** Custom config directory path */
    configDir: z.string().optional(),
  }).default({}),

  /** Prompts to send (in order) */
  prompts: z.array(z.object({
    /** Step label shown in UI */
    label: z.string(),
    /** The prompt text. Supports {{variable}} interpolation */
    text: z.string(),
    /** Attachments to include */
    attachments: z.array(z.object({
      type: z.literal('file'),
      path: z.string(),
    })).default([]),
    /** Wait for completion before sending next prompt */
    waitForCompletion: z.boolean().default(true),
  })),

  /** Custom tools available during this workflow */
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parametersSchema: z.record(z.unknown()),
    /** Path to handler module (relative to templates dir) */
    handlerModule: z.string(),
  })).default([]),

  /** Hooks for this workflow */
  hooks: z.array(HookDefinitionSchema).default([]),

  /** User-configurable variables (shown as form fields in UI) */
  variables: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'select', 'multiline']),
    default: z.unknown().optional(),
    required: z.boolean().default(false),
    options: z.array(z.string()).optional(), // for 'select' type
    description: z.string().optional(),
  })).default([]),
});

export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;
```

### 10.4 Predefined Workflow Templates (loaded at startup)

```typescript
// packages/core/src/config/templates/code-generation.ts

import type { WorkflowTemplate } from '@generatorai/shared';

export const codeGenerationTemplate: WorkflowTemplate = {
  id: 'code-generation-v1',
  name: 'Code Generation',
  description: 'Generate code from natural language specifications',
  category: 'code-generation',
  version: '1.0.0',
  icon: 'code',
  requiresCodebase: true,

  copilotConfig: {
    model: 'gpt-4.1',
    systemPromptAppend: `<workflow>
You are operating within a code generation workflow. 
Follow these rules:
1. Analyze the existing codebase structure before making changes
2. Follow existing code conventions and patterns
3. Add appropriate tests for new code
4. Update documentation when adding new features
</workflow>`,
    mcpServers: {
      github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
    },
    allowedTools: [],
    excludedTools: [],
    skillDirectories: [],
  },

  prompts: [
    {
      label: 'Analyze Codebase',
      text: 'Analyze the current codebase structure. Identify the tech stack, coding patterns, and project organization. Provide a summary.',
      attachments: [],
      waitForCompletion: true,
    },
    {
      label: 'Generate Code',
      text: '{{userPrompt}}',  // Interpolated from user input
      attachments: [],
      waitForCompletion: true,
    },
    {
      label: 'Add Tests',
      text: 'Write comprehensive tests for the code you just generated. Match the existing test framework and conventions.',
      attachments: [],
      waitForCompletion: true,
    },
  ],

  tools: [],

  hooks: [
    {
      id: 'post-gen-lint',
      name: 'Lint Check',
      phase: 'post_prompt',
      type: 'script',
      priority: 100,
      enabled: true,
      failurePolicy: 'skip',
      timeoutMs: 60_000,
      retries: 0,
      config: { type: 'script', command: 'npm', args: ['run', 'lint', '--', '--fix'] },
    },
  ],

  variables: [
    {
      name: 'userPrompt',
      label: 'What should be generated?',
      type: 'multiline',
      required: true,
      description: 'Describe the code you want to generate',
    },
  ],
};
```

### 10.5 Template Loading System

```typescript
// packages/core/src/config/TemplateRegistry.ts

export class TemplateRegistry {
  private templates = new Map<string, WorkflowTemplate>();

  /** Load built-in templates */
  loadBuiltins(): void {
    const builtins = [
      codeGenerationTemplate,
      codeReviewTemplate,
      testGenerationTemplate,
      refactoringTemplate,
      documentationTemplate,
    ];

    for (const template of builtins) {
      this.register(template);
    }
  }

  /** Load custom templates from a directory */
  async loadFromDirectory(dir: string): Promise<void> {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json') && !file.endsWith('.ts')) continue;
      const filePath = path.join(dir, file);
      const raw = file.endsWith('.json')
        ? JSON.parse(await fs.readFile(filePath, 'utf-8'))
        : (await import(filePath)).default;

      const parsed = WorkflowTemplateSchema.safeParse(raw);
      if (parsed.success) {
        this.register(parsed.data);
      } else {
        console.warn(`Invalid template ${file}:`, parsed.error.format());
      }
    }
  }

  register(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
  }

  get(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  getAll(): WorkflowTemplate[] {
    return [...this.templates.values()];
  }

  getByCategory(category: string): WorkflowTemplate[] {
    return this.getAll().filter(t => t.category === category);
  }
}
```

### 10.6 Session Configuration (runtime overlay on template)

When a user creates a session, they select a template and optionally override settings:

```typescript
// packages/shared/src/types/CreateSessionParams.ts

export interface CreateSessionParams {
  name: string;
  description?: string;

  /** Repository URL (required if any workflow needs codebase) */
  repoUrl?: string;
  /** Branch to clone */
  repoBranch?: string;

  /** Workflows to attach (template ID + variable overrides) */
  workflows: Array<{
    templateId: string;
    /** Override template variables */
    variables?: Record<string, unknown>;
    /** Override specific hooks (by hook ID) — enable/disable/change policy */
    hookOverrides?: Record<string, Partial<HookDefinition>>;
    /** Override Copilot config for this workflow */
    copilotConfigOverrides?: Partial<WorkflowTemplate['copilotConfig']>;
  }>;

  /** Session-level MCP servers (available to all workflows) */
  mcpServers?: Record<string, McpServerConfig>;

  /** Tags for organization */
  tags?: string[];
}
```

### 10.7 Configuration Resolution Order

When a workflow runs, its effective configuration is resolved by merging:

```
  1. WorkflowTemplate defaults (from template registry)
  2. Session-level overrides (from CreateSessionParams)
  3. Runtime environment (env vars, CLI flags)
  
  Merge strategy: deep merge, with later values overriding earlier ones.
  Arrays: replaced (not appended) — unless the template explicitly supports append.
```

```typescript
// packages/core/src/services/ConfigResolver.ts

export class ConfigResolver {
  constructor(private templateRegistry: TemplateRegistry) {}

  resolve(
    templateId: string,
    sessionOverrides: CreateSessionParams['workflows'][0],
  ): ResolvedWorkflowConfig {
    const template = this.templateRegistry.get(templateId);
    if (!template) throw new ValidationError(`Unknown template: ${templateId}`);

    // Resolve variables — interpolate into prompts
    const variables = {
      ...this.getDefaultVariables(template),
      ...(sessionOverrides.variables ?? {}),
    };

    // Validate required variables
    for (const v of template.variables) {
      if (v.required && !(v.name in variables)) {
        throw new ValidationError(`Missing required variable: ${v.label}`, { [v.name]: ['Required'] });
      }
    }

    // Resolve prompts with variables
    const prompts = template.prompts.map(p => ({
      ...p,
      text: this.interpolate(p.text, variables),
    }));

    // Merge Copilot config
    const copilotConfig = deepMerge(
      template.copilotConfig,
      sessionOverrides.copilotConfigOverrides ?? {},
    );

    // Merge hooks
    const hooks = template.hooks.map(h => {
      const override = sessionOverrides.hookOverrides?.[h.id];
      return override ? { ...h, ...override } : h;
    });

    return { template, prompts, copilotConfig, hooks, variables };
  }

  private interpolate(text: string, vars: Record<string, unknown>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
  }

  private getDefaultVariables(template: WorkflowTemplate): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    for (const v of template.variables) {
      if (v.default !== undefined) defaults[v.name] = v.default;
    }
    return defaults;
  }
}
```

### 10.8 Extensibility Points

| Extension Point | Mechanism | Example |
|---|---|---|
| **New workflow types** | Add template JSON/TS to templates directory | `custom-deployment.json` |
| **Custom tools** | Tool definition in template with handler module | `tools: [{ handlerModule: './my-tool.ts' }]` |
| **Custom hooks** | Hook definition in template or session override | Script, HTTP, or function hooks |
| **MCP servers** | MCP config in template or session level | `mcpServers: { myServer: {...} }` |
| **Custom agents** | Copilot custom agents in session config | `customAgents: [{ name: 'reviewer', ... }]` |
| **New event types** | Extend `AgentEvent` union in shared types | Add to discriminated union |
| **New platforms** | Implement `IPlatformClient` | Mobile, VS Code extension, etc. |

---

---

## 11. Database Schema (Complete)

### 11.1 Full Drizzle Schema

```typescript
// packages/db/src/schema.ts

import { sqliteTable, text, integer, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ── Sessions ──
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),                    // UUID v7 (sortable)
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', {
    enum: ['created', 'starting', 'running', 'paused', 'cancelling', 'cancelled', 'completed', 'deleted'],
  }).notNull().default('created'),
  repoUrl: text('repo_url'),
  repoBranch: text('repo_branch'),
  requiresCodebase: integer('requires_codebase', { mode: 'boolean' }).notNull().default(false),
  workspacePath: text('workspace_path'),          // absolute path to session workspace
  tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
  triggeredBy: text('triggered_by', { mode: 'json' }).$type<{ source: string; event: string } | null>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (table) => ({
  statusIdx: index('idx_sessions_status').on(table.status),
  createdAtIdx: index('idx_sessions_created_at').on(table.createdAt),
}));

// ── Workflows ──
export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  templateId: text('template_id').notNull(),
  name: text('name').notNull(),
  order: integer('order').notNull(),              // execution order within session
  status: text('status', {
    enum: ['pending', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled'],
  }).notNull().default('pending'),
  conversationId: text('conversation_id'),        // Copilot SDK session ID
  variables: text('variables', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
  hookOverrides: text('hook_overrides', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
  copilotConfigOverrides: text('copilot_config_overrides', { mode: 'json' }),
  currentStep: integer('current_step').default(0),
  totalSteps: integer('total_steps').default(0),
  error: text('error'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  sessionIdx: index('idx_workflows_session_id').on(table.sessionId),
  statusIdx: index('idx_workflows_status').on(table.status),
  orderIdx: index('idx_workflows_order').on(table.sessionId, table.order),
}));

// ── Events (Event Sourcing / Durable Stream) ──
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  sequenceId: integer('sequence_id').notNull(),   // per-session monotonic counter
  kind: text('kind').notNull(),                   // AgentEventKind discriminator
  data: text('data', { mode: 'json' }).notNull(), // JSON payload
  timestamp: integer('timestamp').notNull(),       // unix ms
}, (table) => ({
  sessionSeqIdx: uniqueIndex('idx_events_session_seq').on(table.sessionId, table.sequenceId),
  sessionKindIdx: index('idx_events_session_kind').on(table.sessionId, table.kind),
  timestampIdx: index('idx_events_timestamp').on(table.timestamp),
}));

// ── Chat Messages (Derived view for UI — separate from raw events) ──
export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  content: text('content').notNull(),
  attachments: text('attachments', { mode: 'json' }).$type<Array<{ name: string; path: string; mimeType: string }>>(),
  toolName: text('tool_name'),                    // for role='tool' messages
  toolArgs: text('tool_args', { mode: 'json' }),
  toolResult: text('tool_result', { mode: 'json' }),
  workflowId: text('workflow_id').references(() => workflows.id),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  sessionIdx: index('idx_chat_session_id').on(table.sessionId),
  sessionTimeIdx: index('idx_chat_session_time').on(table.sessionId, table.timestamp),
}));

// ── Artifacts ──
export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  workflowId: text('workflow_id').references(() => workflows.id),
  name: text('name').notNull(),
  path: text('path').notNull(),                   // filesystem path
  mimeType: text('mime_type'),
  size: integer('size').notNull(),
  direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
  content: blob('content', { mode: 'buffer' }),   // nullable — only for small files (<1MB)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  sessionIdx: index('idx_artifacts_session_id').on(table.sessionId),
}));

// ── Webhook Registrations ──
export const webhookRegistrations = sqliteTable('webhook_registrations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  source: text('source').notNull(),               // 'github', 'custom', 'gitlab'
  eventType: text('event_type').notNull(),         // 'push', 'pull_request', etc.
  condition: text('condition'),                    // optional JSONPath or regex filter
  templateId: text('template_id').notNull(),       // workflow template to trigger
  autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(true),
  sessionConfig: text('session_config', { mode: 'json' }).$type<Partial<CreateSessionParams>>(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastTriggeredAt: integer('last_triggered_at', { mode: 'timestamp' }),
});

// ── Webhook Delivery Log ──
export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  registrationId: text('registration_id').references(() => webhookRegistrations.id),
  deliveryId: text('delivery_id'),                // external delivery ID for dedup
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  payload: text('payload', { mode: 'json' }),
  status: text('status', { enum: ['received', 'processed', 'failed', 'duplicate'] }).notNull(),
  error: text('error'),
  sessionId: text('session_id').references(() => sessions.id),
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
});
```

### 11.2 Migration Strategy

```
packages/db/
├── src/
│   ├── schema.ts              # Single source of truth (above)
│   ├── migrations/            # Generated by drizzle-kit
│   │   ├── 0000_initial.sql
│   │   └── meta/
│   ├── index.ts               # createDB(), runMigrations()
│   └── repositories/
│       ├── SessionRepository.ts
│       ├── WorkflowRepository.ts
│       ├── EventRepository.ts
│       ├── ChatMessageRepository.ts
│       ├── ArtifactRepository.ts
│       └── WebhookRepository.ts
├── drizzle.config.ts
└── package.json
```

**Commands:**
- `pnpm --filter @generatorai/db generate` — generate SQL migration from schema diff
- `pnpm --filter @generatorai/db push` — push schema directly (dev mode)
- `pnpm --filter @generatorai/db migrate` — run pending migrations (production)

### 11.3 SQLite Configuration

```typescript
// packages/db/src/index.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export function createDB(dbPath: string) {
  const sqlite = new Database(dbPath);

  // Performance: WAL mode for concurrent reads + single writer
  sqlite.pragma('journal_mode = WAL');
  // Performance: synchronous = NORMAL (safe with WAL)
  sqlite.pragma('synchronous = NORMAL');
  // Performance: 64MB cache
  sqlite.pragma('cache_size = -64000');
  // Enable foreign keys
  sqlite.pragma('foreign_keys = ON');
  // Busy timeout: 5 seconds (for concurrent access)
  sqlite.pragma('busy_timeout = 5000');

  return drizzle(sqlite, { schema });
}
```

---

## 12. Domain Entity Models

### 12.1 Session Entity (Aggregate Root)

```typescript
// packages/core/src/domain/entities/Session.ts

export interface Session {
  id: string;                       // UUID v7
  name: string;
  description?: string;
  status: SessionStatus;
  repoUrl?: string;
  repoBranch?: string;
  requiresCodebase: boolean;
  workspacePath?: string;           // set after clone
  tags: string[];
  triggeredBy?: { source: string; event: string }; // if webhook-triggered
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface SessionWithWorkflows extends Session {
  workflows: Workflow[];
}
```

### 12.2 Workflow Entity

```typescript
// packages/core/src/domain/entities/Workflow.ts

export interface Workflow {
  id: string;
  sessionId: string;
  templateId: string;
  name: string;
  order: number;                    // execution order (0-based)
  status: WorkflowStatus;
  conversationId?: string;          // Copilot SDK session ID (set when running)
  variables: Record<string, unknown>;
  hookOverrides: Record<string, Partial<HookDefinition>>;
  copilotConfigOverrides?: Partial<CopilotConfig>;
  currentStep: number;              // current prompt index
  totalSteps: number;               // total prompts in this workflow
  error?: string;                   // last error message
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}
```

### 12.3 ChatMessage Value Object

```typescript
// packages/core/src/domain/value-objects/ChatMessage.ts

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  attachments?: Array<{
    name: string;
    path: string;
    mimeType: string;
  }>;
  toolName?: string;                // for tool-call messages
  toolArgs?: unknown;
  toolResult?: unknown;
  workflowId?: string;             // which workflow produced this message
  timestamp: Date;
}
```

### 12.4 Artifact Value Object

```typescript
// packages/core/src/domain/value-objects/Artifact.ts

export interface Artifact {
  id: string;
  sessionId: string;
  workflowId?: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  direction: 'inbound' | 'outbound';
  createdAt: Date;
  // Note: The DB `content` blob column stores small file contents (<1MB)
  // for inline preview. The domain entity intentionally omits it —
  // content is read from disk via `path` for downloads.
}
```

### 12.5 Repository Port Interfaces

```typescript
// packages/core/src/domain/ports/ISessionRepository.ts
export interface ISessionRepository {
  create(session: Session): Promise<Session>;
  getById(id: string): Promise<Session>;
  getAll(): Promise<Session[]>;
  getByStatus(statuses: SessionStatus[]): Promise<Session[]>;
  countByStatus(statuses: SessionStatus[]): Promise<number>;
  update(id: string, updates: Partial<Session>): Promise<Session>;
  updateStatus(id: string, status: SessionStatus): Promise<void>;
  delete(id: string): Promise<void>;
}

// packages/core/src/domain/ports/IWorkflowRepository.ts
export interface IWorkflowRepository {
  create(workflow: Workflow): Promise<Workflow>;
  getById(id: string): Promise<Workflow>;
  getBySessionId(sessionId: string): Promise<Workflow[]>;
  updateStatus(id: string, status: WorkflowStatus): Promise<void>;
  update(id: string, updates: Partial<Workflow>): Promise<Workflow>;
  delete(id: string): Promise<void>;
}

// packages/core/src/domain/ports/IEventRepository.ts
export interface IEventRepository {
  insert(event: Omit<PersistedEvent, 'id'>): Promise<number>; // returns auto-inc id
  getBySessionId(sessionId: string): Promise<PersistedEvent[]>;
  getAfterSequence(sessionId: string, afterSeqId: number): Promise<PersistedEvent[]>;
  getMaxSequencePerSession(): Promise<Array<{ sessionId: string; maxSeq: number }>>;
  deleteBySession(sessionId: string): Promise<void>;
}

// packages/core/src/domain/ports/IChatMessageRepository.ts
export interface IChatMessageRepository {
  create(message: ChatMessage): Promise<ChatMessage>;
  getBySessionId(sessionId: string, limit?: number, offset?: number): Promise<ChatMessage[]>;
  deleteBySession(sessionId: string): Promise<void>;
}

// packages/core/src/domain/ports/IArtifactRepository.ts
export interface IArtifactRepository {
  create(artifact: Artifact): Promise<Artifact>;
  upsert(artifact: Artifact): Promise<Artifact>;
  getById(id: string): Promise<Artifact | null>;
  getBySessionId(sessionId: string): Promise<Artifact[]>;
  deleteBySession(sessionId: string): Promise<void>;
}

// packages/core/src/domain/ports/IWebhookRepository.ts
export interface IWebhookRepository {
  getActiveRegistrations(source: string, eventType: string): Promise<WebhookRegistration[]>;
  getRegistration(id: string): Promise<WebhookRegistration | null>;
  getAllRegistrations(): Promise<WebhookRegistration[]>;
  createRegistration(reg: WebhookRegistration): Promise<WebhookRegistration>;
  deleteRegistration(id: string): Promise<void>;
  logDelivery(delivery: WebhookDelivery): Promise<void>;
  getDeliveryById(deliveryId: string): Promise<WebhookDelivery | null>;
  updateDeliveryStatus(deliveryId: string, status: string): Promise<void>;
  updateDelivery(deliveryId: string, updates: Partial<WebhookDelivery>): Promise<void>;
}
```

---

## 13. REST API Specification

### 13.1 Complete Endpoint Table

| Method | Path | Request Body | Response | Service Method | Auth |
|---|---|---|---|---|---|
| **Sessions** | | | | | |
| `POST` | `/api/sessions` | `CreateSessionParams` (JSON) | `201: Session` | `sessionService.create()` | - |
| `GET` | `/api/sessions` | Query: `?status=running,paused` | `200: Session[]` | `sessionService.getAll()` | - |
| `GET` | `/api/sessions/:id` | - | `200: SessionWithWorkflows` | `sessionService.getById()` | - |
| `POST` | `/api/sessions/:id/start` | - | `202: void` | `sessionService.startSession()` | - |
| `POST` | `/api/sessions/:id/pause` | - | `200: void` | `sessionService.pauseSession()` | - |
| `POST` | `/api/sessions/:id/resume` | - | `200: void` | `sessionService.resumeSession()` | - |
| `POST` | `/api/sessions/:id/cancel` | - | `200: void` | `sessionService.cancelSession()` | - |
| `DELETE` | `/api/sessions/:id` | - | `204: void` | `sessionService.deleteSession()` | - |
| **Workflows** | | | | | |
| `GET` | `/api/sessions/:id/workflows` | - | `200: Workflow[]` | `workflowService.getBySession()` | - |
| `POST` | `/api/workflows/:id/pause` | - | `200: void` | `workflowService.pause()` | - |
| `POST` | `/api/workflows/:id/resume` | - | `200: void` | `workflowService.resume()` | - |
| **Chat** | | | | | |
| `POST` | `/api/sessions/:id/prompt` | `FormData: { prompt, attachments[] }` | `202: void` | `chatService.sendPrompt()` | - |
| `GET` | `/api/sessions/:id/chat` | Query: `?limit=50&offset=0` | `200: ChatMessage[]` | `chatService.getHistory()` | - |
| **Streaming** | | | | | |
| `GET` | `/api/sessions/:id/stream` | Header: `Last-Event-ID` | `200: text/event-stream` | `sseTransport.handler()` | - |
| **Artifacts** | | | | | |
| `GET` | `/api/sessions/:id/artifacts` | - | `200: Artifact[]` | `artifactService.getBySession()` | - |
| `GET` | `/api/artifacts/:id/download` | - | `200: binary stream` | `artifactService.download()` | - |
| **Templates** | | | | | |
| `GET` | `/api/templates` | Query: `?category=code-generation` | `200: WorkflowTemplate[]` | `templateRegistry.getAll()` | - |
| `GET` | `/api/templates/:id` | - | `200: WorkflowTemplate` | `templateRegistry.get()` | - |
| **Webhooks** | | | | | |
| `POST` | `/api/webhooks/github` | GitHub webhook payload | `200: { received: true }` | `webhookService.handleGitHub()` | HMAC |
| `POST` | `/api/webhooks/custom/:trigger` | Custom JSON payload | `200: { received: true }` | `webhookService.handleCustom()` | Token |
| `GET` | `/api/webhooks/registrations` | - | `200: WebhookRegistration[]` | `webhookService.getRegistrations()` | - |
| `POST` | `/api/webhooks/registrations` | `WebhookRegistration` | `201: WebhookRegistration` | `webhookService.register()` | - |
| `DELETE` | `/api/webhooks/registrations/:id` | - | `204: void` | `webhookService.unregister()` | - |
| **Copilot** | | | | | |
| `GET` | `/api/copilot/models` | - | `200: CopilotModel[]` | `copilot.getModels()` | - |
| `GET` | `/api/copilot/state` | - | `200: { state: CopilotClientState }` | `copilot.getClientState()` | - |
| `GET` | `/api/copilot/conversations` | - | `200: string[]` | `copilot.listConversations()` | - |
| `GET` | `/api/copilot/conversations/:id/messages` | - | `200: ConversationMessage[]` | `copilot.getMessages()` | - |
| `POST` | `/api/copilot/ping` | - | `200: { alive: boolean }` | `copilot.ping()` | - |
| **Hooks** | | | | | |
| `GET` | `/api/hooks/phases` | - | `200: HookPhase[]` | Returns all supported hook phases | - |
| `GET` | `/api/sessions/:id/hooks` | - | `200: HookDefinition[]` | `hookService.getBySession()` | - |
| `POST` | `/api/sessions/:id/hooks/test` | `{ phase, hookDef }` | `200: HookTestResult` | `hookService.testHook()` | - |
| **System** | | | | | |
| `GET` | `/api/health` | - | `200: { status, copilot, db, uptime }` | health check | - |
| `GET` | `/api/config` | - | `200: PublicAppConfig` | config (non-sensitive) | - |
| `GET` | `/api/events/global` | Header: `Last-Event-ID` | `200: text/event-stream` | Global event stream | - |

### 13.2 Server Route Registration

```typescript
// apps/server/src/routes/index.ts
import { Router } from 'express';
import { createSessionRoutes } from './sessions';
import { createWorkflowRoutes } from './workflows';
import { createChatRoutes } from './chat';
import { createStreamRoutes } from './stream';
import { createArtifactRoutes } from './artifacts';
import { createTemplateRoutes } from './templates';
import { createWebhookRoutes } from './webhooks';
import { createHealthRoutes } from './health';

export function createApiRouter(container: AppContainer): Router {
  const router = Router();

  router.use('/sessions', createSessionRoutes(container));
  router.use('/workflows', createWorkflowRoutes(container));
  router.use('/sessions', createChatRoutes(container));       // nested under sessions
  router.use('/sessions', createStreamRoutes(container));     // SSE endpoints
  router.use('/artifacts', createArtifactRoutes(container));
  router.use('/templates', createTemplateRoutes(container));
  router.use('/webhooks', createWebhookRoutes(container));
  router.use('/health', createHealthRoutes(container));

  return router;
}
```

### 13.3 Request Validation (Zod Middleware)

```typescript
// apps/server/src/middleware/validate.ts
import { z, ZodSchema } from 'zod';

export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', fields: result.error.format() },
      });
    }
    req.body = result.data;
    next();
  };
}

// Usage:
router.post('/api/sessions', validate(CreateSessionParamsSchema), async (req, res) => {
  const session = await container.sessionService.createSession(req.body);
  res.status(201).json(session);
});
```

---

## 14. Webhook System

### 14.1 Architecture

```
  External Source (GitHub, CI/CD, Custom)
          │
          ▼
  ┌───────────────────────────┐
  │   Webhook Receiver        │
  │   POST /api/webhooks/*    │
  │                           │
  │   1. Signature verify     │
  │   2. Rate limit check     │
  │   3. Deduplication check  │
  │   4. Payload validation   │
  └──────────┬────────────────┘
             │
             ▼
  ┌───────────────────────────┐
  │   WebhookService          │
  │                           │
  │   1. Log delivery to DB   │
  │   2. Match registrations  │
  │   3. Resolve template     │
  │   4. Create session       │
  │   5. Auto-start if flag   │
  └───────────────────────────┘
```

### 14.2 WebhookService

```typescript
// packages/core/src/services/WebhookService.ts

import crypto from 'crypto';
import type { IWebhookRepository } from '../domain/ports/IWebhookRepository';

export class WebhookService {
  constructor(
    private webhookRepo: IWebhookRepository,
    private sessionService: SessionService,
    private templateRegistry: TemplateRegistry,
    private eventBus: EventBus,
    private config: AppConfig['webhooks'],
  ) {}

  /** Handle incoming GitHub webhook */
  async handleGitHub(headers: Record<string, string>, payload: unknown): Promise<void> {
    const event = headers['x-github-event'];
    const deliveryId = headers['x-github-delivery'];
    const signature = headers['x-hub-signature-256'];

    // 1. Verify signature
    if (this.config.githubSecret) {
      this.verifyGitHubSignature(payload, signature, this.config.githubSecret);
    }

    // 2. Check for duplicate delivery
    const existing = await this.webhookRepo.getDeliveryById(deliveryId);
    if (existing) {
      await this.webhookRepo.updateDeliveryStatus(deliveryId, 'duplicate');
      return;
    }

    // 3. Log delivery
    await this.webhookRepo.logDelivery({
      id: generateId(),
      deliveryId,
      source: 'github',
      eventType: event,
      payload,
      status: 'received',
      receivedAt: new Date(),
    });

    // 4. Find matching registrations
    const registrations = await this.webhookRepo.getActiveRegistrations('github', event);

    for (const reg of registrations) {
      // 5. Check optional condition filter
      if (reg.condition && !this.evaluateCondition(reg.condition, payload)) continue;

      // 6. Create session from template
      const template = this.templateRegistry.get(reg.templateId);
      if (!template) continue;

      const sessionParams = {
        name: `Webhook: ${event} → ${template.name}`,
        ...reg.sessionConfig,
        workflows: [{ templateId: reg.templateId, variables: this.extractVariables(payload) }],
      };

      const session = await this.sessionService.createSession(sessionParams);

      // 7. Auto-start if configured
      if (reg.autoStart) {
        await this.sessionService.startSession(session.id);
      }

      // 8. Update delivery log
      await this.webhookRepo.updateDelivery(deliveryId, {
        status: 'processed',
        sessionId: session.id,
        processedAt: new Date(),
      });
    }
  }

  /** Handle custom webhook trigger */
  async handleCustom(trigger: string, payload: unknown): Promise<void> {
    const registrations = await this.webhookRepo.getActiveRegistrations('custom', trigger);
    for (const reg of registrations) {
      const session = await this.sessionService.createSession({
        name: `Custom trigger: ${trigger}`,
        ...reg.sessionConfig,
        workflows: [{ templateId: reg.templateId, variables: payload as Record<string, unknown> }],
      });
      if (reg.autoStart) {
        await this.sessionService.startSession(session.id);
      }
    }
  }

  /** Verify GitHub HMAC-SHA256 signature */
  private verifyGitHubSignature(payload: unknown, signature: string, secret: string): void {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      throw new ValidationError('Invalid webhook signature');
    }
  }

  /** Extract contextual variables from webhook payload for template interpolation */
  private extractVariables(payload: any): Record<string, unknown> {
    return {
      repoUrl: payload?.repository?.clone_url,
      branch: payload?.ref?.replace('refs/heads/', ''),
      sender: payload?.sender?.login,
      action: payload?.action,
      prNumber: payload?.pull_request?.number,
      prTitle: payload?.pull_request?.title,
      commitSha: payload?.after ?? payload?.head_commit?.id,
    };
  }

  private evaluateCondition(condition: string, payload: any): boolean {
    try {
      // Simple JSONPath-like condition: "repository.full_name == 'org/repo'"
      const [path, op, value] = condition.split(/\s*(==|!=|contains)\s*/);
      const actual = path.split('.').reduce((obj, key) => obj?.[key], payload);
      switch (op) {
        case '==': return String(actual) === value.replace(/['"]/g, '');
        case '!=': return String(actual) !== value.replace(/['"]/g, '');
        case 'contains': return String(actual).includes(value.replace(/['"]/g, ''));
        default: return false;
      }
    } catch { return false; }
  }
}
```

---

## 15. WorkflowService — Core Execution Engine

### 15.1 Complete WorkflowService

```typescript
// packages/core/src/services/WorkflowService.ts

export class WorkflowService {
  constructor(
    private workflowRepo: IWorkflowRepository,
    private sessionRepo: ISessionRepository,
    private chatRepo: IChatMessageRepository,
    private copilot: ICopilotPort,
    private eventBus: EventBus,
    private hookExecutor: HookExecutor,
    private hookInterceptor: HookInterceptor,
    private configResolver: ConfigResolver,
    private gitManager: GitManager,
  ) {}

  /** Start executing a workflow (called by SessionService) */
  async startWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.workflowRepo.getById(workflowId);
    const session = await this.sessionRepo.getById(workflow.sessionId);
    const wfSm = new WorkflowStateMachine(workflow.status);

    // Transition: queued → running
    wfSm.transition('sys:turn');
    await this.workflowRepo.updateStatus(workflowId, 'running');
    await this.workflowRepo.update(workflowId, { startedAt: new Date() });

    this.eventBus.emit(workflow.sessionId, {
      kind: 'workflow.started',
      data: { workflowId, name: workflow.name },
    });

    try {
      // 1. Resolve configuration
      const config = this.configResolver.resolve(workflow.templateId, {
        variables: workflow.variables,
        hookOverrides: workflow.hookOverrides as Record<string, Partial<HookDefinition>>,
        copilotConfigOverrides: workflow.copilotConfigOverrides as any,
      });

      const workspacePath = session.workspacePath ?? this.gitManager.getRepoDir(session.id);
      const hookCtx: HookContext = {
        sessionId: session.id,
        workflowId,
        workspacePath,
        variables: this.flattenVariables(config.variables),
        eventBus: this.eventBus,
      };

      // 2. Run pre_run hooks
      const preOk = await this.hookExecutor.executePhase('pre_run', config.hooks, hookCtx);
      if (!preOk) throw new HookAbortError('pre_run hook aborted workflow');

      // 3. Create Copilot conversation with full SDK configuration
      const conversationId = `wf-${workflowId}-${Date.now()}`;
      await this.copilot.createConversation({
        conversationId,
        model: config.copilotConfig.model,
        systemMessage: config.copilotConfig.systemMessage ?? (
          config.copilotConfig.systemPromptAppend
            ? { mode: 'append', content: config.copilotConfig.systemPromptAppend }
            : undefined
        ),
        tools: this.resolveTools(config),
        availableTools: config.copilotConfig.availableTools,
        excludedTools: config.copilotConfig.excludedTools,
        customAgents: config.copilotConfig.customAgents,
        mcpServers: config.copilotConfig.mcpServers as any,
        skillDirectories: config.copilotConfig.skillDirectories,
        disabledSkills: config.copilotConfig.disabledSkills,
        provider: config.copilotConfig.provider,
        streaming: config.copilotConfig.streaming ?? true,
        configDir: config.copilotConfig.configDir,
        workingDirectory: workspacePath,
      });
      await this.workflowRepo.update(workflowId, { conversationId });

      // 4. Subscribe to events via HookInterceptor (SDK lifecycle hooks execute here)
      const interceptedHandler = this.hookInterceptor.createInterceptedEventHandler(
        session.id,
        workflowId,
        config.hooks,  // Includes both workflow phase hooks AND SDK lifecycle hooks
        hookCtx,
      );
      // Wrap intercepted handler to also persist chat events
      const unsubscribe = this.copilot.onConversationEvent(conversationId, async (event) => {
        await interceptedHandler(event);
        await this.persistChatEvent(session.id, workflowId, event);
      });

      // 5. Execute prompts sequentially
      const totalSteps = config.prompts.length;
      await this.workflowRepo.update(workflowId, { totalSteps });

      for (let i = 0; i < config.prompts.length; i++) {
        const prompt = config.prompts[i];

        // Check if workflow was paused/cancelled between prompts
        const currentWorkflow = await this.workflowRepo.getById(workflowId);
        if (currentWorkflow.status !== 'running') {
          unsubscribe();
          return; // Exit — state already set by pause/cancel handler
        }

        // Emit step event
        this.eventBus.emit(session.id, {
          kind: 'workflow.step_started',
          data: { workflowId, step: prompt.label },
        });
        await this.workflowRepo.update(workflowId, { currentStep: i });

        // Run pre_prompt hooks
        await this.hookExecutor.executePhase('pre_prompt', config.hooks, hookCtx);

        // Save user prompt as chat message
        await this.chatRepo.create({
          id: generateId(),
          sessionId: session.id,
          role: 'user',
          content: prompt.text,
          workflowId,
          timestamp: new Date(),
        });

        // Send prompt to Copilot and wait for completion
        const attachments = prompt.attachments?.map(a => ({
          type: 'file' as const,
          path: path.resolve(workspacePath, a.path),
          displayName: path.basename(a.path),
        }));

        await this.copilot.sendPrompt(conversationId, prompt.text, attachments);

        // Wait for idle (turn complete)
        if (prompt.waitForCompletion) {
          await this.waitForIdle(conversationId, session.id);
        }

        // Run post_prompt hooks
        await this.hookExecutor.executePhase('post_prompt', config.hooks, hookCtx);

        // Emit step completion
        this.eventBus.emit(session.id, {
          kind: 'workflow.step_completed',
          data: { workflowId, step: prompt.label },
        });
      }

      // 6. Unsubscribe from events
      unsubscribe();

      // 7. Run post_run hooks
      await this.hookExecutor.executePhase('post_run', config.hooks, hookCtx);

      // 8. Mark complete
      await this.workflowRepo.updateStatus(workflowId, 'completed');
      await this.workflowRepo.update(workflowId, { completedAt: new Date() });

      this.eventBus.emit(session.id, {
        kind: 'workflow.completed',
        data: { workflowId },
      });

      // 9. Notify SessionService to advance to next workflow
      await this.sessionService.onWorkflowCompleted(session.id, workflowId);

    } catch (err) {
      // Run on_error hooks
      const config = this.configResolver.resolve(workflow.templateId, { variables: workflow.variables });
      const hookCtx: HookContext = {
        sessionId: session.id, workflowId,
        workspacePath: session.workspacePath ?? '',
        variables: {}, eventBus: this.eventBus,
      };
      await this.hookExecutor.executePhase('on_error', config.hooks, hookCtx);

      // Mark failed
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.workflowRepo.updateStatus(workflowId, 'failed');
      await this.workflowRepo.update(workflowId, { error: errorMsg });

      this.eventBus.emit(session.id, {
        kind: 'workflow.failed',
        data: { workflowId, error: errorMsg },
      });

      // Notify session of failure
      await this.sessionService.onWorkflowFailed(session.id, workflowId, errorMsg);
    }
  }

  /** Wait for the Copilot conversation to reach idle state */
  private waitForIdle(conversationId: string, sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new CopilotTimeoutError('Copilot response timed out'));
      }, 120_000); // 2 minute timeout

      const unsubscribe = this.copilot.onConversationEvent(conversationId, (event) => {
        if (event.kind === 'copilot.idle') {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
        if (event.kind === 'copilot.error') {
          clearTimeout(timeout);
          unsubscribe();
          reject(new CopilotSessionError((event.data as any).message));
        }
      });
    });
  }

  /** Persist relevant events as chat messages for history reconstruction */
  private async persistChatEvent(sessionId: string, workflowId: string, event: AgentEvent): Promise<void> {
    if (event.kind === 'copilot.message_complete') {
      await this.chatRepo.create({
        id: generateId(),
        sessionId,
        role: 'assistant',
        content: (event.data as any).content,
        workflowId,
        timestamp: new Date(),
      });
    }
    if (event.kind === 'copilot.tool_start') {
      await this.chatRepo.create({
        id: generateId(),
        sessionId,
        role: 'tool',
        content: `Tool: ${(event.data as any).tool}`,
        toolName: (event.data as any).tool,
        toolArgs: (event.data as any).args,
        workflowId,
        timestamp: new Date(),
      });
    }
  }

  private resolveTools(config: ResolvedWorkflowConfig): ToolDefinition[] {
    return config.template.tools.map(t => ({
      name: t.name,
      description: t.description,
      parametersSchema: t.parametersSchema,
      handler: async (args: Record<string, unknown>) => {
        // Dynamic import of handler module
        const mod = await import(path.resolve(t.handlerModule));
        return (mod.default ?? mod)(args);
      },
    }));
  }

  private flattenVariables(vars: Record<string, unknown>): Record<string, string> {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) flat[k] = String(v);
    return flat;
  }

  /** Circular dependency resolved via setter injection */
  private sessionService!: SessionService;
  setSessionService(svc: SessionService) { this.sessionService = svc; }

  // --- Pause/Resume workflow ---

  async pauseWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.workflowRepo.getById(workflowId);
    const wfSm = new WorkflowStateMachine(workflow.status);
    wfSm.transition('user:pause');

    if (workflow.conversationId) {
      await this.copilot.abortConversation(workflow.conversationId);
    }

    await this.workflowRepo.updateStatus(workflowId, wfSm.status);
    this.eventBus.emit(workflow.sessionId, {
      kind: 'workflow.paused',
      data: { workflowId },
    });
  }

  async resumeWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.workflowRepo.getById(workflowId);
    const wfSm = new WorkflowStateMachine(workflow.status);
    wfSm.transition('user:resume');
    await this.workflowRepo.updateStatus(workflowId, 'running');

    // Re-start execution from the current step
    this.startWorkflow(workflowId); // async — fire and forget
  }
}
```

---

## 16. Client State Management (TanStack Query + Zustand)

### 16.1 Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                  CLIENT STATE ARCHITECTURE                     │
│                                                               │
│  ┌─────────────────────────────────┐  ┌─────────────────────┐│
│  │     TanStack Query              │  │    Zustand           ││
│  │     (Server State)              │  │    (Ephemeral UI)    ││
│  │                                 │  │                      ││
│  │  • Sessions list       useQuery │  │  • Active stream     ││
│  │  • Session details     useQuery │  │    text buffer       ││
│  │  • Workflows           useQuery │  │  • SSE connection    ││
│  │  • Chat history        useQuery │  │    status            ││
│  │  • Templates           useQuery │  │  • Sidebar open      ││
│  │  • Artifacts           useQuery │  │  • Current view      ││
│  │  • Create session  useMutation  │  │  • Form drafts       ││
│  │  • Start/pause     useMutation  │  │                      ││
│  │  • Send prompt     useMutation  │  │  Updated by SSE      ││
│  │                                 │  │  handlers outside    ││
│  │  Auto-invalidation via SSE      │  │  React lifecycle     ││
│  └─────────────────────────────────┘  └─────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

### 16.2 TanStack Query Setup

```typescript
// packages/ui/src/queries/sessions.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../hooks/usePlatform';

// ── Queries ──
export function useSessions() {
  const platform = usePlatform();
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => platform.getSessions(),
    refetchInterval: 30_000, // background refresh every 30s
  });
}

export function useSession(id: string) {
  const platform = usePlatform();
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => platform.getSession(id),
  });
}

export function useWorkflows(sessionId: string) {
  const platform = usePlatform();
  return useQuery({
    queryKey: ['workflows', sessionId],
    queryFn: () => platform.getWorkflows(sessionId),
  });
}

export function useChatHistory(sessionId: string) {
  const platform = usePlatform();
  return useQuery({
    queryKey: ['chat', sessionId],
    queryFn: () => platform.getChatHistory(sessionId),
  });
}

export function useTemplates() {
  const platform = usePlatform();
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => platform.getWorkflowTemplates(),
    staleTime: Infinity, // templates rarely change
  });
}

// ── Mutations ──
export function useCreateSession() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateSessionParams) => platform.createSession(params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export function useStartSession() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => platform.startSession(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useSendPrompt(sessionId: string) {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ prompt, attachments }: { prompt: string; attachments?: File[] }) =>
      platform.sendPrompt(sessionId, prompt, attachments),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat', sessionId] }),
  });
}
```

### 16.3 SSE → Query Cache Integration

```typescript
// packages/ui/src/hooks/useSessionEvents.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePlatform } from './usePlatform';
import { useStreamStore } from '../stores/streamStore';

/**
 * Subscribe to SSE events for a session.
 * Updates TanStack Query cache for state changes and Zustand for streaming text.
 */
export function useSessionEvents(sessionId: string) {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = platform.subscribeToEvents(sessionId, (event) => {
      // Streaming text → Zustand (high frequency, outside React)
      if (event.kind === 'copilot.token') {
        useStreamStore.getState().appendToken(sessionId, event.data.text);
      }

      // State changes → invalidate TanStack Query cache
      if (event.kind.startsWith('session.') || event.kind.startsWith('workflow.')) {
        queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
        queryClient.invalidateQueries({ queryKey: ['workflows', sessionId] });
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      }

      // Chat messages → invalidate chat cache
      if (event.kind === 'copilot.message_complete') {
        queryClient.invalidateQueries({ queryKey: ['chat', sessionId] });
        useStreamStore.getState().completeStream(sessionId);
      }

      // Artifacts → invalidate artifacts cache
      if (event.kind === 'artifact.created') {
        queryClient.invalidateQueries({ queryKey: ['artifacts', sessionId] });
      }
    });

    return unsubscribe;
  }, [sessionId, platform, queryClient]);
}
```

### 16.4 Zustand Stream Store (for high-frequency token streaming)

```typescript
// packages/ui/src/stores/streamStore.ts
import { create } from 'zustand';

interface StreamState {
  streams: Record<string, {
    text: string;
    status: 'idle' | 'streaming' | 'complete';
  }>;
  appendToken: (sessionId: string, token: string) => void;
  completeStream: (sessionId: string) => void;
  clearStream: (sessionId: string) => void;
}

export const useStreamStore = create<StreamState>((set) => ({
  streams: {},
  appendToken: (sessionId, token) => set((state) => ({
    streams: {
      ...state.streams,
      [sessionId]: {
        text: (state.streams[sessionId]?.text ?? '') + token,
        status: 'streaming',
      },
    },
  })),
  completeStream: (sessionId) => set((state) => ({
    streams: {
      ...state.streams,
      [sessionId]: {
        ...state.streams[sessionId],
        status: 'complete',
      },
    },
  })),
  clearStream: (sessionId) => set((state) => ({
    streams: {
      ...state.streams,
      [sessionId]: { text: '', status: 'idle' },
    },
  })),
}));
```

**Key Design Decision**: TanStack Query handles all server-derived state (queries + mutations with cache invalidation). Zustand handles only the high-frequency streaming buffer that needs to be updated outside React's lifecycle (from SSE event handlers). This split avoids re-rendering the entire component tree on every token.

---

## 17. UI Architecture & Design

### 17.1 Component Library & Design System

| Concern | Choice | Rationale |
|---|---|---|
| **Component primitives** | shadcn/ui (Radix + Tailwind) | Accessible, unstyled, copy-paste ownership, 2026's standard |
| **Styling** | Tailwind CSS v4 | Utility-first, JIT compiled, design tokens via CSS variables |
| **Icons** | Lucide React | Tree-shakeable, consistent with shadcn/ui |
| **Code blocks** | Shiki (syntax highlighting) | VS Code-grade highlighting, theme support |
| **Markdown** | react-markdown + rehype-raw | Render Copilot responses with code blocks, tables |
| **Theme** | CSS variables, system preference detection | Dark/light mode, high contrast |
| **Animation** | Framer Motion | Layout animations, streaming cursor |
| **Charts** | Recharts (optional) | For workflow progress visualization |

### 17.2 Layout Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌─────────────────────────────────────────┐  │
│  │          │  │              HEADER BAR                   │  │
│  │          │  │  App title · Connection status · Settings │  │
│  │          │  └─────────────────────────────────────────┘  │
│  │          │  ┌─────────────────────────────────────────┐  │
│  │  SIDEBAR │  │                                          │  │
│  │          │  │         MAIN CONTENT AREA                │  │
│  │ Session  │  │                                          │  │
│  │ List     │  │  ┌──────────────────────────────────┐   │  │
│  │          │  │  │         TAB BAR                    │   │  │
│  │ + New    │  │  │  Workflows │ Chat │ Artifacts     │   │  │
│  │          │  │  └──────────────────────────────────┘   │  │
│  │ ▸ Sess 1 │  │  ┌──────────────────────────────────┐   │  │
│  │   ● Run  │  │  │                                   │   │  │
│  │ ▸ Sess 2 │  │  │    TAB CONTENT                    │   │  │
│  │   ○ Idle │  │  │                                   │   │  │
│  │ ▸ Sess 3 │  │  │    (Workflows timeline /          │   │  │
│  │   ◉ Done │  │  │     Chat view /                   │   │  │
│  │          │  │  │     Artifact browser)              │   │  │
│  │ ──────── │  │  │                                   │   │  │
│  │ Templates│  │  │                                   │   │  │
│  │ Settings │  │  └──────────────────────────────────┘   │  │
│  └──────────┘  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 17.3 Component Hierarchy

```
App
├── PlatformProvider
│   └── QueryClientProvider (TanStack Query)
│       └── ThemeProvider
│           └── AppLayout
│               ├── Sidebar
│               │   ├── SessionList
│               │   │   ├── SessionListItem (status indicator, name, actions)
│               │   │   └── CreateSessionButton → CreateSessionDialog
│               │   ├── TemplateExplorer
│               │   └── AppSettings
│               ├── Header
│               │   ├── BreadcrumbNav
│               │   ├── ConnectionStatus (SSE indicator)
│               │   └── SessionActions (Start/Pause/Cancel/Delete)
│               └── MainContent
│                   ├── WorkflowsTab
│                   │   ├── WorkflowTimeline
│                   │   │   └── WorkflowStep (status, name, duration)
│                   │   └── WorkflowActions (Pause/Resume per workflow)
│                   ├── ChatTab
│                   │   ├── ChatMessageList
│                   │   │   ├── UserMessage (prompt, attachments)
│                   │   │   ├── AssistantMessage (markdown, code blocks)
│                   │   │   ├── ToolCallMessage (tool name, args, result)
│                   │   │   └── StreamingMessage (live cursor)
│                   │   ├── EventStream (git, script, hook events)
│                   │   └── ChatInput
│                   │       ├── PromptTextarea (multiline, Ctrl+Enter to send)
│                   │       └── AttachmentPicker (drag-drop, file select)
│                   └── ArtifactsTab
│                       ├── ArtifactGrid
│                       └── ArtifactPreview (with download button)
```

### 17.4 Chat View Rendering

```typescript
// packages/ui/src/components/ChatView.tsx
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

export function ChatView({ sessionId }: { sessionId: string }) {
  const { data: messages } = useChatHistory(sessionId);
  const { streams } = useStreamStore();
  const activeStream = streams[sessionId];

  useSessionEvents(sessionId); // subscribe to SSE

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable message list */}
      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {messages?.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}

        {/* Live streaming text */}
        {activeStream?.status === 'streaming' && (
          <div className="prose dark:prose-invert">
            <ReactMarkdown
              components={{
                code({ className, children }) {
                  const match = /language-(\w+)/.exec(className || '');
                  return match ? (
                    <SyntaxHighlighter language={match[1]}>
                      {String(children)}
                    </SyntaxHighlighter>
                  ) : <code className={className}>{children}</code>;
                },
              }}
            >
              {activeStream.text}
            </ReactMarkdown>
            <span className="animate-pulse">▊</span>
          </div>
        )}
      </div>

      {/* Chat input — only enabled when session allows chat */}
      <ChatInput sessionId={sessionId} />
    </div>
  );
}
```

### 17.5 Design Principles

| Principle | Implementation |
|---|---|
| **Dark mode first** | CSS variables with `prefers-color-scheme` media query |
| **Responsive** | Sidebar collapses to drawer on mobile/small screens |
| **Accessible** | Radix primitives provide ARIA by default; keyboard navigation |
| **Real-time** | SSE-powered live updates with optimistic UI |
| **Performance** | Virtualized message list for long chat histories (`react-virtuoso`) |
| **Consistent spacing** | Tailwind's 4px grid system (space-1 to space-16) |
| **Typography** | Inter (sans) + JetBrains Mono (code), loaded via `@fontsource` |

---

## 18. Testing Strategy

### 18.1 Test Pyramid

| Level | Scope | Tooling | Target |
|---|---|---|---|
| **Unit** | Domain layer (state machines, entities, config) | Vitest | 90%+ coverage on domain |
| **Unit** | Application services with mocked ports | Vitest + mock ICopilotPort | Core business logic |
| **Integration** | Repositories with in-memory SQLite | Vitest + better-sqlite3 `:memory:` | Persistence layer |
| **Integration** | Server routes with supertest | Vitest + supertest | API endpoints |
| **Component** | React components with mock platform | Vitest + React Testing Library | UI components |
| **Component** | Ink CLI components | Vitest + ink-testing-library | CLI output |
| **E2E** | Full flow: create session → run workflow → verify | Playwright (web), spectron (desktop) | Critical paths |
| **Snapshot** | CLI output format | Vitest snapshots | CLI regression |

### 18.2 Domain Layer Tests (Example)

```typescript
// packages/core/src/__tests__/state-machines/SessionStateMachine.test.ts
import { describe, it, expect } from 'vitest';
import { SessionStateMachine } from '../../domain/state-machines/SessionStateMachine';

describe('SessionStateMachine', () => {
  it('transitions from created to starting on user:start', () => {
    const sm = new SessionStateMachine('created');
    expect(sm.transition('user:start')).toBe('starting');
  });

  it('throws on invalid transition', () => {
    const sm = new SessionStateMachine('created');
    expect(() => sm.transition('user:pause')).toThrow('Cannot apply');
  });

  it('enables chat only when completed or cancelled', () => {
    expect(new SessionStateMachine('completed').isChatEnabled).toBe(true);
    expect(new SessionStateMachine('cancelled').isChatEnabled).toBe(true);
    expect(new SessionStateMachine('running').isChatEnabled).toBe(false);
  });

  it('handles full lifecycle', () => {
    const sm = new SessionStateMachine('created');
    sm.transition('user:start');    // → starting
    sm.transition('sys:started');   // → running
    sm.transition('user:pause');    // → paused
    sm.transition('user:resume');   // → running
    sm.transition('sys:all_wf_done'); // → completed
    expect(sm.status).toBe('completed');
  });
});
```

### 18.3 Mock ICopilotPort for Service Tests

```typescript
// packages/core/src/__tests__/mocks/MockCopilotPort.ts
export class MockCopilotPort implements ICopilotPort {
  private handlers = new Map<string, ((event: AgentEvent) => void)[]>();
  private clientEventHandlers = new Set<(event: CopilotClientEvent) => void>();
  private conversations = new Set<string>();
  private messages = new Map<string, ConversationMessage[]>();

  // ── Client Lifecycle ──
  async initialize() {}
  async stop() {}
  async forceStop() {}
  getClientState(): CopilotClientState { return 'running'; }
  async ping() { return true; }
  async shutdown() {}

  // ── Model Discovery ──
  async getModels(): Promise<CopilotModel[]> {
    return [{ id: 'gpt-4.1', name: 'GPT-4.1' }, { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' }];
  }

  // ── Conversation Lifecycle ──
  async createConversation(params: CreateConversationParams) {
    this.conversations.add(params.conversationId);
    return params.conversationId;
  }
  async resumeConversation() {}
  async listConversations() { return [...this.conversations]; }
  async getLastConversationId() { return [...this.conversations].pop() ?? null; }
  async deleteConversation(id: string) { this.conversations.delete(id); }
  async destroyConversation(id: string) { this.conversations.delete(id); }

  // ── Messaging ──
  async sendPrompt(conversationId: string, prompt: string) {
    // Simulate async response
    setTimeout(() => {
      this.emitEvent(conversationId, { kind: 'copilot.message_complete', data: { content: 'Mock response' } });
      this.emitEvent(conversationId, { kind: 'copilot.idle', data: {} });
    }, 10);
  }
  async sendPromptAndWait(conversationId: string, prompt: string): Promise<ConversationResponse> {
    return { content: 'Mock response' };
  }
  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.messages.get(conversationId) ?? [];
  }
  async abortConversation() {}

  // ── Event Subscription ──
  onConversationEvent(conversationId: string, handler: (event: AgentEvent) => void) {
    const handlers = this.handlers.get(conversationId) ?? [];
    handlers.push(handler);
    this.handlers.set(conversationId, handlers);
    return () => { /* unsubscribe */ };
  }
  onClientEvent(handler: (event: CopilotClientEvent) => void) {
    this.clientEventHandlers.add(handler);
    return () => { this.clientEventHandlers.delete(handler); };
  }

  // ── Test Helpers ──
  emitEvent(conversationId: string, event: AgentEvent) {
    this.handlers.get(conversationId)?.forEach(h => h(event));
  }
  emitClientEvent(event: CopilotClientEvent) {
    this.clientEventHandlers.forEach(h => h(event));
  }
}
```

---

## 19. Logging & Observability

### 19.1 Structured Logging

```typescript
// packages/shared/src/logging/Logger.ts
import pino from 'pino';

export function createLogger(config: { level: string; service: string }) {
  return pino({
    level: config.level,
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
    base: { service: config.service },
    serializers: {
      err: pino.stdSerializers.err,
    },
    redact: ['*.apiKey', '*.token', '*.secret', '*.password'],
  });
}

// Usage:
const logger = createLogger({ level: 'info', service: 'server' });
logger.info({ sessionId, workflowId }, 'Workflow started');
logger.error({ err, sessionId }, 'Copilot connection failed');
```

### 19.2 Request Correlation

```typescript
// apps/server/src/middleware/requestId.ts
import { randomUUID } from 'crypto';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] as string ?? randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
```

### 19.3 ILogger Port Interface

```typescript
// packages/core/src/domain/ports/ILogger.ts
export interface ILogger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}
```

---

## 20. Deployment & Packaging

### 20.1 Build Targets

| App | Build Tool | Output | Distribution |
|---|---|---|---|
| **Server** | tsup (ESM bundle) | `dist/index.mjs` | Docker container / standalone Node.js |
| **Web** | Vite | `dist/` (static assets) | Served by Express or CDN |
| **Desktop** | electron-builder + Vite | `.dmg`, `.exe`, `.AppImage` | GitHub Releases / auto-update |
| **CLI** | tsup (CJS/ESM) | `dist/index.js` | npm registry (`@generatorai/cli`) |

### 20.2 Docker Configuration

```dockerfile
# Dockerfile (server + web)
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/ packages/
COPY apps/server/ apps/server/
COPY apps/web/ apps/web/
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@generatorai/server --filter=@generatorai/web

FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY --from=builder /app/apps/server/dist ./server/
COPY --from=builder /app/apps/web/dist ./web/
COPY --from=builder /app/node_modules ./node_modules/
EXPOSE 3100
CMD ["node", "server/index.mjs"]
```

### 20.3 Desktop Auto-Update

```typescript
// apps/desktop/src/main/updater.ts
import { autoUpdater } from 'electron-updater';

export function setupAutoUpdater() {
  autoUpdater.checkForUpdatesAndNotify();
  autoUpdater.on('update-available', () => {
    mainWindow.webContents.send('update:available');
  });
  autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update:ready');
  });
}
```

---

## 21. Session Resumption After App Restart

### 21.1 Startup Recovery Protocol

When the application starts, it must handle sessions that were `running` or `starting` when the app was last closed:

```typescript
// packages/core/src/services/StartupRecoveryService.ts

export class StartupRecoveryService {
  constructor(
    private sessionRepo: ISessionRepository,
    private workflowRepo: IWorkflowRepository,
    private copilot: ICopilotPort,
    private eventBus: EventBus,
    private logger: ILogger,
  ) {}

  /** Called once during application initialization */
  async recover(): Promise<void> {
    // 1. Restore EventBus sequence counters from DB
    await this.eventBus.restoreCounters();

    // 2. Find sessions that were active when app closed
    const activeSessions = await this.sessionRepo.getByStatus(['running', 'starting', 'cancelling']);

    for (const session of activeSessions) {
      this.logger.info({ sessionId: session.id }, 'Recovering interrupted session');

      // 3. Mark as paused (cannot resume running state after restart)
      await this.sessionRepo.updateStatus(session.id, 'paused');

      // 4. Mark running workflows as paused
      const workflows = await this.workflowRepo.getBySessionId(session.id);
      for (const wf of workflows) {
        if (wf.status === 'running' || wf.status === 'queued') {
          await this.workflowRepo.updateStatus(wf.id, 'paused');
        }
      }

      // 5. Attempt to resume Copilot conversations (best-effort)
      for (const wf of workflows) {
        if (wf.conversationId) {
          try {
            await this.copilot.resumeConversation(wf.conversationId);
            this.logger.info({ conversationId: wf.conversationId }, 'Copilot conversation resumed');
          } catch {
            this.logger.warn({ conversationId: wf.conversationId }, 'Could not resume Copilot conversation');
            // Conversation may have expired — will create new one on resume
          }
        }
      }

      // 6. Emit recovery event
      this.eventBus.emit(session.id, {
        kind: 'session.paused',
        data: { sessionId: session.id },
      });
    }

    this.logger.info({ recovered: activeSessions.length }, 'Startup recovery complete');
  }
}
```

### 21.2 Recovery Flow

```
App Restart
    │
    ├── 1. Initialize DB connection
    ├── 2. Initialize Copilot SDK client
    ├── 3. Run StartupRecoveryService.recover()
    │    ├── Restore EventBus counters
    │    ├── Find running/starting sessions
    │    ├── Mark as paused
    │    ├── Resume Copilot conversations (best-effort)
    │    └── Emit recovery events
    ├── 4. Start SSE transport
    ├── 5. Start HTTP server
    └── 6. Ready for requests
```

User sees their sessions with status `paused` and can click Resume to continue.

---

## 22. ScriptRunner Interface

### 22.1 IScriptRunner Port

```typescript
// packages/core/src/domain/ports/IScriptRunner.ts

export interface ScriptRunOptions {
  cwd: string;
  env?: Record<string, string>;
  timeout?: number;                  // ms, default 300_000 (5 min)
  abortSignal?: AbortSignal;
  streamTo?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface ScriptRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface IScriptRunner {
  /**
   * Run a command with arguments.
   * Command is validated against the allowed commands list.
   * stdout/stderr are streamed via `options.streamTo` and collected.
   */
  run(command: string, args: string[], options: ScriptRunOptions): Promise<ScriptRunResult>;

  /**
   * Check if a command is available on the system (via `which` / `where`).
   */
  isAvailable(command: string): Promise<boolean>;
}
```

### 22.2 Implementation

```typescript
// packages/core/src/infrastructure/SandboxedScriptRunner.ts
import { spawn } from 'child_process';
import path from 'path';

export class SandboxedScriptRunner implements IScriptRunner {
  constructor(private allowedCommands: Set<string>) {}

  async run(command: string, args: string[], options: ScriptRunOptions): Promise<ScriptRunResult> {
    // Security: validate command
    const binary = path.basename(command);
    if (!this.allowedCommands.has(binary)) {
      throw new SecurityError(`Command not allowed: ${command}`);
    }

    // Security: validate args
    for (const arg of args) {
      if (/[`$;|&]/.test(arg)) {
        throw new SecurityError(`Suspicious argument: ${arg}`);
      }
    }

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: false,          // CRITICAL: no shell interpretation
        timeout: options.timeout ?? 300_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Handle abort signal
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          proc.kill('SIGTERM');
          setTimeout(() => proc.kill('SIGKILL'), 5000);
        });
      }

      proc.stdout?.on('data', (data: Buffer) => {
        const line = data.toString();
        stdout += line;
        options.streamTo?.(line, 'stdout');
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const line = data.toString();
        stderr += line;
        options.streamTo?.(line, 'stderr');
      });

      // Limit output buffer (10MB)
      const MAX = 10 * 1024 * 1024;
      if (stdout.length > MAX) stdout = stdout.slice(-MAX);
      if (stderr.length > MAX) stderr = stderr.slice(-MAX);

      proc.on('exit', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout, stderr,
          durationMs: Date.now() - startTime,
        });
      });
      proc.on('error', reject);
    });
  }

  async isAvailable(command: string): Promise<boolean> {
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      const result = await this.run(which, [command], { cwd: process.cwd() });
      return result.exitCode === 0;
    } catch { return false; }
  }
}
```

---


---

## Appendix A: Complete Monorepo Package Map

```
generatorai/
├── apps/
│   ├── server/                    # Express/Fastify API server
│   │   ├── src/
│   │   │   ├── routes/            # REST endpoints + SSE
│   │   │   ├── middleware/        # Auth, validation, errors
│   │   │   ├── composition-root.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── desktop/                   # Electron application
│   │   ├── src/
│   │   │   ├── main/             # Main process (IPC, window mgmt)
│   │   │   ├── preload/          # Context bridge
│   │   │   └── renderer/         # Entry point (loads shared UI)
│   │   └── package.json
│   ├── web/                       # React web client (Vite)
│   │   ├── src/
│   │   │   ├── platform/         # HttpPlatformClient
│   │   │   └── App.tsx           # Wraps shared UI with provider
│   │   └── package.json
│   └── cli/                       # Ink CLI application
│       ├── src/
│       │   ├── commands/          # Commander.js command definitions
│       │   ├── components/        # Ink React components
│       │   ├── platform/          # DirectPlatformClient
│       │   └── index.tsx
│       └── package.json
├── packages/
│   ├── core/                      # Domain + Application layers
│   │   ├── src/
│   │   │   ├── domain/
│   │   │   │   ├── entities/
│   │   │   │   ├── value-objects/
│   │   │   │   ├── ports/         # Interfaces (ICopilotPort, ISessionRepo, etc.)
│   │   │   │   ├── state-machines/
│   │   │   │   └── events/
│   │   │   ├── services/
│   │   │   ├── events/            # EventBus
│   │   │   └── config/            # TemplateRegistry, ConfigResolver
│   │   └── package.json
│   ├── shared/                    # Types, DTOs, constants, utils
│   │   ├── src/
│   │   │   ├── types/
│   │   │   ├── config/            # Zod schemas (AppConfig, WorkflowTemplate)
│   │   │   ├── errors/
│   │   │   ├── constants/
│   │   │   └── utils/
│   │   └── package.json
│   ├── db/                        # SQLite + Drizzle persistence
│   │   ├── src/
│   │   │   ├── schema.ts
│   │   │   ├── migrations/
│   │   │   └── repositories/
│   │   └── package.json
│   ├── copilot-bridge/            # Copilot SDK adapter
│   │   ├── src/
│   │   │   ├── CopilotAdapter.ts
│   │   │   └── tool-factory.ts
│   │   └── package.json
│   ├── streaming/                 # SSE + Durable Stream
│   │   ├── src/
│   │   │   ├── SSETransport.ts
│   │   │   └── DurableStreamManager.ts
│   │   └── package.json
│   └── ui/                        # Shared React components
│       ├── src/
│       │   ├── components/
│       │   │   ├── SessionList.tsx
│       │   │   ├── SessionView.tsx
│       │   │   ├── WorkflowProgress.tsx
│       │   │   ├── ChatView.tsx
│       │   │   ├── StreamingText.tsx
│       │   │   └── ArtifactBrowser.tsx
│       │   ├── hooks/
│       │   │   ├── usePlatform.ts
│       │   │   ├── useSessionEvents.ts
│       │   │   └── useStreamingText.ts
│       │   └── stores/
│       │       └── streamStore.ts  # Zustand for streaming state
│       └── package.json
├── templates/                     # Predefined workflow templates
│   ├── code-generation.json
│   ├── code-review.json
│   ├── test-generation.json
│   └── refactoring.json
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

---


## Appendix B: Data Flow Summary Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                          GENERATORAI — COMPLETE DATA FLOW                          │
│                                                                                    │
│  USER ACTION                                                                       │
│  (Create Session + Start)                                                          │
│       │                                                                            │
│       ▼                                                                            │
│  ┌──────────┐     IPlatformClient      ┌─────────────┐                            │
│  │ UI/CLI   │ ───────────────────────▶ │ Application  │                            │
│  │ (React/  │                          │ Services     │                            │
│  │  Ink)    │                          │              │                            │
│  └──────────┘                          └──────┬──────┘                            │
│       ▲                                       │                                    │
│       │                                       ├── 1. Validate input (Zod)          │
│       │                                       ├── 2. Persist session (DB)          │
│       │                                       ├── 3. Clone repo (GitManager)       │
│       │                                       ├── 4. Run pre-hooks (HookExecutor)  │
│       │                                       ├── 5. Create Copilot session        │
│       │                                       ├── 6. Send workflow prompts         │
│       │                                       ├── 7. Run post-hooks               │
│       │                                       └── 8. Advance to next workflow      │
│       │                                                                            │
│       │  SSE / IPC                    All events persisted                         │
│       │  events stream                to SQLite events table                       │
│       │                                       │                                    │
│       │  ┌──────────┐               ┌─────────▼────────┐                          │
│       └──│ Streaming │◀──────────── │    EventBus       │                          │
│          │ Transport │              │  (in-process pub/ │                          │
│          │ (SSE)     │              │   sub emitter)    │                          │
│          └──────────┘              └───────────────────┘                          │
│                                             ▲                                      │
│                                             │ events from:                         │
│                                    ┌────────┼────────────────┐                    │
│                                    │        │                │                    │
│                              ┌─────┴──┐ ┌───┴────┐ ┌────────┴──┐                 │
│                              │Copilot │ │  Git   │ │  Script   │                 │
│                              │Adapter │ │Manager │ │  Runner   │                 │
│                              │(SDK)   │ │        │ │           │                 │
│                              └───┬────┘ └────────┘ └───────────┘                 │
│                                  │                                                 │
│                                  ▼                                                 │
│                           ┌──────────────┐                                        │
│                           │ Copilot CLI   │                                        │
│                           │ (JSON-RPC/    │                                        │
│                           │  stdio)       │                                        │
│                           └──────────────┘                                        │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix C: Architecture Decision Records (ADR)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| ADR-001 | CopilotClient cardinality | Single client, multiple sessions | SDK designed for it; 10x resource savings |
| ADR-002 | Event persistence | Event Sourcing + SQLite | Replay, audit trail, SSE resume |
| ADR-003 | Domain purity | Zero external deps in Domain Layer | Survives framework changes |
| ADR-004 | Copilot SDK integration | Port/Adapter pattern (ICopilotPort) | Replaceable, testable, no SDK type leakage |
| ADR-005 | State management | Explicit state machines (transition tables) | Prevents invalid states, self-documenting |
| ADR-006 | Platform abstraction | IPlatformClient interface | Same UI code across Web/Desktop |
| ADR-007 | CLI architecture | Direct in-process (no server needed) | Lowest latency, simplest deployment |
| ADR-008 | Hook execution | Phase-based, priority-ordered, policy-driven | Flexible, safe, predictable |
| ADR-009 | Error classification | Category + severity + recoverable flag | Consistent handling, correct UI surfacing |
| ADR-010 | Configuration | Zod schemas, layered resolution, template registry | Type-safe, extensible, validation at every boundary |
| ADR-011 | Client state | TanStack Query (server) + Zustand (streaming) | Official requirement; TQ for cache, Zustand for high-freq tokens |
| ADR-012 | UI framework | shadcn/ui + Tailwind + Radix | Accessible, composable, modern aesthetic |
| ADR-013 | Structured logging | pino with JSON output, secret redaction | Production-ready, low overhead, searchable |
| ADR-014 | Session recovery | Pause on restart, resume manually | Safe default; avoids unexpected state after crash |
| ADR-015 | Script execution | Sandboxed spawn, command allowlist | Security: prevents injection, limits blast radius |
| ADR-016 | DB ORM | Drizzle ORM + better-sqlite3 | TypeScript-native, minimal bundle, WAL support |
| ADR-017 | Webhook system | Event → Registration → Template → Auto-session | Extensible, audited, idempotent |
| ADR-018 | SDK lifecycle hooks | Dual-category (workflow phases + SDK events) with HookInterceptor | Taps into Copilot CLI/SDK lifecycle like Claude Code; enables tool blocking, audit, notifications |
| ADR-019 | Full SDK surface | ICopilotPort exposes all SDK methods (getModels, listSessions, BYOK, customAgents, etc.) | Future-proof; no hidden SDK capabilities; supports advanced use cases |
| ADR-020 | Permission handling | onPermissionRequest callback in CreateConversationParams | User control over Copilot tool permissions; auditable via hooks |
| ADR-021 | Global event channel | EventBus.emitGlobal() for client lifecycle events | Client lifecycle events are session-agnostic; need separate channel |

*This architecture document is now the definitive technical foundation for implementing GeneratorAI. Every interface, state transition, event flow, entity model, API endpoint, database schema, error path, and UI layout has been designed to specification. The next step is the detailed implementation plan with task breakdown and dependency ordering.*
