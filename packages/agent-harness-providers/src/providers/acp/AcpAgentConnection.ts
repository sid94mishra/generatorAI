// ────────────────────────────────────────────────────────────────
// AcpAgentConnection — one ACP agent process behind IAgentHarness.
//
// W39 (was W11) — speaks the REAL Agent Client Protocol (JSON-RPC 2.0 over the
// stdio of a spawned agent, `@agentclientprotocol/sdk`). `AcpProvider` (the
// `acp` provider, docs/acp ACP-1) runs one of these per enabled agent and
// routes each conversation to the agent its model names; this class knows one
// agent only and is also usable on its own (the tests drive it directly).
//
// Protocol coverage (docs/acp/README.md › Parity):
//   - initialize: client capabilities auth.terminal, session.configOptions.boolean,
//     session.notices, session.compaction, plan; keeps agentInfo, authMethods and
//     agentCapabilities.
//   - Models / effort / mode from session config options: `session/options` when
//     advertised, else a throwaway `session/new` in os.tmpdir() (closed when
//     `session/close` is advertised). Applied on creation (initial configOptions
//     when `session/options` is advertised, else `session/set_config_option`) and
//     mid-chat on a rebind with another model or effort.
//   - Sign-in: `authenticate` for agent methods; terminal methods are run by the
//     host (AcpProvider exposes them); `-32000` marks the agent signed out, never
//     an empty-but-ready catalog. `auth/status` when advertised.
//   - Persistence: `session/resume` (preferred) or `session/load` from
//     `resumeProviderSessionId`; `session/fork` when advertised.
//   - MCP servers (stdio always; http/sse per mcpCapabilities), systemPrompt when
//     advertised, image / resource attachments per promptCapabilities.
//   - Plan entries, available commands, mode / config updates, notices,
//     tool_call_update content / diff / locations, usage cost.
//
// Architecture laws honoured:
//   L9:  capabilities() declared, fail-closed defaults.
//   L16: Tier-B sessions are host-gated (an opt-in allowlist of tool kinds; see
//        `TIER_B_ALLOWED_KINDS`). In-process defense-in-depth.
//   W13: Semantic cancellation — `session/cancel` surfaces as `harness.cancelled`.
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
// W41 — the ACP SDK is resolved on FIRST USE, not at module load: `import type`
// is erased, and `loadAcpSdk()` below does the one dynamic import.
import type * as acp from '@agentclientprotocol/sdk/unstable';
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
  ConversationWarning,
  HarnessAgentInfo,
  ProviderCapabilities,
  CompactConversationOptions,
  ForkConversationOptions,
  ForkConversationResult,
} from '@generatorai/core';
import { COMPACTION_INFO, describeCompaction } from '@generatorai/shared';
import type { AcpAuthState, AgentEvent, CompactionTrigger, FileOpStat, McpServerConfig } from '@generatorai/shared';
import { buildHarnessEnv } from '../../childEnv.js';
import { rootsOf, sameRoots } from '../../conversationRoots.js';
import type { AcpAgentConnectionOptions } from '../../types.js';
import {
  configOptionsToModels,
  findSelectOption,
  flattenSelectValues,
  matchSelectValue,
  planModeValue,
  type AcpConfigOption,
} from './configOptions.js';
import { resolveSpawnTarget } from './launch.js';

// ── W41 — lazy SDK module singleton ──────────────────────────────

import type * as AcpSdkNs from '@agentclientprotocol/sdk/unstable';
type AcpSdk = typeof AcpSdkNs;

let acpSdk: AcpSdk | null = null;
let acpSdkLoading: Promise<AcpSdk> | null = null;

/** Resolve `@agentclientprotocol/sdk` on first use. */
async function loadAcpSdk(): Promise<AcpSdk> {
  if (acpSdk) return acpSdk;
  acpSdkLoading ??= import('@agentclientprotocol/sdk/unstable')
    .then((mod) => {
      acpSdk = mod;
      return mod;
    })
    .catch((err: unknown) => {
      acpSdkLoading = null;
      throw err;
    });
  return acpSdkLoading;
}

/** The already-loaded SDK, for the synchronous paths (every caller runs after `initialize()` loaded it). */
function acpRuntime(): AcpSdk {
  if (!acpSdk) throw new Error('AcpAgentConnection: ACP SDK used before initialize() loaded it');
  return acpSdk;
}

/** W41 — test seam: has the SDK been pulled into this process yet? */
export function isAcpSdkLoaded(): boolean {
  return acpSdk !== null;
}

// ── Types ────────────────────────────────────────────────────────

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

/** JSON-RPC `-32000 Authentication required` (ACP `ErrorCode`). */
export const ACP_AUTH_REQUIRED = -32000;

/** Whether an error is the agent asking for a sign-in. */
export function isAuthRequiredError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === ACP_AUTH_REQUIRED) return true;
  return /authenticat(ion|e) required|auth_required|not (logged|signed) in/i.test(String((err as Error)?.message ?? err));
}

interface ConversationState {
  session: acp.ActiveSession | null;
  params: CreateConversationParams;
  listeners: Set<Listener<AgentEvent>>;
  warnings: ConversationWarning[];
  inFlight: boolean;
  /**
   * The prompt turn reading the session's updates, while one runs. The session has ONE update queue
   * (`nextUpdate`), read by one pump for the life of the session (`startPump`): during a turn it hands each
   * message here, between turns it applies the update itself — agents announce their commands right after
   * `session/new`, and compact or report usage between prompts.
   */
  turnSink: TurnSink | null;
  /** Command names from the agent's latest `available_commands_update` (`compact` → native compaction). */
  commands: Set<string>;
  /** A `/compact` of ours in flight: whether its start / end were already reported. */
  compacting: { startReported: boolean; endReported: boolean; summary: string } | null;
  /** Summaries of compactions in progress, by compaction id (`compaction_summary_chunk`). */
  compactionSummaries: Map<string, string>;
  /** The session's config options, as the agent last reported them. */
  configOptions: AcpConfigOption[];
  /** Tool call titles by id, so completions name the tool rather than its id. */
  toolTitles: Map<string, string>;
  /** The mode value before a plan turn switched to the agent's plan mode. */
  modeBeforePlan: string | undefined;
  /** Cumulative session cost / usage last reported, to report each turn's share. */
  lastCost: { amount: number; currency: string } | undefined;
  lastUsage: { input: number; output: number; cacheRead: number; cacheWrite: number } | undefined;
}

/** A turn's view of the session pump: messages in order, or the error that ended the prompt. */
interface TurnSink {
  push(message: acp.ActiveSessionMessage): void;
  fail(err: unknown): void;
  next(): Promise<acp.ActiveSessionMessage>;
  /** Settles when the turn is over; the pump waits on it after handing over an error. */
  done: Promise<void>;
}

function createTurnSink(): TurnSink & { finish(): void } {
  const values: Array<{ ok: true; value: acp.ActiveSessionMessage } | { ok: false; error: unknown }> = [];
  const waiters: Array<{ resolve: (m: acp.ActiveSessionMessage) => void; reject: (e: unknown) => void }> = [];
  let finish!: () => void;
  const done = new Promise<void>((r) => { finish = r; });
  const deliver = (entry: (typeof values)[number]) => {
    const waiter = waiters.shift();
    if (!waiter) { values.push(entry); return; }
    if (entry.ok) waiter.resolve(entry.value);
    else waiter.reject(entry.error);
  };
  return {
    push: (value) => deliver({ ok: true, value }),
    fail: (error) => deliver({ ok: false, error }),
    next: () => {
      const entry = values.shift();
      if (entry) return entry.ok ? Promise.resolve(entry.value) : Promise.reject(entry.error);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    done,
    finish: () => finish(),
  };
}

/**
 * L16 — tool kinds a Tier-B agent is PERMITTED to request, as a frozen opt-in set. Everything else is denied.
 *
 * A substring denylist over the model-controlled `title` failed open (the agent picks the title; anything it did
 * not name was approved). Only kinds that cannot mutate the workspace or reach the network are listed; an absent
 * or unrecognised kind is denied precisely because it is unrecognised (`ToolKind` is an open union).
 */
const TIER_B_ALLOWED_KINDS: ReadonlySet<string> = new Set<acp.ToolKind>(['read', 'search', 'think']);

/** True when a Tier-B agent may NOT make this call. Denied unless allowed. */
function isTierBBlocked(toolCall: { kind?: acp.ToolKind | null }): boolean {
  return !toolCall.kind || !TIER_B_ALLOWED_KINDS.has(toolCall.kind);
}

/** First permission option matching one of `kinds`, in priority order. */
function findOption(
  options: acp.PermissionOption[],
  kinds: readonly acp.PermissionOptionKind[],
): acp.PermissionOption | undefined {
  for (const kind of kinds) {
    const found = options.find((o) => o.kind === kind);
    if (found) return found;
  }
  return undefined;
}

/** Plain text of an ACP content block, or '' for non-text blocks. */
function textOf(content: acp.ContentBlock): string {
  return content.type === 'text' ? content.text : '';
}

/** Deadline for `initialize`, `session/*` setup requests and `session/close`. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Deadline for a domain permission decision (a human may be on the other end). */
const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60_000;
/** Deadline for an `authenticate` request: the agent may wait for a browser sign-in. */
const DEFAULT_AUTH_TIMEOUT_MS = 10 * 60_000;
/** Largest attachment inlined into a prompt (image or text resource). */
const MAX_INLINE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.tsv', '.html', '.css', '.js', '.mjs',
  '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs',
  '.sh', '.ps1', '.sql', '.log', '.ini', '.cfg', '.env', '.svg',
]);

function isTextAttachment(file: AttachmentRef): boolean {
  const mime = file.mimeType ?? '';
  if (mime.startsWith('text/') || /json|xml|yaml|javascript|typescript|svg/.test(mime)) return true;
  return TEXT_EXTENSIONS.has(path.extname(file.path).toLowerCase());
}

/** Line-count change of a diff: the lines between the common prefix and suffix. */
function diffStat(oldText: string | null | undefined, newText: string): { additions: number; deletions: number } {
  const a = oldText ? oldText.split('\n') : [];
  const b = newText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return { additions: endB - start, deletions: endA - start };
}

/** Codex-compatible `plan_update` message (client-core's event router renders it). */
function describePlan(steps: ReadonlyArray<{ step: string; status: string }>): string {
  const done = steps.filter((s) => s.status === 'completed').length;
  const lines = [`Plan: ${done}/${steps.length} done`];
  for (const s of steps) {
    const mark = s.status === 'completed' ? '[x]' : s.status === 'inProgress' ? '[~]' : '[ ]';
    lines.push(`${mark} ${s.step}`);
  }
  return lines.join('\n');
}

function planSteps(entries: readonly acp.PlanEntry[]): Array<{ step: string; status: string; priority: string }> {
  return entries.map((e) => ({
    step: e.content,
    status: e.status === 'completed' ? 'completed' : e.status === 'in_progress' ? 'inProgress' : 'pending',
    priority: e.priority,
  }));
}

/** What a connection knows about its agent (initialize + probes), for the provider status and the ACP API. */
export interface AcpConnectionStatus {
  connected: boolean;
  authState: AcpAuthState;
  /** Models of the last successful probe (raw option values). Empty when not signed in or not probed. */
  models: HarnessModel[];
  error?: string;
  authMethods: acp.AuthMethod[];
  supportsLogout: boolean;
  agentInfo?: { name: string; version?: string; title?: string };
  checkedAt?: number;
}

// ── AcpAgentConnection ───────────────────────────────────────────

export class AcpAgentConnection implements IAgentHarness {
  private readonly opts: AcpAgentConnectionOptions;
  private proc: ChildProcess | null = null;
  private connection: acp.ClientConnection | null = null;
  private clientState: HarnessClientState = 'starting';
  private clientEventListeners = new Set<Listener<HarnessClientEvent>>();
  private conversations = new Map<string, ConversationState>();
  private negotiatedVersion: acp.ProtocolVersion | undefined;
  /** True once we have asked the agent to exit, so its exit is not an error. */
  private stopping = false;
  /** Last lines of the agent's stderr, attached to spawn/exit errors. */
  private stderrTail = '';

  // What `initialize` told us.
  private agentCaps: acp.AgentCapabilities = {};
  private authMethods: acp.AuthMethod[] = [];
  private agentInfo: acp.Implementation | null = null;

  // Sign-in and catalog.
  private authState: AcpAuthState = 'unknown';
  private optionsCache: AcpConfigOption[] | null = null;
  private modelsCache: HarnessModel[] | null = null;
  private modelsProbe: Promise<HarnessModel[]> | null = null;
  private lastProbeError: string | undefined;
  private checkedAt: number | undefined;

  constructor(opts: AcpAgentConnectionOptions) {
    this.opts = opts;
  }

  /** The agent id this connection runs (`''` when used on its own). */
  get agentId(): string {
    return this.opts.agentId ?? '';
  }

  private get label(): string {
    return this.opts.label ?? this.agentInfo?.title ?? this.agentInfo?.name ?? 'ACP agent';
  }

  private get requestTimeout(): number {
    return this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** The directory sessions run in when a conversation names none. */
  private get sessionCwd(): string {
    return this.opts.defaultCwd ?? process.cwd();
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const bin = this.opts.command;
    this.stopping = false;
    this.stderrTail = '';
    const target = resolveSpawnTarget(bin, this.opts.args ?? []);

    // ENOENT-safe spawn: the 'error' event fires on next tick, ahead of setImmediate, so a missing binary rejects
    // initialize() instead of leaving the provider silently half-started.
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(target.file, target.args, {
        cwd: this.opts.cwd ?? this.opts.defaultCwd ?? process.cwd(),
        // The agent executes model-authored tool calls: it gets the allowlisted harness environment plus its own
        // launch env (distribution env, the user's per-agent variables), never the full parent env.
        env: buildHarnessEnv({ extra: this.opts.env }),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        ...(target.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
      this.proc = proc;
      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (chunk: string) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-4096);
      });

      proc.once('error', (err) => {
        const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `ACP agent binary "${bin}" not found. Install it and ensure it is on PATH, or give an absolute path.`
          : err.message;
        this.clientState = 'error';
        for (const h of this.clientEventListeners) h({ type: 'client.error', data: { message: msg } });
        reject(new Error(msg));
      });

      proc.on('exit', (code, sig) => {
        // `kill('SIGTERM')` yields `code === null`: an orderly shutdown is not a failure.
        const clean = this.stopping || code === 0;
        this.clientState = clean ? 'stopped' : 'error';
        if (!clean) this.lastProbeError = this.exitMessage(code, sig);
        for (const h of this.clientEventListeners) {
          h({ type: clean ? 'client.stopped' : 'client.error', data: clean ? undefined : { message: this.exitMessage(code, sig) } });
        }
        this.opts.onStateChange?.();
      });

      setImmediate(resolve);
    });

    const proc = this.proc!;
    const sdk = await loadAcpSdk(); // W41 — first use of the SDK in this process.
    this.negotiatedVersion = sdk.PROTOCOL_VERSION;
    const stream = sdk.ndJsonStream(
      Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
    );

    const clientApp = sdk
      .client({ name: 'GeneratorAI' })
      // L16 host gate + the domain `onPermissionRequest` callback — see `handleRequestPermission`.
      .onRequest(sdk.methods.client.session.requestPermission, (ctx) => this.handleRequestPermission(ctx.params))
      .onNotification(sdk.methods.client.auth.statusUpdate, (ctx) => {
        this.setAuthState(normalizeAuthState(ctx.params.state));
      });

    this.connection = clientApp.connect(stream);

    try {
      const initResult = await this.withDeadline(
        this.connection.agent.request(sdk.methods.agent.initialize, {
          protocolVersion: sdk.PROTOCOL_VERSION,
          // L9: declare only what we serve. No `fs/*` / `terminal/*` handlers are registered, so both stay false
          // (an agent that calls them gets an honest -32601).
          //   auth.terminal — the host can run a terminal sign-in with this agent's own launch command (docs/acp ACP-8).
          //   session.compaction — `compaction_update` / `compaction_summary_chunk` are rendered (docs/compaction).
          //   session.configOptions.boolean — boolean options are understood (ignored unless categorised).
          //   session.notices / plan — rendered as warnings / plan updates.
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
            auth: { terminal: true },
            session: { compaction: {}, configOptions: { boolean: {} }, notices: {} },
            plan: {},
          },
          clientInfo: { name: 'GeneratorAI', version: '2.0.0' },
        }),
        this.requestTimeout,
        `ACP initialize handshake with "${bin}"`,
      );
      this.negotiatedVersion = initResult.protocolVersion;
      if (this.negotiatedVersion !== sdk.PROTOCOL_VERSION) {
        // Per spec: "The client should disconnect if it doesn't support this version."
        throw new Error(
          `agent negotiated protocol version ${this.negotiatedVersion}, but this build only supports ${sdk.PROTOCOL_VERSION}.`,
        );
      }
      this.agentCaps = initResult.agentCapabilities ?? {};
      this.authMethods = initResult.authMethods ?? [];
      this.agentInfo = initResult.agentInfo ?? null;
      if (this.authMethods.length === 0) this.authState = 'not_required';
    } catch (err) {
      this.clientState = 'error';
      // Tear the whole thing down: a half-initialised connection looked alive to `ping()` and orphaned its child.
      this.stopping = true;
      try { this.connection.close(err); } catch { /* already closing */ }
      this.connection = null;
      const p = this.proc;
      this.proc = null;
      p?.removeAllListeners('exit');
      p?.kill('SIGTERM');
      const tail = this.stderrTail.trim();
      throw new Error(`AcpProvider: failed to initialize ACP agent "${bin}": ${String(err)}${tail ? ` — ${tail.split('\n').slice(-3).join(' ')}` : ''}`);
    }

    this.clientState = 'running';
    if (this.agentCaps.auth?.status) await this.refreshAuthStatus();
  }

  private exitMessage(code: number | null, sig: NodeJS.Signals | null): string {
    const tail = this.stderrTail.trim().split('\n').slice(-3).join(' ');
    const base = sig ? `ACP agent exited on signal ${sig}` : `ACP agent exited with code ${code}`;
    return tail ? `${base}: ${tail}` : base;
  }

  /** Reject `promise` if it has not settled within `ms` (nothing in the SDK bounds a request the agent ignores). */
  private async withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    if (ms <= 0) return promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`AcpProvider: ${what} timed out after ${ms} ms`)), ms);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async stop(): Promise<void> { await this.shutdown(); }

  async forceStop(): Promise<void> {
    this.stopping = true;
    this.connection?.close();
    this.connection = null;
    this.proc?.kill('SIGKILL');
    this.proc = null;
    this.clientState = 'stopped';
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    this.connection?.close();
    this.connection = null;
    this.proc?.kill('SIGTERM');
    this.proc = null;
    this.clientState = 'stopped';
  }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    return this.clientState === 'running' && this.proc != null && !this.proc.killed;
  }

  onClientEvent(handler: Listener<HarnessClientEvent>): UnsubFn {
    this.clientEventListeners.add(handler);
    return () => this.clientEventListeners.delete(handler);
  }

  // ── Sign-in (docs/acp ACP-8) ─────────────────────────────────────

  private setAuthState(state: AcpAuthState): void {
    if (state === this.authState) return;
    this.authState = state;
    if (state === 'unauthenticated') {
      this.modelsCache = null;
      this.optionsCache = null;
    }
    this.opts.onStateChange?.();
  }

  /** `auth/status` (unstable; only when advertised). Never throws. */
  private async refreshAuthStatus(): Promise<void> {
    if (!this.connection || !this.agentCaps.auth?.status) return;
    try {
      const res = await this.withDeadline(
        this.connection.agent.request(acpRuntime().methods.agent.auth.status, {}),
        this.requestTimeout,
        'ACP auth/status',
      );
      this.setAuthState(normalizeAuthState(res.state));
    } catch { /* keep what we knew */ }
  }

  /** Sign in with an `agent` auth method (the agent does the rest, often in a browser). */
  async authenticate(methodId: string): Promise<void> {
    if (!this.connection) throw new Error('AcpProvider: the agent is not running');
    const method = this.authMethods.find((m) => m.id === methodId);
    if (!method) throw new Error(`The agent has no sign-in method "${methodId}".`);
    if ((method as { type?: string }).type === 'terminal') {
      throw new Error(`"${method.name}" signs in from a terminal: run the agent's terminal sign-in instead.`);
    }
    await this.withDeadline(
      this.connection.agent.request(acpRuntime().methods.agent.authenticate, { methodId }),
      this.opts.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
      `ACP authenticate (${methodId})`,
    );
    this.invalidateModelCache();
    this.lastProbeError = undefined;
    if (this.agentCaps.auth?.status) await this.refreshAuthStatus();
    else this.setAuthState('authenticated');
    this.opts.onStateChange?.();
  }

  /** Sign out (`logout`, only when the agent advertises `auth.logout`). */
  async logout(): Promise<void> {
    if (!this.connection) throw new Error('AcpProvider: the agent is not running');
    if (!this.agentCaps.auth?.logout) throw new Error('This agent cannot sign out from the app.');
    await this.withDeadline(
      this.connection.agent.request(acpRuntime().methods.agent.logout, {}),
      this.requestTimeout,
      'ACP logout',
    );
    this.invalidateModelCache();
    this.setAuthState('unauthenticated');
  }

  /** What the connection knows now (never probes). */
  status(): AcpConnectionStatus {
    return {
      connected: this.clientState === 'running',
      authState: this.authState,
      models: this.modelsCache ?? [],
      ...(this.lastProbeError ? { error: this.lastProbeError } : {}),
      authMethods: [...this.authMethods],
      supportsLogout: !!this.agentCaps.auth?.logout,
      ...(this.agentInfo
        ? { agentInfo: { name: this.agentInfo.name, version: this.agentInfo.version, ...(this.agentInfo.title ? { title: this.agentInfo.title } : {}) } }
        : {}),
      ...(this.checkedAt ? { checkedAt: this.checkedAt } : {}),
    };
  }

  // ── Capabilities (L9, L16: Tier-B fail-closed) ────────────────────

  capabilities(): ProviderCapabilities {
    const prompt = this.agentCaps.promptCapabilities;
    const session = this.agentCaps.sessionCapabilities;
    const effort = findSelectOption(this.optionsCache, 'thought_level');
    const efforts = effort ? knownEfforts(flattenSelectValues(effort).map((v) => v.value)) : [];
    return {
      vision: prompt?.image === true,
      reasoning: efforts.length > 0,
      reasoningEfforts: efforts,
      // No native plan gate: plan turns get the host's plan-mode prompt (and the agent's own `plan` mode, when it
      // has one — see `applyTurnMode`).
      planMode: false,
      // stdio MCP servers reach every ACP agent (`session/new.mcpServers`); http/sse per `mcpCapabilities`.
      mcpServers: true,
      skills: 'none',
      // `session/request_permission` reaches the session's gate per call (Tier-B additionally denies by kind).
      approvalGating: 'per_call',
      hostTools: 'none',
      structuredOutput: 'none',
      sessionPersistence: !!session?.resume || this.agentCaps.loadSession === true,
      budgetTracking: false,
      computerUse: false,
      conversationFork: !!session?.fork,
      // Per agent: only one that advertises a `compact` command can (see `capabilitiesFor`).
      conversationCompact: false,
      compactInstructions: false,
    };
  }

  /** `capabilities()`, plus what this conversation's agent advertised: `/compact` makes compaction native. */
  capabilitiesFor(conversationId: string): ProviderCapabilities {
    const conv = this.conversations.get(conversationId);
    const canCompact = conv?.commands.has('compact') === true;
    const base = this.capabilities();
    const effort = conv ? findSelectOption(conv.configOptions, 'thought_level') : undefined;
    const efforts = effort ? knownEfforts(flattenSelectValues(effort).map((v) => v.value)) : base.reasoningEfforts;
    return { ...base, reasoning: efforts.length > 0, reasoningEfforts: efforts, conversationCompact: canCompact, compactInstructions: canCompact };
  }

  // ── Model discovery (docs/acp ACP-2) ──────────────────────────────

  /** Drop the cached catalog (sign-in / sign-out, explicit refresh). The next `getModels()` asks the agent. */
  invalidateModelCache(): void {
    this.modelsCache = null;
    this.optionsCache = null;
  }

  getLastModelProbeError(): string | undefined {
    return this.lastProbeError;
  }

  /**
   * The agent's models (ids = its `model` option values; `''` = its default model when it publishes none).
   * W41: never throws — an empty list with `getLastModelProbeError()` explains itself. A `-32000` marks the agent
   * signed out (an empty, NOT-ready catalog).
   */
  async getModels(): Promise<HarnessModel[]> {
    if (this.modelsCache) return this.modelsCache;
    this.modelsProbe ??= this.probeModels().finally(() => { this.modelsProbe = null; });
    return this.modelsProbe;
  }

  private async probeModels(): Promise<HarnessModel[]> {
    if (!this.connection || this.clientState !== 'running') {
      this.lastProbeError ??= 'The agent is not running.';
      return [];
    }
    try {
      const options = await this.fetchConfigOptions();
      this.optionsCache = options;
      const models = configOptionsToModels(options, { agentLabel: this.label });
      this.modelsCache = models;
      this.lastProbeError = undefined;
      this.checkedAt = Date.now();
      if (this.authState !== 'not_required' && !this.agentCaps.auth?.status) this.setAuthState('authenticated');
      return models;
    } catch (err) {
      this.checkedAt = Date.now();
      if (isAuthRequiredError(err)) {
        this.setAuthState('unauthenticated');
        this.lastProbeError = `Sign in to ${this.label} to use its models.`;
      } else {
        this.lastProbeError = `Could not list ${this.label}'s models: ${err instanceof Error ? err.message : String(err)}`;
      }
      return [];
    }
  }

  /** `session/options` when advertised, else a throwaway `session/new` in a scratch dir (closed when possible). */
  private async fetchConfigOptions(): Promise<AcpConfigOption[]> {
    const conn = this.connection!;
    const methods = acpRuntime().methods.agent;
    if (this.agentCaps.sessionCapabilities?.options) {
      const res = await this.withDeadline(
        conn.agent.request(methods.session.options, { cwd: this.sessionCwd }),
        this.requestTimeout,
        'ACP session/options',
      );
      return (res.configOptions ?? []) as AcpConfigOption[];
    }
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'gai-acp-probe-'));
    try {
      const res = await this.withDeadline(
        conn.agent.request(methods.session.new, { cwd: scratch, mcpServers: [] }),
        this.requestTimeout,
        'ACP session/new (model probe)',
      );
      if (this.agentCaps.sessionCapabilities?.close) {
        await this.withDeadline(
          conn.agent.request(methods.session.close, { sessionId: res.sessionId }),
          this.requestTimeout,
          'ACP session/close (model probe)',
        ).catch(() => undefined);
      }
      return (res.configOptions ?? []) as AcpConfigOption[];
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** A live session's options changed: keep the catalog's value lists current, the default as probed. */
  private noteLiveOptions(options: AcpConfigOption[]): void {
    if (!this.optionsCache) return;
    const live = findSelectOption(options, 'model');
    const cached = findSelectOption(this.optionsCache, 'model');
    if (!live || !cached) return;
    const liveValues = flattenSelectValues(live).map((v) => v.value).join('\n');
    const cachedValues = flattenSelectValues(cached).map((v) => v.value).join('\n');
    if (liveValues === cachedValues) return;
    const keepDefault = flattenSelectValues(live).some((v) => v.value === cached.currentValue);
    this.optionsCache = this.optionsCache.map((o) =>
      o === cached ? { ...live, currentValue: keepDefault ? cached.currentValue : live.currentValue } : o,
    );
    this.modelsCache = configOptionsToModels(this.optionsCache, { agentLabel: this.label });
    this.opts.onStateChange?.();
  }

  // ── Conversation lifecycle ────────────────────────────────────────

  /** `params.mcpServers` → ACP `McpServer[]`: stdio always; http/sse only where `mcpCapabilities` allows. */
  private mcpServersFor(params: CreateConversationParams, warnings: ConversationWarning[]): acp.McpServer[] {
    const out: acp.McpServer[] = [];
    const mcp = this.agentCaps.mcpCapabilities;
    for (const [name, server] of Object.entries(params.mcpServers ?? {}) as Array<[string, McpServerConfig]>) {
      if (server.enabled === false) continue;
      const headers = Object.entries(server.headers ?? {}).map(([n, value]) => ({ name: n, value }));
      if (server.type === 'stdio') {
        if (!server.command) continue;
        out.push({
          name,
          command: server.command,
          args: server.args ?? [],
          env: Object.entries(server.env ?? {}).map(([n, value]) => ({ name: n, value })),
        });
      } else if ((server.type === 'http' && mcp?.http) || (server.type === 'sse' && mcp?.sse)) {
        if (!server.url) continue;
        out.push({ type: server.type, name, url: server.url, headers });
      } else {
        warnings.push({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
          params: { field: `mcpServers.${name}`, provider: 'acp', reason: `this agent does not accept ${server.type} MCP servers` },
        });
      }
    }
    return out;
  }

  /** The chat's system message, when the agent takes one (`sessionCapabilities.systemPrompt`). */
  private systemPromptFor(params: CreateConversationParams, warnings: ConversationWarning[]): acp.SystemPrompt | undefined {
    const content = params.systemMessage?.content ?? params.systemPromptAppend;
    if (!content?.trim()) return undefined;
    if (!this.agentCaps.sessionCapabilities?.systemPrompt) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: 'systemMessage', provider: 'acp', reason: 'this agent takes no system prompt' },
      });
      return undefined;
    }
    return { mode: params.systemMessage?.mode === 'replace' ? 'override' : 'append', content: [{ type: 'text', text: content }] };
  }

  /** Initial `configOptions` for a session setup request (only when the agent accepts them: `sessionCapabilities.options`). */
  private initialConfigOptions(params: CreateConversationParams): acp.InitialSessionConfigOption[] | undefined {
    if (!this.agentCaps.sessionCapabilities?.options || !this.optionsCache) return undefined;
    const out: acp.InitialSessionConfigOption[] = [];
    const model = findSelectOption(this.optionsCache, 'model');
    if (model && params.model) {
      const value = matchSelectValue(model, params.model);
      if (value) out.push({ configId: model.id, value });
    }
    const effort = findSelectOption(this.optionsCache, 'thought_level');
    if (effort && params.reasoningEffort && !params.model) {
      // The effort's choices depend on the model; with a model change it is set afterwards.
      const value = matchSelectValue(effort, params.reasoningEffort);
      if (value) out.push({ configId: effort.id, value });
    }
    return out.length > 0 ? out : undefined;
  }

  /** Attach update routing to a session the SDK did not start (resume / load / fork). */
  private attach(response: acp.NewSessionResponse): acp.ActiveSession {
    // `ClientContext.attachSession` is what `SessionBuilder.start()` uses for `session/new`; the SDK keeps it
    // private (TS-only) and has no builder for resume/load/fork, so it is reached the same way here.
    const agent = this.connection!.agent as unknown as { attachSession?: (r: acp.NewSessionResponse) => acp.ActiveSession };
    if (typeof agent.attachSession !== 'function') throw new Error('this ACP SDK build cannot attach a resumed session');
    return agent.attachSession(response);
  }

  async createConversation(params: CreateConversationParams): Promise<string> {
    if (!this.connection) throw new Error('AcpProvider: not initialized (call initialize() first)');
    const methods = acpRuntime().methods.agent;

    const warnings: ConversationWarning[] = [];
    if (params.autoCompact && !(params.autoCompact.enabled && params.autoCompact.thresholdPct == null)) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: 'autoCompact', provider: 'acp', reason: 'ACP has no compaction setting; the agent compacts by its own rules' },
      });
    }
    if (this.opts.tierB ?? true) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { capability: 'computer-use, unrestricted shell', reason: 'Tier-B ACP agents cannot use this capability (L16 host gate)' },
      });
    }
    if (params.tools && params.tools.length > 0) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: 'tools', provider: 'acp', reason: 'ACP agents take no host tools' },
      });
    }

    const cwd = params.workingDirectory ?? this.sessionCwd;
    // The chat's other mounts and managed workspace root (`additionalDirectories`, gated on the capability).
    const extraRoots = [...new Set(params.additionalDirectories ?? [])];
    let additionalDirectories: string[] | undefined;
    if (extraRoots.length > 0) {
      if (this.agentCaps.sessionCapabilities?.additionalDirectories) additionalDirectories = extraRoots;
      else {
        warnings.push({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
          params: { field: 'additionalDirectories', provider: 'acp', reason: 'this agent works in one directory; the others are named in the prompt' },
        });
      }
    }
    const mcpServers = this.mcpServersFor(params, warnings);
    const systemPrompt = this.systemPromptFor(params, warnings);
    const configOptions = this.initialConfigOptions(params);
    const setup = {
      cwd,
      mcpServers,
      ...(additionalDirectories ? { additionalDirectories } : {}),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(configOptions ? { configOptions } : {}),
    };

    let session: acp.ActiveSession | null = null;
    let options: AcpConfigOption[] = [];

    // W12 — resume the provider's own session when the caller has its id (a restart, a runtime recycle).
    const resumeId = params.resumeProviderSessionId;
    const resumable = !!resumeId && (params.resumeProviderSessionHarness == null || params.resumeProviderSessionHarness === 'acp');
    if (resumable && resumeId) {
      const caps = this.agentCaps.sessionCapabilities;
      try {
        if (caps?.resume) {
          const res = await this.withDeadline(
            this.connection.agent.request(methods.session.resume, { ...setup, sessionId: resumeId }),
            this.requestTimeout,
            'ACP session/resume',
          );
          session = this.attach({ ...res, sessionId: resumeId });
          options = (res.configOptions ?? []) as AcpConfigOption[];
        } else if (this.agentCaps.loadSession) {
          // `session/load` replays the history as updates BEFORE it answers; no route is attached yet, so the
          // replay is dropped — the transcript already holds it.
          const res = await this.withDeadline(
            this.connection.agent.request(methods.session.load, { ...setup, sessionId: resumeId }),
            this.requestTimeout,
            'ACP session/load',
          );
          session = this.attach({ ...(res ?? {}), sessionId: resumeId });
          options = (res?.configOptions ?? []) as AcpConfigOption[];
        }
      } catch (err) {
        if (isAuthRequiredError(err)) this.setAuthState('unauthenticated');
        session = null;
        this.opts.logger?.warn?.(`[AcpProvider] could not resume session ${resumeId}: ${String(err)}`);
      }
      if (!session) {
        warnings.push({ code: 'CONVERSATION_RESTARTED', params: { provider: 'acp', reason: 'the agent could not resume its session' } });
      }
    }

    if (!session) {
      try {
        session = await this.withDeadline(this.connection.agent.buildSession(setup).start(), this.requestTimeout, 'ACP session/new');
        options = (session.newSessionResponse.configOptions ?? []) as AcpConfigOption[];
      } catch (err) {
        // Kept as a live record with the reason, so the caller can see why every send fails.
        if (isAuthRequiredError(err)) {
          this.setAuthState('unauthenticated');
          this.lastProbeError = `Sign in to ${this.label} to use it.`;
        }
        warnings.push({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
          params: { field: 'session/new', reason: `session/new failed: ${String(err)}` },
        });
      }
    }

    const conv: ConversationState = {
      session,
      params,
      listeners: new Set(),
      warnings,
      inFlight: false,
      turnSink: null,
      commands: new Set(),
      compacting: null,
      compactionSummaries: new Map(),
      configOptions: options,
      toolTitles: new Map(),
      modeBeforePlan: undefined,
      lastCost: undefined,
      lastUsage: undefined,
    };
    this.conversations.set(params.conversationId, conv);
    if (session) {
      this.startPump(conv, session);
      await this.applyChoices(conv, params.model, params.reasoningEffort);
    }
    return params.conversationId;
  }

  /** Bring the session's model and effort to what the chat asks for (`session/set_config_option`). */
  private async applyChoices(conv: ConversationState, model: string | undefined, effort: string | undefined): Promise<void> {
    if (model) {
      const option = findSelectOption(conv.configOptions, 'model');
      const value = option ? matchSelectValue(option, model) : undefined;
      if (!option) {
        conv.warnings.push({ code: 'FIELD_UNSUPPORTED_BY_PROVIDER', params: { field: 'model', provider: 'acp', reason: 'this agent chooses its own model' } });
      } else if (!value) {
        conv.warnings.push({ code: 'FIELD_COERCED', params: { field: 'model', provider: 'acp', requested: model, used: option.currentValue } });
      } else if (value !== option.currentValue) {
        await this.setConfigOption(conv, option.id, value);
      }
    }
    if (effort) {
      const option = findSelectOption(conv.configOptions, 'thought_level');
      const value = option ? matchSelectValue(option, effort) : undefined;
      if (!option) {
        conv.warnings.push({ code: 'FIELD_UNSUPPORTED_BY_PROVIDER', params: { field: 'reasoningEffort', provider: 'acp', reason: 'this agent has no effort setting' } });
      } else if (!value) {
        conv.warnings.push({ code: 'FIELD_COERCED', params: { field: 'reasoningEffort', provider: 'acp', requested: effort, used: option.currentValue } });
      } else if (value !== option.currentValue) {
        await this.setConfigOption(conv, option.id, value);
      }
    }
  }

  private async setConfigOption(conv: ConversationState, configId: string, value: string): Promise<void> {
    if (!conv.session || !this.connection) return;
    try {
      const res = await this.withDeadline(
        this.connection.agent.request(acpRuntime().methods.agent.session.setConfigOption, {
          sessionId: conv.session.sessionId,
          configId,
          value,
        }),
        this.requestTimeout,
        `ACP session/set_config_option (${configId})`,
      );
      conv.configOptions = (res.configOptions ?? conv.configOptions) as AcpConfigOption[];
      this.noteLiveOptions(conv.configOptions);
    } catch (err) {
      conv.warnings.push({ code: 'FIELD_COERCED', params: { field: configId, provider: 'acp', requested: value, reason: String(err) } });
    }
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    const live = this.conversations.get(conversationId);
    if (!live) {
      if (params) await this.createConversation(params);
      return;
    }
    if (!params || live.inFlight) return;
    // "Edit sources" (D-137) moves the cwd and extra roots, which a session fixes at creation: the move is a new
    // session in the new roots (the agent's own session is resumed into them when it can be).
    if (!sameRoots(rootsOf(live.params, this.opts.defaultCwd), params, this.opts.defaultCwd)) {
      const sessionId = live.session?.sessionId;
      await this.deleteConversation(conversationId, { keepAgentSession: true });
      await this.createConversation({
        ...params,
        ...(sessionId ? { resumeProviderSessionId: sessionId, resumeProviderSessionHarness: 'acp' } : {}),
      });
      const next = this.conversations.get(conversationId);
      if (next && !next.warnings.some((w) => w.code === 'CONVERSATION_RESTARTED') && next.session?.sessionId !== sessionId) {
        next.warnings.push({ code: 'CONVERSATION_RESTARTED', params: { provider: 'acp', reason: 'session roots moved' } });
      }
      return;
    }
    // A rebind with another model or effort: change it in place.
    live.params = { ...live.params, ...params };
    if (live.session) await this.applyChoices(live, params.model, params.reasoningEffort);
  }

  hasLiveConversation(conversationId: string): boolean {
    const conv = this.conversations.get(conversationId);
    return conv != null && conv.session != null;
  }

  getProviderSessionId(conversationId: string): string | undefined {
    return this.conversations.get(conversationId)?.session?.sessionId;
  }

  async listConversations(): Promise<string[]> {
    return [...this.conversations.keys()];
  }

  async getLastConversationId(): Promise<string | null> {
    const ids = [...this.conversations.keys()];
    return ids[ids.length - 1] ?? null;
  }

  async deleteConversation(conversationId: string, opts: { keepAgentSession?: boolean } = {}): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    this.conversations.delete(conversationId);
    if (conv.session && this.connection) {
      conv.session.dispose();
      // `session/close` only when the agent has it; bounded, so a silent agent cannot block a delete.
      if (!opts.keepAgentSession && this.agentCaps.sessionCapabilities?.close) {
        try {
          await this.withDeadline(
            this.connection.agent.request(acpRuntime().methods.agent.session.close, { sessionId: conv.session.sessionId }),
            this.requestTimeout,
            'ACP session/close',
          );
        } catch { /* best effort */ }
      }
    }
  }

  async destroyConversation(conversationId: string): Promise<void> {
    await this.deleteConversation(conversationId);
  }

  /** `session/fork` (when advertised): a new session with a copy of the whole history. */
  async forkConversation(conversationId: string, options: ForkConversationOptions): Promise<ForkConversationResult> {
    if (!this.connection) throw new Error('AcpProvider: not initialized');
    if (!this.agentCaps.sessionCapabilities?.fork) throw new Error('This agent cannot fork a session.');
    // ACP forks the whole session: a cut is not expressible, so the caller forks synthetically instead.
    if (options.throughAnchor) throw new Error('ACP session/fork copies the whole session; it cannot cut at an anchor.');
    const sourceId = this.conversations.get(conversationId)?.session?.sessionId ?? options.sourceProviderSessionId;
    if (!sourceId) throw new Error(`AcpProvider: no session to fork for "${conversationId}"`);
    const params = options.params;
    const warnings: ConversationWarning[] = [];
    const res = await this.withDeadline(
      this.connection.agent.request(acpRuntime().methods.agent.session.fork, {
        sessionId: sourceId,
        cwd: params.workingDirectory ?? this.sessionCwd,
        mcpServers: this.mcpServersFor(params, warnings),
      }),
      this.requestTimeout,
      'ACP session/fork',
    );
    const session = this.attach(res);
    const conv: ConversationState = {
      session,
      params: { ...params, conversationId: options.newConversationId },
      listeners: new Set(),
      warnings,
      inFlight: false,
      turnSink: null,
      commands: new Set(),
      compacting: null,
      compactionSummaries: new Map(),
      configOptions: (res.configOptions ?? []) as AcpConfigOption[],
      toolTitles: new Map(),
      modeBeforePlan: undefined,
      lastCost: undefined,
      lastUsage: undefined,
    };
    this.conversations.set(options.newConversationId, conv);
    this.startPump(conv, session);
    return { providerSessionId: res.sessionId };
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversations.get(conversationId)?.warnings ?? [];
  }

  async selectAgent(_conversationId: string, _agentName: string): Promise<void> {
    // One agent per connection; in-session switching is not part of ACP.
  }

  async listAgents(_conversationId: string): Promise<HarnessAgentInfo[]> {
    return [];
  }

  runtimeDiagnostics(): { liveConversations: number; liveSessions: number; warmSessions: number } {
    const live = [...this.conversations.values()].filter((c) => c.session).length;
    return { liveConversations: this.conversations.size, liveSessions: live, warmSessions: 0 };
  }

  // ── Messaging ────────────────────────────────────────────────────

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    // Fire-and-forget, but never un-caught (an unhandled rejection can take the process down).
    void this.sendPromptAndWait(conversationId, prompt, attachments, undefined, options).catch((err: unknown) => {
      const conv = this.conversations.get(conversationId);
      const message = err instanceof Error ? err.message : String(err);
      if (conv) this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'acp' } });
      this.opts.logger?.warn?.(`[AcpProvider] sendPrompt("${conversationId}") failed: ${message}`);
    });
  }

  /** The prompt's content blocks: the text, then each attachment as the agent's prompt capabilities allow. */
  private async promptBlocks(prompt: string, attachments: AttachmentRef[] | undefined, conv: ConversationState): Promise<acp.ContentBlock[]> {
    const blocks: acp.ContentBlock[] = [{ type: 'text', text: prompt }];
    const caps = this.agentCaps.promptCapabilities;
    for (const file of attachments ?? []) {
      const uri = pathToFileURL(file.path).href;
      const name = file.displayName ?? path.basename(file.path);
      try {
        const size = (await stat(file.path)).size;
        const mime = file.mimeType ?? '';
        if (mime.startsWith('image/') && caps?.image && size <= MAX_INLINE_ATTACHMENT_BYTES) {
          blocks.push({ type: 'image', mimeType: mime, data: (await readFile(file.path)).toString('base64'), uri });
          continue;
        }
        if (caps?.embeddedContext && isTextAttachment(file) && size <= MAX_INLINE_ATTACHMENT_BYTES) {
          blocks.push({ type: 'resource', resource: { uri, text: await readFile(file.path, 'utf8'), ...(mime ? { mimeType: mime } : {}) } });
          continue;
        }
        blocks.push({ type: 'resource_link', uri, name, size, ...(mime ? { mimeType: mime } : {}) });
      } catch (err) {
        conv.warnings.push({ code: 'FIELD_COERCED', params: { field: 'attachments', provider: 'acp', reason: `${name}: ${String(err)}` } });
      }
    }
    return blocks;
  }

  /** Plan turns use the agent's own `plan` mode when it has one; the next normal turn restores the mode before. */
  private async applyTurnMode(conv: ConversationState, options: SendPromptOptions | undefined): Promise<void> {
    const mode = findSelectOption(conv.configOptions, 'mode');
    const plan = planModeValue(mode);
    if (!mode || !plan) return;
    const planning = options?.agentMode === 'plan' || options?.permissionMode === 'plan';
    if (planning && mode.currentValue !== plan) {
      conv.modeBeforePlan = mode.currentValue;
      await this.setConfigOption(conv, mode.id, plan);
    } else if (!planning && conv.modeBeforePlan !== undefined && mode.currentValue === plan) {
      const back = conv.modeBeforePlan;
      conv.modeBeforePlan = undefined;
      await this.setConfigOption(conv, mode.id, back);
    }
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`AcpProvider: no conversation "${conversationId}"`);
    if (!conv.session) {
      const why = conv.warnings.find((w) => w.params['field'] === 'session/new')?.params['reason'];
      throw new Error(`AcpProvider: conversation "${conversationId}" has no live ACP session${why ? ` (${String(why)})` : ''}`);
    }
    if (conv.inFlight) throw new Error(`AcpProvider: conversation "${conversationId}" already has a turn in flight`);

    // A signal that is ALREADY aborted must not start a turn.
    if (signal?.aborted) {
      this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'acp' } });
      return { content: '' };
    }

    conv.inFlight = true;
    const session = conv.session;
    const sink = createTurnSink();
    conv.turnSink = sink;
    let assistantText = '';
    /** Tool calls announced but not yet resolved — see the W13-B1 guard below. */
    const openToolCallIds = new Set<string>();
    const costBefore = conv.lastCost;

    const onAbort = () => {
      void this.connection?.agent
        .notify(acpRuntime().methods.agent.session.cancel, { sessionId: session.sessionId })
        .catch(() => { /* best effort */ });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await this.applyTurnMode(conv, options);
      const blocks = await this.promptBlocks(prompt, attachments, conv);
      // `prompt(...)` resolves when the turn ends; the SAME completion is queued as a `stop` message for the pump,
      // which is what streams tokens as they arrive. A request failure rejects both; the no-op catch only stops
      // Node from flagging `promptPromise` as unhandled when the loop's throw surfaces it first.
      const promptPromise = session.prompt(blocks);
      promptPromise.catch(() => { /* see comment above */ });

      let response: acp.PromptResponse | undefined;
      for (;;) {
        const message = await sink.next();
        if (message.kind === 'stop') {
          response = message.response;
          if (message.stopReason === 'cancelled') {
            this.endOwnCompaction(conv, 'Compaction stopped');
            this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'acp' } });
          } else {
            // W13-B1 — a turn cut off mid-tool-call (`max_tokens`) fails every open call instead of a clean idle.
            if (message.stopReason === 'max_tokens') {
              for (const callId of openToolCallIds) {
                this.broadcast(conv, {
                  kind: 'harness.tool_complete',
                  data: {
                    tool: conv.toolTitles.get(callId) ?? callId,
                    result: `Response was truncated (stopReason: ${message.stopReason}). All tool calls in this batch are cancelled. Please re-issue your request.`,
                    callId,
                    success: false,
                  },
                });
              }
            }
            this.endOwnCompaction(conv);
            this.reportTurnUsage(conv, response, costBefore);
            this.broadcast(conv, { kind: 'harness.idle', data: {} });
          }
          break;
        }
        this.applySessionUpdate(conv, message.update, openToolCallIds);
        if (message.update.sessionUpdate === 'agent_message_chunk') {
          assistantText += textOf(message.update.content);
        }
      }

      await promptPromise;
      return { content: assistantText };
    } catch (err) {
      if (signal?.aborted) {
        this.endOwnCompaction(conv, 'Compaction stopped');
        this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'acp' } });
        return { content: assistantText };
      }
      if (isAuthRequiredError(err)) this.setAuthState('unauthenticated');
      this.endOwnCompaction(conv, String(err));
      this.broadcast(conv, { kind: 'harness.error', data: { message: String(err), provider: 'acp' } });
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      conv.inFlight = false;
      if (conv.turnSink === sink) conv.turnSink = null;
      sink.finish();
    }
  }

  /** The turn's tokens (from `PromptResponse.usage`, cumulative per session) and cost (`usage_update.cost`). */
  private reportTurnUsage(
    conv: ConversationState,
    response: acp.PromptResponse | undefined,
    costBefore: { amount: number; currency: string } | undefined,
  ): void {
    const usage = response?.usage;
    const cost = conv.lastCost;
    const costDelta = cost && (!costBefore || costBefore.currency === cost.currency) ? cost.amount - (costBefore?.amount ?? 0) : undefined;
    if (!usage && costDelta === undefined) return;
    const prev = conv.lastUsage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const now = usage
      ? {
          input: usage.inputTokens,
          output: usage.outputTokens,
          cacheRead: usage.cachedReadTokens ?? 0,
          cacheWrite: usage.cachedWriteTokens ?? 0,
        }
      : prev;
    conv.lastUsage = now;
    const model = findSelectOption(conv.configOptions, 'model')?.currentValue ?? conv.params.model ?? this.agentId;
    this.broadcast(conv, {
      kind: 'harness.usage',
      data: {
        model,
        inputTokens: Math.max(0, now.input - prev.input),
        outputTokens: Math.max(0, now.output - prev.output),
        ...(now.cacheRead - prev.cacheRead > 0 ? { cacheReadTokens: now.cacheRead - prev.cacheRead } : {}),
        ...(now.cacheWrite - prev.cacheWrite > 0 ? { cacheWriteTokens: now.cacheWrite - prev.cacheWrite } : {}),
        ...(costDelta !== undefined && cost?.currency.toUpperCase() === 'USD' ? { costUsd: Math.max(0, costDelta) } : {}),
        ...(costDelta !== undefined && cost?.currency.toUpperCase() !== 'USD' ? { cost: Math.max(0, costDelta) } : {}),
        provider: 'acp',
      },
    });
  }

  /**
   * The one reader of a session's update queue (see `ConversationState.turnSink`). Ends when the queue fails for
   * good — the session was disposed or the connection closed.
   */
  private startPump(conv: ConversationState, session: acp.ActiveSession): void {
    const idleTools = new Set<string>();
    void (async () => {
      for (;;) {
        let message: acp.ActiveSessionMessage;
        try {
          message = await session.nextUpdate();
        } catch (err) {
          const sink = conv.turnSink;
          if (!sink || conv.session !== session || !this.conversations.has(conv.params.conversationId)) return;
          // A prompt's failure rejects the readers of the moment only; the turn decides, then reading resumes.
          sink.fail(err);
          await sink.done;
          continue;
        }
        if (conv.turnSink) conv.turnSink.push(message);
        else if (message.kind === 'session_update') this.applySessionUpdate(conv, message.update, idleTools);
      }
    })();
  }

  // ── Compaction (docs/compaction) ──────────────────────────────────

  /**
   * `/compact` as a prompt (an agent advertising the `compact` command, e.g. claude-agent-acp): resolves when that
   * turn ends. The agent's `compaction_update`s report it; one that sends none is reported around the turn here.
   */
  async compactConversation(conversationId: string, options?: CompactConversationOptions): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`AcpProvider: no conversation "${conversationId}"`);
    if (!conv.commands.has('compact')) {
      throw new Error('AcpProvider: this agent does not offer compaction (it advertises no `compact` command).');
    }
    if (conv.inFlight) throw new Error(`AcpProvider: conversation "${conversationId}" already has a turn in flight`);
    const instructions = options?.instructions?.trim();
    conv.compacting = { startReported: false, endReported: false, summary: '' };
    this.reportCompaction(conv, COMPACTION_INFO.start, 'manual');
    conv.compacting.startReported = true;
    try {
      await this.sendPromptAndWait(conversationId, `/compact${instructions ? ` ${instructions}` : ''}`);
    } finally {
      conv.compacting = null;
    }
  }

  /** Our `/compact` turn ended: report its end unless the agent already did. */
  private endOwnCompaction(conv: ConversationState, error?: string): void {
    const ours = conv.compacting;
    if (!ours || ours.endReported) return;
    ours.endReported = true;
    if (error) this.reportCompaction(conv, COMPACTION_INFO.failed, 'manual', { error });
    else this.reportCompaction(conv, COMPACTION_INFO.boundary, 'manual', ours.summary ? { summary: ours.summary } : {});
  }

  private reportCompaction(
    conv: ConversationState,
    infoType: (typeof COMPACTION_INFO)[keyof typeof COMPACTION_INFO],
    trigger: CompactionTrigger,
    extra: { summary?: string; error?: string } = {},
  ): void {
    const message =
      infoType === COMPACTION_INFO.start
        ? 'Compacting conversation…'
        : infoType === COMPACTION_INFO.failed
          ? `Compaction failed${extra.error ? `: ${extra.error}` : ''}`
          : describeCompaction({ trigger });
    this.broadcast(conv, { kind: 'harness.session_info', data: { infoType, message, trigger, provider: 'acp', ...extra } });
  }

  /** `compaction_update` → the shared compaction events; ours (a `/compact` in flight) or the agent's own (auto). */
  private applyCompactionUpdate(conv: ConversationState, update: acp.CompactionUpdate): void {
    const ours = conv.compacting;
    const trigger: CompactionTrigger = ours ? 'manual' : 'auto';
    const summary = update.summary ? update.summary.map(textOf).join('') : conv.compactionSummaries.get(update.compactionId);
    switch (update.status) {
      case 'in_progress':
        if (ours?.startReported) return;
        if (ours) ours.startReported = true;
        this.reportCompaction(conv, COMPACTION_INFO.start, trigger);
        return;
      case 'completed':
        conv.compactionSummaries.delete(update.compactionId);
        if (ours) {
          if (ours.endReported) return;
          ours.endReported = true;
        }
        this.reportCompaction(conv, COMPACTION_INFO.boundary, trigger, summary ? { summary } : {});
        return;
      case 'failed':
      case 'cancelled':
        conv.compactionSummaries.delete(update.compactionId);
        if (ours) {
          if (ours.endReported) return;
          ours.endReported = true;
        }
        this.reportCompaction(conv, COMPACTION_INFO.failed, trigger, {
          error: update.error ?? (update.status === 'cancelled' ? 'Compaction cancelled' : 'Compaction failed'),
        });
        return;
      default:
        return; // a future status: wait for one we know
    }
  }

  // ── session/update → AgentEvent ───────────────────────────────────

  /** A tool call's content as a result: its text, plus a summary of diffs / terminals it carries. */
  private toolResult(content: acp.ToolCallContent[] | null | undefined): unknown {
    if (!content || content.length === 0) return null;
    const texts: string[] = [];
    const diffs: Array<{ path: string; additions: number; deletions: number }> = [];
    for (const c of content) {
      if (c.type === 'content') {
        const t = textOf(c.content);
        if (t) texts.push(t);
      } else if (c.type === 'diff') {
        diffs.push({ path: c.path, ...diffStat(c.oldText, c.newText) });
      } else if (c.type === 'terminal') {
        texts.push(`[terminal ${c.terminalId}]`);
      }
    }
    if (diffs.length === 0) return texts.join('\n');
    return { ...(texts.length ? { text: texts.join('\n') } : {}), diffs };
  }

  /** The first diff of a tool call as the transcript's "+A −D" file stat. */
  private fileOpOf(conv: ConversationState, content: acp.ToolCallContent[] | null | undefined): FileOpStat | undefined {
    const diff = content?.find((c): c is Extract<acp.ToolCallContent, { type: 'diff' }> => c.type === 'diff');
    if (!diff) return undefined;
    const root = conv.params.workingDirectory ?? this.sessionCwd;
    const rel = path.relative(root, diff.path);
    const filePath = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : diff.path;
    return { kind: diff.oldText == null ? 'create' : 'edit', filePath, ...diffStat(diff.oldText, diff.newText) };
  }

  private completeTool(conv: ConversationState, update: acp.ToolCallUpdate | acp.ToolCall, openToolCallIds: Set<string>): void {
    openToolCallIds.delete(update.toolCallId);
    const fileOp = this.fileOpOf(conv, update.content);
    this.broadcast(conv, {
      kind: 'harness.tool_complete',
      data: {
        tool: conv.toolTitles.get(update.toolCallId) ?? update.title ?? update.toolCallId,
        result: update.rawOutput ?? this.toolResult(update.content),
        callId: update.toolCallId,
        success: update.status === 'completed',
        ...(fileOp ? { fileOp } : {}),
      },
    });
    conv.toolTitles.delete(update.toolCallId);
  }

  private broadcastPlan(conv: ConversationState, steps: Array<{ step: string; status: string; priority?: string }>, message?: string): void {
    this.broadcast(conv, {
      kind: 'harness.session_info',
      data: {
        infoType: 'plan_update',
        message: message ?? describePlan(steps),
        steps,
        completed: steps.filter((s) => s.status === 'completed').length,
        total: steps.length,
        provider: 'acp',
      },
    });
  }

  /** Translate one `session/update` notification into `AgentEvent`(s). */
  private applySessionUpdate(conv: ConversationState, update: acp.SessionUpdate, openToolCallIds: Set<string>): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const text = textOf(update.content);
        if (text) this.broadcast(conv, { kind: 'harness.token', data: { text } });
        break;
      }
      case 'agent_thought_chunk': {
        const text = textOf(update.content);
        if (text) this.broadcast(conv, { kind: 'harness.reasoning_delta', data: { text } });
        break;
      }
      case 'user_message_chunk':
        break; // Echo of what we sent.
      case 'tool_call': {
        openToolCallIds.add(update.toolCallId);
        conv.toolTitles.set(update.toolCallId, update.title);
        this.broadcast(conv, {
          kind: 'harness.tool_start',
          data: { tool: update.title, args: update.rawInput, callId: update.toolCallId },
        });
        if (update.status === 'completed' || update.status === 'failed') this.completeTool(conv, update, openToolCallIds);
        break;
      }
      case 'tool_call_update': {
        if (update.title) conv.toolTitles.set(update.toolCallId, update.title);
        if (update.status === 'completed' || update.status === 'failed') {
          this.completeTool(conv, update, openToolCallIds);
        } else if (update.content?.length || update.locations?.length || update.title) {
          // Progress of a running call: its streamed content, the diff it proposes, the files it touches.
          this.broadcast(conv, {
            kind: 'harness.session_info',
            data: {
              infoType: 'tool_progress',
              message: update.title ?? conv.toolTitles.get(update.toolCallId) ?? 'Tool call',
              callId: update.toolCallId,
              ...(update.status ? { status: update.status } : {}),
              ...(update.content?.length ? { result: this.toolResult(update.content) } : {}),
              ...(update.locations?.length ? { locations: update.locations.map((l) => ({ path: l.path, ...(l.line != null ? { line: l.line } : {}) })) } : {}),
              provider: 'acp',
            },
          });
        }
        break;
      }
      case 'plan':
        this.broadcastPlan(conv, planSteps(update.entries));
        break;
      case 'plan_update': {
        const plan = update.plan;
        if (plan.type === 'items') this.broadcastPlan(conv, planSteps(plan.entries));
        else this.broadcastPlan(conv, [], plan.type === 'markdown' ? (plan as { markdown?: string }).markdown ?? 'Plan updated' : 'Plan updated');
        break;
      }
      case 'plan_removed':
        this.broadcastPlan(conv, [], 'Plan removed');
        break;
      case 'available_commands_update':
        conv.commands = new Set(update.availableCommands.map((c) => c.name.replace(/^\//, '')));
        this.broadcast(conv, {
          kind: 'harness.session_info',
          data: {
            infoType: 'available_commands',
            message: `${update.availableCommands.length} commands`,
            commands: update.availableCommands.map((c) => ({
              name: c.name.replace(/^\//, ''),
              description: c.description,
              ...(c.input && 'hint' in c.input ? { hint: (c.input as { hint?: string }).hint } : {}),
            })),
            provider: 'acp',
          },
        });
        break;
      case 'current_mode_update': {
        const mode = findSelectOption(conv.configOptions, 'mode');
        const previous = mode?.currentValue ?? '';
        this.broadcast(conv, { kind: 'harness.mode_changed', data: { previousMode: previous, newMode: update.currentModeId } });
        break;
      }
      case 'config_option_update':
        conv.configOptions = update.configOptions as AcpConfigOption[];
        this.noteLiveOptions(conv.configOptions);
        this.broadcast(conv, {
          kind: 'harness.session_info',
          data: { infoType: 'config_options', message: 'Agent settings changed', configOptions: update.configOptions, provider: 'acp' },
        });
        break;
      case 'usage_update':
        if (update.cost) conv.lastCost = { amount: update.cost.amount, currency: update.cost.currency };
        this.broadcast(conv, {
          kind: 'harness.context_usage',
          data: { provider: 'acp', source: 'provider', currentTokens: update.used, promptTokenLimit: update.size },
        });
        break;
      case 'notice': {
        const message = update.description ? `${update.title}: ${update.description}` : update.title;
        if (update.severity === 'warning' || update.severity === 'error') {
          this.broadcast(conv, { kind: 'harness.warning', data: { message, code: `acp_notice_${update.severity}`, provider: 'acp' } });
        } else {
          this.broadcast(conv, { kind: 'harness.session_info', data: { infoType: 'notice', message, provider: 'acp' } });
        }
        break;
      }
      case 'compaction_update':
        this.applyCompactionUpdate(conv, update);
        break;
      case 'compaction_summary_chunk': {
        const text = textOf(update.content);
        conv.compactionSummaries.set(update.compactionId, (conv.compactionSummaries.get(update.compactionId) ?? '') + text);
        if (conv.compacting) conv.compacting.summary += text;
        break;
      }
      default:
        // session_info_update / subagent_update / session_message… — preserved for visibility.
        this.broadcast(conv, {
          kind: 'harness.session_info',
          data: { infoType: update.sessionUpdate, message: `ACP ${update.sessionUpdate}`, raw: update },
        });
        break;
    }
  }

  async getMessages(_conversationId: string): Promise<ConversationMessage[]> {
    return []; // ACP has no history read; the transcript is ours.
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv?.session || !conv.inFlight) return;
    // W13: emit harness.cancelled at once; the notify below is fire-and-forget by design.
    this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'acp' } });
    void this.connection?.agent
      .notify(acpRuntime().methods.agent.session.cancel, { sessionId: conv.session.sessionId })
      .catch(() => { /* best effort */ });
  }

  // ── Permission gate (L16 Tier-B host gate + domain callback) ──────

  private async handleRequestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    // A throw here would escape as -32603, which is NOT a denial: every path resolves to an explicit reject.
    try {
      return await this.decidePermission(params);
    } catch (err) {
      this.opts.logger?.warn?.(
        `[AcpProvider] permission gate errored for tool "${params.toolCall.title ?? params.toolCall.toolCallId}" — denying (fail-closed): ${String(err)}`,
      );
      return this.rejectOutcome(params);
    }
  }

  /** The reject/cancel outcome for a request, preferring an explicit reject option. */
  private rejectOutcome(params: acp.RequestPermissionRequest): acp.RequestPermissionResponse {
    const reject = findOption(params.options, ['reject_once', 'reject_always']);
    return reject ? { outcome: { outcome: 'selected', optionId: reject.optionId } } : { outcome: { outcome: 'cancelled' } };
  }

  private async decidePermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const conv = [...this.conversations.values()].find((c) => c.session?.sessionId === params.sessionId);
    const tierB = this.opts.tierB ?? true; // fail-closed default

    if (tierB && isTierBBlocked(params.toolCall)) {
      if (conv) {
        this.broadcast(conv, {
          kind: 'harness.tool_complete',
          data: {
            tool: params.toolCall.title ?? params.toolCall.toolCallId,
            result:
              `Tool "${params.toolCall.title ?? params.toolCall.toolCallId}" (kind: ${params.toolCall.kind ?? 'unspecified'}) ` +
              `is blocked for Tier-B ACP agents (L16 host gate). Permitted kinds: ${[...TIER_B_ALLOWED_KINDS].join(', ')}.`,
            callId: params.toolCall.toolCallId,
            success: false,
          },
        });
      }
      return this.rejectOutcome(params);
    }

    const onPermissionRequest = conv?.params.onPermissionRequest;
    if (onPermissionRequest) {
      const kind = params.toolCall.kind;
      const domainType: 'file_write' | 'file_read' | 'shell_exec' | 'network' | 'other' =
        kind === 'edit' || kind === 'delete' || kind === 'move' ? 'file_write'
        : kind === 'read' ? 'file_read'
        : kind === 'execute' ? 'shell_exec'
        : kind === 'fetch' ? 'network'
        : 'other';
      // Bounded: the agent's JSON-RPC request is held open for the whole wait.
      const decision = await this.withDeadline(
        onPermissionRequest({
          type: domainType,
          description: params.toolCall.title ?? `ACP tool call ${params.toolCall.toolCallId}`,
          details: { rawInput: params.toolCall.rawInput },
        }),
        this.opts.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS,
        `permission decision for "${params.toolCall.title ?? params.toolCall.toolCallId}"`,
      );
      const wanted: acp.PermissionOptionKind[] = decision.granted ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
      const chosen = findOption(params.options, wanted);
      if (chosen) return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
      return { outcome: { outcome: 'cancelled' } }; // grants nothing
    }

    // No domain callback: a non-Tier-B (trusted) agent is approved; a Tier-B one only reaches here with an allowed kind.
    const allow = findOption(params.options, ['allow_once', 'allow_always']);
    return allow ? { outcome: { outcome: 'selected', optionId: allow.optionId } } : { outcome: { outcome: 'cancelled' } };
  }

  // ── Events ────────────────────────────────────────────────────────

  onConversationEvent(conversationId: string, handler: Listener<AgentEvent>): UnsubFn {
    const conv = this.conversations.get(conversationId);
    if (!conv) return () => { /* noop */ };
    conv.listeners.add(handler);
    return () => conv.listeners.delete(handler);
  }

  private broadcast(conv: ConversationState, event: AgentEvent): void {
    for (const h of conv.listeners) h(event);
  }
}

/** `auth/status` states we know; anything else is `unknown`. */
function normalizeAuthState(state: string): AcpAuthState {
  return state === 'authenticated' || state === 'unauthenticated' || state === 'not_required' ? state : 'unknown';
}

/** The effort levels `ProviderCapabilities` can name (agents may use others; the catalog keeps every value). */
function knownEfforts(values: string[]): Array<'low' | 'medium' | 'high' | 'xhigh' | 'max'> {
  const known = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
  return known.filter((k) => values.includes(k));
}
