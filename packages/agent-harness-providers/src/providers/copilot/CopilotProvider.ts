// ────────────────────────────────────────────────────────────────
// CopilotProvider — IAgentHarness implementation wrapping Copilot SDK
// ────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CopilotClient, RuntimeConnection, approveAll } from '@github/copilot-sdk';
import type {
  CopilotSession,
  SessionConfig,
  SessionEvent,
  PermissionRequestResult,
  ResumeSessionConfig,
} from '@github/copilot-sdk';
import type {
  IAgentHarness,
  CreateConversationParams,
  HarnessClientState,
  HarnessClientEvent,
  HarnessModel,
  ConversationResponse,
  ConversationMessage,
  AttachmentRef,
  SendPromptOptions,
  CustomAgentConfig,
  ConversationWarning,
  HarnessAgentInfo,
  ProviderCapabilities,
} from '@generatorai/core';
import type { AgentEvent } from '@generatorai/shared';
import { HarnessSessionError, withSpan, getMeter } from '@generatorai/shared';
import { mapSdkEventToAgentEvent } from './event-mapper.js';
import { buildSdkTools } from './tool-factory.js';
import { mapPermissionKind } from './permissionMap.js';
import { buildHarnessEnv } from '../../childEnv.js';
import {
  flattenAnswer,
  fromCopilotSessionMode,
  normaliseCopilotQuestion,
  normalisePlanActions,
  resolveCopilotPlanContent,
  toCopilotAction,
  toCopilotSessionMode,
} from './plan-gate.js';

/**
 * Resolve the path to the platform-native `@github/copilot` CLI binary.
 *
 * The Copilot SDK 1.0 GA shipped a `getBundledCliPath()` helper that resolves
 * `@github/copilot/sdk` and then walks two directories up to find `index.js`.
 * That walk is buggy for pnpm layouts because `@github/copilot` does not ship
 * an `index.js` — the actual binary lives in a platform-specific sibling
 * package (`@github/copilot-{linux|darwin|win32}-{x64|arm64}`) that the loader
 * (`npm-loader.js`) chooses at runtime.
 *
 * This helper duplicates that resolution explicitly so we can supply the
 * concrete platform binary as `cliPath` to {@link CopilotClient}, sidestepping
 * the SDK's broken auto-discovery. We honour the same search order as the SDK:
 *
 *   1. Explicit override (caller-supplied `cliPath`).
 *   2. `COPILOT_CLI_PATH` environment variable.
 *   3. The platform-native `@github/copilot-{platform}-{arch}` package, which
 *      contains `app.js`/`copilot.exe`.
 *   4. The `npm-loader.js` shim shipped inside `@github/copilot` itself —
 *      good enough when the platform package can be discovered at runtime.
 *
 * Returns `undefined` if nothing is found, in which case the SDK will throw
 * its own descriptive error.
 */
function resolveCopilotCliPath(explicitPath?: string): string | undefined {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;
  const envPath = process.env['COPILOT_CLI_PATH'];
  if (envPath && existsSync(envPath)) return envPath;

  const here = fileURLToPath(import.meta.url);
  const req = createRequire(here);

  // 1. Platform-native package (Windows / macOS / Linux × x64/arm64). The
  //    package's main `exports["."]` maps to the bundled binary (e.g.
  //    `copilot.exe` on Windows, `app.js` elsewhere), so resolving the
  //    package name directly hands us the runnable entry point.
  const platform = process.platform === 'win32' ? 'win32'
                  : process.platform === 'darwin' ? 'darwin'
                  : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const platformPkg = `@github/copilot-${platform}-${arch}`;
  try {
    const resolved = req.resolve(platformPkg);
    if (existsSync(resolved)) return resolved;
  } catch {
    /* platform package not installed — try the loader */
  }

  // 2. Fallback: the npm-loader shim in @github/copilot. The package does not
  //    expose `./package.json` via exports, so resolve the loader explicitly.
  try {
    const loader = req.resolve('@github/copilot/npm-loader.js');
    if (existsSync(loader)) return loader;
  } catch {
    /* nothing more we can do */
  }
  return undefined;
}

// ── OTel Metrics ──
const meter = getMeter('copilot-bridge');
const promptCounter = meter.createCounter('copilot.prompts.total', {
  description: 'Total number of prompts sent to Copilot',
});
const promptDuration = meter.createHistogram('copilot.prompt.duration_ms', {
  description: 'Duration of Copilot prompt round-trips in milliseconds',
  unit: 'ms',
});
const activeSessions = meter.createUpDownCounter('copilot.active_sessions', {
  description: 'Number of active Copilot sessions',
});
// ORC-05 — per-conversation listener counts. The cleanup set can grow when
// a caller subscribes repeatedly without unsubscribing (e.g. component
// remount with a stale closure). Tracking the high-water mark lets ops spot
// leaks before they become memory pressure or event-emitter warnings.
const listenerHighWaterMark = meter.createUpDownCounter('copilot.listeners.high_water_mark', {
  description: 'Peak number of per-conversation SDK event listeners observed',
});
const listenerLeakWarnings = meter.createCounter('copilot.listeners.leak_warnings', {
  description: 'Count of listener-leak warnings emitted (>50 listeners on one conversation)',
});

/**
 * ORC-05 — warn threshold above which we log "listener leak suspected" and
 * bump the `copilot.listeners.leak_warnings` metric. 50 is chosen because
 * a single conversation realistically needs ~3-5 listeners (one per
 * consumer: route SSE, RunLogger, hook phases). Anything north of 50
 * almost always indicates a subscription without a matching cleanup.
 */
const LISTENER_LEAK_THRESHOLD = 50;

/**
 * W13-B1: Returns true when a model finish/stop reason indicates the response
 * was cut off before completion. Tool call arguments may be incomplete — executing
 * them risks data loss (X-2 "A truncated path handed to a delete or write tool").
 *
 * Copilot SDK uses `finishReason` on the assistant.message event; the values
 * may vary across SDK versions so we check a broad set of known truncation signals.
 */
/* W13-B1 */
function isTruncationFinishReason(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  const r = reason.toLowerCase();
  return r === 'max_tokens' || r === 'length' || r.includes('max_token') || r.includes('context_length') || r === 'token_limit';
}

export interface CopilotProviderOptions {
  useStdio?: boolean;
  /** Remote CLI URL (e.g. "localhost:4321"). Mutually exclusive with useStdio. */
  cliUrl?: string;
  defaultCwd?: string;
  autoRestart?: boolean;
  defaultModel?: string;
  defaultTimeoutMs?: number;
  cliPath?: string;
  /** Enable verbose SDK event logging (default: false). Respects GENERATORAI_LOG_LEVEL=debug. */
  verbose?: boolean;
  /** GitHub personal access token passed to the bundled Copilot CLI via the
   *  SDK's `--auth-token-env` mechanism.  When provided the CLI does not need
   *  its own stored credentials (`copilot auth login`).  Typically set via
   *  the COPILOT_GITHUB_TOKEN env-var or obtained from `gh auth token`. */
  githubToken?: string;
  /** GitHub host for Enterprise Cloud with data residency (e.g.
   *  "https://your-tenant.ghe.com/"). Forwarded to the spawned CLI as the
   *  `COPILOT_GH_HOST` env-var. Falls back to `process.env.COPILOT_GH_HOST`
   *  / `process.env.GH_HOST`. Without this, the CLI defaults to github.com
   *  and Enterprise Cloud accounts will see "not authorized to use this
   *  Copilot feature" 403s. */
  githubHost?: string;
  /**
   * Isolated config/home directory for THIS harness instance.
   *
   * Injected as `COPILOT_HOME` so two Copilot accounts can run side by side
   * without sharing a credential file or racing on writes to it.
   */
  homeDir?: string;
}

/**
 * Resolve the SDK `availableTools` whitelist. An absent OR empty list means
 * "no restriction → all built-in tools available" (the SDK would otherwise
 * treat `[]` as a literal allow-list of zero tools, disabling file/edit/bash
 * and forcing the agent to emit code as markdown). Only a non-empty,
 * wildcard-free list is forwarded as a real restriction.
 */
export function resolveAvailableTools(availableTools?: string[]): string[] | undefined {
  const hasNoRestriction =
    !availableTools || availableTools.length === 0 || availableTools.includes('*');
  return hasNoRestriction ? undefined : availableTools;
}

// W36: Maximum number of simultaneously active workspace runtimes (excluding
// the default client).  When the cap is reached the oldest-idle workspace is
// stopped (30 s grace) before a new one is created.
const MAX_CONCURRENT_RUNTIMES = 10;

/** W36: Entry in the per-workspace client registry. */
interface WorkspaceEntry {
  client: CopilotClient;
  /** Number of conversations currently pinned to this workspace. */
  refCount: number;
  /** Scheduled teardown timer (cleared if a new conversation arrives). */
  teardownTimer?: ReturnType<typeof setTimeout>;
  /** Epoch ms of last activity — used for LRU eviction. */
  lastUsedAt: number;
  /** Whether this workspace's client has been started. */
  started: boolean;
}

export class CopilotProvider implements IAgentHarness {
  private client: CopilotClient;
  private conversations = new Map<string, CopilotSession>();

  // W36 ── per-workspace runtime pool ──────────────────────────────────────
  /** Active workspace clients, keyed by absolute working-directory path. */
  private workspaceClients = new Map<string, WorkspaceEntry>(); /* W36 */
  /** Maps each conversationId to its workspace key ('__default__' or cwd). */
  private conversationClientKey = new Map<string, string>(); /* W36 */
  /**
   * Model each live session was last configured with.
   *
   * The SDK fixes the model when a session is created/resumed, so this is how
   * `resumeConversation` detects that the caller now wants a different model
   * and must rebuild the session instead of short-circuiting.
   */
  private conversationModels = new Map<string, string>();
  private clientEventHandlers = new Set<(event: HarnessClientEvent) => void>();
  private clientStatePollingInterval?: ReturnType<typeof setInterval>;
  /** Tracks active event listener cleanup functions per conversation.
   *  Used to prevent handler leaks when resumeConversation replaces the SDK session handle. */
  private conversationListenerCleanups = new Map<string, Set<() => void>>();
  /**
   * ORC-05 — per-conversation "have we already warned?" flag so we don't
   * spam logs once a leak has been flagged. Reset when the conversation is
   * deleted or torn down.
   */
  private conversationLeakWarned = new Set<string>();
  /**
   * HITL-07 — per-conversation "permission request in-flight" flag.
   * `sendPromptAndWait`'s `defaultTimeoutMs` guard must not fire while
   * the harness is intentionally waiting on a human approval, otherwise
   * a slow approver causes a spurious stage failure. The onPermissionRequest
   * wrapper sets this flag while waiting on the domain handler, and clears
   * it once resolved. `sendPromptAndWait` checks it via a rolling-window
   * timer so the timeout only ticks when the harness is actually idle
   * from the SDK's side (not because of us).
   */
  private permissionPending = new Map<string, number>();

  /**
   * PLN-01 — assistant text accumulated during the current turn, used as a
   * fallback plan source because `ExitPlanModeRequest.planContent` is declared
   * OPTIONAL by the SDK. Reset on every turn start.
   */
  private turnText = new Map<string, string>();
  /** Detaches the internal turn-text listener for a conversation. */
  private turnTextTrackers = new Map<string, () => void>();
  /**
   * PLN-01 — last agent mode successfully applied to each session via
   * `session.rpc.mode.set`. See {@link applySessionMode} for why the
   * per-message `agentMode` field is not sufficient on its own.
   */
  private sessionModes = new Map<string, NonNullable<SendPromptOptions['agentMode']>>();
  /** Warnings raised while translating the last create/resume for a conversation. */
  private conversationWarnings = new Map<string, ConversationWarning[]>();
  /** Agents registered on each conversation, so `listAgents` needs no SDK round-trip. */
  private conversationAgents = new Map<string, HarnessAgentInfo[]>();
  private verbose: boolean;
  /**
   * Locally-tracked client connection state. The Copilot SDK 1.0 GA removed the
   * synchronous `getState()` connection accessor (only async `getStatus()` for
   * CLI version info remains), so the adapter maintains its own view: updated by
   * the lifecycle methods and by the health poll, and returned synchronously
   * from {@link getClientState}.
   */
  private clientState: HarnessClientState = 'stopped';
  /** Consecutive failed liveness probes — used to debounce transient hiccups. */
  private consecutivePollFailures = 0;

  constructor(private options: CopilotProviderOptions) {
    this.verbose = options.verbose ?? (process.env.GENERATORAI_LOG_LEVEL === 'debug');

    // SDK 1.0 GA: the `CopilotClient` constructor takes a completely reshaped
    // options object. Notably:
    //   - `cwd` → `workingDirectory`
    //   - `githubToken` → `gitHubToken`
    //   - `cliPath`/`useStdio` → `connection: RuntimeConnection.forStdio({ path })`
    //   - `cliUrl` → `connection: RuntimeConnection.forUri(url)`
    //   - `autoStart`/`autoRestart` removed (`start()` is always manual)
    //
    // `cliUrl` and `cliPath` remain mutually exclusive at our provider level —
    // a remote runtime is selected by `cliUrl`, otherwise we spawn the bundled
    // CLI ourselves (pre-resolving the platform binary because the SDK's
    // bundled discovery is broken on pnpm hoisted layouts).
    const clientOptions: Record<string, unknown> = {
      workingDirectory: options.defaultCwd,
    };

    if (options.cliUrl) {
      try {
        new URL(`http://${options.cliUrl}`);
      } catch {
        throw new Error(`Invalid cliUrl format: "${options.cliUrl}". Expected "host:port" format.`);
      }
      clientOptions['connection'] = RuntimeConnection.forUri(options.cliUrl);
    } else {
      const resolvedCli = resolveCopilotCliPath(options.cliPath);
      clientOptions['connection'] = RuntimeConnection.forStdio(
        resolvedCli ? { path: resolvedCli } : undefined,
      );
    }

    // Auth — when a GitHub token is provided, forward it to the bundled CLI
    // via the SDK's --auth-token-env mechanism so the CLI does not require its
    // own stored credentials.  Falls back to GITHUB_TOKEN / GH_TOKEN from the
    // current process environment (the SDK already passes process.env to the
    // CLI subprocess, so those env-vars work even without this explicit path).
    //
    // BUT: when a GHEC (data-residency) host is configured we must NOT trust
    // ambient env-var tokens. VS Code's Copilot extension injects
    // `COPILOT_GITHUB_TOKEN` into spawned terminals — that token belongs to
    // github.com and produces 401 "Bad credentials" when validated against a
    // `*.ghe.com` tenant. In that case we fall back to the CLI's own stored
    // credentials (Windows Credential Manager / `~/.copilot/`).
    const ghHost =
      options.githubHost ??
      process.env['COPILOT_GH_HOST'] ??
      process.env['GH_HOST'];
    const ambientToken =
      process.env['COPILOT_GITHUB_TOKEN'] ??
      process.env['GITHUB_TOKEN'] ??
      process.env['GH_TOKEN'];
    const githubToken =
      options.githubToken ?? (ghHost ? undefined : ambientToken);
    if (githubToken) {
      clientOptions['gitHubToken'] = githubToken;
    }

    // GitHub Enterprise Cloud (data residency) hosts — e.g.
    // `https://<tenant>.ghe.com/`. The CLI honours `COPILOT_GH_HOST` (and
    // `GH_HOST` as a fallback). The SDK forwards `process.env` to the spawned
    // CLI by default, but only when `env` is omitted. Once we pass any custom
    // env we have to merge in the host explicitly, and we also forward
    // process-level values so users who set them at the shell level still
    // reach the runtime untouched. We strip the ambient tokens so the CLI
    // doesn't read them itself (`COPILOT_GITHUB_TOKEN`, `GITHUB_TOKEN`,
    // `GH_TOKEN` are documented to take precedence over stored credentials).
    // ── Child environment ──────────────────────────────────────────
    //
    // Built from an explicit allowlist rather than by cloning `process.env`.
    // The server process holds the secret-vault key, the desktop admin token,
    // the database credentials and other providers' API keys; the Copilot CLI
    // executes model-authored tool calls, so it must receive only what it
    // actually needs. See `childEnv.ts`.
    //
    // GHEC (data-residency) note: when a `*.ghe.com` host is configured we
    // deliberately do NOT forward an ambient github.com token — VS Code
    // injects `COPILOT_GITHUB_TOKEN` into spawned terminals, and that token
    // 401s against a tenant host. The allowlist gives us this for free: the
    // token only appears when we inject it.
    clientOptions['env'] = buildHarnessEnv({
      passthrough: ['COPILOT_CLI_PATH'],
      extra: {
        ...(ghHost ? { COPILOT_GH_HOST: ghHost } : {}),
        // Just-in-time credential injection: only the token this provider was
        // explicitly configured with, and never on a mismatched host.
        ...(githubToken ? { COPILOT_GITHUB_TOKEN: githubToken } : {}),
        ...(options.homeDir ? { COPILOT_HOME: options.homeDir } : {}),
      },
    });

    this.client = new CopilotClient(clientOptions as ConstructorParameters<typeof CopilotClient>[0]);
  }

  // ── W36: Per-workspace runtime pool ─────────────────────────────────────

  /**
   * W36 — Build a CopilotClient for a specific workspace cwd.
   * Re-uses the same connection options as the default client but overrides
   * `workingDirectory` so each workspace gets its own CLI subprocess.
   */
  private buildWorkspaceClient(cwd: string): CopilotClient {
    const options = this.options;
    const clientOptions: Record<string, unknown> = { workingDirectory: cwd };
    if (options.cliUrl) {
      clientOptions['connection'] = RuntimeConnection.forUri(options.cliUrl);
    } else {
      const resolvedCli = resolveCopilotCliPath(options.cliPath);
      clientOptions['connection'] = RuntimeConnection.forStdio(
        resolvedCli ? { path: resolvedCli } : undefined,
      );
    }
    const ghHost = options.githubHost ?? process.env['COPILOT_GH_HOST'] ?? process.env['GH_HOST'];
    const ambientToken = process.env['COPILOT_GITHUB_TOKEN'] ?? process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
    const githubToken = options.githubToken ?? (ghHost ? undefined : ambientToken);
    if (githubToken) clientOptions['gitHubToken'] = githubToken;
    clientOptions['env'] = buildHarnessEnv({
      passthrough: ['COPILOT_CLI_PATH'],
      extra: {
        ...(ghHost ? { COPILOT_GH_HOST: ghHost } : {}),
        ...(githubToken ? { COPILOT_GITHUB_TOKEN: githubToken } : {}),
        ...(options.homeDir ? { COPILOT_HOME: options.homeDir } : {}),
      },
    });
    return new CopilotClient(clientOptions as ConstructorParameters<typeof CopilotClient>[0]);
  }

  /**
   * W36 — Get or create the WorkspaceEntry for a given cwd.
   * Returns null if `cwd` matches the default workspace (use `this.client`).
   */
  private async getOrCreateWorkspaceEntry(cwd: string | undefined): Promise<WorkspaceEntry | null> {
    const defaultCwd = this.options.defaultCwd;
    if (!cwd || cwd === defaultCwd) return null; // use default client

    const existing = this.workspaceClients.get(cwd);
    if (existing) {
      // Cancel any pending teardown
      if (existing.teardownTimer) {
        clearTimeout(existing.teardownTimer);
        existing.teardownTimer = undefined;
      }
      existing.lastUsedAt = Date.now();
      return existing;
    }

    // Enforce LRU cap before creating a new entry
    if (this.workspaceClients.size >= MAX_CONCURRENT_RUNTIMES) {
      await this.evictLruWorkspace();
    }

    const client = this.buildWorkspaceClient(cwd);
    const entry: WorkspaceEntry = { client, refCount: 0, lastUsedAt: Date.now(), started: false };
    this.workspaceClients.set(cwd, entry);

    // Start lazily; if the default client isn't running yet, skip (we'll start on first use)
    if (this.clientState === 'running') {
      try {
        await client.start();
        entry.started = true;
      } catch (err) {
        this.workspaceClients.delete(cwd);
        throw err;
      }
    }
    return entry;
  }

  /**
   * W36 — Evict the least-recently-used idle workspace (refCount === 0).
   * If no idle workspace exists, evicts the LRU regardless of ref count.
   */
  private async evictLruWorkspace(): Promise<void> {
    let lruKey: string | undefined;
    let lruTime = Infinity;
    // Prefer idle workspaces first
    for (const [key, entry] of this.workspaceClients) {
      if (entry.refCount === 0 && entry.lastUsedAt < lruTime) {
        lruTime = entry.lastUsedAt;
        lruKey = key;
      }
    }
    // Fallback: any LRU workspace
    if (!lruKey) {
      lruTime = Infinity;
      for (const [key, entry] of this.workspaceClients) {
        if (entry.lastUsedAt < lruTime) {
          lruTime = entry.lastUsedAt;
          lruKey = key;
        }
      }
    }
    if (lruKey) {
      const entry = this.workspaceClients.get(lruKey)!;
      this.workspaceClients.delete(lruKey);
      if (entry.teardownTimer) clearTimeout(entry.teardownTimer);
      if (entry.started) {
        try { await entry.client.stop(); } catch { /* best-effort */ }
      }
    }
  }

  /**
   * W36 — Return the CopilotClient that owns `conversationId`.
   * Falls back to `this.client` (the default workspace).
   */
  private clientForConversation(conversationId: string): CopilotClient {
    const key = this.conversationClientKey.get(conversationId);
    if (key && key !== '__default__') {
      const entry = this.workspaceClients.get(key);
      if (entry) return entry.client;
    }
    return this.client;
  }

  /**
   * W36 — Release the workspace client ref for a conversation.
   * When refCount hits 0, schedules a 30 s graceful teardown.
   */
  private releaseWorkspaceRef(conversationId: string): void {
    const key = this.conversationClientKey.get(conversationId);
    this.conversationClientKey.delete(conversationId);
    if (!key || key === '__default__') return;

    const entry = this.workspaceClients.get(key);
    if (!entry) return;

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0) {
      // Schedule a 30 s grace teardown
      entry.teardownTimer = setTimeout(async () => {
        const current = this.workspaceClients.get(key);
        if (current && current.refCount === 0) {
          this.workspaceClients.delete(key);
          if (current.started) {
            try { await current.client.stop(); } catch { /* best-effort */ }
          }
        }
      }, 30_000);
    }
  }

  // ── Client Lifecycle ──

  async initialize(): Promise<void> {
    return withSpan('copilot-bridge', 'copilot.initialize', async () => {
      try {
        await this.client.start();
      } catch (err) {
        // Surface a failed start as 'error' rather than leaving the default
        // 'stopped' — getClientState() should reflect that start was attempted.
        this.clientState = 'error';
        throw err;
      }
      this.clientState = 'running';
      this.emitClientEvent({ type: 'client.started' });
      this.startClientStatePolling();
    });
  }

  async stop(): Promise<void> {
    return withSpan('copilot-bridge', 'copilot.stop', async () => {
      this.stopClientStatePolling();
      await this.client.stop();
      this.clientState = 'stopped';
      this.emitClientEvent({ type: 'client.stopped' });
    });
  }

  async forceStop(): Promise<void> {
    this.stopClientStatePolling();
    await this.client.forceStop();
    // W36: also force-stop all workspace clients
    for (const [key, entry] of this.workspaceClients) {
      if (entry.teardownTimer) clearTimeout(entry.teardownTimer);
      if (entry.started) {
        try { await entry.client.forceStop(); } catch { /* best-effort */ }
      }
      this.workspaceClients.delete(key);
    }
    // Force-stop skips graceful session.disconnect() (the CLI is already gone),
    // but we must still run listener cleanups and drop in-memory handles —
    // otherwise conversations + their SDK event listeners leak when forceStop()
    // is called without a following shutdown().
    this.cleanupAllConversations();
    this.clientState = 'stopped';
    this.emitClientEvent({ type: 'client.stopped', data: { message: 'Force stopped' } });
  }

  /**
   * Run every conversation's listener cleanups and drop all in-memory
   * conversation state. Shared by {@link shutdown} and {@link forceStop} so
   * neither leaks SDK session handles or per-conversation event listeners.
   */
  private cleanupAllConversations(): void {
    for (const cleanups of this.conversationListenerCleanups.values()) {
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          /* best-effort */
        }
      }
    }
    this.conversationListenerCleanups.clear();
    this.conversationLeakWarned.clear();
    this.conversations.clear();
    this.conversationClientKey.clear(); /* W36 */
  }

  getClientState(): HarnessClientState {
    return this.clientState;
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
    for (const [_id, session] of this.conversations) {
      await session.disconnect();
    }
    // Run listener cleanups + drop all in-memory conversation state (not just
    // the conversations map) so no per-conversation SDK listeners leak.
    this.cleanupAllConversations();
    await this.client.stop();
    // W36: gracefully stop all workspace clients
    for (const [key, entry] of this.workspaceClients) {
      if (entry.teardownTimer) clearTimeout(entry.teardownTimer);
      if (entry.started) {
        try { await entry.client.stop(); } catch { /* best-effort */ }
      }
      this.workspaceClients.delete(key);
    }
    this.clientState = 'stopped';
    this.emitClientEvent({ type: 'client.stopped' });
  }

  // ── Model Discovery ──

  async getModels(): Promise<HarnessModel[]> {
    // SDK method is listModels(), returns ModelInfo[]. We surface the full
    // capability/billing metadata so the UI can drive the model picker
    // (context window, reasoning-effort levels, pricing) from the provider
    // instead of hardcoding it.
    const sdkModels = await this.client.listModels();
    return sdkModels.map((m) => {
      // Some fields (category, price tier) live on the richer runtime `Model`
      // shape but aren't declared on the typed `ModelInfo`; read them
      // defensively so we forward them when present.
      const raw = m as unknown as {
        modelPickerCategory?: string;
        modelPickerPriceCategory?: string;
      };
      const supports = m.capabilities?.supports;
      const limits = m.capabilities?.limits as
        | { max_context_window_tokens?: number; max_output_tokens?: number }
        | undefined;
      const tokenPrices = m.billing?.tokenPrices;

      const model: HarnessModel = {
        id: m.id,
        name: m.name,
        provider: undefined,
      };
      if (raw.modelPickerCategory) model.category = raw.modelPickerCategory;
      if (raw.modelPickerPriceCategory) model.priceCategory = raw.modelPickerPriceCategory;
      const maxOutput =
        typeof limits?.max_output_tokens === 'number' ? limits.max_output_tokens : undefined;
      if (maxOutput != null) model.maxOutputTokens = maxOutput;

      // `max_context_window_tokens` is the model's TOTAL window — prompt plus
      // completion. The gauge (and the SDK's own `usage_info.tokenLimit`)
      // measures against the PROMPT budget, so derive that explicitly instead
      // of showing the total and letting the two disagree.
      if (typeof limits?.max_context_window_tokens === 'number') {
        model.totalContextWindow = limits.max_context_window_tokens;
        model.contextWindow = limits.max_context_window_tokens; // deprecated alias
        model.promptTokenLimit = Math.max(0, limits.max_context_window_tokens - (maxOutput ?? 0));
      }
      if (typeof supports?.vision === 'boolean') model.supportsVision = supports.vision;
      if (typeof supports?.reasoningEffort === 'boolean') {
        model.supportsReasoning = supports.reasoningEffort;
      }
      if (m.supportedReasoningEfforts?.length) {
        model.reasoningEfforts = [...m.supportedReasoningEfforts];
      }
      if (m.defaultReasoningEffort) model.defaultReasoningEffort = m.defaultReasoningEffort;
      if (typeof m.billing?.multiplier === 'number') {
        model.billingMultiplier = m.billing.multiplier;
      }
      if (tokenPrices) {
        model.pricing = {};
        if (typeof tokenPrices.inputPrice === 'number') model.pricing.input = tokenPrices.inputPrice;
        if (typeof tokenPrices.outputPrice === 'number') model.pricing.output = tokenPrices.outputPrice;
        if (typeof tokenPrices.cachePrice === 'number') model.pricing.cached = tokenPrices.cachePrice;
        if (typeof tokenPrices.batchSize === 'number') model.pricing.batchSize = tokenPrices.batchSize;
        // `contextMax` is the DEFAULT tier's prompt budget; when a long-context
        // tier exists, `max_context_window_tokens` describes that larger tier.
        if (typeof tokenPrices.contextMax === 'number' && tokenPrices.contextMax > 0) {
          const longPromptLimit = model.promptTokenLimit;
          const longTotal = model.totalContextWindow;
          model.promptTokenLimit = tokenPrices.contextMax;
          model.standardContextWindow = tokenPrices.contextMax; // deprecated alias
          model.totalContextWindow = tokenPrices.contextMax + (maxOutput ?? 0);
          if (tokenPrices.longContext && longPromptLimit != null && longPromptLimit > tokenPrices.contextMax) {
            model.supportsLongContext = true;
            model.longContext = {
              promptTokenLimit: longPromptLimit,
              ...(longTotal != null ? { totalContextWindow: longTotal } : {}),
            };
            model.contextWindow = longTotal ?? model.contextWindow; // deprecated alias
          } else {
            model.contextWindow = model.totalContextWindow; // deprecated alias
          }
        }
      }
      return model;
    });
  }

  // ── Conversation Lifecycle ──

  /**
   * Map the domain agent surface onto `SessionConfig` / `ResumeSessionConfig`.
   * Shared by create and resume: the two used to drift, which silently dropped
   * agents and MCP servers after a restart.
   */
  private applyAgentConfig(
    config: SessionConfig | ResumeSessionConfig,
    params: CreateConversationParams,
    warnings: ConversationWarning[],
  ): HarnessAgentInfo[] {
    const registered: HarnessAgentInfo[] = [];

    if (params.customAgents?.length) {
      config.customAgents = params.customAgents.map((a: CustomAgentConfig) => {
        registered.push({
          name: a.name,
          ...(a.description ? { description: a.description } : {}),
          ...(a.model ? { model: a.model } : {}),
          source: 'programmatic',
        });
        if (a.disallowedTools?.length) {
          // Copilot has no per-agent deny-list; fold it into the session exclusions.
          const existing = Array.isArray(config.excludedTools) ? config.excludedTools : [];
          config.excludedTools = [...existing, ...a.disallowedTools];
          warnings.push({
            code: 'FIELD_COERCED',
            params: { field: 'customAgents[].disallowedTools', to: 'excludedTools', agent: a.name },
          });
        }
        for (const unsupported of ['permissionMode', 'maxTurns', 'background'] as const) {
          if (a[unsupported] !== undefined) {
            warnings.push({
              code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
              params: { field: `customAgents[].${unsupported}`, provider: 'copilot', agent: a.name },
            });
          }
        }
        return {
          name: a.name,
          ...(a.displayName ? { displayName: a.displayName } : {}),
          description: a.description,
          prompt: a.instructions,
          ...(a.tools ? { tools: a.tools } : {}),
          ...(a.model ? { model: a.model } : {}),
          ...(a.reasoningEffort ? { reasoningEffort: a.reasoningEffort } : {}),
          ...(a.skills ? { skills: a.skills } : {}),
          ...(a.mcpServers
            ? { mcpServers: a.mcpServers as NonNullable<SessionConfig['customAgents']>[number]['mcpServers'] }
            : {}),
          ...(a.infer !== undefined ? { infer: a.infer } : {}),
        };
      });
    }

    // Activating a named agent replaces the provider's base system prompt. Only do
    // it when the caller explicitly asked for native projection.
    if (params.defaultAgent && params.agentProjection === 'native') {
      const known = params.customAgents?.some((a) => a.name === params.defaultAgent);
      if (known) {
        (config as SessionConfig).agent = params.defaultAgent;
      } else {
        warnings.push({ code: 'AGENT_NOT_REGISTERED', params: { agent: params.defaultAgent } });
      }
    }

    if (params.excludedBuiltinTools?.length) {
      config.defaultAgent = { excludedTools: params.excludedBuiltinTools };
    }

    if (params.mcpServers) {
      config.mcpServers = params.mcpServers as SessionConfig['mcpServers'];
    }

    if (params.skillDirectories) config.skillDirectories = params.skillDirectories;
    if (params.disabledSkills) config.disabledSkills = params.disabledSkills;

    if (params.provider) {
      config.provider = {
        baseUrl: params.provider.baseUrl,
        apiKey: params.provider.apiKey,
      };
      if (params.provider.model) {
        warnings.push({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
          params: { field: 'provider.model', provider: 'copilot' },
        });
      }
    }

    if (params.maxTurns !== undefined) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: 'maxTurns', provider: 'copilot' },
      });
    }

    return registered;
  }

  async createConversation(params: CreateConversationParams): Promise<string> {
    return withSpan('copilot-bridge', 'copilot.createConversation', async (span) => {
      span.setAttribute('copilot.conversation_id', params.conversationId);
      span.setAttribute('copilot.model', params.model ?? 'claude-sonnet-4.6');

    const warnings: ConversationWarning[] = [];
    const sdkTools = buildSdkTools(params.tools ?? []);

    const systemMessage = params.systemMessage
      ? { mode: params.systemMessage.mode, content: params.systemMessage.content }
      : params.systemPromptAppend
        ? { mode: 'append' as const, content: params.systemPromptAppend }
        : undefined;

    // Resolve availableTools to the SDK's tool whitelist.
    // The SDK treats `availableTools` as a literal allow-list: a NON-EMPTY array
    // restricts tools to exactly those names, and ['*'] / [] are NOT understood
    // as wildcards — an empty array would disable EVERY built-in tool (create,
    // edit, bash, …), leaving the agent unable to write files and forcing it to
    // emit code as markdown. That is never the intent here: an absent or empty
    // whitelist means "no restriction → all tools available". Only a non-empty,
    // wildcard-free list is forwarded as an actual restriction.
    const resolvedAvailableTools = resolveAvailableTools(params.availableTools);

    // Phase 2, 2.23 — fall back to adapter-level `defaultModel` if the caller
    // didn't specify one. The hardcoded `'claude-sonnet-4.6'` remains the final backstop
    // (chosen as a fast, generally-available model — `auto` would be more flexible
    // but currently routes some tenants to slow/unresponsive variants like
    // `gpt-5.3-codex`).
    const resolvedModel = params.model ?? this.options.defaultModel ?? 'claude-sonnet-4.6';
    const sessionConfig: SessionConfig = {
      sessionId: params.conversationId,
      model: resolvedModel,
      streaming: params.streaming ?? true,
      tools: sdkTools,
      systemMessage,
      skillDirectories: params.skillDirectories,
      disabledSkills: params.disabledSkills,
      availableTools: resolvedAvailableTools,
      excludedTools: params.excludedTools,
      // SDK 1.0 GA renamed `configDir` → `configDirectory`.
      configDirectory: params.configDir,
      workingDirectory: params.workingDirectory,
      // SDK 1.0: reasoningEffort for models that support it
      reasoningEffort: params.reasoningEffort,
      // SDK 1.0: contextTier ('default' | 'long_context') pins the long-context
      // window for models that expose one.
      contextTier: params.contextTier,
      // FEAT-2: maxTurns is part of the domain harness config but the Copilot
      // SDK SessionConfig has no turn-limit field (it manages long sessions via
      // `infiniteSessions` context compaction instead). The Claude Agent
      // provider DOES honor maxTurns. Rather than silently drop it, warn so the
      // mismatch is visible; switch harness.type to 'claude-agent' to enforce a
      // hard turn cap.
      // SDK 1.0: onPermissionRequest is now required on SessionConfig.
      // Default to approveAll; overridden below if params.onPermissionRequest is provided.
      onPermissionRequest: approveAll,
    };
    // Copilot has no `Options.skills` equivalent: an explicit allow-list is
    // expressed by disabling everything outside it.
    if (params.skills && params.disabledSkills === undefined) {
      sessionConfig.enableSkills = true;
    }

    const registeredAgents = this.applyAgentConfig(sessionConfig, params, warnings);

    // HKS-01 — Bridge the domain `HookBridge` to the SDK's native
    // `SessionHooks`. The domain shape is intentionally field-compatible;
    // the only real translation is on `onPreToolUse` where our `decision`
    // field maps to the SDK's `permissionDecision`. Keeping this
    // translation in the adapter (not the caller) means other harnesses
    // can provide their own one-line mapping against the same domain shape.
    if (params.hooks) {
      const domainHooks = params.hooks;
      sessionConfig.hooks = {
        ...(domainHooks.onPreToolUse && {
          onPreToolUse: async (input, invocation) => {
            const out = await domainHooks.onPreToolUse!(
              {
                timestamp: input.timestamp.getTime(),
                cwd: input.workingDirectory,
                toolName: input.toolName,
                toolArgs: input.toolArgs,
              },
              { sessionId: invocation.sessionId },
            );
            if (!out) return;
            return {
              permissionDecision: out.decision,
              permissionDecisionReason: out.reason,
              modifiedArgs: out.modifiedArgs,
              additionalContext: out.additionalContext,
              suppressOutput: out.suppressOutput,
            };
          },
        }),
        ...(domainHooks.onPostToolUse && {
          onPostToolUse: async (input, invocation) => {
            const out = await domainHooks.onPostToolUse!(
              {
                timestamp: input.timestamp.getTime(),
                cwd: input.workingDirectory,
                toolName: input.toolName,
                toolArgs: input.toolArgs,
                toolResult: input.toolResult,
              },
              { sessionId: invocation.sessionId },
            );
            if (!out) return;
            // SDK's `modifiedResult` is a `ToolResultObject`; the bridge
            // delivers `unknown` so callers can stay harness-agnostic.
            // Cast here (in the adapter) instead of in the caller.
            return {
              modifiedResult: out.modifiedResult as Parameters<
                NonNullable<NonNullable<SessionConfig['hooks']>['onPostToolUse']>
              >[0]['toolResult'],
              additionalContext: out.additionalContext,
              suppressOutput: out.suppressOutput,
            };
          },
        }),
        ...(domainHooks.onUserPromptSubmitted && {
          onUserPromptSubmitted: async (input, invocation) => {
            const out = await domainHooks.onUserPromptSubmitted!(
              { timestamp: input.timestamp.getTime(), cwd: input.workingDirectory, prompt: input.prompt },
              { sessionId: invocation.sessionId },
            );
            if (!out) return;
            return {
              modifiedPrompt: out.modifiedPrompt,
              additionalContext: out.additionalContext,
              suppressOutput: out.suppressOutput,
            };
          },
        }),
        ...(domainHooks.onSessionStart && {
          onSessionStart: async (input, invocation) => {
            const out = await domainHooks.onSessionStart!(
              {
                timestamp: input.timestamp.getTime(),
                cwd: input.workingDirectory,
                source: input.source,
                initialPrompt: input.initialPrompt,
              },
              { sessionId: invocation.sessionId },
            );
            if (!out) return;
            return {
              additionalContext: out.additionalContext,
              modifiedConfig: out.modifiedConfig,
            };
          },
        }),
        ...(domainHooks.onSessionEnd && {
          onSessionEnd: async (input, invocation) => {
            const out = await domainHooks.onSessionEnd!(
              {
                timestamp: input.timestamp.getTime(),
                cwd: input.workingDirectory,
                reason: input.reason,
                finalMessage: input.finalMessage,
                error: input.error,
              },
              { sessionId: invocation.sessionId },
            );
            if (!out) return;
            return {
              suppressOutput: out.suppressOutput,
              cleanupActions: out.cleanupActions,
              sessionSummary: out.sessionSummary,
            };
          },
        }),
        ...(domainHooks.onErrorOccurred && {
          onErrorOccurred: async (input, invocation) => {
            const out = await domainHooks.onErrorOccurred!(
              {
                timestamp: input.timestamp.getTime(),
                cwd: input.workingDirectory,
                error: input.error,
                errorContext: input.errorContext,
                recoverable: input.recoverable,
              },
              { sessionId: invocation.sessionId },
            );
            if (!out) return;
            return {
              suppressOutput: out.suppressOutput,
              errorHandling: out.errorHandling,
              retryCount: out.retryCount,
              userNotification: out.userNotification,
            };
          },
        }),
      };
    }

    // Map permission handler: domain uses {type, granted} → SDK uses {kind, PermissionRequestResult}
    // ORC-06 — `mapPermissionKind` is typed against the SDK's own
    // `PermissionRequest['kind']` union, so adding a new SDK kind without a
    // mapping fails at build time. See `permissionMap.ts` for the rationale.
    if (params.onPermissionRequest) {
      const capturedConvId = params.conversationId;
      sessionConfig.onPermissionRequest = async (sdkRequest, _invocation) => {
        // HITL-07 — mark the conversation as "waiting on human" so
        // sendPromptAndWait's watchdog timer pauses. Increment/decrement
        // rather than a boolean so nested/concurrent requests all track.
        const prev = this.permissionPending.get(capturedConvId) ?? 0;
        this.permissionPending.set(capturedConvId, prev + 1);
        try {
          const result = await params.onPermissionRequest!({
            type: mapPermissionKind(sdkRequest.kind),
            description: String(sdkRequest.kind),
            details: sdkRequest as unknown as Record<string, unknown>,
          });
          // SDK 1.0: PermissionDecision uses new 'approve-once' / 'reject' kinds
          return (
            result.granted
              ? { kind: 'approve-once' as const }
              : { kind: 'reject' as const }
          ) satisfies PermissionRequestResult;
        } finally {
          const cur = this.permissionPending.get(capturedConvId) ?? 1;
          if (cur <= 1) this.permissionPending.delete(capturedConvId);
          else this.permissionPending.set(capturedConvId, cur - 1);
        }
      };
    }

    if (this.verbose) console.log(`[CopilotAdapter] Creating session ${params.conversationId} with workingDirectory=${params.workingDirectory ?? '(not set)'}`);
    // PLN-01 — install the native plan-mode gates. Applied to BOTH create and
    // resume; a handler missing on the resume path silently kills plan mode
    // after a server restart.
    this.installPlanGates(sessionConfig, params);
    // W36 — route to the workspace-specific client when workingDirectory is set
    // and differs from the default.  getOrCreateWorkspaceEntry is a no-op when
    // the cwd matches the default, returning null (→ use this.client).
    const workspaceEntry = await this.getOrCreateWorkspaceEntry(params.workingDirectory); /* W36 */
    const createClient = workspaceEntry ? workspaceEntry.client : this.client; /* W36 */
    const session = await createClient.createSession(sessionConfig);
    // W36 — record which workspace owns this conversation
    const wsKey = params.workingDirectory && workspaceEntry ? params.workingDirectory : '__default__'; /* W36 */
    this.conversationClientKey.set(params.conversationId, wsKey); /* W36 */
    if (workspaceEntry) { workspaceEntry.refCount++; workspaceEntry.lastUsedAt = Date.now(); } /* W36 */
    this.attachTurnTextTracker(params.conversationId, session);
    this.conversations.set(params.conversationId, session);
    this.conversationModels.set(params.conversationId, resolvedModel);
    this.conversationWarnings.set(params.conversationId, warnings);
    this.conversationAgents.set(params.conversationId, registeredAgents);
    activeSessions.add(1);
    return params.conversationId;
    });
  }

  /**
   * Rehydrate a previously-created SDK session by id.
   *
   * Phase 2, 2.24 — semantics clarified:
   *   - **If the session is in-memory**, this is a no-op. Calling
   *     `resumeSession` on an active session would produce a second SDK
   *     `CopilotSession` handle that does not inherit the original's
   *     `tools`/`streaming`/permission config — splitting the event stream
   *     and breaking single-session mode across stages. We skip instead.
   *   - **If the session is not in-memory** (e.g. after a server restart),
   *     we call `client.resumeSession(id)` which rebinds the SDK's persistent
   *     session state. Existing listener cleanups from the prior handle are
   *     released before we install the new one so handlers don't leak.
   *
   * This method does NOT transition SDK session state — the SDK treats
   * resume as idempotent against persistent storage only.
   */
  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    // A live session already has its model baked in, so only short-circuit
    // when the caller isn't asking for a different one.
    const liveSession = this.conversations.get(conversationId);
    const currentModel = this.conversationModels.get(conversationId);
    const modelChanged = !!params?.model && !!currentModel && params.model !== currentModel;

    if (liveSession && !modelChanged) {
      if (this.verbose) console.log(`[CopilotAdapter] Session ${conversationId} already in memory, skipping resume`);
      return;
    }

    if (liveSession && modelChanged) {
      // Switch the model IN PLACE via the SDK's dedicated `setModel`.
      //
      // Do NOT try to do this by disconnecting and calling `resumeSession`
      // with a different `model`: resume rehydrates the session from the
      // SDK's persistent store, which carries the model the session was
      // CREATED with. The `model` on ResumeSessionConfig does not override
      // it, so every later turn silently kept running the original model
      // even though the chat entity said otherwise.
      //
      // `setModel` takes effect on the next message and preserves the
      // conversation history, which is exactly the semantic we want.
      if (this.verbose) {
        console.log(`[CopilotAdapter] Session ${conversationId} model ${currentModel} → ${params!.model}; setModel in place`);
      }
      try {
        await liveSession.setModel(params!.model!, {
          ...(params!.reasoningEffort ? { reasoningEffort: params!.reasoningEffort } : {}),
          ...(params!.contextTier ? { contextTier: params!.contextTier } : {}),
        });
        this.conversationModels.set(conversationId, params!.model!);
        return;
      } catch (err) {
        // Fall through to the disconnect + resume path below so a model
        // switch never hard-fails a turn.
        console.warn(
          `[CopilotAdapter] setModel(${params!.model}) failed for ${conversationId}; falling back to session rebuild:`,
          err,
        );
        try {
          await liveSession.disconnect();
        } catch {
          // Already gone — the resume below still rebuilds it.
        }
        this.conversations.delete(conversationId);
        activeSessions.add(-1);
      }
    }

    if (this.verbose) console.log(`[CopilotAdapter] Resuming session ${conversationId}`);
    // Clean up any lingering event listeners from the old session handle
    // to prevent handler accumulation across stages in single-session mode.
    const cleanups = this.conversationListenerCleanups.get(conversationId);
    if (cleanups) {
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
    }
    // SDK 1.0: resumeSession takes a ResumeSessionConfig (extends
    // SessionConfigBase). CRITICAL: re-register the runtime tool HANDLERS
    // (browser / widget / custom tools) here. Tool handlers are in-memory
    // functions that cannot be persisted into the SDK session store, so a
    // bare resume restores the message history WITHOUT tools — the SDK then
    // notifies the model that those tools "are no longer available", making
    // it refuse every browser/tool task for the rest of the chat. Passing the
    // tools (and the systemMessage hint + tool filters) rebinds them on the
    // resumed session while the SDK preserves the persisted history.
    const resumeConfig: ResumeSessionConfig = { onPermissionRequest: approveAll };
    const warnings: ConversationWarning[] = [];
    let registeredAgents: HarnessAgentInfo[] = [];
    if (params) {
      resumeConfig.tools = buildSdkTools(params.tools ?? []);
      if (params.systemMessage) {
        resumeConfig.systemMessage = { mode: params.systemMessage.mode, content: params.systemMessage.content };
      } else if (params.systemPromptAppend) {
        resumeConfig.systemMessage = { mode: 'append' as const, content: params.systemPromptAppend };
      }
      const resolvedAvailableTools = resolveAvailableTools(params.availableTools);
      if (resolvedAvailableTools) resumeConfig.availableTools = resolvedAvailableTools;
      if (params.excludedTools) resumeConfig.excludedTools = params.excludedTools;
      if (params.model) resumeConfig.model = params.model;
      if (params.workingDirectory) resumeConfig.workingDirectory = params.workingDirectory;
      if (params.reasoningEffort) resumeConfig.reasoningEffort = params.reasoningEffort;
      if (params.contextTier) resumeConfig.contextTier = params.contextTier;
      if (params.configDir) resumeConfig.configDirectory = params.configDir;
      if (params.streaming !== undefined) resumeConfig.streaming = params.streaming;
      registeredAgents = this.applyAgentConfig(resumeConfig, params, warnings);
    }
    // PLN-01 — reinstall the plan-mode gates on resume (see installPlanGates).
    if (params) this.installPlanGates(resumeConfig, params);
    // W36 — resume on the same workspace client that owns this conversation
    const resumeClient = this.clientForConversation(conversationId); /* W36 */
    const session = await resumeClient.resumeSession(conversationId, resumeConfig);
    this.attachTurnTextTracker(conversationId, session);
    this.conversations.set(conversationId, session);
    if (params?.model) {
      // `resumeSession` rehydrates the session from the SDK's persistent
      // store, which carries the model the session was CREATED with — the
      // `model` on ResumeSessionConfig does not override it. After a server
      // restart the chat's current model would therefore be ignored, so
      // re-assert it explicitly. Cheap and idempotent when unchanged.
      try {
        await session.setModel(params.model, {
          ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
          ...(params.contextTier ? { contextTier: params.contextTier } : {}),
        });
      } catch (err) {
        console.warn(
          `[CopilotAdapter] setModel(${params.model}) after resume failed for ${conversationId}:`,
          err,
        );
      }
      this.conversationModels.set(conversationId, params.model);
    }
    this.conversationWarnings.set(conversationId, warnings);
    this.conversationAgents.set(conversationId, registeredAgents);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversationWarnings.get(conversationId) ?? [];
  }

  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    const session = this.conversations.get(conversationId);
    if (!session) throw new HarnessSessionError(`Conversation ${conversationId} not found`);
    // `session.rpc.agent.select` is the same RPC family `applySessionMode` uses
    // for mode switching; it is not part of the typed surface.
    const rpc = (session as unknown as { rpc?: { agent?: { select?: (a: { name: string }) => Promise<void> } } }).rpc;
    const select = rpc?.agent?.select;
    if (typeof select !== 'function') {
      const existing = this.conversationWarnings.get(conversationId) ?? [];
      existing.push({ code: 'FIELD_UNSUPPORTED_BY_PROVIDER', params: { field: 'selectAgent', provider: 'copilot' } });
      this.conversationWarnings.set(conversationId, existing);
      return;
    }
    await select.call(rpc!.agent, { name: agentName });
  }

  async listAgents(conversationId: string): Promise<HarnessAgentInfo[]> {
    return this.conversationAgents.get(conversationId) ?? [];
  }

  /** Whether the SDK session handle is live in memory (tools registered). */
  hasLiveConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId);
  }

  /**
   * PLN-01 — one internal listener per session that keeps the current turn's
   * assistant text. Used only as a fallback plan source when the SDK omits
   * `planContent`. Deliberately separate from `conversationListenerCleanups`
   * so it is not counted against the ORC-05 leak threshold and is not torn
   * down when a consumer unsubscribes.
   */
  private attachTurnTextTracker(conversationId: string, session: CopilotSession): void {
    this.turnTextTrackers.get(conversationId)?.();
    this.turnText.delete(conversationId);
    const unsub = session.on((event: SessionEvent) => {
      const data = (event.data ?? {}) as Record<string, unknown>;
      switch (event.type) {
        case 'user.message':
        case 'assistant.turn_start':
          this.turnText.set(conversationId, '');
          break;
        case 'assistant.message': {
          const content = typeof data['content'] === 'string' ? data['content'] : '';
          if (content) {
            const prev = this.turnText.get(conversationId) ?? '';
            this.turnText.set(conversationId, prev ? `${prev}\n\n${content}` : content);
          }
          break;
        }
        case 'session.mode_changed': {
          // PLN-01 — the CLI moves the session itself (notably when an approved
          // exit_plan_mode switches to interactive/autopilot). Mirror it so the
          // applySessionMode short-circuit never reasons from a stale value.
          //
          // A CLI mode with no domain equivalent (autopilot / shell) clears the
          // cache rather than storing a guess, so the next turn re-asserts.
          const next = fromCopilotSessionMode(
            typeof data['newMode'] === 'string' ? (data['newMode'] as string) : undefined,
          );
          if (next) this.sessionModes.set(conversationId, next);
          else this.sessionModes.delete(conversationId);
          break;
        }
        default:
          break;
      }
    });
    this.turnTextTrackers.set(conversationId, unsub);
  }

  /**
   * PLN-01 — applies an agent mode to the *session* before a turn is sent.
   *
   * `session.send({ agentMode })` is display metadata only: the CLI records it
   * on the user message but never changes `session.currentMode`. The CLI builds
   * its tool list from the session mode and strips `exit_plan_mode` whenever the
   * session mode is not `plan`, so a plan-mode turn sent with only `agentMode`
   * leaves the model without the tool it is instructed to call (it then
   * improvises, e.g. `skill(exit_plan_mode)`, and no gate ever opens).
   *
   * `session.rpc.mode.set` is the RPC that actually moves the session, so it has
   * to be issued before every turn. It is marked `@experimental` in the SDK, so
   * a failure is logged and swallowed: the turn still runs, just without the
   * native gate, and the host-side plan capture takes over.
   */
  private async applySessionMode(
    conversationId: string,
    session: CopilotSession,
    agentMode: SendPromptOptions['agentMode'],
  ): Promise<void> {
    // No explicit mode for this turn: leave the session where it is rather than
    // guessing, so callers that never opt into plan mode keep today's behaviour.
    if (!agentMode) return;
    if (this.sessionModes.get(conversationId) === agentMode) return;

    // The CLI has its own mode vocabulary; translate at the boundary so no
    // vendor string leaks into the domain (and vice versa).
    const sessionMode = toCopilotSessionMode(agentMode);

    try {
      await session.rpc.mode.set({ mode: sessionMode });
      this.sessionModes.set(conversationId, agentMode);
      if (this.verbose) {
        console.log(
          `[CopilotAdapter][PLN-01] session mode set to "${sessionMode}" (${agentMode}) for ${conversationId}`,
        );
      }
    } catch (err) {
      // Non-fatal: an older CLI may not expose session.mode.set.
      this.sessionModes.delete(conversationId);
      console.warn(
        `[CopilotAdapter][PLN-01] failed to set session mode "${sessionMode}" on ${conversationId}: ${String(err)}`,
      );
    }
  }

  /**
   * PLN-01 — installs the native plan-mode callbacks on a session config.
   *
   * Shared by `createConversation` and `resumeConversation` because the SDK
   * cannot persist in-memory callbacks: a resumed session without these
   * handlers would silently lose plan mode and clarifying questions.
   *
   * Both gates block for as long as the human takes, so they also participate
   * in the `permissionPending` watchdog counter — otherwise
   * `sendPromptAndWait`'s idle timer would abort a turn while someone is
   * reading a plan.
   */
  private installPlanGates(
    config: { onExitPlanModeRequest?: unknown; onUserInputRequest?: unknown },
    params: CreateConversationParams,
  ): void {
    const conversationId = params.conversationId;

    const planReviewHandler = params.onPlanReviewRequest;
    if (planReviewHandler) {
      config.onExitPlanModeRequest = async (
        request: { summary?: string; planContent?: string; actions?: string[]; recommendedAction?: string },
      ) => {
        const prev = this.permissionPending.get(conversationId) ?? 0;
        this.permissionPending.set(conversationId, prev + 1);
        try {
          const planContent = resolveCopilotPlanContent(
            request.planContent,
            request.summary,
            this.turnText.get(conversationId) ?? '',
          );
          if (!planContent) {
            // Never approve an empty plan — bounce it back to the model.
            return {
              approved: false,
              feedback:
                'The plan could not be captured. Please restate the full plan and try again.',
            };
          }
          const actions = normalisePlanActions(request.actions);
          const decision = await planReviewHandler({
            summary: request.summary ?? 'Implementation plan',
            planContent,
            actions,
            recommendedAction: normalisePlanActions(
              request.recommendedAction ? [request.recommendedAction] : undefined,
            )[0],
          });
          return {
            approved: decision.approved,
            ...(decision.approved
              ? { selectedAction: toCopilotAction(decision.action ?? 'implement_interactive') }
              : {}),
            ...(decision.feedback ? { feedback: decision.feedback } : {}),
          };
        } finally {
          const cur = this.permissionPending.get(conversationId) ?? 1;
          if (cur <= 1) this.permissionPending.delete(conversationId);
          else this.permissionPending.set(conversationId, cur - 1);
        }
      };
    }

    const questionHandler = params.onQuestionRequest;
    if (questionHandler) {
      config.onUserInputRequest = async (
        request: { question: string; choices?: string[]; allowFreeform?: boolean },
      ) => {
        const prev = this.permissionPending.get(conversationId) ?? 0;
        this.permissionPending.set(conversationId, prev + 1);
        try {
          const questions = normaliseCopilotQuestion(request);
          const response = await questionHandler({ questions });
          return flattenAnswer(response.answers ?? {}, response.freeformResponse, request.choices);
        } finally {
          const cur = this.permissionPending.get(conversationId) ?? 1;
          if (cur <= 1) this.permissionPending.delete(conversationId);
          else this.permissionPending.set(conversationId, cur - 1);
        }
      };
    }
  }

  async listConversations(): Promise<string[]> {
    // SDK listSessions() returns SessionMetadata[], extract sessionId
    const sessions = await this.client.listSessions();
    return sessions.map((s) => s.sessionId);
  }

  // ── Capability declarations (W42 / N-2) ──

  /**
   * Declared capabilities for the Copilot SDK adapter.
   *
   * L9: Capability discovery is by declaration, not by exception.
   * W42 — N-2 fix: no runtime probe required.
   *
   * Copilot does not support the PreToolUse hook (N-5), so fullToolGating
   * is false — permission checking can fall through to the SDK's canUseTool.
   * vision / reasoning are model-specific; declare conservatively as false;
   * the model catalogue already surfaces per-model limits.
   */
  capabilities(): ProviderCapabilities {
    return {
      vision: false,          // model-specific; read from model catalogue
      reasoning: false,       // model-specific; read from model catalogue
      reasoningEfforts: [],   // query the live model for supported efforts
      planMode: true,         // Copilot has plan/normal mode switching
      mcpServers: false,      // Copilot SDK does not support MCP servers
      skillDirectories: false,
      // Finding-9 fix: the Copilot SDK DOES wire onPreToolUse (SessionConfig.hooks)
      // which fires before every tool call — identical in semantics to Claude's
      // PreToolUse hook. The original 'false' was wrong (the code at
      // createConversation line ~686 explicitly maps HookBridge.onPreToolUse to
      // sessionConfig.hooks.onPreToolUse). fullToolGating is therefore true.
      fullToolGating: true,
      sessionPersistence: true,
      budgetTracking: false,
      // MINOR-4 fix: computerUse must be explicitly declared (L9 fail-closed).
      // Copilot SDK does not expose the computer_use tool natively.
      computerUse: false,
    };
  }

  async getLastConversationId(): Promise<string | null> {
    return (await this.client.getLastSessionId()) ?? null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const cleanups = this.conversationListenerCleanups.get(conversationId);
    if (cleanups) {
      for (const cleanup of cleanups) cleanup();
      this.conversationListenerCleanups.delete(conversationId);
    }
    // ORC-05 — clear the per-conversation warn-once flag so a subsequent
    // createConversation with the same id starts from a clean slate.
    this.conversationLeakWarned.delete(conversationId);
    this.permissionPending.delete(conversationId);
    this.turnTextTrackers.get(conversationId)?.();
    this.turnTextTrackers.delete(conversationId);
    this.turnText.delete(conversationId);
    this.sessionModes.delete(conversationId);
    const session = this.conversations.get(conversationId);
    if (session) {
      await session.disconnect();
      this.conversations.delete(conversationId);
      activeSessions.add(-1);
    }
    // W36 — delete on the workspace client that owns this conversation
    const deleteClient = this.clientForConversation(conversationId); /* W36 */
    await deleteClient.deleteSession(conversationId);
    this.releaseWorkspaceRef(conversationId); /* W36 */
  }

  async destroyConversation(conversationId: string): Promise<void> {
    const cleanups = this.conversationListenerCleanups.get(conversationId);
    if (cleanups) {
      for (const cleanup of cleanups) cleanup();
      this.conversationListenerCleanups.delete(conversationId);
    }
    this.conversationLeakWarned.delete(conversationId);
    this.permissionPending.delete(conversationId);
    this.sessionModes.delete(conversationId);
    this.conversationWarnings.delete(conversationId);
    this.conversationAgents.delete(conversationId);
    const session = this.conversations.get(conversationId);
    if (session) {
      await session.disconnect();
      this.conversations.delete(conversationId);
      this.conversationModels.delete(conversationId);
      activeSessions.add(-1);
    }
    this.releaseWorkspaceRef(conversationId); /* W36 */
  }

  // ── Messaging ──

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    turnOptions?: SendPromptOptions,
  ): Promise<void> {
    const start = Date.now();
    return withSpan('copilot-bridge', 'copilot.sendPrompt', async (span) => {
      span.setAttribute('copilot.conversation_id', conversationId);
      span.setAttribute('copilot.prompt.length', prompt.length);
      promptCounter.add(1, { conversation_id: conversationId });

      const session = this.getSession(conversationId);
      // PLN-01 — the session mode drives tool availability; see applySessionMode.
      await this.applySessionMode(conversationId, session, turnOptions?.agentMode);
      await session.send({
        prompt,
        attachments: attachments?.map((a) => ({
          type: a.type as 'file',
          path: a.path,
          displayName: a.displayName ?? a.path,
        })),
        // PLN-01 — native per-message plan mode.
        ...(turnOptions?.agentMode
          ? { agentMode: toCopilotSessionMode(turnOptions.agentMode) }
          : {}),
      });

      promptDuration.record(Date.now() - start, { conversation_id: conversationId });
    });
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    turnOptions?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const start = Date.now();
    return withSpan('copilot-bridge', 'copilot.sendPromptAndWait', async (span) => {
      span.setAttribute('copilot.conversation_id', conversationId);
      span.setAttribute('copilot.prompt.length', prompt.length);
      promptCounter.add(1, { conversation_id: conversationId });

    const session = this.getSession(conversationId);

    // Use send() + manual idle detection instead of SDK's sendAndWait()
    // because the SDK always applies a hard wall-clock timeout to sendAndWait,
    // which causes long-running code generation tasks to fail prematurely.
    // With manual idle detection there is no timeout — the promise resolves
    // only when session.idle fires (or rejects on session.error). Phase 1
    // adds an optional AbortSignal so an external deadline (hook/stage
    // timeout) can cancel BOTH the wait and the in-flight SDK session.
    let resolveIdle!: () => void;
    let rejectWithError!: (err: Error) => void;
    const idlePromise = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve;
      rejectWithError = reject;
    });

    let lastAssistantMessage: SessionEvent | undefined;
    let eventCount = 0;
    // Idle-watchdog activity marker. Bumped on every SDK event so a stage
    // that's actively streaming tokens (or making tool calls) doesn't get
    // killed by the wall-clock `defaultTimeoutMs` guard below — the guard
    // is really an "idle timeout", not a total-runtime cap.
    let lastActivityMs = Date.now();
    const unsubscribe = session.on((event: SessionEvent) => {
      eventCount++;
      lastActivityMs = Date.now();
      if (event.type === 'assistant.message') {
        lastAssistantMessage = event;
      } else if (event.type === 'session.idle') {
        if (this.verbose) console.log(`[CopilotAdapter] session.idle received after ${eventCount} events for ${conversationId}`);
        resolveIdle();
      } else if (event.type === 'session.error') {
        console.error(`[CopilotAdapter] session.error for ${conversationId}:`, event.data);  // Always log errors
        const errData = event.data as unknown as Record<string, unknown> | undefined;
        rejectWithError(new Error(
          (errData?.message as string) ?? 'Session error',
        ));
      }
    });

    // Wire external abort → reject the wait AND tell the SDK to stop so we
    // don't burn tokens on work whose result we'll discard.
    let abortHandler: (() => void) | undefined;
    if (signal) {
      if (signal.aborted) {
        rejectWithError(new Error('sendPromptAndWait aborted before start'));
      } else {
        abortHandler = () => {
          rejectWithError(new Error('sendPromptAndWait aborted by caller'));
          // Best-effort: tell the SDK to drop the conversation so we stop
          // accruing tokens on a wait the caller has given up on.
          this.abortConversation(conversationId).catch(() => {
            /* abort is idempotent; swallow if already aborted */
          });
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    // Phase 2, 2.23 + 2.25 — adapter-level `defaultTimeoutMs` is a last-ditch
    // guard so a stuck SDK session can't hang indefinitely. The callers
    // (StageExecutionService, HookExecutor) drive their own timeouts via
    // `signal`; this fires only when nothing else bounds the wait.
    //
    // HITL-07: the watchdog is a rolling interval instead of a single
    // setTimeout, so slow human approval (`this.permissionPending`) doesn't
    // count toward the deadline.
    //
    // Long-agent fix: this is now an *idle* watchdog, not a wall-clock cap.
    // We track `lastActivityMs` (bumped on every SDK event above) and fire
    // only when nothing has arrived for `deadline` ms. A stage that streams
    // tokens or makes tool calls continuously — even for hours — will never
    // trip this. A truly stuck SDK session (no events, no permission wait)
    // still gets caught.
    let timeoutHandle: ReturnType<typeof setInterval> | undefined;
    if (this.options.defaultTimeoutMs && this.options.defaultTimeoutMs > 0) {
      const deadline = this.options.defaultTimeoutMs;
      const tickMs = Math.min(5_000, Math.max(500, Math.floor(deadline / 20)));
      timeoutHandle = setInterval(() => {
        // Waiting on a human? Treat the wait as "just now active" so the
        // watchdog resumes counting from zero once the approval lands.
        if ((this.permissionPending.get(conversationId) ?? 0) > 0) {
          lastActivityMs = Date.now();
          return;
        }
        const idleFor = Date.now() - lastActivityMs;
        if (idleFor >= deadline) {
          if (timeoutHandle) clearInterval(timeoutHandle);
          timeoutHandle = undefined;
          rejectWithError(new Error(
            `sendPromptAndWait: no SDK activity for ${deadline}ms (idle-timeout) on ${conversationId}`,
          ));
          this.abortConversation(conversationId).catch(() => {});
        }
      }, tickMs);
    }

    try {
      if (this.verbose) console.log(`[CopilotAdapter] Sending prompt to ${conversationId} (${prompt.length} chars)`);
      // PLN-01 — the session mode drives tool availability; see applySessionMode.
      await this.applySessionMode(conversationId, session, turnOptions?.agentMode);
      await session.send({
        prompt,
        attachments: attachments?.map((a) => ({
          type: a.type as 'file',
          path: a.path,
          displayName: a.displayName ?? a.path,
        })),
        // PLN-01 — native per-message plan mode.
        ...(turnOptions?.agentMode
          ? { agentMode: toCopilotSessionMode(turnOptions.agentMode) }
          : {}),
      });
      if (this.verbose) console.log(`[CopilotAdapter] session.send() completed for ${conversationId}, awaiting idle...`);

      await idlePromise;

      if (this.verbose) console.log(`[CopilotAdapter] Prompt completed for ${conversationId} (${eventCount} events)`);
      span.setAttribute('copilot.event_count', eventCount);
      promptDuration.record(Date.now() - start, { conversation_id: conversationId });

      const data = (lastAssistantMessage?.data ?? {}) as Record<string, unknown>;

      // W13-B1: If the model's response was truncated, do NOT execute any tool
      // calls that may have incomplete arguments — that risks data loss (X-2).
      // Check `finishReason` on the assistant message; if it indicates truncation,
      // return no tool calls and include a notice in the content so the model can
      // re-issue its request on the next turn.
      /* W13-B1 */
      const finishReason = (data['finishReason'] ?? data['finish_reason'] ?? data['stopReason'] ?? data['stop_reason']) as unknown;
      if (isTruncationFinishReason(finishReason)) {
        const toolRequests = data['toolRequests'] as Array<{ name: string }> | undefined;
        const toolCount = toolRequests?.length ?? 0;
        const truncMsg =
          `Response was truncated (finish_reason: ${String(finishReason)}). ` +
          `${toolCount > 0 ? `All ${toolCount} tool call(s) in this batch are cancelled. ` : ''}` +
          `Please re-issue your request with a shorter response or fewer tools.`;
        if (this.verbose || toolCount > 0) {
          console.warn(`[CopilotAdapter] Truncation detected for ${conversationId}: ${truncMsg}`);
        }
        return {
          content: ((data['content'] as string) ?? '') || truncMsg,
          toolCalls: undefined, // All tool calls suppressed — arguments may be incomplete
        };
      }

      return {
        content: (data['content'] as string) ?? '',
        toolCalls: (data['toolRequests'] as Array<{ name: string; arguments: unknown }>)?.map((tc) => ({
          tool: tc.name,
          args: tc.arguments,
          result: undefined,
        })),
      };
    } finally {
      unsubscribe();
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      if (timeoutHandle) clearInterval(timeoutHandle);
    }
    });
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const session = this.getSession(conversationId);
    // SDK getMessages() returns SessionEvent[], filter for message events
    // SDK 1.0 GA renamed `session.getMessages()` → `session.getEvents()`.
    const events = await session.getEvents();
    const messages: ConversationMessage[] = [];
    for (const event of events) {
      if (event.type === 'user.message') {
        messages.push({
          role: 'user',
          content: event.data.content,
          timestamp: new Date(event.timestamp),
        });
      } else if (event.type === 'assistant.message') {
        messages.push({
          role: 'assistant',
          content: event.data.content,
          timestamp: new Date(event.timestamp),
        });
      } else if (event.type === 'tool.execution_complete') {
        messages.push({
          role: 'tool',
          content: event.data.result?.content ?? '',
          timestamp: new Date(event.timestamp),
        });
      }
    }
    return messages;
  }

  async abortConversation(conversationId: string): Promise<void> {
    const session = this.conversations.get(conversationId);
    if (session) await session.abort();
  }

  // ── Event Subscription ──

  onConversationEvent(
    conversationId: string,
    handler: (event: AgentEvent) => void,
  ): () => void {
    const session = this.getSession(conversationId);
    const unsub = session.on((sdkEvent: SessionEvent) => {

      if (this.verbose) console.debug(`[CopilotAdapter][SDK_EVENT] type=${sdkEvent.type} data=${JSON.stringify(sdkEvent.data ?? {}).slice(0, 500)}`);
      const mapped = mapSdkEventToAgentEvent(sdkEvent);
      handler(mapped);
    });

    // Track for cleanup on resumeConversation
    let cleanups = this.conversationListenerCleanups.get(conversationId);
    if (!cleanups) {
      cleanups = new Set();
      this.conversationListenerCleanups.set(conversationId, cleanups);
    }
    const wrappedUnsub = () => {
      unsub();
      cleanups!.delete(wrappedUnsub);
      // Counter was incremented on subscription; rewind it on cleanup so
      // the metric reflects currently-attached listeners, not cumulative.
      listenerHighWaterMark.add(-1, { conversation_id: conversationId });
    };
    cleanups.add(wrappedUnsub);

    // ORC-05 — leak watchdog. After each add we report the new active count
    // to the metric and, once the per-conversation threshold is breached,
    // warn exactly once so logs don't get spammed. The warning fires
    // regardless of `verbose` because a real leak is always actionable.
    const activeCount = cleanups.size;
    listenerHighWaterMark.add(1, { conversation_id: conversationId });
    if (activeCount > LISTENER_LEAK_THRESHOLD && !this.conversationLeakWarned.has(conversationId)) {
      this.conversationLeakWarned.add(conversationId);
      listenerLeakWarnings.add(1, { conversation_id: conversationId });
      // eslint-disable-next-line no-console
      console.warn(
        `[CopilotAdapter] Listener leak suspected for conversation ${conversationId}: ` +
        `${activeCount} listeners attached (threshold=${LISTENER_LEAK_THRESHOLD}). ` +
        `A consumer is likely subscribing without calling the unsubscribe closure.`,
      );
    }

    return wrappedUnsub;
  }

  onClientEvent(handler: (event: HarnessClientEvent) => void): () => void {
    this.clientEventHandlers.add(handler);
    return () => {
      this.clientEventHandlers.delete(handler);
    };
  }

  // ── Private Helpers ──

  private getSession(id: string): CopilotSession {
    const session = this.conversations.get(id);
    if (!session) throw new HarnessSessionError(`No active conversation: ${id}`);
    return session;
  }

  private emitClientEvent(event: HarnessClientEvent): void {
    for (const handler of this.clientEventHandlers) {
      handler(event);
    }
  }

  /**
   * Poll the CLI for liveness. The SDK 1.0 GA removed the synchronous
   * connection-state accessor and exposes no connection/error events, so we
   * probe `ping()` — the SDK's documented connectivity check. To avoid driving
   * consumers with false signals we (a) require TWO consecutive failed probes
   * before declaring `error` (a single transient RPC hiccup on a live CLI is
   * ignored), and (b) discard any probe whose result arrives after polling was
   * stopped or the client was deliberately stopped, so a stopped client is
   * never resurrected to `error`.
   */
  private readonly POLL_FAILURE_THRESHOLD = 2;

  private startClientStatePolling(): void {
    this.consecutivePollFailures = 0;
    this.clientStatePollingInterval = setInterval(() => {
      void this.pollClientHealth();
    }, 5_000);
  }

  private async pollClientHealth(): Promise<void> {
    let alive: boolean;
    try {
      await this.client.ping('health');
      alive = true;
    } catch {
      alive = false;
    }

    // Discard the result if polling was stopped, or the client was stopped,
    // while this probe was in flight — never resurrect a stopped client.
    if (this.clientStatePollingInterval === undefined || this.clientState === 'stopped') {
      return;
    }

    if (alive) {
      this.consecutivePollFailures = 0;
      if (this.clientState === 'error') {
        this.clientState = 'running';
        this.emitClientEvent({
          type: 'client.restarting',
          data: { message: 'CLI process recovered' },
        });
      }
      return;
    }

    // Debounce transient probe failures before declaring the client errored.
    this.consecutivePollFailures += 1;
    if (this.consecutivePollFailures >= this.POLL_FAILURE_THRESHOLD && this.clientState !== 'error') {
      this.clientState = 'error';
      this.emitClientEvent({
        type: 'client.error',
        data: { message: 'CLI process unresponsive' },
      });
    }
  }

  private stopClientStatePolling(): void {
    if (this.clientStatePollingInterval) {
      clearInterval(this.clientStatePollingInterval);
      this.clientStatePollingInterval = undefined;
    }
    this.consecutivePollFailures = 0;
  }
}

