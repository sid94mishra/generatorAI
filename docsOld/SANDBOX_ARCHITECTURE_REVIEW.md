# GeneratorAI — Sandbox Architecture: Critical Review & Final Architecture

> **Author**: Architecture Review  
> **Date**: March 5, 2026  
> **Status**: Critical Review + Revised Architecture Proposal  
> **Inputs**: SANDBOX_IMPLEMENTATION_PLAN.md, Industry Research Report, Codebase Analysis

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Critical Review of Current Plan](#2-critical-review-of-current-plan)
3. [SDK-in-Container vs CLI-Only-in-Container: Definitive Analysis](#3-sdk-in-container-vs-cli-only-in-container-definitive-analysis)
4. [Workflow Multi-Session Sandbox Architecture](#4-workflow-multi-session-sandbox-architecture)
5. [Chat Session Sandbox Architecture](#5-chat-session-sandbox-architecture)
6. [Artifact & Code Transfer Architecture](#6-artifact--code-transfer-architecture)
7. [Final Revised Architecture](#7-final-revised-architecture)
8. [Revised Implementation Plan](#8-revised-implementation-plan)
9. [Decision Register](#9-decision-register)

---

## 1. Executive Summary

### What the Current Plan Gets Right

The SANDBOX_IMPLEMENTATION_PLAN.md is **architecturally sound** in its core decisions:

- **SDK + CLI inside container** (Approach B) — correct, validated by every major coding agent (Codex, Claude Code, Devin, Copilot Coding Agent)
- **Ephemeral containers** — correct security posture
- **JSON-RPC over TCP bridge** — appropriate protocol choice
- **Pre-warmed container pool** — essential for UX
- **Domain-allowlisted network egress** — correct trade-off for Copilot CLI's needs
- **Port/Adapter pattern** (`ContainerizedCopilotAdapter` implementing `ICopilotPort`) — clean composition

### What the Current Plan Gets Wrong or Misses

| Gap | Severity | Description |
|-----|----------|-------------|
| **Multi-stage artifact passing** | **Critical** | No mechanism for files to flow between stages in `per-stage` mode. Workflow runs would fail. |
| **Sandbox scope ambiguity** | **High** | Plan says "1 container per session" but doesn't clarify the `single` mode lifecycle where all stages share one session → one container for the entire workflow run. |
| **Workflow sandbox = container per session, NOT per workflow** | **High** | The plan conflates session and workflow. For `per-stage` mode, one workflow needs N containers (one per stage). For `single` mode, one workflow needs 1 container. This is not clearly stated. |
| **Chat sandbox isolation** | **Medium** | Plan doesn't address whether 5 concurrent chats share a container or get separate ones. |
| **Bridge reconnection** | **Medium** | No reconnection strategy for TCP drops. |
| **Graceful shutdown ordering** | **Medium** | No defined sequence for server shutdown with active containers. |
| **Health check mismatch** | **Low** | Dockerfile uses Node.js health check script but bridge is TCP-only (no HTTP). |
| **Container resource monitoring** | **Low** | Mentioned but not integrated into the existing observability stack. |

### Key Requirements That Were NOT Analyzed

The plan was written assuming a 1:1 relationship between sandbox and session. The user's actual requirements are more nuanced:

1. **For each chat** → one sandbox (confirmed: 1 container per chat)
2. **For each workflow end-to-end** → one sandbox with multiple copilot sessions running inside it for the entire flow
3. **Workflow sessions have dependencies** on each other (stage B reads files stage A wrote)
4. **5 concurrent chats** — can they share a sandbox?
5. **Artifact/code transfer** — how does generated code reach the user?

---

## 2. Critical Review of Current Plan

### 2.1 Correct Decisions (Keep As-Is)

| Decision | Validation |
|----------|------------|
| SDK + CLI inside container | Industry-validated; killer argument: SDK tool handlers execute on host otherwise |
| `ICopilotPort` adapter pattern | Clean DI; `ContainerizedCopilotAdapter` plugs in without touching `SessionAllocator` or `StageExecutionService` |
| `dockerode` over Docker CLI | Mature, type-safe, no shell injection risk |
| Non-root `agent` user inside container | Principle of least privilege |
| Auto-approve tool calls inside container | Container IS the security boundary — matches Codex/Claude Code pattern |
| Graceful fallback to direct execution | Essential for development and CI |

### 2.2 Incorrect or Incomplete Decisions

#### Issue 1: "1 Container Per Session" Is Wrong for Workflows

**Current plan says**: "1 Docker container per session"

**Problem**: This is accurate for chats but incomplete for workflows. A workflow run in `per-stage` mode creates N sessions (one per stage). "1 container per session" means N containers per workflow, which is correct for isolation — but the plan doesn't address how Stage C's container gets files from Stage A's container.

More critically, for `single` mode, ALL stages share ONE session. The plan correctly implies one container, but doesn't explicitly state that this container must survive the entire workflow run lifecycle — from first stage start to last stage completion.

**Correction**: The isolation unit should be defined as:

```
Container lifecycle = Session lifecycle
  ├── Chat: 1 chat → 1 session → 1 container (clear)
  ├── Workflow (single mode): 1 workflow → 1 session → 1 container (entire run)
  ├── Workflow (per-stage): 1 workflow → N sessions → N containers (one per stage)
  └── Workflow (auto): 1 workflow → M sessions → M containers (session grouping)
```

#### Issue 2: No Artifact Passing Between Stages

**Current plan**: Bridge protocol has `cloneRepo` and `getWorkspacePath` but NO methods for:
- Extracting files from a completed stage's container
- Injecting files from upstream stages into a new container

**Impact**: `per-stage` mode is fundamentally broken. Stage C cannot access files produced by Stage A.

**Required additions to bridge protocol**:
```typescript
| { method: 'injectFiles'; params: { files: { path: string; content: Buffer | string }[] } }
| { method: 'extractWorkspace'; params: { paths?: string[] } }  // returns workspace files
| { method: 'listWorkspaceFiles'; params: { path?: string; recursive?: boolean } }
```

**Required new service**: `WorkspaceTransferService` that:
1. Extracts workspace from container A when stage A completes
2. Stores workspace snapshot as a workflow run artifact
3. Injects workspace into container C when stage C starts (before first prompt)

#### Issue 3: Single Container for Workflow With Multiple Sessions

**User requirement**: "For each workflow end-to-end execution we need a sandbox. The workflow can have multiple copilot sessions running in sandbox for the entire flow."

**Current plan**: Creates a new container per `createConversation()` call.

**Problem**: If a workflow in `per-stage` mode needs Stage A's output for Stage C, running them in separate containers requires explicit artifact passing. But the user's requirement suggests wanting **one container for the entire workflow**, with multiple CLI sessions inside it.

**Analysis of one-container-per-workflow with multiple sessions**:

| Factor | One Container + Multiple Sessions | Multiple Containers |
|--------|-----------------------------------|---------------------|
| File sharing between stages | ✅ Natural — shared `/workspace` | ❌ Requires explicit extraction/injection |
| Process isolation between stages | ❌ Stages share process namespace | ✅ Complete isolation |
| Resource management | ❌ All stages share one resource limit | ✅ Independent limits per stage |
| Failure blast radius | ❌ One crash affects all stages | ✅ Isolated failures |
| Complexity | ✅ Simple — one bridge connection | ❌ N bridge connections, artifact transfer logic |
| Startup overhead | ✅ One container start | ❌ N container starts (mitigated by pool) |
| Concurrent stage execution | ⚠️ Works if CopilotClient supports multiple sessions | ✅ Natural parallelism |
| Security (cross-stage) | ❌ Stage A can interfere with Stage B | ✅ Isolated |

**The Copilot SDK supports multiple `CopilotSession` objects per `CopilotClient` process.** This means one container with one bridge server CAN host multiple concurrent sessions. The bridge would manage multiple session IDs, each mapping to a `CopilotSession` instance within the single `CopilotClient`.

**Recommendation**: **One container per workflow run** is the better default for most workflows, with the option for `per-stage` isolation when explicitly requested. This is because:

1. File dependencies between stages are the **common case** in code-generation workflows (e.g., "generate code" → "write tests" → "review code" — each stage needs the previous stage's files)
2. The performance overhead of N containers + artifact transfer is non-trivial
3. The CopilotClient natively supports multiple sessions
4. Workflows are already **trusted units of work** (the user defined the stages and prompts)

#### Issue 4: Chat Session Sharing Analysis

**User question**: "All chat sessions can run in a single sandbox or not? We're planning to cap 5 chat sessions at a time."

**Analysis**:

| Factor | 5 Chats in 1 Container | 1 Container Per Chat |
|--------|------------------------|---------------------|
| Isolation | ❌ Chats share filesystem — Chat B can read Chat A's files | ✅ Complete isolation |
| Resource fairness | ❌ One heavy chat starves others | ✅ Independent limits |
| Failure isolation | ❌ Container crash kills all 5 chats | ✅ One crash = one chat lost |
| Memory overhead | ✅ ~300 MB (1 Node.js + 1 SDK + 1 CLI + 5 sessions) | ❌ ~1.5 GB (5 × 300 MB) |
| UX independence | ❌ Archiving one chat doesn't free container resources | ✅ Archive = container destroyed |
| Security | ❌ Prompt injection in Chat A could affect Chat B's workspace | ✅ No cross-contamination |
| Complexity | ✅ One bridge, multiple sessions | ❌ Five bridges, five containers |

**Recommendation**: **One container per chat** is the correct default. The 1.5 GB memory overhead is acceptable (most servers have 16+ GB). The security and isolation benefits are critical for a system where different chats may work on different repos or have different trust levels.

**Exception**: On resource-constrained deployments (e.g., developer laptop with 8 GB RAM), offer a `sandbox.shareContainerForChats: true` config option that multiplexes chats into a single container. This trades security for resource efficiency.

### 2.3 Architecture Misalignment: SessionAllocator vs Container Lifecycle

The current `SessionAllocator` creates sessions via `copilot.createConversation()`. In the sandbox world, `createConversation()` first acquires a container, then creates a session inside it.

**Problem**: The `SessionAllocator` doesn't know about containers. For workflow `single` mode, it reuses the existing session (and thus, implicitly, the existing container). This works. But for `per-stage` mode, each `createConversation()` call creates a NEW container — even when we want a shared container for the workflow.

**If we adopt "one container per workflow" for per-stage mode**, we need a new abstraction:

```
WorkflowSandbox (manages ONE container for the workflow run)
├── Session 1 (Stage A) → CopilotSession inside the container
├── Session 2 (Stage B) → CopilotSession inside the container
└── Session 3 (Stage C) → CopilotSession inside the container
```

The `ContainerizedCopilotAdapter` would need to understand that multiple `createConversation()` calls for the same workflow should share the same container.

**Implementation options**:

**Option A**: Pass `workflowRunId` in `CreateConversationParams` so the adapter can group sessions by workflow:
```typescript
interface CreateConversationParams {
  // ... existing fields ...
  /** When set, conversations with the same sandboxGroupId share a container */
  sandboxGroupId?: string;  // workflowRunId for workflows, chatId for chats
}
```

**Option B**: Introduce a `SandboxManager` above `ContainerizedCopilotAdapter` that manages the workflow→container mapping:
```typescript
class SandboxManager {
  // Manages container lifecycle at the workflow/chat level
  async acquireSandbox(ownerId: string, ownerType: 'workflow' | 'chat'): Container;
  async releaseSandbox(ownerId: string): void;
}
```

**Recommendation**: **Option A** — minimal API change. The `sandboxGroupId` field lets the adapter group conversations into shared containers without requiring a new service. Chats set `sandboxGroupId = chatId` (one container per chat). Workflows set `sandboxGroupId = workflowRunId` (one container per workflow).

---

## 3. SDK-in-Container vs CLI-Only-in-Container: Definitive Analysis

### 3.1 The Architectural Question

**Approach A (CLI only in container, SDK on host)**:
```
Host: CopilotClient (SDK) → TCP (cliUrl) → Container: copilot CLI
```

**Approach B (SDK + CLI in container, bridge on host)**:
```
Host: BridgeClient → TCP JSON-RPC → Container: BridgeServer + CopilotClient (SDK) + CLI
```

### 3.2 The Killer Argument: Tool Handler Execution Location

The Copilot SDK's `CopilotClient.createSession()` accepts configuration including:
- `onPermissionRequest` — a callback function that executes **in the SDK process**
- Custom tools with `handler` functions — execute **in the SDK process**
- MCP server connections — managed **by the SDK process**

In Approach A, the SDK runs on the host. Therefore:
- `onPermissionRequest` executes on the host
- Custom tool handlers execute on the host (including file writes, shell commands)
- MCP servers are accessed from the host's network

**This completely defeats sandboxing.** The CLI may run inside the container, but when it invokes a tool, the tool's handler runs on the host — writing files to the host filesystem, executing shell commands on the host, accessing the host's network.

### 3.3 Can We Make Approach A Work?

Theoretically, we could:
1. NOT register any tool handlers in the SDK (let the CLI handle all tools internally)
2. Set `onPermissionRequest` to always auto-approve
3. Not use custom tools or MCP servers

But this assumes the CLI handles ALL tool execution internally without delegating to the SDK. Looking at the current `CopilotAdapter`:

```typescript
// CopilotAdapter.ts, line 170
sessionConfig.onPermissionRequest = async (sdkRequest, _invocation) => {
  // ... this runs on the host ...
  const result = await params.onPermissionRequest!({ ... });
  return { kind: result.granted ? 'approved' : 'denied-interactively-by-user' };
};
```

```typescript
// CopilotAdapter.ts, line 125
const sdkTools = buildSdkTools(params.tools ?? []);
// These tools have handlers that execute in the SDK process
```

Even with auto-approve and no custom tools, the SDK process itself calls `child_process.spawn` to start the CLI. The CLI's own subprocesses (git, shell commands) would be children of the SDK process — on the host, not in the container.

**Conclusion**: Approach A (CLI-only in container) is **architecturally unsound** for the Copilot SDK. The SDK is not a passive RPC client — it actively manages process trees, tool handlers, and permission callbacks. **Approach B (SDK + CLI inside container) is the only correct choice.**

### 3.4 What About the `cliUrl` Mode?

The SDK supports a `cliUrl` option (instead of `useStdio: true`) that connects to a remote CLI process via TCP. Could we use this?

```typescript
const client = new CopilotClient({
  useStdio: false,
  cliUrl: 'tcp://container-host:9999',
});
```

**Problems**:
1. `cliUrl` mode is designed for debugging, not production use — it's less tested
2. Even with `cliUrl`, the SDK still manages tool handlers locally
3. The CLI process in `cliUrl` mode sends tool invocations back to the SDK for execution — they still run on the host
4. `useStdio: true` is the default and most battle-tested code path

### 3.5 Performance Comparison

| Metric | Approach A (CLI in container) | Approach B (SDK+CLI in container) |
|--------|-------------------------------|-----------------------------------|
| Memory per container | ~80-120 MB | ~200-300 MB |
| Startup time | ~1-2s (CLI only) | ~2-3s (Node.js + SDK + CLI) |
| Network hops per request | 2 (host SDK ↔ CLI, host SDK ↔ host services) | 1 (host bridge ↔ container bridge) |
| Failure domain | Host SDK crash = ALL sessions lost | Container crash = 1 session/workflow lost |
| Total memory (5 sessions) | 5 × 100 MB + 1 × 200 MB (host SDK) = 700 MB | 5 × 250 MB = 1,250 MB |

The memory difference (~550 MB for 5 sessions) is real but acceptable. The failure domain advantage of Approach B is more important: a crash in the host SDK would destroy all active sessions, whereas container crashes are isolated to single sessions.

### 3.6 Verdict

**Approach B (SDK + CLI inside container) is unambiguously correct.** The current plan makes the right choice.

---

## 4. Workflow Multi-Session Sandbox Architecture

### 4.1 The User's Requirement

> "For each workflow end-to-end execution we need a sandbox. The workflow can have multiple copilot sessions running in sandbox for the entire flow."

This means: **one container per workflow run**, with multiple `CopilotSession` instances inside it.

### 4.2 Architecture: One Container Per Workflow Run

```
WorkflowRun (id: run-001)
┌─────────────────────────────────────────────────────────────────┐
│  Container: generatorai-workflow-run-001                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  BridgeServer (container-entrypoint.ts)                    │  │
│  │  ┌──────────────────────────────────────────────────────┐ │  │
│  │  │  CopilotClient (one per container)                    │ │  │
│  │  │  ├── CopilotSession A (stage: "code-gen")             │ │  │
│  │  │  ├── CopilotSession B (stage: "test-gen") (parallel)  │ │  │
│  │  │  └── CopilotSession C (stage: "review") (after A, B)  │ │  │
│  │  └──────────────────────────────────────────────────────┘ │  │
│  │                                                            │  │
│  │  /workspace/                                               │  │
│  │  ├── src/main.ts          ← written by Session A           │  │
│  │  ├── src/main.test.ts     ← written by Session B           │  │
│  │  └── REVIEW.md            ← written by Session C           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 How This Maps to Existing Code

The `SessionAllocator` currently manages session allocation per workflow mode:

| Mode | Current Behavior | Sandbox Behavior |
|------|-----------------|------------------|
| `single` | All stages share 1 session | 1 container, 1 CopilotSession |
| `per-stage` | Each stage gets its own session | 1 container, N CopilotSessions |
| `auto` | Shared when sequential, separate when parallel | 1 container, M CopilotSessions |

**Key insight**: In ALL workflow modes, stages share `/workspace`. This means they can naturally read each other's files without explicit artifact passing. Stage C can read files written by Stage A because they're in the same container filesystem.

### 4.4 Session Dependencies Within a Shared Container

**Question**: "Workflow sessions need to have dependency on each other."

**Answer**: File-level dependencies are handled naturally by the shared filesystem. But there's a subtlety — each `CopilotSession` has its own **conversation history**. Stage C's session doesn't know what Stage A's session discussed or produced unless:

1. **Stage C's system prompt tells it**: "Previous stages have written files to /workspace. Review the existing files before proceeding."
2. **File listing is injected**: Before Stage C's first prompt, the host queries the bridge for the workspace file list and includes it in the prompt context.

**Implementation**: Add to `StageExecutionService.executeStage()`:

```typescript
// Before sending the first prompt to Stage C, if Stage C has upstream dependencies:
if (hasUpstreamDependencies(stageRun, dag)) {
  const fileList = await bridge.call('listWorkspaceFiles', { path: '/workspace' });
  // Prepend to the first prompt:
  const contextPrefix = `Files in workspace from previous stages:\n${fileList.join('\n')}\n\n`;
  prompt.text = contextPrefix + prompt.text;
}
```

### 4.5 Parallel Stage Execution Within One Container

The `DAGScheduler` can schedule Stages A and B to run in parallel. With one container per workflow, both sessions run inside the same `CopilotClient` — the SDK supports concurrent sessions. But there are risks:

| Risk | Mitigation |
|------|------------|
| Two sessions writing to the same file simultaneously | Each stage should work in a subdirectory: `/workspace/stage-a/`, `/workspace/stage-b/` |
| Resource contention (both sessions using all CPU) | Container has fixed resource limits; CLI sessions are I/O-bound (waiting for model responses) |
| One session's crash takes down the CopilotClient | SDK should handle session-level errors without crashing the client |

**Recommendation**: For parallel stages in a shared container, configure each stage's `workingDirectory` to a subdirectory:
```typescript
workingDirectory: `/workspace/stages/${stageDef.name}`
```

This prevents file conflicts while still allowing cross-stage file reads.

### 4.6 Container Lifecycle for Workflows

```
workflow.startRun()
  │
  ▼
ContainerizedCopilotAdapter.acquireSandbox(workflowRunId, 'workflow')
  → Pool.acquire() → Container created/claimed
  → Bridge connected
  → Container ID stored for workflowRunId
  │
  ▼
Stage A: createConversation({sandboxGroupId: workflowRunId})
  → Adapter finds existing container for workflowRunId
  → bridge.call('createSession', {sessionId: stage-a-session})
  → Session A running inside existing container
  │
  ▼
Stage A completes → Session A destroyed (container stays alive)
  │
  ▼
Stage C: createConversation({sandboxGroupId: workflowRunId})
  → Same container reused
  → bridge.call('createSession', {sessionId: stage-c-session})
  → Stage C can access files Stage A wrote in /workspace
  │
  ▼
All stages complete → workflow.completeRun()
  │
  ▼
ContainerizedCopilotAdapter.releaseSandbox(workflowRunId)
  → Extract artifacts from container
  → Destroy container
```

---

## 5. Chat Session Sandbox Architecture

### 5.1 One Container Per Chat (Recommended Default)

```
Chat 1 → Session 1 → Container 1 (/workspace/repo-clone-1)
Chat 2 → Session 2 → Container 2 (/workspace/repo-clone-2)
Chat 3 → Session 3 → Container 3 (/workspace/repo-clone-3)
Chat 4 → Session 4 → Container 4 (/workspace/repo-clone-4)
Chat 5 → Session 5 → Container 5 (/workspace/repo-clone-5)
```

### 5.2 Why Not Share a Container for All 5 Chats?

**Security**: Chats may work on different repos or be triggered by different users. A compromised Chat A (via prompt injection) could read files from Chat B's workspace if they share a container.

**Stability**: If one chat's CLI process crashes or runs a fork bomb, it takes down the shared container — killing all 5 chats.

**Lifecycle mismatch**: Chats are created and archived independently. A shared container must stay alive until the LAST chat is archived — even if 4 of 5 chats are done. This wastes resources.

**Independence expectation**: Users expect chats to be independent. "Archive Chat 3" should free Chat 3's resources immediately, not depend on Chats 1-5's lifecycle.

### 5.3 Resource Budget for 5 Concurrent Chat Containers

| Component | Per Container | 5 Containers | Notes |
|-----------|--------------|-------------|-------|
| Node.js runtime | ~50 MB | 250 MB | v22 baseline |
| Copilot SDK | ~30 MB | 150 MB | In-memory session state |
| Copilot CLI process | ~80-120 MB | 400-600 MB | Model inference is server-side, not local |
| Repo clone | ~50-200 MB | 250 MB - 1 GB | Depends on repo size; shallow clones help |
| Overhead (Docker) | ~10 MB | 50 MB | Namespace/cgroup metadata |
| **Total** | **~220-410 MB** | **~1.1-2.0 GB** | Acceptable for 16+ GB hosts |

### 5.4 Resource-Constrained Mode (Optional)

For deployments with limited RAM (8 GB desktop), offer:

```typescript
// AppConfig extension
sandbox: {
  enabled: true,
  chatIsolation: 'per-chat' | 'shared',  // default: 'per-chat'
}
```

When `chatIsolation: 'shared'`, multiplex up to 5 chat sessions into one container. The trade-off (security vs resources) is explicitly acknowledged by the user.

### 5.5 Chat Container Lifecycle

```
User creates Chat → POST /api/v2/chats
  │
  ▼
ChatManagementService.createChat()
  → copilot.createConversation({sandboxGroupId: chatId})
  → ContainerizedCopilotAdapter:
    → Pool.acquire() → Container created/claimed
    → Bridge connected → Session created inside container
  │
  ▼
User sends messages (Chat is 'active')
  → copilot.sendPrompt() / sendPromptAndWait()
  → Bridge forwards to container session
  │
  ▼
User archives Chat → POST /api/v2/chats/:id/archive
  │
  ▼
ChatManagementService.archiveChat()
  → copilot.destroyConversation()
  → ContainerizedCopilotAdapter:
    → Extract artifacts (if configured)
    → bridge.call('shutdown')
    → Container destroyed
    → Pool replenished
```

---

## 6. Artifact & Code Transfer Architecture

### 6.1 The Problem

Generated code exists inside an ephemeral container. When the container is destroyed, the code is lost unless explicitly extracted.

### 6.2 Three-Layer Extraction Strategy

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: Real-Time Event Capture (DURING execution)         │
│  ├── Bridge intercepts tool_call events (type: 'write')      │
│  ├── File path + content captured as they're written          │
│  └── Stored in host memory / streamed to UI via SSE          │
│                                                               │
│  Layer 2: Workspace Extraction (ON completion)                │
│  ├── When session/workflow completes (before destroy)         │
│  ├── bridge.call('extractWorkspace') → tar archive            │
│  ├── Store as ArtifactBundle in DB/filesystem                 │
│  └── Available for download via API                           │
│                                                               │
│  Layer 3: Git-Based Push (OPTIONAL, for git workflows)        │
│  ├── Agent commits + pushes to a branch inside container      │
│  ├── Commit SHA recorded as artifact metadata                 │
│  └── PR created automatically (if configured)                 │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 Workflow: Multi-Stage Artifact Flow

For workflows where stages depend on each other's output:

**In the one-container-per-workflow model** (recommended):
```
Stage A writes to /workspace/src/main.ts
Stage B reads /workspace/src/main.ts  ← natural, same filesystem
Stage B writes to /workspace/src/main.test.ts
Stage C reads all of /workspace/  ← natural, same filesystem

On workflow completion:
  Host extracts /workspace/ from container → stores as WorkflowRun artifact
  Container destroyed
  User downloads artifact bundle via API
```

No explicit artifact passing is needed between stages because they share a filesystem.

**In the one-container-per-stage model** (alternative, if explicitly configured):
```
Stage A completes:
  Host calls bridge.extractWorkspace() → tar archive
  Host stores archive as artifacts/run-001/stage-a/

Stage B starts in new container:
  Host calls bridge.injectFiles([...artifacts from stage-a...])
  Stage B prompt includes: "Files from 'code-gen' stage are in /workspace/"
  Stage B executes normally

Stage C starts in new container:
  Host calls bridge.injectFiles([...artifacts from stage-a and stage-b...])
  Stage C prompt includes: "Files from previous stages are in /workspace/"
```

### 6.4 User-Facing Artifact Download

```typescript
// New API endpoint
GET /api/v2/workflow-runs/:runId/artifacts
  → Returns list of extracted files with metadata

GET /api/v2/workflow-runs/:runId/artifacts/download
  → Returns zip/tar.gz of all generated files

GET /api/v2/chats/:chatId/artifacts
  → Returns files generated during the chat session

GET /api/v2/chats/:chatId/artifacts/download
  → Returns zip archive
```

### 6.5 Bridge Protocol Extensions for Artifact Transfer

```typescript
// Add to bridge-protocol.ts

/** Host → Container: inject files into workspace */
| { method: 'injectFiles'; params: {
    files: { path: string; content: string; encoding?: 'utf-8' | 'base64' }[];
    targetDir?: string;  // default: /workspace
  }}

/** Host → Container: extract workspace files */
| { method: 'extractWorkspace'; params: {
    paths?: string[];     // specific paths, or entire /workspace if omitted
    format: 'json' | 'tar';  // json = inline content, tar = binary stream
    changedOnly?: boolean; // only files modified since container start
  }}

/** Host → Container: list workspace files */
| { method: 'listWorkspaceFiles'; params: {
    path?: string;        // default: /workspace
    recursive?: boolean;  // default: true
    includeContent?: boolean; // default: false (metadata only)
  }}
```

---

## 7. Final Revised Architecture

### 7.1 Target Architecture Diagram

```
Host Machine
┌────────────────────────────────────────────────────────────────────────────┐
│  Express Server (apps/server)                                              │
│  ├── ChatManagementService    ← manages chat lifecycle                     │
│  ├── WorkflowRunService       ← orchestrates DAG execution                 │
│  ├── StageExecutionService    ← executes individual stages                 │
│  ├── SessionAllocator         ← allocates sessions to stages/chats         │
│  ├── EventBus → SSE streams   ← pushes events to web UI                   │
│  │                                                                         │
│  ├── ContainerizedCopilotAdapter (implements ICopilotPort)                 │
│  │   ├── sandboxGroupId → Container mapping                               │
│  │   │   (workflows: workflowRunId → container)                           │
│  │   │   (chats: chatId → container)                                      │
│  │   ├── ContainerManager (Docker CRUD via dockerode)                     │
│  │   ├── ContainerPool (pre-warmed, min 2, max configurable)              │
│  │   ├── ContainerBridge (TCP JSON-RPC, per-container)                    │
│  │   └── WorkspaceTransferService (extract/inject artifacts)              │
│  │       │                                                                 │
│  │       │  TCP :9222+ (JSON-RPC over TCP, one port per container)        │
│  │       ▼                                                                 │
│  └── SQLite DB (sessions, events, messages, artifacts)                    │
│                                                                            │
│  Docker Daemon                                                             │
│  ├── Container: generatorai-workflow-run-001                               │
│  │   ├── BridgeServer (container-entrypoint.ts)                           │
│  │   ├── CopilotClient (1 per container)                                  │
│  │   │   ├── CopilotSession: stage-a (active)                            │
│  │   │   ├── CopilotSession: stage-b (active, parallel)                  │
│  │   │   └── CopilotSession: stage-c (pending, after A+B)               │
│  │   └── /workspace/ (shared across all sessions in this workflow)        │
│  │                                                                         │
│  ├── Container: generatorai-chat-abc123                                    │
│  │   ├── BridgeServer + CopilotClient + CopilotSession                   │
│  │   └── /workspace/ (chat's repo clone)                                  │
│  │                                                                         │
│  ├── Container: generatorai-chat-def456                                    │
│  │   └── ... (independent chat sandbox)                                   │
│  │                                                                         │
│  └── Pool: 2-3 pre-warmed containers (idle, ready to claim)              │
└────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Key Architectural Changes from Original Plan

| Aspect | Original Plan | Revised Architecture | Justification |
|--------|---------------|---------------------|---------------|
| Container scope | 1 per session | 1 per workflow run / 1 per chat | Workflow stages need shared filesystem; chat needs isolation |
| Session multiplexing | Not addressed | Multiple CopilotSessions per container (within a workflow) | SDK supports it; eliminates artifact passing overhead |
| `sandboxGroupId` | Not in API | Added to `CreateConversationParams` | Groups conversations into shared containers |
| Artifact passing | Not addressed | `extractWorkspace` / `injectFiles` bridge methods + `WorkspaceTransferService` | Required for per-stage mode and user artifact download |
| Chat isolation | Not addressed | 1 container per chat (with shared option for resource-constrained envs) | Security-first; explicitly trades resources for isolation |
| Bridge reconnection | Not addressed | Exponential backoff reconnect in `ContainerBridge` | Operational resilience |
| Graceful shutdown | Not addressed | Defined shutdown sequence (see §7.5) | Prevents orphaned containers |
| Health check | HTTP-style against TCP server | TCP-based ping over JSON-RPC | Matches actual bridge protocol |
| Workspace staging | Not addressed | Per-stage subdirectories for parallel stages | Prevents file conflicts in parallel execution |

### 7.3 Revised Package Structure

```
packages/sandbox/
├── package.json
├── tsconfig.json
├── Dockerfile
├── .dockerignore
├── src/
│   ├── index.ts                              ← Package exports
│   ├── ContainerManager.ts                   ← Docker container CRUD
│   ├── ContainerPool.ts                      ← Pre-warmed container pool
│   ├── ContainerBridge.ts                    ← TCP JSON-RPC client (host-side)
│   ├── ContainerizedCopilotAdapter.ts        ← ICopilotPort impl (REVISED)
│   ├── WorkspaceTransferService.ts           ← NEW: artifact extract/inject
│   ├── bridge-protocol.ts                    ← Shared types (EXTENDED)
│   ├── container-entrypoint.ts               ← Container-side BridgeServer
│   ├── health.ts                             ← TCP-based health check
│   └── types.ts                              ← Shared types
└── __tests__/
    ├── ContainerManager.test.ts
    ├── ContainerPool.test.ts
    ├── ContainerBridge.test.ts
    ├── ContainerizedCopilotAdapter.test.ts
    └── WorkspaceTransferService.test.ts
```

### 7.4 Revised `ContainerizedCopilotAdapter` Design

```typescript
export class ContainerizedCopilotAdapter implements ICopilotPort {
  /**
   * Maps sandboxGroupId → { containerId, bridge, sessions }
   * - For workflows: sandboxGroupId = workflowRunId
   * - For chats: sandboxGroupId = chatId
   */
  private sandboxes = new Map<string, SandboxState>();

  /**
   * Maps conversationId → sandboxGroupId (reverse lookup)
   */
  private conversationToSandbox = new Map<string, string>();

  constructor(
    private containerManager: ContainerManager,
    private containerPool: ContainerPool,
    private workspaceTransfer: WorkspaceTransferService,
    private config: SandboxConfig,
    private logger: ILogger,
  ) {}

  async createConversation(params: CreateConversationParams): Promise<string> {
    const groupId = params.sandboxGroupId ?? params.conversationId;

    let sandbox = this.sandboxes.get(groupId);

    if (!sandbox) {
      // First conversation for this group — acquire container
      const container = await this.containerPool.acquire(groupId);
      const bridge = new ContainerBridge(container.bridgePort, this.logger);
      await bridge.connect();

      sandbox = {
        containerId: container.id,
        dockerId: container.dockerId,
        bridge,
        sessions: new Set(),
        groupId,
      };
      this.sandboxes.set(groupId, sandbox);

      // Clone repo if specified
      if (params.repoUrl) {
        await bridge.call('cloneRepo', {
          repoUrl: params.repoUrl,
          branch: params.repoBranch,
        });
      }
    }

    // Create session INSIDE the existing container
    await sandbox.bridge.call('createSession', {
      conversationId: params.conversationId,
      model: params.model,
      systemMessage: params.systemMessage,
      streaming: params.streaming ?? true,
      workingDirectory: params.workingDirectory ?? '/workspace',
      // ... other params
    });

    sandbox.sessions.add(params.conversationId);
    this.conversationToSandbox.set(params.conversationId, groupId);

    return params.conversationId;
  }

  async destroyConversation(conversationId: string): Promise<void> {
    const groupId = this.conversationToSandbox.get(conversationId);
    if (!groupId) return;

    const sandbox = this.sandboxes.get(groupId);
    if (!sandbox) return;

    // Destroy session inside container
    await sandbox.bridge.call('destroyConversation', { conversationId });
    sandbox.sessions.delete(conversationId);
    this.conversationToSandbox.delete(conversationId);

    // If this was the last session in the sandbox, destroy the container
    if (sandbox.sessions.size === 0) {
      await this.releaseSandbox(groupId);
    }
  }

  /**
   * Extract workspace artifacts before destroying a sandbox.
   * Called by WorkflowRunService on workflow completion
   * or ChatManagementService on chat archive.
   */
  async extractArtifacts(groupId: string): Promise<ExtractedFile[]> {
    const sandbox = this.sandboxes.get(groupId);
    if (!sandbox) return [];

    return this.workspaceTransfer.extractWorkspace(
      sandbox.bridge,
      sandbox.dockerId,
    );
  }

  private async releaseSandbox(groupId: string): Promise<void> {
    const sandbox = this.sandboxes.get(groupId);
    if (!sandbox) return;

    sandbox.bridge.disconnect();
    await this.containerManager.destroyContainer(sandbox.containerId);
    this.sandboxes.delete(groupId);

    // Trigger pool replenish
    this.containerPool.replenishAsync();
  }
}
```

### 7.5 Graceful Shutdown Sequence

```
Server shutdown triggered (SIGTERM/SIGINT)
  │
  ├── 1. Stop accepting new HTTP requests
  │
  ├── 2. For each active sandbox:
  │   ├── 2a. Abort all active conversations
  │   ├── 2b. Extract artifacts (if session was in progress)
  │   ├── 2c. Send 'shutdown' to bridge
  │   └── 2d. Destroy container (with 10s timeout)
  │
  ├── 3. Drain container pool (destroy all idle containers)
  │
  ├── 4. Close SSE streams
  │
  ├── 5. Flush and close database
  │
  └── 6. Process exit
```

### 7.6 Revised Composition Root

```typescript
// apps/server/src/composition-root.ts — revised

function createCopilotPort(config: AppConfig, logger: ILogger): ICopilotPort {
  if (config.sandbox?.enabled) {
    try {
      const docker = new Docker();
      await docker.ping(); // Verify Docker is available

      const containerManager = new ContainerManager(logger, config.sandbox);
      const containerPool = new ContainerPool(containerManager, logger, {
        minPoolSize: config.sandbox.pool.minSize,
        maxPoolSize: config.sandbox.pool.maxSize,
      });
      const workspaceTransfer = new WorkspaceTransferService(logger);

      const adapter = new ContainerizedCopilotAdapter(
        containerManager,
        containerPool,
        workspaceTransfer,
        config.sandbox,
        logger,
      );

      logger.info('[Sandbox] ContainerizedCopilotAdapter created');
      return adapter;
    } catch (err) {
      logger.warn(`[Sandbox] Docker not available, falling back to direct mode: ${err}`);
    }
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

### 7.7 Revised AppConfig Extension

```typescript
// packages/shared/src/config/AppConfig.ts — additions

sandbox: z
  .object({
    /** Enable sandboxed container execution */
    enabled: z.boolean().default(false),

    /** Docker image name */
    imageName: z.string().default('generatorai/session-sandbox:latest'),

    /** Container resource limits */
    resources: z.object({
      cpuCount: z.number().default(2),
      memoryBytes: z.number().default(4 * 1024 * 1024 * 1024), // 4 GB
      diskBytes: z.number().default(10 * 1024 * 1024 * 1024),  // 10 GB
      pidsLimit: z.number().default(256),
      timeoutMs: z.number().default(600_000), // 10 min
    }).default({}),

    /** Container pool configuration */
    pool: z.object({
      minSize: z.number().default(2),
      maxSize: z.number().default(20),
      maxTotalContainers: z.number().default(25), // hard cap: pooled + claimed
    }).default({}),

    /** Network configuration */
    network: z.object({
      restrictEgress: z.boolean().default(true),
      allowedDomains: z.array(z.string()).default([
        'api.github.com',
        'github.com',
        '*.githubusercontent.com',
        'copilot-proxy.githubusercontent.com',
        'registry.npmjs.org',
      ]),
    }).default({}),

    /** Chat isolation strategy */
    chatIsolation: z.enum(['per-chat', 'shared']).default('per-chat'),
  })
  .optional()
  .default(undefined),
```

### 7.8 Revised Bridge Protocol

```typescript
// packages/sandbox/src/bridge-protocol.ts

/** Host → Container requests */
export type BridgeRequest =
  // Session lifecycle
  | { method: 'createSession'; params: CreateSessionBridgeParams }
  | { method: 'resumeSession'; params: { conversationId: string } }
  | { method: 'destroyConversation'; params: { conversationId: string } }
  | { method: 'abortConversation'; params: { conversationId: string } }
  // Messaging
  | { method: 'sendPrompt'; params: { conversationId: string; prompt: string; attachments?: AttachmentRef[] } }
  | { method: 'sendPromptAndWait'; params: { conversationId: string; prompt: string; attachments?: AttachmentRef[] } }
  | { method: 'getMessages'; params: { conversationId: string } }
  // Discovery
  | { method: 'getModels'; params: {} }
  | { method: 'listSessions'; params: {} }
  // Workspace operations (NEW)
  | { method: 'cloneRepo'; params: { repoUrl: string; branch?: string; targetDir?: string } }
  | { method: 'injectFiles'; params: { files: { path: string; content: string; encoding?: 'utf-8' | 'base64' }[]; targetDir?: string } }
  | { method: 'extractWorkspace'; params: { paths?: string[]; changedOnly?: boolean } }
  | { method: 'listWorkspaceFiles'; params: { path?: string; recursive?: boolean } }
  // Health & lifecycle
  | { method: 'ping'; params: {} }
  | { method: 'shutdown'; params: {} };

/** Container → Host notifications */
export type BridgeNotification =
  | { method: 'event'; params: { conversationId: string; event: SessionEventData } }
  | { method: 'clientEvent'; params: { event: ClientEventData } }
  | { method: 'fileWrite'; params: { conversationId: string; path: string; content: string } }
  | { method: 'log'; params: { level: string; message: string } }
  | { method: 'healthStatus'; params: { memoryUsageMb: number; activeSessionCount: number } };
```

### 7.9 Revised BridgeServer (Container Entrypoint)

Key changes from original plan:
1. **Supports multiple concurrent sessions** per container (for workflows)
2. **Workspace file operations** (inject, extract, list)
3. **File-write event interception** for real-time artifact tracking
4. **TCP-based health check** instead of HTTP

```typescript
// Conceptual structure of the revised container-entrypoint.ts

class BridgeServer {
  private client: CopilotClient;
  private sessions = new Map<string, CopilotSession>(); // MULTIPLE sessions

  async handleMessage(msg: BridgeRequest): Promise<unknown> {
    switch (msg.method) {
      case 'createSession':
        return this.createSession(msg.params);  // Adds to sessions map
      case 'destroyConversation':
        return this.destroySession(msg.params.conversationId);
      case 'sendPrompt':
        return this.sendPrompt(msg.params);
      case 'sendPromptAndWait':
        return this.sendPromptAndWait(msg.params);

      // NEW: Workspace operations
      case 'injectFiles':
        return this.injectFiles(msg.params);
      case 'extractWorkspace':
        return this.extractWorkspace(msg.params);
      case 'listWorkspaceFiles':
        return this.listWorkspaceFiles(msg.params);

      case 'ping':
        return { status: 'ok', activeSessions: this.sessions.size };
      case 'shutdown':
        return this.shutdown();
    }
  }

  private async injectFiles(params: InjectFilesParams): Promise<void> {
    for (const file of params.files) {
      const targetPath = path.join(params.targetDir ?? '/workspace', file.path);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const content = file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64')
        : file.content;
      await fs.writeFile(targetPath, content);
    }
  }

  private async extractWorkspace(params: ExtractWorkspaceParams): Promise<ExtractedFile[]> {
    const basePath = '/workspace';
    const files: ExtractedFile[] = [];
    // Recursively read workspace files
    // If changedOnly, compare with initial state (git diff or file timestamp tracking)
    // Return file path + content for each file
    return files;
  }
}
```

---

## 8. Revised Implementation Plan

### Phase 1: Core Sandbox Infrastructure (Weeks 1-2)

| Task | Hours | Description |
|------|-------|-------------|
| Create `packages/sandbox/` package | 2h | Package structure, tsconfig, build pipeline |
| Define `bridge-protocol.ts` (extended) | 4h | All message types including workspace operations |
| Define `types.ts` | 2h | `SandboxState`, `SandboxConfig`, `ExtractedFile`, etc. |
| Implement `container-entrypoint.ts` (multi-session) | 12h | BridgeServer + SDK + workspace ops + health check |
| Create Dockerfile | 4h | Multi-stage build, security hardening |
| Build Docker image locally | 2h | Smoke test with manual JSON-RPC |
| **Phase 1 total** | **~26h** | |

### Phase 2: Host-Side Container Management (Weeks 3-4)

| Task | Hours | Description |
|------|-------|-------------|
| Implement `ContainerManager.ts` | 8h | Full CRUD, network setup, resource limits |
| Implement `ContainerBridge.ts` (with reconnection) | 10h | TCP JSON-RPC client, exponential backoff reconnect |
| Implement `ContainerPool.ts` | 8h | Pre-warming, acquire/release, max cap enforcement |
| Implement `WorkspaceTransferService.ts` | 6h | Extract/inject, tar streaming, file-level extraction |
| **Phase 2 total** | **~32h** | |

### Phase 3: Adapter & Integration (Weeks 5-6)

| Task | Hours | Description |
|------|-------|-------------|
| Implement `ContainerizedCopilotAdapter.ts` (revised) | 14h | sandboxGroupId routing, multi-session management |
| Add `sandboxGroupId` to `CreateConversationParams` | 2h | Extend `ICopilotPort` interface |
| Add `sandbox` config to `AppConfig.ts` | 2h | Schema + validation + env var mapping |
| Modify `composition-root.ts` | 2h | Conditional adapter selection with Docker check |
| Modify `SessionAllocator` | 4h | Pass `sandboxGroupId` (workflowRunId or chatId) |
| Modify `ChatManagementService` | 3h | Pass `sandboxGroupId = chatId` in createConversation |
| Modify `WorkflowRunService` | 3h | Extract artifacts on workflow completion |
| Modify `StageExecutionService` | 4h | Inject upstream file context into stage prompts |
| Add artifact download API endpoints | 4h | GET /api/v2/workflow-runs/:id/artifacts, etc. |
| Implement graceful shutdown | 4h | Ordered shutdown sequence |
| **Phase 3 total** | **~42h** | |

### Phase 4: Testing & Hardening (Weeks 7-8)

| Task | Hours | Description |
|------|-------|-------------|
| Unit tests (mocked Docker) | 12h | All sandbox components |
| Integration tests (real Docker) | 10h | E2E: create → session → artifacts → destroy |
| Multi-session workflow test | 6h | Workflow with 3 stages sharing one container |
| Parallel stage execution test | 4h | Two stages running concurrently in one container |
| Security tests | 4h | Filesystem isolation, network egress, resource limits |
| Fallback mode tests | 2h | Docker unavailable → CopilotAdapter |
| Performance benchmarks | 4h | Startup time, memory, concurrent sessions |
| Windows Docker Desktop testing | 4h | Pool sizing, performance validation |
| Documentation | 4h | Ops guide, config reference |
| **Phase 4 total** | **~50h** | |

### Total Estimated Effort: **~150 hours (7-9 weeks)**

Increase from original 112h due to multi-session support, workspace transfer, and extended testing.

---

## 9. Decision Register

| # | Decision | Options Considered | Chosen | Justification |
|---|----------|-------------------|--------|---------------|
| D1 | Agent runtime placement | A: CLI-only in container, B: SDK+CLI in container | **B: SDK+CLI inside container** | SDK tool handlers execute on host in option A — defeats sandboxing. Industry-validated by Codex, Claude Code, Copilot Coding Agent. |
| D2 | Workflow container scope | A: 1 per stage, B: 1 per workflow run | **B: 1 per workflow run** | Stages need shared filesystem for file dependencies. SDK supports multiple sessions per client. Eliminates artifact transfer overhead between stages. |
| D3 | Chat container scope | A: 1 per chat, B: shared for all chats | **A: 1 per chat** | Security isolation between chats. Independent lifecycle management. 1.5 GB for 5 chats is acceptable. |
| D4 | Artifact passing (per-stage mode) | A: Shared volume, B: Extract/inject via host, C: Git-based | **B: Extract/inject via host** | No shared state, explicit flow, works with ephemeral containers. Fallback option when user wants per-stage isolation. |
| D5 | Parallel stage workspace strategy | A: Shared /workspace, B: Per-stage subdirectories | **B: Subdirectories** (`/workspace/stages/<name>`) | Prevents file conflicts. Each stage has a clean working directory while still being able to read sibling directories. |
| D6 | Bridge protocol | A: REST, B: gRPC, C: JSON-RPC/TCP, D: WebSocket | **C: JSON-RPC over TCP** | Minimal overhead, bidirectional, native notifications. Proven in Copilot SDK's own CLI protocol. |
| D7 | Container reuse | A: Reusable (return to pool), B: Ephemeral (destroy) | **B: Ephemeral** | Clean state guarantee. Security over performance. Pool pre-warming hides the 3s overhead. |
| D8 | Multi-session container routing | A: New service (`SandboxManager`), B: `sandboxGroupId` in params | **B: `sandboxGroupId` in params** | Minimal API change. Adapter groups conversations by groupId internally. |
| D9 | Health check protocol | A: HTTP endpoint, B: TCP JSON-RPC ping | **B: TCP JSON-RPC ping** | Bridge is TCP-only; adding HTTP just for health checks is unnecessary complexity. |
| D10 | Chat shared mode | A: Always per-chat, B: Configurable | **B: Configurable** | Default `per-chat` for security. `shared` option for resource-constrained environments (e.g., 8 GB laptop). |

---

## Summary of Changes from Original Plan

### Keep (Validated)
- SDK + CLI inside container
- Ephemeral containers
- JSON-RPC over TCP
- Pre-warmed container pool
- Domain-allowlisted egress
- ICopilotPort adapter pattern
- Graceful fallback to direct execution
- Non-root user, dropped capabilities, seccomp

### Change
| What | Original | Revised |
|------|----------|---------|
| Container scope for workflows | 1 per session | 1 per workflow run (multiple sessions inside) |
| `CreateConversationParams` | No grouping concept | Add `sandboxGroupId` field |
| Bridge protocol | No workspace operations | Add `injectFiles`, `extractWorkspace`, `listWorkspaceFiles` |
| Container entrypoint | Single-session bridge | Multi-session bridge (manages N CopilotSessions) |
| Health check | HTTP-based (mismatch) | TCP-based JSON-RPC ping |
| Bridge connection | No reconnection | Exponential backoff reconnection |

### Add (NEW)
| What | Purpose |
|------|---------|
| `WorkspaceTransferService` | Extract/inject artifacts between stages (for per-stage isolation mode) |
| `sandboxGroupId` routing in adapter | Route conversations to existing containers based on workflow/chat ID |
| Artifact download API endpoints | Let users download generated code |
| Graceful shutdown sequence | Prevent orphaned containers on server restart |
| `chatIsolation` config option | Allow shared container for resource-constrained deployments |
| Parallel stage subdirectory strategy | Prevent file conflicts in concurrent execution |
| File context injection for downstream stages | Let Stage C know about files Stage A wrote |

---

*This review supersedes the original SANDBOX_IMPLEMENTATION_PLAN.md for architectural decisions. Implementation should follow this document's revised architecture while using the original plan's detailed code examples as reference for the parts that remain unchanged.*
