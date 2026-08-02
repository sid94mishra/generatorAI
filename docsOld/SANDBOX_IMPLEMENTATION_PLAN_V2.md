# Sandbox Implementation Plan v2 — Docker Sandbox Architecture

## Executive Summary

Run the Copilot SDK on the host as a **control plane** while executing the Copilot CLI and all user code inside a **Docker Sandbox** (microVM with hypervisor isolation). This gives 100% sandboxed execution for all dangerous operations (file I/O, shell commands, git, user scripts) while keeping the SDK's streaming, permissions, and event infrastructure on the host.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Validated Design Decisions](#2-validated-design-decisions)
3. [Execution Path Analysis](#3-execution-path-analysis)
4. [New Components](#4-new-components)
5. [Modifications to Existing Files](#5-modifications-to-existing-files)
6. [Docker Sandbox Template](#6-docker-sandbox-template)
7. [Implementation Phases](#7-implementation-phases)
8. [Testing Strategy](#8-testing-strategy)
9. [Configuration Reference](#9-configuration-reference)
10. [Risks and Mitigations](#10-risks-and-mitigations)

---

## 1. Architecture Overview

```
┌──────────────────── HOST ────────────────────────────────────────┐
│                                                                  │
│  ┌────────────┐    ┌─────────────────┐    ┌──────────────────┐   │
│  │  Web UI    │◄──►│   Express API   │◄──►│   SQLite / DB    │   │
│  │  (React)   │SSE │   (server app)  │    │   (Drizzle ORM)  │   │
│  └────────────┘    └────────┬────────┘    └──────────────────┘   │
│                             │                                     │
│                    ┌────────▼────────┐                            │
│                    │  Copilot SDK    │  Control Plane:            │
│                    │  (CopilotClient)│  - Conversation mgmt      │
│                    │                 │  - Streaming events        │
│                    │  cliUrl: ───────┼──── JSON-RPC/TCP ──┐      │
│                    │  "sandbox:4321" │  - Permissions      │      │
│                    └─────────────────┘  - Custom tools     │      │
│                                                            │      │
│  ┌─────────────────────┐                                   │      │
│  │ SandboxLifecycle    │  docker sandbox create/rm         │      │
│  │ Manager             │  manages per-run lifecycle        │      │
│  └─────────────────────┘                                   │      │
│                                                            │      │
├────────────────────────────────────────────────────────────┼──────┤
│                                                            │      │
│  ┌─────────────── DOCKER SANDBOX (microVM) ───────────────▼──┐   │
│  │                                                            │   │
│  │  ┌──────────────────┐    ┌─────────────────────────────┐   │   │
│  │  │  Copilot CLI     │    │  Workspace (mounted)        │   │   │
│  │  │  --headless      │    │  /path/to/run-workspace     │   │   │
│  │  │  --port 4321     │    │                             │   │   │
│  │  │                  │    │  - Source code               │   │   │
│  │  │  Built-in tools: │───►│  - Generated files          │   │   │
│  │  │  edit_file, shell│    │  - Git repos                │   │   │
│  │  │  git, grep, glob │    └─────────────────────────────┘   │   │
│  │  └──────────────────┘                                      │   │
│  │                                                            │   │
│  │  Also runs (via docker sandbox exec):                      │   │
│  │  - Hook scripts, run_script steps, data source scripts     │   │
│  │  - Git operations, function hooks (as node -e)             │   │
│  │  - Custom SDK tool handlers (via closure → sandbox.exec)   │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### Core Principle: Port/Adapter Isolation

The existing `IScriptRunner` port interface is the key enabler. All script execution already flows through this interface. By swapping the adapter from `SandboxedScriptRunner` (host `spawn`) to `SandboxScriptRunner` (sandbox `exec`), all 11 execution paths are sandboxed with **zero changes** to the services that call them.

---

## 2. Validated Design Decisions

### 2.1 Tool Execution Location (Verified from Official Docs)

| Tool Type | Execution Location | Evidence |
|---|---|---|
| **Built-in CLI tools** (`edit_file`, `shell`, `git`, `grep`, `glob`, `read_file`, `write_file`) | **CLI process** (inside sandbox) | SDK docs: "overridesBuiltInTool" references "built-in CLI tool (e.g. edit_file, read_file)" |
| **Custom SDK tools** (`defineTool()` callbacks) | **SDK process** (host), but closures route to sandbox | SDK docs: "You can let the CLI call back into your process" |

**Sources:**
- `@github/copilot-sdk` v0.2.0 README: "Copilot handles planning, tool invocation, file edits, and more"
- `defineTool` docs: custom tool callbacks are the only code that runs in SDK process
- `onPermissionRequest.kind`: `"shell"`, `"write"`, `"read"` (CLI-side) vs `"custom-tool"` (SDK callback)

### 2.2 Shell Sandbox (Not Copilot Sandbox)

**Decision:** Use `docker/sandbox-templates:shell` base with a custom template.

**Reasoning:**
- The `copilot` sandbox template auto-starts an interactive TUI mode — we need `--headless --port 4321`
- Shell template provides: Ubuntu, Git, Docker CLI, Node.js, Python, Go, Java, sudo
- We get full control over what runs at startup, version pinning, and future agent flexibility

### 2.3 SDK Tool Handler Closure Pattern

Custom tools defined via `defineTool()` normally execute their handler in the SDK (host) process. However, the handler is a plain closure with zero restrictions on what it does internally. By capturing a sandbox reference in the closure, all custom tools execute inside the sandbox:

```typescript
// tool-factory.ts — this code remains UNCHANGED
handler: async (args: unknown) => {
  const safeArgs = /* ... */;
  return toolDef.handler(safeArgs);  // handler is opaque to SDK
};

// Domain tool definition — handler captures sandbox via closure
const myTool: ToolDefinition = {
  name: 'run_linter',
  description: 'Run ESLint on codebase',
  parametersSchema: { /* ... */ },
  handler: async (args) => {
    // This closure captures `sandbox` from the outer scope
    const result = await sandbox.exec(sandboxName, ['npx', 'eslint', args.path]);
    return result.stdout;
  },
};
```

**Validation:** `tool-factory.ts` line 18 shows `toolDef.handler(safeArgs)` — SDK just calls whatever function is provided. No type checking, no restrictions, just needs a JSON-serializable return value.

### 2.4 Vendor-Agnostic Design

All new interfaces use generic names. Docker is just one implementation:

| Interface | Implementation |
|---|---|
| `ISandboxProvider` (port) | `DockerSandboxProvider` |
| `SandboxScriptRunner` (adapter) | Adapts `ISandboxProvider` → `IScriptRunner` |
| `SandboxLifecycleManager` (service) | Orchestrates per-run create/start CLI/destroy |

### 2.5 Function Hooks: import() → Sandboxed Node Execution

**Problem:** `HookExecutor.executeFunction()` (line 163) does `import(modulePath)` which loads and executes arbitrary user code **in the host Node.js process**. This is the single most dangerous execution path.

**Solution:** When sandbox is enabled, convert function hooks to:
```typescript
await scriptRunner.run('node', ['-e', `require('${modulePath}')(${JSON.stringify(context)})`], { cwd });
```

This runs the user's module inside the sandbox VM instead of `import()` on the host.

---

## 3. Execution Path Analysis

### All 11 Paths That Execute User/External Code

| # | Location | Method | Current Mechanism | Sandboxed Via |
|---|----------|--------|-------------------|---------------|
| 1 | `HookExecutor` | `executeScript()` | `scriptRunner.run(command, args)` | IScriptRunner swap |
| 2 | `HookExecutor` | `executeFunction()` | `import(modulePath)` → host | Convert to `scriptRunner.run('node', ['-e', ...])` |
| 3 | `HookExecutor` | `executeHttp()` | `httpClient.request()` | Stays on host (HTTP calls to external APIs are safe; sandbox network is restricted) |
| 4 | `WorkflowPreprocessor` | `executeRunScript()` | `scriptRunner.run('sh', ['-c', script])` | IScriptRunner swap |
| 5 | `WorkflowPreprocessor` | `executePostRunScript()` | `scriptRunner.run('sh', ['-c', script])` | IScriptRunner swap |
| 6 | `DataSourceResolver` | `resolveScript()` | `scriptRunner.run(command, args)` | IScriptRunner swap |
| 7 | `GitManager` | `clone()` | `scriptRunner.run('git', ['clone', ...])` | IScriptRunner swap |
| 8 | `GitManager` | `checkout()` | `scriptRunner.run('git', ['checkout', ...])` | IScriptRunner swap |
| 9 | `GitManager` | `createBranch()` | `scriptRunner.run('git', ['checkout', '-b', ...])` | IScriptRunner swap |
| 10 | `GitManager` | `commitAndPush()` | `scriptRunner.run('git', ['add/commit/push', ...])` | IScriptRunner swap |
| 11 | `GitManager` | `createPR()` | `scriptRunner.run('gh', ['pr', 'create', ...])` | IScriptRunner swap |

### What Stays on Host (Correct Behavior)

- **SDK control plane**: Conversation management, streaming events, permission callbacks
- **Express API server**: HTTP routes, SSE streaming, authentication
- **Database layer**: SQLite read/write via Drizzle ORM
- **HTTP hooks**: External webhook calls (`HookExecutor.executeHttp`)
- **Event bus**: In-memory event routing and persistence

---

## 4. New Components

### 4.1 ISandboxProvider (Port Interface)

**File:** `packages/core/src/domain/ports/ISandboxProvider.ts`

```typescript
// ────────────────────────────────────────────────────────────────
// ISandboxProvider — Port interface for sandbox lifecycle & execution
// ────────────────────────────────────────────────────────────────

export interface SandboxConfig {
  /** Unique name for the sandbox instance (e.g., "run-<runId>") */
  name: string;
  /** Docker image / template to use */
  image: string;
  /** Host directories to mount into the sandbox */
  mounts?: SandboxMount[];
  /** Environment variables to set in the sandbox */
  env?: Record<string, string>;
  /** Network access configuration */
  network?: SandboxNetworkConfig;
}

export interface SandboxMount {
  /** Host path */
  source: string;
  /** Path inside the sandbox */
  target: string;
  /** Read-only mount */
  readonly?: boolean;
}

export interface SandboxNetworkConfig {
  /** Allow outbound HTTP/HTTPS (via proxy) */
  httpProxy?: boolean;
  /** Additional allowed domains */
  allowedDomains?: string[];
}

export interface SandboxExecOptions {
  /** Working directory inside the sandbox */
  cwd?: string;
  /** Environment variables for this exec only */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Stream stdout/stderr lines as they arrive */
  streamTo?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxInfo {
  name: string;
  status: 'running' | 'stopped' | 'unknown';
  /** The port the CLI is listening on inside the sandbox */
  cliPort?: number;
}

export interface ISandboxProvider {
  /** Create and start a new sandbox */
  create(config: SandboxConfig): Promise<void>;

  /** Execute a command inside a running sandbox */
  exec(name: string, command: string[], options?: SandboxExecOptions): Promise<SandboxExecResult>;

  /** Stop a running sandbox */
  stop(name: string): Promise<void>;

  /** Remove a sandbox (stop + delete) */
  remove(name: string): Promise<void>;

  /** Get sandbox status */
  inspect(name: string): Promise<SandboxInfo>;

  /** Check if the sandbox provider is available on this host */
  isAvailable(): Promise<boolean>;
}
```

### 4.2 DockerSandboxProvider (Infrastructure)

**File:** `packages/core/src/infrastructure/DockerSandboxProvider.ts`

```typescript
// ────────────────────────────────────────────────────────────────
// DockerSandboxProvider — ISandboxProvider via `docker sandbox` CLI
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ISandboxProvider,
  SandboxConfig,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxInfo,
} from '../domain/ports/ISandboxProvider.js';
import type { ILogger } from '@generatorai/shared';

const execFileAsync = promisify(execFile);

export class DockerSandboxProvider implements ISandboxProvider {
  constructor(private readonly logger: ILogger) {}

  async create(config: SandboxConfig): Promise<void> {
    const args = ['sandbox', 'create', '--name', config.name, '-i', config.image];

    // Add mount flags
    for (const mount of config.mounts ?? []) {
      args.push(
        '--mount',
        `type=bind,source=${mount.source},target=${mount.target}${mount.readonly ? ',readonly' : ''}`,
      );
    }

    // Add environment variables
    for (const [key, value] of Object.entries(config.env ?? {})) {
      args.push('-e', `${key}=${value}`);
    }

    this.logger.info(`[DockerSandbox] Creating sandbox: ${config.name}`);
    await execFileAsync('docker', args, { timeout: 60_000 });
    this.logger.info(`[DockerSandbox] Sandbox created: ${config.name}`);
  }

  async exec(
    name: string,
    command: string[],
    options?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const args = ['sandbox', 'exec', name];

    if (options?.cwd) {
      args.push('-w', options.cwd);
    }

    for (const [key, value] of Object.entries(options?.env ?? {})) {
      args.push('-e', `${key}=${value}`);
    }

    args.push('--', ...command);

    const timeout = options?.timeout ?? 300_000;

    try {
      const { stdout, stderr } = await execFileAsync('docker', args, { timeout });
      return { exitCode: 0, stdout, stderr };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: e.code ?? 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? '',
      };
    }
  }

  async stop(name: string): Promise<void> {
    this.logger.info(`[DockerSandbox] Stopping sandbox: ${name}`);
    await execFileAsync('docker', ['sandbox', 'stop', name], { timeout: 30_000 });
  }

  async remove(name: string): Promise<void> {
    this.logger.info(`[DockerSandbox] Removing sandbox: ${name}`);
    try {
      await execFileAsync('docker', ['sandbox', 'rm', name], { timeout: 30_000 });
    } catch {
      // Already removed or never created — safe to ignore
      this.logger.warn(`[DockerSandbox] Sandbox ${name} removal failed (may already be removed)`);
    }
  }

  async inspect(name: string): Promise<SandboxInfo> {
    try {
      const { stdout } = await execFileAsync(
        'docker',
        ['sandbox', 'inspect', name, '--format', 'json'],
        { timeout: 10_000 },
      );
      const info = JSON.parse(stdout);
      return {
        name,
        status: info.State?.Status === 'running' ? 'running' : 'stopped',
        cliPort: info.Config?.Labels?.['copilot-cli-port']
          ? Number(info.Config.Labels['copilot-cli-port'])
          : undefined,
      };
    } catch {
      return { name, status: 'unknown' };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('docker', ['sandbox', 'ls'], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }
}
```

### 4.3 SandboxScriptRunner (IScriptRunner Adapter)

**File:** `packages/core/src/infrastructure/SandboxScriptRunner.ts`

This is the critical adapter that makes all 10 `IScriptRunner.run()` call sites execute inside the sandbox with **zero changes** to the calling services.

```typescript
// ────────────────────────────────────────────────────────────────
// SandboxScriptRunner — IScriptRunner adapter that routes
// commands through a running Docker Sandbox instance
// ────────────────────────────────────────────────────────────────

import type { IScriptRunner, ScriptRunOptions, ScriptRunResult } from '../domain/ports/IScriptRunner.js';
import type { ISandboxProvider, SandboxExecOptions } from '../domain/ports/ISandboxProvider.js';
import type { ILogger } from '@generatorai/shared';

export class SandboxScriptRunner implements IScriptRunner {
  constructor(
    private readonly sandboxProvider: ISandboxProvider,
    private readonly sandboxName: string,
    private readonly logger: ILogger,
  ) {}

  async run(command: string, args: string[], options: ScriptRunOptions): Promise<ScriptRunResult> {
    const startTime = Date.now();

    const execOptions: SandboxExecOptions = {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      streamTo: options.streamTo,
    };

    const result = await this.sandboxProvider.exec(
      this.sandboxName,
      [command, ...args],
      execOptions,
    );

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startTime,
    };
  }

  async isAvailable(command: string): Promise<boolean> {
    try {
      const result = await this.sandboxProvider.exec(
        this.sandboxName,
        ['which', command],
        { timeout: 5_000 },
      );
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
```

### 4.4 SandboxLifecycleManager (Service)

**File:** `packages/core/src/services/SandboxLifecycleManager.ts`

Manages the per-run lifecycle: create sandbox → start CLI → provide cliUrl → destroy on completion.

```typescript
// ────────────────────────────────────────────────────────────────
// SandboxLifecycleManager — Per-run sandbox lifecycle
// ────────────────────────────────────────────────────────────────

import type { ISandboxProvider, SandboxConfig } from '../domain/ports/ISandboxProvider.js';
import type { ILogger } from '@generatorai/shared';

export interface SandboxSession {
  sandboxName: string;
  cliUrl: string;
  cliPort: number;
}

export interface SandboxLifecycleConfig {
  image: string;
  cliPort: number;              // Default: 4321
  startupTimeoutMs: number;     // Default: 30_000
  cliStartupDelayMs: number;    // Default: 3_000
}

export class SandboxLifecycleManager {
  private activeSandboxes = new Map<string, SandboxSession>();

  constructor(
    private readonly provider: ISandboxProvider,
    private readonly config: SandboxLifecycleConfig,
    private readonly logger: ILogger,
  ) {}

  /**
   * Create a sandbox for a workflow run.
   * Starts the CLI in headless mode and returns the cliUrl for the SDK.
   */
  async createForRun(
    runId: string,
    workspaceDir: string,
    env?: Record<string, string>,
  ): Promise<SandboxSession> {
    const sandboxName = `genai-run-${runId}`;
    const cliPort = this.config.cliPort;

    // Create the sandbox with workspace mounted
    const sandboxConfig: SandboxConfig = {
      name: sandboxName,
      image: this.config.image,
      mounts: [
        {
          source: workspaceDir,
          target: workspaceDir, // Same absolute path — Docker Sandbox default behavior
        },
      ],
      env: {
        ...env,
        COPILOT_CLI_PORT: String(cliPort),
      },
    };

    await this.provider.create(sandboxConfig);

    // Start the Copilot CLI in headless mode inside the sandbox.
    // The custom template's entrypoint or this explicit exec starts it.
    await this.provider.exec(sandboxName, [
      'copilot', '--headless', '--port', String(cliPort),
    ], {
      timeout: this.config.startupTimeoutMs,
    });

    // Wait for the CLI to be ready
    await this.waitForCli(sandboxName, cliPort);

    const session: SandboxSession = {
      sandboxName,
      cliUrl: `localhost:${cliPort}`, // Docker Sandbox maps to host networking
      cliPort,
    };

    this.activeSandboxes.set(runId, session);
    this.logger.info(`[SandboxLifecycle] Sandbox ready for run ${runId}: ${session.cliUrl}`);
    return session;
  }

  /**
   * Destroy the sandbox for a completed/failed/cancelled run.
   */
  async destroyForRun(runId: string): Promise<void> {
    const session = this.activeSandboxes.get(runId);
    if (!session) return;

    try {
      await this.provider.remove(session.sandboxName);
      this.logger.info(`[SandboxLifecycle] Sandbox destroyed for run ${runId}`);
    } catch (err) {
      this.logger.error(`[SandboxLifecycle] Failed to destroy sandbox for run ${runId}: ${err}`);
    } finally {
      this.activeSandboxes.delete(runId);
    }
  }

  /**
   * Get the active sandbox session for a run.
   */
  getSession(runId: string): SandboxSession | undefined {
    return this.activeSandboxes.get(runId);
  }

  /**
   * Destroy all active sandboxes (server shutdown cleanup).
   */
  async destroyAll(): Promise<void> {
    const entries = [...this.activeSandboxes.entries()];
    await Promise.allSettled(
      entries.map(([runId]) => this.destroyForRun(runId)),
    );
  }

  private async waitForCli(sandboxName: string, port: number): Promise<void> {
    const maxAttempts = Math.ceil(this.config.startupTimeoutMs / 1000);
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await this.provider.exec(
          sandboxName,
          ['curl', '-sf', `http://localhost:${port}/health`],
          { timeout: 2_000 },
        );
        if (result.exitCode === 0) return;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(
      `Copilot CLI failed to start in sandbox ${sandboxName} within ${this.config.startupTimeoutMs}ms`,
    );
  }
}
```

> **Note on CLI readiness:** The exact health check mechanism depends on the Copilot CLI's server mode behavior. If `/health` is not available, alternatives include a TCP socket check on `port` or a JSON-RPC ping. This will be validated during Phase 1 implementation.

---

## 5. Modifications to Existing Files

### 5.1 AppConfig — Add Sandbox Section

**File:** `packages/shared/src/config/AppConfig.ts` (after line 55, the webhooks section)

```typescript
  sandbox: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.enum(['docker']).default('docker'),
      image: z.string().default('generatorai/sandbox:latest'),
      cliPort: z.number().default(4321),
      startupTimeoutMs: z.number().default(30_000),
      cliStartupDelayMs: z.number().default(3_000),
      /** Destroy sandbox after run completes */
      autoDestroy: z.boolean().default(true),
      /** Mount additional host directories (read-only) */
      additionalMounts: z
        .array(
          z.object({
            source: z.string(),
            target: z.string(),
            readonly: z.boolean().default(true),
          }),
        )
        .default([]),
    })
    .default({}),
```

### 5.2 CopilotAdapter — Add cliUrl Support

**File:** `packages/copilot-bridge/src/CopilotAdapter.ts`

**Change 1 — Options interface** (line 30):

```typescript
export interface CopilotAdapterOptions {
  useStdio?: boolean;
  cliUrl?: string;          // ← NEW: "host:port" for remote CLI in sandbox
  defaultCwd?: string;
  autoRestart?: boolean;
  defaultModel?: string;
  defaultTimeoutMs?: number;
  cliPath?: string;
}
```

**Change 2 — Constructor** (line 50):

```typescript
constructor(private options: CopilotAdapterOptions) {
  const clientOptions: Record<string, unknown> = {
    autoStart: false,
    autoRestart: options.autoRestart ?? true,
    cwd: options.defaultCwd,
  };

  if (options.cliUrl) {
    // Remote CLI mode — SDK connects to CLI running in sandbox
    clientOptions.cliUrl = options.cliUrl;
  } else {
    // Local CLI mode — SDK manages CLI process via stdio
    clientOptions.useStdio = options.useStdio ?? true;
  }

  this.client = new CopilotClient(clientOptions as ConstructorParameters<typeof CopilotClient>[0]);
}
```

**Important:** `useStdio` and `cliUrl` are mutually exclusive. When `cliUrl` is provided, the SDK does not spawn or manage a CLI process — from SDK docs: "When cliUrl is provided, the SDK will not spawn or manage a CLI process."

### 5.3 Handling Per-Run cliUrl (CopilotAdapter Factory)

The `cliUrl` is set at `CopilotClient` construction time, but each workflow run gets its own sandbox with its own CLI port. Since `CopilotAdapter` is lightweight (no DB, no persistent state beyond a conversation map), we create a new instance per sandbox session.

**New factory function** in `composition-root.ts`:

```typescript
function createSandboxCopilotPort(
  config: AppConfig,
  cliUrl: string,
  logger: ILogger,
): ICopilotPort {
  const adapter = new CopilotAdapter({
    cliUrl,
    defaultModel: config.copilot.defaultModel,
    defaultTimeoutMs: config.copilot.defaultTimeoutMs,
    defaultCwd: config.artifactsDir,
    autoRestart: false,  // Don't restart — sandbox manages the CLI
  });
  logger.info(`[Container] Sandbox CopilotAdapter created (cliUrl: ${cliUrl})`);
  return adapter;
}
```

### 5.4 composition-root.ts — Conditional DI Wiring

**File:** `apps/server/src/composition-root.ts`

After line 93 (`const copilot = createCopilotPort(config, logger)`), add:

```typescript
// ── Sandbox Infrastructure (conditional) ──
let sandboxProvider: ISandboxProvider | undefined;
let sandboxLifecycleManager: SandboxLifecycleManager | undefined;

if (config.sandbox.enabled) {
  sandboxProvider = new DockerSandboxProvider(logger);

  // Verify Docker Sandbox is available at startup
  const available = await sandboxProvider.isAvailable();
  if (!available) {
    throw new Error(
      'Sandbox mode is enabled but `docker sandbox` is not available. ' +
      'Install Docker Desktop with Sandbox support or disable sandbox mode.',
    );
  }

  sandboxLifecycleManager = new SandboxLifecycleManager(
    sandboxProvider,
    {
      image: config.sandbox.image,
      cliPort: config.sandbox.cliPort,
      startupTimeoutMs: config.sandbox.startupTimeoutMs,
      cliStartupDelayMs: config.sandbox.cliStartupDelayMs,
    },
    logger,
  );

  logger.info('[Container] Sandbox mode ENABLED — all execution will be sandboxed');
}
```

Then pass to the `WorkflowOrchestrator` constructor:

```typescript
const workflowOrchestrator = new WorkflowOrchestrator(
  // ... existing params ...
  sandboxLifecycleManager,  // ← NEW: optional
  sandboxProvider,          // ← NEW: optional (for creating per-run SandboxScriptRunner)
  config,                   // ← NEW: for createSandboxCopilotPort factory
);
```

### 5.5 WorkflowOrchestrator — Sandbox Lifecycle Hooks

**File:** `packages/core/src/services/WorkflowOrchestrator.ts`

**Change 1 — Constructor**: Add optional sandbox dependencies:

```typescript
constructor(
  // ... existing params ...
  private readonly sandboxLifecycleManager?: SandboxLifecycleManager,
  private readonly sandboxProvider?: ISandboxProvider,
  private readonly appConfig?: AppConfig,
) {}
```

**Change 2 — In `executeOrchestration()`**, insert sandbox lifecycle between Phase 4 and Phase 5 (around line 447):

```typescript
      // ── Phase 4.5: Create sandbox for this run ──
      let sandboxSession: SandboxSession | undefined;
      let runCopilot: ICopilotPort = this.copilot; // default: host-managed CLI

      if (this.sandboxLifecycleManager && this.sandboxProvider && this.appConfig) {
        sandboxSession = await this.sandboxLifecycleManager.createForRun(
          run.id,
          runWorkspaceDir,
        );

        // Create a sandbox-routed script runner for this run
        const runScriptRunner = new SandboxScriptRunner(
          this.sandboxProvider,
          sandboxSession.sandboxName,
          this.logger,
        );

        // Inject the sandbox script runner into services that need it for this run
        // This is stored in the run context for StageExecutionService to use
        context.resolvedVariables['__sandboxName'] = sandboxSession.sandboxName;

        // Create a sandbox-connected CopilotAdapter for this run
        runCopilot = createSandboxCopilotPort(this.appConfig, sandboxSession.cliUrl, this.logger);

        await this.eventBus.emitGlobal({
          kind: 'workflow_run.sandbox_created',
          data: {
            workflowRunId: run.id,
            sandboxName: sandboxSession.sandboxName,
            cliUrl: sandboxSession.cliUrl,
          },
        });
      }

      // ── Phase 5: Start the DAG execution ──
      await this.workflowRunService.startRun(run.id);
```

**Change 3 — In `setupCompletionCleanup()`**, add sandbox teardown (after post-processing, before `activeContexts.delete`):

```typescript
        // ── Sandbox Cleanup ──
        if (this.sandboxLifecycleManager) {
          await this.sandboxLifecycleManager.destroyForRun(runId);
          await this.eventBus.emitGlobal({
            kind: 'workflow_run.sandbox_destroyed',
            data: { workflowRunId: runId },
          });
        }
```

**Change 4 — In error catch block**, also destroy sandbox:

```typescript
    } catch (error) {
      // ... existing error handling ...

      // Sandbox cleanup on failure
      if (this.sandboxLifecycleManager) {
        await this.sandboxLifecycleManager.destroyForRun(run.id);
      }

      // ... existing cleanup ...
    }
```

### 5.6 StageExecutionService — Per-Run Copilot Instance

**File:** `packages/core/src/services/StageExecutionService.ts`

Add a `RunExecutionContext` that carries the run-scoped sandbox resources:

```typescript
export interface RunExecutionContext {
  /** Sandbox-connected CopilotAdapter (if sandbox enabled) */
  copilot?: ICopilotPort;
  /** Sandbox-routed script runner (if sandbox enabled) */
  scriptRunner?: IScriptRunner;
}
```

In `executeStage()`, accept and use the run context:

```typescript
async executeStage(
  stageRun: StageRun,
  runContext?: RunExecutionContext,
): Promise<void> {
  const copilot = runContext?.copilot ?? this.copilot;
  // Use `copilot` for session allocation and conversation creation
  // throughout this method instead of `this.copilot`
}
```

### 5.7 HookExecutor — Function Hook Sandboxing

**File:** `packages/core/src/services/HookExecutor.ts`

Replace the `import()` path in `executeFunction()` (lines 163-179) with `scriptRunner.run()`:

```typescript
  private async executeFunction(
    config: FunctionHookConfig,
    context: HookContext,
  ): Promise<void> {
    const modulePath = path.resolve(context.workspacePath, config.modulePath);

    // Security: ensure resolved path stays within the workspace
    if (!modulePath.startsWith(path.resolve(context.workspacePath))) {
      throw new HookConfigError(
        `Module path ${config.modulePath} resolves outside workspace`,
      );
    }

    // Execute the function module in a subprocess (sandbox-safe) instead of import()
    const contextJson = JSON.stringify({
      sessionId: context.sessionId,
      workflowId: context.workflowId,
      workspacePath: context.workspacePath,
      variables: context.variables,
    });

    // Use escaped module path for require() inside the node -e script
    const escapedModulePath = modulePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const result = await this.scriptRunner.run(
      'node',
      [
        '-e',
        `const fn = require('${escapedModulePath}'); ` +
        `const ctx = JSON.parse(process.argv[1]); ` +
        `Promise.resolve((fn.default || fn)(ctx))` +
        `.then(() => process.exit(0))` +
        `.catch(e => { console.error(e.message || e); process.exit(1); })`,
        contextJson,
      ],
      { cwd: context.workspacePath },
    );

    if (result.exitCode !== 0) {
      throw new HookScriptError(
        `Function hook exited with code ${result.exitCode}: ${result.stderr}`,
      );
    }
  }
```

> **Note:** Context is passed via `process.argv[1]` instead of inline interpolation to avoid JSON injection issues. The `JSON.parse(process.argv[1])` pattern is safe because `process.argv` is a string array.

---

## 6. Docker Sandbox Template

### 6.1 Custom Template Dockerfile

**File:** `docker/sandbox-template/Dockerfile`

```dockerfile
# GeneratorAI Sandbox Template
# Based on Docker's shell sandbox with Copilot CLI pre-installed
FROM docker/sandbox-templates:shell

# The shell template already includes:
#   Ubuntu base, Git, curl, wget, Docker CLI,
#   Node.js, Python, Go, Java, sudo, common build tools

# Install GitHub Copilot CLI globally
# Update this command when the official CLI package name is confirmed
RUN npm install -g @github/copilot || echo "CLI package TBD — install manually"

# Copy convenience entrypoint
COPY entrypoint.sh /usr/local/bin/sandbox-entrypoint.sh
RUN chmod +x /usr/local/bin/sandbox-entrypoint.sh

# Default CLI port
ENV COPILOT_CLI_PORT=4321
```

### 6.2 Entrypoint Script

**File:** `docker/sandbox-template/entrypoint.sh`

```bash
#!/bin/bash
# Start Copilot CLI in headless server mode.
# Usage: docker sandbox exec <name> /usr/local/bin/sandbox-entrypoint.sh

PORT="${COPILOT_CLI_PORT:-4321}"
echo "[sandbox-entrypoint] Starting Copilot CLI in headless mode on port ${PORT}..."
exec copilot --headless --port "${PORT}"
```

### 6.3 Build & Push

```bash
cd docker/sandbox-template
docker build -t generatorai/sandbox:latest .
# For Docker Sandbox custom templates (pushes to registry):
docker build -t generatorai/sandbox:latest --push .
```

---

## 7. Implementation Phases

### Phase 1: Foundation — ISandboxProvider + DockerSandboxProvider

**Goal:** Establish the sandbox abstraction layer and verify Docker Sandbox works.

**Tasks:**
1. Create `packages/core/src/domain/ports/ISandboxProvider.ts`
2. Create `packages/core/src/infrastructure/DockerSandboxProvider.ts`
3. Add `sandbox` section to `AppConfig.ts` Zod schema
4. Build the custom Docker template (`docker/sandbox-template/`)
5. Write unit tests for `DockerSandboxProvider` (mock `execFile`)
6. Manual verification: create sandbox, exec commands, destroy

**Verification:**
```bash
docker sandbox create --name test-genai -i generatorai/sandbox:latest
docker sandbox exec test-genai -- echo "Hello from sandbox"
docker sandbox exec test-genai -- node --version
docker sandbox exec test-genai -- git --version
docker sandbox rm test-genai
```

**New files:** `ISandboxProvider.ts`, `DockerSandboxProvider.ts`, `Dockerfile`, `entrypoint.sh`
**Modified files:** `AppConfig.ts`, `packages/core/src/index.ts`

---

### Phase 2: Script Execution Bridge — SandboxScriptRunner

**Goal:** Route all `IScriptRunner.run()` calls through the sandbox.

**Tasks:**
1. Create `packages/core/src/infrastructure/SandboxScriptRunner.ts`
2. Write unit tests with mocked `ISandboxProvider`
3. Integration test: run scripts via sandbox, verify stdout/stderr/exitCode

**New files:** `SandboxScriptRunner.ts`, `SandboxScriptRunner.test.ts`

---

### Phase 3: Sandbox Lifecycle Manager

**Goal:** Per-run sandbox create/start-CLI/destroy lifecycle.

**Tasks:**
1. Create `packages/core/src/services/SandboxLifecycleManager.ts`
2. Implement `createForRun()`, `destroyForRun()`, `destroyAll()`
3. Unit tests with mocked provider
4. Integration test: full lifecycle

**New files:** `SandboxLifecycleManager.ts`, `SandboxLifecycleManager.test.ts`

---

### Phase 4: CopilotAdapter cliUrl Support

**Goal:** Connect SDK to CLI running inside the sandbox.

**Tasks:**
1. Add `cliUrl` to `CopilotAdapterOptions`
2. Modify constructor: `cliUrl` vs `useStdio` mutual exclusion
3. Add `createSandboxCopilotPort()` factory function
4. Unit test: verify `CopilotClient` constructor receives correct options

**Modified files:** `CopilotAdapter.ts`

---

### Phase 5: WorkflowOrchestrator Integration

**Goal:** Wire the sandbox lifecycle into the workflow execution pipeline.

**Tasks:**
1. Add sandbox deps to `WorkflowOrchestrator` constructor
2. Insert sandbox create in `executeOrchestration()` before Phase 5
3. Insert sandbox destroy in `setupCompletionCleanup()` and error handler
4. Add `RunExecutionContext` to `StageExecutionService`
5. Forward run context through `WorkflowRunService`

**Modified files:** `WorkflowOrchestrator.ts`, `StageExecutionService.ts`, `WorkflowRunService.ts`

---

### Phase 6: HookExecutor Function Hook Sandboxing

**Goal:** Eliminate the `import()` attack vector.

**Tasks:**
1. Replace `import(modulePath)` with `scriptRunner.run('node', ['-e', ...])`
2. Pass context via `process.argv` (not string interpolation)
3. Integration test: function hook executes via subprocess

**Modified files:** `HookExecutor.ts`

---

### Phase 7: composition-root.ts Wiring

**Goal:** Complete DI wiring with feature flag.

**Tasks:**
1. Add conditional sandbox infrastructure creation
2. Verify Docker Sandbox availability at startup (fail-fast)
3. Pass sandbox deps to `WorkflowOrchestrator`
4. Add server shutdown hook: `sandboxLifecycleManager.destroyAll()`

**Modified files:** `composition-root.ts`

---

### Phase 8: End-to-End Testing

**Goal:** Validate the full sandboxed workflow execution.

**Tests:**
| Test | Validates |
|---|---|
| Simple code generation workflow | Sandbox create → CLI start → edit_file/shell in sandbox → destroy |
| Workflow with hooks | Script hooks + function hooks execute inside sandbox |
| Workflow with git repos | Clone/commit/push execute via SandboxScriptRunner |
| Workflow failure | Sandbox destroyed on error |
| Concurrent runs | Separate sandboxes per run, no port conflicts |
| Sandbox disabled | `sandbox.enabled: false` → existing behavior unchanged |

---

### Phase 9 (Future): Chat Sandbox Support

**Goal:** Sandbox individual chat sessions.

**Tasks:**
1. Add `sandbox.chatEnabled` config flag
2. Modify `ChatService` to create per-chat sandbox
3. Sandbox persists for chat duration, destroyed on session end

---

## 8. Testing Strategy

### Unit Tests (mocked dependencies)

| Component | Mock | Key Assertions |
|---|---|---|
| `DockerSandboxProvider` | `execFile` | Correct `docker sandbox` CLI args |
| `SandboxScriptRunner` | `ISandboxProvider` | Commands forwarded, options mapped |
| `SandboxLifecycleManager` | `ISandboxProvider` | Lifecycle state machine, error handling |
| `CopilotAdapter` (cliUrl) | `CopilotClient` | `cliUrl` passed, `useStdio` absent |
| `HookExecutor` (function) | `IScriptRunner` | `node -e` called instead of `import()` |

### Integration Tests (require Docker Sandbox)

| Test | Setup | Assertions |
|---|---|---|
| Sandbox CRUD | Docker Sandbox installed | Create → exec → stop → rm |
| Script execution | Sandbox + template | `echo hello` → stdout = "hello\n" |
| CLI in sandbox | Sandbox + template + CLI | `copilot --headless --port 4321` → SDK connects |
| Git in sandbox | Sandbox + git | Clone → modify → commit works |

### E2E Tests

| Test File | Description |
|---|---|
| `sandbox-workflow-e2e.spec.ts` | Full workflow with sandbox: code gen → artifacts created |
| `sandbox-concurrent-e2e.spec.ts` | Two simultaneous runs → separate sandboxes |
| `sandbox-failure-e2e.spec.ts` | Run fails → sandbox cleaned up |
| `sandbox-hooks-e2e.spec.ts` | Script hooks + function hooks in sandbox |

---

## 9. Configuration Reference

### Full Config Example

```jsonc
{
  "sandbox": {
    "enabled": true,
    "provider": "docker",
    "image": "generatorai/sandbox:latest",
    "cliPort": 4321,
    "startupTimeoutMs": 30000,
    "cliStartupDelayMs": 3000,
    "autoDestroy": true,
    "additionalMounts": [
      {
        "source": "/path/to/shared-tools",
        "target": "/opt/tools",
        "readonly": true
      }
    ]
  }
}
```

### Environment Variable Overrides

```bash
GENAI_SANDBOX_ENABLED=true
GENAI_SANDBOX_IMAGE=generatorai/sandbox:v2
GENAI_SANDBOX_CLI_PORT=4321
```

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Docker Sandbox not available on all platforms | Blocks sandbox mode | Feature flag (`sandbox.enabled: false` default). Host mode unchanged. |
| CLI startup latency (3-10s per sandbox) | Slower run start | Future: pre-warm pool of standby sandboxes. Cache Docker layers. |
| Port conflicts with concurrent runs | Runs fail | Docker Sandbox manages port mapping per VM. Each sandbox gets its own network namespace. |
| Workspace file sync issues | Missing or stale files | Docker Sandbox mounts at same absolute path with instant sync (verified in official docs). |
| Network restrictions break git operations | Git clone/push fails | Docker Sandbox HTTP proxy allows github.com. Configure `allowedDomains` for enterprise Git hosts. |
| `import()` removal breaks function hooks | Existing function hooks fail | Only affects sandbox mode. Function hooks continue to use `import()` when `sandbox.enabled: false`. |
| CopilotClient one-cliUrl-per-instance | Can't reuse single client for multiple sandboxes | Create new `CopilotAdapter` per sandbox session. Adapter is lightweight (<1KB state). |
| Sandbox escape | Host compromise | Docker Sandbox uses microVMs with hypervisor isolation (separate kernel). deny-by-default networking. Credentials never enter VM. |

---

## Appendix A: File Inventory

### New Files (8)

| File | Package | Type |
|---|---|---|
| `packages/core/src/domain/ports/ISandboxProvider.ts` | core | Port interface |
| `packages/core/src/infrastructure/DockerSandboxProvider.ts` | core | Infrastructure adapter |
| `packages/core/src/infrastructure/SandboxScriptRunner.ts` | core | IScriptRunner adapter |
| `packages/core/src/services/SandboxLifecycleManager.ts` | core | Service |
| `docker/sandbox-template/Dockerfile` | root | Docker template |
| `docker/sandbox-template/entrypoint.sh` | root | Docker template |
| `packages/core/__tests__/DockerSandboxProvider.test.ts` | core | Unit test |
| `packages/core/__tests__/SandboxScriptRunner.test.ts` | core | Unit test |

### Modified Files (8)

| File | Changes |
|---|---|
| `packages/shared/src/config/AppConfig.ts` | Add `sandbox` Zod section |
| `packages/copilot-bridge/src/CopilotAdapter.ts` | Add `cliUrl` option, modify constructor |
| `packages/core/src/services/WorkflowOrchestrator.ts` | Sandbox lifecycle in `executeOrchestration()` + cleanup |
| `packages/core/src/services/StageExecutionService.ts` | Accept `RunExecutionContext` parameter |
| `packages/core/src/services/WorkflowRunService.ts` | Forward run context to stage execution |
| `packages/core/src/services/HookExecutor.ts` | `executeFunction()` → `scriptRunner.run('node', ...)` |
| `apps/server/src/composition-root.ts` | Conditional sandbox DI wiring |
| `packages/core/src/index.ts` | Export new types |

### Unchanged Files (Port/Adapter Pattern)

These use `IScriptRunner` / `ICopilotPort` and need **zero changes**:

- `WorkflowPreprocessor.ts` — all `scriptRunner.run()` calls
- `DataSourceResolver.ts` — `scriptRunner.run()` call
- `GitManager.ts` — all 6 git/gh `scriptRunner.run()` calls  
- `tool-factory.ts` — `toolDef.handler()` closure pattern
- All UI components, SSE streaming, database layer, event system

---

## Appendix B: Sequence Diagram — Sandboxed Workflow Run

```
User          API Server       WorkflowOrchestrator    SandboxLifecycle    DockerSandbox     CopilotSDK
  │                │                    │                     │                  │                │
  │  POST /run     │                    │                     │                  │                │
  │───────────────►│                    │                     │                  │                │
  │                │  startOrchestratedRun()                  │                  │                │
  │                │───────────────────►│                     │                  │                │
  │                │                    │                     │                  │                │
  │                │                    │  Phase 0-4: setup, clone, preprocess  │                │
  │                │                    │─────────────────────────────────────  │                │
  │                │                    │                     │                  │                │
  │                │                    │  Phase 4.5: createForRun()            │                │
  │                │                    │────────────────────►│                  │                │
  │                │                    │                     │  docker sandbox create            │
  │                │                    │                     │─────────────────►│                │
  │                │                    │                     │  docker sandbox exec copilot --headless
  │                │                    │                     │─────────────────►│                │
  │                │                    │                     │  wait for CLI ready               │
  │                │                    │                     │─────────────────►│                │
  │                │                    │  { cliUrl, sandboxName }              │                │
  │                │                    │◄────────────────────│                  │                │
  │                │                    │                     │                  │                │
  │                │                    │  new CopilotAdapter({ cliUrl })       │                │
  │                │                    │──────────────────────────────────────────────────────► │
  │                │                    │                     │                  │                │
  │                │                    │  Phase 5: startRun() → executeStage()│                │
  │                │                    │                     │                  │                │
  │                │                    │  createConversation(tools, message)   │                │
  │                │                    │──────────────────────────────────────►│  JSON-RPC/TCP  │
  │                │                    │                     │                  │◄───────────────│
  │                │                    │                     │                  │                │
  │                │                    │                     │     CLI executes edit_file, shell │
  │                │                    │                     │                  │────────────    │
  │                │                    │                     │                  │                │
  │                │  SSE events        │  streaming events   │                  │                │
  │◄───────────────│◄───────────────────│◄─────────────────────────────────────│                │
  │                │                    │                     │                  │                │
  │                │                    │  Run completed      │                  │                │
  │                │                    │                     │                  │                │
  │                │                    │  destroyForRun()    │                  │                │
  │                │                    │────────────────────►│                  │                │
  │                │                    │                     │  docker sandbox rm               │
  │                │                    │                     │─────────────────►│                │
  │                │                    │                     │                  │                │
```
