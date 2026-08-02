# GeneratorAI — Sandboxed Session Execution: Full Implementation Plan

> **Author**: Principal Architect  
> **Date**: March 3, 2026  
> **Status**: Architecture Decision Record — Pre-Implementation  
> **Inputs**: ARCHITECTURE_ANALYSIS.md, COPILOT_SDK_AGENT_ANALYSIS.md, WORKFLOW_ARCHITECTURE.md, Codebase Analysis

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [Problem Statement & Threat Model](#3-problem-statement--threat-model)
4. [Industry Research: How Modern Coding Agents Sandbox](#4-industry-research-how-modern-coding-agents-sandbox)
5. [Architecture Decision: SDK Inside Container](#5-architecture-decision-sdk-inside-container)
6. [Detailed Architecture Design](#6-detailed-architecture-design)
7. [Container Image Design](#7-container-image-design)
8. [Container Lifecycle Manager](#8-container-lifecycle-manager)
9. [Bridge Protocol: Host ↔ Container Communication](#9-bridge-protocol-host--container-communication)
10. [ContainerizedCopilotAdapter — New ICopilotPort Implementation](#10-containerizedcopilotadapter--new-icopilotport-implementation)
11. [Session Allocation Changes](#11-session-allocation-changes)
12. [Security Model](#12-security-model)
13. [Configuration Schema Changes](#13-configuration-schema-changes)
14. [Container Pool (Pre-Warming)](#14-container-pool-pre-warming)
15. [File System & Workspace Isolation](#15-file-system--workspace-isolation)
16. [Network Isolation](#16-network-isolation)
17. [Monitoring & Observability](#17-monitoring--observability)
18. [Graceful Degradation: Non-Container Fallback](#18-graceful-degradation-non-container-fallback)
19. [Implementation Roadmap](#19-implementation-roadmap)
20. [Testing Strategy](#20-testing-strategy)
21. [Risk Register](#21-risk-register)

---

## 1. Executive Summary

### The Goal

Every GeneratorAI session (Chat or WorkflowRun stage) must execute the Copilot CLI inside an **isolated Docker container**. The container owns the repo clone, file mutations, shell commands, and code generation. The host server stays clean — it only manages lifecycle, persists events to SQLite, and streams results to the web UI via SSE.

### Why This Is Critical

Today, the Copilot CLI runs as a **child process on the host machine** with access to the host filesystem, network, and environment. When the agent executes shell commands, writes files, or clones repos, it operates directly on the host. This creates:

1. **Security risk**: A malicious prompt or compromised model could execute arbitrary commands on the host
2. **Cross-session contamination**: Multiple sessions share the same filesystem namespace
3. **Resource leakage**: Runaway processes or disk usage in one session affect all others
4. **Non-reproducibility**: Sessions depend on host-installed tools, which may vary

### The Decision

**Run the full Copilot SDK + CLI inside each container** (not just the CLI). This provides complete blast-radius isolation — every file write, shell command, and git clone is confined to the container's ephemeral filesystem.

### Key Architecture Properties

| Property | Value | Rationale |
|----------|-------|-----------|
| Isolation unit | 1 Docker container per session | Complete filesystem/process/network isolation |
| SDK placement | Full SDK + CLI inside container | Complete blast-radius; simplest mental model |
| Communication | TCP JSON-RPC bridge (host ↔ container) | Debuggable, portable, works with Docker port mapping |
| Repo access | Clone inside container | No host filesystem exposure |
| Auth | Environment variable injection | Simple, works with GitHub token forwarding |
| Container pool | Pre-warmed (min 2, max configurable) | Achieves <3s session startup |
| Fallback | Direct host execution (current behavior) | Graceful degradation when Docker unavailable |

---

## 2. Current Architecture Analysis

### 2.1 How Sessions Run Today

```
Host Machine
┌───────────────────────────────────────────────────────────┐
│  Express Server (apps/server)                              │
│  ├── SessionService           ← creates/manages sessions  │
│  ├── SessionAllocator         ← allocates sessions to      │
│  │                              stages/chats               │
│  ├── WorkflowRunService       ← orchestrates DAG execution │
│  ├── StageExecutionService    ← executes individual stages │
│  └── EventBus → SSE streams   ← pushes to web UI          │
│                                                            │
│  CopilotAdapter (packages/copilot-bridge)                  │
│  ├── CopilotClient (SDK)      ← wraps the CLI process     │
│  │   └── child_process.spawn  ← RUNS ON HOST              │
│  │       └── copilot CLI      ← HAS FULL HOST ACCESS      │
│  │           ├── file writes  ← TO HOST FILESYSTEM         │
│  │           ├── shell exec   ← ON HOST SHELL              │
│  │           └── git clone    ← INTO HOST DIRECTORIES      │
│  └── SandboxedScriptRunner    ← command allowlist only     │
│                                                            │
│  Database (SQLite)            ← stores sessions/events     │
│  Workspace dir (~/.generatorai/workspaces/)                │
└───────────────────────────────────────────────────────────┘
```

### 2.2 Current Security Measures (Insufficient)

| Mechanism | Location | Limitation |
|-----------|----------|------------|
| `COMMAND_ALLOWLIST` | `SandboxedScriptRunner.ts` | Only gates `ScriptRunner` — CLI bypasses this entirely |
| `DANGEROUS_PATTERNS` regex | `SandboxedScriptRunner.ts` | Pattern-based; trivially circumvented |
| `onPermissionRequest` handler | `CopilotAdapter.ts` | Policy-based; models can social-engineer approvals |
| `shell: false` in spawn | `SandboxedScriptRunner.ts` | Only applies to `ScriptRunner`, not CLI's own shell |

**Critical gap**: The Copilot CLI itself executes shell commands, writes files, and accesses the network **without going through `SandboxedScriptRunner`**. The CLI is the agent runtime — it decides what tools to call, and it has full host access.

### 2.3 Key Files That Must Change

| File | Current Role | Change Required |
|------|-------------|-----------------|
| `packages/shared/src/config/AppConfig.ts` | App configuration schema | Add `sandbox` config section |
| `packages/copilot-bridge/src/CopilotAdapter.ts` | ICopilotPort impl (direct CLI) | Keep as fallback mode |
| `packages/core/src/services/SessionAllocator.ts` | Allocates sessions | Wire container lifecycle |
| `packages/core/src/services/SessionService.ts` | Session lifecycle | Integrate container create/destroy |
| `packages/core/src/infrastructure/GitManager.ts` | Git operations on host | Delegate to container |
| `apps/server/src/composition-root.ts` | DI wiring | Conditionally use containerized adapter |

### 2.4 Key Files That Are NEW

| File | Purpose |
|------|---------|
| `packages/sandbox/` | New package: container lifecycle management |
| `packages/sandbox/src/ContainerManager.ts` | Docker container CRUD via `dockerode` |
| `packages/sandbox/src/ContainerPool.ts` | Pre-warmed container pool |
| `packages/sandbox/src/ContainerBridge.ts` | TCP JSON-RPC bridge protocol handler |
| `packages/sandbox/src/ContainerizedCopilotAdapter.ts` | New `ICopilotPort` impl that delegates to containerized CLI |
| `packages/sandbox/src/Dockerfile` | Container image definition |
| `packages/sandbox/src/container-entrypoint.ts` | Node.js process inside container that runs SDK+CLI |

---

## 3. Problem Statement & Threat Model

### 3.1 Threats Addressed by Sandboxing

| Threat | Severity | Current Mitigation | Sandbox Mitigation |
|--------|----------|--------------------|--------------------|
| **Arbitrary command execution** — model decides to run `rm -rf /` | Critical | Allowlist in `ScriptRunner` (CLI bypasses it) | Container filesystem is ephemeral; worst case = container restart |
| **Data exfiltration** — model sends host files to external server | High | None (CLI has full network) | Network egress restricted to GitHub APIs only |
| **Cross-session file access** — session A reads session B's cloned repo | High | None (shared workspaces dir) | Each container has isolated filesystem |
| **Resource exhaustion** — runaway process consumes all CPU/RAM | High | Process timeout in `ScriptRunner` | Docker cgroup limits (CPU, memory, PID count) |
| **Dependency confusion** — malicious npm package executed during install | Medium | None | Container has limited packages; network-restricted |
| **Host env leakage** — session reads host env vars (API keys, tokens) | Medium | None | Container gets only explicitly passed env vars |
| **Persistent backdoor** — session installs cron job or reverse shell | High | None | Container is ephemeral; destroyed on session end |

### 3.2 Non-Threats (Out of Scope)

| Non-Threat | Why |
|------------|-----|
| Model prompt injection | SDK/CLI responsibility (system message guardrails) |
| API key theft from Copilot auth | GitHub token is required for CLI to function; mitigated with short-lived tokens |
| Container breakout (kernel exploit) | Mitigated by gVisor/Kata if required; default Docker is sufficient for most use cases |

---

## 4. Industry Research: How Modern Coding Agents Sandbox

### 4.1 Devin (Cognition Labs)

**Architecture**: Each "Devin session" runs in a **full cloud VM** (likely Firecracker microVM on AWS). The VM includes a complete dev environment: VS Code server, terminal, browser, and the AI agent. Users connect via web browser.

**Key insight**: Devin chose VMs over containers because coding agents need:
- Full system-level access (systemd, apt, npm global installs)
- Browser automation (Puppeteer/Playwright)
- Long-running processes (dev servers)

**Relevance to us**: We don't need full VM — our agent (Copilot CLI) doesn't need browsers or system services. Docker containers provide sufficient isolation at much lower overhead.

### 4.2 OpenAI Codex

**Architecture**: Codex runs each task in a **sandboxed cloud container** with:
- Pre-installed language runtimes and tools
- Network access restricted to the user's repo (via SSH/HTTPS cloning)
- Ephemeral filesystem — destroyed on task completion
- Resource limits on compute time (configurable by user)

**Key insight**: Codex uses the `--allow-all-tools` Flag equivalent internally (auto-approve all tool calls) because the container is the security boundary, not the permission system.

**Relevance to us**: This validates our approach — the container IS the permission system. We can safely auto-approve file writes and shell commands inside the container.

### 4.3 E2B (Open Source)

**Architecture**: E2B provides open-source cloud-based sandboxes specifically designed for AI agents:
- Firecracker microVMs with <150ms boot time
- Accessible via SDK (TypeScript/Python)
- Each sandbox has a full Linux environment
- Network-isolated by default
- Supports code execution, file operations, and process management

**Key insight**: E2B separates "control plane" (agent orchestration) from "data plane" (code execution). The control plane never touches the filesystem; it sends commands to the sandbox and receives results.

**Relevance to us**: This directly maps to our architecture. The host server (control plane) sends prompts/commands to the containerized CLI (data plane) and receives events back.

### 4.4 GitHub Copilot Workspace

**Architecture**: Copilot Workspace (codespaces-powered) runs code in **full cloud dev environments** (Codespaces). Each workspace is a Docker container running in a VM, with:
- Full VS Code server
- SSH access
- Port forwarding
- Persistent filesystem (across workspace restarts)

**Key insight**: GitHub chose persistent containers (not ephemeral) because developers need continuity. But for automated agent sessions, ephemeral is better — clean slate = reproducible results.

### 4.5 Cursor / Windsurf

**Architecture**: These run locally — the AI agent executes in the same process as the IDE extension. No sandboxing beyond the OS user account.

**Key insight**: IDE-based agents accept the host compromise risk because the user is present and can see/approve every change. For a headless, multi-tenant, server-based agent like GeneratorAI, this model is unacceptable.

### 4.6 Pattern Convergence

```
┌─────────────────────────────────────────────────────────────┐
│  All production-grade coding agents converge on:             │
│                                                              │
│  1. Isolated execution environment (container or VM)         │
│  2. Ephemeral by default (clean state per session)           │
│  3. Network-restricted (only allow necessary APIs)           │
│  4. Auto-approved tool calls inside the sandbox              │
│  5. Event streaming from sandbox to control plane            │
│  6. Resource limits (CPU, memory, time)                      │
│  7. The sandbox IS the security boundary, not permissions    │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Architecture Decision: SDK Inside Container

### 5.1 Three Possible Approaches

**Approach A: CLI only inside container, SDK on host**

```
Host: SDK (CopilotClient) → TCP → Container: CLI (copilot --server)
```

The SDK on the host connects to the CLI running inside the container via TCP (`cliUrl` option). The SDK manages the connection, the container runs only the CLI binary.

**Approach B: SDK + CLI inside container, thin bridge on host**

```
Host: BridgeClient → TCP → Container: BridgeServer + SDK + CLI
```

The entire SDK and CLI run inside the container. A thin "bridge" process inside the container exposes a JSON-RPC API that the host calls to create sessions, send prompts, and receive events.

**Approach C: Full split — container runs a micro-service**

```
Host: HTTP Client → REST → Container: Express + SDK + CLI
```

The container runs a small HTTP server wrapping the SDK. The host communicates via REST/WebSocket.

### 5.2 Decision Matrix

| Criterion | A: CLI in container | B: SDK+CLI in container | C: Full microservice |
|-----------|--------------------|-----------------------|---------------------|
| **Blast-radius isolation** | Partial — SDK still runs on host, manages process | **Complete** — all agent code in container | **Complete** |
| **Complexity** | Moderate — must handle cross-process SDK plumbing | **Low** — SDK handles CLI internally as normal | High — full HTTP API layer |
| **SDK compatibility** | Requires `cliUrl` mode (less tested) | **Default mode** (`useStdio: true`) — most tested path | Custom wrapper atop SDK |
| **Startup time** | Fast (CLI is lightweight) | **Moderate** (Node.js + SDK + CLI) | Slow (Express + Node.js + SDK + CLI) |
| **Event streaming** | SDK receives events directly (native) | **Bridge forwards events** — one hop | WebSocket/SSE — two hops |
| **Auth handling** | Token passed to container env | **Token passed to container env** | Token passed to container env |
| **Debugging** | Hard (split process debugging) | **Easy** (single container, one process) | Moderate (HTTP debugging tools) |
| **Maintenance** | Must track SDK-CLI protocol changes | **Zero** — SDK abstracts protocol | Must maintain REST API contract |
| **Port management** | Need to expose CLI's TCP port | **Need to expose bridge port** | Need to expose HTTP port |

### 5.3 Decision: **Approach B — SDK + CLI Inside Container**

**Rationale:**

1. **Complete blast-radius**: The SDK process itself calls `child_process.spawn` to run the CLI. If the SDK runs on the host, the CLI's child process (which spawns further child processes for tool execution) also runs on the host — defeating the purpose.

2. **Default code path**: `useStdio: true` is the default, most-tested transport mode. Approach A requires `cliUrl` mode which is less tested and designed for debugging scenarios.

3. **Simplest mental model**: "Everything dangerous runs inside the container" — no split-brain debugging.

4. **The SDK manages CLI lifecycle**: Auto-restart, health checks, process cleanup all work normally inside the container because the SDK doesn't know it's containerized.

5. **Port management simplicity**: We only need one port exposed (the bridge port), not the CLI's internal port.

---

## 6. Detailed Architecture Design

### 6.1 Target Architecture

```
Host Machine
┌──────────────────────────────────────────────────────────────────────┐
│  Express Server (apps/server)                                        │
│  ├── SessionService / SessionAllocator                               │
│  ├── WorkflowRunService / StageExecutionService                      │
│  ├── EventBus → DurableStreamManager → SSE → Web UI                 │
│  │                                                                    │
│  ├── ContainerizedCopilotAdapter (NEW — implements ICopilotPort)     │
│  │   ├── ContainerManager (creates/destroys Docker containers)       │
│  │   ├── ContainerPool (pre-warmed containers for fast start)        │
│  │   └── ContainerBridge (TCP JSON-RPC to container)                 │
│  │       │                                                            │
│  │       │  TCP :9222 (JSON-RPC)                                     │
│  │       ▼                                                            │
│  └── SQLite DB (sessions, events, messages, artifacts)               │
│                                                                       │
│  Docker Daemon                                                        │
│  ├── Container: session-abc123                                        │
│  │   ├── container-entrypoint.ts (BridgeServer)                      │
│  │   ├── @github/copilot-sdk (CopilotClient)                        │
│  │   │   └── copilot CLI (child_process, stdio JSON-RPC)             │
│  │   │       ├── LLM calls → GitHub API                              │
│  │   │       ├── file writes → /workspace/ (container-local)         │
│  │   │       ├── shell exec → within container                       │
│  │   │       └── git clone → into /workspace/ (container-local)      │
│  │   └── /workspace/ (ephemeral volume)                              │
│  │                                                                    │
│  ├── Container: session-def456 (concurrent session)                  │
│  │   └── ... (same structure)                                        │
│  │                                                                    │
│  └── Pool: pre-warmed containers (idle, ready to claim)              │
└──────────────────────────────────────────────────────────────────────┘
```
### 6.2 Component Interaction Sequence

```
User clicks "New Chat" in web UI
  │
  ▼
Web UI → POST /api/v2/chats → ChatManagementService.create()
  │
  ▼
SessionAllocator.allocateSession()
  │
  ▼
ContainerizedCopilotAdapter.createConversation(params)
  │
  ├── 1. ContainerPool.acquire() → returns pre-warmed container
  │     (or ContainerManager.create() if pool is empty)
  │
  ├── 2. ContainerBridge.connect(containerId, port)
  │     ← TCP handshake to container's BridgeServer
  │
  ├── 3. bridge.call('createSession', { sessionConfig })
  │     → BridgeServer inside container:
  │       → CopilotClient.createSession(config)
  │       → CopilotSession created
  │       ← returns { conversationId }
  │
  ├── 4. bridge.subscribe('sessionEvents', handler)
  │     → BridgeServer forwards CopilotSession events
  │     → handler maps to AgentEvent and emits on EventBus
  │
  └── 5. Return conversationId to SessionAllocator
  │
  ▼
EventBus → SSE → Web UI (user sees "Session ready")
```

### 6.3 Package Structure

```
packages/sandbox/
├── package.json
├── tsconfig.json
├── Dockerfile                          ← Container image definition
├── .dockerignore
├── src/
│   ├── index.ts                        ← Package exports
│   ├── ContainerManager.ts             ← Docker container CRUD (dockerode)
│   ├── ContainerPool.ts                ← Pre-warmed container pool
│   ├── ContainerBridge.ts              ← TCP JSON-RPC client (host-side)
│   ├── ContainerizedCopilotAdapter.ts  ← ICopilotPort impl using containers
│   ├── bridge-protocol.ts             ← Shared types for bridge messages
│   ├── container-entrypoint.ts         ← Container-side: BridgeServer + SDK
│   ├── health.ts                       ← Container health check logic
│   └── types.ts                        ← Shared types
└── __tests__/
    ├── ContainerManager.test.ts
    ├── ContainerPool.test.ts
    ├── ContainerBridge.test.ts
    └── ContainerizedCopilotAdapter.test.ts
```

---

## 7. Container Image Design

### 7.1 Dockerfile

```dockerfile
# ── Stage 1: Build the bridge entrypoint ──
FROM node:22-slim AS builder

WORKDIR /build
COPY packages/sandbox/package.json packages/sandbox/tsconfig.json ./
COPY packages/sandbox/src/container-entrypoint.ts ./src/
COPY packages/sandbox/src/bridge-protocol.ts ./src/
COPY packages/sandbox/src/health.ts ./src/

# Install production deps only
RUN npm install --production

# Compile TypeScript
RUN npx tsc --outDir dist

# ── Stage 2: Runtime image ──
FROM node:22-slim

# Install Copilot CLI + essential tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    openssh-client \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub Copilot CLI
RUN npm install -g @github/copilot-cli

# Install the Copilot SDK (used by bridge entrypoint)
RUN npm install -g @github/copilot-sdk

# Create non-root user for session execution
RUN useradd --create-home --shell /bin/bash agent && \
    mkdir -p /workspace && \
    chown agent:agent /workspace

# Copy bridge entrypoint from builder
COPY --from=builder /build/dist /opt/bridge/
COPY --from=builder /build/node_modules /opt/bridge/node_modules/

# Workspace directory (ephemeral)
VOLUME /workspace
WORKDIR /workspace

# Bridge port
EXPOSE 9222

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD node /opt/bridge/health.js || exit 1

# Run as non-root
USER agent

# Entrypoint: start the bridge server
ENTRYPOINT ["node", "/opt/bridge/container-entrypoint.js"]
```

### 7.2 Image Optimization Rationale

| Decision | Rationale |
|----------|-----------|
| `node:22-slim` base | Smallest official Node.js image with necessary libc |
| Multi-stage build | Bridge code compiled separately; final image has no devDeps |
| Non-root `agent` user | Principle of least privilege; prevents writing outside /workspace |
| `VOLUME /workspace` | Docker marks this as ephemeral; data doesn't persist |
| Essential tools only | `git`, `curl`, `jq` — minimum needed for coding agent tasks |
| No `sudo`, no `apt` at runtime | Prevents package installation (intentional restriction) |

### 7.3 Image Size Target

| Component | Size |
|-----------|------|
| node:22-slim base | ~180 MB |
| Git + tools | ~30 MB |
| Copilot CLI | ~50 MB |
| Copilot SDK | ~20 MB |
| Bridge code | ~1 MB |
| **Total** | **~281 MB** |

This is acceptable — images are cached locally. First pull is a one-time cost.

---

## 8. Container Lifecycle Manager

### 8.1 ContainerManager Interface

```typescript
// packages/sandbox/src/ContainerManager.ts

import Docker from 'dockerode';

export interface ContainerConfig {
  /** Session ID that owns this container */
  sessionId: string;
  /** GitHub auth token for Copilot CLI */
  githubToken: string;
  /** Resource limits */
  limits: ResourceLimits;
  /** Network restrictions */
  network: NetworkConfig;
  /** Environment variables to pass */
  env?: Record<string, string>;
  /** Initial repo to clone (optional) */
  repoUrl?: string;
  repoBranch?: string;
}

export interface ResourceLimits {
  /** CPU cores (e.g., 2.0 = 2 cores) */
  cpuCount: number;
  /** Memory in bytes (e.g., 4 * 1024^3 = 4 GB) */
  memoryBytes: number;
  /** Max disk usage in bytes */
  diskBytes: number;
  /** Max number of processes */
  pidsLimit: number;
  /** Session timeout in milliseconds */
  timeoutMs: number;
}

export interface NetworkConfig {
  /** Allowed outbound domains */
  allowedDomains: string[];
  /** Block all egress except allowed */
  restrictEgress: boolean;
}

export interface ManagedContainer {
  id: string;
  dockerId: string;
  sessionId: string | null;
  bridgePort: number;
  status: 'creating' | 'ready' | 'claimed' | 'stopping' | 'stopped';
  createdAt: Date;
}
```

### 8.2 ContainerManager Implementation Outline

```typescript
export class ContainerManager {
  private docker: Docker;
  private containers = new Map<string, ManagedContainer>();
  
  constructor(
    private logger: ILogger,
    private config: SandboxConfig,
  ) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async createContainer(config: ContainerConfig): Promise<ManagedContainer> {
    const bridgePort = await this.findFreePort();
    
    const container = await this.docker.createContainer({
      Image: this.config.imageName,
      name: `generatorai-session-${config.sessionId}`,
      Env: [
        `GITHUB_TOKEN=${config.githubToken}`,
        `BRIDGE_PORT=9222`,
        `SESSION_ID=${config.sessionId}`,
        ...(config.repoUrl ? [`REPO_URL=${config.repoUrl}`] : []),
        ...(config.repoBranch ? [`REPO_BRANCH=${config.repoBranch}`] : []),
        ...Object.entries(config.env ?? {}).map(([k, v]) => `${k}=${v}`),
      ],
      ExposedPorts: { '9222/tcp': {} },
      HostConfig: {
        PortBindings: { '9222/tcp': [{ HostPort: String(bridgePort) }] },
        Memory: config.limits.memoryBytes,
        NanoCpus: config.limits.cpuCount * 1e9,
        PidsLimit: config.limits.pidsLimit,
        ReadonlyRootfs: false, // Agent needs to write to /workspace
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'SETUID', 'SETGID'],  // Minimum for git/npm
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=256m' },
        NetworkMode: config.network.restrictEgress 
          ? 'generatorai-restricted' 
          : 'bridge',
      },
      Labels: {
        'generatorai.session': config.sessionId,
        'generatorai.purpose': 'session-sandbox',
      },
      StopTimeout: 10,
    });

    await container.start();

    const managed: ManagedContainer = {
      id: config.sessionId,
      dockerId: container.id,
      sessionId: config.sessionId,
      bridgePort,
      status: 'creating',
      createdAt: new Date(),
    };

    this.containers.set(config.sessionId, managed);
    
    // Wait for bridge to be ready
    await this.waitForBridge(bridgePort);
    managed.status = 'ready';

    return managed;
  }

  async destroyContainer(sessionId: string): Promise<void> {
    const managed = this.containers.get(sessionId);
    if (!managed) return;
    
    managed.status = 'stopping';
    
    try {
      const container = this.docker.getContainer(managed.dockerId);
      await container.stop({ t: 10 });
      await container.remove({ force: true });
    } catch {
      // Container may already be stopped
    }
    
    managed.status = 'stopped';
    this.containers.delete(sessionId);
  }

  async destroyAll(): Promise<void> {
    const promises = [...this.containers.keys()].map(id => this.destroyContainer(id));
    await Promise.allSettled(promises);
  }
}
```

### 8.3 Why `dockerode` Over Docker CLI

| Alternative | Problem |
|-------------|---------|
| `docker` CLI via `child_process` | String parsing, shell injection risk, slower than API |
| `@docker/sdk` (experimental) | Not production-ready as of 2026 |
| Kubernetes API | Overkill for single-node; adds massive complexity |
| **`dockerode`** | **Mature, well-maintained, native Docker Engine API client** |

---

## 9. Bridge Protocol: Host ↔ Container Communication

### 9.1 Protocol Design

The bridge is a **bidirectional JSON-RPC 2.0 over TCP** connection between the host and the container's entrypoint process.

```typescript
// packages/sandbox/src/bridge-protocol.ts

/** Host → Container requests */
export type BridgeRequest =
  | { method: 'createSession'; params: CreateSessionBridgeParams }
  | { method: 'resumeSession'; params: { conversationId: string } }
  | { method: 'sendPrompt'; params: { conversationId: string; prompt: string; attachments?: AttachmentRef[] } }
  | { method: 'sendPromptAndWait'; params: { conversationId: string; prompt: string; attachments?: AttachmentRef[] } }
  | { method: 'abortConversation'; params: { conversationId: string } }
  | { method: 'destroyConversation'; params: { conversationId: string } }
  | { method: 'getMessages'; params: { conversationId: string } }
  | { method: 'getModels'; params: {} }
  | { method: 'ping'; params: {} }
  | { method: 'shutdown'; params: {} }
  | { method: 'cloneRepo'; params: { repoUrl: string; branch?: string } }
  | { method: 'getWorkspacePath'; params: {} };

/** Container → Host notifications (events, no response expected) */
export type BridgeNotification =
  | { method: 'event'; params: { conversationId: string; event: SessionEventData } }
  | { method: 'clientEvent'; params: { event: ClientEventData } }
  | { method: 'log'; params: { level: string; message: string } };

export interface CreateSessionBridgeParams {
  conversationId: string;
  model?: string;
  systemMessage?: { mode: 'append' | 'replace'; content: string };
  tools?: ToolDefinitionData[];
  availableTools?: string[];
  excludedTools?: string[];
  streaming?: boolean;
  workingDirectory?: string;
  mcpServers?: Record<string, unknown>;
}
```

### 9.2 Why JSON-RPC Over TCP

| Alternative | Problem |
|-------------|---------|
| HTTP REST | Overhead of HTTP framing; stateless by nature (need WebSocket for events) |
| gRPC | Requires protobuf definitions, code generation; overkill |
| WebSocket | Additional framing layer unnecessary over raw TCP |
| Unix socket mount | Breaks isolation model (shared socket file) |
| **JSON-RPC over TCP** | **Minimal overhead, bidirectional, natively supports notifications (events)** |

### 9.3 Container Entrypoint (BridgeServer)

```typescript
// packages/sandbox/src/container-entrypoint.ts (runs INSIDE container)

import net from 'node:net';
import { CopilotClient } from '@github/copilot-sdk';
import type { CopilotSession, SessionEvent, SessionConfig } from '@github/copilot-sdk';

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT ?? '9222', 10);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_URL = process.env.REPO_URL;
const REPO_BRANCH = process.env.REPO_BRANCH;

class BridgeServer {
  private client: CopilotClient;
  private sessions = new Map<string, CopilotSession>();
  private socket: net.Socket | null = null;

  constructor() {
    this.client = new CopilotClient({
      autoStart: true,
      autoRestart: true,
      useStdio: true,         // Default: SDK spawns CLI as child process
      cwd: '/workspace',      // All CLI operations scoped to /workspace
      env: {
        GITHUB_TOKEN: GITHUB_TOKEN!,
        HOME: '/home/agent',
      },
    });
  }

  async start(): Promise<void> {
    await this.client.start();
    
    // Auto-clone repo if configured
    if (REPO_URL) {
      await this.cloneRepo(REPO_URL, REPO_BRANCH);
    }

    // Start TCP server
    const server = net.createServer((socket) => {
      this.socket = socket;
      this.handleConnection(socket);
    });

    server.listen(BRIDGE_PORT, '0.0.0.0', () => {
      console.log(`[Bridge] Listening on port ${BRIDGE_PORT}`);
    });
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      // Split on newlines (JSON-RPC messages are newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      
      for (const line of lines) {
        if (line.trim()) {
          this.handleMessage(JSON.parse(line), socket);
        }
      }
    });
  }

  private async handleMessage(msg: any, socket: net.Socket): Promise<void> {
    const { id, method, params } = msg;

    try {
      let result: unknown;

      switch (method) {
        case 'createSession':
          result = await this.createSession(params);
          break;
        case 'sendPrompt':
          result = await this.sendPrompt(params);
          break;
        case 'sendPromptAndWait':
          result = await this.sendPromptAndWait(params);
          break;
        case 'abortConversation':
          await this.abortConversation(params.conversationId);
          result = { ok: true };
          break;
        case 'destroyConversation':
          await this.destroyConversation(params.conversationId);
          result = { ok: true };
          break;
        case 'getMessages':
          result = await this.getMessages(params.conversationId);
          break;
        case 'getModels':
          result = await this.client.listModels();
          break;
        case 'ping':
          result = await this.client.ping('health');
          break;
        case 'shutdown':
          await this.shutdown();
          result = { ok: true };
          break;
        case 'cloneRepo':
          result = await this.cloneRepo(params.repoUrl, params.branch);
          break;
        case 'getWorkspacePath':
          result = { path: '/workspace' };
          break;
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      this.sendResponse(socket, id, result);
    } catch (err) {
      this.sendError(socket, id, err instanceof Error ? err.message : String(err));
    }
  }

  private async createSession(params: CreateSessionBridgeParams): Promise<{ conversationId: string }> {
    const config: SessionConfig = {
      sessionId: params.conversationId,
      model: params.model ?? 'gpt-4.1',
      streaming: params.streaming ?? true,
      workingDirectory: '/workspace',
      systemMessage: params.systemMessage,
      availableTools: params.availableTools,
      excludedTools: params.excludedTools,
    };

    if (params.mcpServers) {
      config.mcpServers = params.mcpServers as SessionConfig['mcpServers'];
    }

    const session = await this.client.createSession(config);
    this.sessions.set(params.conversationId, session);

    // Forward events to host
    session.on((event: SessionEvent) => {
      this.sendNotification('event', {
        conversationId: params.conversationId,
        event: { type: event.type, data: event.data, timestamp: event.timestamp },
      });
    });

    return { conversationId: params.conversationId };
  }

  // ... remaining methods follow the same pattern
}

const bridge = new BridgeServer();
bridge.start().catch((err) => {
  console.error('[Bridge] Fatal:', err);
  process.exit(1);
});
```

### 9.4 Why This Bridge Over Direct SDK Connection

The critical question is: "Why not have the host SDK connect to the CLI inside the container via `cliUrl`?"

| Factor | Bridge approach | Direct `cliUrl` approach |
|--------|----------------|--------------------------|
| **Tool handler execution** | Inside container (safe) | On host (UNSAFE — tools execute where SDK runs) |
| **Custom agents** | Inside container | On host |
| **SDK process manage** | Container-local | Host would manage container-internal process |
| **Auth token scope** | Container env only | Host process env |
| **Node.js version coupling** | Independent | Host and container must match |

The killer argument: **SDK custom tool handlers execute in the SDK process**. If the SDK runs on the host, custom tool handlers run on the host — including any tools the model invokes that write files or run commands. This defeats sandboxing entirely.

---

## 10. ContainerizedCopilotAdapter — New ICopilotPort Implementation

### 10.1 Design

This is the new `ICopilotPort` implementation that replaces `CopilotAdapter` when sandbox mode is enabled. It delegates all operations to containerized sessions via the bridge protocol.

```typescript
// packages/sandbox/src/ContainerizedCopilotAdapter.ts

export class ContainerizedCopilotAdapter implements ICopilotPort {
  /** Maps conversationId → { containerId, bridge } */
  private sessions = new Map<string, ContainerSession>();
  private clientEventHandlers = new Set<(event: CopilotClientEvent) => void>();

  constructor(
    private containerManager: ContainerManager,
    private containerPool: ContainerPool,
    private config: SandboxConfig,
    private logger: ILogger,
  ) {}

  // ── Client Lifecycle ──

  async initialize(): Promise<void> {
    // Pre-warm the container pool
    await this.containerPool.initialize();
    this.emitClientEvent({ type: 'client.started' });
  }

  async stop(): Promise<void> {
    // Don't destroy containers on stop — they're session-scoped
    this.emitClientEvent({ type: 'client.stopped' });
  }

  getClientState(): CopilotClientState {
    return 'running'; // Always running — containers are independent
  }

  async ping(): Promise<boolean> {
    // Ping the container pool health
    return this.containerPool.isHealthy();
  }

  async shutdown(): Promise<void> {
    // Destroy all active sessions and their containers
    for (const [convId, session] of this.sessions) {
      await session.bridge.call('shutdown', {});
      await this.containerManager.destroyContainer(session.containerId);
    }
    this.sessions.clear();
    await this.containerPool.drain();
    this.emitClientEvent({ type: 'client.stopped' });
  }

  // ── Conversation Lifecycle ──

  async createConversation(params: CreateConversationParams): Promise<string> {
    // 1. Acquire container (from pool or create new)
    const container = await this.containerPool.acquire(params.conversationId);

    // 2. Connect bridge
    const bridge = new ContainerBridge(container.bridgePort, this.logger);
    await bridge.connect();

    // 3. Clone repo if needed
    if (params.workingDirectory) {
      // workingDirectory for sandbox maps to a repo clone
      // (handled separately by SessionService)
    }

    // 4. Create session inside container
    const result = await bridge.call<{ conversationId: string }>('createSession', {
      conversationId: params.conversationId,
      model: params.model,
      systemMessage: params.systemMessage,
      streaming: params.streaming,
      availableTools: params.availableTools,
      excludedTools: params.excludedTools,
      mcpServers: params.mcpServers,
    });

    // 5. Track session
    this.sessions.set(params.conversationId, {
      containerId: container.id,
      bridge,
      conversationId: params.conversationId,
    });

    return params.conversationId;
  }

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
  ): Promise<void> {
    const session = this.getSession(conversationId);
    await session.bridge.call('sendPrompt', {
      conversationId,
      prompt,
      attachments,
    });
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
  ): Promise<ConversationResponse> {
    const session = this.getSession(conversationId);
    return session.bridge.call<ConversationResponse>('sendPromptAndWait', {
      conversationId,
      prompt,
      attachments,
    });
  }

  async abortConversation(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session) {
      await session.bridge.call('abortConversation', { conversationId });
    }
  }

  async destroyConversation(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session) return;

    // 1. Destroy conversation inside container
    await session.bridge.call('destroyConversation', { conversationId });

    // 2. Disconnect bridge
    session.bridge.disconnect();

    // 3. Return container to pool (or destroy)
    await this.containerPool.release(session.containerId);

    this.sessions.delete(conversationId);
  }

  // ── Event Subscription ──

  onConversationEvent(
    conversationId: string,
    handler: (event: AgentEvent) => void,
  ): () => void {
    const session = this.getSession(conversationId);
    // Subscribe to bridge notifications for this conversation
    return session.bridge.onEvent(conversationId, (eventData) => {
      handler(mapBridgeEventToAgentEvent(eventData));
    });
  }
}
```

### 10.2 Why a New Class Instead of Modifying CopilotAdapter

| Option | Problem |
|--------|---------|
| Add container logic to `CopilotAdapter` | Violates SRP; mixes direct-process and container concerns |
| Strategy pattern inside `CopilotAdapter` | Over-engineering; the two modes share zero implementation code |
| **New class implementing `ICopilotPort`** | **Clean separation; composition root selects implementation based on config** |

This is the power of the Port/Adapter pattern already in the codebase — `ICopilotPort` is the port, and we add a second adapter.

### 10.3 Composition Root Change

```typescript
// apps/server/src/composition-root.ts — modified section

function createCopilotPort(config: AppConfig, logger: ILogger): ICopilotPort {
  if (config.sandbox?.enabled) {
    const containerManager = new ContainerManager(logger, config.sandbox);
    const containerPool = new ContainerPool(containerManager, logger, {
      minPoolSize: config.sandbox.pool.minSize,
      maxPoolSize: config.sandbox.pool.maxSize,
    });
    
    return new ContainerizedCopilotAdapter(
      containerManager,
      containerPool,
      config.sandbox,
      logger,
    );
  }

  // Fallback: direct CLI execution (current behavior)
  return new CopilotAdapter({
    useStdio: config.copilot.useStdio,
    defaultModel: config.copilot.defaultModel,
    defaultTimeoutMs: config.copilot.defaultTimeoutMs,
    defaultCwd: config.workspacesDir,
    autoRestart: config.copilot.autoRestart,
    cliPath: config.copilot.cliPath ?? undefined,
  });
}
```

---

## 11. Session Allocation Changes

### 11.1 Current Flow (SessionAllocator)

```
allocateSession(workflowRunId, stageRunId, mode, config)
  → createSession()
    → sessionRepo.create(session)
    → copilot.createConversation({ conversationId, ... })
    → sessionRepo.updateStatus(sessionId, 'running')
```

### 11.2 New Flow (With Containers)

The `SessionAllocator` doesn't change its public API — only the `ICopilotPort` implementation changes. Because `ContainerizedCopilotAdapter` implements the same interface, the allocator works without modification.

However, we need one enhancement: **passing the repo URL to the container** so it can clone inside the container instead of on the host.

```typescript
// SessionAllocator change: pass workspacePath context to conversation config
private async createSession(
  workflowRunId: string,
  stageRunId: string,
  config?: Partial<CreateConversationParams>,
): Promise<Session> {
  // ... existing code ...

  await this.copilot.createConversation({
    conversationId,
    model: config?.model,
    // NEW: pass working directory (container uses /workspace internally)
    workingDirectory: config?.workingDirectory ?? '/workspace',
    // ... rest of params ...
  });
}
```

### 11.3 GitManager Changes

Currently, `GitManager` clones repos to the host filesystem. With sandboxing:

```typescript
// Option A: GitManager clones inside container via bridge
async clone(repoUrl: string, branch?: string): Promise<string> {
  if (this.sandboxMode) {
    // Clone happens automatically when container starts (if REPO_URL env is set)
    // Or explicitly via bridge:
    await this.bridge.call('cloneRepo', { repoUrl, branch });
    return '/workspace';  // Container-local path
  }
  
  // Original host-side clone logic
  // ...
}
```

```typescript
// Option B: Container auto-clones on startup (preferred)
// The container-entrypoint.ts checks REPO_URL env var and clones automatically.
// GitManager for sandboxed sessions becomes a pass-through.
```

**Decision: Option B** — The container auto-clones on startup. This keeps the clone operation inside the security boundary from the start.

---

## 12. Security Model

### 12.1 Defense in Depth

```
Layer 1: Container Isolation (filesystem, process, network)
    Layer 2: Non-root user (agent, UID 1000)
        Layer 3: Dropped capabilities (no CAP_SYS_ADMIN, etc.)
            Layer 4: Read-only critical paths (/usr, /etc)
                Layer 5: Resource limits (CPU, memory, PIDs)
                    Layer 6: Network egress restrictions
                        Layer 7: Session timeout (auto-destroy)
```

### 12.2 Linux Capabilities

```typescript
// Dropped ALL, then add back only what's needed:
const CAPABILITIES = {
  CapDrop: ['ALL'],
  CapAdd: [
    'CHOWN',    // git may need to change file ownership
    'SETUID',   // npm/git may need to switch user for operations
    'SETGID',   // same
    'DAC_OVERRIDE', // needed for file access in /workspace
  ],
};
```

### 12.3 Network Egress Policy

```bash
# Docker network with restricted egress (created once at server startup)
docker network create \
  --driver bridge \
  --internal=false \
  generatorai-restricted

# iptables rules on the Docker host (applied via network plugin or manually)
# Allow: GitHub API, npm registry, git operations
# Block: Everything else

# Allowed destinations:
# - api.github.com (Copilot API)
# - github.com (git clone)
# - *.githubusercontent.com (git objects)
# - registry.npmjs.org (npm install)
# - copilot-proxy.githubusercontent.com (Copilot model access)

# Blocked:
# - All other outbound connections
```

### 12.4 Seccomp Profile

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64"],
  "syscalls": [
    {
      "names": [
        "read", "write", "open", "close", "stat", "fstat", "lstat",
        "poll", "lseek", "mmap", "mprotect", "munmap", "brk",
        "access", "pipe", "dup", "dup2", "clone", "fork", "vfork",
        "execve", "exit", "wait4", "kill", "uname", "fcntl",
        "flock", "fsync", "fdatasync", "truncate", "ftruncate",
        "getdents", "getcwd", "chdir", "rename", "mkdir", "rmdir",
        "unlink", "readlink", "chmod", "chown", "umask",
        "gettimeofday", "getrlimit", "getuid", "getgid", "geteuid",
        "getegid", "setuid", "setgid", "getgroups", "setgroups",
        "socket", "connect", "sendto", "recvfrom", "bind", "listen",
        "accept", "setsockopt", "getsockopt", "getpeername",
        "getsockname", "select", "epoll_create", "epoll_ctl",
        "epoll_wait", "ioctl", "rt_sigaction", "rt_sigprocmask",
        "rt_sigreturn", "arch_prctl", "set_tid_address",
        "set_robust_list", "futex", "clock_gettime", "clock_nanosleep",
        "pread64", "pwrite64", "readv", "writev", "pipe2",
        "eventfd2", "timerfd_create", "timerfd_settime",
        "signalfd4", "accept4", "epoll_create1",
        "openat", "mkdirat", "fchownat", "unlinkat", "renameat",
        "linkat", "symlinkat", "readlinkat", "fchmodat", "faccessat",
        "newfstatat", "prlimit64", "getrandom", "memfd_create",
        "statx", "rseq", "clone3"
      ],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

### 12.5 Auto-Approve Tool Calls Inside Container

Because the container IS the security boundary, we can safely auto-approve all Copilot CLI tool calls:

```typescript
// container-entrypoint.ts — auto-approve everything
const session = await this.client.createSession({
  ...config,
  onPermissionRequest: async (_request) => {
    // Container is the sandbox — approve all operations
    return { kind: 'approved' };
  },
});
```

**Rationale**: This follows the pattern established by OpenAI Codex and Devin. The permission system is a second-layer defense that becomes unnecessary when the execution environment itself is the security boundary. Auto-approval also eliminates the need for user interaction during automated workflows.

---

## 13. Configuration Schema Changes

### 13.1 AppConfig Extension

```typescript
// packages/shared/src/config/AppConfig.ts — additions

export const AppConfigSchema = z.object({
  // ... existing fields ...

  sandbox: z
    .object({
      /** Enable sandboxed container execution */
      enabled: z.boolean().default(false),

      /** Docker image name for session containers */
      imageName: z.string().default('generatorai/session-sandbox:latest'),

      /** Container resource limits */
      limits: z
        .object({
          cpuCount: z.number().min(0.5).max(8).default(2),
          memoryBytes: z.number().default(4 * 1024 * 1024 * 1024), // 4 GB
          diskBytes: z.number().default(10 * 1024 * 1024 * 1024),  // 10 GB
          pidsLimit: z.number().default(256),
          sessionTimeoutMs: z.number().default(30 * 60 * 1000),    // 30 min
        })
        .default({}),

      /** Container pool configuration */
      pool: z
        .object({
          minSize: z.number().min(0).max(10).default(2),
          maxSize: z.number().min(1).max(50).default(20),
          idleTimeoutMs: z.number().default(5 * 60 * 1000), // 5 min
        })
        .default({}),

      /** Network restrictions */
      network: z
        .object({
          restrictEgress: z.boolean().default(true),
          allowedDomains: z
            .array(z.string())
            .default([
              'api.github.com',
              'github.com',
              '*.githubusercontent.com',
              'copilot-proxy.githubusercontent.com',
              'registry.npmjs.org',
            ]),
        })
        .default({}),

      /** GitHub token for containers (if different from host token) */
      githubToken: z.string().optional(),

      /** Bridge port range */
      bridgePortRange: z
        .object({
          start: z.number().default(19200),
          end: z.number().default(19400),
        })
        .default({}),
    })
    .optional()
    .default(undefined),
});
```

### 13.2 Environment Variable Mapping

```bash
# .env or environment variables
SANDBOX_ENABLED=true
SANDBOX_IMAGE=generatorai/session-sandbox:latest
SANDBOX_CPU_LIMIT=2
SANDBOX_MEMORY_LIMIT=4294967296
SANDBOX_POOL_MIN=2
SANDBOX_POOL_MAX=20
SANDBOX_NETWORK_RESTRICT=true
GITHUB_TOKEN=ghp_xxx  # Forwarded to containers
```

---

## 14. Container Pool (Pre-Warming)

### 14.1 Why Pre-Warming Is Essential

| Without pool | With pool |
|-------------|-----------|
| Container create: ~3-5s | Claim from pool: ~50ms |
| SDK start inside: ~2-3s | Already started: 0ms |
| CLI handshake: ~1-2s | Already connected: 0ms |
| **Total: 6-10s** | **Total: <1s** |

Users clicking "New Chat" should see <3 second response. Without pre-warming, they'd wait 6-10 seconds — unacceptable for UX.

### 14.2 ContainerPool Design

```typescript
// packages/sandbox/src/ContainerPool.ts

export class ContainerPool {
  private available: ManagedContainer[] = [];
  private claimed = new Map<string, ManagedContainer>();
  private replenishing = false;

  constructor(
    private manager: ContainerManager,
    private logger: ILogger,
    private config: PoolConfig,
  ) {}

  async initialize(): Promise<void> {
    // Pre-warm minimum pool
    await this.replenish();
  }

  async acquire(sessionId: string): Promise<ManagedContainer> {
    let container = this.available.pop();

    if (!container) {
      // Pool exhausted — create on demand
      this.logger.warn('[Pool] Pool exhausted, creating container on demand');
      container = await this.manager.createContainer({
        sessionId,
        githubToken: this.config.githubToken,
        limits: this.config.limits,
        network: this.config.network,
      });
    }

    // Claim the container for this session
    container.sessionId = sessionId;
    container.status = 'claimed';
    this.claimed.set(sessionId, container);

    // Trigger async replenish (don't await)
    this.replenishAsync();

    return container;
  }

  async release(containerId: string): Promise<void> {
    const container = this.claimed.get(containerId);
    if (!container) return;

    this.claimed.delete(containerId);

    // Containers are ephemeral — destroy after use (don't return to pool)
    // This ensures clean filesystem state for next session
    await this.manager.destroyContainer(containerId);

    // Replenish pool to maintain minimum
    this.replenishAsync();
  }

  async drain(): Promise<void> {
    // Destroy all pooled containers
    for (const container of this.available) {
      await this.manager.destroyContainer(container.id);
    }
    this.available = [];
  }

  isHealthy(): boolean {
    return this.available.length > 0 || this.claimed.size < this.config.maxPoolSize;
  }

  private async replenish(): Promise<void> {
    if (this.replenishing) return;
    this.replenishing = true;

    try {
      while (
        this.available.length < this.config.minPoolSize &&
        this.available.length + this.claimed.size < this.config.maxPoolSize
      ) {
        const container = await this.manager.createContainer({
          sessionId: `pool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          githubToken: this.config.githubToken,
          limits: this.config.limits,
          network: this.config.network,
        });
        this.available.push(container);
        this.logger.info(`[Pool] Pre-warmed container ${container.id} (pool: ${this.available.length})`);
      }
    } finally {
      this.replenishing = false;
    }
  }

  private replenishAsync(): void {
    this.replenish().catch((err) => {
      this.logger.error(`[Pool] Failed to replenish: ${err}`);
    });
  }
}
```

### 14.3 Why Ephemeral (Not Reusable) Containers

| Reusable (return to pool) | Ephemeral (destroy after use) |
|--------------------------|------------------------------|
| Must reset filesystem state | Clean slate guaranteed |
| Must kill leftover processes | Process tree destroyed |
| Risk of state leakage | Zero cross-session leakage |
| Faster (skip create) | Slightly slower (~3s overhead) |
| Complex cleanup logic | Simple lifecycle |

**Decision: Ephemeral** — Security trumps the 3-second overhead, which is hidden by pool pre-warming anyway.

---

## 15. File System & Workspace Isolation

### 15.1 Container Filesystem Layout

```
/                           ← Read-only (image layers)
├── usr/                    ← Node.js, Git, tools
├── opt/bridge/             ← Bridge entrypoint + SDK
├── home/agent/             ← Agent user home (writable, tmpfs)
│   └── .config/            ← Copilot CLI config
├── workspace/              ← Ephemeral volume (writable)
│   └── <repo-name>/       ← Cloned repository (if any)
└── tmp/                    ← tmpfs (256 MB, noexec, nosuid)
```

### 15.2 Volume Strategy

```typescript
// Container creation — volume config
HostConfig: {
  // /workspace is a Docker volume (ephemeral, destroyed with container)
  Binds: [],  // No host mounts — complete isolation
  
  // Temp filesystem for transient files
  Tmpfs: {
    '/tmp': 'rw,noexec,nosuid,size=256m',
    '/home/agent/.cache': 'rw,size=512m',
  },
}
```

### 15.3 Artifact Extraction

When a session completes and the user wants to download generated code or artifacts:

```typescript
// Host-side: extract files from container before destruction
async extractArtifacts(containerId: string, paths: string[]): Promise<Buffer> {
  const container = this.docker.getContainer(containerId);
  
  // Docker cp equivalent — stream tar archive from container
  const stream = await container.getArchive({ path: '/workspace' });
  return streamToBuffer(stream);
}
```

This is done **before** container destruction, during the session completion flow.

---

## 16. Network Isolation

### 16.1 Docker Network Creation (One-Time Setup)

```bash
# Create a restricted network (blocks arbitrary egress)
docker network create \
  --driver bridge \
  --subnet 172.30.0.0/16 \
  --opt "com.docker.network.bridge.enable_icc=false" \
  generatorai-sandbox

# iptables rules to allow only specific egress
iptables -I DOCKER-USER -s 172.30.0.0/16 -d 140.82.112.0/20 -j ACCEPT  # github.com
iptables -I DOCKER-USER -s 172.30.0.0/16 -d 185.199.108.0/22 -j ACCEPT # githubusercontent.com
iptables -I DOCKER-USER -s 172.30.0.0/16 -j DROP  # block everything else
```

### 16.2 Programmatic Network Setup

```typescript
// ContainerManager.ensureNetwork() — called during initialization
async ensureNetwork(): Promise<void> {
  const networks = await this.docker.listNetworks({
    filters: { name: ['generatorai-sandbox'] },
  });

  if (networks.length === 0) {
    await this.docker.createNetwork({
      Name: 'generatorai-sandbox',
      Driver: 'bridge',
      Internal: false,  // Needs outbound for GitHub API
      Options: {
        'com.docker.network.bridge.enable_icc': 'false', // No inter-container traffic
      },
      IPAM: {
        Config: [{ Subnet: '172.30.0.0/16' }],
      },
    });
  }
}
```

### 16.3 DNS Resolution

Containers need DNS to resolve `github.com`, `api.github.com`, etc.:

```typescript
HostConfig: {
  Dns: ['8.8.8.8', '8.8.4.4'],  // Google DNS (or corporate DNS)
  DnsSearch: [],                   // No search domains
}
```

---

## 17. Monitoring & Observability

### 17.1 Container Metrics

```typescript
// ContainerManager.getStats() — used by health check endpoint
async getContainerStats(containerId: string): Promise<ContainerStats> {
  const container = this.docker.getContainer(containerId);
  const stats = await container.stats({ stream: false });
  
  return {
    cpuPercent: calculateCpuPercent(stats),
    memoryUsageMb: stats.memory_stats.usage / (1024 * 1024),
    memoryLimitMb: stats.memory_stats.limit / (1024 * 1024),
    networkRxBytes: stats.networks?.eth0?.rx_bytes ?? 0,
    networkTxBytes: stats.networks?.eth0?.tx_bytes ?? 0,
    pidsCount: stats.pids_stats.current,
  };
}
```

### 17.2 Events from Container to Host Logging

```typescript
// Container logs are forwarded via bridge notifications
bridge.onNotification('log', (params) => {
  logger.info(`[Container-${sessionId}] ${params.level}: ${params.message}`);
});
```

### 17.3 Health Check API Extension

```typescript
// New endpoint: GET /api/health/sandbox
router.get('/health/sandbox', async (req, res) => {
  const pool = container.containerPool;
  res.json({
    enabled: true,
    poolAvailable: pool.availableCount,
    poolClaimed: pool.claimedCount,
    poolMax: pool.maxSize,
    containers: await pool.getContainerStatuses(),
  });
});
```

---

## 18. Graceful Degradation: Non-Container Fallback

### 18.1 Fallback Strategy

When Docker is unavailable (desktop dev, CI without Docker), the system must work:

```typescript
// composition-root.ts
function createCopilotPort(config: AppConfig, logger: ILogger): ICopilotPort {
  if (config.sandbox?.enabled) {
    // Check if Docker is available
    try {
      const docker = new Docker();
      await docker.ping();
      logger.info('[Container] Docker available — using sandboxed execution');
      return new ContainerizedCopilotAdapter(/* ... */);
    } catch {
      logger.warn('[Container] Docker not available — falling back to direct execution');
      // Fall through to direct mode
    }
  }

  // Direct execution (current behavior)
  return new CopilotAdapter({ /* ... */ });
}
```

### 18.2 Feature Flag Architecture

```
config.sandbox.enabled = true + Docker available → ContainerizedCopilotAdapter
config.sandbox.enabled = true + Docker missing   → CopilotAdapter + warning log
config.sandbox.enabled = false                   → CopilotAdapter (current)
```

---

## 19. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

| Task | Estimated | Details |
|------|-----------|---------|
| Create `packages/sandbox/` package | 2h | Package structure, tsconfig, build |
| Define `bridge-protocol.ts` types | 4h | Complete JSON-RPC message schema |
| Implement `container-entrypoint.ts` | 8h | BridgeServer + SDK integration inside container |
| Create Dockerfile | 4h | Multi-stage build, security hardening |
| Build & publish Docker image locally | 2h | `docker build`, smoke test |
| **Phase 1 total** | **~20h** | |

### Phase 2: Host-Side Integration (Weeks 3-4)

| Task | Estimated | Details |
|------|-----------|---------|
| Implement `ContainerManager.ts` | 8h | Full CRUD with `dockerode` |
| Implement `ContainerBridge.ts` | 8h | TCP JSON-RPC client with reconnection |
| Implement `ContainerizedCopilotAdapter.ts` | 12h | Full `ICopilotPort` implementation |
| Add `sandbox` config to `AppConfig.ts` | 2h | Schema + validation |
| Modify `composition-root.ts` | 2h | Conditional adapter selection |
| **Phase 2 total** | **~32h** | |

### Phase 3: Pool & Performance (Weeks 5-6)

| Task | Estimated | Details |
|------|-----------|---------|
| Implement `ContainerPool.ts` | 8h | Pre-warming, acquire/release, replenish |
| Implement network isolation | 4h | Docker network creation, egress rules |
| Implement artifact extraction | 4h | File download from container before destroy |
| Integrate with `GitManager` | 4h | In-container clone, workspace path mapping |
| Integrate with `SessionService` | 4h | Container lifecycle tied to session lifecycle |
| **Phase 3 total** | **~24h** | |

### Phase 4: Testing & Hardening (Weeks 7-8)

| Task | Estimated | Details |
|------|-----------|---------|
| Unit tests for all sandbox components | 12h | Mocked Docker API tests |
| Integration tests (real Docker) | 8h | End-to-end: create container → run session → destroy |
| Security hardening review | 4h | Seccomp profile, capability audit |
| Performance benchmarking | 4h | Startup time, memory overhead, concurrent sessions |
| Fallback mode testing | 4h | Verify clean fallback when Docker unavailable |
| Documentation | 4h | Ops runbook, configuration guide |
| **Phase 4 total** | **~36h** | |

### Total Estimated Effort: **~112 hours (6-8 weeks with testing)**

---

## 20. Testing Strategy

### 20.1 Unit Tests (No Docker Required)

```typescript
// ContainerManager.test.ts — mock dockerode
describe('ContainerManager', () => {
  it('creates container with correct security config', async () => {
    const mockDocker = createMockDocker();
    const manager = new ContainerManager(mockLogger, config);
    
    await manager.createContainer({
      sessionId: 'test-123',
      githubToken: 'ghp_test',
      limits: defaultLimits,
      network: { restrictEgress: true, allowedDomains: [] },
    });

    expect(mockDocker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
        }),
      }),
    );
  });
});
```

### 20.2 Integration Tests (Docker Required)

```typescript
// integration/sandbox.test.ts
describe('Sandboxed Session E2E', () => {
  it('creates container, runs prompt, receives events, destroys', async () => {
    const adapter = new ContainerizedCopilotAdapter(/* real config */);
    await adapter.initialize();

    const convId = 'test-conv-1';
    await adapter.createConversation({
      conversationId: convId,
      model: 'gpt-4.1',
      streaming: true,
    });

    const events: AgentEvent[] = [];
    adapter.onConversationEvent(convId, (e) => events.push(e));

    await adapter.sendPromptAndWait(convId, 'What is 2 + 2?');

    expect(events.some(e => e.kind === 'copilot.message_complete')).toBe(true);

    await adapter.destroyConversation(convId);
    await adapter.shutdown();
  }, 60_000);
});
```

### 20.3 Security Tests

```typescript
describe('Container Security', () => {
  it('cannot access host filesystem', async () => {
    // Run command inside container trying to read /etc/passwd on host
    // Should fail because container has its own /etc/passwd
  });

  it('cannot make outbound connections to non-allowed domains', async () => {
    // Run curl to example.com inside container — should timeout/reject
  });

  it('respects memory limits', async () => {
    // Run memory-intensive process — should be OOM-killed
  });

  it('respects PID limits', async () => {
    // Fork bomb — should hit PID limit
  });
});
```

---

## 21. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Docker not available on some platforms | Medium | High | Fallback mode (Phase 1 design) |
| Container startup time > 5s | Low | Medium | Pre-warmed pool (Phase 3) |
| Bridge TCP connection drops | Medium | Medium | Auto-reconnect logic in `ContainerBridge` |
| Image size too large for first pull | Low | Low | Multi-stage build; pre-pull during install |
| GitHub token leaks from container env | Low | High | Short-lived tokens when available; never log env vars |
| Container escapes via kernel exploit | Very Low | Critical | gVisor runtime for high-security deployments |
| SQLite contention with many containers | Low | Medium | Containers don't access SQLite; host does all DB operations |
| Copilot SDK API changes break bridge | Medium | Medium | Pin SDK version in Dockerfile; version negotiation in bridge handshake |
| Resource exhaustion from container pool | Low | High | Max pool size limit; monitoring alerts |
| Windows Docker Desktop performance | Medium | Medium | Optional: use WSL2 backend; document requirements |

---

## Appendix A: Decision Log

| Decision | Options Considered | Chosen | Rationale |
|----------|-------------------|--------|-----------|
| Isolation technology | Docker, Firecracker, gVisor, nsjail | Docker (runc) | Universal availability; works on dev machines and servers |
| SDK placement | Host-only, CLI-only in container, SDK+CLI in container | SDK+CLI in container | Complete blast-radius isolation; default SDK code path |
| Communication protocol | HTTP REST, gRPC, WebSocket, JSON-RPC/TCP | JSON-RPC over TCP | Minimal overhead; bidirectional; native notification support |
| Container reuse | Reusable pool, ephemeral | Ephemeral | Security (clean state guarantee) over performance |
| Repo cloning | Clone on host + mount, clone in container | Clone in container | No host filesystem exposure |
| Auth forwarding | Mount token file, env var, secret manager | Env var injection | Simple; sufficient for single-tenant |
| Network policy | No restriction, full restriction, allowlist | Domain allowlist | Security without breaking GitHub API access |
| Fallback mode | Fail hard, graceful fallback | Graceful fallback | Developer experience; CI compatibility |
| Package placement | In `core`, in `copilot-bridge`, new package | New `packages/sandbox/` | Separation of concerns; optional dependency |

## Appendix B: Files Modified Summary

### Modified Files

| File | Change |
|------|--------|
| `packages/shared/src/config/AppConfig.ts` | Add `sandbox` configuration section |
| `apps/server/src/composition-root.ts` | Conditional `ICopilotPort` selection |
| `packages/core/src/infrastructure/GitManager.ts` | Container-aware clone (return `/workspace`) |
| `packages/core/src/services/SessionService.ts` | Pass `repoUrl` to conversation params for container clone |
| `pnpm-workspace.yaml` | Add `packages/sandbox` |
| `turbo.json` | Add `@generatorai/sandbox` build target |

### New Files

| File | Purpose |
|------|---------|
| `packages/sandbox/package.json` | Package manifest |
| `packages/sandbox/tsconfig.json` | TypeScript config |
| `packages/sandbox/Dockerfile` | Container image |
| `packages/sandbox/src/index.ts` | Package exports |
| `packages/sandbox/src/ContainerManager.ts` | Docker container CRUD |
| `packages/sandbox/src/ContainerPool.ts` | Pre-warmed container pool |
| `packages/sandbox/src/ContainerBridge.ts` | TCP JSON-RPC bridge client |
| `packages/sandbox/src/ContainerizedCopilotAdapter.ts` | `ICopilotPort` implementation |
| `packages/sandbox/src/bridge-protocol.ts` | Shared protocol types |
| `packages/sandbox/src/container-entrypoint.ts` | Container-side bridge server |
| `packages/sandbox/src/health.ts` | Health check endpoint |
| `packages/sandbox/src/types.ts` | Shared types |

---

*This document represents the complete architectural design for sandboxed session execution in GeneratorAI. Each decision is backed by industry research, threat analysis, and alignment with the existing codebase's Port/Adapter architecture.*
