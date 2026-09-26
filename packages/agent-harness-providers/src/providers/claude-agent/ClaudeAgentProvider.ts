// ────────────────────────────────────────────────────────────────
// ClaudeAgentProvider — IAgentHarness implementation wrapping
// the Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
//
// Two runtime shapes, chosen per call site (item 17 of
// docs/APPLICATION-REVIEW-2026-09.md):
//
//   • Chat (`sendPrompt`) — ONE long-lived streaming-input `query()` per
//     conversation. The prompt is an async iterable we push each user turn
//     into, so the CLI process, its MCP servers and its context survive
//     across messages; Stop is `interrupt()`, model / permission-mode / MCP
//     changes go through the live setters, and only a change to cwd, system
//     prompt, tool lists, skills or agents tears the session down (rebuilt
//     with `resume`). `GENERATORAI_CLAUDE_PERSISTENT_SESSIONS=false` falls
//     back to one-shot.
//   • Workflow stages (`sendPromptAndWait`) — one-shot `query({ prompt:
//     string })`: a single-message conversation in a per-run directory gains
//     nothing from a persistent process and would only leave one idle.
//
// Sessions are bounded (item 16): idle conversations are swept and a
// least-recently-used cap applies, but a conversation with a turn in
// flight is never evicted. Event handlers are AWAITED (item 19), so a slow
// consumer pauses the SDK read loop instead of piling events up.
//
// This adapter bridges:
//   SDK async iterators  →  IAgentHarness callback events
//   SDK sessions         →  IAgentHarness conversation lifecycle
//   SDK MCP tools        →  Domain ToolDefinition[]
// ────────────────────────────────────────────────────────────────

// ── W41 — the SDK is resolved on FIRST USE, not at module load ──
//
// This was `import { query, deleteSession } from '@anthropic-ai/claude-agent-sdk'`
// — a static VALUE import, which meant merely importing this module (as the
// package barrel used to, eagerly) resolved and evaluated the whole Claude
// Agent SDK. `HarnessFactory.loadClaudeAgentModule()`'s dynamic import was
// therefore decorative: by the time it ran the SDK was long since loaded, and
// W41's "boot loads zero provider SDK code" was false. `import type` is erased
// by the compiler, so the types below cost nothing at runtime.
import type {
  Query,
  Options as ClaudeOptions,
  SDKMessage,
  SDKUserMessage,
  SDKControlGetContextUsageResponse as ClaudeContextUsageResponse,
  WarmQuery,
} from '@anthropic-ai/claude-agent-sdk';
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
  HarnessRuntimeDiagnostics,
  ForkConversationOptions,
  ForkConversationResult,
  RewindConversationOptions,
} from '@generatorai/core';
import type { HookBridge } from '@generatorai/core';
import type { AgentEvent, AgentEventKind } from '@generatorai/shared';
import { HarnessSessionError, withSpan, getMeter, createAgentEvent, GenAiTurnSpans } from '@generatorai/shared';
import { lastIterationUsage, mapClaudeAgentMessageToAgentEvents } from './event-mapper.js';
// W41 — `./tool-factory.js` value-imports `createSdkMcpServer` from the Claude
// SDK (and `zod`), so importing it statically here would defeat the lazy load
// above. It is imported dynamically at its single call site in
// `createConversation`. `ToolSemaphore` comes from its own SDK-free module
// (tool-factory only re-exports it) so it can stay static.
import { ToolSemaphore, MAX_PARALLEL_TOOLS } from '../../toolSemaphore.js';
import { mapClaudeToolNameToDomainType } from './permission-map.js';
import type { AgentHostSupervisor } from '../../AgentHostSupervisor.js';
import { cancelSemantically, CancellationInFlight } from '../../hardening/semanticCancel.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import type {
  ClaudeAgentProviderOptions,
  ActiveQuery,
  StoredConversationConfig,
  PlanPhaseState,
} from './types.js';
import {
  ASK_USER_QUESTION_TOOL,
  EXIT_PLAN_MODE_TOOL,
  CLAUDE_PLAN_ACTIONS,
  buildAskUserQuestionResult,
  derivePlanSummary,
  extractPlanContent,
  isFileReadTool,
  isFileWriteTool,
  isPlanGateTool,
  normaliseClaudeQuestions,
} from './plan-gate.js';
import { buildHarnessEnv, filterDelegatedHarnessEnv } from '../../childEnv.js';
import { toHarnessError } from '../../errors.js';

// ── W41 — lazy SDK module singleton ──────────────────────────────
//
// Resolved once, on first use, and cached for the process lifetime. Mirrors
// `HarnessFactory`'s module cache so a provider that is constructed but never
// driven (e.g. a registry entry for an account the user never selects) still
// costs nothing.

// `import type * as` — erased at compile time, so the SDK is still only
// loaded by the dynamic `import()` below (W41). The inline `typeof import()`
// form this replaces is what `consistent-type-imports` forbids.
import type * as ClaudeAgentSdkNs from '@anthropic-ai/claude-agent-sdk';
type ClaudeAgentSdk = typeof ClaudeAgentSdkNs;

let claudeSdk: ClaudeAgentSdk | null = null;
let claudeSdkLoading: Promise<ClaudeAgentSdk> | null = null;

/**
 * Resolve `@anthropic-ai/claude-agent-sdk`.
 *
 * The SDK is an OPTIONAL dependency, so a failure here is a legitimate runtime
 * state ("this build doesn't have Claude installed"), not a crash — callers
 * surface it as a provider-unavailable error rather than letting it escape at
 * import time, which is what a static import would have done to the whole
 * process.
 */
export async function loadClaudeSdk(): Promise<ClaudeAgentSdk> {
  if (claudeSdk) return claudeSdk;
  claudeSdkLoading ??= import('@anthropic-ai/claude-agent-sdk')
    .then((mod) => {
      claudeSdk = mod;
      return mod;
    })
    .catch((err: unknown) => {
      // Clear the memo so a later call can retry (e.g. after an install).
      claudeSdkLoading = null;
      throw err;
    });
  return claudeSdkLoading;
}

/** W41 — test seam: has the SDK been pulled into this process yet? */
export function isClaudeSdkLoaded(): boolean {
  return claudeSdk !== null;
}

/**
 * Test seam: substitute a fake SDK module (a `query()` that yields scripted
 * messages) so the session machinery can be driven without a CLI. Pass
 * `null` to restore lazy loading. Not part of the provider's public API.
 */
export function __setClaudeSdkForTests(sdk: Partial<ClaudeAgentSdk> | null): void {
  claudeSdk = sdk as ClaudeAgentSdk | null;
  claudeSdkLoading = null;
}

// ── Item 17 — persistent streaming-input sessions ───────────────

/**
 * The async iterable a persistent session is opened with. Each user turn is
 * `push()`ed in; the SDK pulls from it for the lifetime of the session.
 */
class AsyncInputQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: (): Promise<IteratorResult<T>> => {
        this.end();
        return Promise.resolve({ value: undefined as unknown as T, done: true });
      },
    };
  }
}

/** One live CLI process serving one conversation across many turns. */
interface PersistentSession {
  conversationId: string;
  query: Query;
  input: AsyncInputQueue<SDKUserMessage>;
  /** `sessionFingerprint()` of the options it was opened with. */
  fingerprint: string;
  /** What the live setters currently hold, so a turn only calls them on change. */
  liveModel: string | undefined;
  livePermissionMode: string | undefined;
  liveMcpKey: string;
  /** The SDK's own session id, captured from `system/init`; drives `resume`. */
  sdkSessionId: string | undefined;
  closed: boolean;
  reader: Promise<void>;
}

/**
 * Per-turn bookkeeping shared by the persistent and one-shot paths, so the
 * message handling, truncation guard, transcript accumulation and permit
 * release exist exactly once.
 */
/** The events that end a turn for everything downstream of the provider. */
function isTerminalEvent(event: { kind: string }): boolean {
  return event.kind === 'harness.idle' || event.kind === 'harness.error';
}

/**
 * A `result` the CLI produced for its own bookkeeping, not for the prompt.
 *
 * A resumed session settles unfinished business before it reads the next
 * message. The common case: a background shell the agent started was killed
 * when the app (and the CLI under it) last exited. On the next prompt the CLI
 * first reports that — a `task_notification`, then a `result` with
 * `num_turns: 0`, no text, no tokens and no cost — and only THEN runs the
 * prompt and sends the real `result`.
 *
 * The reader used to take the first `result` as the end of the turn. The
 * user's message was answered by the model, billed, and thrown away: the chat
 * showed the prompt with nothing under it and no error, and the answer arrived
 * a second later to a turn that no longer existed.
 *
 * Every condition has to hold, so a real answer can never be mistaken for
 * one: nothing from the model yet, zero turns, empty text, zero tokens. A
 * CLI-local command (`/compact`) also ends with zero turns and is exempt —
 * for it this IS the answer.
 */
function isHousekeepingResult(message: SDKMessage, turn: TurnState): boolean {
  if (message.type !== 'result' || message.subtype !== 'success') return false;
  if (turn.sawAssistant || turn.fullContent || turn.localCommand) return false;
  const result = message as unknown as {
    num_turns?: number;
    result?: string;
    usage?: Record<string, unknown>;
  };
  if (result.num_turns !== 0 || result.result) return false;
  const usage = result.usage ?? {};
  const spent = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
    .reduce((sum, key) => sum + (typeof usage[key] === 'number' ? (usage[key] as number) : 0), 0);
  return spent === 0;
}

interface TurnState {
  conversationId: string;
  activeQuery: ActiveQuery;
  startedAt: number;
  fullContent: string;
  pendingToolNames: string[];
  /**
   * True once the model has said or done anything for THIS prompt. Until then
   * a `result` cannot be the answer to it — see `isHousekeepingResult`.
   */
  sawAssistant: boolean;
  /**
   * The prompt is a CLI-local command (`/compact`, `/clear`…). Those finish
   * with a zero-turn result and no assistant message, legitimately.
   */
  localCommand: boolean;
  truncationStopReason?: string;
  releaseExecution?: () => void;
  /** Set by Stop. Everything the runtime sends afterwards is discarded. */
  aborted: boolean;
  cancellation?: CancellationInFlight;
  /**
   * The live session this turn was pushed into (persistent mode). The
   * session's reader is what settles the turn when the CLI answers the
   * interrupt or dies — without the link a reader ending could settle a turn
   * that belongs to a session rebuilt after it.
   */
  session?: PersistentSession;
  settled: boolean;
  /** Resolves when the turn has reached a terminal state, however it got there. */
  done: Promise<void>;
  settle: () => void;
}

/**
 * The options that have NO live setter in the installed SDK (0.3.220) and
 * therefore force a session rebuild when they change: cwd, system prompt,
 * tool lists, skills, agents, env, effort and budgets. Model, permission mode
 * and MCP servers are deliberately absent — those go through `setModel`,
 * `setPermissionMode` and `setMcpServers` on the live session.
 */
/** Above this an image costs more than it informs; the model reads the file instead. */
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * How long a speculative pre-warm waits for the CLI's initialize handshake
 * before giving up. The SDK's own default is 60 s, which is far too patient
 * for work nobody is waiting on.
 */
const PREWARM_INITIALIZE_TIMEOUT_MS = 30_000;

/**
 * Memory bounds for persistent sessions. Each live session is a ~230 MB
 * `claude` CLI process, so these defaults ARE the memory budget:
 *
 *   - `DEFAULT_MAX_LIVE_SESSIONS` was 32 (= 7.4 GB of processes) while the
 *     turn permit (the `provider:claude-agent` flow key) defaults to 4.
 *     Eight is twice the permit: enough that a user flipping between a few
 *     chats keeps them warm, small enough that a busy server tops out near
 *     1.8 GB of CLI processes.
 *   - `DEFAULT_SESSION_IDLE_MINUTES` was 30. An abandoned chat should not hold
 *     230 MB for half an hour; resuming after ten minutes costs one cold
 *     start, which the pre-warm path already amortises.
 *
 * Override with `GENERATORAI_CLAUDE_MAX_LIVE_SESSIONS` and
 * `GENERATORAI_CLAUDE_SESSION_IDLE_MINUTES`.
 */
const DEFAULT_MAX_LIVE_SESSIONS = 8;
const DEFAULT_SESSION_IDLE_MINUTES = 10;

/** In-memory transcript copy kept per conversation (see `pushMessage`). */
const MAX_TRANSCRIPT_MESSAGES = 400;

/**
 * `ping()` reports unhealthy after this many consecutive failed turns — the
 * same threshold the circuit breaker in `sendPrompt` uses, so health goes red
 * at the moment the adapter starts refusing work instead of never.
 */
const PING_UNHEALTHY_AFTER_FAILURES = 3;

/**
 * Exported for tests: the fingerprint decides whether a live session can be
 * reused or must be torn down and rebuilt, so "is this field in it?" is a
 * behavioural question, not an implementation detail.
 */
export function sessionFingerprint(options: ClaudeOptions): string {
  const o = options as unknown as Record<string, unknown>;
  const hooks = (o['hooks'] as Record<string, unknown[] | undefined> | undefined) ?? {};
  return JSON.stringify({
    cwd: o['cwd'],
    // Same reason as `cwd`: no live setter exists for the extra roots, so a
    // chat that gains or loses a mount must rebuild rather than keep running
    // against the roots it was launched with.
    additionalDirectories: o['additionalDirectories'],
    systemPrompt: o['systemPrompt'],
    tools: o['tools'],
    allowedTools: o['allowedTools'],
    disallowedTools: o['disallowedTools'],
    skills: o['skills'],
    plugins: o['plugins'],
    agent: o['agent'],
    agents: o['agents'],
    effort: o['effort'],
    maxTurns: o['maxTurns'],
    maxBudgetUsd: o['maxBudgetUsd'],
    env: o['env'],
    settingSources: o['settingSources'],
    enableFileCheckpointing: o['enableFileCheckpointing'],
    includePartialMessages: o['includePartialMessages'],
    includeHookEvents: o['includeHookEvents'],
    planModeInstructions: o['planModeInstructions'],
    allowDangerouslySkipPermissions: o['allowDangerouslySkipPermissions'],
    canUseTool: typeof o['canUseTool'] === 'function',
    hooks: Object.keys(hooks).sort().map((k) => `${k}:${hooks[k]?.length ?? 0}`),
    executable: o['pathToClaudeCodeExecutable'],
  });
}

/**
 * Identity of the MCP server SET, by name and transport. In-process SDK
 * servers (`type: 'sdk'`) carry a live `instance` whose identity changes on
 * every rebind, so they are keyed by name alone; the tool NAMES they expose
 * are already part of `allowedTools` and therefore of the session fingerprint.
 */
function mcpFingerprint(servers: Record<string, unknown> | undefined): string {
  if (!servers) return '';
  return JSON.stringify(
    Object.keys(servers)
      .sort()
      .map((name) => {
        const s = (servers[name] ?? {}) as Record<string, unknown>;
        return [name, s['type'], s['command'], s['args'], s['url']];
      }),
  );
}

/** Image attachments become content blocks; anything else is referenced by path. */
const IMAGE_MEDIA_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

type UserContentBlock = Exclude<SDKUserMessage['message']['content'], string>[number];

/** Bound on remembered session ids for evicted conversations (item 16). */
const REMEMBERED_SESSION_IDS_MAX = 512;

/**
 * Locate the user's installed Claude Code CLI.
 *
 * This matters for correctness, not just convenience. The SDK ships its own
 * bundled CLI, and that copy can lag well behind the installed one — on an
 * enterprise account the stale bundle advertised models the organization has
 * disabled (Opus, Fable) and resolved `default` to a model the account cannot
 * call, so every request with those aliases failed with "may not exist or you
 * may not have access to it". The installed CLI returns the correct,
 * policy-filtered catalog (e.g. "Sonnet 4.6 · Set by your organization").
 *
 * Search order:
 *   1. Explicit override (`cliPath`).
 *   2. `CLAUDE_CLI_PATH` / `CLAUDE_CODE_PATH` environment variables.
 *   3. `claude` on `PATH`.
 *
 * Returns `undefined` when nothing is found, in which case the SDK falls back
 * to its bundled executable.
 */
function resolveClaudeCliPath(explicitPath?: string): string | undefined {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;

  for (const key of ['CLAUDE_CLI_PATH', 'CLAUDE_CODE_PATH'] as const) {
    const envPath = process.env[key];
    if (envPath && existsSync(envPath)) return envPath;
  }

  // `where` (Windows) / `which` (POSIX) resolves shims and PATH entries the
  // way the user's own shell would.
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(probe, ['claude'], { encoding: 'utf8', windowsHide: true });
    const first = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l && existsSync(l));
    if (first) return first;
  } catch {
    /* not on PATH — fall back to the SDK's bundled CLI */
  }
  return undefined;
}

/** Account / auth state reported by the Claude CLI's control channel. */
export interface ClaudeAccountInfo {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  /** `'none'` means the CLI has no credentials — provider unusable. */
  tokenSource?: string;
  apiKeySource?: string;
  apiProvider?: string;
}

/** The subset of the SDK's `ModelInfo` we consume (kept local to avoid a hard type dep). */
interface ClaudeModelInfo {
  value: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
}

/**
 * Fold the concrete model version into the display name.
 *
 * The CLI's `value` is an *alias* (`opus[1m]`, `sonnet`) and `displayName` is
 * just the family ("Opus", "Sonnet"), so on their own they never tell you
 * whether you're getting Opus 4.8 or Opus 5. The real version only appears in
 * the prose `description` ("Opus 4.8 with 1M context · …"), so we lift it out
 * and splice it in:
 *
 *   "Opus"               + "Opus 4.8 with 1M context…"  → "Opus 4.8"
 *   "Sonnet (1M context)"+ "Sonnet 4.6 for long…"       → "Sonnet 4.6 (1M context)"
 *
 * Aliases whose family doesn't appear in their own description (notably
 * `default`, described as "…currently Opus 4.8…") are left alone, because the
 * version there belongs to whatever the alias resolves to today.
 */
function versionedModelName(displayName: string, description?: string): string {
  if (!description) return displayName;
  const base = displayName.split(/[\s(]/)[0];
  if (!base) return displayName;
  const match = new RegExp(`\\b${base}\\s+(\\d+(?:\\.\\d+)?)\\b`, 'i').exec(description);
  const version = match?.[1];
  if (!version || displayName.includes(version)) return displayName;
  return displayName.replace(new RegExp(`^${base}`, 'i'), `${base} ${version}`);
}

/**
 * Map the CLI's live `ModelInfo` onto our provider-neutral `HarnessModel`.
 *
 * The CLI reports capability flags and a prose description but no structured
 * context/pricing numbers, so we infer the context window from the tier
 * encoded in the alias (`sonnet[1m]` → 1M) and leave anything we can't know
 * undefined rather than inventing values.
 */
/**
 * The reasoning effort of a chat that never chose one. One constant, used for
 * what runs AND for what the model list advertises as the default, so the two
 * cannot drift apart again. Mid-tier on purpose: never default a model to one
 * of its most expensive settings.
 */
const DEFAULT_EFFORT = 'medium';

function mapClaudeModelInfo(m: ClaudeModelInfo, runtimeDefaultEffort?: string): HarnessModel {
  const id = m.value;
  const longContext = /\[1m\]/i.test(id);
  const model: HarnessModel = {
    id,
    name: versionedModelName(m.displayName || id, m.description),
    provider: 'claude-agent',
  };
  if (m.description) model.description = m.description;
  if (/opus|fable/i.test(id)) model.category = 'powerful';
  else if (/haiku/i.test(id)) model.category = 'lightweight';
  else model.category = 'versatile';

  if (longContext) {
    // Anthropic's advertised window covers prompt + completion. Until a real
    // turn tells us the account's actual output reserve we treat the whole
    // window as the prompt budget rather than inventing a reserve.
    model.totalContextWindow = 1_000_000;
    model.promptTokenLimit = 1_000_000;
    model.contextWindow = 1_000_000;
    model.standardContextWindow = 200_000;
    model.supportsLongContext = true;
    model.longContext = { promptTokenLimit: 1_000_000, totalContextWindow: 1_000_000 };
  } else if (id !== 'default') {
    model.totalContextWindow = 200_000;
    model.promptTokenLimit = 200_000;
    model.contextWindow = 200_000;
  } else {
    // The `default` alias resolves to whichever model Anthropic currently
    // recommends. Every first-party Claude model ships a 200K standard window,
    // so seed that instead of leaving it blank (which used to drop the gauge
    // onto a 128K hardcoded guess). Corrected from `modelUsage` after one turn.
    model.totalContextWindow = 200_000;
    model.promptTokenLimit = 200_000;
    model.contextWindow = 200_000;
  }

  if (m.supportsEffort) {
    model.supportsReasoning = true;
    if (m.supportedEffortLevels?.length) {
      model.reasoningEfforts = [...m.supportedEffortLevels];
      // Prefer a mid level so we never default a model to its most expensive tier.
      //
      // This is what the composer DISPLAYS for a chat that has never touched
      // the control, so it has to be the level such a chat actually runs at.
      // It was not: the list advertised "medium" while the runtime fell back
      // to "high", and every chat showing "Medium" was billed and paced as
      // High. The runtime default comes first; "medium" is only the answer
      // when the model cannot do that level.
      model.defaultReasoningEffort =
        runtimeDefaultEffort && m.supportedEffortLevels.includes(runtimeDefaultEffort as never)
          ? runtimeDefaultEffort
          : m.supportedEffortLevels.includes('medium')
            ? 'medium'
            : m.supportedEffortLevels[0];
    }
  }
  return model;
}

// ── OTel Metrics ──
const meter = getMeter('claude-agent-bridge');
const promptCounter = meter.createCounter('claude_agent.prompts.total', {
  description: 'Total prompts sent to Claude Agent SDK',
});
const promptDuration = meter.createHistogram('claude_agent.prompt.duration_ms', {
  description: 'Duration of Claude Agent SDK queries in ms',
  unit: 'ms',
});
const activeSessions = meter.createUpDownCounter('claude_agent.active_sessions', {
  description: 'Number of active Claude Agent sessions',
});
const listenerHighWaterMark = meter.createUpDownCounter('claude_agent.listeners.high_water_mark', {
  description: 'Peak per-conversation listener count',
});
const listenerLeakWarnings = meter.createCounter('claude_agent.listeners.leak_warnings', {
  description: 'Listener-leak warnings emitted',
});

const LISTENER_LEAK_THRESHOLD = 50;

// ── W35 — PreToolUse gate primitives ─────────────────────────────
//
// Hoisted to module scope so BOTH construction paths (`buildClaudeHooks`, the
// bridge translator, and `buildConversationHooks`, the always-on installer)
// build the SDK entry the same way. Two copies of this shape is exactly how
// the gate came to exist on one path and not the other.

/** The domain policy callback a `PreToolUse` gate delegates to. */
type PreToolUseGate = NonNullable<HookBridge['onPreToolUse']>;

/**
 * W35-B2 — deadline for a single `PreToolUse` gate evaluation.
 *
 * A hung permission handler must not wedge the agent forever, and the
 * expiry MUST deny: a gate that opens on timeout is not a gate.
 */
const PRE_TOOL_USE_GATE_TIMEOUT_MS = 5_000;

/** Wrap a plain handler into the SDK's `Options.hooks` matcher/callback shape. */
function wrapClaudeHook(
  fn: (input: Record<string, unknown>) => Promise<Record<string, unknown> | void>,
): unknown[] {
  return [{ hooks: [async (input: unknown) => (await fn(input as Record<string, unknown>)) ?? {}] }];
}

/**
 * W35 — how many tool calls ran through the always-installed `PreToolUse`
 * hook with NO policy attached (neither a conversation `HookBridge` nor a
 * provider-level default gate). This is the observable that keeps the
 * capability ledger honest: a non-zero count means tool calls on this process
 * are gated only by the SDK's own permission evaluation, which per Anthropic
 * ("`canUseTool` … is invoked only when the permission evaluation flow
 * resolves to a prompt") is NOT a security boundary.
 */
const ungatedToolCalls = meter.createCounter('claude_agent.tool_gate.ungated_calls', {
  description: 'Tool calls that reached PreToolUse with no policy gate installed',
});

/**
 * W13 / X-1 — Maximum parallel tool calls per conversation.
 *
 * The SDK emits tool_call batches from a single model response; without a
 * cap a single response with 30 tool calls spawns 30 concurrent shell
 * executions, file writes, etc. This value is the measured safe point —
 * above 8 the sequential overhead of inter-process setup starts to exceed
 * the parallelism benefit for most tool workloads.
 *
 * Set `GENERATORAI_MAX_PARALLEL_TOOLS=0` to disable limiting.
 *
 * W13 — the value now comes from `toolSemaphore.ts` (imported at the top of
 * this file) rather than being re-parsed here. This file and
 * `CopilotProvider.ts` each used to carry their own
 * `Number(process.env[...] ?? 8)`, so the two providers could disagree about
 * the bound, and a typo'd env var became `NaN` independently in each.
 */

/**
 * W13-B1: Returns true when a model stop reason indicates the response was
 * cut off before completion. In this case tool call arguments may be
 * incomplete — executing them risks data loss (X-2 "A truncated path handed
 * to a delete or write tool").
 *
 * References:
 *  - Anthropic API: stop_reason = 'max_tokens' (output budget exhausted)
 *  - Some providers use 'length' for the same condition
 *  - context_length errors can also manifest here
 */
/*
 * Exported ONLY so `__tests__/truncation-guard.test.ts` can assert against the
 * real predicate. That suite used to paste a copy of this function into itself,
 * which meant deleting the guard here left the suite green — the regression
 * evidence for W13-B1 tested nothing. Not part of the provider's public API.
 */
/* W13-B1 */
export function isTruncationStopReason(reason: string): boolean {
  const r = reason.toLowerCase();
  return r === 'max_tokens' || r === 'length' || r.includes('max_token') || r.includes('context_length');
}

export class ClaudeAgentProvider implements IAgentHarness {
  // ── Internal State ──
  private conversations = new Map<string, StoredConversationConfig>();
  private activeQueries = new Map<string, ActiveQuery>();
  /**
   * Item 19 — handlers may be async, and they are AWAITED. A handler that
   * persists the event (ChatManagementService → EventBus → SQLite) returns
   * its promise, and `emitEventToHandlers` does not move on until it settles,
   * so the SDK message loop behind it pauses too. Before this the type was
   * `=> void` and the promise was structurally unreachable — the queue grew
   * and the transcript fell progressively behind the model on long answers.
   */
  private conversationEventHandlers = new Map<string, Set<(event: AgentEvent) => void | Promise<void>>>();
  /** Item 17 — one live streaming-input session per chat conversation. */
  private readonly sessions = new Map<string, PersistentSession>();
  /** The turn in flight per conversation, for BOTH runtime modes. */
  private readonly turns = new Map<string, TurnState>();
  /**
   * Turns still waiting for their execution permit, per conversation. A stop
   * while queued aborts these, which withdraws the wait: the turn never
   * starts (ECON-R6).
   */
  private readonly queuedTurns = new Map<string, Set<AbortController>>();
  /**
   * Item 16 — SDK session ids of conversations the sweep or the LRU cap
   * evicted. `createConversation` for such a conversation resumes from here
   * when the caller cannot supply `resumeProviderSessionId`, so eviction never
   * costs the model its history — only its process. Bounded FIFO.
   */
  private readonly evictedSessionIds = new Map<string, string>();
  private readonly persistentSessions: boolean;
  /**
   * Conversations pre-warmed by `prewarmConversation` but not yet used.
   *
   * The SDK's `startup()` spawns the CLI and completes the initialize
   * handshake without a prompt; `WarmQuery.query()` then attaches the input
   * queue to an already-ready process. Measured, that turns a 12.8 s first
   * turn into ~3 s.
   *
   * The stored fingerprint is what makes this safe: if the first turn's
   * options differ structurally from what we warmed with, the handle is
   * closed and the session is built the old way rather than running against
   * options the process does not actually have.
   */
  /**
   * Pre-spawned sessions waiting for their first prompt.
   *
   * `built` records the options the handle was actually CONSTRUCTED with.
   * `sessionFingerprint` deliberately omits `model`, `permissionMode` and
   * `mcpServers` because a live session can be switched between them with
   * setters — but those setters only exist on a Query, which does not exist
   * until `warm.query(input)` starts the turn. So for a warm handle they are
   * construction-time after all, and a turn that needs different values must
   * not claim it.
   */
  private readonly warmSessions = new Map<
    string,
    {
      warm: WarmQuery;
      fingerprint: string;
      built: { permissionMode?: string; model?: string; mcpKey: string };
    }
  >();
  private readonly sessionIdleMs: number;
  private readonly maxLiveConversations: number;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private conversationListenerCleanups = new Map<string, Set<() => void>>();
  private conversationLeakWarned = new Set<string>();
  private clientEventHandlers = new Set<(event: HarnessClientEvent) => void>();
  private clientState: HarnessClientState = 'stopped';
  private verbose: boolean;
  private querySuccessCount = 0;
  /**
   * HITL-07 (Claude parity): Per-conversation "permission request in-flight"
   * counter. `sendPromptAndWait`'s `defaultTimeoutMs` watchdog must not
   * fire while a human is being asked to approve a tool call — otherwise
   * a slow approver spuriously fails the stage. Same design as
   * `CopilotProvider.permissionPending`.
   */
  private permissionPending = new Map<string, number>();
  private queryFailCount = 0;

  /**
   * W13 / X-1 — process-wide semaphore bounding parallel tool execution.
   *
   * Shared across ALL conversations in this adapter so the total concurrent
   * domain-tool calls is bounded process-wide, not just per-conversation.
   * MAX_PARALLEL_TOOLS=0 (env override) disables limiting (unlimited).
   */
  private readonly toolSemaphore = new ToolSemaphore(MAX_PARALLEL_TOOLS);

  /** P07 WP-7.4 — `chat <model>` spans per turn and `execute_tool` spans per tool call (GenAI conventions). */
  private readonly genai = new GenAiTurnSpans('claude-agent-bridge', 'claude-agent');

  /**
   * W12 / P0-14 / item 4 — optional supervisor gating concurrent turns.
   * When set, EVERY turn (`sendPrompt` and `sendPromptAndWait`) acquires one
   * execution slot before it starts and releases it when it settles, so the
   * number of concurrently running CLI turns is bounded on the chat path too.
   * See `acquireTurnPermit`.
   */
  private readonly supervisor: AgentHostSupervisor | undefined;

  /**
   * PLN-01 — per-conversation plan-mode phase. Populated when a turn runs with
   * `agentMode: 'plan'` and cleared when the turn ends. See `plan-gate.ts` for
   * why the transition is realised here rather than via `setPermissionMode`.
   */
  private planPhases = new Map<string, PlanPhaseState>();

  // Accumulated messages per conversation for getMessages()
  private conversationMessages = new Map<string, ConversationMessage[]>();
  /** Warnings raised while translating the last create/resume for a conversation. */
  private conversationWarnings = new Map<string, ConversationWarning[]>();
  /** Agents registered on each conversation. */
  private conversationAgents = new Map<string, HarnessAgentInfo[]>();

  /**
   * W35 — provider-level default `PreToolUse` policy.
   *
   * The `PreToolUse` hook is ALWAYS installed (see `buildConversationHooks`),
   * but a hook with nothing to ask is not a boundary. This is the one place a
   * host can attach a policy that applies to EVERY conversation this provider
   * creates, including the ones that pass no `hooks` of their own —
   * `acp-entry.ts` and the workflow engine's stage sessions, both of which rely
   * solely on `canUseTool` and are therefore ungated.
   *
   * Left `undefined` deliberately: see `DEFER` in `preToolUseHandler` for why
   * the no-policy default cannot be "deny", and `capabilities()` for why the
   * `preToolUseGated()` reports false until this is set.
   */
  private defaultToolGate: PreToolUseGate | undefined;

  /**
   * W35 — install (or clear) the provider-level default tool gate.
   *
   * Setting this flips `preToolUseGated()` to `true`, because it
   * is then true: every conversation, hooks or no hooks, is evaluated by a
   * fail-closed `PreToolUse` policy. Callers that do NOT set it get an honest
   * `false` rather than the unconditional `true` this provider used to claim.
   *
   * Takes effect on the NEXT tool call of every conversation — the installed
   * `PreToolUse` hook reads `this.defaultToolGate` when it fires rather than
   * capturing it when the hook is built, so a persistent session opened
   * before this was called is covered without a rebuild.
   */
  setDefaultToolGate(gate: PreToolUseGate | undefined): void {
    this.defaultToolGate = gate;
  }

  /** W35 — whether a provider-level default gate is installed. */
  hasDefaultToolGate(): boolean {
    return this.defaultToolGate !== undefined;
  }

  constructor(private options: ClaudeAgentProviderOptions) {
    this.supervisor = options.supervisor;
    this.verbose = options.verbose ?? (process.env['GENERATORAI_LOG_LEVEL'] === 'debug');
    this.cliPath = resolveClaudeCliPath(options.cliPath);
    // Item 17 kill switch — default ON.
    const persistentEnv = process.env['GENERATORAI_CLAUDE_PERSISTENT_SESSIONS'];
    this.persistentSessions =
      options.persistentSessions ?? !(persistentEnv === 'false' || persistentEnv === '0');
    // Item 16 bounds.
    const idleMinutes = Number(process.env['GENERATORAI_CLAUDE_SESSION_IDLE_MINUTES'] ?? DEFAULT_SESSION_IDLE_MINUTES);
    this.sessionIdleMs =
      options.sessionIdleMs ?? (Number.isFinite(idleMinutes) ? Math.max(0, idleMinutes) * 60_000 : DEFAULT_SESSION_IDLE_MINUTES * 60_000);
    const maxLive = Number(process.env['GENERATORAI_CLAUDE_MAX_LIVE_SESSIONS'] ?? DEFAULT_MAX_LIVE_SESSIONS);
    this.maxLiveConversations =
      options.maxLiveConversations ?? (Number.isFinite(maxLive) && maxLive > 0 ? maxLive : DEFAULT_MAX_LIVE_SESSIONS);
    if (this.verbose) {
      console.log(
        `[ClaudeAgentAdapter] CLI: ${this.cliPath ?? '(SDK bundled)'}; ` +
          `sessions=${this.persistentSessions ? 'persistent' : 'one-shot'} ` +
          `idle=${this.sessionIdleMs}ms max=${this.maxLiveConversations}`,
      );
    }
  }

  /**
   * Installed Claude Code CLI, when we found one. Every `query()` is pinned to
   * it so the model catalog and enterprise policy match what the user sees in
   * their own terminal (the SDK's bundled CLI can be stale).
   */
  private readonly cliPath: string | undefined;

  /** Base options every `query()` shares. */
  private baseQueryOptions(): Partial<ClaudeOptions> {
    return this.cliPath ? { pathToClaudeCodeExecutable: this.cliPath } : {};
  }

  // ══════════════════════════════════════════════════════════════
  // Client Lifecycle
  // ══════════════════════════════════════════════════════════════

  async initialize(): Promise<void> {
    return withSpan('claude-agent-bridge', 'claude_agent.initialize', async () => {
      this.clientState = 'running';
      this.emitClientEvent({ type: 'client.started' });
      if (this.verbose) {
        console.log(
          `[ClaudeAgentAdapter] Initialized (${this.persistentSessions ? 'persistent session per chat' : 'one-shot query per turn'})`,
        );
      }
    });
  }

  async stop(): Promise<void> {
    return withSpan('claude-agent-bridge', 'claude_agent.stop', async () => {
      this.stopAllTurnsAndSessions();
      this.clientState = 'stopped';
      this.emitClientEvent({ type: 'client.stopped' });
    });
  }

  async forceStop(): Promise<void> {
    this.stopAllTurnsAndSessions();
    this.clientState = 'stopped';
    this.emitClientEvent({ type: 'client.stopped', data: { message: 'Force stopped' } });
  }

  /** Abort every turn in flight and close every live session. */
  private stopAllTurnsAndSessions(): void {
    for (const turn of [...this.turns.values()]) {
      turn.aborted = true;
      void this.completeTurn(turn, 'aborted');
    }
    for (const [, aq] of this.activeQueries) {
      aq.abortController.abort();
      aq.closeHandle?.();
      aq.status = 'aborted';
    }
    this.activeQueries.clear();
    for (const session of [...this.sessions.values()]) {
      void this.closeSession(session, 'provider stopped');
    }
  }

  private consecutiveFailCount = 0;

  getClientState(): HarnessClientState {
    // Derive from consecutive failures (resets on success)
    if (this.consecutiveFailCount >= 3) {
      return 'error';
    }
    return this.clientState;
  }

  async ping(): Promise<boolean> {
    // There is no cheap liveness probe on the control channel that does not
    // itself cost a CLI round-trip. What CAN be said without spawning: the
    // adapter is started, the CLI it pinned still exists on disk (an
    // uninstall or an update that moved it mid-life), and turns are not
    // failing back to back. Before this it returned a state string that was
    // `true` from boot to shutdown whatever the CLI did.
    if (this.clientState !== 'running') return false;
    if (this.cliPath && !existsSync(this.cliPath)) return false;
    return this.consecutiveFailCount < PING_UNHEALTHY_AFTER_FAILURES;
  }

  async shutdown(): Promise<void> {
    await this.stop();
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.conversations.clear();
    this.conversationMessages.clear();
    this.conversationEventHandlers.clear();
    this.conversationListenerCleanups.clear();
    this.clientEventHandlers.clear();
    this.sessions.clear();
    this.turns.clear();
    this.evictedSessionIds.clear();
  }

  // ══════════════════════════════════════════════════════════════
  // Capability declarations (W42 / N-2)
  // ══════════════════════════════════════════════════════════════

  /**
   * Declared capabilities for the Claude Agent SDK adapter.
   *
   * L9: Capability discovery is by declaration, not by exception.
   * W42 — N-2 fix: no runtime probe required.
   *
   * W35 — PreToolUse gating is NO LONGER claimed unconditionally (see `preToolUseGated`).
   *
   * It used to be, on the strength of a comment asserting "the PreToolUse hook
   * fires on EVERY tool call". The hook did fire on every tool call — of the
   * conversations that supplied a `HookBridge` with an `onPreToolUse`. Two
   * production callers supply none (`apps/server/src/acp-entry.ts`, and
   * the workflow engine's stage sessions, which pass `onPermissionRequest` but no
   * `hooks`), so for them nothing was installed and the only gate was
   * `canUseTool` — which Anthropic documents as "invoked only when the
   * permission evaluation flow resolves to a prompt … To gate every tool call,
   * use a `PreToolUse` hook instead", i.e. explicitly not a boundary (N-5).
   * The ledger was claiming a property the runtime did not have.
   *
   * Two changes make claim and runtime agree:
   *   1. The `PreToolUse` hook is now installed on EVERY conversation
   *      (`buildConversationHooks`), so a policy always has somewhere to land
   *      and no caller has to remember to opt in.
   *   2. `preToolUseGated()` reports whether a POLICY is actually attached.
   *      Provider-wide that means `setDefaultToolGate()` has been called; per
   *      conversation it also counts the conversation's own `hooks.onPreToolUse`.
   *
   * The capability ledger itself declares `approvalGating: 'per_call'`: with
   * the session's permission handler attached, canUseTool reaches it for
   * every call the turn's permission mode does not auto-allow (PD-17).
   */
  capabilities(): ProviderCapabilities {
    return {
      vision: true,
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      maxParallelTools: MAX_PARALLEL_TOOLS > 0 ? MAX_PARALLEL_TOOLS : undefined,
      planMode: true,
      mcpServers: true,
      // No SDK option takes skill DIRECTORIES; skills load from a local
      // plugin root (`Options.plugins`) filtered by `Options.skills` (RV-7).
      skills: 'plugin',
      // With the session's permission handler attached, canUseTool reaches it
      // for every call the mode does not auto-allow (PD-17). The PreToolUse
      // hook is a separate, optional policy (W35: `hasDefaultToolGate`).
      approvalGating: 'per_call',
      hostTools: 'full',
      structuredOutput: 'native',
      sessionPersistence: true,
      budgetTracking: true,
      // `forkSession(id, { upToMessageId })` copies the transcript file up to
      // an assistant message uuid — no CLI process, no tokens. A rewind is the
      // same fork with the chat re-pointed at the branch.
      conversationFork: true,
      conversationRewind: true,
      maxContextTokens: 200_000,
      // MINOR-4 fix: computerUse must be explicitly declared (L9 fail-closed).
      // Claude supports the native computer_use tool via its SDK.
      computerUse: true,
      // Only in persistent-session mode: one-shot queries build and discard a
      // process per turn, so there is nothing for a warm handle to be reused by.
      prewarm: this.persistentSessions,
    };
  }

  /**
   * W35 — capabilities as they actually apply to ONE conversation.
   *
   * `IAgentHarness.capabilities()` takes no arguments, so it can only describe
   * the provider-wide floor. Tool gating, though, is decided per conversation:
   * a chat that supplies `hooks.onPreToolUse` is fully gated even when no
   * provider-level default has been installed. Callers holding a conversation
   * id should ask this instead of the ledger's floor.
   *
   * An unknown conversation id reports the floor — fail-closed: we never
   * claim gating for a conversation we cannot see.
   */
  conversationCapabilities(_conversationId: string): ProviderCapabilities {
    return this.capabilities();
  }

  /**
   * W35 — whether a PreToolUse POLICY applies to a conversation: its own
   * hook bridge, or the provider-wide default gate. The hook is always
   * installed; without a policy it defers to the SDK's own permission
   * evaluation. Unknown conversations report the provider-wide answer.
   */
  preToolUseGated(conversationId?: string): boolean {
    const bridge = conversationId ? (this.conversations.get(conversationId)?.hooks as HookBridge | undefined) : undefined;
    return !!bridge?.onPreToolUse || this.hasDefaultToolGate();
  }

  // ══════════════════════════════════════════════════════════════
  // Model Discovery
  // ══════════════════════════════════════════════════════════════

  /**
   * Live model catalog from the Claude CLI, cached for `MODEL_CACHE_TTL_MS`.
   *
   * The catalog is what the *logged-in account* is actually entitled to, so
   * it reflects enterprise policy and model availability. Probing costs a
   * CLI round-trip (~10s cold), hence the cache.
   */
  private modelCache: { rows: Array<{ model: HarnessModel; resolvedModel?: string }>; at: number } | null = null;
  private modelProbeInFlight: Promise<HarnessModel[]> | null = null;
  private static readonly MODEL_CACHE_TTL_MS = 5 * 60_000;

  /**
   * Real per-model limits observed at runtime, keyed by model id.
   *
   * `supportedModels()` returns aliases and prose only — no numbers — so the
   * catalog would otherwise have to guess the context window from the alias
   * name. Every `result` message carries `modelUsage[model].contextWindow` and
   * `.maxOutputTokens` for the account actually in use, so we learn the truth
   * as soon as the user runs one turn and stop guessing from then on.
   */
  private observedModelLimits = new Map<string, { contextWindow?: number; maxOutputTokens?: number }>();

  /**
   * Record limits seen in a `result` message so the catalog can self-correct.
   *
   * Item 24 — this must NOT invalidate `modelCache`. It used to, on every
   * turn that carried `modelUsage` (i.e. nearly every turn), so in an active
   * chat the "5-minute" catalog cache was dropped almost every message and the
   * next `getModels()` paid the ~10 s CLI probe again. The catalog (aliases,
   * names, capabilities) does not change when a limit is observed; only the
   * derived numbers do, and those are applied as an overlay at read time by
   * `probeModels`, so the cache stays valid for its full TTL.
   */
  private recordObservedLimits(message: unknown): void {
    const modelUsage = (message as { modelUsage?: Record<string, unknown> }).modelUsage;
    if (!modelUsage) return;
    for (const [model, raw] of Object.entries(modelUsage)) {
      const u = (raw ?? {}) as { contextWindow?: number; maxOutputTokens?: number };
      if (typeof u.contextWindow !== 'number' && typeof u.maxOutputTokens !== 'number') continue;
      const prev = this.observedModelLimits.get(model) ?? {};
      this.observedModelLimits.set(model, {
        ...prev,
        ...(typeof u.contextWindow === 'number' ? { contextWindow: u.contextWindow } : {}),
        ...(typeof u.maxOutputTokens === 'number' ? { maxOutputTokens: u.maxOutputTokens } : {}),
      });
    }
  }

  /**
   * Overlay runtime-observed limits onto an alias row.
   *
   * Matching is by model id first, then by the canonical id the alias resolves
   * to (`sonnet` → `claude-sonnet-5`), since `modelUsage` is keyed by the wire
   * model while the catalog is keyed by the alias.
   */
  private applyObservedLimits(model: HarnessModel, resolvedModel?: string): HarnessModel {
    const seen =
      this.observedModelLimits.get(model.id) ??
      (resolvedModel ? this.observedModelLimits.get(resolvedModel) : undefined);
    if (!seen?.contextWindow) return model;
    const total = seen.contextWindow;
    const maxOut = seen.maxOutputTokens;
    const next: HarnessModel = {
      ...model,
      totalContextWindow: total,
      contextWindow: total,
      promptTokenLimit: Math.max(0, total - (maxOut ?? 0)),
    };
    if (maxOut != null) next.maxOutputTokens = maxOut;
    return next;
  }

  /**
   * Open a control-only `query()` session, run `fn` against it, and close it.
   *
   * The prompt is an async generator that never yields, so the session reaches
   * the control channel (where `supportedModels()` / `initializationResult()`
   * live) without ever sending a turn — no tokens are consumed.
   */
  private async withControlSession<T>(fn: (q: Query) => Promise<T>): Promise<T> {
    async function* neverYields(): AsyncGenerator<never, void> {
      // Park forever; the caller closes the handle when it's done.
      await new Promise<void>(() => { /* never settles */ });
    }
    const { query: claudeQuery } = await loadClaudeSdk(); // W41
    const q = claudeQuery({
      prompt: neverYields() as unknown as Parameters<typeof claudeQuery>[0]['prompt'],
      options: {
        permissionMode: 'bypassPermissions', // security-ok: control-only session, the prompt generator never yields so no tool can run
        ...this.baseQueryOptions(),
        ...(this.options.defaultCwd ? { cwd: this.options.defaultCwd } : {}),
      } as ClaudeOptions,
    });
    try {
      return await fn(q);
    } finally {
      try { q.close(); } catch { /* handle may already be closed */ }
    }
  }

  /**
   * W41 — why `getModels()` NEVER throws.
   *
   * A model catalog is a *description of what is available*, and "nothing" is a
   * valid answer to that question. Throwing made an un-configured or logged-out
   * provider fatal to whatever asked: `HarnessRegistry.refresh()` probes every
   * managed provider, so one broken CLI could take the whole catalog with it,
   * and boot must not fail because one provider is misconfigured.
   *
   * The reason is not swallowed — it is recorded on
   * {@link getLastModelProbeError} so the registry can still surface *why* a
   * provider has an empty catalog instead of just reporting it unusable.
   */
  private lastModelProbeError: string | undefined;

  /** W41 — why the last `getModels()` returned `[]`, if it did. */
  getLastModelProbeError(): string | undefined {
    return this.lastModelProbeError;
  }

  async getModels(): Promise<HarnessModel[]> {
    try {
      const models = await this.probeModels();
      this.lastModelProbeError = undefined;
      return models;
    } catch (err) {
      this.lastModelProbeError = (err as Error)?.message ?? String(err);
      if (this.verbose) {
        console.warn(`[ClaudeAgentAdapter] Model probe failed — returning empty catalog: ${this.lastModelProbeError}`);
      }
      return []; // W41 — failure mode is an empty catalog, never a throw.
    }
  }

  /** The real probe. May throw; only {@link getModels} calls it. */
  private async probeModels(): Promise<HarnessModel[]> {
    // The cache holds the CLI's catalog as probed; observed limits are laid
    // over it on every read so a fresh `result` corrects the numbers without
    // costing a re-probe (item 24).
    const overlay = (rows: Array<{ model: HarnessModel; resolvedModel?: string }>): HarnessModel[] =>
      rows.map((r) => this.applyObservedLimits(r.model, r.resolvedModel));

    const cached = this.modelCache;
    if (cached && Date.now() - cached.at < ClaudeAgentProvider.MODEL_CACHE_TTL_MS) {
      return overlay(cached.rows);
    }
    // Coalesce concurrent probes — several UI surfaces can ask at once and a
    // cold probe is slow enough that they would otherwise stack up.
    if (this.modelProbeInFlight) return this.modelProbeInFlight;

    this.modelProbeInFlight = this.withControlSession(async (q) => {
      const sdkModels = await q.supportedModels();
      return sdkModels.map((m) => ({
        model: mapClaudeModelInfo(m, this.options.defaultEffort ?? DEFAULT_EFFORT),
        resolvedModel: (m as unknown as { resolvedModel?: string }).resolvedModel,
      }));
    })
      .then((rows) => {
        this.modelCache = { rows, at: Date.now() };
        return overlay(rows);
      })
      .finally(() => {
        this.modelProbeInFlight = null;
      });

    return this.modelProbeInFlight;
  }

  /**
   * Account / auth state for this provider, straight from the CLI.
   *
   * `tokenSource: 'none'` means the CLI has no credentials — the provider is
   * installed but not usable, which is exactly what the UI needs to know in
   * order to lock it in the model picker.
   */
  async getAccountInfo(): Promise<ClaudeAccountInfo> {
    return this.withControlSession(async (q) => {
      const init = await q.initializationResult();
      return (init.account ?? {}) as ClaudeAccountInfo;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Conversation Lifecycle
  // ══════════════════════════════════════════════════════════════

  async createConversation(params: CreateConversationParams): Promise<string> {
    return withSpan('claude-agent-bridge', 'claude_agent.createConversation', async (span) => {
      span.setAttribute('claude_agent.conversation_id', params.conversationId);
      span.setAttribute('claude_agent.model', params.model ?? this.options.defaultModel ?? 'claude-sonnet-4-6');

      const warnings: ConversationWarning[] = [];
      const registeredAgents: HarnessAgentInfo[] = [];

      // Build MCP server for domain tools
      // W13 / X-1 — pass the process-wide tool semaphore so concurrent domain
      // tool executions are bounded to MAX_PARALLEL_TOOLS.
      let mcpConfig: Record<string, unknown> = {};
      let domainToolNames: string[] = [];
      if (params.tools && params.tools.length > 0) {
        // W41 — dynamic: tool-factory pulls in the SDK and zod.
        const { buildClaudeAgentMcpTools } = await import('./tool-factory.js');
        // W13-B1 — the conversationId is what lets the semaphore refuse to run
        // a tool for a turn already marked truncated. Without it the latch has
        // no key and every tool executes regardless of stop reason.
        const { mcpServerConfig, toolNames } = buildClaudeAgentMcpTools(
          params.tools,
          this.toolSemaphore,
          params.conversationId,
        );
        mcpConfig = { 'generatorai-tools': mcpServerConfig };
        domainToolNames = toolNames;
      }

      // Resolve system prompt
      let systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append?: string } | undefined;
      if (params.systemMessage) {
        if (params.systemMessage.mode === 'append') {
          systemPrompt = { type: 'preset', preset: 'claude_code', append: params.systemMessage.content };
        } else {
          systemPrompt = params.systemMessage.content;
        }
      } else if (params.systemPromptAppend) {
        systemPrompt = { type: 'preset', preset: 'claude_code', append: params.systemPromptAppend };
      }

      // Merge MCP servers from params
      const mergedMcpServers = {
        ...mcpConfig,
        ...(params.mcpServers ?? {}),
      };

      // Map allowed tools.
      //
      // `Options.tools` is the BUILT-IN base set; `Options.allowedTools` is the
      // auto-approve list. Custom/MCP tool names belong only in the latter —
      // putting them in `tools` names built-ins that do not exist.
      const hasNoToolRestriction =
        !params.availableTools ||
        params.availableTools.length === 0 ||
        params.availableTools.includes('*');
      const builtinAllowList = hasNoToolRestriction
        ? undefined
        : params.availableTools!.filter((t) => !t.startsWith('mcp__') && !t.includes('__'));
      const resolvedAllowedTools: string[] = [];
      if (!hasNoToolRestriction && params.availableTools) {
        resolvedAllowedTools.push(...params.availableTools);
      }
      // Add domain MCP tool names to allowed list
      resolvedAllowedTools.push(...domainToolNames);

      // Map custom agents onto the SDK's AgentDefinition shape.
      const agents: Record<string, unknown> = {};
      if (params.customAgents) {
        for (const agent of params.customAgents) {
          agents[agent.name] = {
            description: agent.description,
            prompt: agent.instructions,
            ...(agent.tools ? { tools: agent.tools } : {}),
            ...(agent.disallowedTools ? { disallowedTools: agent.disallowedTools } : {}),
            ...(agent.model ? { model: agent.model } : {}),
            ...(agent.reasoningEffort ? { effort: agent.reasoningEffort } : {}),
            ...(agent.skills ? { skills: agent.skills } : {}),
            ...(agent.mcpServers ? { mcpServers: [agent.mcpServers] } : {}),
            ...(agent.permissionMode ? { permissionMode: agent.permissionMode } : {}),
            ...(agent.maxTurns !== undefined ? { maxTurns: agent.maxTurns } : {}),
            ...(agent.background !== undefined ? { background: agent.background } : {}),
          };
          registeredAgents.push({
            name: agent.name,
            ...(agent.description ? { description: agent.description } : {}),
            ...(agent.model ? { model: agent.model } : {}),
            source: 'programmatic',
          });
        }
      }
      // Delegation runs through the built-in `Agent` tool; without it in the
      // allow-list every delegation falls through to canUseTool and is denied.
      if (Object.keys(agents).length > 0 && !resolvedAllowedTools.includes('Agent')) {
        resolvedAllowedTools.push('Agent');
      }
      // `Options.skills` auto-adds `Skill` to allowedTools, but an explicit
      // `tools` array must carry it too or the model cannot invoke skills.
      if (params.skills?.length) {
        if (!resolvedAllowedTools.includes('Skill')) resolvedAllowedTools.push('Skill');
        if (builtinAllowList && !builtinAllowList.includes('Skill')) builtinAllowList.push('Skill');
      }
      // No SDK option accepts skill DIRECTORIES (see `capabilities()`), so
      // say so rather than accepting the field and ignoring it.
      if (params.skillDirectories?.length) {
        warnings.push({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
          params: { field: 'skillDirectories', provider: 'claude-agent' },
        });
      }
      for (const field of ['contextTier', 'configDir', 'streaming'] as const) {
        if (params[field] !== undefined) {
          warnings.push({
            code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
            params: { field, provider: 'claude-agent' },
          });
        }
      }
      if (params.provider) {
        warnings.push({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
          params: { field: 'provider', provider: 'claude-agent' },
        });
      }

      // Store configuration for later use.
      //
      // Re-creating an EXISTING conversation is a legitimate rebind (the user
      // changed the model, or the conversation was resumed with fresh tool
      // handlers).
      //
      // `sdkSessionId` drives `options.resume`, and the CLI PINS THE MODEL to
      // whatever the resumed session was created with — passing a new model
      // alongside `resume` is silently ignored. So we only carry the session
      // over when the model is unchanged. When the model really changed we
      // deliberately drop it and start a fresh agent session on the new model;
      // the user-visible transcript lives in our own DB and is unaffected,
      // only the provider-side context restarts.
      //
      // When this adapter has NEVER seen the conversation, there is nothing to
      // carry over — but the caller may know the session id anyway (a runtime
      // recycle reads it off the outgoing adapter and passes it in
      // `resumeProviderSessionId`). Honouring it is the difference between the
      // chat continuing and the model silently restarting with no history.
      //
      // Item 16: a conversation this adapter EVICTED (idle sweep / LRU cap)
      // left its session id in `evictedSessionIds`, so a caller that simply
      // re-creates it gets its history back without knowing anything happened.
      const previous = this.conversations.get(params.conversationId);
      const nextModel = params.model ?? this.options.defaultModel;
      const modelChanged = !!previous && previous.model !== nextModel;
      const remembered = this.evictedSessionIds.get(params.conversationId);
      this.evictedSessionIds.delete(params.conversationId);
      const resumeSessionId = previous
        ? modelChanged
          ? undefined
          : previous.sdkSessionId
        : (params.resumeProviderSessionId ?? remembered);

      // Item 16 — bound the number of live conversations BEFORE admitting a
      // new one. Only idle conversations are candidates; if every one is
      // mid-turn the cap is exceeded rather than a turn killed.
      if (!previous) {
        while (this.conversations.size >= this.maxLiveConversations) {
          if (!this.evictLruConversation(params.conversationId)) break;
        }
      }
      const config: StoredConversationConfig = {
        conversationId: params.conversationId,
        model: nextModel,
        systemPrompt,
        workingDirectory: params.workingDirectory ?? this.options.defaultCwd,
        ...(params.additionalDirectories?.length
          ? { additionalDirectories: [...new Set(params.additionalDirectories)] }
          : {}),
        effort: (params.reasoningEffort as StoredConversationConfig['effort']) ?? this.options.defaultEffort,
        maxTurns: params.maxTurns ?? this.options.defaultMaxTurns,
        maxBudgetUsd: this.options.defaultMaxBudgetUsd,
        permissionMode: params.permissionMode ?? this.options.defaultPermissionMode ?? 'bypassPermissions',
        tools: builtinAllowList,
        allowedTools: resolvedAllowedTools.length > 0 ? resolvedAllowedTools : undefined,
        // `disallowedTools` takes BUILT-IN tool names too (that is how Claude
        // Code itself disables e.g. `Agent`), so `excludedBuiltinTools` maps
        // here rather than being warn-and-dropped — orchestrator chats rely
        // on it to remove the SDK's in-process Agent/Task delegation tools.
        disallowedTools: (() => {
          const merged = [
            ...(params.excludedTools ?? []),
            ...(params.excludedBuiltinTools ?? []),
          ];
          return merged.length > 0 ? [...new Set(merged)] : undefined;
        })(),
        mcpServers: Object.keys(mergedMcpServers).length > 0 ? mergedMcpServers : undefined,
        agents: Object.keys(agents).length > 0 ? agents : undefined,
        ...(params.skills?.length ? { skills: params.skills } : {}),
        ...(params.plugins?.length ? { plugins: params.plugins } : {}),
        ...(params.defaultAgent && params.agentProjection === 'native' && agents[params.defaultAgent]
          ? { agent: params.defaultAgent }
          : {}),
        ...(params.hooks ? { hooks: params.hooks } : {}),
        env: this.options.env,
        // Per-conversation env from the core (workspace root / scratch dir).
        // Filtered to `GENERATORAI_*` here, at the boundary, so nothing else
        // the caller happened to put in the map can reach a process that runs
        // model-authored shell commands.
        delegatedEnv: filterDelegatedHarnessEnv(params.env),
        // HITL-06 (Claude parity) — persist the domain permission callback
        // so `buildQueryOptions` can wire it into the SDK's `canUseTool`.
        onPermissionRequest: params.onPermissionRequest,
        // PLN-01 — plan-mode gates, demultiplexed out of `canUseTool`.
        onPlanReviewRequest: params.onPlanReviewRequest,
        onQuestionRequest: params.onQuestionRequest,
        planModeInstructions: params.planModeInstructions,
        ...(resumeSessionId ? { sdkSessionId: resumeSessionId } : {}),
        lastUsedAt: Date.now(),
      };

      this.conversations.set(params.conversationId, config);
      this.conversationWarnings.set(params.conversationId, warnings);
      this.conversationAgents.set(params.conversationId, registeredAgents);
      // Preserve the transcript across a rebind; only seed an empty one for a
      // genuinely new conversation.
      if (!this.conversationMessages.has(params.conversationId)) {
        this.conversationMessages.set(params.conversationId, []);
      }
      if (!previous) activeSessions.add(1);
      this.startSweeper();

      if (this.verbose) {
        const what = !previous ? 'Created' : modelChanged ? 'Rebound (new session, model changed)' : 'Rebound';
        console.log(`[ClaudeAgentAdapter] ${what} conversation ${params.conversationId} with model=${config.model ?? 'default'}, cwd=${config.workingDirectory ?? '(not set)'}`);
      }

      return params.conversationId;
    });
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    // A conversation that's already in memory normally needs no work — but the
    // model is baked into its stored config, so a resume that asks for a
    // DIFFERENT model must fall through and rebuild it. Without this the user
    // changes the model in the composer and every later turn silently keeps
    // running the original one.
    const existing = this.conversations.get(conversationId);
    if (existing) {
      const requestedModel = params?.model ?? this.options.defaultModel;
      if (!params || requestedModel === existing.model) {
        if (this.verbose) console.log(`[ClaudeAgentAdapter] Conversation ${conversationId} already in memory, skipping resume`);
        return;
      }
      if (this.verbose) {
        console.log(`[ClaudeAgentAdapter] Conversation ${conversationId} model ${existing.model ?? '(default)'} → ${requestedModel ?? '(default)'}; rebinding`);
      }
    }

    // Clean up lingering listeners
    const cleanups = this.conversationListenerCleanups.get(conversationId);
    if (cleanups) {
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
    }

    // Re-create the conversation config on resume. CRITICAL: carry over the
    // caller-supplied tools + settings so the runtime tool HANDLERS (browser /
    // widget / custom) are re-registered. Without them a resumed conversation
    // has no tools, and the agent reports the tools as removed/unavailable and
    // refuses tool-using tasks for the rest of the chat. Falls back to a
    // minimal config only when the caller can't supply params.
    if (params) {
      await this.createConversation({ ...params, conversationId });
      if (this.verbose) console.log(`[ClaudeAgentAdapter] Resumed conversation ${conversationId} with ${(params.tools ?? []).length} tool(s)`);
      return;
    }

    // Create a minimal config for resumed sessions (no tools available).
    const remembered = this.evictedSessionIds.get(conversationId);
    this.evictedSessionIds.delete(conversationId);
    this.conversations.set(conversationId, {
      conversationId,
      model: this.options.defaultModel,
      workingDirectory: this.options.defaultCwd,
      permissionMode: this.options.defaultPermissionMode ?? 'bypassPermissions',
      sdkSessionId: remembered ?? conversationId,
      lastUsedAt: Date.now(),
    });
    this.startSweeper();

    if (this.verbose) console.log(`[ClaudeAgentAdapter] Resumed conversation ${conversationId} (minimal, no tools)`);
  }

  /** Whether the conversation is live in memory (tool handlers registered). */
  hasLiveConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId);
  }

  runtimeDiagnostics(): HarnessRuntimeDiagnostics {
    const slots = this.supervisor?.snapshot?.();
    return {
      liveConversations: this.conversations.size,
      liveSessions: this.sessions.size,
      warmSessions: this.warmSessions.size,
      maxLiveSessions: this.maxLiveConversations,
      // Turns in flight vs. the concurrency cap, and how many are queued
      // behind it. A queue that never drains while nothing runs is a leaked
      // permit — the number that explains "every prompt hangs".
      ...(slots
        ? {
            turnsInFlight: slots.activeExecutions,
            maxConcurrentTurns: slots.maxConcurrentExecutions,
            turnsQueued: slots.executionQueueDepth,
          }
        : {}),
    };
  }

  /**
   * W12 — the SDK session id backing this conversation, i.e. the value the CLI
   * needs in `options.resume` to continue it with its history.
   *
   * Undefined until the first turn has run (the SDK mints it and we capture it
   * from the init message), and undefined for a conversation this adapter does
   * not hold. A caller moving the conversation to another adapter instance
   * passes it back as `CreateConversationParams.resumeProviderSessionId`.
   */
  getProviderSessionId(conversationId: string): string | undefined {
    return this.conversations.get(conversationId)?.sdkSessionId;
  }

  /** The SDK session id backing `conversationId`, from memory or the caller's record. */
  private sourceSessionIdFor(conversationId: string, fallback: string | undefined): string | undefined {
    return (
      this.conversations.get(conversationId)?.sdkSessionId ??
      this.evictedSessionIds.get(conversationId) ??
      fallback
    );
  }

  /**
   * Branch the SDK transcript. `forkSession` copies the session file up to
   * `upToMessageId` (inclusive) under a fresh id, remapping message uuids and
   * keeping the parent chain, so the new session resumes with exactly the
   * history the caller asked for and the source is untouched.
   *
   * Note: like `deleteSession` above, the standalone SDK function reads
   * `CLAUDE_CONFIG_DIR` from THIS process, not the per-instance `homeDir`
   * handed to the CLI child. Isolated homes are opt-in and rare; when they are
   * on, the fork falls back to a resume-and-fork through the CLI.
   */
  async forkConversation(
    conversationId: string,
    options: ForkConversationOptions,
  ): Promise<ForkConversationResult> {
    const source = this.sourceSessionIdFor(conversationId, options.sourceProviderSessionId);
    if (!source) {
      throw new HarnessSessionError(`Conversation ${conversationId} has no SDK session to fork`);
    }
    const anchor = options.throughAnchor;
    if (anchor && anchor.kind !== 'message') {
      throw new HarnessSessionError(`Claude forks by message uuid; got a ${anchor.kind} anchor`);
    }
    const { sessionId: forkedId, anchorMap } = await this.forkSdkSession(source, anchor?.id);
    await this.createConversation({
      ...options.params,
      conversationId: options.newConversationId,
      resumeProviderSessionId: forkedId,
    });
    return { providerSessionId: forkedId, ...(anchorMap ? { anchorMap } : {}) };
  }

  /**
   * Rewind = fork the transcript through `keepThrough` and re-point the
   * conversation at the branch. The live CLI process (if any) holds the old
   * history in memory, so it is closed; the next prompt resumes the branch.
   */
  async rewindConversation(
    conversationId: string,
    options: RewindConversationOptions,
  ): Promise<ForkConversationResult> {
    if (this.activeQueries.has(conversationId)) {
      throw new HarnessSessionError(`Conversation ${conversationId} has a turn in flight`);
    }
    const live = this.sessions.get(conversationId);
    if (live) await this.closeSession(live, 'conversation rewound');
    this.discardWarmSession(conversationId, 'conversation rewound');
    this.evictedSessionIds.delete(conversationId);

    const config = this.conversations.get(conversationId);
    if (!options.keepThrough) {
      // Nothing survives: forget the session id so the next prompt starts cold.
      if (config) delete config.sdkSessionId;
      return {};
    }
    if (options.keepThrough.kind !== 'message') {
      throw new HarnessSessionError(`Claude rewinds by message uuid; got a ${options.keepThrough.kind} anchor`);
    }
    const source = this.sourceSessionIdFor(conversationId, options.providerSessionId);
    if (!source) {
      throw new HarnessSessionError(`Conversation ${conversationId} has no SDK session to rewind`);
    }
    const { sessionId: forkedId, anchorMap } = await this.forkSdkSession(source, options.keepThrough.id);
    if (config) {
      config.sdkSessionId = forkedId;
    } else {
      // Not in memory: the caller resumes with the returned id.
      this.evictedSessionIds.set(conversationId, forkedId);
    }
    return { providerSessionId: forkedId, ...(anchorMap ? { anchorMap } : {}) };
  }

  /**
   * `forkSession` copies the transcript through `upToMessageId` under FRESH
   * uuids (parent chain preserved, order preserved). The anchors the chat
   * service persisted name the OLD uuids, so the two transcripts are aligned
   * by position and an old→new map handed back; a fork whose messages cannot
   * be read still succeeds, just without the map.
   */
  private async forkSdkSession(
    sourceSessionId: string,
    upToMessageId: string | undefined,
  ): Promise<{ sessionId: string; anchorMap?: Record<string, string> }> {
    const sdk = await loadClaudeSdk(); // W41
    const result = await sdk.forkSession(sourceSessionId, {
      ...(upToMessageId ? { upToMessageId } : {}),
    });
    if (!result?.sessionId) {
      throw new HarnessSessionError(`forkSession(${sourceSessionId}) returned no session id`);
    }
    let anchorMap: Record<string, string> | undefined;
    try {
      const [before, after] = await Promise.all([
        sdk.getSessionMessages(sourceSessionId, {}),
        sdk.getSessionMessages(result.sessionId, {}),
      ]);
      const oldAssistants = before.filter((m) => m.type === 'assistant');
      const newAssistants = after.filter((m) => m.type === 'assistant');
      anchorMap = {};
      for (let i = 0; i < newAssistants.length && i < oldAssistants.length; i += 1) {
        const o = oldAssistants[i]!.uuid;
        const n = newAssistants[i]!.uuid;
        if (o && n && o !== n) anchorMap[o] = n;
      }
      if (Object.keys(anchorMap).length === 0) anchorMap = undefined;
    } catch (err) {
      if (this.verbose) {
        console.warn(`[ClaudeAgentAdapter] could not align anchors after fork: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { sessionId: result.sessionId, ...(anchorMap ? { anchorMap } : {}) };
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversationWarnings.get(conversationId) ?? [];
  }

  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    const config = this.conversations.get(conversationId);
    if (!config) throw new HarnessSessionError(`Conversation ${conversationId} not found`);
    if (!config.agents || !(agentName in config.agents)) {
      const existing = this.conversationWarnings.get(conversationId) ?? [];
      existing.push({ code: 'AGENT_NOT_REGISTERED', params: { agent: agentName } });
      this.conversationWarnings.set(conversationId, existing);
      return;
    }
    // The main-thread agent is resolved once at query start, so this takes
    // effect on the NEXT turn rather than mid-turn.
    config.agent = agentName;
  }

  async listAgents(conversationId: string): Promise<HarnessAgentInfo[]> {
    return this.conversationAgents.get(conversationId) ?? [];
  }

  async listConversations(): Promise<string[]> {
    // Return locally tracked conversations
    return Array.from(this.conversations.keys());
  }

  async getLastConversationId(): Promise<string | null> {
    const keys = Array.from(this.conversations.keys());
    return keys.length > 0 ? keys[keys.length - 1]! : null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.cleanupConversation(conversationId);
    // Also try to delete the SDK session
    try {
      const { deleteSession } = await loadClaudeSdk(); // W41
      await deleteSession(conversationId, {});
    } catch {
      // Session may not exist on disk — that's fine
    }
  }

  async destroyConversation(conversationId: string): Promise<void> {
    this.cleanupConversation(conversationId);
  }

  // ══════════════════════════════════════════════════════════════
  // Messaging
  // ══════════════════════════════════════════════════════════════

  /**
   * The chat path. Resolves once the turn has been HANDED to the runtime (not
   * when it completes) — events arrive through `onConversationEvent`.
   *
   * Persistent mode (default): the user message is pushed into the
   * conversation's long-lived session, reopened (with `resume`) only when a
   * construction-time option changed. One-shot mode: a fresh `query()` per
   * call, as before.
   */
  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    turnOptions?: SendPromptOptions,
  ): Promise<void> {
    const start = Date.now();
    // One turn at a time per conversation. A persistent session would
    // happily queue a second user message behind the first, but the turn
    // bookkeeping (permit, plan phase, transcript accumulation) is per
    // conversation, so a second turn waits for the first to settle.
    const inFlight = this.turns.get(conversationId);
    if (inFlight) await inFlight.done;

    // The `chat` span covers the whole turn (ECON-R10): it ends when the turn
    // settles, while this method still resolves as soon as the turn is handed off.
    return new Promise<void>((handedOff, failed) => {
      void this.genai.chat(conversationId, this.conversations.get(conversationId)?.model ?? this.options.defaultModel, prompt, async () => {
        let turn: TurnState | undefined;
        try {
          turn = await this.startPromptTurn(conversationId, prompt, start, attachments, turnOptions);
        } catch (err) {
          failed(err);
          throw err;
        }
        handedOff();
        if (!turn) return;
        await turn.done;
        if (turn.activeQuery.status === 'failed') throw new Error('turn failed');
      }).catch(() => {
        // The span recorded the failure; the caller already has the hand-off outcome.
      });
    });
  }

  /**
   * Start one `sendPrompt` turn and return its bookkeeping once it is handed to
   * the runtime; `undefined` when a stop withdrew it while it waited for its
   * execution permit.
   */
  private async startPromptTurn(
    conversationId: string,
    prompt: string,
    start: number,
    attachments?: AttachmentRef[],
    turnOptions?: SendPromptOptions,
  ): Promise<TurnState | undefined> {
    promptCounter.add(1, { conversation_id: conversationId });

    const config = this.getConversationConfig(conversationId);
    config.lastUsedAt = Date.now();

    await this.emitToHandlers(conversationId, 'harness.user_message', { content: prompt });
    this.pushMessage(conversationId, { role: 'user', content: prompt, timestamp: new Date() });

    const persistent = this.persistentSessions;
    const options = this.buildQueryOptions(config, turnOptions, { persistent });

    // PLN-01 — arm the plan phase for this turn.
    this.beginPlanTurn(conversationId, turnOptions);

    // Item 4 — the chat path holds an execution permit for the whole turn,
    // exactly like `sendPromptAndWait` always did. Acquired BEFORE anything
    // is spawned or pushed, and announced to the user if it has to wait.
    // Withdrawn by a stop while queued: `abortConversation` already emitted
    // `harness.cancelled` + `harness.idle`, so the turn just never starts.
    const releaseExecution = await this.acquireTurnPermit(conversationId, turnOptions?.admitted === true);
    if (!releaseExecution) {
      this.planPhases.delete(conversationId);
      return undefined;
    }

    // W13-B1 — a turn starts un-truncated. Without this the latch set by a
    // previous truncated turn would persist and refuse every tool for the
    // rest of the conversation.
    this.toolSemaphore.beginTurn(conversationId);
    // Likewise for the context breakdown: last turn's describes a window
    // that no longer exists, and publishing it against this turn's token
    // total would report a split that does not add up.
    this.resetContextUsageProbe(conversationId);

    const activeQuery: ActiveQuery = {
      queryId: crypto.randomUUID(),
      conversationId,
      abortController: new AbortController(),
      status: 'running',
    };
    this.activeQueries.set(conversationId, activeQuery);
    const turn = this.beginTurn(conversationId, activeQuery, start, releaseExecution, prompt);

    if (!persistent) {
      // One-shot fallback: a string prompt cannot carry content blocks, so
      // attachments are referenced by path (the model has file tools).
      const oneShotPrompt = this.describeAttachmentsInline(prompt, attachments);
      this.runQueryInBackground(conversationId, oneShotPrompt, options, turn).catch((err) => {
        if (this.verbose) console.error(`[ClaudeAgentAdapter] Background query error for ${conversationId}:`, err);
      });
      return turn;
    }

    try {
      const session = await this.ensureSession(conversationId, config, options);
      turn.session = session;
      // `closeHandle` is what stop()/cleanup reach for to kill the process.
      activeQuery.closeHandle = () => {
        void this.closeSession(session, 'turn handle closed');
      };
      session.input.push(await this.buildUserMessage(prompt, attachments, session.sdkSessionId));
    } catch (err) {
      await this.failTurn(turn, err);
    }
    return turn;
  }

  /**
   * The workflow-stage path. Deliberately one-shot regardless of
   * `persistentSessions`: a stage is a single-message conversation in a
   * per-run directory, so a persistent process would gain nothing and leave
   * an idle CLI behind (APPLICATION-REVIEW-2026-09, item 17 open question 2).
   */
  async sendPromptAndWait(
    conversationId: string,
    rawPrompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    turnOptions?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const start = Date.now();
    return this.genai.chat(conversationId, this.conversations.get(conversationId)?.model ?? this.options.defaultModel, rawPrompt, async (span) => {
      promptCounter.add(1, { conversation_id: conversationId });

      const config = this.getConversationConfig(conversationId);
      config.lastUsedAt = Date.now();
      const prompt = this.describeAttachmentsInline(rawPrompt, attachments);

      // Emit user_message event
      await this.emitToHandlers(conversationId, 'harness.user_message', { content: rawPrompt });

      // Store user message
      this.pushMessage(conversationId, { role: 'user', content: rawPrompt, timestamp: new Date() });

      // Build query options
      const options = this.buildQueryOptions(config, turnOptions);

      // PLN-01 — arm the plan phase for this turn.
      this.beginPlanTurn(conversationId, turnOptions);

      // Set up abort controller
      const abortController = new AbortController();
      options.abortController = abortController;

      // Wire external signal
      let abortHandler: (() => void) | undefined;
      if (signal) {
        if (signal.aborted) {
          throw new Error('sendPromptAndWait aborted before start');
        }
        // W13 / X-4 — route an externally-signalled abort through the SAME
        // canonical stop path as `abortConversation()`. Aborting the controller
        // directly (what this used to do) tore the turn down without ever
        // emitting `harness.cancelled`, so a caller that stops a turn via its
        // own AbortSignal — every workflow stage and every automation — got a
        // bare rejection and the UI never rendered the neutral "Stopped" badge.
        // The two cancellation origins must be observationally identical; see
        // `runCancellationConformance`, which now asserts exactly that.
        abortHandler = () => {
          void this.abortConversation(conversationId);
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      // Timeout guard — HITL-07 (Claude parity): rolling-window watchdog
      // that pauses while a permission request is in-flight, so a slow
      // human approver can't spuriously abort the stage. Matches
      // CopilotProvider's implementation.
      //
      // Long-agent fix: idle-timeout, not wall-clock. `lastActivityMs`
      // (bumped every iteration of the message loop below) records the
      // most recent SDK message. The watchdog fires only if no message
      // has arrived for `deadline` ms. Streams that keep producing —
      // even for hours — never trip this.
      let lastActivityMs = Date.now();
      let timeoutHandle: ReturnType<typeof setInterval> | undefined;
      if (this.options.defaultTimeoutMs && this.options.defaultTimeoutMs > 0) {
        const deadline = this.options.defaultTimeoutMs;
        const tickMs = Math.min(5_000, Math.max(500, Math.floor(deadline / 20)));
        timeoutHandle = setInterval(() => {
          if ((this.permissionPending.get(conversationId) ?? 0) > 0) {
            lastActivityMs = Date.now();
            return;
          }
          if (Date.now() - lastActivityMs >= deadline) {
            if (timeoutHandle) clearInterval(timeoutHandle);
            timeoutHandle = undefined;
            abortController.abort();
          }
        }, tickMs);
      }

      // W13-B1 — a turn starts un-truncated. Without this the latch set by a
      // previous truncated turn would persist and refuse every tool for the
      // rest of the conversation.
      this.toolSemaphore.beginTurn(conversationId);
      // Likewise for the context breakdown: last turn's describes a window
      // that no longer exists, and publishing it against this turn's token
      // total would report a split that does not add up.
      this.resetContextUsageProbe(conversationId);

      const activeQuery: ActiveQuery = {
        queryId: crypto.randomUUID(),
        conversationId,
        abortController,
        status: 'running',
      };
      this.activeQueries.set(conversationId, activeQuery);

      // W12 / P0-14 — acquire one execution slot from the supervisor before
      // spawning the query() process: the `provider:claude-agent` flow key
      // (default 4, P07 WP-7.2). When it is full the turn queues here —
      // visibly, via `harness.warning`/`execution_queued`. A workflow stage
      // admitted for its whole attempt already holds it (`admitted`). A stop
      // while queued withdraws the wait (ECON-R6): nothing is spawned.
      const releaseExecution = await this.acquireTurnPermit(conversationId, turnOptions?.admitted === true);
      if (!releaseExecution) {
        activeQuery.status = 'aborted';
        if (this.activeQueries.get(conversationId) === activeQuery) this.activeQueries.delete(conversationId);
        this.planPhases.delete(conversationId);
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        if (timeoutHandle) clearInterval(timeoutHandle);
        throw new Error('sendPromptAndWait aborted by caller');
      }

      try {
        if (this.verbose) console.log(`[ClaudeAgentAdapter] Sending prompt to ${conversationId} (${prompt.length} chars)`);

        const { query: claudeQuery } = await loadClaudeSdk(); // W41
        const queryHandle = claudeQuery({ prompt, options });
        activeQuery.closeHandle = () => queryHandle.close();

        let fullContent = '';
        const toolCalls: { tool: string; args: unknown; result: unknown }[] = [];
        let sessionId: string | undefined;
        // W13-B1: track truncation so we can fail all in-flight tool calls.
        let truncationStopReason: string | undefined;
        let structuredOutput: unknown;
        let structuredOutputFailure: Error | undefined;

        for await (const message of queryHandle) {
          // Idle-watchdog: every SDK message resets the inactivity clock,
          // so an actively-streaming agent won't be killed no matter how
          // long the total run takes.
          lastActivityMs = Date.now();
          // Map to domain events and emit to handlers. AWAITED (item 19): a
          // slow consumer pauses this loop, and the SDK's reader behind it.
          const events = mapClaudeAgentMessageToAgentEvents(message);
          for (const event of events) {
            if (message.type === 'result' && isTerminalEvent(event)) {
              // Ahead of the terminal event — see `applyMessageToTurn`.
              this.recordObservedLimits(message);
              await this.emitContextUsageSnapshot(conversationId, message);
            }
            await this.emitEventToHandlers(conversationId, event);
          }

          // Accumulate content
          if (message.type === 'assistant') {
            // Sample the authoritative context breakdown while the query is
            // still open — see `beginContextUsageProbe` for why this cannot
            // wait for `result` and must not be awaited.
            this.beginContextUsageProbe(conversationId, queryHandle);
            const betaMsg = message.message;
            if (betaMsg?.content) {
              for (const block of betaMsg.content) {
                if (block.type === 'text') {
                  fullContent += block.text;
                } else if (block.type === 'tool_use') {
                  toolCalls.push({
                    tool: block.name,
                    args: block.input,
                    result: undefined,
                  });
                }
              }
            }
            // W13-B1: Check for truncation on the BetaMessage itself.
            // A stop_reason of 'max_tokens' or 'length' means the model ran
            // out of output budget mid-response — tool arguments may be
            // incomplete. Executing them risks data loss (X-2).
            /* W13-B1 */ if (betaMsg?.stop_reason) {
              const reason = String(betaMsg.stop_reason);
              if (isTruncationStopReason(reason)) {
                truncationStopReason = reason;
                // W13-B1 — latch the turn so the semaphore refuses any tool
                // still queued behind this message. Recording the reason
                // locally only affects the events we emit; it does not stop a
                // tool whose arguments were cut mid-JSON from running.
                this.toolSemaphore.markTruncated(conversationId, reason);
              }
            }
          } else if (message.type === 'result') {
            sessionId = message.session_id;
            if (message.subtype === 'success') {
              // Use the result field as final content if we didn't get explicit text
              if (!fullContent && message.result) {
                fullContent = message.result;
              }
              if (turnOptions?.outputSchema && message.structured_output !== undefined) {
                structuredOutput = message.structured_output;
              }
            } else if (message.subtype === 'error_max_structured_output_retries' && turnOptions?.outputSchema) {
              // RV-9 — the model could not satisfy the schema: repairable, not a crash.
              structuredOutputFailure = toHarnessError('claude-agent', message);
            }
          }
        }
        if (structuredOutputFailure) throw structuredOutputFailure;

        // W13-B1: If the response was truncated and contains tool calls, fail
        // ALL of them rather than executing potentially-incomplete arguments.
        // This prevents "a truncated path handed to a delete tool" (X-2).
        /* W13-B1 */ if (truncationStopReason && toolCalls.length > 0) {
          const truncMsg =
            `Response was truncated (stop_reason: ${truncationStopReason}). ` +
            `All ${toolCalls.length} tool call(s) in this batch are cancelled — ` +
            `please re-issue your request with a shorter response or fewer tools.`;
          if (this.verbose) {
            console.warn(`[ClaudeAgentAdapter] Truncation detected for ${conversationId}: ${truncMsg}`);
          }
          for (const tc of toolCalls) {
            // Use harness.tool_complete with success:false — there is no
            // harness.tool_error kind; tool failures are signalled via complete+false.
            /* W13-B1 */ await this.emitToHandlers(conversationId, 'harness.tool_complete', {
              tool: tc.tool,
              result: { error: truncMsg, truncated: true },
              success: false,
            });
          }
          // Clear tool calls so the caller's ConversationResponse has none
          toolCalls.length = 0;
        }

        activeQuery.status = 'completed';
        this.querySuccessCount++;

        // Store the SDK session ID for resume
        if (sessionId && config) {
          config.sdkSessionId = sessionId;
        }

        // Store assistant message
        this.pushMessage(conversationId, { role: 'assistant', content: fullContent, timestamp: new Date() });

        span.setAttribute('claude_agent.result.length', fullContent.length);
        promptDuration.record(Date.now() - start, { conversation_id: conversationId });

        if (this.verbose) console.log(`[ClaudeAgentAdapter] Prompt completed for ${conversationId} (${fullContent.length} chars)`);

        return {
          content: fullContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          ...(structuredOutput !== undefined ? { structuredOutput } : {}),
        };
      } catch (err) {
        activeQuery.status = 'failed';
        this.queryFailCount++;

        if (abortController.signal.aborted) {
          // W13 / X-4 fix (Finding-3 from Phase-2 review):
          // abortConversation() already emits harness.cancelled + harness.idle.
          // Emitting harness.error HERE would race those two, producing a red
          // error toast immediately after the neutral "Stopped" badge — the
          // exact UX regression W13 was meant to prevent. Do NOT emit any event;
          // just throw so the caller's promise rejects cleanly.
          throw new Error('sendPromptAndWait aborted by caller');
        }
        throw err;
      } finally {
        this.activeQueries.delete(conversationId);
        config.lastUsedAt = Date.now();
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        if (timeoutHandle) clearInterval(timeoutHandle);
        // W12 / P0-14 — release the execution slot so the next queued turn can start.
        releaseExecution();
      }
    });
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    // Return locally accumulated messages
    return this.conversationMessages.get(conversationId) ?? [];
  }

  /**
   * Stop the turn in flight.
   *
   * One-shot turns: the process IS the turn, so the handle is closed.
   *
   * Persistent sessions run the W13 ladder from `semanticCancel.ts` —
   * settle → local interrupt → `query.interrupt()` in the background → grace
   * budget → escalate. The escalation is where this adapter knowingly departs
   * from that module's no-kill rule: the runtime here is one CLI process
   * serving exactly one conversation, not a shared pool, so closing it after
   * an unacknowledged interrupt takes nobody else down. The next turn simply
   * reopens the session with `resume`.
   *
   * The user-visible outcome (`harness.cancelled` + `harness.idle`) is emitted
   * at the local-interrupt step, immediately; whatever the runtime sends after
   * that for the aborted turn is discarded, and its eventual `result` is the
   * acknowledgement that keeps the session alive.
   */
  async abortConversation(conversationId: string): Promise<void> {
    // A turn still queued for its execution permit is withdrawn: it never
    // starts, and the stop is reported exactly like a running turn's.
    const queued = this.queuedTurns.get(conversationId);
    if (queued && queued.size > 0) {
      this.queuedTurns.delete(conversationId);
      for (const withdraw of queued) withdraw.abort();
      if (!this.turns.has(conversationId)) {
        // `sendPromptAndWait` registers its query before it queues.
        const aq = this.activeQueries.get(conversationId);
        if (aq) {
          aq.abortController.abort();
          aq.status = 'aborted';
        }
        await this.emitToHandlers(conversationId, 'harness.cancelled', {
          reason: 'user_abort',
          provider: 'claude-agent',
        });
        await this.emitEventToHandlers(conversationId, createAgentEvent('harness.idle', {} as Record<string, never>));
        return;
      }
    }

    const turn = this.turns.get(conversationId);
    const aq = turn?.activeQuery ?? this.activeQueries.get(conversationId);
    if (!aq) return;
    const session = this.sessions.get(conversationId);

    const stopLocally = async (): Promise<void> => {
      if (turn) turn.aborted = true;
      aq.abortController.abort();
      aq.status = 'aborted';
      this.activeQueries.delete(conversationId);
      // One-shot: closing the handle ends the process, which ends the turn.
      // Persistent: the process must survive — the interrupt below ends the turn.
      if (!session) aq.closeHandle?.();

      // W13 / X-4 — emit a semantic 'cancelled' outcome, NOT an error.
      //
      // A user pressing Stop is NOT an error. The old 'harness.error' event
      // caused a red error toast in the UI. 'harness.cancelled' is a
      // success-valued terminal event: downstream state machines treat it as
      // a clean stop (pending approvals settle, the run records 'cancelled'
      // rather than 'failed', and the UI renders a neutral "Stopped" badge).
      await this.emitToHandlers(conversationId, 'harness.cancelled', {
        reason: 'user_abort',
        provider: 'claude-agent',
      });
      await this.emitEventToHandlers(conversationId, createAgentEvent('harness.idle', {} as Record<string, never>));
    };

    if (!session || !turn) {
      await stopLocally();
      return;
    }

    const inFlight = new CancellationInFlight();
    turn.cancellation = inFlight;
    let localStop: Promise<void> = Promise.resolve();
    void cancelSemantically(
      {
        // Permission prompts parked in `canUseTool` are settled by the CLI
        // itself when the turn is interrupted; report how many were open.
        settlePending: () => this.permissionPending.get(conversationId) ?? 0,
        interrupt: () => {
          localStop = stopLocally();
        },
        protocolCancel: () => session.query.interrupt().then(() => undefined),
        // The grace budget expired without a `result` for the aborted turn:
        // the CLI is wedged. Close it — see the method doc for why a close is
        // legitimate here and not for the shared runtimes semanticCancel.ts
        // was written for. The reader loop settles the turn as 'aborted'.
        synthesiseTerminal: () => {
          void this.closeSession(session, 'interrupt not acknowledged within grace budget');
        },
      },
      inFlight,
      { graceMs: this.options.cancelGraceMs },
    ).then((outcome) => {
      if (this.verbose) {
        console.log(
          `[ClaudeAgentAdapter] Stop for ${conversationId}: terminal=${outcome.terminal} after ${outcome.graceElapsedMs}ms`,
        );
      }
    });
    await localStop;
  }

  // ══════════════════════════════════════════════════════════════
  // Event Subscription
  // ══════════════════════════════════════════════════════════════

  onConversationEvent(
    conversationId: string,
    handler: (event: AgentEvent) => void | Promise<void>,
  ): () => void {
    // Must have the conversation (or at least be tracking it)
    let handlers = this.conversationEventHandlers.get(conversationId);
    if (!handlers) {
      handlers = new Set();
      this.conversationEventHandlers.set(conversationId, handlers);
    }
    handlers.add(handler);

    // Track cleanup
    let cleanups = this.conversationListenerCleanups.get(conversationId);
    if (!cleanups) {
      cleanups = new Set();
      this.conversationListenerCleanups.set(conversationId, cleanups);
    }
    const wrappedUnsub = () => {
      handlers!.delete(handler);
      cleanups!.delete(wrappedUnsub);
      listenerHighWaterMark.add(-1, { conversation_id: conversationId });
    };
    cleanups.add(wrappedUnsub);

    // ORC-05 — leak watchdog
    const activeCount = cleanups.size;
    listenerHighWaterMark.add(1, { conversation_id: conversationId });
    if (activeCount > LISTENER_LEAK_THRESHOLD && !this.conversationLeakWarned.has(conversationId)) {
      this.conversationLeakWarned.add(conversationId);
      listenerLeakWarnings.add(1, { conversation_id: conversationId });
      console.warn(
        `[ClaudeAgentAdapter] Listener leak suspected for conversation ${conversationId}: ` +
        `${activeCount} listeners attached (threshold=${LISTENER_LEAK_THRESHOLD}).`,
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

  // ══════════════════════════════════════════════════════════════
  // Private Helpers
  // ══════════════════════════════════════════════════════════════

  private getConversationConfig(id: string): StoredConversationConfig {
    const config = this.conversations.get(id);
    if (!config) throw new HarnessSessionError(`No active conversation: ${id}`);
    return config;
  }

  /**
   * PLN-01 — arms (or clears) the per-turn plan phase.
   *
   * A plan turn starts in the `planning` phase with an empty text accumulator.
   * A non-plan turn clears any stale phase so an approved plan from a previous
   * turn can never silently auto-approve writes on the next one.
   */
  private beginPlanTurn(conversationId: string, turnOptions?: SendPromptOptions): void {
    const isPlanTurn =
      turnOptions?.agentMode === 'plan' || turnOptions?.permissionMode === 'plan';
    if (isPlanTurn) {
      this.planPhases.set(conversationId, {
        phase: 'planning',
        postApprovalPolicy: 'acceptEdits',
        planText: '',
      });
    } else {
      this.planPhases.delete(conversationId);
    }
  }

  // ── W35 — the always-installed PreToolUse gate ───────────────────────────

  /**
   * Build the `PreToolUse` callback the SDK invokes before every tool call.
   *
   * `gate` is the policy. Both call sites funnel through here so the
   * fail-closed semantics exist in exactly one place:
   *
   *   • ERROR   → deny. A gate that opens on an exception is no gate (L16).
   *   • TIMEOUT → deny, after {@link PRE_TOOL_USE_GATE_TIMEOUT_MS}. A hung
   *     approver must not wedge the agent, and must not be allowed to buy the
   *     model a free tool call by hanging.
   *   • NO POLICY (`gate === undefined`) → DEFER.
   *
   * ── Why the no-policy default is DEFER and not deny or allow ──
   *
   * The hook is installed unconditionally so that a boundary never depends on
   * a caller remembering to opt in. But "installed" and "opinionated" are
   * different things, and with no policy supplied there is no opinion to
   * express:
   *
   *   deny  — would break every working path in the product. Chats,
   *           `acp-entry.ts`, and every workflow stage create conversations
   *           with no `hooks`; denying by default would refuse every tool call
   *           they make. A boundary nobody can pass is an outage, not
   *           security.
   *   allow — would be strictly WORSE than the pre-W35 behaviour. A
   *           `permissionDecision: 'allow'` from `PreToolUse` short-circuits
   *           the SDK's permission evaluation, so it would suppress the
   *           `canUseTool` prompts (and therefore the HITL approvals) that
   *           these paths currently do get. Returning "allow" for a policy
   *           that was never asked is precisely the overclaim being fixed.
   *   DEFER — returns no decision, leaving `permissionMode` / `allowedTools` /
   *           `canUseTool` to decide exactly as they do today. Behaviour is
   *           unchanged, the funnel point exists for a policy to be attached
   *           at any time, and every such call is counted on
   *           `claude_agent.tool_gate.ungated_calls` so the gap is measurable
   *           rather than merely asserted.
   *
   * DEFER is honest, not sufficient — which is why `capabilities()` reports
   * `preToolUseGated()` false while it is the operative policy.
   */
  private preToolUseHandler(
    gate: PreToolUseGate | undefined,
  ): (input: Record<string, unknown>) => Promise<Record<string, unknown> | void> {
    return async (input) => {
      const toolName = String(input['tool_name'] ?? '');

      if (!gate) {
        // DEFER — see the method doc. Emit the metric so an ungated process is
        // visible in telemetry instead of only in a capability flag.
        ungatedToolCalls.add(1, { tool: toolName });
        return;
      }

      let out;
      try {
        /* W35-B2 */ out = await Promise.race([
          gate(
            {
              timestamp: Date.now(),
              cwd: String(input['cwd'] ?? ''),
              toolName,
              toolArgs: input['tool_input'],
            },
            { sessionId: String(input['session_id'] ?? '') },
          ),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`PreToolUse gate timeout after ${PRE_TOOL_USE_GATE_TIMEOUT_MS}ms`)),
              PRE_TOOL_USE_GATE_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (err) {
        // Fail CLOSED: any error or timeout → deny the tool call.
        // An open gate on error would be a security regression (L16).
        if (this.verbose) {
          console.warn(
            `[ClaudeAgentAdapter] PreToolUse gate error for tool '${toolName}' — denying (fail-closed): ${err}`,
          );
        }
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Permission gate error: ${String(err)}`,
          },
        };
      }
      if (!out) return;
      return {
        ...(out.suppressOutput !== undefined ? { suppressOutput: out.suppressOutput } : {}),
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          ...(out.decision ? { permissionDecision: out.decision } : {}),
          ...(out.reason ? { permissionDecisionReason: out.reason } : {}),
          ...(out.modifiedArgs ? { updatedInput: out.modifiedArgs } : {}),
          ...(out.additionalContext ? { additionalContext: out.additionalContext } : {}),
        },
      };
    };
  }

  /**
   * W35 — the hook set handed to the SDK for ONE conversation.
   *
   * Differs from `buildClaudeHooks` (a pure translator of whatever the caller
   * supplied) in one load-bearing way: `PreToolUse` is ALWAYS present. It was
   * previously installed only when `config.hooks?.onPreToolUse` existed, which
   * meant the security gate was opt-in per caller — and two production callers
   * did not opt in. A boundary that every caller must remember to switch on is
   * not a boundary.
   *
   * Policy precedence: the conversation's own bridge → the provider-level
   * default (`setDefaultToolGate`) → DEFER (see `preToolUseHandler`).
   */
  private buildConversationHooks(
    config: StoredConversationConfig,
    persistent = false,
  ): ClaudeOptions['hooks'] {
    const bridge = (config.hooks as HookBridge | undefined) ?? {};
    const hooks = { ...(this.buildClaudeHooks(bridge) as unknown as Record<string, unknown[]>) };
    if (!hooks['PreToolUse']) {
      // The default gate is read when the hook FIRES, not captured here: a
      // persistent session keeps these hooks for its whole life, and
      // `setDefaultToolGate()` after it opened must still apply to it.
      hooks['PreToolUse'] = wrapClaudeHook((input) => this.preToolUseHandler(this.defaultToolGate)(input));
    }
    // ONE-SHOT ONLY: pin SDK subagents to the foreground, alongside the policy
    // gate (a deny from the gate still wins; this only rewrites input).
    //
    // The SDK's `Agent` tool runs subagents in the background BY DEFAULT
    // (`run_in_background` defaults to true). A one-shot CLI process exits
    // when the turn's `result` arrives, so a "background" subagent silently
    // evaporates: observed live (2026-09-01) as "Async agent launched
    // successfully" followed by a turn that ended with the model promising
    // results that could never come. Foreground subagents block the turn
    // until they finish, which is the only semantics a per-turn process can
    // honour. A persistent session outlives the turn, so it keeps the SDK's
    // native background subagents (item 17: one of the workarounds streaming
    // mode deletes). Platform-level background work goes through
    // spawn_background_agent in both modes.
    if (persistent) return hooks as ClaudeOptions['hooks'];
    (hooks['PreToolUse'] as unknown[]).push({
      matcher: 'Agent',
      hooks: [
        async (rawInput: unknown) => {
          const input = rawInput as {
            tool_name?: string;
            tool_input?: Record<string, unknown>;
          };
          // The matcher is a regex over tool names, so guard exactly here
          // too — this must never touch another tool's input.
          if (input.tool_name !== 'Agent') return {};
          const toolInput = input.tool_input ?? {};
          if (toolInput['run_in_background'] === false) return {};
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              permissionDecisionReason:
                'Subagents must run in the foreground on this per-turn runtime; background subagents do not survive the turn.',
              updatedInput: { ...toolInput, run_in_background: false },
            },
          };
        },
      ],
    });
    return hooks as ClaudeOptions['hooks'];
  }

  /**
   * HKS-01 — bridge the domain hook surface onto the Claude SDK's
   * `Options.hooks`. Only the six phases the domain models are wired; the SDK
   * exposes 31 events and the rest stay unused.
   *
   * Pure translation: a phase appears here only when the bridge supplies a
   * handler for it. The unconditional `PreToolUse` gate is layered on top by
   * `buildConversationHooks`, which is what `buildQueryOptions` actually calls.
   */
  private buildClaudeHooks(bridge: HookBridge): ClaudeOptions['hooks'] {
    const hooks: Record<string, unknown[]> = {};
    const wrap = wrapClaudeHook;

    if (bridge.onPreToolUse) {
      hooks['PreToolUse'] = wrap(this.preToolUseHandler(bridge.onPreToolUse));
    }

    if (bridge.onPostToolUse) {
      hooks['PostToolUse'] = wrap(async (input) => {
        const out = await bridge.onPostToolUse!(
          {
            timestamp: Date.now(),
            cwd: String(input['cwd'] ?? ''),
            toolName: String(input['tool_name'] ?? ''),
            toolArgs: input['tool_input'],
            toolResult: input['tool_response'],
          },
          { sessionId: String(input['session_id'] ?? '') },
        );
        if (!out) return;
        return {
          ...(out.suppressOutput !== undefined ? { suppressOutput: out.suppressOutput } : {}),
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            ...(out.additionalContext ? { additionalContext: out.additionalContext } : {}),
            ...(out.modifiedResult ? { updatedToolOutput: out.modifiedResult } : {}),
          },
        };
      });
    }

    if (bridge.onUserPromptSubmitted) {
      hooks['UserPromptSubmit'] = wrap(async (input) => {
        const out = await bridge.onUserPromptSubmitted!(
          {
            timestamp: Date.now(),
            cwd: String(input['cwd'] ?? ''),
            prompt: String(input['prompt'] ?? ''),
          },
          { sessionId: String(input['session_id'] ?? '') },
        );
        if (!out) return;
        return {
          ...(out.suppressOutput !== undefined ? { suppressOutput: out.suppressOutput } : {}),
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            ...(out.additionalContext ? { additionalContext: out.additionalContext } : {}),
          },
        };
      });
    }

    if (bridge.onSessionStart) {
      hooks['SessionStart'] = wrap(async (input) => {
        const raw = String(input['source'] ?? 'startup');
        const source = raw === 'resume' ? 'resume' : raw === 'startup' ? 'startup' : 'new';
        const out = await bridge.onSessionStart!(
          { timestamp: Date.now(), cwd: String(input['cwd'] ?? ''), source },
          { sessionId: String(input['session_id'] ?? '') },
        );
        if (!out?.additionalContext) return;
        return {
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: out.additionalContext },
        };
      });
    }

    if (bridge.onSessionEnd) {
      hooks['SessionEnd'] = wrap(async (input) => {
        await bridge.onSessionEnd!(
          { timestamp: Date.now(), cwd: String(input['cwd'] ?? ''), reason: 'complete' },
          { sessionId: String(input['session_id'] ?? '') },
        );
      });
    }

    if (bridge.onErrorOccurred) {
      hooks['PostToolUseFailure'] = wrap(async (input) => {
        const out = await bridge.onErrorOccurred!(
          {
            timestamp: Date.now(),
            cwd: String(input['cwd'] ?? ''),
            error: String(input['error'] ?? ''),
            errorContext: 'tool_execution',
            recoverable: true,
          },
          { sessionId: String(input['session_id'] ?? '') },
        );
        if (!out?.userNotification) return;
        return {
          hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: out.userNotification },
        };
      });
    }

    return hooks as ClaudeOptions['hooks'];
  }

  /**
   * Builds SDK query options from stored conversation config.
   *
   * @param turnOptions PLN-01 — per-turn overrides from `sendPrompt`. An
   *   explicitly requested mode (plan mode in particular) MUST win over the
   *   HITL-06 `'default'` coercion below, otherwise selecting Plan mode on a
   *   chat that also has a domain permission handler would silently downgrade
   *   to normal permission prompting and writes would not be gated.
   * @param runtime `persistent: true` when the options will open (or be
   *   compared against) a long-lived streaming session. Two construction-time
   *   flags then have to cover every mode the session may later be switched
   *   to via `setPermissionMode`: `allowDangerouslySkipPermissions` is granted
   *   whenever no domain handler exists (the ACTIVE mode still decides what
   *   runs), and `planModeInstructions` is always attached (the CLI only reads
   *   it while in plan mode). Otherwise toggling plan mode or bypass would
   *   force a session rebuild every time — the exact cost item 17 removes.
   */
  private buildQueryOptions(
    config: StoredConversationConfig,
    turnOptions?: SendPromptOptions,
    runtime: { persistent?: boolean } = {},
  ): ClaudeOptions {
    const persistent = runtime.persistent === true;
    // HITL-06 (Claude parity): if a domain permission callback is wired,
    // we MUST NOT let the SDK bypass permissions — otherwise `canUseTool`
    // is never invoked and the domain handler (which routes to HITL /
    // acceptEdits / etc. based on the run's current permissionMode) is
    // ignored. Force the SDK into 'default' mode and disable
    // allowDangerouslySkipPermissions so canUseTool fires on every tool.
    const hasDomainHandler = !!config.onPermissionRequest;
    // PLN-01 precedence: explicit per-turn permissionMode → mode derived from
    // agentMode → HITL-06 coercion → stored conversation default → bypass.
    const requestedMode =
      turnOptions?.permissionMode ??
      (turnOptions?.agentMode === 'plan' ? ('plan' as const) : undefined);
    const effectivePermissionMode =
      requestedMode ?? (hasDomainHandler ? 'default' : (config.permissionMode ?? 'bypassPermissions'));
    const options: ClaudeOptions = {
      ...this.baseQueryOptions(),
      model: config.model ?? this.options.defaultModel,
      cwd: config.workingDirectory ?? this.options.defaultCwd,
      ...(config.additionalDirectories?.length
        ? { additionalDirectories: config.additionalDirectories }
        : {}),
      effort: config.effort ?? this.options.defaultEffort ?? DEFAULT_EFFORT,
      maxTurns: config.maxTurns ?? this.options.defaultMaxTurns,
      maxBudgetUsd: config.maxBudgetUsd ?? this.options.defaultMaxBudgetUsd,
      includePartialMessages: this.options.includePartialMessages ?? true,
      includeHookEvents: this.options.includeHookEvents ?? false,
      // See comment above — domain handler forces 'default' + no skip.
      permissionMode: effectivePermissionMode as ClaudeOptions['permissionMode'],
      allowDangerouslySkipPermissions: persistent
        ? !hasDomainHandler
        : !hasDomainHandler && effectivePermissionMode === 'bypassPermissions',
      // Session management
      persistSession: true,
      settingSources: this.options.settingSources ?? [],
      enableFileCheckpointing: this.options.enableFileCheckpointing ?? false,
    };

    // Claude Code's auto-memory is ON by default and is NOT a setting source:
    // `settingSources: []` keeps the user's CLAUDE.md and settings.json out,
    // yet the CLI still read and WROTE `~/.claude/projects/<repo>/memory/`.
    // An app chat told "don't detach the server" saved that as a memory file
    // in the user's personal Claude Code profile — keyed by the repository,
    // so it would steer every `claude` session they later ran there, and
    // anything already in that directory steered the app's agent in return.
    // The app has its own memory and instruction surfaces; this one belongs
    // to the user's CLI. It stays on only when the operator has opted into
    // user-level settings, where sharing the profile is the point.
    if (!(this.options.settingSources ?? []).includes('user')) {
      (options as Record<string, unknown>)['settings'] = { autoMemoryEnabled: false };
    }

    // RV-9 — native structured output for THIS turn (a workflow stage's final
    // prompt turn). The format is session-scoped in the SDK, so it is only
    // ever set per turn, never on the conversation.
    if (turnOptions?.outputSchema) {
      options.outputFormat = { type: 'json_schema', schema: turnOptions.outputSchema };
    }

    // PLN-01 — Claude-native custom plan-mode workflow body. Only meaningful
    // while `permissionMode: 'plan'`; the CLI still wraps it with the
    // read-only enforcement preamble and the ExitPlanMode protocol footer.
    if ((persistent || effectivePermissionMode === 'plan') && config.planModeInstructions) {
      (options as Record<string, unknown>)['planModeInstructions'] = config.planModeInstructions;
    }

    // Resume from prior session if available
    if (config.sdkSessionId) {
      options.resume = config.sdkSessionId;
    }

    // System prompt
    if (config.systemPrompt) {
      options.systemPrompt = config.systemPrompt as ClaudeOptions['systemPrompt'];
    }

    // Tools — built-in tools selection
    if (config.tools) {
      options.tools = config.tools;
    }

    // Allowed tools (auto-approved)
    if (config.allowedTools && config.allowedTools.length > 0) {
      options.allowedTools = config.allowedTools;
    }

    // Disallowed tools
    if (config.disallowedTools && config.disallowedTools.length > 0) {
      options.disallowedTools = config.disallowedTools;
    }

    // MCP servers
    if (config.mcpServers) {
      options.mcpServers = config.mcpServers as ClaudeOptions['mcpServers'];
    }

    // Custom agents
    if (config.agents) {
      options.agents = config.agents as ClaudeOptions['agents'];
    }

    // Skills — the only place Claude turns skills on. Exact names only.
    if (config.skills && config.skills.length > 0) {
      options.skills = config.skills;
    }

    // RV-7 — the session's skills, staged by the composer as ONE local plugin
    // root. `settingSources` stays `[]`: a plugin loads its own skills only,
    // never the repository's `.claude/settings.json` (hooks included).
    if (config.plugins && config.plugins.length > 0) {
      (options as Record<string, unknown>)['plugins'] = config.plugins;
    }

    // Main-thread agent. Replaces the base system prompt, so callers opt in
    // explicitly (`agentProjection: 'native'`).
    if (config.agent) {
      options.agent = config.agent;
    }

    // HKS-01 — synchronous hook bridge, previously Copilot-only.
    //
    // W35: UNCONDITIONAL. This used to be `if (config.hooks)`, so a caller that
    // passed no hooks got no `PreToolUse` hook and therefore no tool gate,
    // while the capability ledger claimed full tool gating regardless.
    // `buildConversationHooks` always installs the gate; see there for the
    // no-policy default and `capabilities()` for the (now honest) ledger.
    options.hooks = this.buildConversationHooks(config, persistent);

    // ── Child environment ──────────────────────────────────────────
    //
    // ALWAYS built from an explicit allowlist, never by cloning the parent.
    // This process holds the vault key, the desktop admin token, the user's
    // GitHub token and the database credentials; the agent executes
    // model-authored shell commands, so anything visible here is one prompt
    // injection away from being exfiltrated. See `childEnv.ts`.
    options.env = buildHarnessEnv({
      // Operator-set CLI overrides the SDK genuinely needs to find `claude`.
      passthrough: ['CLAUDE_CLI_PATH', 'CLAUDE_CODE_PATH', 'CLAUDE_CONFIG_DIR'],
      // Handed down per conversation by the core, already reduced to
      // `GENERATORAI_*` at `createConversation`. Kept OUT of `extra` on
      // purpose: `extra` grants an own-credential exemption from the deny
      // list, and these values are not this provider's to exempt.
      delegated: config.delegatedEnv,
      extra: {
        ...this.options.env,
        ...config.env,
        // Per-instance managed home, so two accounts of the same provider
        // never share (or race on) one credential file.
        ...(this.options.homeDir ? { CLAUDE_CONFIG_DIR: this.options.homeDir } : {}),
      },
    }) as Record<string, string | undefined>;

    // HITL-06 (Claude parity) — bridge the domain permission callback into
    // the Claude SDK's `canUseTool`. Called before each tool execution;
    // returning `{behavior:'allow'}` runs it, `{behavior:'deny'}` blocks it.
    //
    // PLN-01 extends this into a full dispatcher:
    //   ExitPlanMode / AskUserQuestion  → dedicated blocking plan gates
    //   anything else while implementing → post-approval policy
    //   anything else                    → the domain permission handler
    const needsCallback =
      !!config.onPermissionRequest || !!config.onPlanReviewRequest || !!config.onQuestionRequest;

    if (needsCallback) {
      const capturedConvId = config.conversationId;
      const domainHandler = config.onPermissionRequest;
      const planReviewHandler = config.onPlanReviewRequest;
      const questionHandler = config.onQuestionRequest;

      options.canUseTool = async (toolName, input, ctx) => {
        // Track "waiting on human" so the rolling watchdog pauses. Covers the
        // plan gates too — a plan review can legitimately block for minutes.
        const prev = this.permissionPending.get(capturedConvId) ?? 0;
        this.permissionPending.set(capturedConvId, prev + 1);
        try {
          const args = (input ?? {}) as Record<string, unknown>;

          // ── AskUserQuestion → clarifying-question gate ──
          if (toolName === ASK_USER_QUESTION_TOOL && questionHandler) {
            const questions = normaliseClaudeQuestions(args);
            if (questions.length === 0) {
              return { behavior: 'allow', updatedInput: input };
            }
            const response = await questionHandler({ questions });
            return {
              behavior: 'allow',
              updatedInput: buildAskUserQuestionResult(
                args,
                questions,
                response.answers ?? {},
                response.freeformResponse,
              ),
            };
          }

          // ── ExitPlanMode → plan review gate ──
          if (toolName === EXIT_PLAN_MODE_TOOL && planReviewHandler) {
            const phase = this.planPhases.get(capturedConvId);
            const planContent = extractPlanContent(args, phase?.planText ?? '');
            if (!planContent) {
              // Fail loudly rather than opening a gate on an empty plan.
              await this.emitToHandlers(capturedConvId, 'harness.error', {
                message:
                  'Plan mode: could not capture the plan text from the model. ' +
                  'Ask the agent to restate its plan in the reply.',
                provider: 'claude-agent',
              });
              return {
                behavior: 'deny',
                message:
                  'The plan could not be captured. Please write the full plan in your reply, ' +
                  'then call ExitPlanMode again.',
                interrupt: false,
              };
            }

            const decision = await planReviewHandler({
              summary: derivePlanSummary(planContent),
              planContent,
              actions: CLAUDE_PLAN_ACTIONS,
              recommendedAction: 'implement_interactive',
              ...(typeof args['filePath'] === 'string' ? { filePath: args['filePath'] } : {}),
            });

            if (decision.approved) {
              // Realise the "plan → implement" transition in our own callback.
              this.planPhases.set(capturedConvId, {
                phase: 'implementing',
                postApprovalPolicy:
                  decision.action === 'implement_autopilot' ? 'bypassPermissions' : 'acceptEdits',
                planText: '',
              });
              return { behavior: 'allow', updatedInput: input };
            }

            return {
              behavior: 'deny',
              message:
                decision.feedback ??
                'The plan was not approved. Revise it and call ExitPlanMode again.',
              interrupt: false,
            };
          }

          // Plan-gate tools with no handler wired fall through untouched
          // (never surface as a raw "allow tool?" prompt).
          if (isPlanGateTool(toolName)) {
            return { behavior: 'allow', updatedInput: input };
          }

          // ── Post-approval policy ──
          const phase = this.planPhases.get(capturedConvId);
          if (phase?.phase === 'implementing') {
            if (phase.postApprovalPolicy === 'bypassPermissions') {
              return { behavior: 'allow', updatedInput: input };
            }
            if (isFileWriteTool(toolName) || isFileReadTool(toolName)) {
              return { behavior: 'allow', updatedInput: input };
            }
            // acceptEdits: everything else still goes through the domain gate.
          }

          // ── Ordinary permission path ──
          if (!domainHandler) {
            return { behavior: 'allow', updatedInput: input };
          }

          const result = await domainHandler({
            type: mapClaudeToolNameToDomainType(toolName),
            description: ctx.title ?? ctx.description ?? ctx.displayName ?? toolName,
            details: {
              toolName,
              input,
              toolUseID: ctx.toolUseID,
              blockedPath: ctx.blockedPath,
              decisionReason: ctx.decisionReason,
            },
          });
          if (result.granted) {
            return { behavior: 'allow', updatedInput: input };
          }
          return {
            behavior: 'deny',
            message: result.reason ?? 'Tool call denied by approver',
            interrupt: false,
          };
        } finally {
          const cur = this.permissionPending.get(capturedConvId) ?? 1;
          if (cur <= 1) this.permissionPending.delete(capturedConvId);
          else this.permissionPending.set(capturedConvId, cur - 1);
        }
      };
    }

    return options;
  }

  /**
   * Latest `getContextUsage()` response per conversation, plus whether a probe
   * is currently in flight. Cleared at the start of every turn — a breakdown
   * from a previous turn describes a window that no longer exists.
   */
  private readonly contextProbes = new Map<
    string,
    {
      inFlight: boolean;
      latest: ClaudeContextUsageResponse | null;
      /** The turn's `result`, once seen — a probe landing after it still publishes. */
      resultMessage?: unknown;
    }
  >();

  /**
   * Start a background `getContextUsage()` probe, at most one at a time.
   *
   * WHY THIS IS NOT AWAITED, AND NOT DONE AT `result`
   * -------------------------------------------------
   * It used to be both, and neither worked:
   *
   *  - **At `result` it can never succeed.** A string-prompt `query()` closes
   *    its transport as soon as the `result` message is yielded, so the
   *    control request loses the race every single time and rejects with
   *    "Query closed before response received". The failure was swallowed
   *    (verbose-only warning), so the authoritative snapshot silently never
   *    landed and the gauge ran permanently on the derived estimate.
   *  - **Awaited, it is far too expensive to be on the critical path.**
   *    Measured against the live CLI, a single call takes 1.3–3.6 s. Awaiting
   *    one per assistant message would add multiple seconds of dead time to
   *    every tool-using turn.
   *
   * So it is fired while the query is demonstrably still open — on assistant
   * messages, mid-turn — and never waited on. Single-flight keeps at most one
   * outstanding request, which naturally samples as often as the round-trip
   * allows and always advances toward the turn's latest state. Whatever has
   * landed by `result` is what {@link emitContextUsageSnapshot} publishes;
   * anything still in flight is simply dropped when the handle closes.
   */
  private beginContextUsageProbe(conversationId: string, q: Query): void {
    let entry = this.contextProbes.get(conversationId);
    if (!entry) {
      entry = { inFlight: false, latest: null };
      this.contextProbes.set(conversationId, entry);
    }
    if (entry.inFlight) return;
    entry.inFlight = true;
    void q
      .getContextUsage()
      .then((usage) => {
        const cur = this.contextProbes.get(conversationId);
        if (cur && usage && typeof usage.totalTokens === 'number') {
          cur.latest = usage as unknown as ClaudeContextUsageResponse;
          // Publish as it lands, not only at `result`:
          //  - mid-turn this is what makes the gauge MOVE during a long turn
          //    instead of sitting on the previous turn's figure for minutes;
          //  - a persistent session keeps its transport open past `result`, so
          //    a probe that loses that race by a few hundred milliseconds —
          //    measured: it lost every time on short turns, leaving the gauge
          //    permanently on the derived estimate with no breakdown — is
          //    still good, and is published against the result it trailed.
          void this.publishContextUsage(conversationId, cur.latest, cur.resultMessage);
        }
      })
      .catch((err: unknown) => {
        // Expected whenever the turn ends while a probe is outstanding.
        if (this.verbose) {
          console.warn(`[ClaudeAgentAdapter] context-usage probe for ${conversationId}: ${(err as Error).message}`);
        }
      })
      .finally(() => {
        const cur = this.contextProbes.get(conversationId);
        if (cur) cur.inFlight = false;
      });
  }

  /** Drop any breakdown carried over from the previous turn. */
  private resetContextUsageProbe(conversationId: string): void {
    this.contextProbes.delete(conversationId);
  }

  /**
   * Publish the authoritative context-window breakdown for the finished turn.
   *
   * `currentTokens` is taken from the `result` message's LAST API call rather
   * than from the probe's own `totalTokens`, because the probe was answered
   * mid-turn and the final call added to the window after that. The two agree
   * exactly when both describe the same point in the turn — measured, the
   * last iteration's prompt equals `getContextUsage().totalTokens` to the
   * token (41,932 vs 41,932; 35,368 vs 35,368) — so this composes the newest
   * total with the richest breakdown rather than choosing between them.
   *
   * Emits nothing when no probe landed: `event-mapper` has already published
   * the same total as a `derived` snapshot, and a second event carrying a
   * stale or absent breakdown would only overwrite it with less.
   */
  private async emitContextUsageSnapshot(conversationId: string, resultMessage: unknown, queryHandle?: Query): Promise<void> {
    let entry = this.contextProbes.get(conversationId);
    if (!entry) {
      entry = { inFlight: false, latest: null };
      this.contextProbes.set(conversationId, entry);
    }
    entry.resultMessage = resultMessage;
    if (entry.latest) {
      await this.publishContextUsage(conversationId, entry.latest, resultMessage);
      return;
    }
    // Nothing landed during the turn (a one-message answer is over before a
    // 1–3 s probe can return). A live session is still open, so ask now; the
    // answer publishes itself when it arrives.
    if (queryHandle) this.beginContextUsageProbe(conversationId, queryHandle);
  }

  private async publishContextUsage(
    conversationId: string,
    usage: ClaudeContextUsageResponse,
    resultMessage: unknown,
  ): Promise<void> {
    try {
      const lastCall = lastIterationUsage(
        (resultMessage as { usage?: Record<string, unknown> } | undefined)?.usage,
      );
      const currentTokens = lastCall
        ? lastCall.input + lastCall.cacheRead + lastCall.cacheWrite
        : usage.totalTokens;

      // DEFERRED ENTRIES OCCUPY NO CONTEXT, and `totalTokens` excludes them.
      // Counting them made the popover's rows sum to more than the total they
      // sit above and overflowed the stacked bar. Measured on a live session:
      //
      //   System prompt              13,197
      //   System tools               23,770
      //   MCP tools (deferred)       14,957   isDeferred, every tool isLoaded:false
      //   System tools (deferred)    14,178   isDeferred
      //   Messages                    2,071
      //   totalTokens                39,029   = 13,197 + 23,770 + 2,071 (+ rounding)
      //
      // All 38 MCP tools reported `isLoaded: false` — the model can request
      // them later, but none of them is in the window now — and the old code
      // summed them unconditionally, adding 14,957 to a 39,029 total (+38%).
      const notDeferred = (c: { isDeferred?: boolean }): boolean => c.isDeferred !== true;
      const cat = (name: RegExp): number | undefined => {
        const hit = usage.categories?.find((c) => notDeferred(c) && name.test(c.name));
        return hit ? hit.tokens : undefined;
      };
      const sum = (rows?: { tokens: number }[]): number | undefined =>
        rows?.length ? rows.reduce((a, r) => a + r.tokens, 0) : undefined;
      const loadedMcpTools = usage.mcpTools?.filter((t) => t.isLoaded !== false);

      const mb = usage.messageBreakdown;
      const breakdown = {
        // The category regexes are anchored rather than loose: `/system/i`
        // also matches "System tools" and "System tools (deferred)", so a
        // change in category ORDER — the only thing that made the loose form
        // land on the right row — would silently relabel deferred tokens as
        // the system prompt. `notDeferred` above is the second guard.
        ...(sum(usage.systemPromptSections) != null ? { system: sum(usage.systemPromptSections) } : cat(/^system prompt/i) != null ? { system: cat(/^system prompt/i) } : {}),
        ...(sum(usage.systemTools) != null ? { tools: sum(usage.systemTools) } : cat(/^system tools/i) != null ? { tools: cat(/^system tools/i) } : {}),
        ...(sum(loadedMcpTools) != null ? { mcpTools: sum(loadedMcpTools) } : {}),
        ...(sum(usage.memoryFiles) != null ? { memoryFiles: sum(usage.memoryFiles) } : {}),
        ...(sum(usage.agents) != null ? { agents: sum(usage.agents) } : {}),
        ...(usage.skills ? { skills: usage.skills.tokens } : {}),
        ...(mb
          ? {
              toolCalls: mb.toolCallTokens,
              toolResults: mb.toolResultTokens,
              attachments: mb.attachmentTokens,
              userMessages: mb.userMessageTokens,
              assistantMessages: mb.assistantMessageTokens,
              conversation:
                mb.userMessageTokens +
                mb.assistantMessageTokens +
                mb.toolCallTokens +
                mb.toolResultTokens +
                mb.attachmentTokens,
            }
          : {}),
      };

      await this.emitEventToHandlers(conversationId, createAgentEvent('harness.context_usage', {
        provider: 'claude-agent',
        source: 'provider',
        currentTokens,
        ...(usage.model ? { model: usage.model } : {}),
        ...(typeof usage.maxTokens === 'number' && usage.maxTokens > 0
          ? { promptTokenLimit: usage.maxTokens }
          : {}),
        ...(typeof usage.rawMaxTokens === 'number' && usage.rawMaxTokens > 0
          ? { totalContextWindow: usage.rawMaxTokens }
          : {}),
        ...(typeof usage.autoCompactThreshold === 'number' && usage.isAutoCompactEnabled
          ? { compactionThreshold: usage.autoCompactThreshold }
          : {}),
        ...(Object.keys(breakdown).length > 0 ? { breakdown } : {}),
        // Prefer the result message's own last call over the probe's
        // `apiUsage`: the probe answered mid-turn, so its counts describe an
        // earlier call than `currentTokens` above and the popover's Input /
        // Cache read / Cache write rows would not add up to the total they
        // sit under.
        ...(lastCall
          ? {
              apiUsage: {
                input: lastCall.input,
                output: lastCall.output,
                cacheRead: lastCall.cacheRead,
                cacheWrite: lastCall.cacheWrite,
              },
            }
          : usage.apiUsage
            ? {
                apiUsage: {
                  input: usage.apiUsage.input_tokens,
                  output: usage.apiUsage.output_tokens,
                  cacheRead: usage.apiUsage.cache_read_input_tokens,
                  cacheWrite: usage.apiUsage.cache_creation_input_tokens,
                },
              }
            : {}),
      }));
    } catch (err) {
      if (this.verbose) {
        console.warn(`[ClaudeAgentAdapter] context-usage snapshot failed for ${conversationId}:`, err);
      }
    }
  }

  /**
   * Runs a query() in the background, emitting events to registered handlers.
   * This is the async-iterator → callback bridge (R-01).
   */
  // ══════════════════════════════════════════════════════════════
  // Turn and session lifecycle (review item 17)
  // ══════════════════════════════════════════════════════════════

  /**
   * Take an execution permit for this turn.
   *
   * Item 4: chat turns used to bypass the concurrency limit entirely — only
   * the workflow path acquired — so the limit bounded workflow steps and
   * nothing else. Now both paths acquire. A turn that has to wait says so:
   * blocking silently is what turns "too busy" into "the prompt hangs with no
   * explanation". `undefined` when a stop withdrew the wait (`queuedTurns`).
   */
  private async acquireTurnPermit(conversationId: string, admitted = false): Promise<(() => void) | undefined> {
    const supervisor = this.supervisor;
    // No supervisor wired (embedded and test use): nothing to bound against.
    // An admitted turn (a workflow stage) already holds the flow key.
    if (!supervisor || admitted) return () => {};

    const immediate = supervisor.tryAcquireExecution();
    if (immediate) return immediate;

    const snap = supervisor.snapshot?.();
    const ahead = snap?.executionQueueDepth ?? 0;
    await this.emitToHandlers(conversationId, 'harness.warning', {
      code: 'execution_queued',
      message:
        (ahead > 0
          ? `Waiting for a free agent slot — ${ahead} turn${ahead === 1 ? '' : 's'} ahead`
          : 'Waiting for a free agent slot') +
        (snap ? ` (provider claude-agent ${snap.activeExecutions}/${snap.maxConcurrentExecutions}; Settings → Workflow engine).` : '.'),
      provider: 'claude-agent',
      flowKey: 'provider:claude-agent',
    });
    const withdraw = new AbortController();
    let queued = this.queuedTurns.get(conversationId);
    if (!queued) {
      queued = new Set();
      this.queuedTurns.set(conversationId, queued);
    }
    queued.add(withdraw);
    try {
      const release = await supervisor.acquireExecution(withdraw.signal);
      // A gate that granted the permit as the stop landed: hand it straight back.
      if (withdraw.signal.aborted) {
        release();
        return undefined;
      }
      return release;
    } catch (err) {
      if (withdraw.signal.aborted) return undefined;
      throw err;
    } finally {
      queued.delete(withdraw);
      if (queued.size === 0 && this.queuedTurns.get(conversationId) === queued) this.queuedTurns.delete(conversationId);
    }
  }

  /** Register per-turn bookkeeping and return it. */
  private beginTurn(
    conversationId: string,
    activeQuery: ActiveQuery,
    startedAt: number,
    releaseExecution: () => void,
    prompt = '',
  ): TurnState {
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const turn: TurnState = {
      conversationId,
      activeQuery,
      startedAt,
      fullContent: '',
      pendingToolNames: [],
      sawAssistant: false,
      localCommand: prompt.trimStart().startsWith('/'),
      releaseExecution,
      aborted: false,
      settled: false,
      done,
      settle,
    };
    this.turns.set(conversationId, turn);
    return turn;
  }

  /**
   * End a turn exactly once, whatever ended it. Releases the execution permit
   * and wakes anyone waiting on `done` — a second prompt for the same
   * conversation waits on that rather than racing this one.
   */
  private completeTurn(turn: TurnState, status: 'completed' | 'failed' | 'aborted'): void {
    if (turn.settled) return;
    turn.settled = true;
    turn.activeQuery.status = status === 'completed' ? 'completed' : status === 'aborted' ? 'aborted' : 'failed';

    if (status === 'completed') {
      this.querySuccessCount++;
      this.consecutiveFailCount = 0;
      promptDuration.record(Date.now() - turn.startedAt, { conversation_id: turn.conversationId });
    } else if (status === 'failed') {
      this.queryFailCount++;
      this.consecutiveFailCount++;
    }

    try {
      turn.releaseExecution?.();
    } catch {
      // A double release is a no-op by construction; never mask the outcome.
    }
    if (this.turns.get(turn.conversationId) === turn) this.turns.delete(turn.conversationId);
    if (this.activeQueries.get(turn.conversationId) === turn.activeQuery) {
      this.activeQueries.delete(turn.conversationId);
    }
    // The plan phase is per-turn; never leak it into the next one.
    this.planPhases.delete(turn.conversationId);
    turn.settle();
  }

  /** Report a turn that could not run, then end it. */
  private async failTurn(turn: TurnState, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ClaudeAgentAdapter] Turn failed for ${turn.conversationId}: ${message}`);
    await this.emitToHandlers(turn.conversationId, 'harness.error', { message, provider: 'claude-agent' });
    this.completeTurn(turn, 'failed');
  }

  /**
   * One-shot mode cannot carry image content blocks, so attachments are named
   * in the prompt text and the model reaches them with its file tools. The
   * persistent path uses real content blocks instead — see `buildUserMessage`.
   */
  private describeAttachmentsInline(prompt: string, attachments?: AttachmentRef[]): string {
    if (!attachments || attachments.length === 0) return prompt;
    const lines = attachments.map((a) => {
      const label = a.displayName ? `${a.displayName} — ` : '';
      return `- ${label}${a.path}`;
    });
    return `${prompt}\n\nAttached files:\n${lines.join('\n')}`;
  }

  /**
   * Build the user message pushed into a live session.
   *
   * Image attachments become real content blocks here, which is the whole
   * reason the provider declares `vision: true`. In one-shot mode the prompt
   * is a plain string and they were silently discarded.
   */
  private async buildUserMessage(
    prompt: string,
    attachments: AttachmentRef[] | undefined,
    sdkSessionId: string | undefined,
  ): Promise<SDKUserMessage> {
    const blocks: Array<Record<string, unknown>> = [];
    const nonImages: AttachmentRef[] = [];

    for (const attachment of attachments ?? []) {
      const image = await this.readImageAttachment(attachment);
      if (image) blocks.push(image);
      else nonImages.push(attachment);
    }

    const text = this.describeAttachmentsInline(prompt, nonImages.length > 0 ? nonImages : undefined);
    blocks.push({ type: 'text', text });

    return {
      type: 'user',
      message: { role: 'user', content: blocks },
      parent_tool_use_id: null,
      session_id: sdkSessionId ?? '',
    } as unknown as SDKUserMessage;
  }

  /** An image attachment as a base64 content block, or undefined if it is not one. */
  private async readImageAttachment(
    attachment: AttachmentRef,
  ): Promise<Record<string, unknown> | undefined> {
    const path = attachment.path;
    if (!path) return undefined;
    const mediaType = IMAGE_MEDIA_TYPES[extname(path).toLowerCase()];
    if (!mediaType) return undefined;
    try {
      const data = await readFile(path);
      // Very large images cost more than they inform; let the model read the
      // file with its own tools instead of blowing up the request.
      if (data.byteLength > MAX_INLINE_IMAGE_BYTES) return undefined;
      return { type: 'image', source: { type: 'base64', media_type: mediaType, data: data.toString('base64') } };
    } catch {
      return undefined;
    }
  }

  /**
   * The live session for a conversation, opened on first use and reused for
   * every later turn.
   *
   * This is the change that removes a full CLI start-up from every message.
   * Options that the installed SDK can change on a running session (model,
   * permission mode, MCP servers) are applied in place; the ones with no live
   * setter — cwd, system prompt, tool lists, skills — change the fingerprint
   * and force a rebuild, resumed from the SDK session id so the conversation
   * keeps its memory.
   */
  /**
   * Bring a conversation's CLI process to readiness before its first prompt.
   *
   * Uses the SDK's own `startup()`, which spawns the subprocess and completes
   * the initialize handshake with no prompt available; the returned
   * `WarmQuery` accepts the input queue later and writes it to an already-ready
   * process. Measured on this machine: a first turn falls from ~12.8 s to
   * ~3 s when the process had ten seconds of lead time.
   *
   * Best-effort by contract — every failure path returns quietly and the first
   * prompt simply pays what it pays today.
   */
  async prewarmConversation(conversationId: string, turnOptions?: SendPromptOptions): Promise<void> {
    // One-shot mode builds and discards a process per turn, so a warm handle
    // would never be claimed.
    if (!this.persistentSessions) return;
    // Already live, or already warm: both make this a no-op, which is what the
    // idempotency half of the contract requires.
    if (this.sessions.has(conversationId) || this.warmSessions.has(conversationId)) return;

    const config = this.conversations.get(conversationId);
    if (!config) return;

    try {
      // No `turnOptions`: this is the conversation's baseline. `model`,
      // `permissionMode` and `mcpServers` are deliberately absent from
      // `sessionFingerprint`, so a first turn that changes any of them still
      // claims this handle and applies the change through the live setters.
      // Build the warm session with the options the FIRST TURN will ask for,
      // not with none. A handle built without them lands on the HITL-06
      // 'default' coercion, while an ordinary turn asks for the chat's own
      // permission mode — so the two never matched and the warm handle was
      // either wasted or (before the claim compared them) silently used to
      // run the turn under the wrong mode.
      const options = this.buildQueryOptions(config, turnOptions, { persistent: true });
      // A conversation that has to resume a previous SDK session cannot use a
      // freshly-started process: `resume` is fixed at spawn.
      if (config.sdkSessionId) return;

      const fingerprint = sessionFingerprint(options);
      const sdk = await loadClaudeSdk();
      const startup = (sdk as {
        startup?: (p?: { options?: ClaudeOptions; initializeTimeoutMs?: number }) => Promise<WarmQuery>;
      }).startup;
      // Older SDKs have no `startup()`. Declaring the capability is not a
      // promise that the installed SDK provides it.
      if (typeof startup !== 'function') return;

      // The SDK's default is 60 s. A warm-up is a speculative bet on a turn
      // that may never come, so it must not hold a half-spawned process for a
      // minute when the CLI is missing or wedged — an unreachable executable
      // otherwise hangs here for the full default. Measured initialize is
      // ~14 s, so this is generous and still bounded.
      const warm = await startup({ options, initializeTimeoutMs: PREWARM_INITIALIZE_TIMEOUT_MS });

      // A turn may have started, or another warm may have won, while we were
      // spawning. Losing that race must not leak the process.
      if (this.sessions.has(conversationId) || this.warmSessions.has(conversationId)) {
        warm.close();
        return;
      }
      // Nor may it leak if the conversation was deleted meanwhile.
      if (!this.conversations.has(conversationId)) {
        warm.close();
        return;
      }
      this.warmSessions.set(conversationId, {
        warm,
        fingerprint,
        built: {
          permissionMode: options.permissionMode,
          model: options.model,
          mcpKey: mcpFingerprint(options.mcpServers as Record<string, unknown> | undefined),
        },
      });
      if (this.verbose) {
        console.log(`[ClaudeAgentAdapter] pre-warmed conversation ${conversationId}`);
      }
    } catch (err) {
      if (this.verbose) {
        console.warn(`[ClaudeAgentAdapter] pre-warm failed for ${conversationId}: ${(err as Error).message}`);
      }
    }
  }

  /** Discard a pre-warmed handle, killing its process. Safe to call always. */
  private discardWarmSession(conversationId: string, reason: string): void {
    const warmed = this.warmSessions.get(conversationId);
    if (!warmed) return;
    this.warmSessions.delete(conversationId);
    try {
      warmed.warm.close();
    } catch {
      // Already gone — nothing to release.
    }
    if (this.verbose) {
      console.log(`[ClaudeAgentAdapter] discarded warm session for ${conversationId}: ${reason}`);
    }
  }

  private async ensureSession(
    conversationId: string,
    config: StoredConversationConfig,
    options: ClaudeOptions,
  ): Promise<PersistentSession> {
    const fingerprint = sessionFingerprint(options);
    const existing = this.sessions.get(conversationId);

    if (existing && !existing.closed && existing.fingerprint === fingerprint) {
      await this.applyLiveOptionChanges(existing, options);
      return existing;
    }

    if (existing) {
      // A rebuild, not a fresh start: carry the SDK session id so the new
      // process resumes the same conversation rather than starting cold.
      await this.closeSession(existing, 'options changed that have no live setter');
      if (existing.sdkSessionId && !options.resume) {
        options = { ...options, resume: existing.sdkSessionId };
      }
    } else if (config.sdkSessionId && !options.resume) {
      options = { ...options, resume: config.sdkSessionId };
    }

    const { query: claudeQuery } = await loadClaudeSdk(); // W41
    const input = new AsyncInputQueue<SDKUserMessage>();

    // Claim a pre-warmed process when one is waiting and it was started with
    // structurally identical options. A mismatch (or a resume, which is fixed
    // at spawn) closes the handle and falls back to spawning here — the same
    // cost as before pre-warming existed, never worse.
    const warmed = this.warmSessions.get(conversationId);
    // `model`, `permissionMode` and `mcpServers` are excluded from the
    // fingerprint because a RUNNING session can be switched between them.
    // A warm handle is not running yet: its setters live on the Query that
    // `warm.query(input)` returns, and by then the prompt is already away.
    //
    // Claiming a mismatched handle therefore ran the turn under the warm-up's
    // options while the session record claimed otherwise — measured: selecting
    // Plan mode on a pre-warmed chat silently ran in the warm-up's mode, so
    // the agent wrote files and no plan gate ever opened, intermittently,
    // depending on whether the warm-up had finished in time. Compare them
    // here and spawn fresh on a mismatch.
    const warmMatches =
      !!warmed &&
      warmed.fingerprint === fingerprint &&
      warmed.built.permissionMode === options.permissionMode &&
      warmed.built.model === options.model &&
      warmed.built.mcpKey === mcpFingerprint(options.mcpServers as Record<string, unknown> | undefined);
    let queryHandle: Query;
    if (warmed && warmMatches && !options.resume) {
      this.warmSessions.delete(conversationId);
      queryHandle = warmed.warm.query(input);
    } else {
      if (warmed) this.discardWarmSession(conversationId, 'options changed before first use');
      queryHandle = claudeQuery({ prompt: input, options });
    }

    const session: PersistentSession = {
      conversationId,
      query: queryHandle,
      input,
      fingerprint,
      liveModel: options.model,
      livePermissionMode: options.permissionMode,
      liveMcpKey: mcpFingerprint(options.mcpServers as Record<string, unknown> | undefined),
      sdkSessionId: config.sdkSessionId,
      closed: false,
      reader: Promise.resolve(),
    };
    session.reader = this.readSession(session);
    this.sessions.set(conversationId, session);
    return session;
  }

  /** Apply the option changes the SDK supports on a running session. */
  private async applyLiveOptionChanges(session: PersistentSession, options: ClaudeOptions): Promise<void> {
    try {
      if (options.model !== session.liveModel) {
        await session.query.setModel(options.model);
        session.liveModel = options.model;
      }
      if (options.permissionMode && options.permissionMode !== session.livePermissionMode) {
        await session.query.setPermissionMode(options.permissionMode);
        session.livePermissionMode = options.permissionMode;
      }
      const mcpKey = mcpFingerprint(options.mcpServers as Record<string, unknown> | undefined);
      if (mcpKey !== session.liveMcpKey) {
        await session.query.setMcpServers(options.mcpServers ?? {});
        session.liveMcpKey = mcpKey;
      }
    } catch (err) {
      // A setter that fails leaves the session in an unknown state; drop the
      // fingerprint so the next turn rebuilds rather than running with options
      // the process may not actually have.
      session.fingerprint = '';
      if (this.verbose) {
        console.warn(`[ClaudeAgentAdapter] live option change failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Drain one live session for its whole lifetime, routing each message into
   * whichever turn is currently in flight.
   */
  private async readSession(session: PersistentSession): Promise<void> {
    const { conversationId } = session;
    try {
      for await (const message of session.query) {
        const turn = this.turns.get(conversationId);
        if (!turn || turn.aborted) {
          // Nothing is waiting for this (a cancelled turn, or output that
          // arrived after settlement) — record the session id and drop it.
          if (message.type === 'result') {
            this.rememberSdkSessionId(session, message);
            // The CLI answered the interrupt: the aborted turn is over. This
            // is what releases its execution permit and lets the next prompt
            // on this conversation (which waits on `done`) start. Before this
            // the aborted turn was never settled — four stopped workers held
            // all four permits and every later turn queued forever behind
            // "Waiting for a free agent slot".
            if (turn && turn.session === session) {
              turn.cancellation?.acknowledgeTerminal();
              this.completeTurn(turn, 'aborted');
            }
          }
          continue;
        }
        if (isHousekeepingResult(message, turn)) {
          // Not this prompt's answer — see `isHousekeepingResult`. Mapping it
          // would publish `harness.idle` and end the turn in the UI as well.
          this.rememberSdkSessionId(session, message);
          continue;
        }
        await this.applyMessageToTurn(turn, message, session.query);
        if (message.type === 'result') {
          this.rememberSdkSessionId(session, message);
          this.finishTurnFromResult(turn);
        }
      }
    } catch (err) {
      const turn = this.turns.get(conversationId);
      if (turn) await this.failTurn(turn, err);
      else if (this.verbose) {
        console.warn(`[ClaudeAgentAdapter] session reader ended for ${conversationId}: ${(err as Error).message}`);
      }
    } finally {
      session.closed = true;
      if (this.sessions.get(conversationId) === session) this.sessions.delete(conversationId);
      // The reader ended — the CLI exited, or the session was closed because an
      // interrupt was never acknowledged. Whatever turn was pushed into THIS
      // session is over, whether or not a `result` ever came.
      const turn = this.turns.get(conversationId);
      if (turn && !turn.settled && turn.session === session) {
        turn.cancellation?.acknowledgeTerminal();
        if (turn.aborted) this.completeTurn(turn, 'aborted');
        else await this.failTurn(turn, new Error('The agent session ended before the turn produced a result'));
      }
    }
  }

  private rememberSdkSessionId(session: PersistentSession, message: { session_id?: string }): void {
    if (!message.session_id) return;
    session.sdkSessionId = message.session_id;
    const config = this.conversations.get(session.conversationId);
    if (config) config.sdkSessionId = message.session_id;
  }

  /** Close a live session and its reader. Safe to call twice. */
  private async closeSession(session: PersistentSession, reason: string): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    if (this.verbose) {
      console.log(`[ClaudeAgentAdapter] closing session for ${session.conversationId}: ${reason}`);
    }
    try {
      session.input.end();
      await session.query.close();
    } catch {
      // Already gone — the reader's finally block does the bookkeeping.
    }
    if (this.sessions.get(session.conversationId) === session) {
      this.sessions.delete(session.conversationId);
    }
  }

  private async runQueryInBackground(
    conversationId: string,
    prompt: string,
    options: ClaudeOptions,
    turn: TurnState,
  ): Promise<void> {
    const activeQuery = turn.activeQuery;
    try {
      if (this.verbose) console.log(`[ClaudeAgentAdapter] Starting background query for ${conversationId}`);

      const { query: claudeQuery } = await loadClaudeSdk(); // W41
      const queryHandle = claudeQuery({ prompt, options });
      activeQuery.closeHandle = () => queryHandle.close();

      for await (const message of queryHandle) {
        if (turn.aborted) break;
        await this.applyMessageToTurn(turn, message, queryHandle);
      }

      this.finishTurnFromResult(turn);
      if (this.verbose) console.log(`[ClaudeAgentAdapter] Background query completed for ${conversationId}`);
    } catch (err) {
      await this.failTurn(turn, err);
    }
  }

  /**
   * Handle one SDK message for the turn it belongs to.
   *
   * Both paths run this: the one-shot query loop and the persistent session
   * reader. It exists once on purpose — the review's second recurring defect
   * is a fix applied to one copy of duplicated logic and not the other, and
   * this is the logic that maps every provider message to a domain event.
   */
  private async applyMessageToTurn(turn: TurnState, message: SDKMessage, queryHandle: Query): Promise<void> {
    const { conversationId } = turn;

    for (const event of mapClaudeAgentMessageToAgentEvents(message)) {
      if (message.type === 'result' && isTerminalEvent(event)) {
        // BEFORE the terminal event, not after it: the chat service drops its
        // subscription the moment it sees `harness.idle`, so a snapshot sent
        // afterwards reaches nobody. It did exactly that — the breakdown was
        // computed every turn and the gauge never once showed it.
        this.recordObservedLimits(message);
        await this.emitContextUsageSnapshot(conversationId, message, queryHandle);
      }
      await this.emitEventToHandlers(conversationId, event);
    }

    if (message.type === 'assistant') {
      turn.sawAssistant = true;
      // See `beginContextUsageProbe` — sampled mid-turn, never awaited.
      this.beginContextUsageProbe(conversationId, queryHandle);
      const betaMsg = message.message;
      if (betaMsg?.content) {
        for (const block of betaMsg.content) {
          if (block.type === 'text') {
            turn.fullContent += block.text;
            // PLN-01 — in plan mode the model writes the plan as its message
            // right before calling ExitPlanMode, and the SDK's
            // ExitPlanModeInput has no contractual `plan` field. Keep the
            // running text so the gate has a reliable fallback source.
            const phase = this.planPhases.get(conversationId);
            if (phase && phase.phase === 'planning') {
              phase.planText += block.text;
            }
          } else if (block.type === 'tool_use') {
            // W13-B1: track tool calls so we can fail them on truncation.
            turn.pendingToolNames.push(block.name);
          }
        }
      }
      // W13-B1: detect truncation stop reason.
      if (betaMsg?.stop_reason && isTruncationStopReason(String(betaMsg.stop_reason))) {
        turn.truncationStopReason = String(betaMsg.stop_reason);
        this.toolSemaphore.markTruncated(conversationId, turn.truncationStopReason);
      }
    } else if (message.type === 'result') {
      const config = this.conversations.get(conversationId);
      if (config) config.sdkSessionId = message.session_id;
      if (message.subtype === 'success' && !turn.fullContent && message.result) {
        turn.fullContent = message.result;
      }
    }
  }

  /**
   * Settle a turn that reached its own end: report cancelled tool calls if the
   * response was truncated, store the assistant text, then complete.
   */
  private finishTurnFromResult(turn: TurnState): void {
    if (turn.settled) return;
    const { conversationId } = turn;

    // W13-B1: fail all tool calls when the response was truncated.
    if (turn.truncationStopReason && turn.pendingToolNames.length > 0) {
      const truncMsg =
        `Response was truncated (stop_reason: ${turn.truncationStopReason}). ` +
        `All ${turn.pendingToolNames.length} tool call(s) in this batch are cancelled — ` +
        `please re-issue your request with a shorter response or fewer tools.`;
      console.warn(`[ClaudeAgentAdapter] Truncation detected for ${conversationId}: ${truncMsg}`);
      for (const toolName of turn.pendingToolNames) {
        void this.emitToHandlers(conversationId, 'harness.tool_complete', {
          tool: toolName,
          result: { error: truncMsg, truncated: true },
          success: false,
        });
      }
    }

    if (turn.fullContent) {
      this.pushMessage(conversationId, { role: 'assistant', content: turn.fullContent, timestamp: new Date() });
    }
    this.completeTurn(turn, 'completed');
  }

  /**
   * Deliver one event to every subscriber, AWAITING each.
   *
   * Review 3.4: this used to call `handler(event)` and drop the returned
   * promise, so the comment claiming backpressure "reaches back to the
   * harness's own read loop" was false. Nothing slowed down when the model
   * outran the persist path — the queue simply grew, and the text on screen
   * fell further behind the model the longer the answer ran.
   *
   * Awaiting here is what makes that comment true: `applyMessageToTurn`
   * awaits this, and the SDK message loops await that, so a slow consumer
   * genuinely pauses reading the next message instead of piling events up.
   */
  private async emitEventToHandlers(conversationId: string, event: AgentEvent): Promise<void> {
    this.genai.observe(conversationId, event);
    const handlers = this.conversationEventHandlers.get(conversationId);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        // One bad subscriber must not stop the others, or drop the turn.
        if (this.verbose) console.error(`[ClaudeAgentAdapter] Event handler error:`, err);
      }
    }
  }

  private async emitToHandlers(conversationId: string, kind: AgentEventKind, data: unknown): Promise<void> {
    const event = createAgentEvent(kind, data as never);
    await this.emitEventToHandlers(conversationId, event);
  }

  private emitClientEvent(event: HarnessClientEvent): void {
    for (const handler of this.clientEventHandlers) {
      handler(event);
    }
  }

  private pushMessage(conversationId: string, msg: ConversationMessage): void {
    let msgs = this.conversationMessages.get(conversationId);
    if (!msgs) {
      msgs = [];
      this.conversationMessages.set(conversationId, msgs);
    }
    msgs.push(msg);
    // The durable transcript is the database; this copy only serves
    // `getMessages()` (one legacy route). It grew for the life of the
    // conversation — a long-running chat kept every message twice.
    if (msgs.length > MAX_TRANSCRIPT_MESSAGES) msgs.splice(0, msgs.length - MAX_TRANSCRIPT_MESSAGES);
  }

  /**
   * Review item 16 — bound the live conversation set.
   *
   * Four maps and, in persistent-session mode, a live CLI process hang off
   * every conversation, and nothing but an explicit delete ever released them:
   * the only thing that emptied them was restarting the server. This sweeper
   * closes conversations that have gone quiet, so a long-lived server settles
   * back to the sessions actually in use.
   *
   * Idle-only. The LRU cap is enforced at bind time (`evictLruConversation`),
   * where there is a new conversation to make room for.
   */
  private startSweeper(): void {
    if (this.sweepTimer || this.sessionIdleMs <= 0) return;
    // A quarter of the idle window, floored at 30s and capped at 5min: often
    // enough that an expired session is reaped promptly, rarely enough that an
    // idle server is not doing steady wake-ups.
    const period = Math.min(Math.max(Math.floor(this.sessionIdleMs / 4), 30_000), 300_000);
    this.sweepTimer = setInterval(() => {
      try {
        this.sweepIdleConversations();
      } catch (err) {
        if (this.verbose) {
          console.warn(`[ClaudeAgentAdapter] idle sweep failed: ${(err as Error).message}`);
        }
      }
    }, period);
    // Never hold the process open for a maintenance timer.
    this.sweepTimer.unref?.();
  }

  /** Close every conversation whose last use is older than the idle window. */
  private sweepIdleConversations(): void {
    const cutoff = Date.now() - this.sessionIdleMs;
    // The cap is enforced on `conversations`; `sessions` must never exceed it
    // for long. If it does, cleanup is not closing processes again — say so
    // rather than let it show up as "the app uses too much memory".
    if (this.sessions.size > this.maxLiveConversations) {
      console.warn(
        `[ClaudeAgentAdapter] ${this.sessions.size} live sessions exceed the cap of ${this.maxLiveConversations} ` +
          `(${this.conversations.size} conversations, ${this.warmSessions.size} warm)`,
      );
    }
    for (const [conversationId, config] of [...this.conversations]) {
      // An in-flight turn is never idle, whatever the timestamp says.
      if (this.activeQueries.has(conversationId)) continue;
      const lastUsed = config.lastUsedAt ?? 0;
      if (lastUsed > cutoff) continue;
      if (this.verbose) {
        console.log(`[ClaudeAgentAdapter] evicting idle conversation ${conversationId}`);
      }
      this.cleanupConversation(conversationId);
    }
  }

  /**
   * Free the least recently used idle conversation so a new one can bind.
   *
   * Returns false when nothing could be freed — every remaining conversation
   * is mid-turn — so the caller stops looping instead of spinning. Exceeding
   * the cap is the right call there: refusing to bind would fail the user's
   * message to protect a memory ceiling.
   */
  private evictLruConversation(exceptConversationId?: string): boolean {
    let oldestId: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [conversationId, config] of this.conversations) {
      if (conversationId === exceptConversationId) continue;
      if (this.activeQueries.has(conversationId)) continue;
      const lastUsed = config.lastUsedAt ?? 0;
      if (lastUsed < oldestAt) {
        oldestAt = lastUsed;
        oldestId = conversationId;
      }
    }
    if (oldestId === undefined) return false;
    if (this.verbose) {
      console.log(`[ClaudeAgentAdapter] evicting LRU conversation ${oldestId} to stay under the live-session cap`);
    }
    this.cleanupConversation(oldestId);
    return true;
  }

  private cleanupConversation(conversationId: string): void {
    // A conversation deleted or swept before its first prompt still owns a
    // spawned CLI process if it was pre-warmed.
    this.discardWarmSession(conversationId, 'conversation cleaned up');
    const cleanups = this.conversationListenerCleanups.get(conversationId);
    if (cleanups) {
      for (const cleanup of cleanups) cleanup();
      this.conversationListenerCleanups.delete(conversationId);
    }
    this.conversationLeakWarned.delete(conversationId);
    this.conversationEventHandlers.delete(conversationId);
    // HITL-07 — release the in-flight permission-request tracker.
    this.permissionPending.delete(conversationId);

    // Abort any active query
    const aq = this.activeQueries.get(conversationId);
    if (aq) {
      aq.abortController.abort();
      aq.closeHandle?.();
      this.activeQueries.delete(conversationId);
    }

    // The persistent session owns the CLI process (~230 MB). Every caller of
    // this method — idle sweep, LRU cap, deleteConversation, destroyConversation
    // — used to drop the bookkeeping above and leave that process running for
    // the life of the server, because `closeSession` was only reachable from
    // stop(), an active turn's close handle, an unacknowledged interrupt and an
    // options change. Measured: eight ~230 MB `claude.exe` children alive 80
    // minutes after spawn with a 30-minute idle window. Close it here so the
    // bound on `conversations` is also a bound on processes.
    const live = this.sessions.get(conversationId);
    if (live) {
      void this.closeSession(live, 'conversation cleaned up');
    }

    this.conversations.delete(conversationId);
    this.conversationMessages.delete(conversationId);
    this.conversationWarnings.delete(conversationId);
    this.conversationAgents.delete(conversationId);
    this.contextProbes.delete(conversationId);
    activeSessions.add(-1);
  }
}

