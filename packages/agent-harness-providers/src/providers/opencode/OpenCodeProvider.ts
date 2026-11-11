// ────────────────────────────────────────────────────────────────
// OpenCodeProvider — IAgentHarness over OpenCode 2's HTTP API.
//
// Drives `opencode serve` (OpenCode ≥ 2.0.0, `@opencode/cli`) directly: routes
// under `/api/*`, types generated from the pinned 2.2.7 OpenAPI document
// (`protocol/opencode.generated.ts`, L18). docs/agent-platform/opencode.md
// describes the integration end to end; the moving parts:
//
//   server.ts       spawn `serve --stdio --port 0`, Basic auth, version gate
//   events.ts       the one server-wide SSE subscription (`GET /api/event`)
//   permissions.ts  the chat's permission mode as session rules; asks → gate
//   forms.ts        the `question` tool's forms → the question card
//   clientMcp.ts    the platform's tools as a client-hosted MCP server
//   models.ts       the model catalog, variants as reasoning efforts
//   config.ts       GeneratorAI's own config layer (compaction, skills)
//
// A turn: the session's state (rules for the turn's mode, model, agent,
// instructions, environment, MCP servers, host tools) is brought up to date,
// the prompt is ADMITTED (`POST /prompt` returns at once), and the turn ends on
// the session's execution terminal (`session.execution.succeeded | failed |
// interrupted`) — the only turn boundary OpenCode 2 has. Text and reasoning
// arrive as real deltas; tool calls as `session.tool.*`.
//
// Safety: every session carries explicit permission rules (OpenCode's own
// default is allow-everything); every in-flight turn is interrupted before the
// provider stops (an interrupt releases OpenCode's execution claim, so the
// user's own OpenCode service cannot resume our turn unattended later); and on
// (re)connecting, sessions of ours the server still runs are interrupted
// before new work is accepted.
//
// Laws: L9 capabilities declared; L18 generated protocol; W13 truncation guard
// (finish `length` fails open tool calls) and semantic cancellation.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  RewindConversationOptions,
  HarnessPermissionMode,
  AutoCompactSetting,
  McpServerConfig,
  ToolDefinition,
} from '@generatorai/core';
import { COMPACTION_INFO, describeCompaction } from '@generatorai/shared';
import type { AgentEvent, CompactionTrigger } from '@generatorai/shared';
import { buildHarnessEnv } from '../../childEnv.js';
import type { OpenCodeProviderOptions } from '../../types.js';
import type {
  Agent_Info,
  Model_Info,
  Session_Info,
  Session_Message_Info,
  SessionMessagesResponse,
  Session_StructuredError,
  TokenUsage_Info,
  Tool_Content,
} from '../../protocol/opencode.generated.js';
import { OPENCODE_OPERATIONS } from '../../protocol/opencode.generated.js';
import { openEventStream, type OpenCodeFrame } from './events.js';
import {
  HOST_TOOL_NAMESPACE,
  rememberRules,
  sessionRules,
  toPermissionRequest,
  type PermissionAsked,
  type PermissionRule,
} from './permissions.js';
import { answerFromResponse, isQuestionForm, questionsFromForm, type FormInfo } from './forms.js';
import { ClientMcpHost } from './clientMcp.js';
import {
  effortVariants,
  isUsableChatModel,
  parseModelRef,
  qualifiedModelId,
  toHarnessModel,
  type ModelRef,
} from './models.js';
import { compactionThreshold, renderConfig, writeConfig } from './config.js';
import {
  basicAuth,
  checkServer,
  spawnServer,
  stopProcess,
  OpenCodeVersionError,
  type SpawnedServer,
} from './server.js';

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

/** Session metadata key that marks a session as created by (and owned by) this app. */
export const OWNER_METADATA_KEY = 'generatorai.conversationId';
/** Instruction entry carrying the app's system-prompt append (rendered as `<context key="…">`). */
export const INSTRUCTION_KEY = 'generatorai-system';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SSE_TIMEOUT_MS = 60_000; // the server sends a heartbeat every 15 s
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_TURN_TIMEOUT_MS = 0;
/** After an interrupt, how long the server gets to confirm before the turn is settled locally. */
const INTERRUPT_SETTLE_MS = 3_000;
/** After an admitted prompt, how long before checking whether it joined a run already in progress. */
const START_CHECK_MS = 10_000;
/** The catalog is re-read at most this often. */
const CATALOG_TTL_MS = 5 * 60_000;
/** Budget for interrupting in-flight turns while stopping. */
const STOP_INTERRUPT_BUDGET_MS = 5_000;

type TurnOutcome = { kind: 'done' } | { kind: 'cancelled' } | { kind: 'failed'; error: Error };

interface TurnState {
  /** The prompt has been sent: execution events from now on belong to this turn. */
  posted: boolean;
  /** `session.execution.started` seen since `posted`; a terminal before it belongs to an older run. */
  started: boolean;
  settled: boolean;
  finish: (outcome: TurnOutcome) => void;
  done: Promise<TurnOutcome>;
  text: string;
  /** assistantMessageID → that step's text. */
  stepText: Map<string, string>;
  /** `assistantMessageID:ordinal` → reasoning text, for `reasoning_complete`. */
  reasoning: Map<string, string>;
  /** callKey → displayed tool name, for calls started and not finished. */
  openTools: Map<string, { tool: string; parentToolCallId?: string }>;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
  model?: string;
  interruptTimer?: ReturnType<typeof setTimeout>;
}

interface CompactionState {
  settled: boolean;
  resolve: () => void;
  reject: (err: Error) => void;
  cancelled: boolean;
  /** `session.compaction.ended` seen; waiting for the run's execution terminal. */
  ended: boolean;
  graceTimer?: ReturnType<typeof setTimeout>;
}

interface ConversationState {
  id: string;
  sessionId: string;
  params: CreateConversationParams;
  directory: string;
  listeners: Set<Listener<AgentEvent>>;
  warnings: ConversationWarning[];
  turn: TurnState | null;
  compaction: CompactionState | null;
  /** OpenCode's own (auto) compaction seen starting and not yet ended. */
  autoCompacting: boolean;
  /** "Don't ask again" answers, kept as session rules. */
  remembered: PermissionRule[];
  /** The permission mode the session's rules were last set for (a turn's mode can differ from the chat's). */
  mode: HarnessPermissionMode | undefined;
  /** What the session last received, so unchanged state is not re-sent every turn. */
  applied: {
    rules?: string;
    model?: string;
    agent?: string;
    instructions?: string | null;
    env?: string;
    mcp?: string;
  };
  lastContextTokens?: number;
}

interface SessionEntry {
  conversationId: string;
  /** Set for a subagent's session: the parent session, and the tool call that spawned it once known. */
  parentSessionId?: string;
  parentToolCallId?: string;
}

class OpenCodeHttpError extends Error {
  constructor(message: string, readonly status: number, readonly tag?: string) {
    super(message);
  }
}

/** `{sessionID}`-style substitution into a generated path template. */
function route(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    params[key] === undefined ? whole : encodeURIComponent(params[key]!),
  );
}

const OPS = OPENCODE_OPERATIONS;

/** `ses_…` → the session path for an operation. */
const sessionPath = (op: keyof typeof OPS, sessionID: string, extra: Record<string, string> = {}): string =>
  route(OPS[op].path, { sessionID, ...extra });

function structuredErrorMessage(e: Session_StructuredError | undefined, fallback: string): string {
  return e?.message?.trim() || e?.type || fallback;
}

/** A tool result's content as the text the transcript shows. */
function toolContentText(content: Tool_Content[] | undefined): string {
  return (content ?? [])
    .map((c) => (c.type === 'text' ? c.text : `[file: ${c.name ?? c.uri}]`))
    .join('\n');
}

/** The platform's own tools are listed to the model as `generatorai_<tool>`; the app knows them by `<tool>`. */
function displayToolName(name: string): string {
  const prefix = `${HOST_TOOL_NAMESPACE}_`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/** A model reference as a comparable key (field order differs between what we send and what the server echoes). */
function modelKey(ref: ModelRef | undefined | null): string | undefined {
  return ref ? `${ref.providerID}/${ref.id}#${ref.variant ?? ''}` : undefined;
}

/** MCP server names OpenCode accepts. */
function mcpName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * W38 — IAgentHarness backed by OpenCode 2.
 */
export class OpenCodeProvider implements IAgentHarness {
  private readonly opts: OpenCodeProviderOptions;
  private readonly requestTimeoutMs: number;
  private readonly sseTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private readonly startupTimeoutMs: number;

  private clientState: HarnessClientState = 'starting';
  private readonly clientEventListeners = new Set<Listener<HarnessClientEvent>>();
  private readonly conversations = new Map<string, ConversationState>();
  /** OpenCode session id → owning conversation (top-level and subagent sessions). */
  private readonly sessions = new Map<string, SessionEntry>();

  private baseUrl = '';
  private auth = '';
  private server: SpawnedServer | null = null;
  private ready: Promise<void> | null = null;
  private streamAbort: AbortController | null = null;
  private mcp: ClientMcpHost | null = null;
  private closed = false;
  /** Bumped every (re)connect, so a dying generation's callbacks cannot touch the next one. */
  private generation = 0;

  private catalog: { at: number; models: Model_Info[]; defaultId?: string } | null = null;
  /** Tool names seen on `session.tool.input.started` (`session.tool.called` carries none), until the call ends. */
  private readonly toolNames = new Map<string, string>();
  private agentsCache: Agent_Info[] | null = null;

  private readonly configFile: string;
  private configContent: string | null = null;
  /** The app's auto-compaction setting as last seen on a conversation (it is one app-wide setting). */
  private autoCompact: AutoCompactSetting | undefined;

  constructor(opts: OpenCodeProviderOptions) {
    this.opts = opts;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.sseTimeoutMs = opts.sseTimeoutMs ?? DEFAULT_SSE_TIMEOUT_MS;
    this.turnTimeoutMs = opts.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.startupTimeoutMs = opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.autoCompact = opts.autoCompact;
    this.configFile =
      opts.configFile ?? path.join(os.tmpdir(), 'generatorai-opencode', `opencode-${process.pid}-${randomUUID().slice(0, 8)}.json`);
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.closed = false;
    try {
      await this.ensureReady();
      this.clientState = 'running';
    } catch (err) {
      this.clientState = 'error';
      throw err;
    }
  }

  /** Whether the server this provider talks to was started by it (and so takes its config file). */
  private get ownsServer(): boolean {
    return !this.opts.baseUrl;
  }

  /** Server up, version checked, event stream connected, ours-still-running interrupted. Shared by concurrent callers. */
  private ensureReady(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('OpenCodeProvider: shut down'));
    if (!this.ready) {
      const attempt = this.connect();
      this.ready = attempt;
      attempt.catch(() => { if (this.ready === attempt) this.ready = null; });
    }
    return this.ready;
  }

  private async connect(): Promise<void> {
    const gen = ++this.generation;
    if (this.opts.baseUrl) {
      this.baseUrl = this.opts.baseUrl.replace(/\/$/, '');
      if (!this.opts.password) {
        throw new Error('OpenCodeProvider: an external OpenCode server needs its password (`password`); OpenCode 2 always requires authentication.');
      }
      this.auth = basicAuth(this.opts.password);
    } else if (this.opts.autoStart) {
      const command = this.opts.binaryPath;
      if (!command) throw new Error('OpenCodeProvider: OpenCode is not installed (no binary found).');
      this.writeManagedConfig();
      const server = await spawnServer({
        command,
        argsPrefix: this.opts.binaryArgs ?? [],
        ...(this.opts.defaultCwd ? { cwd: this.opts.defaultCwd } : {}),
        env: buildHarnessEnv({
          // OpenCode's own variables: where its data, config and models live. Its credentials are in its data dir.
          passthrough: [
            'XDG_STATE_HOME', 'OPENCODE_CONFIG_DIR', 'OPENCODE_DB', 'OPENCODE_MODELS_URL', 'OPENCODE_MODELS_PATH',
            'OPENCODE_DISABLE_MODELS_FETCH', 'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_CLAUDE_CODE',
            'OPENCODE_DISABLE_CLAUDE_CODE_SKILLS', 'OPENCODE_GIT_BASH_PATH',
          ],
          extra: {
            ...this.opts.env,
            OPENCODE_CLIENT: 'generatorai',
            OPENCODE_CONFIG: this.configFile,
          },
        }),
        startupTimeoutMs: this.startupTimeoutMs,
      });
      this.server = server;
      this.baseUrl = server.url;
      this.auth = basicAuth(server.password);
      void server.exited.then((code) => {
        if (this.generation !== gen || this.closed || this.server !== server) return;
        this.server = null;
        this.lost(gen, `the OpenCode server exited (code ${code})${server.stderrTail().trim() ? `: ${server.stderrTail().trim().slice(-500)}` : ''}`);
      });
    } else {
      throw new Error('OpenCodeProvider: no `baseUrl` and `autoStart` is off — there is no OpenCode server to talk to.');
    }

    try {
      await checkServer(this.baseUrl, this.auth, this.requestTimeoutMs);
      await this.openStream(gen);
      this.mcp?.close().catch(() => undefined);
      this.mcp = new ClientMcpHost({
        url: this.baseUrl,
        headers: { Authorization: this.auth },
        name: HOST_TOOL_NAMESPACE,
        toolsFor: (dir) => this.toolsAt(dir),
        resolveCall: (sid, tool) => this.resolveHostTool(sid, tool),
        logger: { warn: (m) => this.opts.logger?.warn?.(m) },
      });
      await this.interruptOrphans();
      // A respawned server knows nothing of what lives only in memory (session environments, runtime MCP servers,
      // the client-MCP socket): every live conversation re-sends it on its next turn.
      for (const conv of this.conversations.values()) conv.applied = { rules: conv.applied.rules, model: conv.applied.model, agent: conv.applied.agent, instructions: conv.applied.instructions };
    } catch (err) {
      await this.teardownServer(false);
      throw err;
    }
  }

  /** The event stream for generation `gen`. A drop fails what is waiting and lets the next call reconnect. */
  private async openStream(gen: number): Promise<void> {
    this.streamAbort?.abort();
    const abort = new AbortController();
    this.streamAbort = abort;
    const { ended } = await openEventStream({
      url: this.baseUrl,
      headers: { Authorization: this.auth },
      signal: abort.signal,
      connectTimeoutMs: this.requestTimeoutMs,
      idleTimeoutMs: this.sseTimeoutMs,
      onFrame: (frame) => { if (this.generation === gen) this.dispatch(frame); },
    });
    ended.catch((err: unknown) => {
      if (this.generation !== gen || this.closed) return;
      this.lost(gen, `event stream lost: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** The server or its stream went away: fail every waiter, report it, and reconnect on the next call. */
  private lost(gen: number, why: string): void {
    if (this.generation !== gen) return;
    this.generation++;
    this.ready = null;
    this.streamAbort?.abort();
    this.streamAbort = null;
    void this.mcp?.close();
    this.mcp = null;
    const err = new Error(`OpenCodeProvider: ${why}`);
    for (const conv of this.conversations.values()) {
      conv.turn?.finish({ kind: 'failed', error: err });
      if (conv.compaction && !conv.compaction.settled) this.settleCompaction(conv, err);
    }
    for (const h of this.clientEventListeners) h({ type: 'client.error', data: { message: err.message } });
    this.opts.logger?.warn?.(err.message);
    if (this.server) void this.teardownServer(false);
  }

  /**
   * Decision: before accepting work, interrupt every session of ours the server reports as still running — a turn
   * that outlived the app (an external server) must not keep going with nobody at its gates.
   */
  private async interruptOrphans(): Promise<void> {
    let active: Record<string, unknown> = {};
    try {
      active = (await this.json<{ data: Record<string, unknown> }>('GET', OPS['session.active'].path)).data ?? {};
    } catch { return; }
    await Promise.all(Object.keys(active).map(async (sessionID) => {
      try {
        const info = (await this.json<{ data: Session_Info }>('GET', sessionPath('session.get', sessionID))).data;
        if (typeof info.metadata?.[OWNER_METADATA_KEY] !== 'string') return;
        await this.json('POST', sessionPath('session.interrupt', sessionID));
        this.opts.logger?.warn?.(`[OpenCodeProvider] interrupted session ${sessionID}, still running from before`);
      } catch { /* best effort */ }
    }));
  }

  /** Interrupt every turn and compaction this provider started, so OpenCode releases their execution claims. */
  private async interruptInFlight(budgetMs: number): Promise<void> {
    if (!this.baseUrl || !this.auth) return;
    const busy = [...this.conversations.values()].filter((c) => c.turn || c.compaction);
    if (busy.length === 0) return;
    await Promise.race([
      Promise.all(busy.map((c) => this.json('POST', sessionPath('session.interrupt', c.sessionId), undefined, { timeoutMs: budgetMs }).catch(() => undefined))),
      new Promise((r) => { const t = setTimeout(r, budgetMs); t.unref?.(); }),
    ]);
  }

  private async teardownServer(interrupt: boolean): Promise<void> {
    if (interrupt) await this.interruptInFlight(STOP_INTERRUPT_BUDGET_MS);
    this.streamAbort?.abort();
    this.streamAbort = null;
    await this.mcp?.close().catch(() => undefined);
    this.mcp = null;
    const server = this.server;
    this.server = null;
    if (server) await stopProcess(server.proc, server.exited, 3_000);
  }

  async stop(): Promise<void> { await this.shutdown(); }

  async forceStop(): Promise<void> {
    this.closed = true;
    this.generation++;
    await this.interruptInFlight(1_000);
    this.failAll(new Error('OpenCodeProvider: force-stopped'));
    this.streamAbort?.abort();
    void this.mcp?.close();
    this.server?.proc.kill('SIGKILL');
    this.server = null;
    this.ready = null;
    this.clientState = 'stopped';
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.generation++;
    await this.teardownServer(true);
    this.failAll(new Error('OpenCodeProvider: shut down'));
    this.ready = null;
    this.clientState = 'stopped';
  }

  private failAll(err: Error): void {
    for (const conv of this.conversations.values()) {
      conv.turn?.finish({ kind: 'failed', error: err });
      if (conv.compaction && !conv.compaction.settled) this.settleCompaction(conv, err);
    }
  }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    if (!this.baseUrl || !this.auth) return false;
    try {
      await checkServer(this.baseUrl, this.auth, this.requestTimeoutMs);
      return true;
    } catch { return false; }
  }

  onClientEvent(handler: Listener<HarnessClientEvent>): UnsubFn {
    this.clientEventListeners.add(handler);
    return () => this.clientEventListeners.delete(handler);
  }

  // ── Capabilities (L9) ────────────────────────────────────────────

  capabilities(): ProviderCapabilities {
    return {
      // Attachments go as `file://` / `data:` URIs; per model, `Model.capabilities.input` says whether images are read.
      vision: true,
      reasoning: true,
      // Efforts are model variants; per model in the catalog.
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      // No plan tool of its own: plan turns carry the app's plan prefix and file through `record_plan` (as Codex).
      planMode: false,
      mcpServers: true,
      approvalGating: 'per_call',
      hostTools: 'full',
      structuredOutput: 'tool',
      skills: 'directories',
      sessionPersistence: true,
      // Cost is reported (USD) but OpenCode has no budget ceiling.
      budgetTracking: false,
      computerUse: false,
      prewarm: false,
      conversationFork: true,
      conversationRewind: true,
      conversationCompact: true,
      compactInstructions: false,
      accountLogin: false,
    };
  }

  // ── HTTP ─────────────────────────────────────────────────────────

  private async request(
    method: string,
    pathAndQuery: string,
    body?: unknown,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<Response> {
    if (!this.baseUrl) throw new Error('OpenCodeProvider: not connected — call initialize() first.');
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.requestTimeoutMs);
    return fetch(`${this.baseUrl}${pathAndQuery}`, {
      method,
      headers: {
        Authorization: this.auth,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
  }

  /** A JSON call: the parsed body, `undefined` for 204, an `OpenCodeHttpError` for anything else. */
  private async json<T = unknown>(
    method: string,
    pathAndQuery: string,
    body?: unknown,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    const resp = await this.request(method, pathAndQuery, body, opts);
    const text = await resp.text().catch(() => '');
    if (!resp.ok) {
      let message = text.slice(0, 500);
      let tag: string | undefined;
      try {
        const parsed = JSON.parse(text) as { _tag?: string; message?: string };
        tag = parsed._tag;
        message = parsed.message ?? message;
      } catch { /* not JSON */ }
      throw new OpenCodeHttpError(
        `OpenCodeProvider: ${method} ${pathAndQuery.split('?')[0]} failed with HTTP ${resp.status}${message ? `: ${message}` : ''}`,
        resp.status,
        tag,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private locationQuery(directory: string | undefined): string {
    return directory ? `location[directory]=${encodeURIComponent(directory)}` : '';
  }

  // ── Models and agents ────────────────────────────────────────────

  private async loadCatalog(force = false): Promise<NonNullable<OpenCodeProvider['catalog']>> {
    if (!force && this.catalog && Date.now() - this.catalog.at < CATALOG_TTL_MS) return this.catalog;
    await this.ensureReady();
    const loc = this.locationQuery(this.opts.defaultCwd);
    const [list, def] = await Promise.all([
      this.json<{ data: Model_Info[] }>('GET', `${OPS['model.list'].path}?types=chat${loc ? `&${loc}` : ''}`),
      this.json<{ data: Model_Info | null }>('GET', `${OPS['model.default'].path}${loc ? `?${loc}` : ''}`).catch(() => ({ data: null })),
    ]);
    this.catalog = {
      at: Date.now(),
      models: list.data ?? [],
      ...(def.data ? { defaultId: qualifiedModelId(def.data) } : {}),
    };
    return this.catalog;
  }

  private modelInfo(qualified: string | undefined): Model_Info | undefined {
    if (!qualified) return undefined;
    return this.catalog?.models.find((m) => qualifiedModelId(m) === qualified);
  }

  async getModels(): Promise<HarnessModel[]> {
    const catalog = await this.loadCatalog(true);
    return catalog.models.filter(isUsableChatModel).map((m) => toHarnessModel(m, qualifiedModelId(m) === catalog.defaultId));
  }

  private async agents(): Promise<Agent_Info[]> {
    if (this.agentsCache) return this.agentsCache;
    const loc = this.locationQuery(this.opts.defaultCwd);
    const res = await this.json<{ data: Agent_Info[] }>('GET', `${OPS['agent.list'].path}${loc ? `?${loc}` : ''}`);
    this.agentsCache = res.data ?? [];
    return this.agentsCache;
  }

  async listAgents(_conversationId: string): Promise<HarnessAgentInfo[]> {
    try {
      return (await this.agents())
        .filter((a) => a.mode !== 'subagent' && !a.hidden)
        .map((a) => ({
          name: a.id,
          ...(a.description ? { description: a.description } : {}),
          ...(a.model ? { model: qualifiedModelId(a.model) } : {}),
          source: 'opencode',
        }));
    } catch { return []; }
  }

  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    const known = (await this.agents().catch(() => [] as Agent_Info[])).find((a) => a.id === agentName || a.name === agentName);
    if (!known || known.mode === 'subagent') {
      conv.warnings.push({ code: 'AGENT_NOT_REGISTERED', params: { agent: agentName, provider: 'opencode' } });
      return;
    }
    await this.json('POST', sessionPath('session.switchAgent', conv.sessionId), { agent: known.id });
    conv.applied.agent = known.id;
    conv.params = { ...conv.params, defaultAgent: known.id };
  }

  // ── Conversation lifecycle ───────────────────────────────────────

  private directoryOf(params: CreateConversationParams): string {
    return params.workingDirectory ?? this.opts.defaultCwd ?? process.cwd();
  }

  /** The conversation's model as a wire reference, its effort as the matching variant. */
  private resolveModel(params: CreateConversationParams, warnings: ConversationWarning[]): ModelRef | null {
    const raw = params.model ?? this.opts.defaultModel;
    const ref = parseModelRef(raw);
    if (raw && !ref) {
      warnings.push({ code: 'FIELD_COERCED', params: { field: 'model', value: raw, reason: 'not a providerID/modelID id; the server default model runs' } });
      return null;
    }
    if (ref && params.reasoningEffort) {
      const info = this.modelInfo(raw);
      if (info && effortVariants(info).includes(params.reasoningEffort)) ref.variant = params.reasoningEffort;
      else warnings.push({ code: 'FIELD_COERCED', params: { field: 'reasoningEffort', value: params.reasoningEffort, reason: 'the model has no variant of that name' } });
    }
    return ref;
  }

  /** Warnings for fields OpenCode 2 has no way to take. */
  private unsupportedWarnings(params: CreateConversationParams): ConversationWarning[] {
    const out: ConversationWarning[] = [];
    const unsupported = (field: string, reason: string): void => {
      out.push({ code: 'FIELD_UNSUPPORTED_BY_PROVIDER', params: { field, provider: 'opencode', reason } });
    };
    if (params.systemMessage?.mode === 'replace') {
      out.push({ code: 'FIELD_COERCED', params: { field: 'systemMessage.mode', value: 'replace', reason: "OpenCode's base prompt cannot be replaced per session; the text is appended" } });
    }
    if (params.customAgents?.length) unsupported('customAgents', 'OpenCode agents are configuration (agent files), not session state');
    if (params.maxTurns != null) unsupported('maxTurns', "OpenCode's step limit is agent configuration");
    if (params.provider) unsupported('provider', "OpenCode's providers and keys are its own configuration");
    if (params.excludedTools?.length || params.availableTools?.length || params.excludedBuiltinTools?.length) {
      unsupported('excludedTools', 'tool lists are not session state in OpenCode');
    }
    if (params.contextTier === 'long_context') unsupported('contextTier', 'no context tiers in OpenCode');
    if (params.plugins?.length) unsupported('plugins', 'OpenCode plugins are configuration');
    if (!this.ownsServer) {
      if (params.skillDirectories?.length) unsupported('skillDirectories', "an external OpenCode server's own configuration decides its skills");
      if (params.autoCompact) unsupported('autoCompact', "an external OpenCode server's own configuration decides its compaction");
    }
    return out;
  }

  private ruleset(conv: ConversationState, mode: HarnessPermissionMode | undefined): PermissionRule[] {
    const p = conv.params;
    return sessionRules({
      mode,
      additionalDirectories: p.additionalDirectories,
      ...(p.disabledSkills ? { disabledSkills: p.disabledSkills } : {}),
      ...(p.skills ? { skills: p.skills } : {}),
      remembered: conv.remembered,
    });
  }

  async createConversation(params: CreateConversationParams): Promise<string> {
    await this.ensureReady();
    await this.loadCatalog().catch(() => undefined);
    const warnings: ConversationWarning[] = [...this.unsupportedWarnings(params)];
    const model = this.resolveModel(params, warnings);
    const directory = this.directoryOf(params);
    const conv: ConversationState = {
      id: params.conversationId,
      sessionId: '',
      params,
      directory,
      listeners: this.conversations.get(params.conversationId)?.listeners ?? new Set(),
      warnings,
      turn: null,
      compaction: null,
      autoCompacting: false,
      remembered: [],
      mode: params.permissionMode,
      applied: {},
    };
    const mode = params.permissionMode;
    const rules = this.ruleset(conv, mode);
    const metadata = { [OWNER_METADATA_KEY]: params.conversationId };
    const agent = await this.agentFor(params, warnings);

    if (params.resumeProviderSessionId) {
      // W12 — rejoin the session; its history is durable in OpenCode's database.
      const sessionId = params.resumeProviderSessionId;
      let info: Session_Info;
      try {
        info = (await this.json<{ data: Session_Info }>('GET', sessionPath('session.get', sessionId))).data;
      } catch (err) {
        throw err instanceof OpenCodeHttpError && err.status === 404
          ? new Error(`OpenCodeProvider: cannot resume session "${sessionId}": OpenCode no longer has it.`)
          : err;
      }
      conv.sessionId = sessionId;
      await this.json('PATCH', sessionPath('session.update', sessionId), { metadata: { ...(info.metadata ?? {}), ...metadata }, permissions: rules });
      conv.applied.rules = JSON.stringify(rules);
      if (info.location?.directory && path.resolve(info.location.directory) !== path.resolve(directory)) {
        await this.json('POST', sessionPath('session.move', sessionId), { directory });
      }
      conv.applied.model = modelKey(info.model);
      conv.applied.agent = info.agent;
      if (model && conv.applied.model !== modelKey(model)) {
        await this.json('POST', sessionPath('session.switchModel', sessionId), { model });
        conv.applied.model = modelKey(model);
      }
      if (agent && conv.applied.agent !== agent) {
        await this.json('POST', sessionPath('session.switchAgent', sessionId), { agent });
        conv.applied.agent = agent;
      }
    } else {
      const created = await this.json<{ data: Session_Info }>('POST', OPS['session.create'].path, {
        title: params.conversationId,
        location: { directory },
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {}),
        metadata,
        permissions: rules,
      });
      conv.sessionId = created.data.id;
      conv.applied = { rules: JSON.stringify(rules), ...(model ? { model: modelKey(model) } : {}), ...(agent ? { agent } : {}) };
    }

    const previous = this.conversations.get(params.conversationId);
    if (previous && previous.sessionId !== conv.sessionId) this.sessions.delete(previous.sessionId);
    this.conversations.set(params.conversationId, conv);
    this.sessions.set(conv.sessionId, { conversationId: params.conversationId });
    if (params.autoCompact) this.autoCompact = params.autoCompact;
    await this.applySessionState(conv, mode, warnings);
    return params.conversationId;
  }

  /** The OpenCode agent the conversation names, when it names one OpenCode has. */
  private async agentFor(params: CreateConversationParams, warnings: ConversationWarning[]): Promise<string | undefined> {
    if (!params.defaultAgent) return undefined;
    const known = (await this.agents().catch(() => [] as Agent_Info[])).find((a) => a.id === params.defaultAgent || a.name === params.defaultAgent);
    if (known && known.mode !== 'subagent') return known.id;
    warnings.push({ code: 'AGENT_NOT_REGISTERED', params: { agent: params.defaultAgent, provider: 'opencode' } });
    return undefined;
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    const live = this.conversations.get(conversationId);
    if (!live) {
      if (params) await this.createConversation(params);
      return;
    }
    if (!params || live.turn || live.compaction) return;
    // "Edit sources" (D-137) and setting changes rebind a live chat: the next turn re-sends whatever changed. A new
    // working directory moves the session there (`POST /move`), history and all.
    await this.ensureReady();
    const warnings = [...this.unsupportedWarnings(params)];
    const directory = this.directoryOf(params);
    if (path.resolve(directory) !== path.resolve(live.directory)) {
      await this.json('POST', sessionPath('session.move', live.sessionId), { directory });
      const old = live.directory;
      live.directory = directory;
      live.applied.mcp = undefined;
      if (![...this.conversations.values()].some((c) => c.directory === old)) this.mcp?.release(old);
    }
    live.params = params;
    const model = this.resolveModel(params, warnings);
    if (model && live.applied.model !== modelKey(model)) {
      await this.json('POST', sessionPath('session.switchModel', live.sessionId), { model });
      live.applied.model = modelKey(model);
    }
    if (params.autoCompact) this.autoCompact = params.autoCompact;
    live.warnings = warnings;
    await this.applySessionState(live, params.permissionMode, warnings);
  }

  /**
   * Bring the session's state up to what the conversation (and this turn's mode) asks for. Permission rules are
   * mandatory — a session whose rules could not be set never runs a turn. Everything else degrades to a warning.
   */
  private async applySessionState(
    conv: ConversationState,
    mode: HarnessPermissionMode | undefined,
    warnings: ConversationWarning[],
  ): Promise<void> {
    const sid = conv.sessionId;
    const rules = this.ruleset(conv, mode);
    const rulesKey = JSON.stringify(rules);
    if (conv.applied.rules !== rulesKey) {
      await this.json('PATCH', sessionPath('session.update', sid), { permissions: rules });
      conv.applied.rules = rulesKey;
    }
    conv.mode = mode;

    const soft = async (field: string, fn: () => Promise<void>): Promise<void> => {
      try { await fn(); } catch (err) {
        warnings.push({ code: 'FIELD_UNSUPPORTED_BY_PROVIDER', params: { field, provider: 'opencode', reason: err instanceof Error ? err.message : String(err) } });
      }
    };

    // System prompt: an instruction entry, rendered after OpenCode's own instructions (experimental route).
    const text = conv.params.systemMessage?.content ?? conv.params.systemPromptAppend ?? null;
    if ((conv.applied.instructions ?? null) !== text) {
      await soft('systemMessage', async () => {
        const p = route(OPS['experimental.session.instructions.entry.put'].path, { sessionID: sid, key: INSTRUCTION_KEY });
        if (text) await this.json('PUT', p, { value: text });
        else if (conv.applied.instructions) await this.json('DELETE', p);
        conv.applied.instructions = text;
      });
    }

    // Environment for the session's shell commands. Replaces `process.env` there, so it is the full child env.
    const env = buildHarnessEnv({ extra: { ...this.opts.env, ...(conv.params.env ?? {}) } });
    const envKey = JSON.stringify(env);
    if (conv.applied.env !== envKey) {
      await soft('env', async () => {
        await this.json('PUT', sessionPath('session.environment', sid), { variables: env });
        conv.applied.env = envKey;
      });
    }

    // MCP servers: added at runtime on the conversation's location (shared by the sessions there).
    const servers = Object.entries(conv.params.mcpServers ?? {}).filter(([, s]) => s.enabled !== false);
    const mcpKey = JSON.stringify([conv.directory, servers]);
    if (conv.applied.mcp !== mcpKey) {
      const loc = this.locationQuery(conv.directory);
      for (const [name, server] of servers) {
        const config = toOpenCodeMcp(server);
        if (!config) {
          warnings.push({ code: 'FIELD_UNSUPPORTED_BY_PROVIDER', params: { field: `mcpServers.${name}`, provider: 'opencode', reason: `transport "${server.type}" needs a command or url` } });
          continue;
        }
        if (server.tools?.length) {
          warnings.push({ code: 'FIELD_COERCED', params: { field: `mcpServers.${name}.tools`, value: server.tools.join(','), reason: 'OpenCode lists every tool the server offers' } });
        }
        try {
          await this.json('PUT', `${route(OPS['experimental.mcp.add'].path, { server: mcpName(name) })}?${loc}`, { config });
        } catch (err) {
          warnings.push({ code: 'MCP_SERVER_FAILED', params: { server: name, reason: err instanceof Error ? err.message : String(err) } });
        }
      }
      conv.applied.mcp = mcpKey;
    }

    // Host tools: the location's client-hosted MCP lists the union of its conversations' tools.
    if (conv.params.tools?.length || this.toolsAt(conv.directory).length) {
      await soft('tools', async () => { await this.mcp?.sync(conv.directory); });
    }

    this.writeManagedConfigAndReload();
  }

  /** Every host tool the conversations at `directory` registered. */
  private toolsAt(directory: string): ToolDefinition[] {
    const out: ToolDefinition[] = [];
    for (const conv of this.conversations.values()) {
      if (conv.directory === directory) out.push(...(conv.params.tools ?? []));
    }
    return out;
  }

  private resolveHostTool(sessionID: string | undefined, tool: string): { def: ToolDefinition } | { error: string } {
    const entry = sessionID ? this.sessions.get(sessionID) : undefined;
    const conv = entry ? this.conversations.get(entry.conversationId) : undefined;
    if (!conv) return { error: `Tool "${tool}" belongs to another client's session.` };
    const def = conv.params.tools?.find((t) => t.name === tool);
    return def ? { def } : { error: `Tool "${tool}" is not available in this conversation.` };
  }

  /** The managed config: the app's compaction setting and the union of the live conversations' skill directories. */
  private writeManagedConfig(): boolean {
    if (!this.ownsServer) return false;
    const skillDirectories = new Set<string>();
    for (const conv of this.conversations.values()) for (const d of conv.params.skillDirectories ?? []) skillDirectories.add(d);
    const content = renderConfig({ ...(this.autoCompact ? { autoCompact: this.autoCompact } : {}), skillDirectories: [...skillDirectories] });
    try {
      const changed = writeConfig(this.configFile, content, this.configContent);
      this.configContent = content;
      return changed;
    } catch (err) {
      this.opts.logger?.warn?.(`[OpenCodeProvider] could not write ${this.configFile}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Write the config and, when nothing is waiting on a gate, have the server rebuild its locations from it now. */
  private writeManagedConfigAndReload(): void {
    if (!this.writeManagedConfig() || !this.server) return;
    // A reload cancels pending permission requests and forms, so it waits for a quiet moment; the server's own
    // watcher picks the file up either way.
    if ([...this.conversations.values()].some((c) => c.turn || c.compaction)) return;
    void this.json('POST', OPS['location.reload'].path).catch(() => undefined);
  }

  hasLiveConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId);
  }

  async listConversations(): Promise<string[]> {
    return [...this.conversations.keys()];
  }

  async getLastConversationId(): Promise<string | null> {
    const ids = [...this.conversations.keys()];
    return ids[ids.length - 1] ?? null;
  }

  /** W12 — sessions are durable in OpenCode's database, so they survive a restart of either side. */
  getProviderSessionId(conversationId: string): string | undefined {
    return this.conversations.get(conversationId)?.sessionId;
  }

  async providerSessionExists(providerSessionId: string): Promise<boolean> {
    try {
      await this.ensureReady();
      await this.json('GET', sessionPath('session.get', providerSessionId));
      return true;
    } catch (err) {
      if (err instanceof OpenCodeHttpError && err.status === 404) return false;
      throw err;
    }
  }

  async deleteProviderSession(providerSessionId: string): Promise<void> {
    try {
      await this.ensureReady();
      await this.json('DELETE', sessionPath('session.remove', providerSessionId));
    } catch { /* best effort */ }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    if (conv.turn || conv.compaction) await this.abortConversation(conversationId);
    try { await this.json('DELETE', sessionPath('session.remove', conv.sessionId)); } catch { /* best effort */ }
    this.forget(conv);
  }

  private forget(conv: ConversationState): void {
    for (const [sid, entry] of this.sessions) if (entry.conversationId === conv.id) this.sessions.delete(sid);
    this.conversations.delete(conv.id);
    if (![...this.conversations.values()].some((c) => c.directory === conv.directory)) this.mcp?.release(conv.directory);
    else void this.mcp?.sync(conv.directory);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    await this.deleteConversation(conversationId);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversations.get(conversationId)?.warnings ?? [];
  }

  // ── Fork and rewind ──────────────────────────────────────────────

  /** Every message of a session, oldest first. */
  private async allMessages(sessionId: string): Promise<Session_Message_Info[]> {
    const out: Session_Message_Info[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < 1_000; page++) {
      const q = cursor ? `cursor=${encodeURIComponent(cursor)}` : 'order=asc';
      const res = await this.json<SessionMessagesResponse>('GET', `${sessionPath('session.message.list', sessionId)}?limit=200&${q}`);
      out.push(...(res.data ?? []));
      cursor = res.cursor?.next;
      if (!cursor || (res.data ?? []).length === 0) break;
    }
    return out;
  }

  /** The first message AFTER `anchorId` (the boundary a fork copies before, a revert drops from), or null when it is last. */
  private static boundaryAfter(messages: Session_Message_Info[], anchorId: string): string | null {
    const i = messages.findIndex((m) => m.id === anchorId);
    if (i < 0) throw new Error(`OpenCodeProvider: message "${anchorId}" is not in the session's history.`);
    return messages[i + 1]?.id ?? null;
  }

  async forkConversation(conversationId: string, options: ForkConversationOptions): Promise<ForkConversationResult> {
    await this.ensureReady();
    const source = this.conversations.get(conversationId)?.sessionId ?? options.sourceProviderSessionId;
    if (!source) throw new Error(`OpenCodeProvider: no OpenCode session for conversation "${conversationId}"`);
    const messages = await this.allMessages(source);
    const before = options.throughAnchor ? OpenCodeProvider.boundaryAfter(messages, options.throughAnchor.id) : null;
    const forked = (await this.json<{ data: Session_Info }>('POST', sessionPath('session.fork', source), before ? { before } : {})).data;
    // OpenCode re-keys the copied messages (`<event id>_<seq>`), in order: map each old id to its copy.
    const copied = before ? messages.slice(0, messages.findIndex((m) => m.id === before)) : messages;
    const copies = await this.allMessages(forked.id);
    const anchorMap: Record<string, string> = {};
    copied.forEach((m, i) => { const c = copies[i]; if (c && c.id !== m.id) anchorMap[m.id] = c.id; });
    // The fork inherits the source's metadata and rules; bind it as the new conversation's own.
    await this.createConversation({ ...options.params, conversationId: options.newConversationId, resumeProviderSessionId: forked.id });
    return { providerSessionId: forked.id, ...(Object.keys(anchorMap).length ? { anchorMap } : {}) };
  }

  async rewindConversation(conversationId: string, options: RewindConversationOptions): Promise<ForkConversationResult> {
    await this.ensureReady();
    const live = this.conversations.get(conversationId);
    const sessionId = live?.sessionId ?? options.providerSessionId;
    if (!sessionId) throw new Error(`OpenCodeProvider: no OpenCode session for conversation "${conversationId}"`);
    if (live?.turn || live?.compaction) throw new Error(`OpenCodeProvider: conversation "${conversationId}" has a turn in flight`);
    const messages = await this.allMessages(sessionId);
    const boundary = options.keepThrough ? OpenCodeProvider.boundaryAfter(messages, options.keepThrough.id) : (messages[0]?.id ?? null);
    if (boundary) {
      // Files are the caller's business (workspace checkpoints): only the transcript moves.
      await this.json('POST', sessionPath('session.revert.stage', sessionId), { messageID: boundary, files: false });
      await this.json('POST', sessionPath('session.revert.commit', sessionId));
    }
    if (live) await this.resumeConversation(conversationId, options.params);
    else await this.createConversation({ ...options.params, resumeProviderSessionId: sessionId });
    return { providerSessionId: sessionId };
  }

  // ── Messaging ────────────────────────────────────────────────────

  async sendPrompt(conversationId: string, prompt: string, attachments?: AttachmentRef[], options?: SendPromptOptions): Promise<void> {
    void this.sendPromptAndWait(conversationId, prompt, attachments, undefined, options).catch((err: unknown) => {
      const conv = this.conversations.get(conversationId);
      const message = err instanceof Error ? err.message : String(err);
      if (conv) this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'opencode' } });
      this.opts.logger?.warn?.(`[OpenCodeProvider] sendPrompt("${conversationId}") failed: ${message}`);
    });
  }

  /** The mode a turn runs under: the turn's explicit mode, a plan turn's `plan`, else the conversation's. */
  private turnMode(conv: ConversationState, options: SendPromptOptions | undefined): HarnessPermissionMode | undefined {
    return options?.permissionMode ?? (options?.agentMode === 'plan' ? 'plan' : conv.params.permissionMode);
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`OpenCodeProvider: no conversation "${conversationId}"`);
    if (conv.turn || conv.compaction) throw new Error(`OpenCodeProvider: conversation "${conversationId}" already has a turn in flight`);

    let finish!: (o: TurnOutcome) => void;
    const done = new Promise<TurnOutcome>((resolve) => { finish = resolve; });
    const turn: TurnState = {
      posted: false,
      started: false,
      settled: false,
      finish: (o) => {
        if (turn.settled) return;
        turn.settled = true;
        clearTimeout(turn.interruptTimer);
        finish(o);
      },
      done,
      text: '',
      stepText: new Map(),
      reasoning: new Map(),
      openTools: new Map(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    };
    conv.turn = turn;
    const onAbort = (): void => { void this.abortConversation(conversationId); };
    signal?.addEventListener('abort', onAbort, { once: true });
    let turnTimer: ReturnType<typeof setTimeout> | undefined;
    let startCheck: ReturnType<typeof setTimeout> | undefined;
    try {
      if (signal?.aborted) {
        this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'opencode' } });
        return { content: '' };
      }
      await this.ensureReady();
      const warnings: ConversationWarning[] = [];
      await this.applySessionState(conv, this.turnMode(conv, options), warnings);
      if (warnings.length) conv.warnings.push(...warnings);
      if (turn.settled) return this.conclude(conv, turn, await done);

      if (this.turnTimeoutMs > 0) {
        turnTimer = setTimeout(() => turn.finish({ kind: 'failed', error: new Error(`OpenCodeProvider: turn did not finish within ${this.turnTimeoutMs} ms`) }), this.turnTimeoutMs);
        turnTimer.unref?.();
      }
      const files = toFileAttachments(attachments);
      turn.posted = true;
      try {
        await this.json('POST', sessionPath('session.prompt', conv.sessionId), { text: prompt, ...(files.length ? { files } : {}) });
      } catch (err) {
        turn.finish({ kind: 'failed', error: err instanceof Error ? err : new Error(String(err)) });
      }
      // A prompt admitted while the session was already running joins that run (OpenCode steers it in) and sees no
      // `execution.started` of its own.
      startCheck = setTimeout(() => {
        if (turn.started || turn.settled) return;
        void this.json<{ data: Record<string, unknown> }>('GET', OPS['session.active'].path)
          .then((r) => { if (r.data && conv.sessionId in r.data) turn.started = true; })
          .catch(() => undefined);
      }, START_CHECK_MS);
      startCheck.unref?.();
      return this.conclude(conv, turn, await done);
    } catch (err) {
      if (signal?.aborted) {
        this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'opencode' } });
        return { content: turn.text };
      }
      throw err;
    } finally {
      clearTimeout(turnTimer);
      clearTimeout(startCheck);
      signal?.removeEventListener('abort', onAbort);
      turn.settled = true;
      clearTimeout(turn.interruptTimer);
      if (conv.turn === turn) conv.turn = null;
    }
  }

  /** Report the turn's end once, and resolve (or reject) the caller. */
  private conclude(conv: ConversationState, turn: TurnState, outcome: TurnOutcome): ConversationResponse {
    if (turn.usage.input + turn.usage.output + turn.usage.cacheRead + turn.usage.cacheWrite > 0 || turn.usage.cost > 0) {
      this.broadcast(conv, {
        kind: 'harness.usage',
        data: {
          model: turn.model ?? conv.params.model ?? 'unknown',
          inputTokens: turn.usage.input,
          outputTokens: turn.usage.output,
          cacheReadTokens: turn.usage.cacheRead,
          cacheWriteTokens: turn.usage.cacheWrite,
          costUsd: turn.usage.cost,
          provider: 'opencode',
        },
      });
    }
    if (outcome.kind === 'failed') {
      this.failOpenTools(conv, turn, outcome.error.message);
      this.broadcast(conv, { kind: 'harness.error', data: { message: outcome.error.message, provider: 'opencode' } });
      throw outcome.error;
    }
    if (outcome.kind === 'cancelled') {
      this.failOpenTools(conv, turn, 'the turn was stopped');
      this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'opencode' } });
      return { content: turn.text };
    }
    this.failOpenTools(conv, turn, 'the turn ended before the tool reported a result');
    this.broadcast(conv, { kind: 'harness.idle', data: {} });
    return { content: turn.text };
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return [];
    try {
      const out: ConversationMessage[] = [];
      for (const m of await this.allMessages(conv.sessionId)) {
        if (m.type === 'user') out.push({ role: 'user', content: m.text, timestamp: new Date(m.time.created) });
        else if (m.type === 'assistant') {
          const content = m.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('');
          if (content) out.push({ role: 'assistant', content, timestamp: new Date(m.time.created) });
        }
      }
      return out;
    } catch { return []; }
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    const turn = conv.turn;
    const compaction = conv.compaction;
    if (!turn && !compaction) return;
    if (compaction) compaction.cancelled = true;
    try {
      await this.json('POST', sessionPath('session.interrupt', conv.sessionId));
    } catch { /* settled locally below */ }
    // The server confirms with `session.execution.interrupted`; settle locally if it does not, so a lost
    // confirmation never leaves the conversation stuck "in flight".
    if (turn && !turn.settled) {
      turn.interruptTimer = setTimeout(() => turn.finish({ kind: 'cancelled' }), INTERRUPT_SETTLE_MS);
      turn.interruptTimer.unref?.();
    }
    if (compaction && !compaction.settled) {
      const t = setTimeout(() => this.settleCompaction(conv, 'cancelled'), INTERRUPT_SETTLE_MS);
      t.unref?.();
    }
  }

  // ── Compaction ───────────────────────────────────────────────────

  /**
   * `POST /api/session/{id}/compact` — admitted at once, run at the next safe point; finished when
   * `session.compaction.ended` (the summary is its `text`) and the run's execution terminal have arrived.
   */
  async compactConversation(conversationId: string, _options?: CompactConversationOptions): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`OpenCodeProvider: no conversation "${conversationId}"`);
    if (conv.turn || conv.compaction) throw new Error(`OpenCodeProvider: conversation "${conversationId}" already has a turn in flight`);
    await this.ensureReady();
    const finished = new Promise<void>((resolve, reject) => {
      conv.compaction = { settled: false, resolve, reject, cancelled: false, ended: false };
    });
    this.broadcastCompaction(conv, COMPACTION_INFO.start, 'manual');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.json('POST', sessionPath('session.compact', conv.sessionId), {});
      if (this.turnTimeoutMs > 0) {
        timer = setTimeout(() => this.settleCompaction(conv, new Error(`OpenCodeProvider: compaction did not finish within ${this.turnTimeoutMs} ms`)), this.turnTimeoutMs);
        timer.unref?.();
      }
    } catch (err) {
      this.settleCompaction(conv, err instanceof Error ? err : new Error(String(err)));
    }
    try {
      await finished;
    } finally {
      clearTimeout(timer);
      conv.compaction = null;
    }
  }

  /** End our compaction: `null` = it compacted, `'cancelled'` = stopped, an Error = it failed. */
  private settleCompaction(conv: ConversationState, result: null | 'cancelled' | Error): void {
    const c = conv.compaction;
    if (!c || c.settled) return;
    c.settled = true;
    clearTimeout(c.graceTimer);
    if (result === null) {
      this.broadcast(conv, { kind: 'harness.idle', data: {} });
      c.resolve();
    } else if (result === 'cancelled' || c.cancelled) {
      this.broadcastCompaction(conv, COMPACTION_INFO.failed, 'manual', 'Compaction stopped');
      this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'opencode' } });
      c.reject(new Error('Compaction stopped'));
    } else {
      this.broadcastCompaction(conv, COMPACTION_INFO.failed, 'manual', result.message);
      this.broadcast(conv, { kind: 'harness.idle', data: {} });
      c.reject(result);
    }
  }

  private broadcastCompaction(
    conv: ConversationState,
    infoType: (typeof COMPACTION_INFO)[keyof typeof COMPACTION_INFO],
    trigger: CompactionTrigger,
    error?: string,
    summary?: string,
  ): void {
    const preTokens = infoType === COMPACTION_INFO.boundary && conv.lastContextTokens && conv.lastContextTokens > 0 ? conv.lastContextTokens : undefined;
    const message =
      infoType === COMPACTION_INFO.start
        ? 'Compacting conversation…'
        : infoType === COMPACTION_INFO.failed
          ? `Compaction failed${error ? `: ${error}` : ''}`
          : describeCompaction({ trigger, ...(preTokens ? { preTokens } : {}) });
    this.broadcast(conv, {
      kind: 'harness.session_info',
      data: {
        infoType,
        message,
        trigger,
        provider: 'opencode',
        ...(error ? { error } : {}),
        ...(summary ? { summary } : {}),
        ...(preTokens ? { preTokens } : {}),
      },
    });
  }

  private onCompaction(conv: ConversationState, type: string, d: Record<string, unknown>): void {
    const trigger: CompactionTrigger = d['reason'] === 'manual' ? 'manual' : 'auto';
    const ours = trigger === 'manual' ? conv.compaction : null;
    if (type === 'session.compaction.started') {
      if (ours) return; // announced when it was requested
      if (conv.autoCompacting) return;
      conv.autoCompacting = true;
      this.broadcastCompaction(conv, COMPACTION_INFO.start, trigger);
      return;
    }
    if (type === 'session.compaction.ended') {
      const summary = typeof d['text'] === 'string' && d['text'] ? d['text'] : undefined;
      this.broadcastCompaction(conv, COMPACTION_INFO.boundary, trigger, undefined, summary);
      conv.autoCompacting = false;
      // The gauge's next figure comes with the next step; until then the old one would lie.
      conv.lastContextTokens = undefined;
      if (ours && !ours.settled) {
        ours.ended = true;
        // Wait for the run's terminal so it cannot be mistaken for the next turn's; bounded.
        ours.graceTimer = setTimeout(() => this.settleCompaction(conv, null), INTERRUPT_SETTLE_MS);
        ours.graceTimer.unref?.();
      }
      return;
    }
    // failed
    const error = structuredErrorMessage(d['error'] as Session_StructuredError | undefined, 'OpenCode could not compact the conversation');
    conv.autoCompacting = false;
    if (ours && !ours.settled) {
      this.settleCompaction(conv, ours.cancelled ? 'cancelled' : new Error(error));
      return;
    }
    this.broadcastCompaction(conv, COMPACTION_INFO.failed, trigger, error);
  }

  // ── Events ───────────────────────────────────────────────────────

  onConversationEvent(conversationId: string, handler: Listener<AgentEvent>): UnsubFn {
    const conv = this.conversations.get(conversationId);
    if (!conv) return () => { /* noop */ };
    conv.listeners.add(handler);
    return () => conv.listeners.delete(handler);
  }

  private broadcast(conv: ConversationState, event: AgentEvent): void {
    for (const h of conv.listeners) {
      try { h(event); } catch { /* a listener's bug is not the stream's */ }
    }
  }

  private dispatch(frame: OpenCodeFrame): void {
    const d = frame.data;
    switch (frame.type) {
      case 'permission.asked':
        void this.onPermission(d as unknown as PermissionAsked);
        return;
      case 'form.created':
        void this.onForm((d['form'] ?? {}) as FormInfo);
        return;
      case 'session.created': {
        const parent = typeof d['parentID'] === 'string' ? d['parentID'] : undefined;
        const sid = typeof d['sessionID'] === 'string' ? d['sessionID'] : undefined;
        const owner = parent ? this.sessions.get(parent) : undefined;
        if (sid && owner) this.sessions.set(sid, { conversationId: owner.conversationId, parentSessionId: parent });
        return;
      }
      default:
        break;
    }
    const sid = typeof d['sessionID'] === 'string' ? d['sessionID'] : undefined;
    const entry = sid ? this.sessions.get(sid) : undefined;
    if (!sid || !entry) return;
    const conv = this.conversations.get(entry.conversationId);
    if (!conv) return;
    const child = entry.parentSessionId !== undefined;

    if (frame.type.startsWith('session.compaction.')) {
      if (!child) this.onCompaction(conv, frame.type, d);
      return;
    }
    if (frame.type.startsWith('session.execution.')) {
      if (child) return;
      this.onExecution(conv, frame.type, d);
      return;
    }
    const turn = conv.turn;
    if (!turn || !turn.posted || turn.settled) return;
    const amid = typeof d['assistantMessageID'] === 'string' ? d['assistantMessageID'] : '';
    const callKey = `${amid}:${String(d['id'] ?? '')}`;
    const parentToolCallId = child ? entry.parentToolCallId : undefined;

    switch (frame.type) {
      case 'session.step.started': {
        const model = d['model'] as ModelRef | undefined;
        if (!child && model) turn.model = qualifiedModelId(model);
        return;
      }
      case 'session.text.delta': {
        if (child) return; // a subagent's prose is its own; the parent reports what it learned
        const delta = typeof d['delta'] === 'string' ? d['delta'] : '';
        if (!delta) return;
        turn.text += delta;
        turn.stepText.set(amid, (turn.stepText.get(amid) ?? '') + delta);
        this.broadcast(conv, { kind: 'harness.token', data: { text: delta } });
        return;
      }
      case 'session.reasoning.delta': {
        if (child) return;
        const delta = typeof d['delta'] === 'string' ? d['delta'] : '';
        if (!delta) return;
        const k = `${amid}:${String(d['ordinal'] ?? 0)}`;
        turn.reasoning.set(k, (turn.reasoning.get(k) ?? '') + delta);
        this.broadcast(conv, { kind: 'harness.reasoning_delta', data: { text: delta } });
        return;
      }
      case 'session.reasoning.ended': {
        if (child) return;
        const k = `${amid}:${String(d['ordinal'] ?? 0)}`;
        const text = typeof d['text'] === 'string' ? d['text'] : (turn.reasoning.get(k) ?? '');
        turn.reasoning.delete(k);
        if (text.trim()) this.broadcast(conv, { kind: 'harness.reasoning_complete', data: { content: text } });
        return;
      }
      case 'session.tool.input.started': {
        const name = typeof d['name'] === 'string' ? d['name'] : 'tool';
        this.toolNames.set(callKey, name);
        if (this.toolNames.size > 10_000) this.toolNames.delete(this.toolNames.keys().next().value as string);
        return;
      }
      case 'session.tool.called': {
        if (turn.openTools.has(callKey)) return;
        const tool = displayToolName(this.toolNames.get(callKey) ?? 'tool');
        turn.openTools.set(callKey, { tool, ...(parentToolCallId ? { parentToolCallId } : {}) });
        this.broadcast(conv, {
          kind: 'harness.tool_start',
          data: { tool, args: d['input'] ?? {}, callId: callKey, ...(parentToolCallId ? { parentToolCallId } : {}) },
        });
        return;
      }
      case 'session.tool.progress': {
        // A subagent call reports its child session in its progress metadata: link the child's calls to it.
        const meta = d['metadata'] as Record<string, unknown> | undefined;
        const childSid = typeof meta?.['sessionID'] === 'string' ? meta['sessionID'] : undefined;
        const childEntry = childSid ? this.sessions.get(childSid) : undefined;
        if (childEntry && childEntry.conversationId === conv.id && !childEntry.parentToolCallId) childEntry.parentToolCallId = callKey;
        return;
      }
      case 'session.tool.success':
      case 'session.tool.failed': {
        const open = turn.openTools.get(callKey);
        const tool = open?.tool ?? displayToolName(this.toolNames.get(callKey) ?? 'tool');
        turn.openTools.delete(callKey);
        this.toolNames.delete(callKey);
        const success = frame.type === 'session.tool.success';
        const text = toolContentText(d['content'] as Tool_Content[] | undefined);
        const result = success ? text : [structuredErrorMessage(d['error'] as Session_StructuredError | undefined, 'Tool failed'), text].filter(Boolean).join('\n');
        this.broadcast(conv, {
          kind: 'harness.tool_complete',
          data: { tool, result, callId: callKey, success, ...(parentToolCallId ? { parentToolCallId } : {}) },
        });
        return;
      }
      case 'session.step.ended': {
        if (child) return;
        const tokens = d['tokens'] as TokenUsage_Info | undefined;
        if (tokens) {
          turn.usage.input += tokens.input;
          turn.usage.output += tokens.output + (tokens.reasoning ?? 0);
          turn.usage.cacheRead += tokens.cache?.read ?? 0;
          turn.usage.cacheWrite += tokens.cache?.write ?? 0;
        }
        if (typeof d['cost'] === 'number') turn.usage.cost += d['cost'];
        this.broadcast(conv, {
          kind: 'harness.message_complete',
          data: { content: turn.stepText.get(amid) ?? '', providerMessageId: amid },
        });
        turn.stepText.delete(amid);
        const finishReason = d['finish'];
        if (finishReason === 'length') {
          // W13/B1 — a truncated response: fail the calls still open, never report them done.
          this.failOpenTools(conv, turn, 'the response was truncated (finish: length)');
        } else if (finishReason === 'content-filter') {
          this.broadcast(conv, { kind: 'harness.warning', data: { message: 'The model stopped: its output was filtered.', code: 'content_filter', provider: 'opencode' } });
        }
        if (tokens) this.emitContextUsage(conv, tokens, turn.model);
        return;
      }
      case 'session.retry.scheduled': {
        if (child) return;
        const error = structuredErrorMessage(d['error'] as Session_StructuredError | undefined, 'request failed');
        this.broadcast(conv, { kind: 'harness.warning', data: { message: `Retrying: ${error}`, code: 'retry', provider: 'opencode' } });
        return;
      }
      default:
        return;
    }
  }

  private onExecution(conv: ConversationState, type: string, d: Record<string, unknown>): void {
    const compaction = conv.compaction;
    if (compaction && !compaction.settled && !conv.turn) {
      if (type === 'session.execution.started') return;
      if (type === 'session.execution.succeeded') { if (compaction.ended) this.settleCompaction(conv, null); return; }
      if (type === 'session.execution.interrupted') { this.settleCompaction(conv, 'cancelled'); return; }
      if (type === 'session.execution.failed') {
        this.settleCompaction(conv, new Error(structuredErrorMessage(d['error'] as Session_StructuredError | undefined, 'compaction failed')));
      }
      return;
    }
    const turn = conv.turn;
    if (!turn || !turn.posted || turn.settled) return;
    if (type === 'session.execution.started') { turn.started = true; return; }
    if (!turn.started) return; // the end of a run that began before this prompt
    switch (type) {
      case 'session.execution.succeeded':
        turn.finish({ kind: 'done' });
        return;
      case 'session.execution.interrupted': {
        const reason = d['reason'];
        if (reason === 'shutdown') turn.finish({ kind: 'failed', error: new Error('OpenCodeProvider: the OpenCode server shut down during the turn') });
        else turn.finish({ kind: 'cancelled' });
        return;
      }
      case 'session.execution.failed': {
        const error = d['error'] as Session_StructuredError | undefined;
        if (error?.type === 'aborted') { turn.finish({ kind: 'cancelled' }); return; }
        turn.finish({ kind: 'failed', error: new Error(structuredErrorMessage(error, 'the turn failed')) });
        return;
      }
      default:
        return;
    }
  }

  /** The gauge: what the last request occupied, against the model's window and OpenCode's compaction point. */
  private emitContextUsage(conv: ConversationState, tokens: TokenUsage_Info, model: string | undefined): void {
    const current = tokens.input + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0) + tokens.output;
    if (current <= 0) return;
    conv.lastContextTokens = current;
    const info = this.modelInfo(model);
    const promptTokenLimit = info?.limit?.input ?? info?.limit?.context;
    const threshold = this.ownsServer ? compactionThreshold(info?.limit?.context, this.autoCompact) : undefined;
    this.broadcast(conv, {
      kind: 'harness.context_usage',
      data: {
        provider: 'opencode',
        ...(model ? { model } : {}),
        source: 'derived',
        currentTokens: current,
        ...(promptTokenLimit ? { promptTokenLimit } : {}),
        ...(info?.limit?.context ? { totalContextWindow: info.limit.context } : {}),
        ...(threshold ? { compactionThreshold: threshold } : {}),
        apiUsage: { input: tokens.input, output: tokens.output, cacheRead: tokens.cache?.read ?? 0, cacheWrite: tokens.cache?.write ?? 0 },
      },
    });
  }

  /** W13/B1 — fail every tool call still open, with the reason. */
  private failOpenTools(conv: ConversationState, turn: TurnState, why: string): void {
    for (const [callId, open] of turn.openTools) {
      this.broadcast(conv, {
        kind: 'harness.tool_complete',
        data: {
          tool: open.tool,
          result: `Tool call cancelled: ${why}. All tool calls in this batch are cancelled. Please re-issue your request.`,
          callId,
          success: false,
          ...(open.parentToolCallId ? { parentToolCallId: open.parentToolCallId } : {}),
        },
      });
    }
    turn.openTools.clear();
  }

  // ── Gates ────────────────────────────────────────────────────────

  /** `permission.asked` → the chat's approval gate → `POST …/permission/{id}/reply`. Requests for sessions not ours are left alone. */
  private async onPermission(asked: PermissionAsked): Promise<void> {
    const entry = this.sessions.get(asked.sessionID);
    const conv = entry ? this.conversations.get(entry.conversationId) : undefined;
    if (!conv) return;
    let decision: 'once' | 'reject' = 'reject';
    let message: string | undefined;
    const handler = conv.params.onPermissionRequest;
    try {
      if (handler) {
        const answer = await handler(toPermissionRequest(asked));
        decision = answer.granted ? 'once' : 'reject';
        if (!answer.granted && answer.reason) message = answer.reason;
        if (answer.granted && answer.remember) {
          conv.remembered.push(...rememberRules(asked));
          const rules = this.ruleset(conv, conv.mode);
          // The asking session (a subagent's, perhaps) and the conversation's own both learn it.
          for (const sid of new Set([conv.sessionId, asked.sessionID])) {
            await this.json('PATCH', sessionPath('session.update', sid), { permissions: rules }).catch(() => undefined);
          }
          conv.applied.rules = JSON.stringify(rules);
        }
      } else {
        // Nobody to ask: fail closed (a bypass session never asks in the first place).
        message = 'No one is available to approve this action.';
      }
    } catch (err) {
      message = `The approval could not be obtained: ${err instanceof Error ? err.message : String(err)}`;
    }
    try {
      await this.json('POST', sessionPath('session.permission.reply', asked.sessionID, { requestID: asked.id }), {
        decision,
        ...(message ? { message } : {}),
      });
    } catch (err) {
      this.opts.logger?.warn?.(`[OpenCodeProvider] permission reply failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** `form.created` → the question card (for the `question` tool) → reply, or a cancel with the reason as feedback. */
  private async onForm(form: FormInfo): Promise<void> {
    const entry = form.sessionID ? this.sessions.get(form.sessionID) : undefined;
    const conv = entry ? this.conversations.get(entry.conversationId) : undefined;
    if (!conv || !form.id) return;
    const formPath = sessionPath('session.form.cancel', form.sessionID, { formID: form.id });
    const cancel = (message: string): Promise<unknown> =>
      this.json('DELETE', `${formPath}?message=${encodeURIComponent(message)}`).catch(() => undefined);

    const questions = isQuestionForm(form) ? questionsFromForm(form) : null;
    const gate = conv.params.onQuestionRequest;
    if (!questions || !gate) {
      await cancel(
        !isQuestionForm(form) || !questions
          ? `GeneratorAI cannot show this form ("${form.title}"). Continue without it.`
          : 'The user cannot be asked right now. Continue with your best judgement and state the assumption you made.',
      );
      return;
    }
    try {
      const response = await gate({ questions });
      const answer = answerFromResponse(form, response);
      if (answer) {
        await this.json('POST', sessionPath('session.form.reply', form.sessionID, { formID: form.id }), { answer });
      } else {
        await cancel(response.freeformResponse?.trim() || 'The user dismissed the question without answering.');
      }
    } catch (err) {
      await cancel(`The question could not be shown: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Attachments as prompt files: absolute `file://` URIs (OpenCode sniffs the type from the bytes). */
function toFileAttachments(attachments: AttachmentRef[] | undefined): Array<{ uri: string; name?: string }> {
  const out: Array<{ uri: string; name?: string }> = [];
  for (const att of attachments ?? []) {
    if (att.type !== 'file' || !att.path) continue;
    const uri = /^(file|data):/i.test(att.path) ? att.path : pathToFileURL(path.resolve(att.path)).href;
    out.push({ uri, name: att.displayName ?? path.basename(att.path) });
  }
  return out;
}

/** The app's MCP server config as OpenCode's, tools listed directly (Code Mode is off in our sessions anyway). */
function toOpenCodeMcp(server: McpServerConfig): Record<string, unknown> | null {
  const timeout = server.timeoutMs ? { timeout: { execution: server.timeoutMs } } : {};
  if (server.type === 'stdio') {
    if (!server.command) return null;
    return {
      type: 'local',
      command: [server.command, ...(server.args ?? [])],
      ...(server.cwd ? { cwd: server.cwd } : {}),
      ...(server.env ? { environment: server.env } : {}),
      codemode: false,
      ...timeout,
    };
  }
  if (!server.url) return null;
  return { type: 'remote', url: server.url, ...(server.headers ? { headers: server.headers } : {}), codemode: false, ...timeout };
}

export { OpenCodeVersionError };
