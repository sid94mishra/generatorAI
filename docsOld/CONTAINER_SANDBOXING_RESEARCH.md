# Container Sandboxing Research for GeneratorAI

> **Author**: Senior Infrastructure/Platform Engineer  
> **Date**: March 3, 2026  
> **Status**: Research Report — Pre-Implementation  
> **Scope**: Sandboxed container architecture for AI coding agent sessions using the GitHub Copilot SDK

---

## Executive Summary

GeneratorAI currently runs all Copilot CLI sessions in the host process, sharing a single filesystem namespace. This report researches how modern AI coding agents implement session isolation and recommends a container-based sandbox architecture where each session gets an isolated Docker container with the Copilot CLI running inside, events streaming back to the host server over a lightweight transport, and the host managing lifecycle and persistence in SQLite.

**Key recommendation**: Docker containers, one per session, managed by a container pool with pre-warmed instances, communicating with the host over a Unix socket or TCP bridge. The Copilot SDK's `useStdio: false` (TCP) mode or the `cliUrl` option enables the host to connect to a CLI server running inside the container.

---

## Table of Contents

1. [How Modern Coding Agents Implement Sandboxing](#1-how-modern-coding-agents-implement-sandboxing)
2. [Container-Based Sandboxing Approaches](#2-container-based-sandboxing-approaches)
3. [Key Technical Considerations](#3-key-technical-considerations)
4. [Architecture Patterns](#4-architecture-patterns)
5. [Security Model](#5-security-model)
6. [SDK-Specific Considerations](#6-sdk-specific-considerations)
7. [Recommended Architecture for GeneratorAI](#7-recommended-architecture-for-generatorai)
8. [Implementation Roadmap](#8-implementation-roadmap)

---

## 1. How Modern Coding Agents Implement Sandboxing

### 1.1 Devin by Cognition

Devin runs each coding session in a **full cloud-hosted VM** (not just a container). Each session gets:

- **Dedicated virtual machine** with a full Linux desktop environment (accessible via browser-based VNC/noVNC)
- **Persistent filesystem** — the VM's disk survives session pauses (snapshots/EBS-style volumes)
- **Full network access** — Devin can browse the web, run servers, install packages, and SSH into external systems
- **Shell + browser + editor** — the VM runs VS Code Server, a Chromium browser, and full shell access
- **Isolation model**: hypervisor-level (likely Firecracker or KVM-based microVMs on AWS infrastructure)
- **Session lifecycle**: VMs are provisioned on-demand, snapshot on pause, and destroyed on session end

**Key takeaway**: Devin prioritizes *capability* over startup speed. VMs take 10-30 seconds to provision, but provide the strongest isolation and most complete environment. This approach is appropriate for long-running autonomous sessions (hours), not interactive sub-second responses.

### 1.2 Codex by OpenAI

OpenAI Codex (the agent, not the legacy model) uses a **Firecracker microVM** approach:

- **Firecracker microVMs** — the same technology AWS Lambda uses, providing VM-level isolation with container-like startup times (~125ms for the VM)
- **Read-only root filesystem** with an overlay for session writes
- **Network-isolated** — no outbound internet access during code execution (pre-installs dependencies in the image build phase)
- **Ephemeral** — each task gets a fresh microVM; no state persists between tasks
- **Resource-capped** — fixed CPU and memory allocations per VM
- **Pre-built environments** — Codex pre-bakes language runtimes, tools, and project dependencies into VM images

**Key takeaway**: Codex optimizes heavily for **security** (no network in execution) and **reproducibility** (identical environments). The Firecracker approach gives near-container startup speeds with full VM isolation. This is the gold standard for untrusted code execution.

### 1.3 GitHub Copilot Workspace

GitHub Copilot Workspace takes a different approach:

- **No local sandbox** — Copilot Workspace operates on a *plan* and *diff* model, generating code changes as patches
- **Codespace integration** — when users want to test/run code, they spin up a GitHub Codespace (which is a Docker container on a VM, managed by GitHub)
- **Server-side processing** — the AI reasoning happens on GitHub's infrastructure; only the resulting diffs are shown to the user
- **Copilot Coding Agent** (newer) runs inside a **GitHub Actions runner**, which is effectively a fresh Docker container or VM for each task

**Key takeaway**: GitHub separates AI reasoning (server-side, no sandbox needed) from code execution (Codespaces/Actions). For GeneratorAI, this validates the pattern of running the AI orchestration on the host and isolating code-touching operations in containers.

### 1.4 Cursor and Windsurf

Cursor and Windsurf operate as **local IDE extensions**, not cloud services:

- **No sandbox** — they run AI-generated code changes directly in the user's local workspace
- **Process-level isolation** — shell commands run as child processes of the editor, inheriting the user's permissions
- **User-trusts-agent model** — the user reviews and accepts changes in the editor UI
- **Cursor's "Shadow Workspace"** — Cursor maintains a hidden VS Code workspace for type-checking generated code without affecting the user's view, but this is not a security sandbox

**Key takeaway**: Local IDE tools can afford to skip sandboxing because the user is present and reviewing each change. Autonomous agents (like GeneratorAI) that run unattended cannot rely on this model.

### 1.5 Replit Agent

Replit Agent uses Replit's existing **container infrastructure**:

- **Nix-based containers** — each Replit runs in an OCI container built with Nix for reproducible environments
- **gVisor runtime** — Replit uses gVisor (Google's container sandbox runtime `runsc`) as the OCI runtime instead of `runc`, adding syscall-level isolation
- **Persistent per-project containers** — unlike ephemeral per-session models, Replit keeps the container alive across interactions
- **PID/network namespaces** — each container gets its own process tree and network namespace
- **Resource limits via cgroups v2** — CPU, memory, and disk I/O are capped
- **File watching** — Replit streams filesystem changes from the container to the browser-based IDE using a custom protocol

**Key takeaway**: Replit demonstrates that gVisor-backed containers can provide strong isolation with acceptable performance. The file-watching/streaming pattern is directly relevant to GeneratorAI's need to stream events from containers.

### 1.6 Claude Code and Gemini CLI

Both are **local CLI tools** with process-level isolation:

- **Claude Code** runs as a Node.js CLI process in the user's terminal, executing tools (shell commands, file edits) as child processes. It has a permission system where the user approves dangerous operations. No container sandboxing.
- **Gemini CLI** (Google) follows the same model — local CLI, child process execution, user approval for mutations.
- Both support **"headless" / non-interactive modes** where they can run autonomously, but explicitly warn about the security implications.
- **Docker mode**: Claude Code can optionally be run *inside* a Docker container by the user, which provides isolation from the host system. The official docs suggest: `docker run -it -v $(pwd):/workspace anthropic/claude-code`

**Key takeaway**: CLI agents rely on user trust for security. When running autonomously (which is GeneratorAI's use case), wrapping them in containers is the recommended pattern — Claude Code's own documentation suggests this.

---

## 2. Container-Based Sandboxing Approaches

### 2.1 Comparison Matrix

| Technology | Isolation Level | Startup Time | Overhead | Complexity | Best For |
|---|---|---|---|---|---|
| **Docker (runc)** | Namespace/cgroup | 0.5-2s | Low | Low | General workloads |
| **Docker (gVisor)** | Syscall interception | 0.5-2s | Medium (5-15% perf) | Low-Medium | Untrusted code |
| **Firecracker microVM** | Full VM (KVM) | ~125ms | Very Low | High | Multi-tenant / Lambda |
| **Kata Containers** | Lightweight VM | 1-3s | Medium | High | Strong isolation needs |
| **gVisor standalone** | Syscall interception | <1s | Medium | Medium | Google-scale multi-tenant |
| **nsjail** | Namespace + seccomp | <100ms | Very Low | Medium | Lightweight sandboxing |
| **E2B** | Cloud VM (managed) | 1-3s | High (network RTT) | Low (SaaS) | Quick prototyping |
| **Daytona** | Dev environments | 5-15s | Medium | Medium | Full dev environments |

### 2.2 Docker Container Per Session (Recommended for GeneratorAI)

The most practical approach for GeneratorAI's requirements:

```
┌──────────────────────────────────────────────────────┐
│                  HOST SERVER                          │
│                                                      │
│  GeneratorAI Server (Express/Fastify)                │
│  ├── SessionService                                  │
│  ├── ContainerManager                                │
│  │   ├── create(sessionId) → container ID            │
│  │   ├── start(containerId)                          │
│  │   ├── stop(containerId)                           │
│  │   ├── destroy(containerId)                        │
│  │   └── exec(containerId, command)                  │
│  ├── ContainerPool (pre-warmed containers)           │
│  ├── EventBridge (container ⟷ host)                  │
│  └── SQLite DB                                       │
│                                                      │
│  ┌────────────────────┐  ┌────────────────────┐      │
│  │  Session Container │  │  Session Container │      │
│  │  ┌──────────────┐  │  │  ┌──────────────┐  │      │
│  │  │ Copilot CLI  │  │  │  │ Copilot CLI  │  │      │
│  │  │ (agent proc) │  │  │  │ (agent proc) │  │      │
│  │  └──────┬───────┘  │  │  └──────┬───────┘  │      │
│  │         │events    │  │         │events    │      │
│  │  ┌──────▼───────┐  │  │  ┌──────▼───────┐  │      │
│  │  │ Event Bridge │  │  │  │ Event Bridge │  │      │
│  │  │ (sidecar/    │  │  │  │ (sidecar/    │  │      │
│  │  │  TCP)        │  │  │  │  TCP)        │  │      │
│  │  └──────────────┘  │  │  └──────────────┘  │      │
│  │  /workspace (vol)  │  │  /workspace (vol)  │      │
│  └────────────────────┘  └────────────────────┘      │
└──────────────────────────────────────────────────────┘
```

**Advantages**:
- Docker is universally available and well-understood
- Sub-second startup with pre-pulled images
- Native cgroup resource limits
- Volume mounts for workspace data
- Network namespace isolation
- Mature ecosystem (monitoring, logging, orchestration)

**Disadvantages**:
- `runc` isolation is namespace-based, not VM-level (container escapes are possible, though rare with hardening)
- Shared kernel with host (mitigated with seccomp/AppArmor)
- Docker daemon is a single point of failure

### 2.3 Firecracker MicroVMs

If GeneratorAI ever needs multi-tenant cloud deployment with untrusted users:

```
Host (KVM-enabled)
├── Firecracker VMM process (per session)
│   ├── Guest kernel (lightweight Linux)
│   ├── Root filesystem (read-only squashfs + overlay)
│   ├── Copilot CLI process
│   └── Event bridge agent
├── Firecracker API (Unix socket)
└── GeneratorAI server (manages VMM processes)
```

**When to use**: Only if GeneratorAI moves to a multi-tenant cloud model where sessions run untrusted user code. The operational complexity is significantly higher than Docker.

### 2.4 gVisor (Runtime Swap)

gVisor can be used as a **drop-in replacement** for Docker's default runtime (`runc`):

```bash
# Install gVisor runtime
sudo runsc install

# Configure Docker to use gVisor
# /etc/docker/daemon.json
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc"
    }
  }
}

# Run container with gVisor
docker run --runtime=runsc generatorai/session:latest
```

**When to use**: When you want stronger isolation than `runc` without the complexity of Firecracker. gVisor intercepts all syscalls, preventing direct kernel interaction. 5-15% performance overhead is acceptable for AI agent workloads (which are I/O and network-bound, not compute-bound).

### 2.5 E2B (Managed Sandboxes)

E2B provides a managed API for cloud sandboxes:

```typescript
import { Sandbox } from '@e2b/sdk';

const sandbox = await Sandbox.create({
  template: 'generatorai-session',
  apiKey: process.env.E2B_API_KEY,
});

// Run Copilot CLI inside
const proc = await sandbox.process.start({
  cmd: 'copilot-cli --session-id abc123',
  onStdout: (data) => eventBus.emit(sessionId, parseEvent(data)),
});

// Filesystem operations
await sandbox.filesystem.write('/workspace/main.ts', code);
const files = await sandbox.filesystem.list('/workspace');

// Cleanup
await sandbox.close();
```

**When to use**: For rapid prototyping or as a managed alternative to self-hosted Docker. Adds network latency and API costs. Not recommended for production GeneratorAI due to latency and cost.

### 2.6 nsjail (Lightweight Process Sandbox)

nsjail provides namespace + seccomp sandboxing without Docker overhead:

```bash
nsjail \
  --mode o \
  --chroot /var/sessions/abc123/rootfs \
  --user 1000 --group 1000 \
  --rlimit_as 2048 \
  --rlimit_cpu 300 \
  --rlimit_fsize 1024 \
  --net eth0 \
  --cgroup_mem_max 2147483648 \
  --cgroup_pids_max 256 \
  -- /usr/bin/node /app/copilot-cli/index.js
```

**When to use**: When Docker is too heavy and you need ultra-fast (<100ms) process-level sandboxing. Good for burst workloads. Downside: no OCI image ecosystem, manual rootfs management.

---

## 3. Key Technical Considerations

### 3.1 Running a CLI Process (Copilot CLI) Inside a Docker Container

The Copilot CLI is a Node.js process. There are two modes of running it inside a container:

#### Option A: CLI as Container Entrypoint (Recommended)

The CLI starts when the container starts and remains running for the session's lifetime:

```dockerfile
# Dockerfile.session
FROM node:22-slim

# Install git and build essentials
RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Copilot CLI globally
RUN npm install -g @github/copilot-cli@latest

# Create workspace directory
RUN mkdir -p /workspace && chown 1000:1000 /workspace

# Create non-root user
RUN useradd -m -u 1000 -s /bin/bash agent
USER agent

WORKDIR /workspace

# The entrypoint starts a small Node.js bridge that:
# 1. Starts the Copilot CLI
# 2. Exposes a TCP server for control commands
# 3. Streams events to the host via TCP/Unix socket
COPY --chown=agent:agent bridge/ /app/bridge/
ENTRYPOINT ["node", "/app/bridge/entrypoint.js"]
```

#### Option B: CLI Started via Docker Exec

Start a bare container, then exec the CLI into it:

```typescript
// Host-side: start bare container, then exec CLI
const container = await docker.createContainer({
  Image: 'generatorai/session:latest',
  Cmd: ['sleep', 'infinity'], // Keep alive
  // ...
});
await container.start();

// Later, exec Copilot CLI into the running container
const exec = await container.exec({
  Cmd: ['node', '/usr/local/bin/copilot-cli', '--tcp', '--port', '9222'],
  AttachStdin: true,
  AttachStdout: true,
  AttachStderr: true,
});
const stream = await exec.start({ hijack: true, stdin: true });
```

**Recommendation**: Option A (entrypoint) is cleaner; the container is purpose-built for the session and the lifecycle is simpler.

### 3.2 Mounting/Cloning Repos into the Container Filesystem

Three approaches, each with tradeoffs:

#### Approach 1: Clone Inside the Container (Recommended)

```typescript
// Host-side: pass repo URL and token as env vars
const container = await docker.createContainer({
  Image: 'generatorai/session:latest',
  Env: [
    `REPO_URL=https://github.com/user/repo.git`,
    `REPO_BRANCH=main`,
    `GIT_TOKEN=${session.gitToken}`, // Short-lived token
  ],
  HostConfig: {
    // Named volume for workspace data (survives container restart)
    Binds: [`generatorai-session-${sessionId}:/workspace`],
  },
});
```

```bash
# Inside container entrypoint.sh
git clone --depth 1 --branch $REPO_BRANCH \
  https://x-access-token:${GIT_TOKEN}@github.com/${REPO_URL#https://github.com/} \
  /workspace/repo
```

**Pros**: Container has full git access for commits/pushes. Isolation is complete.
**Cons**: Clone time adds to session startup (mitigated by shallow clones, pre-warmed containers).

#### Approach 2: Bind-Mount from Host

```typescript
const container = await docker.createContainer({
  HostConfig: {
    Binds: [
      `${hostWorkspacePath}:/workspace:rw`,
    ],
  },
});
```

**Pros**: Instant access to files (no clone time).
**Cons**: Breaks isolation — container writes affect host filesystem. The host must pre-clone the repo. Multiple sessions could conflict.

#### Approach 3: Copy-on-Write Volume

```typescript
// Create a thin snapshot of a base volume
await docker.createVolume({ Name: `session-${sessionId}` });
// Use Docker's --volumes-from to copy a cached base
```

**Pros**: Fast startup with isolation.
**Cons**: More complex volume management.

**Recommendation**: Clone inside the container (Approach 1) for full isolation. Use shallow clones (`--depth 1`) and a container pool to absorb clone time.

### 3.3 Streaming Events from Container to Host

This is critical for GeneratorAI's architecture. The host server must receive `AgentEvent` objects from the Copilot CLI running inside the container.

#### Method 1: TCP Socket (Recommended)

```
┌─────────────────┐        TCP :9222         ┌─────────────────┐
│  Host Server    │◀─────────────────────────│  Container      │
│                 │                           │                 │
│  EventBridge    │   JSON-delimited stream   │  Copilot CLI    │
│  (TCP client)   │   of AgentEvent objects   │  → TCP server   │
│                 │                           │                 │
│  Listens to     │                           │  Pushes events  │
│  container port │                           │  to socket      │
└─────────────────┘                           └─────────────────┘
```

Implementation inside the container:

```typescript
// bridge/event-server.ts (runs inside container)
import { createServer } from 'net';

const server = createServer((socket) => {
  // This socket receives events from the Copilot CLI process
  // and forwards them to the connected host client
  
  copilotProcess.on('event', (event: AgentEvent) => {
    socket.write(JSON.stringify(event) + '\n');
  });
  
  socket.on('data', (data) => {
    // Host can send control commands back
    const command = JSON.parse(data.toString());
    handleControlCommand(command);
  });
});

server.listen(9222, '0.0.0.0');
```

Host-side:

```typescript
// ContainerEventBridge.ts (runs on host)
import { connect } from 'net';

class ContainerEventBridge {
  connect(containerId: string, containerPort: number): void {
    const containerIp = await this.getContainerIp(containerId);
    const socket = connect(containerPort, containerIp);
    
    const lineBuffer = new LineBuffer();
    socket.on('data', (chunk) => {
      for (const line of lineBuffer.push(chunk)) {
        const event: AgentEvent = JSON.parse(line);
        this.eventBus.emit(event.sessionId, event);
      }
    });
  }
}
```

#### Method 2: Unix Domain Socket (via Shared Volume)

```typescript
// Host creates a temporary directory for the socket
const socketDir = `/tmp/generatorai/sessions/${sessionId}`;
mkdirSync(socketDir, { recursive: true });

const container = await docker.createContainer({
  HostConfig: {
    Binds: [`${socketDir}:/run/bridge:rw`],
  },
});

// Container writes to /run/bridge/events.sock
// Host connects to ${socketDir}/events.sock
```

**Pros**: No network exposure, slightly faster than TCP.
**Cons**: Requires shared volume mount.

#### Method 3: Docker Attach (stdout/stderr Streaming)

```typescript
const container = docker.getContainer(containerId);
const stream = await container.attach({
  stream: true, stdout: true, stderr: true,
});

stream.on('data', (chunk) => {
  // Parse structured event data from stdout
  const event = parseEvent(chunk.toString());
  eventBus.emit(sessionId, event);
});
```

**Pros**: Simplest — no extra ports or sockets.
**Cons**: Mixes logs with events unless using structured output. The Copilot CLI writes its own logs to stdout, so you'd need a wrapper to separate event data from log data.

**Recommendation**: TCP socket (Method 1) for clean separation. The container bridge exposes a known port, and the host connects to it. This aligns well with the Copilot SDK's `useStdio: false` mode.

### 3.4 Network Isolation

```typescript
// Create a restricted Docker network
await docker.createNetwork({
  Name: 'generatorai-sessions',
  Driver: 'bridge',
  Internal: false, // Allow outbound (needed for GitHub API)
  Options: {
    'com.docker.network.bridge.enable_icc': 'false', // No inter-container communication
  },
});

// Container creation
const container = await docker.createContainer({
  HostConfig: {
    NetworkMode: 'generatorai-sessions',
    // DNS restricted to GitHub API domains only
    Dns: ['8.8.8.8'], // Or internal DNS that resolves only allowed domains
  },
});
```

For fine-grained network control, use iptables rules in the container's network namespace:

```bash
# Allow only GitHub API and Copilot endpoints
iptables -A OUTPUT -d api.github.com -j ACCEPT
iptables -A OUTPUT -d copilot-proxy.githubusercontent.com -j ACCEPT
iptables -A OUTPUT -d github.com -j ACCEPT
iptables -A OUTPUT -d *.actions.githubusercontent.com -j ACCEPT
# Allow DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
# Block everything else
iptables -A OUTPUT -j DROP
```

Alternatively, use a **Squid forward proxy** as a sidecar:

```yaml
# docker-compose.yml (per-session)
services:
  session:
    image: generatorai/session:latest
    network_mode: "service:proxy"
    depends_on: [proxy]
  
  proxy:
    image: generatorai/proxy:latest
    environment:
      ALLOWED_DOMAINS: "api.github.com,copilot-proxy.githubusercontent.com,github.com"
```

### 3.5 File System Isolation and Volume Mounts

```typescript
const container = await docker.createContainer({
  Image: 'generatorai/session:latest',
  HostConfig: {
    // Named volume for workspace (persists across container restarts)
    Binds: [
      `session-${sessionId}-workspace:/workspace:rw`,
    ],
    // Tmpfs for temporary files (in-memory, auto-cleaned)
    Tmpfs: {
      '/tmp': 'rw,noexec,nosuid,size=512m',
    },
    // Read-only root filesystem
    ReadonlyRootfs: true,
    // Writable directories via volumes
    // /workspace — code
    // /tmp — scratch space
    // /home/agent — user home (for git config, npm cache)
  },
});
```

### 3.6 Resource Limits

```typescript
const container = await docker.createContainer({
  HostConfig: {
    // CPU: 2 cores max (in CPU quota terms: 200000 microseconds per 100000 period)
    CpuQuota: 200000,
    CpuPeriod: 100000,
    
    // Memory: 4GB max (hard limit), 3GB soft limit
    Memory: 4 * 1024 * 1024 * 1024,        // 4GB
    MemoryReservation: 3 * 1024 * 1024 * 1024, // 3GB soft
    MemorySwap: 4 * 1024 * 1024 * 1024,     // No swap (same as memory)
    
    // PIDs: max 512 processes
    PidsLimit: 512,
    
    // IO: limit disk write speed
    BlkioDeviceWriteBps: [{ Path: '/dev/sda', Rate: 50 * 1024 * 1024 }], // 50MB/s
    
    // Storage: limit container writable layer
    StorageOpt: { size: '10G' }, // Requires overlay2 + xfs or device-mapper
    
    // Disable OOM kill (we want to handle this gracefully)
    OomKillDisable: false,
    OomScoreAdj: 500, // Higher score = more likely to be killed under pressure
  },
});
```

### 3.7 Container Lifecycle Management

```typescript
// ContainerManager.ts — container CRUD and lifecycle
import Docker from 'dockerode';

export class ContainerManager {
  private docker = new Docker();
  private containers = new Map<string, Docker.Container>();
  
  async create(sessionId: string, config: SessionContainerConfig): Promise<string> {
    const container = await this.docker.createContainer({
      name: `generatorai-session-${sessionId}`,
      Image: config.image ?? 'generatorai/session:latest',
      Env: [
        `SESSION_ID=${sessionId}`,
        `GITHUB_TOKEN=${config.githubToken}`,
        `REPO_URL=${config.repoUrl ?? ''}`,
        `REPO_BRANCH=${config.repoBranch ?? 'main'}`,
        `BRIDGE_PORT=9222`,
      ],
      ExposedPorts: { '9222/tcp': {} },
      HostConfig: {
        AutoRemove: false,
        // ... resource limits, volumes, network config
        PortBindings: {
          '9222/tcp': [{ HostPort: '0' }], // Dynamic port allocation
        },
      },
      Labels: {
        'generatorai.session': sessionId,
        'generatorai.created': new Date().toISOString(),
      },
    });
    
    this.containers.set(sessionId, container);
    return container.id;
  }
  
  async start(sessionId: string): Promise<{ bridgePort: number }> {
    const container = this.containers.get(sessionId);
    if (!container) throw new Error(`No container for session ${sessionId}`);
    
    await container.start();
    
    // Get the dynamically assigned host port
    const info = await container.inspect();
    const bridgePort = parseInt(
      info.NetworkSettings.Ports['9222/tcp']?.[0]?.HostPort ?? '0'
    );
    
    return { bridgePort };
  }
  
  async stop(sessionId: string): Promise<void> {
    const container = this.containers.get(sessionId);
    if (!container) return;
    await container.stop({ t: 10 }); // 10s graceful shutdown
  }
  
  async destroy(sessionId: string): Promise<void> {
    const container = this.containers.get(sessionId);
    if (!container) return;
    
    try {
      await container.stop({ t: 5 });
    } catch { /* already stopped */ }
    
    await container.remove({ v: true }); // Remove volumes too
    this.containers.delete(sessionId);
    
    // Clean up named volume
    try {
      const volume = this.docker.getVolume(`session-${sessionId}-workspace`);
      await volume.remove();
    } catch { /* volume may not exist */ }
  }
  
  async getStatus(sessionId: string): Promise<'running' | 'stopped' | 'not_found'> {
    const container = this.containers.get(sessionId);
    if (!container) return 'not_found';
    
    try {
      const info = await container.inspect();
      return info.State.Running ? 'running' : 'stopped';
    } catch {
      return 'not_found';
    }
  }
  
  /** Cleanup stale containers on server startup */
  async cleanupStale(): Promise<void> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: ['generatorai.session'] },
    });
    
    for (const info of containers) {
      const sessionId = info.Labels['generatorai.session'];
      if (sessionId && info.State !== 'running') {
        const container = this.docker.getContainer(info.Id);
        await container.remove({ v: true, force: true });
      }
    }
  }
}
```

### 3.8 GitHub Authentication Inside Containers

GitHub authentication is needed for:
1. **Copilot API access** — the CLI authenticates with GitHub to use Copilot
2. **Git operations** — cloning, pushing to repos

#### Approach 1: Short-Lived Tokens via Environment Variables (Recommended)

```typescript
// Host generates a short-lived token and passes it to the container
const container = await docker.createContainer({
  Env: [
    // GitHub App installation token (1 hour TTL)
    `GITHUB_TOKEN=${await generateInstallationToken(installationId)}`,
    // Or user PAT (passed from client)
    `GITHUB_TOKEN=${userProvidedToken}`,
  ],
});
```

Inside the container:

```bash
# Git credential helper that uses the env var
git config --global credential.helper '!f() { echo "password=$GITHUB_TOKEN"; }; f'

# Copilot CLI uses GITHUB_TOKEN automatically
```

#### Approach 2: Token Proxy (More Secure)

The container never sees the raw token. Instead, it calls a host-side proxy:

```typescript
// Host runs a token proxy on a Unix socket mounted into the container
// Container calls: curl --unix-socket /run/auth/token.sock /token
// Host validates the request and returns a scoped token

// token-proxy.ts (runs on host)
import { createServer } from 'http';

createServer((req, res) => {
  const sessionId = req.headers['x-session-id'];
  const token = tokenStore.getToken(sessionId);
  res.end(JSON.stringify({ token }));
}).listen('/tmp/generatorai/sessions/${sessionId}/auth.sock');
```

**Recommendation**: Start with environment variables (Approach 1) for simplicity. Move to a token proxy if/when GeneratorAI handles untrusted workloads.

### 3.9 Container Image Design for Node.js + Copilot CLI

```dockerfile
# Multi-stage build for minimal image size

# Stage 1: Build the bridge application
FROM node:22-slim AS builder
WORKDIR /build
COPY bridge/package.json bridge/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY bridge/ .
RUN pnpm build

# Stage 2: Runtime image
FROM node:22-slim AS runtime

# Security: run as non-root
RUN groupadd -r agent && useradd -r -g agent -m -d /home/agent -s /bin/bash agent

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    ca-certificates \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Copilot CLI
RUN npm install -g @github/copilot-cli@latest \
    && npm cache clean --force

# Copy bridge application
COPY --from=builder --chown=agent:agent /build/dist /app/bridge

# Configure git
RUN git config --system init.defaultBranch main \
    && git config --system safe.directory /workspace

# Create workspace
RUN mkdir -p /workspace && chown agent:agent /workspace

# Writeable directories (when rootfs is read-only)
VOLUME ["/workspace", "/home/agent", "/tmp"]

USER agent
WORKDIR /workspace

# Health check
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:9222/health || exit 1

# The bridge process manages the Copilot CLI lifecycle
ENTRYPOINT ["node", "/app/bridge/entrypoint.js"]
```

**Image size optimization**:
- Use `node:22-slim` (~180MB) instead of `node:22` (~350MB) 
- Multi-stage build keeps build dependencies out of the runtime image
- `--no-install-recommends` for apt packages
- Clean npm and apt caches
- Target image size: ~300-400MB

### 3.10 Startup Time Optimization

Target: < 5 seconds from session creation to CLI ready.

| Phase | Unoptimized | Optimized | Technique |
|---|---|---|---|
| Image pull | 30-120s | 0s | Pre-pull on host startup |
| Container create | 100-200ms | 50-100ms | Pre-created pool |
| Container start | 200-500ms | 200-500ms | Unavoidable |
| Node.js boot | 500-1000ms | 200-500ms | Minimal dependencies, bundled code |
| Copilot CLI start | 1-3s | 1-2s | Keep-alive/connection pooling |
| Git clone | 5-60s | 0s | Deferred (start session, clone async) |
| **Total** | **37-185s** | **1.5-3s** | |

#### Container Pool (Pre-Warmed)

```typescript
// ContainerPool.ts
export class ContainerPool {
  private available: string[] = []; // Container IDs ready for use
  private minPoolSize = 3;
  private maxPoolSize = 10;
  
  constructor(private containerManager: ContainerManager) {}
  
  /** Initialize pool on server startup */
  async initialize(): Promise<void> {
    for (let i = 0; i < this.minPoolSize; i++) {
      const id = await this.createWarmContainer();
      this.available.push(id);
    }
  }
  
  /** Acquire a pre-warmed container for a session */
  async acquire(sessionId: string): Promise<string> {
    let containerId = this.available.pop();
    
    if (!containerId) {
      // Pool exhausted — create on-demand (slower)
      containerId = await this.createWarmContainer();
    }
    
    // Assign to session (rename, inject env vars)
    await this.assignToSession(containerId, sessionId);
    
    // Replenish pool in background
    this.replenishPool();
    
    return containerId;
  }
  
  /** Release container back to pool (or destroy) */
  async release(containerId: string): Promise<void> {
    if (this.available.length < this.maxPoolSize) {
      await this.resetContainer(containerId);
      this.available.push(containerId);
    } else {
      await this.containerManager.destroy(containerId);
    }
  }
  
  private async createWarmContainer(): Promise<string> {
    // Create a container with the base image, started and idle
    // The bridge process is running but no session is assigned yet
    return this.containerManager.create('__pool__', {
      image: 'generatorai/session:latest',
    });
  }
  
  private async assignToSession(containerId: string, sessionId: string): Promise<void> {
    // Inject session-specific config via Docker exec or env file
    const container = this.containerManager.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['sh', '-c', `echo "SESSION_ID=${sessionId}" > /run/session-config`],
    });
    await exec.start({});
    
    // Signal the bridge process to initialize the session
    // (send a control command over the bridge's TCP port)
  }
  
  private replenishPool(): void {
    setImmediate(async () => {
      while (this.available.length < this.minPoolSize) {
        const id = await this.createWarmContainer();
        this.available.push(id);
      }
    });
  }
}
```

---

## 4. Architecture Patterns

### 4.1 Sidecar Pattern for Monitoring/Streaming

In a sidecar pattern, each session container has a companion container that handles cross-cutting concerns:

```yaml
# Pod/compose definition per session
services:
  session:
    image: generatorai/session:latest
    volumes:
      - workspace:/workspace
      - shared:/run/bridge
    
  monitor:
    image: generatorai/monitor-sidecar:latest
    volumes:
      - shared:/run/bridge:ro
    environment:
      HOST_CALLBACK_URL: http://host.docker.internal:3100/internal/events
```

**For GeneratorAI**: The sidecar pattern is overkill for the current architecture. A simpler in-container bridge process (part of the session image) is sufficient. Reserve sidecars for when you need independent monitoring/logging agents.

### 4.2 Container Orchestration Options

#### Docker Compose (Small Scale, 1-10 Sessions)

```typescript
// Dynamically generate and run docker-compose files per session
import { execSync } from 'child_process';

function startSession(sessionId: string, config: SessionConfig): void {
  const composeFile = generateCompose(sessionId, config);
  writeFileSync(`/tmp/sessions/${sessionId}/docker-compose.yml`, composeFile);
  execSync(`docker compose -f /tmp/sessions/${sessionId}/docker-compose.yml up -d`);
}
```

**Verdict**: Too slow for dynamic session management. Good for dev/test only.

#### Docker API Directly (Medium Scale, 1-50 Sessions) — Recommended

Use the `dockerode` npm package to manage containers programmatically:

```typescript
import Docker from 'dockerode';
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
```

**Verdict**: Best fit for GeneratorAI's current scale. Direct API control, no orchestration overhead.

#### Kubernetes (Large Scale, 50+ Concurrent Sessions)

```yaml
# Session Pod template
apiVersion: v1
kind: Pod
metadata:
  name: session-${sessionId}
  labels:
    app: generatorai-session
    session-id: ${sessionId}
spec:
  containers:
    - name: session
      image: generatorai/session:latest
      resources:
        requests:
          cpu: "500m"
          memory: "1Gi"
        limits:
          cpu: "2"
          memory: "4Gi"
      volumeMounts:
        - name: workspace
          mountPath: /workspace
  volumes:
    - name: workspace
      emptyDir:
        sizeLimit: 10Gi
  # Auto-cleanup after 4 hours
  activeDeadlineSeconds: 14400
```

**Verdict**: Only needed at scale. Adds significant operational complexity. Use when Docker on a single host is no longer sufficient.

### 4.3 Event Bridge Between Container and Host

The recommended architecture for GeneratorAI:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│   HOST (GeneratorAI Server)                                      │
│                                                                  │
│   ┌─────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│   │ SessionSvc  │────▶│ ContainerManager │     │ EventBus    │ │
│   │             │     │                  │     │             │ │
│   │ create()    │     │ create/start/    │     │ emit()      │ │
│   │ start()     │     │ stop/destroy     │     │ subscribe() │ │
│   │ stop()      │     │                  │     │             │ │
│   └─────────────┘     └────────┬─────────┘     └──────▲──────┘ │
│                                │                       │        │
│                       ┌────────▼─────────┐             │        │
│                       │ EventBridgePool  │─────────────┘        │
│                       │                  │                       │
│                       │ One TCP conn per │                       │
│                       │ active container │                       │
│                       └────────┬─────────┘                       │
│                                │                                 │
│   ─────────────────────────────┼─────────────────────────────── │
│                                │ TCP :9222 (per container)       │
│   ┌────────────────────────────▼────────────────────┐           │
│   │              SESSION CONTAINER                   │           │
│   │                                                  │           │
│   │   ┌──────────────┐      ┌──────────────────┐    │           │
│   │   │  Copilot CLI │─────▶│  Bridge Process  │    │           │
│   │   │  (child proc)│events│  (TCP server)    │    │           │
│   │   │              │      │                  │    │           │
│   │   │  stdin/stdout│      │  :9222           │    │           │
│   │   └──────────────┘      └──────────────────┘    │           │
│   │                                                  │           │
│   │   /workspace (volume)                            │           │
│   └──────────────────────────────────────────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Bridge Protocol (Container ↔ Host)

```typescript
// Shared protocol definition
interface BridgeMessage {
  type: 'event' | 'control' | 'health' | 'log';
  payload: unknown;
  timestamp: number;
}

// Events: container → host
interface BridgeEvent extends BridgeMessage {
  type: 'event';
  payload: AgentEvent;
}

// Control: host → container
interface BridgeControl extends BridgeMessage {
  type: 'control';
  payload: {
    command: 'init-session' | 'send-message' | 'stop' | 'abort';
    data: unknown;
  };
}
```

### 4.4 Database Access from Sandboxed Environment

**The container should NOT access the database directly.** The host server owns the SQLite database.

```
Container → (events over TCP) → Host EventBridge → EventBus → EventRepository → SQLite
```

This maintains the current architecture where the `EventBus` is the single point of event ingestion, and the `DrizzleEventRepository` persists them.

### 4.5 Container Pool Pattern (Detailed)

```
Server Startup
     │
     ▼
┌─────────────┐
│ Pre-warm    │──── Create N idle containers
│ Pool        │     (bridge running, no session assigned)
└──────┬──────┘
       │
       ▼
┌─────────────┐       ┌─────────────┐
│ Session     │──────▶│ Pool.acquire │──── Assign session config
│ Created     │       │              │     Start Copilot CLI
└─────────────┘       └──────┬───────┘     Connect EventBridge
                             │
                             ▼
                      ┌──────────────┐
                      │ Session      │──── Container running
                      │ Running      │     Events streaming
                      └──────┬───────┘
                             │
                             ▼
                      ┌──────────────┐
                      │ Session      │──── Stop CLI
                      │ Completed    │     Disconnect EventBridge
                      └──────┬───────┘
                             │
                             ▼
                      ┌──────────────┐
                      │ Pool.release │──── Reset container
                      │              │     Return to pool (or destroy)
                      └──────────────┘
                             │
                             ▼  (background)
                      ┌──────────────┐
                      │ Replenish    │──── Create new idle container
                      │ Pool         │     to maintain min pool size
                      └──────────────┘
```

---

## 5. Security Model

### 5.1 Principle of Least Privilege

```typescript
const container = await docker.createContainer({
  User: '1000:1000', // Non-root user
  HostConfig: {
    // Read-only root filesystem
    ReadonlyRootfs: true,
    
    // Drop ALL capabilities, then add only what's needed
    CapDrop: ['ALL'],
    CapAdd: [
      'NET_RAW',    // For git HTTPS (may not even need this)
    ],
    
    // No privilege escalation
    SecurityOpt: ['no-new-privileges:true'],
    
    // Disable kernel feature access
    Privileged: false,
    
    // Tmpfs for writable paths
    Tmpfs: {
      '/tmp': 'rw,noexec,nosuid,size=512m',
      '/home/agent/.npm': 'rw,noexec,nosuid,size=256m',
    },
    
    // Volumes for persistent writable paths  
    Binds: [
      `session-${sessionId}-workspace:/workspace:rw`,
    ],
  },
});
```

### 5.2 Seccomp Profile

A custom seccomp profile that allows only necessary syscalls:

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "defaultErrnoRet": 1,
  "syscalls": [
    {
      "names": [
        "read", "write", "open", "close", "stat", "fstat", "lstat",
        "poll", "lseek", "mmap", "mprotect", "munmap", "brk",
        "ioctl", "access", "pipe", "select", "sched_yield",
        "dup", "dup2", "pause", "nanosleep", "getpid", "sendfile",
        "socket", "connect", "accept", "sendto", "recvfrom",
        "bind", "listen", "getsockname", "getpeername",
        "clone", "fork", "vfork", "execve", "exit", "wait4",
        "kill", "uname", "fcntl", "flock", "fsync", "fdatasync",
        "truncate", "ftruncate", "getdents", "getcwd", "chdir",
        "rename", "mkdir", "rmdir", "link", "unlink", "symlink",
        "readlink", "chmod", "chown", "lchown", "gettimeofday",
        "getuid", "getgid", "geteuid", "getegid", "getppid",
        "getpgrp", "setpgid", "getgroups", "getresuid", "getresgid",
        "sigaction", "sigprocmask", "sigreturn",
        "epoll_create", "epoll_ctl", "epoll_wait", "epoll_create1",
        "eventfd", "eventfd2", "timerfd_create", "timerfd_settime",
        "clock_gettime", "clock_getres", "clock_nanosleep",
        "openat", "mkdirat", "fchownat", "fstatat", "unlinkat",
        "renameat", "readlinkat", "fchmodat", "faccessat",
        "pipe2", "dup3", "accept4", "getrandom",
        "memfd_create", "copy_file_range"
      ],
      "action": "SCMP_ACT_ALLOW"
    },
    {
      "names": ["ptrace", "mount", "umount2", "pivot_root", "swapon", "swapoff",
                "reboot", "sethostname", "setdomainname", "init_module",
                "finit_module", "delete_module", "acct", "kexec_load"],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1
    }
  ]
}
```

### 5.3 AppArmor Profile

```
#include <tunables/global>

profile generatorai-session flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  #include <abstractions/nameservice>

  # Deny all file access by default, then allow specific paths
  deny /proc/** w,
  deny /sys/** w,
  deny /dev/** rw,
  
  # Allow reading system libraries
  /usr/lib/** r,
  /lib/** r,
  /etc/ssl/** r,
  /etc/resolv.conf r,
  /etc/nsswitch.conf r,
  /etc/hosts r,
  
  # Allow Node.js runtime
  /usr/local/bin/node ix,
  /usr/local/lib/node_modules/** r,
  
  # Allow workspace access
  /workspace/** rw,
  /home/agent/** rw,
  /tmp/** rw,
  
  # Allow network
  network inet stream,
  network inet dgram,
  network inet6 stream,
  network inet6 dgram,
  network unix stream,
  
  # Deny dangerous operations
  deny mount,
  deny umount,
  deny ptrace,
  deny signal (send) set=(kill, term, stop) peer=unconfined,
}
```

### 5.4 Preventing Container Breakout

| Attack Vector | Mitigation |
|---|---|
| Exploiting kernel vuln | gVisor runtime (intercepts syscalls before kernel) |
| Privilege escalation | CapDrop ALL, no-new-privileges, non-root user |
| Filesystem escape | Read-only rootfs, no bind mounts to sensitive host paths |
| Network escape | Restricted network policy (allowlist GitHub domains only) |
| Docker socket access | Never mount `/var/run/docker.sock` into session containers |
| Resource exhaustion | CPU/memory/PID limits, OOM score adjustment |
| Symlink attacks | `nofollow` mount options, AppArmor `deny` rules |
| Information leakage | No host environment variables passed (only session-specific) |

### 5.5 Defense in Depth Layers

```
Layer 1: Container namespace isolation (PID, network, mount, user)
Layer 2: Seccomp syscall filtering
Layer 3: AppArmor mandatory access control
Layer 4: Capability dropping (CapDrop ALL)
Layer 5: Read-only root filesystem
Layer 6: Non-root user (uid 1000)
Layer 7: Resource limits (cgroups)
Layer 8: Network allowlisting
Layer 9: No-new-privileges flag
Layer 10: Optional gVisor runtime (kernel-level intercept)
```

---

## 6. SDK-Specific Considerations

### 6.1 The `cliUrl` Option — External CLI Server

The Copilot SDK supports connecting to an externally-running CLI server via `cliUrl`:

```typescript
// Current GeneratorAI code (CopilotAdapter.ts)
this.client = new CopilotClient({
  autoStart: false,
  useStdio: options.useStdio ?? true,  // Default: spawn as child process
  cwd: options.defaultCwd,
});
```

For containerized sessions, there are two architectural options:

#### Option A: CLI Inside Container, SDK on Host (via `cliUrl`)

```
HOST:
  CopilotClient({ cliUrl: 'http://container-ip:9222' })
        │
        │ HTTP/WebSocket
        ▼
CONTAINER:
  Copilot CLI server (listening on :9222)
```

```typescript
// Modified CopilotAdapter for containerized sessions
export class ContainerizedCopilotAdapter implements ICopilotPort {
  private client: CopilotClient;
  
  constructor(private containerBridgeUrl: string) {
    this.client = new CopilotClient({
      autoStart: false,
      useStdio: false,              // Don't spawn child process
      cliUrl: containerBridgeUrl,   // Connect to CLI in container
    });
  }
  
  async initialize(): Promise<void> {
    // The CLI is already running in the container
    // Just connect to it
    await this.client.start();
  }
}
```

**Advantages**:
- Minimal changes to the existing CopilotAdapter
- The SDK handles the communication protocol
- Events flow through the SDK's existing event system

**Disadvantages**:
- Requires the CLI to expose a compatible server endpoint
- One CopilotClient per session per container (resource overhead on host)

#### Option B: Full SDK Inside Container (Bridge Pattern)

```
HOST:
  ContainerManager → spawn container
  EventBridge ← TCP events from container
        │
        │ custom protocol (TCP/Unix socket)
        ▼
CONTAINER:
  Bridge Process
    └── CopilotClient({ useStdio: true })  // CLI as child process inside container
    └── TCP server → pushes events to host
```

```typescript
// bridge/entrypoint.ts (runs INSIDE the container)
import { CopilotClient } from '@github/copilot-sdk';
import { createServer } from 'net';

const client = new CopilotClient({
  autoStart: true,
  useStdio: true,              // Spawn CLI as child process in container
  cwd: '/workspace',
});

// TCP server for host communication
const server = createServer((socket) => {
  // Forward control commands from host to SDK
  socket.on('data', async (data) => {
    const msg = JSON.parse(data.toString());
    
    switch (msg.command) {
      case 'create-session':
        const session = await client.createSession(msg.config);
        // Stream events back
        session.on('event', (event) => {
          socket.write(JSON.stringify({ type: 'event', payload: event }) + '\n');
        });
        break;
      case 'send-message':
        await session.sendMessage(msg.message);
        break;
      case 'stop':
        await client.stop();
        break;
    }
  });
});

server.listen(9222, '0.0.0.0');
```

**Advantages**:
- Complete isolation — the entire SDK + CLI runs inside the container
- No SDK dependencies needed on the host (just TCP client)
- The container is fully self-contained

**Disadvantages**:
- More complex bridge protocol to maintain
- Must implement a custom RPC layer between host and container
- Overhead of running Node.js + SDK + CLI in each container

### 6.2 `useStdio: true` vs `useStdio: false` — Implications for Containerization

| Aspect | `useStdio: true` (default) | `useStdio: false` (TCP) |
|---|---|---|
| **How CLI starts** | SDK spawns CLI as child process | CLI must be started separately, SDK connects via TCP |
| **Container fit** | CLI must be in same container as SDK | CLI and SDK can be in different containers/hosts |
| **Event delivery** | Via stdout/stdin pipes | Via TCP connection |
| **Resource isolation** | Both share same PID namespace | Can have separate resource limits |
| **For GeneratorAI** | Better for Option B (full SDK in container) | Better for Option A (SDK on host, CLI in container) |
| **Resilience** | If child dies, SDK detects immediately | TCP disconnect detection, reconnection possible |

**Recommendation**: Use `useStdio: true` with the full SDK running inside the container (Option B). This is more self-contained and doesn't require the SDK on the host to maintain TCP connections to each container.

### 6.3 The `cwd` Option — Mapping to Container Volumes

Currently:
```typescript
// AppConfig.ts
workspacesDir: z.string().default('~/.generatorai/workspaces'),

// CopilotAdapter.ts constructor
this.client = new CopilotClient({
  cwd: options.defaultCwd, // Points to host filesystem
});
```

With containerization:
```typescript
// Inside the container, cwd is always /workspace
const client = new CopilotClient({
  cwd: '/workspace',
});

// The host maps this to a Docker volume:
// docker run -v session-abc-workspace:/workspace generatorai/session
```

The host's `workspacesDir` config becomes the location where volumes are stored on the host's Docker storage driver (typically `/var/lib/docker/volumes/`). The application no longer needs to manage workspace directories directly.

### 6.4 GitHub Authentication Token Flow

```
┌────────┐         ┌─────────────┐         ┌───────────────────┐
│ Client │── POST ─│ Host Server │── ENV ──│ Session Container │
│        │  token  │             │  inject  │                   │
│        │  in     │ validates   │         │ GITHUB_TOKEN      │
│        │  header │ stores in   │         │ used by:          │
│        │         │ memory only │         │ - Copilot CLI     │
│        │         │ (not DB)    │         │ - git clone/push  │
└────────┘         └─────────────┘         └───────────────────┘
```

Security considerations:
- **Never persist tokens to the database** — hold them in-memory only
- **Token scope**: use fine-grained PATs or GitHub App installation tokens with minimal permissions
- **Token rotation**: for long-running sessions, implement token refresh before expiry
- **Token cleanup**: securely clear the environment variable after the container reads it (overwrite with zeros)

```typescript
// Inside container: read token, configure git, then clear env
const token = process.env.GITHUB_TOKEN;
if (token) {
  // Configure git credential helper
  execSync(`git config --global credential.helper 
    '!f() { echo "password=${token}"; }; f'`);
  
  // Clear from environment (defense in depth)
  delete process.env.GITHUB_TOKEN;
}
```

---

## 7. Recommended Architecture for GeneratorAI

### 7.1 Architecture Decision

Based on this research, the recommended architecture is:

| Decision | Choice | Rationale |
|---|---|---|
| **Isolation technology** | Docker with `runc` (default), optional gVisor | Simplest, widely available, sufficient for single-tenant |
| **Container lifecycle** | One container per session | Clean isolation, simple lifecycle mapping |
| **SDK placement** | Full SDK + CLI inside container (Option B) | Complete isolation, no host SDK connections |
| **Communication** | TCP socket (bridge process) | Clean, well-understood, debuggable |
| **Repo access** | Clone inside container | Full git functionality, complete isolation |
| **Auth** | Environment variable injection | Simple, secure enough for single-tenant |
| **Pool** | Pre-warmed container pool | Meets <5s startup target |
| **Orchestration** | Docker API directly (dockerode) | Right-sized for 1-50 concurrent sessions |
| **Database** | Host-only (SQLite), events bridge from container | Maintains current architecture |

### 7.2 Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       HOST SERVER                                    │
│                                                                      │
│  ┌──────────┐  ┌───────────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ Express  │  │ SessionService│  │ EventBus   │  │ SQLite DB    │ │
│  │ Routes   │  │               │  │            │  │ (Drizzle)    │ │
│  └────┬─────┘  └──────┬────────┘  └─────▲──────┘  └──────────────┘ │
│       │               │                 │                            │
│       │        ┌──────▼────────┐        │                            │
│       │        │ Container     │        │                            │
│       │        │ Orchestrator  │        │                            │
│       │        │               │        │                            │
│       │        │ ┌───────────┐ │  ┌─────┴──────┐                    │
│       │        │ │  Pool     │ │  │ EventBridge│                    │
│       │        │ │  Manager  │ │  │ Pool       │                    │
│       │        │ └───────────┘ │  └─────┬──────┘                    │
│       │        └──────┬────────┘        │                            │
│       │               │                 │                            │
│  ═════╪═══════════════╪═════════════════╪════════════════════════   │
│       │     Docker     │      TCP        │                           │
│       │     API        │   connections   │                           │
│       │               │                 │                            │
│  ┌────┼───────────────┼─────────────────┼──────────────────────┐    │
│  │    │  SESSION CONTAINER A            │                      │    │
│  │    │  ┌─────────────────────┐  ┌─────▼──────┐              │    │
│  │    │  │  Bridge Process     │  │ TCP Server │              │    │
│  │    │  │  ┌───────────────┐  │  │ :9222      │              │    │
│  │    │  │  │ CopilotClient │  │  │            │              │    │
│  │    │  │  │ (useStdio:true│  │──│ Events out │              │    │
│  │    │  │  │  = CLI child) │  │  │ Cmds in    │              │    │
│  │    │  │  └───────────────┘  │  └────────────┘              │    │
│  │    │  └─────────────────────┘                              │    │
│  │    │  /workspace (Docker volume)                           │    │
│  │    │  /home/agent                                          │    │
│  └────┼───────────────────────────────────────────────────────┘    │
│       │                                                              │
│  ┌────┼───────────────────────────────────────────────────────┐    │
│  │    │  SESSION CONTAINER B                                  │    │
│  │    │  (same structure)                                     │    │
│  └────┼───────────────────────────────────────────────────────┘    │
└───────┼──────────────────────────────────────────────────────────────┘
```

### 7.3 New Packages / Modules

```
packages/
  container/                      # NEW PACKAGE
    src/
      ContainerManager.ts         # Docker API wrapper (create/start/stop/destroy)
      ContainerPool.ts            # Pre-warmed container pool
      ContainerEventBridge.ts     # TCP connection to container bridge
      ContainerOrchestrator.ts    # High-level session↔container lifecycle
      DockerImageBuilder.ts       # Programmatic image build (optional)
      types.ts                    # Container config types
    docker/
      Dockerfile.session          # Session container image
      bridge/                     # Bridge process code (runs IN container)
        entrypoint.ts
        event-server.ts
        cli-manager.ts
      seccomp-profile.json
      apparmor-profile
```

### 7.4 Integration with Current Architecture

The key integration point is where `SessionService.startSession()` currently initializes the Copilot CLI:

```typescript
// BEFORE (current): SessionService creates Copilot conversation on the host
async startSession(sessionId: string): Promise<void> {
  // ... transitions session to 'starting'
  await this.copilot.createConversation({
    conversationId: sessionId,
    workingDirectory: `${this.workspacesDir}/${sessionId}`,
    // ...
  });
}

// AFTER (containerized): SessionService delegates to ContainerOrchestrator
async startSession(sessionId: string): Promise<void> {
  // ... transitions session to 'starting'
  
  // 1. Acquire container from pool
  const container = await this.containerOrchestrator.acquireContainer(sessionId, {
    repoUrl: session.repoUrl,
    repoBranch: session.repoBranch,
    githubToken: session.githubToken,
  });
  
  // 2. Container bridge starts CLI inside and begins streaming events
  // Events automatically flow: container → EventBridge → EventBus → DB + SSE
  
  // 3. Host sends commands via the bridge
  await container.sendCommand({
    command: 'create-session',
    config: {
      model: session.model,
      // ...
    },
  });
}
```

The `ICopilotPort` interface can be extended with a `ContainerizedCopilotPort` that delegates operations to the container bridge instead of a local CopilotClient:

```typescript
export class ContainerizedCopilotPort implements ICopilotPort {
  constructor(
    private containerOrchestrator: ContainerOrchestrator,
    private eventBridge: ContainerEventBridge,
  ) {}
  
  async createConversation(params: CreateConversationParams): Promise<string> {
    // Send command to the container's bridge process
    await this.eventBridge.sendCommand(params.conversationId, {
      command: 'create-session',
      data: {
        model: params.model,
        tools: params.tools,
        systemMessage: params.systemMessage,
        workingDirectory: '/workspace', // Always /workspace inside container
      },
    });
    return params.conversationId;
  }
  
  async sendMessage(conversationId: string, message: ConversationMessage): Promise<ConversationResponse> {
    return this.eventBridge.sendCommand(conversationId, {
      command: 'send-message',
      data: message,
    });
  }
  
  // ... other ICopilotPort methods
}
```

### 7.5 Startup Sequence (Target: <5 Seconds)

```
T=0.0s    Session created (API call)
T=0.0s    Container acquired from pool (pre-warmed, immediate)
T=0.1s    Session config injected into container
T=0.3s    EventBridge TCP connection established
T=0.5s    Bridge process starts CopilotClient
T=1.5s    Copilot CLI spawned and connected
T=2.0s    CLI ready, health check passes
T=2.0s    Session status → 'running'
T=2.5s    Git clone starts (async, non-blocking)
T=2.5s    User's first message can be sent (workspace may still be cloning)
T=5-15s   Git clone completes (async)
Total:    ~2.5s to first interaction (well under 5s target)
```

---

## 8. Implementation Roadmap

### Phase 1: Foundation (2-3 weeks)

1. **Docker image creation** — Build `Dockerfile.session` with Node.js, Copilot CLI, git, and the bridge process
2. **Bridge process** — Implement the in-container bridge (TCP server, CLI management, event forwarding)
3. **ContainerManager** — Docker API wrapper using `dockerode` for container CRUD
4. **ContainerEventBridge** — TCP client on host that receives events and forwards to `EventBus`
5. **Basic integration** — Wire into `SessionService` behind a feature flag

### Phase 2: Performance (1-2 weeks)

6. **ContainerPool** — Pre-warmed container pool with configurable size
7. **Startup optimization** — Minimize image size, bundle bridge process, optimize CLI startup
8. **Resource limits** — Configure CPU, memory, PID, and storage limits
9. **Health checks** — Container health monitoring and auto-restart

### Phase 3: Security (1-2 weeks)

10. **Seccomp profile** — Custom syscall allowlist
11. **AppArmor profile** — Mandatory access control
12. **Network policy** — GitHub API allowlisting, inter-container isolation
13. **Token management** — Secure injection and cleanup of GitHub tokens
14. **Read-only rootfs** — Lock down the container filesystem

### Phase 4: Production Readiness (1-2 weeks)

15. **Graceful shutdown** — Handle server restarts, container cleanup, orphan detection
16. **Logging** — Structured logs from containers forwarded to host
17. **Monitoring** — Container metrics (CPU, memory, network) exposed to host
18. **Error handling** — Container crash recovery, event replay after reconnection
19. **Configuration** — Extend `AppConfig` with container settings (pool size, resource limits, image name)
20. **Testing** — Integration tests with Docker-in-Docker or testcontainers

### AppConfig Extension

```typescript
// Proposed addition to AppConfigSchema
container: z.object({
  enabled: z.boolean().default(false),              // Feature flag
  image: z.string().default('generatorai/session:latest'),
  runtime: z.enum(['runc', 'runsc']).default('runc'), // gVisor option
  pool: z.object({
    minSize: z.number().default(2),
    maxSize: z.number().default(20),
    idleTimeoutMs: z.number().default(300_000),     // 5 min idle timeout
  }).default({}),
  resources: z.object({
    cpuQuota: z.number().default(200_000),           // 2 cores
    memoryBytes: z.number().default(4 * 1024**3),    // 4GB
    pidsLimit: z.number().default(512),
    storageSizeGb: z.number().default(10),
  }).default({}),
  network: z.object({
    allowedDomains: z.array(z.string()).default([
      'api.github.com',
      'github.com',
      'copilot-proxy.githubusercontent.com',
    ]),
  }).default({}),
}).default({}),
```

---

## Appendix A: Reference Implementations

### A.1 Testcontainers (for Integration Testing)

```typescript
import { GenericContainer, Wait } from 'testcontainers';

describe('Containerized Session', () => {
  it('should start a session in a container', async () => {
    const container = await new GenericContainer('generatorai/session:latest')
      .withExposedPorts(9222)
      .withEnvironment({
        SESSION_ID: 'test-session-1',
        GITHUB_TOKEN: process.env.TEST_GITHUB_TOKEN!,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .start();
    
    const bridgePort = container.getMappedPort(9222);
    const bridge = new ContainerEventBridge();
    await bridge.connect('localhost', bridgePort);
    
    // Send a message and verify event streaming
    await bridge.sendCommand({
      command: 'create-session',
      data: { model: 'gpt-4.1' },
    });
    
    const events = await bridge.waitForEvents(3, 10_000);
    expect(events[0].kind).toBe('session.created');
    
    await container.stop();
  }, 30_000);
});
```

### A.2 Docker Compose for Development

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  server:
    build: 
      context: .
      dockerfile: apps/server/Dockerfile
    ports:
      - "3100:3100"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # Docker-in-Docker access
      - generatorai-data:/data
    environment:
      CONTAINER_ENABLED: "true"
      CONTAINER_IMAGE: "generatorai/session:dev"
      DB_PATH: /data/generatorai.db
    depends_on:
      - session-builder

  session-builder:
    # Build session image
    build:
      context: ./packages/container/docker
      dockerfile: Dockerfile.session
    image: generatorai/session:dev
    entrypoint: ["echo", "Image built"]

volumes:
  generatorai-data:
```

### A.3 Key NPM Packages

| Package | Purpose | Notes |
|---|---|---|
| `dockerode` | Docker Engine API client | Most popular Node.js Docker client |
| `testcontainers` | Integration testing with Docker | Jest-compatible, auto-cleanup |
| `node-pty` | PTY for terminal emulation | If session needs terminal interaction |
| `json-socket` | Length-prefixed JSON over TCP | Simplifies bridge protocol |

---

## Appendix B: Cost-Benefit Analysis

| Approach | Setup Effort | Operational Overhead | Security | Startup Speed | Recommendation |
|---|---|---|---|---|---|
| No sandbox (current) | None | None | Low | Instant | Only for dev/local |
| Docker + pool | Medium (3-4 weeks) | Low | Medium-High | <3s | **Production default** |
| Docker + gVisor | Medium (3-4 weeks) | Medium | High | <3s | Multi-tenant deployments |
| Firecracker | High (6-8 weeks) | High | Very High | <1s | Cloud SaaS platform |
| E2B (managed) | Low (1 week) | Zero (SaaS) | High | 2-3s | Quick prototype |

---

## Appendix C: Key Trade-off Decisions

### Why Docker over Firecracker?
Docker is available everywhere (developer laptops, CI, cloud VMs). Firecracker requires KVM (Linux + hardware virtualization), making it impractical for desktop deployments. GeneratorAI runs as both a desktop app (Electron) and a server — Docker works for both.

### Why full SDK in container (Option B) over SDK on host (Option A)?
Option B provides complete isolation. If a vulnerability in the Copilot CLI allows code execution, the blast radius is limited to the container. With Option A, a compromised CLI could attack the host's SDK process.

### Why TCP over Unix sockets?
TCP is more portable (works on Windows Docker Desktop), easier to debug (telnet/nc), and compatible with Docker's port mapping. Unix sockets would require shared volume mounts.

### Why clone inside container instead of bind-mount?
Bind-mounts break isolation — a malicious AI-generated script could access the host filesystem through symlinks or path traversal. Cloning inside the container ensures the workspace is fully isolated.

---

*End of research report. This document should be treated as a living document and updated as the containerization feature progresses through implementation.*
