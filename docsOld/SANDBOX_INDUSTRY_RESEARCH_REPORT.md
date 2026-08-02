# AI Coding Agent Sandboxed Execution: Comprehensive Industry Research Report

> **Date**: March 5, 2026  
> **Scope**: Industry-wide analysis of sandboxing approaches in modern AI coding agents (2024–2026), with specific recommendations for GeneratorAI's workflow/chat architecture  
> **Inputs**: SANDBOX_IMPLEMENTATION_PLAN.md, CONTAINER_SANDBOXING_RESEARCH.md, ARCHITECTURE_ANALYSIS.md, WORKFLOW_ARCHITECTURE.md, COPILOT_SDK_AGENT_ANALYSIS.md, public engineering blogs, launch posts, and open-source code (E2B, Daytona, Cline, etc.)

---

## Table of Contents

1. [Major Agent Sandboxing Approaches (2024–2026)](#1-major-agent-sandboxing-approaches-20242026)
2. [Key Architecture Decisions — Industry Convergence](#2-key-architecture-decisions--industry-convergence)
3. [Critical Design Questions — Analysis & Answers](#3-critical-design-questions--analysis--answers)
4. [Specific Technical Patterns](#4-specific-technical-patterns)
5. [Pros/Cons Matrix: SDK-in-Container vs CLI-Only-in-Container](#5-proscons-matrix-sdk-in-container-vs-cli-only-in-container)
6. [Recommendation: Workflow Multi-Session Sandboxing](#6-recommendation-workflow-multi-session-sandboxing)
7. [Recommendation: Chat Session Sandboxing](#7-recommendation-chat-session-sandboxing)
8. [Artifact Extraction Best Practices](#8-artifact-extraction-best-practices)
9. [Gaps & Issues in the Current SANDBOX_IMPLEMENTATION_PLAN.md](#9-gaps--issues-in-the-current-sandbox_implementation_planmd)
10. [Summary of Industry Convergence Points](#10-summary-of-industry-convergence-points)

---

## 1. Major Agent Sandboxing Approaches (2024–2026)

### 1.1 OpenAI Codex (Cloud Agent, 2025)

**Isolation technology**: Firecracker microVMs (same tech as AWS Lambda).

| Aspect | Detail |
|--------|--------|
| **Unit of isolation** | One microVM per *task* (not per turn — each user request = fresh VM) |
| **Startup time** | ~125 ms for VM boot; total task-ready in ~2–4 s (includes dependency pre-install) |
| **Root filesystem** | Read-only base squashfs image + overlay for writes |
| **Network** | **No outbound internet during execution** — all dependencies are pre-installed into the image during a build phase. Only the Codex control plane API is reachable. |
| **Persistence** | Fully ephemeral — no state survives between tasks |
| **SDK/Agent placement** | Entire agent runtime lives inside the VM. The control plane (OpenAI's orchestrator) sends the user's task via internal RPC and receives diffs + logs back. |
| **Artifact extraction** | Codex captures a structured diff of all file mutations (before/after) and surfaces them in the UI. Internally uses `git diff` on the ephemeral workspace. |
| **Auto-approve** | All tool calls are auto-approved — the sandbox IS the permission boundary. Users configure a "AGENTS.md" allowlist/denylist for which commands/tools the agent may use, but this is advisory — the VM prevents blast-radius regardless. |
| **Resource limits** | Fixed per-tier CPU/RAM allocation. Tasks have a wall-clock timeout (configurable). |
| **Pre-warming** | Codex pre-bakes environment images per-repository: they snapshot the repo + `npm install` / `pip install` result into a read-only VM image so each task starts with dependencies ready. |

**Key takeaway**: The gold standard for untrusted code execution. Because there is **no network** during execution, even a fully compromised agent cannot exfiltrate data. The trade-off is that the agent cannot install new dependencies at runtime — everything must be pre-baked.

**Relevance to GeneratorAI**: GeneratorAI's Copilot CLI *requires* outbound HTTPS to `api.github.com` and `copilot-proxy.githubusercontent.com` to function (it's an API client, not a local model). Full network isolation is therefore not feasible for GeneratorAI — domain-allowlisted egress is the correct equivalent.

---

### 1.2 Anthropic Claude Code (Local CLI, 2024–2026)

**Isolation technology**: None by default — runs as a local CLI process in the user's terminal.

| Aspect | Detail |
|--------|--------|
| **Default mode** | Local Node.js CLI, `child_process.spawn` for shell commands, direct filesystem access |
| **Permission model** | Interactive approval: user must approve file writes, shell commands, and other mutations. Supports `--dangerously-skip-permissions` for headless/automated use. |
| **Docker mode** | Officially documented: `docker run -it -v $(pwd):/workspace anthropic/claude-code`. When launched this way, the entire CLI runs inside a container with the workspace bind-mounted. |
| **CI/Headless mode** | Claude Code runs in GitHub Actions runners (ephemeral VMs) or in Docker containers. In headless mode, all permissions are auto-approved — the CI environment is the sandbox. |
| **SDK/Agent placement** | The entire agent (including tool executors) is one process. There is no separate "SDK on host, CLI in container" split. |
| **Session state** | Conversations are stored locally in `~/.claude/` (or equivalent). Resumable via session IDs. |

**Key takeaway**: Claude Code's security model is "user-in-the-loop for local use, container for automated use." When running autonomously (which matches GeneratorAI's model), Anthropic's own guidance is to wrap Claude Code in a Docker container. There is no separate SDK-on-host mode — the agent is monolithic.

**Relevance to GeneratorAI**: Validates the "full agent inside container" approach (Approach B in SANDBOX_IMPLEMENTATION_PLAN.md). Claude Code's architecture proves that splitting the agent across host/container creates more complexity than running everything inside.

---

### 1.3 Devin by Cognition Labs (Cloud Agent, 2024–2026)

**Isolation technology**: Full cloud VMs (likely Firecracker or KVM-based microVMs on AWS).

| Aspect | Detail |
|--------|--------|
| **Unit of isolation** | One VM per *session* (long-lived — hours to days) |
| **Environment** | Full Linux desktop: VS Code Server, Chromium browser, terminal, Playwright, systemd |
| **Persistence** | VM disk is persistent (EBS-style volumes + snapshots). The VM can be paused/snapshotted and resumed later. |
| **Network** | **Full internet access** — Devin can browse the web, access APIs, install packages, SSH to external servers. This is by design: Devin is positioned as a "software engineer" that needs the same capabilities as a human. |
| **Session lifecycle** | VMs are provisioned on-demand (~10–30 seconds), persist during the session, and can be suspended/resumed. |
| **Multi-session** | Each Devin session is independent. There is no concept of "workflow with multiple stages sharing a VM" — each session is a single long-running task. |
| **Artifact extraction** | Devin can push code to GitHub directly (it has full git + GitHub access). Users can also browse the VM's filesystem via the web UI. |

**Key takeaway**: Devin prioritizes *capability breadth* over startup speed. The full VM gives the agent maximum power (browsers, services, etc.) at the cost of provisioning time and per-session cost. This approach makes sense for Devin's positioning as an autonomous engineer tackling complex multi-hour tasks.

**Relevance to GeneratorAI**: GeneratorAI's agent (Copilot CLI) doesn't need browsers, desktop environments, or system services. Docker containers provide sufficient isolation at 10–100x lower overhead. Devin's approach is overengineered for GeneratorAI's use case.

---

### 1.4 E2B (Open Source, 2023–2026)

**Isolation technology**: Firecracker microVMs, managed as a cloud service.

| Aspect | Detail |
|--------|--------|
| **API model** | `Sandbox.create()` → get a sandbox with filesystem, process, and network APIs |
| **Startup time** | ~150 ms for VM boot; ~1–3 s total with template initialization |
| **Templates** | Users define "sandbox templates" (like Dockerfiles) that pre-install tools and dependencies. Templates are snapshotted for fast boot. |
| **Filesystem API** | `sandbox.filesystem.write()`, `sandbox.filesystem.read()`, `sandbox.filesystem.list()` — the host never directly touches the sandbox filesystem |
| **Process API** | `sandbox.process.start()` — run any command inside the sandbox with streaming stdout/stderr |
| **Network** | Sandboxes have outbound internet access by default. Can be restricted per-template. Each sandbox gets a unique hostname for inbound access (useful for running dev servers). |
| **Lifecycle** | Ephemeral by default (auto-destroyed after timeout). Can be kept alive with `sandbox.keepAlive()`. |
| **Multi-sandbox** | E2B supports running multiple sandboxes concurrently. Each is independent. No built-in concept of "workflow with shared state across sandboxes." |
| **SDK placement** | The agent/SDK runs on the host (or in the user's application). Only the code being executed runs inside the E2B sandbox. E2B is explicitly a *code execution* sandbox, not an *agent* sandbox. |

**Key takeaway**: E2B is the clearest example of the "control plane / data plane" split. The agent decides what to do (control plane, on host), and E2B executes it (data plane, in sandbox). This differs from GeneratorAI's model where the Copilot CLI is itself the agent — it decides AND executes.

**Relevance to GeneratorAI**: E2B's "code execution sandbox" model is a poor fit for GeneratorAI because the Copilot CLI is not just executing code — it's an autonomous agent that decides which files to read, what commands to run, and what code to write. Putting only the execution in a sandbox while leaving the agent on the host means the agent's own tool-execution code runs on the host — defeating sandboxing. GeneratorAI correctly chose to put the full agent inside the container.

---

### 1.5 GitHub Copilot Workspace & Copilot Coding Agent (2024–2026)

**Isolation technology**: Varies by product.

| Product | Isolation |
|---------|-----------|
| **Copilot Workspace** | No local sandbox. Operates on a *plan-and-diff* model: the AI generates code changes as patches, and users review/apply them. Execution happens in Codespaces. |
| **Copilot Coding Agent** (in GitHub.com) | Runs inside a **GitHub Actions runner** — a fresh Docker container (or VM) for each task. The agent clones the repo, makes changes, creates a PR. |
| **GitHub Codespaces** | Full cloud dev environment: Docker container on a VM, persistent filesystem, integrated VS Code, port forwarding. Used for testing, not for the agent itself. |

**Key insights**:
1. GitHub separates *AI reasoning* (server-side, no sandbox needed) from *code execution* (Codespaces/Actions containers).
2. The Copilot Coding Agent runs in a fresh GitHub Actions runner — this is effectively "one ephemeral container per task" with full internet access (for `npm install`, `pip install`, etc.).
3. The runner has the repo cloned, GitHub token injected via environment, and auto-cleanup on task completion.

**Relevance to GeneratorAI**: The Copilot Coding Agent's architecture (agent runs inside the Actions runner container) is essentially the same as GeneratorAI's "SDK+CLI inside container" approach. GitHub validates this pattern at massive scale.

---

### 1.6 Cursor, Windsurf, Cline — Local IDE Agents

| Agent | Isolation | Details |
|-------|-----------|---------|
| **Cursor** | None | IDE extension — all code changes happen directly in the user's workspace. Has a "Shadow Workspace" for type-checking, but this is not a security sandbox. |
| **Windsurf (Codeium)** | None | IDE extension — same model as Cursor. Agent operates within the IDE's process. |
| **Cline** (open source) | None | VS Code extension — executes shell commands as `child_process` in the user's terminal. Has an approval UI for each command. |
| **Aider** | None | CLI tool — runs in the user's terminal with full filesystem access. |
| **Continue** | None | IDE extension — delegates to user-visible terminals for execution. |

**Key takeaway**: Local IDE agents universally skip sandboxing because:
1. The user is watching every action in real-time
2. The agent operates in the user's own workspace (no multi-tenancy concern)
3. The blast radius is limited to the user's own machine (which they already trust)

**Relevance to GeneratorAI**: GeneratorAI is a *server-side* tool that runs *unattended*. Users submit workflows and walk away — there's no human-in-the-loop reviewing each file write or shell command. This fundamentally different trust model makes sandboxing essential.

---

### 1.7 Daytona (Cloud Dev Environments, 2024–2026)

**Isolation technology**: Docker containers on remote infrastructure, with a custom dev environment management layer.

| Aspect | Detail |
|--------|--------|
| **Unit of isolation** | One "workspace" (container) per development environment |
| **Lifecycle** | Persistent — workspaces survive disconnects and can be resumed |
| **Template system** | Devcontainer spec compatible (`.devcontainer/devcontainer.json`) |
| **Agent integration** | Daytona's SDK allows AI agents to create and operate in isolated dev environments. The agent runs outside the sandbox and sends commands via Daytona's API. |
| **Startup time** | 5–15 seconds depending on the template |
| **Network** | Full internet access (designed for development, not security sandboxing) |

**Key takeaway**: Daytona solves a different problem (reproducible dev environments for humans and agents) rather than security isolation. Useful for providing agents with consistent toolchains, but not a security sandbox by itself.

---

### 1.8 Gitpod (Cloud Dev Environments, 2020–2026)

**Isolation technology**: Docker containers inside cloud VMs with Kubernetes orchestration.

| Aspect | Detail |
|--------|--------|
| **Unit of isolation** | One workspace per dev environment, running in a K8s pod |
| **Template system** | `.gitpod.yml` configuration for environment setup |
| **Lifecycle** | Persistent with auto-stop on inactivity, auto-delete after timeout |
| **Agent support** | Gitpod Flex allows running AI agents in dedicated workspace containers |
| **Networking** | Full internet access, port forwarding for running dev servers |

**Key takeaway**: Like Daytona, Gitpod is about environment consistency rather than security sandboxing. However, its workspace lifecycle management (auto-stop, auto-destroy, resource limits) provides useful patterns for GeneratorAI's container pool.

---

### 1.9 Google Jules (2025–2026)

**Isolation technology**: Cloud VMs (likely on Google Cloud, GKE-based).

| Aspect | Detail |
|--------|--------|
| **Unit of isolation** | One VM per coding task |
| **Approach** | Similar to Codex — agent receives a task, works in an isolated environment, produces a PR |
| **Network** | Restricted — agent cannot make arbitrary outbound connections |
| **Lifecycle** | Ephemeral per-task |

---

### 1.10 Amazon Q Developer Agent (2024–2026)

**Isolation technology**: AWS Lambda-style sandboxes (likely Firecracker).

| Aspect | Detail |
|--------|--------|
| **Unit of isolation** | One sandbox per `/dev` agent task (code transformation, vulnerability fix, etc.) |
| **Approach** | Agent clones the repo into the sandbox, makes changes, creates a PR |
| **Network** | Restricted to AWS/GitHub APIs |
| **Lifecycle** | Ephemeral per-task |

---

## 2. Key Architecture Decisions — Industry Convergence

### 2.1 SDK/Agent on Host vs Inside Container

This is the most consequential architecture decision. The industry has converged on a clear answer:

| System | Agent/SDK Location | Rationale |
|--------|-------------------|-----------|
| OpenAI Codex | **Inside sandbox** | Agent + execution in one VM; control plane outside |
| Claude Code (headless) | **Inside container** | Entire CLI runs in Docker when containerized |
| Devin | **Inside VM** | Agent + environment in one VM |
| E2B | **Host** (SDK) / **Sandbox** (execution only) | E2B is a code-execution service, not an agent runtime |
| GitHub Copilot Coding Agent | **Inside runner** | Agent runs inside the Actions runner container |
| Cursor/Cline/Windsurf | **Host** (no sandbox) | Local tools, user-in-the-loop |
| Replit Agent | **Inside container** | Agent operates within the Replit container |
| Google Jules | **Inside VM** | Agent + execution co-located |
| Amazon Q Developer Agent | **Inside sandbox** | Agent + execution co-located |

**Convergence**: For autonomous agents that write files and run commands, the agent runtime goes INSIDE the sandbox. Only E2B (which is a code-execution service, not an agent) keeps the SDK on the host.

**Why**: The critical insight is that the agent's *tool execution* happens in the same process as the agent's *reasoning*. If you put only the CLI in the container but keep the SDK on the host, the SDK's tool handlers (`onPermissionRequest`, custom tools) execute on the host. A rogue tool invocation would run on the host machine — defeating the purpose of sandboxing.

### 2.2 Container per Session vs Container per Workflow

| Pattern | Who Uses It | When |
|---------|------------|------|
| **Container per task/session** | Codex, Copilot Coding Agent, E2B | Most common — clean isolation per unit of work |
| **Persistent container per project** | Replit, Daytona, Gitpod, Devin | When continuity matters (dev environments, long-running agents) |
| **Container per workflow (multi-session)** | None observed in production | No major system does this — see analysis below |

**Analysis**: No production system uses a "shared container across multiple sessions within a workflow." This is because:
1. Sessions in different stages may need different tools/dependencies
2. Resource contention between concurrent sessions in a shared container is hard to manage
3. Process isolation within a single container is not guaranteed (one session's shell commands can see another session's processes)
4. Failure in one session's shell commands can affect the container's state for other sessions

However, GeneratorAI's `single` session mode (all stages share one Copilot conversation) naturally maps to a single container — because there's literally one CLI process handling all stages sequentially.

### 2.3 Communication Protocols Between Host and Sandbox

| System | Protocol | Direction | Notes |
|--------|----------|-----------|-------|
| E2B | WebSocket + REST | Bidirectional | Rich SDK with filesystem/process/network APIs |
| Codex | Internal gRPC (presumed) | Bidirectional | Control plane ↔ Firecracker VM |
| Devin | WebSocket (browser ↔ VM) | Bidirectional | For user interaction / VNC |
| Replit | Custom protobuf/gRPC | Bidirectional | High-performance file sync |
| Daytona | REST + SSH | Bidirectional | Standard dev env protocols |
| **GeneratorAI (planned)** | **JSON-RPC over TCP** | **Bidirectional** | Lightweight, debuggable |

**Assessment**: GeneratorAI's choice of JSON-RPC over TCP is well-aligned with industry practice. It's simpler than gRPC (no protobuf compilation) and more appropriate than REST (which is stateless and requires WebSocket for events). JSON-RPC's notification mechanism maps perfectly to event streaming.

### 2.4 Pre-Warming / Pooling Strategies

| System | Strategy | Pool Size | Startup Target |
|--------|----------|-----------|----------------|
| Codex | Pre-baked VM images + on-demand spawn | N/A (Firecracker boots in ~125ms) | <2s |
| E2B | Template snapshots + on-demand spawn | N/A (Firecracker) | ~1–3s |
| Replit | Persistent containers (no pool needed) | N/A | Instant (already running) |
| GitHub Actions | Runner pool (GitHub-managed) | Large | ~15–30s (includes setup) |
| **GeneratorAI (planned)** | **Pre-warmed Docker container pool** | **2–20** | **<3s** |

**Assessment**: Pre-warming is the correct strategy for Docker (which has ~0.5–2s startup time). Firecracker systems don't need pre-warming because VM boot is ~125ms. GeneratorAI's pool approach is appropriate for Docker-based isolation.

**Gap identified**: The current plan pre-warms containers with the bridge process running but no session assigned. This is good, but misses an optimization: **pre-cloning popular repos** into warm containers. If GeneratorAI knows which repos users commonly work with, it could maintain repo-specific warm containers.

### 2.5 Ephemeral vs Persistent Containers

| Approach | Who | Pros | Cons |
|----------|-----|------|------|
| **Ephemeral** (destroy after use) | Codex, Copilot Coding Agent, E2B (default), GeneratorAI (planned) | Clean state, no leakage, simple lifecycle | Re-clone repo each time, slower for repeated work on same repo |
| **Persistent** (survives session) | Devin, Replit, Daytona, Gitpod | Fast resume, accumulated context | State leakage risk, complex cleanup, storage costs |

**Assessment**: Ephemeral is correct for GeneratorAI's security model. The re-clone cost is absorbed by:
1. Pool pre-warming (bridge ready in <100ms)
2. Shallow clones (`--depth 1`)
3. Async cloning (session starts while clone is in progress)

### 2.6 How Systems Handle Multiple Concurrent Sessions Sharing a Workspace

This is directly relevant to GeneratorAI's `single` session mode where multiple stages share one Copilot conversation.

| System | Concurrent Session Handling |
|--------|---------------------------|
| **Codex** | No concurrent sessions — each task is independent |
| **Claude Code** | One process, one conversation at a time. Multi-turn but single-threaded. |
| **Devin** | One session per VM — no concurrency within a session |
| **Replit** | One agent per workspace container — no multi-session |
| **GitHub Copilot SDK** | The SDK supports multiple `CopilotSession` objects per `CopilotClient` process. Sessions share the CLI process but have separate conversation state. |

**Critical insight**: The Copilot SDK's ability to host multiple sessions per CLI process means a single container CAN host multiple sequential conversations (for `single` mode) or even parallel conversations (though this is untested at scale).

---

## 3. Critical Design Questions — Analysis & Answers

### 3.1 Should all DAG stages share one sandbox or each get their own?

**Short answer**: **It depends on `sessionMode`.**

| Session Mode | Sandbox Strategy | Rationale |
|-------------|-----------------|-----------|
| `single` | **One container, one CopilotClient, stages execute sequentially** | Stages need shared conversation context (the whole point of single mode). One container = one workspace = natural file sharing. |
| `per-stage` | **One container per stage** | Full isolation between stages. Each stage gets a clean environment. |
| `auto` | **One container per session** (sessions may be shared by chained stages) | Chain stages that share a session share a container. Parallel stages get separate containers. |

**Detailed analysis**:

For **`single` mode**: All stages share one Copilot conversation, which means they share one `CopilotSession` inside one `CopilotClient` inside one container. Stage B can reference files created by Stage A because they share `/workspace`. This is the simplest model — the container lifecycle matches the workflow run lifecycle.

For **`per-stage` mode**: Each stage gets its own container. But this creates the **file dependency problem**: if Stage C depends on files produced by Stages A and B, how does Stage C's container access them?

**File dependency solutions** (ranked by preference):

1. **Artifact extraction + injection**: When Stage A completes, extract modified files from Container A (via `docker cp` or tar stream), store them as artifacts in the host. When Stage C starts, inject those artifacts into Container C before execution. **This is the cleanest approach** — no shared state, explicit artifact flow.

2. **Shared Docker volume**: Mount a shared Docker volume (`workflow-run-{id}-workspace`) across all stage containers. Each stage reads/writes to the same volume. **Risk**: concurrent stages could have file conflicts. Mitigation: use file-level locking or sequential-only for shared volumes.

3. **Container-to-container copy**: After Stage A completes, copy files from Container A to Container C via the host as a relay. Similar to option 1 but without persisting artifacts.

**Recommendation for GeneratorAI**: Use **Artifact extraction + injection** (option 1). This aligns with the existing `ArtifactService` in the architecture and makes the data flow explicit. When a stage completes, the host extracts the workspace diff (files modified/created) and attaches them as artifacts to the workflow run. Downstream stages receive these artifacts injected into their container's `/workspace` before execution.

### 3.2 For chat sessions (capped at 5), is it better to run all in one sandbox or separate?

**Answer**: **One container per chat session.**

| Factor | One container for all 5 chats | One container per chat |
|--------|------------------------------|----------------------|
| Isolation | Chats can see each other's files | Complete isolation |
| Resource management | All 5 share CPU/memory limits | Each gets independent limits |
| Lifecycle | Container lives until all 5 chats are archived | Clean: chat archived → container destroyed |
| Security | Compromise in one chat affects all | Blast-radius contained |
| Complexity | Must manage multiple CopilotSessions in one bridge | Simple: one session per bridge |
| Resource overhead | Lower (1 container, 1 Node.js process) | Higher (5 containers, 5 Node.js processes) |

**Decision**: One container per chat. The resource overhead is acceptable (5 containers × ~200–400 MB RAM = 1–2 GB total, well within modern server specs), and the isolation benefits are significant. Users expect chats to be independent — if one chat runs a rogue command, it should not affect others.

**Exception**: If resource constraints are tight (e.g., desktop deployment with limited RAM), a configuration option could allow multiplexing multiple chats into a single container. But this should not be the default.

### 3.3 How do production systems extract artifacts/generated code from sandboxes?

| System | Extraction Method |
|--------|------------------|
| **Codex** | Agent captures a structured diff (file path, before content, after content) as part of its output. The control plane receives diffs, not raw files. |
| **Copilot Coding Agent** | Agent runs `git commit` + `git push` inside the Actions runner. Artifacts = the resulting PR. |
| **Devin** | Agent pushes to GitHub directly. Users can also download files via the web UI (which proxies to the VM's filesystem). |
| **E2B** | `sandbox.filesystem.read()` API — host explicitly reads files from the sandbox. Also supports `sandbox.downloadFile()` for binary artifacts. |
| **Replit** | File watching — Replit streams filesystem changes in real-time via a custom protocol. |

**Recommended approach for GeneratorAI** (hybrid):

1. **Primary: `docker cp` before destroy** — When a session/stage completes, the host uses Docker's archive API (`container.getArchive({ path: '/workspace' })`) to stream a tar archive of the workspace. This is already described in SANDBOX_IMPLEMENTATION_PLAN.md §15.3.

2. **Secondary: Git-based extraction** — If the session has a repo configured, the agent can `git commit` + `git push` to a branch inside the container. The host then records the commit SHA as an artifact. This is cleaner for code-generation workflows.

3. **Real-time: Event-based file tracking** — The Copilot CLI emits `file_write` events (via `assistant.tool_call` events with tool name `write`). The bridge can intercept these events and forward the file contents to the host in real-time, eliminating the need for post-session extraction.

### 3.4 Performance implications: SDK-inside-container vs CLI-only-in-container

| Metric | SDK inside container | CLI only in container (SDK on host) |
|--------|---------------------|--------------------------------------|
| **Memory per session** | ~150–300 MB (Node.js + SDK + CLI) | ~50–100 MB (CLI only) in container; ~100–200 MB (Node.js + SDK) on host |
| **Total memory** | Same (just located differently) | Same total, split across host and container |
| **Startup time** | ~1.5–3s (Node.js boot + SDK init + CLI spawn) | ~1–2s (CLI spawn only); SDK on host is persistent |
| **Latency per request** | ~5–20ms (bridge hop) | ~5–20ms (SDK ↔ CLI TCP hop) |
| **CPU overhead** | Negligible difference | Negligible difference |
| **Debugging** | One process tree in container (simpler) | Split debugging across host and container (harder) |
| **Failure domain** | Container crash = session lost (expected) | Host SDK crash = ALL sessions using that SDK lost |

**Net assessment**: There is no meaningful performance difference between the two approaches. The deciding factors are security and operational simplicity, not performance.

### 3.5 How do systems handle file dependencies between workflow stages?

This is the critical question for GeneratorAI's DAG-based workflow system.

| Pattern | Description | Used By | Pros | Cons |
|---------|-------------|---------|------|------|
| **Shared workspace** | All stages write to the same directory/volume | GitHub Actions (`actions/checkout`), single-container agents | Simple, no explicit file passing | No isolation between stages, race conditions possible |
| **Artifact passing** | Each stage produces artifacts, downstream stages consume them | GitHub Actions (`actions/upload-artifact` / `download-artifact`), CI/CD systems | Explicit, auditable data flow; isolation between stages | Extra I/O for upload/download; must serialize file trees |
| **Conversation context** | The AI model maintains context about what files exist | Copilot SDK (single session mode) | Zero overhead — the model just "remembers" | Only works when stages share the same conversation |
| **Git-based** | Each stage commits to a branch. Downstream stages pull. | Copilot Coding Agent, many CI systems | Natural for code workflows, audit trail | Git overhead, merge conflicts possible |

**Recommendation for GeneratorAI**:

For `single` mode: Stages share one container and one conversation → file dependencies are handled naturally by the shared filesystem and the model's conversation memory.

For `per-stage` / `auto` mode: Use **artifact passing** with these specifics:

```
Stage A completes → Host extracts workspace diff as artifact →
Artifact stored in DB/filesystem → Stage C starts →
Host injects artifact files into Container C's /workspace →
Stage C's system prompt includes: "The following files from previous stages are in /workspace: [list]"
```

This maps cleanly to the existing `ArtifactService` in GeneratorAI's architecture and the `StageRun → Session → Container` lifecycle.

---

## 4. Specific Technical Patterns

### 4.1 Docker-in-Docker Considerations

**Problem**: GeneratorAI's server process manages Docker containers. If the server itself runs in Docker (e.g., for deployment), this requires Docker-in-Docker (DinD) or Docker-out-of-Docker (DooD).

| Approach | How | Pros | Cons |
|----------|-----|------|------|
| **Docker-out-of-Docker (DooD)** | Mount host's Docker socket: `-v /var/run/docker.sock:/var/run/docker.sock` | Simple, uses host's Docker daemon | Session containers are siblings, not children. Security risk: compromised server process can control all Docker on the host. |
| **Docker-in-Docker (DinD)** | Run a Docker daemon inside the server container (requires `--privileged`) | Full isolation — session containers are children of the server's Docker daemon | Requires `--privileged` mode (security concern), more complex setup, storage driver issues |
| **Rootless Docker-in-Docker** | Run rootless Docker daemon inside server container | No `--privileged` needed, better security than DinD | More complex, some Docker features may not work |

**Recommendation**: For GeneratorAI's deployment:
- **Development**: Server runs directly on host → uses host Docker daemon directly (no DinD concern)
- **Production (Docker deployment)**: Use DooD with a restricted Docker socket proxy (e.g., [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)) that only allows container lifecycle operations
- **Production (Kubernetes)**: Use the Kubernetes API to create pods instead of Docker containers

### 4.2 Volume Mounting Strategies for Artifact Extraction

| Strategy | When | Implementation |
|----------|------|---------------|
| **Docker `getArchive` API** | Post-session artifact extraction | `container.getArchive({ path: '/workspace' })` → tar stream → extract on host |
| **Named volume + `docker cp`** | When you need host-accessible file copies | `docker cp container:/workspace/. /host/path/` |
| **Bind mount (read-only input)** | Injecting artifacts from previous stages | `-v /host/artifacts/stage-a:/workspace/stage-a-output:ro` |
| **Ephemeral volume** | Default workspace isolation | Docker-managed volume, destroyed with container |
| **tmpfs mount** | Scratch space, secrets that shouldn't persist | `--tmpfs /tmp:rw,noexec,nosuid,size=256m` |

**Key pattern for multi-stage workflows**:
```
Stage A container: /workspace (ephemeral volume)
  → Stage A completes
  → Host: docker cp containerA:/workspace/output ./artifacts/stage-a/
  → Stage A container destroyed

Stage C container: /workspace (new ephemeral volume)
  → Host: docker cp ./artifacts/stage-a/ containerC:/workspace/input/
  → Stage C prompt includes: "Previous stage output is in /workspace/input/"
  → Stage C executes
```

### 4.3 Network Isolation Approaches in Production

| Level | Implementation | Trade-off |
|-------|---------------|-----------|
| **No restriction** | Default Docker bridge network | Agent can talk to anything — maximum capability, minimum security |
| **Domain allowlist** | iptables/nftables rules + DNS proxy | Blocks most exfiltration vectors; allows necessary APIs |
| **Forward proxy** | Squid/Envoy sidecar with URL allowlist | Deep packet inspection, HTTPS MITM possible | High complexity |
| **Full network isolation** | Docker `--network=none` or `Internal: true` | Maximum security — but breaks any agent that needs network (including Copilot CLI) |

**GeneratorAI's situation**: The Copilot CLI requires HTTPS access to:
- `api.github.com` (Copilot API, GitHub API)
- `copilot-proxy.githubusercontent.com` (model inference)
- `github.com` (git operations)
- Optionally: `registry.npmjs.org`, `pypi.org` (package installs)

**Recommended approach**: Domain allowlist via Docker network + iptables (already planned in SANDBOX_IMPLEMENTATION_PLAN.md §16). The forward proxy approach adds too much complexity for the current phase.

### 4.4 Container Lifecycle: Session vs Workflow

**Current plan (SANDBOX_IMPLEMENTATION_PLAN.md)**: One container per session.

**Refined recommendation based on workflow modes**:

| Workflow Session Mode | Container Lifecycle |
|----------------------|-------------------|
| `single` | One container for the entire workflow run. Container created when workflow starts, destroyed when workflow completes/fails. All stages execute sequentially in this container. |
| `per-stage` | One container per stage. Container created when stage starts, destroyed when stage completes. Artifacts passed between stages via host. |
| `auto` | One container per session (sessions may be shared by chained stages). Container lives as long as its session lives. Parallel stages get parallel containers. |

This maps directly to the relationship: **Container ↔ Session ↔ CopilotClient**. Since each `CopilotClient` instance manages one CLI process, and each container runs one `CopilotClient`, the container lifecycle = session lifecycle.

### 4.5 Reading Files from Previous Stages

**The problem**: In `per-stage` mode, Stage C depends on files written by Stage A. Stage A's container is already destroyed when Stage C starts. How does Stage C see Stage A's files?

**Solution pattern** (used by GitHub Actions, CI/CD systems universally):

```
1. Intercept file-write events during Stage A execution
   → The Copilot CLI emits tool_call events for 'write' operations
   → Bridge captures: { path: '/workspace/src/main.ts', content: '...' }

2. When Stage A completes, extract the workspace:
   → container.getArchive({ path: '/workspace' }) → tar stream
   → Store as workflow run artifact: artifact_store/workflow-run-{id}/stage-a/

3. When Stage C starts, inject Stage A's output:
   → Copy artifacts into Stage C's container: /workspace/deps/stage-a/
   → Add to Stage C's system prompt: 
     "Files from the 'code-generation' stage are available at /workspace/deps/stage-a/"

4. Stage C's Copilot conversation has full context about available files
```

**Implementation detail**: The bridge protocol (§9 of SANDBOX_IMPLEMENTATION_PLAN.md) should add:
- `injectFiles` method: Host → Container, to copy file trees into the container
- `extractWorkspace` method: Host → Container, to retrieve the workspace as a tar stream

---

## 5. Pros/Cons Matrix: SDK-in-Container vs CLI-Only-in-Container

This is the central architectural question. Here's the definitive comparison:

| Criterion | SDK + CLI in Container (Approach B) | CLI Only in Container, SDK on Host (Approach A) |
|-----------|--------------------------------------|------------------------------------------------|
| **Blast-radius isolation** | ✅ **Complete** — all agent code, tool handlers, and file operations in container | ⚠️ **Partial** — SDK tool handlers execute on host. Custom tools, `onPermissionRequest`, MCP handlers all run on host. |
| **Security model** | ✅ **Simple** — "everything dangerous is in the container" | ❌ **Leaky** — must audit every SDK callback to ensure it doesn't touch host resources |
| **SDK code path** | ✅ `useStdio: true` (default, most tested) | ⚠️ `cliUrl` mode (`useStdio: false`) — less tested, designed for debugging |
| **Tool handler safety** | ✅ Tool handlers execute inside container; can call `exec`, write files, etc. safely | ❌ Tool handlers execute on host; any file write or exec is on host filesystem |
| **Memory overhead (per session)** | ~200–300 MB (Node.js + SDK + CLI in container) | ~100 MB in container (CLI) + ~150 MB on host (shared SDK process) |
| **Total memory (N sessions)** | N × 250 MB | N × 100 MB (containers) + 1 × 150 MB (host SDK) — but SDK on host manages N connections concurrently, using ~N × 50 MB for session state |
| **Startup time** | ~2–3s (Node.js boot + SDK + CLI) | ~1–2s (CLI only); SDK on host is persistent |
| **Debugging** | ✅ Single process tree per container; `docker logs` shows everything | ❌ Split across host SDK process and container CLI; correlation by session ID required |
| **Failure domain** | ✅ Container crash = one session lost | ❌ Host SDK crash = ALL sessions lost |
| **SDK version coupling** | ✅ Container pins its own SDK version | ⚠️ Host SDK must be compatible with container CLI version |
| **Custom MCP servers** | ✅ Run inside container (isolated) | ❌ Run on host (if configured in SDK), or require additional forwarding |
| **Network for SDK** | ✅ SDK's outbound calls (model inference) go through container's restricted network | ⚠️ SDK on host has unrestricted network; only CLI's calls go through container network |
| **Auth token scope** | ✅ Token only in container env | ⚠️ Token in host SDK process AND container |
| **Port management** | One port per container (bridge) | One port per container (CLI) — same |
| **Industry precedent** | Codex, Claude Code (Docker mode), Devin, Copilot Coding Agent, Replit, Jules | E2B (different use case: code-execution-as-a-service) |

### Verdict

**SDK + CLI inside container (Approach B)** is the correct choice, and the current SANDBOX_IMPLEMENTATION_PLAN.md makes the right decision. The killer argument remains: **SDK tool handlers execute in the SDK process**. If the SDK runs on the host, every file write, shell command, and git operation triggered by a tool handler happens on the host — the very thing sandboxing is supposed to prevent.

Approach A (CLI-only in container) is only appropriate when the SDK is a *passive observer* that doesn't execute tool handlers — i.e., the E2B model where the SDK sends commands and receives results. But the Copilot SDK is not passive: it actively manages tool execution, MCP servers, custom agents, and permission handlers.

---

## 6. Recommendation: Workflow Multi-Session Sandboxing

### Architecture

```
WorkflowRun (sessionMode: 'per-stage')
├── StageRun A (session-1) ──── Container A
│   ├── CopilotClient + CLI
│   ├── /workspace (ephemeral)
│   └── produces: artifacts/stage-a/
│
├── StageRun B (session-2) ──── Container B (parallel with A)
│   ├── CopilotClient + CLI  
│   ├── /workspace (ephemeral)
│   └── produces: artifacts/stage-b/
│
└── StageRun C (session-3) ──── Container C (after A and B complete)
    ├── CopilotClient + CLI
    ├── /workspace (ephemeral)
    │   └── /deps/stage-a/  ← injected from artifacts
    │   └── /deps/stage-b/  ← injected from artifacts
    └── system prompt: "Files from previous stages are in /workspace/deps/"
```

### Key Design Decisions

1. **Container = Session boundary**: Every `Session` maps to exactly one container. The container lifecycle matches the session lifecycle.

2. **Artifact passing between stages**: When a stage completes, the host extracts the workspace diff and stores it. When a downstream stage starts, the host injects parent artifacts into the container before sending the first prompt.

3. **`single` mode optimization**: When `sessionMode === 'single'`, create ONE container for the workflow run. All stages execute sequentially within that container. The container is destroyed when the workflow run completes.

4. **`auto` mode**: Uses the `canShareSession()` logic from WORKFLOW_ARCHITECTURE.md §8.2. Stages that share a session share a container. Stages that get their own session get their own container.

### Bridge Protocol Extensions

Add these methods to the bridge protocol for multi-stage support:

```typescript
// New bridge methods for multi-stage workflows
| { method: 'injectFiles'; params: { files: { path: string; content: string }[] } }
| { method: 'extractWorkspace'; params: { paths?: string[] } }  // returns tar stream
| { method: 'getWorkspaceFileList'; params: { path?: string } } // returns file tree
```

---

## 7. Recommendation: Chat Session Sandboxing

### Architecture

```
Chat 1 → Session 1 → Container 1
Chat 2 → Session 2 → Container 2
Chat 3 → Session 3 → Container 3
Chat 4 → Session 4 → Container 4
Chat 5 → Session 5 → Container 5
```

### Key Design Decisions

1. **One container per chat**: Complete isolation. Each chat gets its own workspace, process tree, and network namespace.

2. **Container lifecycle = chat lifecycle**: Container created when chat is created, destroyed when chat is archived.

3. **No container sharing between chats**: Even if two chats work on the same repo, they get separate containers with separate clones. This prevents cross-chat contamination.

4. **Pool pre-warming**: The pool should maintain at least 2–3 warm containers at all times (configurable). When a user opens a new chat, a warm container is claimed instantly.

5. **Resource limits per chat container**: Default 2 CPU cores, 4 GB RAM, 256 PIDs. These can be adjusted for resource-constrained environments.

### Memory Budget (5 concurrent chats)

| Component | Per Container | 5 Containers |
|-----------|--------------|-------------|
| Node.js runtime | ~50 MB | 250 MB |
| Copilot SDK | ~30 MB | 150 MB |
| Copilot CLI process | ~100 MB | 500 MB |
| Workspace (repo clone) | ~50–200 MB | 250 MB–1 GB |
| **Total** | **~250–400 MB** | **~1.2–2 GB** |

This is acceptable for both server and desktop deployments (most machines have 16+ GB RAM).

---

## 8. Artifact Extraction Best Practices

### Recommended Multi-Layer Approach

| Layer | When | Method | What's Captured |
|-------|------|--------|----------------|
| **Real-time event capture** | During session execution | Bridge intercepts `assistant.tool_call` events for `write` tool | File path + content for each write |
| **Post-session workspace extraction** | When session/stage completes | `container.getArchive({ path: '/workspace' })` | Full workspace as tar archive |
| **Git-based extraction** | When session has a repo configured | Agent `git commit` + `git push` inside container | Commit SHA recorded as artifact |

### Implementation Sketch

```typescript
// ArtifactExtractionService (new service)
class ArtifactExtractionService {
  /**
   * Extract all modified files from a container's workspace.
   * Called when a stage or chat session completes.
   */
  async extractWorkspace(
    containerId: string,
    sessionId: string,
    contextId: string, // chatId or stageRunId
  ): Promise<Artifact[]> {
    const container = this.docker.getContainer(containerId);
    
    // 1. Get the workspace as a tar archive
    const archiveStream = await container.getArchive({ path: '/workspace' });
    const files = await extractTar(archiveStream);
    
    // 2. Create artifacts for each file
    const artifacts: Artifact[] = [];
    for (const file of files) {
      if (file.type === 'file') {
        artifacts.push({
          id: generateId(),
          sessionId,
          contextType: getContextType(contextId),
          contextId,
          fileName: file.path,
          content: file.content,
          mimeType: getMimeType(file.path),
          createdAt: new Date(),
        });
      }
    }
    
    return artifacts;
  }
  
  /**
   * Inject artifacts from previous stages into a container.
   * Called when a downstream stage starts.
   */
  async injectArtifacts(
    containerId: string,
    artifacts: Artifact[],
    targetDir: string = '/workspace/deps',
  ): Promise<void> {
    const bridge = this.getBridge(containerId);
    
    await bridge.call('injectFiles', {
      files: artifacts.map(a => ({
        path: `${targetDir}/${a.fileName}`,
        content: a.content,
      })),
    });
  }
}
```

### Key Considerations

1. **Extract before destroy**: Always extract artifacts BEFORE destroying the container. Add this to the session completion flow.

2. **Size limits**: Set a maximum artifact size (e.g., 50 MB per artifact, 500 MB per stage). Reject oversized files with a warning.

3. **Binary files**: Use tar archives for binary artifacts (images, compiled files). Store as base64 in the artifact database or as files on disk.

4. **Idempotent extraction**: Extracting artifacts should be idempotent — if called twice, the second call overwrites the first. This handles retry scenarios.

5. **Selective extraction**: For large workspaces, extract only modified files. Use `git diff --name-only` inside the container to identify changed files, then extract only those.

---

## 9. Gaps & Issues in the Current SANDBOX_IMPLEMENTATION_PLAN.md

### Gap 1: Multi-Stage Artifact Passing Not Addressed

**Issue**: SANDBOX_IMPLEMENTATION_PLAN.md designs the container at the session level but does not address how files flow between stages in `per-stage` or `auto` modes. The bridge protocol (§9) has `cloneRepo` and `getWorkspacePath` but no `injectFiles` or `extractWorkspace` methods.

**Impact**: Workflow runs in `per-stage` mode would fail — Stage C would start in an empty container with no access to files produced by Stages A and B.

**Recommendation**: Add `injectFiles` and `extractWorkspace` to the bridge protocol. Add an `ArtifactExtractionService` that integrates with the `StageExecutionService` completion flow.

### Gap 2: Container Lifecycle for `single` Session Mode

**Issue**: The plan says "1 Docker container per session" but doesn't clarify what happens when `sessionMode === 'single'` where all stages share one session. Does the container survive across all stages?

**Clarification needed**: In `single` mode, the container should be created when the first stage starts and destroyed when the last stage completes. The session (and its container) spans the entire workflow run.

### Gap 3: Container Pool Recycling vs Ephemeral

**Issue**: The plan states containers are ephemeral (§14.3 decision: "Ephemeral — Security trumps the 3-second overhead"), but the `ContainerPool.release()` method in §14.2 calls `this.containerPool.release(session.containerId)` which implies returning to the pool. The `release()` implementation then calls `this.manager.destroyContainer(containerId)` and replenishes.

**Clarification**: This is actually consistent — "release" means "destroy and replace" not "return to pool." But the naming is confusing. Consider renaming to `releaseAndDestroy()` to make intent clear.

### Gap 4: Windows Docker Desktop Performance

**Issue**: The risk register (§21) mentions "Windows Docker Desktop performance" as a medium-likelihood/medium-impact risk, but no mitigation is provided.

**Details**: Docker Desktop on Windows runs containers inside a WSL2 (or Hyper-V) Linux VM. This adds ~1–3 seconds of overhead per container operation compared to native Linux. The pre-warming pool should absorb this, but testing is needed.

**Recommendation**: Add specific performance benchmarks for Windows Docker Desktop in the testing strategy. Consider increasing the minimum pool size on Windows (e.g., 3 instead of 2).

### Gap 5: Bridge Connection Resilience

**Issue**: The `ContainerBridge.ts` connects to the container's TCP port, but there's no reconnection strategy if the connection drops (e.g., container pauses, network hiccup). The risk register mentions "Bridge TCP connection drops" but the bridge implementation doesn't show reconnection logic.

**Recommendation**: Add exponential-backoff reconnection to `ContainerBridge.ts`. If reconnection fails after N attempts, transition the session to `error` state.

### Gap 6: Container Stdout/Stderr Logging

**Issue**: The bridge protocol handles structured JSON-RPC messages, but the container also produces unstructured output (SDK debug logs, CLI stderr, git output). The plan doesn't address how this unstructured output is captured and forwarded.

**Recommendation**: In the container entrypoint, redirect SDK/CLI stdout/stderr to a log file inside the container AND forward structured log lines through bridge notifications. Use Docker's built-in logging driver (`json-file`) as a fallback — the host can read container logs via `container.logs()`.

### Gap 7: Concurrent Container Limit Enforcement

**Issue**: The pool has a `maxPoolSize` but there's no enforcement of maximum total concurrent containers (pooled + claimed). If the server rapidly creates sessions, it could exceed the Docker host's resource capacity.

**Recommendation**: Add a hard cap on total containers (pooled + claimed). When the cap is reached, new session creation should queue (with a timeout) rather than fail immediately.

### Gap 8: Health Check Robustness

**Issue**: The health check in the Dockerfile uses `node /opt/bridge/health.js` but the bridge listens on a TCP socket (JSON-RPC), not HTTP. The `curl -f http://localhost:9222/health` in the CONTAINER_SANDBOXING_RESEARCH.md health check won't work with a raw TCP server.

**Recommendation**: Either (a) add an HTTP health endpoint to the bridge (separate from the JSON-RPC TCP socket), or (b) use a TCP-based health check script that sends a JSON-RPC `ping` request and checks the response.

### Gap 9: Graceful Shutdown Ordering

**Issue**: When the GeneratorAI server shuts down, it must destroy all containers. The `ContainerizedCopilotAdapter.shutdown()` method destroys containers, but the ordering relative to database persistence and SSE stream closure is not defined.

**Recommendation**: Define the shutdown sequence:
1. Stop accepting new sessions
2. Send `shutdown` command to all active bridges (gracefully stop Copilot conversations)
3. Extract artifacts from any sessions that completed but haven't been extracted yet
4. Destroy all containers (with a timeout)
5. Drain the container pool
6. Close database connections
7. Close SSE streams

### Gap 10: No Monitoring of Container Resource Usage at Runtime

**Issue**: The plan mentions container metrics (§17.1) but doesn't integrate them into the existing monitoring/health infrastructure. There's no alerting when a container approaches its memory or CPU limit.

**Recommendation**: Poll container stats periodically (every 30s) via `container.stats()` and emit metrics to the existing logging/observability system. Alert when memory usage exceeds 80% of the limit.

---

## 10. Summary of Industry Convergence Points

```
┌────────────────────────────────────────────────────────────────────────┐
│  INDUSTRY CONSENSUS FOR AUTONOMOUS AI CODING AGENTS (2024-2026):       │
│                                                                         │
│  1. Agent runtime goes INSIDE the sandbox (not just execution)          │
│     → Codex, Claude Code, Devin, Copilot Coding Agent, Jules, Q Dev    │
│                                                                         │
│  2. One sandbox per unit-of-work (task/session/stage)                   │
│     → NOT shared across sessions (except when explicitly sequential)    │
│                                                                         │
│  3. Ephemeral by default (clean state per session)                      │
│     → No state leakage between sessions                                │
│                                                                         │
│  4. The sandbox IS the security boundary                                │
│     → Auto-approve all tool calls inside the sandbox                    │
│     → Don't rely on permission systems as security controls             │
│                                                                         │
│  5. Docker containers for single-tenant / dev; Firecracker for cloud    │
│     → Docker sufficient for GeneratorAI's deployement model             │
│                                                                         │
│  6. Pre-warming / pooling for sub-3s startup                            │
│     → Without pooling, Docker startup is 3-10s (unacceptable UX)        │
│                                                                         │
│  7. Restrict network egress to allowlisted domains                      │
│     → Never give containers full internet access                        │
│                                                                         │
│  8. File/artifact passing between stages via the host (not shared fs)   │
│     → Extract → Store → Inject pattern; host is the intermediary        │
│                                                                         │
│  9. Communication: lightweight bidirectional protocol                    │
│     → JSON-RPC, WebSocket, or gRPC — NOT REST                          │
│                                                                         │
│  10. Event streaming from sandbox to host for real-time UI updates      │
│      → Mandatory for any interactive or progress-tracking UX            │
└────────────────────────────────────────────────────────────────────────┘
```

### GeneratorAI's Current Plan vs Industry Best Practice

| Decision | Current Plan | Industry Best Practice | Alignment |
|----------|-------------|----------------------|-----------|
| Isolation technology | Docker (runc) | Docker or Firecracker | ✅ Aligned |
| Agent placement | SDK + CLI inside container | Agent inside sandbox | ✅ Aligned |
| Container per | Session | Task/session | ✅ Aligned |
| Communication | JSON-RPC over TCP | Various lightweight protocols | ✅ Aligned |
| Ephemeral containers | Yes (destroy after use) | Yes | ✅ Aligned |
| Pre-warming pool | Yes (min 2, max configurable) | Yes | ✅ Aligned |
| Network restriction | Domain allowlist | Domain allowlist or full isolation | ✅ Aligned |
| Auto-approve tools | Yes (inside container) | Yes | ✅ Aligned |
| Artifact extraction | `docker cp` before destroy | Various (docker cp, git push, API) | ✅ Aligned |
| Multi-stage file passing | ❌ **Not addressed** | Host-mediated artifact passing | ⚠️ **Gap** |
| `single` mode container lifecycle | ❌ **Ambiguous** | One container for full workflow run | ⚠️ **Gap** |
| Bridge reconnection | ❌ **Not implemented** | Reconnection with backoff | ⚠️ **Gap** |
| Graceful shutdown ordering | ❌ **Not defined** | Defined shutdown sequence | ⚠️ **Gap** |
| Container resource monitoring | Mentioned but not integrated | Integrated with alerting | ⚠️ **Gap** |

### Final Assessment

GeneratorAI's SANDBOX_IMPLEMENTATION_PLAN.md is **architecturally sound** and **well-aligned with industry practice**. The core decisions (SDK inside container, ephemeral containers, JSON-RPC bridge, pre-warmed pool, domain-allowlisted network) match what every major production coding agent has converged on.

The primary gaps are in **multi-stage workflow support** (artifact passing between stages), **operational resilience** (bridge reconnection, graceful shutdown ordering), and **runtime monitoring** (container resource alerting). These are addressable within the existing architecture without requiring design changes — they are implementation gaps, not architectural gaps.

---

*End of research report.*
