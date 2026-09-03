// ────────────────────────────────────────────────────────────────
// ClaudeAgentProvider — IAgentHarness implementation wrapping
// the Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
//
// Key difference from CopilotAdapter: the Claude Agent SDK uses a
// per-query subprocess model (not a persistent client). Each
// query() call spawns a Claude Code process, runs the agent loop
// autonomously, and returns results via async iterator.
//
// This adapter bridges:
//   SDK async iterators  →  ICopilotPort callback events
//   SDK per-query model  →  ICopilotPort session lifecycle
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
  SDKControlGetContextUsageResponse as ClaudeContextUsageResponse,
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
} from '@generatorai/core';
import type { HookBridge } from '@generatorai/core';
import type { AgentEvent, AgentEventKind } from '@generatorai/shared';
import { HarnessSessionError, withSpan, getMeter, createAgentEvent } from '@generatorai/shared';
import { lastIterationUsage, mapClaudeAgentMessageToAgentEvents } from './event-mapper.js';
// W41 — `./tool-factory.js` value-imports `createSdkMcpServer` from the Claude
// SDK (and `zod`), so importing it statically here would defeat the lazy load
// above. It is imported dynamically at its single call site in
// `createConversation`. `ToolSemaphore` comes from its own SDK-free module
// (tool-factory only re-exports it) so it can stay static.
import { ToolSemaphore, MAX_PARALLEL_TOOLS } from '../../toolSemaphore.js';
import { mapClaudeToolNameToDomainType } from './permission-map.js';
import type { AgentHostSupervisor } from '../../AgentHostSupervisor.js';
import { existsSync } from 'node:fs';
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
import { buildHarnessEnv } from '../../childEnv.js';

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
function mapClaudeModelInfo(m: ClaudeModelInfo): HarnessModel {
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
      model.defaultReasoningEffort = m.supportedEffortLevels.includes('medium')
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
  private conversationEventHandlers = new Map<string, Set<(event: AgentEvent) => void>>();
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

  /**
   * W12 / P0-14 — optional supervisor gating concurrent turns.
   * When set, each `sendPromptAndWait` acquires one execution slot before
   * spawning a `query()`, preventing unbounded concurrent process launches.
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
   * `acp-entry.ts` and `StageExecutionService`, both of which currently rely
   * solely on `canUseTool` and are therefore ungated.
   *
   * Left `undefined` deliberately: see `DEFER` in `preToolUseHandler` for why
   * the no-policy default cannot be "deny", and `capabilities()` for why the
   * ledger reports `fullToolGating: false` until this is set.
   */
  private defaultToolGate: PreToolUseGate | undefined;

  /**
   * W35 — install (or clear) the provider-level default tool gate.
   *
   * Setting this flips `capabilities().fullToolGating` to `true`, because it
   * is then true: every conversation, hooks or no hooks, is evaluated by a
   * fail-closed `PreToolUse` policy. Callers that do NOT set it get an honest
   * `false` rather than the unconditional `true` this provider used to claim.
   *
   * Takes effect on the NEXT turn of every conversation — options are rebuilt
   * per `sendPrompt`, so already-open conversations are covered too.
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
    if (this.verbose) {
      console.log(`[ClaudeAgentAdapter] CLI: ${this.cliPath ?? '(SDK bundled)'}`);
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
      if (this.verbose) console.log('[ClaudeAgentAdapter] Initialized (stateless per-query model)');
    });
  }

  async stop(): Promise<void> {
    return withSpan('claude-agent-bridge', 'claude_agent.stop', async () => {
      // Abort all active queries
      for (const [, aq] of this.activeQueries) {
        aq.abortController.abort();
        aq.closeHandle?.();
        aq.status = 'aborted';
      }
      this.activeQueries.clear();
      this.clientState = 'stopped';
      this.emitClientEvent({ type: 'client.stopped' });
    });
  }

  async forceStop(): Promise<void> {
    for (const [, aq] of this.activeQueries) {
      aq.abortController.abort();
      aq.closeHandle?.();
      aq.status = 'aborted';
    }
    this.activeQueries.clear();
    this.clientState = 'stopped';
    this.emitClientEvent({ type: 'client.stopped', data: { message: 'Force stopped' } });
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
    // Claude Agent SDK is stateless — we can't ping. Return true if initialized.
    return this.clientState === 'running';
  }

  async shutdown(): Promise<void> {
    await this.stop();
    this.conversations.clear();
    this.conversationMessages.clear();
    this.conversationEventHandlers.clear();
    this.conversationListenerCleanups.clear();
    this.clientEventHandlers.clear();
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
   * W35 — `fullToolGating` is NO LONGER an unconditional `true`.
   *
   * It used to be, on the strength of a comment asserting "the PreToolUse hook
   * fires on EVERY tool call". The hook did fire on every tool call — of the
   * conversations that supplied a `HookBridge` with an `onPreToolUse`. Two
   * production callers supply none (`apps/server/src/acp-entry.ts`, and
   * `StageExecutionService`, which passes `onPermissionRequest` but no
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
   *   2. This flag reports whether a POLICY is actually attached. Provider-wide
   *      that means `setDefaultToolGate()` has been called; per conversation,
   *      ask `conversationCapabilities()`, which also counts a conversation's
   *      own `hooks.onPreToolUse`.
   */
  capabilities(): ProviderCapabilities {
    return {
      vision: true,
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      maxParallelTools: MAX_PARALLEL_TOOLS > 0 ? MAX_PARALLEL_TOOLS : undefined,
      planMode: true,
      mcpServers: true,
      skillDirectories: true,
      // W35 / N-5 — true only when a policy is genuinely attached to every
      // conversation. The hook itself is always installed; a hook with no
      // policy behind it defers to the SDK's own permission evaluation and
      // must not be advertised as a gate.
      fullToolGating: this.hasDefaultToolGate(),
      sessionPersistence: true,
      budgetTracking: true,
      maxContextTokens: 200_000,
      // MINOR-4 fix: computerUse must be explicitly declared (L9 fail-closed).
      // Claude supports the native computer_use tool via its SDK.
      computerUse: true,
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
  conversationCapabilities(conversationId: string): ProviderCapabilities {
    const bridge = this.conversations.get(conversationId)?.hooks as HookBridge | undefined;
    return {
      ...this.capabilities(),
      fullToolGating: !!bridge?.onPreToolUse || this.hasDefaultToolGate(),
    };
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
  private modelCache: { models: HarnessModel[]; at: number } | null = null;
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

  /** Record limits seen in a `result` message so the catalog can self-correct. */
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
      // The catalog is now stale — let the next getModels() re-derive limits.
      this.modelCache = null;
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
    const cached = this.modelCache;
    if (cached && Date.now() - cached.at < ClaudeAgentProvider.MODEL_CACHE_TTL_MS) {
      return cached.models;
    }
    // Coalesce concurrent probes — several UI surfaces can ask at once and a
    // cold probe is slow enough that they would otherwise stack up.
    if (this.modelProbeInFlight) return this.modelProbeInFlight;

    this.modelProbeInFlight = this.withControlSession(async (q) => {
      const sdkModels = await q.supportedModels();
      return sdkModels.map((m) =>
        this.applyObservedLimits(
          mapClaudeModelInfo(m),
          (m as unknown as { resolvedModel?: string }).resolvedModel,
        ),
      );
    })
      .then((models) => {
        this.modelCache = { models, at: Date.now() };
        return models;
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
      const previous = this.conversations.get(params.conversationId);
      const nextModel = params.model ?? this.options.defaultModel;
      const modelChanged = !!previous && previous.model !== nextModel;
      const resumeSessionId = previous
        ? modelChanged
          ? undefined
          : previous.sdkSessionId
        : params.resumeProviderSessionId;
      const config: StoredConversationConfig = {
        conversationId: params.conversationId,
        model: nextModel,
        systemPrompt,
        workingDirectory: params.workingDirectory ?? this.options.defaultCwd,
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
        ...(params.defaultAgent && params.agentProjection === 'native' && agents[params.defaultAgent]
          ? { agent: params.defaultAgent }
          : {}),
        ...(params.hooks ? { hooks: params.hooks } : {}),
        env: this.options.env,
        // HITL-06 (Claude parity) — persist the domain permission callback
        // so `buildQueryOptions` can wire it into the SDK's `canUseTool`.
        onPermissionRequest: params.onPermissionRequest,
        // PLN-01 — plan-mode gates, demultiplexed out of `canUseTool`.
        onPlanReviewRequest: params.onPlanReviewRequest,
        onQuestionRequest: params.onQuestionRequest,
        planModeInstructions: params.planModeInstructions,
        ...(resumeSessionId ? { sdkSessionId: resumeSessionId } : {}),
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
    this.conversations.set(conversationId, {
      conversationId,
      model: this.options.defaultModel,
      workingDirectory: this.options.defaultCwd,
      permissionMode: this.options.defaultPermissionMode ?? 'bypassPermissions',
      sdkSessionId: conversationId,
    });

    if (this.verbose) console.log(`[ClaudeAgentAdapter] Resumed conversation ${conversationId} (minimal, no tools)`);
  }

  /** Whether the conversation is live in memory (tool handlers registered). */
  hasLiveConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId);
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

  async sendPrompt(
    conversationId: string,
    prompt: string,
    _attachments?: AttachmentRef[],
    turnOptions?: SendPromptOptions,
  ): Promise<void> {
    const start = Date.now();
    return withSpan('claude-agent-bridge', 'claude_agent.sendPrompt', async (span) => {
      span.setAttribute('claude_agent.conversation_id', conversationId);
      span.setAttribute('claude_agent.prompt.length', prompt.length);
      promptCounter.add(1, { conversation_id: conversationId });

      const config = this.getConversationConfig(conversationId);

      // Emit user_message event
      this.emitToHandlers(conversationId, 'harness.user_message', { content: prompt });

      // Store user message
      this.pushMessage(conversationId, { role: 'user', content: prompt, timestamp: new Date() });

      // Build query options
      const options = this.buildQueryOptions(config, turnOptions);

      // PLN-01 — arm the plan phase for this turn.
      this.beginPlanTurn(conversationId, turnOptions);

      // Fire and forget — run query in background
      const abortController = new AbortController();
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

      // Start the query iterator in the background
      this.runQueryInBackground(conversationId, prompt, options, activeQuery, start).catch((err) => {
        if (this.verbose) console.error(`[ClaudeAgentAdapter] Background query error for ${conversationId}:`, err);
      });
    });
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    _attachments?: AttachmentRef[],
    signal?: AbortSignal,
    turnOptions?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const start = Date.now();
    return withSpan('claude-agent-bridge', 'claude_agent.sendPromptAndWait', async (span) => {
      span.setAttribute('claude_agent.conversation_id', conversationId);
      span.setAttribute('claude_agent.prompt.length', prompt.length);
      promptCounter.add(1, { conversation_id: conversationId });

      const config = this.getConversationConfig(conversationId);

      // Emit user_message event
      this.emitToHandlers(conversationId, 'harness.user_message', { content: prompt });

      // Store user message
      this.pushMessage(conversationId, { role: 'user', content: prompt, timestamp: new Date() });

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
      // spawning the query() process. This caps concurrent CLI spawns to
      // `maxConcurrentExecutions` (default 16). When the semaphore is full,
      // new turns queue here rather than spawning unboundedly.
      let releaseExecution: (() => void) | undefined;
      if (this.supervisor) {
        releaseExecution = await this.supervisor.acquireExecution();
        this.supervisor.registerInstance(conversationId, conversationId);
        this.supervisor.markInUse(conversationId);
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

        for await (const message of queryHandle) {
          // Idle-watchdog: every SDK message resets the inactivity clock,
          // so an actively-streaming agent won't be killed no matter how
          // long the total run takes.
          lastActivityMs = Date.now();
          // Map to domain events and emit to handlers
          const events = mapClaudeAgentMessageToAgentEvents(message);
          for (const event of events) {
            this.emitEventToHandlers(conversationId, event);
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
            }
            this.recordObservedLimits(message);
            this.emitContextUsageSnapshot(conversationId, message);
          }
        }

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
          /* W13-B1 */ this.emitToHandlers(conversationId, 'harness.tool_complete', {
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
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        if (timeoutHandle) clearInterval(timeoutHandle);
        // W12 / P0-14 — release the execution slot so the next queued turn can start.
        if (releaseExecution) {
          this.supervisor?.markIdle(conversationId);
          releaseExecution();
        }
      }
    });
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    // Return locally accumulated messages
    return this.conversationMessages.get(conversationId) ?? [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    const aq = this.activeQueries.get(conversationId);
    if (aq) {
      aq.abortController.abort();
      aq.closeHandle?.();
      aq.status = 'aborted';
      this.activeQueries.delete(conversationId);

      // W13 / X-4 — emit a semantic 'cancelled' outcome, NOT an error.
      //
      // A user pressing Stop is NOT an error. The old 'harness.error' event
      // caused a red error toast in the UI. 'harness.cancelled' is a
      // success-valued terminal event: downstream state machines treat it as
      // a clean stop (pending approvals settle, the run records 'cancelled'
      // rather than 'failed', and the UI renders a neutral "Stopped" badge).
      this.emitToHandlers(conversationId, 'harness.cancelled', {
        reason: 'user_abort',
        provider: 'claude-agent',
      });
      this.emitEventToHandlers(conversationId, createAgentEvent('harness.idle', {} as Record<string, never>));
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Event Subscription
  // ══════════════════════════════════════════════════════════════

  onConversationEvent(
    conversationId: string,
    handler: (event: AgentEvent) => void,
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
   * `fullToolGating: false` while it is the operative policy.
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
  private buildConversationHooks(config: StoredConversationConfig): ClaudeOptions['hooks'] {
    const bridge = (config.hooks as HookBridge | undefined) ?? {};
    const hooks = { ...(this.buildClaudeHooks(bridge) as unknown as Record<string, unknown[]>) };
    if (!hooks['PreToolUse']) {
      hooks['PreToolUse'] = wrapClaudeHook(this.preToolUseHandler(this.defaultToolGate));
    }
    // Pin SDK subagents to the foreground — always installed, alongside the
    // policy gate (a deny from the gate still wins; this only rewrites input).
    //
    // The SDK's `Agent` tool runs subagents in the background BY DEFAULT
    // (`run_in_background` defaults to true). This provider spawns one CLI
    // process per turn and that process exits when the turn's `result`
    // arrives, so a "background" subagent silently evaporates: observed live
    // (2026-09-01) as "Async agent launched successfully" followed by a turn
    // that ended with the model promising results that could never come.
    // Foreground subagents block the turn until they finish, which is the
    // only semantics a per-turn process can honour. (Platform-level
    // background work goes through spawn_background_agent instead, which
    // outlives the process by design.)
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
   */  private buildQueryOptions(
    config: StoredConversationConfig,
    turnOptions?: SendPromptOptions,
  ): ClaudeOptions {
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
      effort: config.effort ?? this.options.defaultEffort ?? 'high',
      maxTurns: config.maxTurns ?? this.options.defaultMaxTurns,
      maxBudgetUsd: config.maxBudgetUsd ?? this.options.defaultMaxBudgetUsd,
      includePartialMessages: this.options.includePartialMessages ?? true,
      includeHookEvents: this.options.includeHookEvents ?? false,
      // See comment above — domain handler forces 'default' + no skip.
      permissionMode: effectivePermissionMode as ClaudeOptions['permissionMode'],
      allowDangerouslySkipPermissions: !hasDomainHandler && effectivePermissionMode === 'bypassPermissions',
      // Session management
      persistSession: true,
      settingSources: this.options.settingSources ?? [],
      enableFileCheckpointing: this.options.enableFileCheckpointing ?? false,
    };

    // PLN-01 — Claude-native custom plan-mode workflow body. Only meaningful
    // while `permissionMode: 'plan'`; the CLI still wraps it with the
    // read-only enforcement preamble and the ExitPlanMode protocol footer.
    if (effectivePermissionMode === 'plan' && config.planModeInstructions) {
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

    // Main-thread agent. Replaces the base system prompt, so callers opt in
    // explicitly (`agentProjection: 'native'`).
    if (config.agent) {
      options.agent = config.agent;
    }

    // HKS-01 — synchronous hook bridge, previously Copilot-only.
    //
    // W35: UNCONDITIONAL. This used to be `if (config.hooks)`, so a caller that
    // passed no hooks got no `PreToolUse` hook and therefore no tool gate,
    // while `capabilities()` claimed `fullToolGating: true` regardless.
    // `buildConversationHooks` always installs the gate; see there for the
    // no-policy default and `capabilities()` for the (now honest) ledger.
    options.hooks = this.buildConversationHooks(config);

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
              this.emitToHandlers(capturedConvId, 'harness.error', {
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
    { inFlight: boolean; latest: ClaudeContextUsageResponse | null }
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
  private emitContextUsageSnapshot(conversationId: string, resultMessage: unknown): void {
    try {
      const usage = this.contextProbes.get(conversationId)?.latest;
      if (!usage || typeof usage.totalTokens !== 'number') return;
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

      this.emitEventToHandlers(conversationId, createAgentEvent('harness.context_usage', {
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
  private async runQueryInBackground(
    conversationId: string,
    prompt: string,
    options: ClaudeOptions,
    activeQuery: ActiveQuery,
    startTime: number,
  ): Promise<void> {
    try {
      if (this.verbose) console.log(`[ClaudeAgentAdapter] Starting background query for ${conversationId}`);

      const { query: claudeQuery } = await loadClaudeSdk(); // W41
      const queryHandle = claudeQuery({ prompt, options });
      activeQuery.closeHandle = () => queryHandle.close();

      let fullContent = '';
      const pendingToolNames: string[] = []; // W13-B1: track tool calls for truncation guard
      let truncationStopReason: string | undefined; // W13-B1

      for await (const message of queryHandle) {
        // Map to domain events and emit
        const events = mapClaudeAgentMessageToAgentEvents(message);
        for (const event of events) {
          this.emitEventToHandlers(conversationId, event);
        }

        // Accumulate assistant content for getMessages()
        if (message.type === 'assistant') {
          // See `beginContextUsageProbe` — sampled mid-turn, never awaited.
          this.beginContextUsageProbe(conversationId, queryHandle);
          const betaMsg = message.message;
          if (betaMsg?.content) {
            for (const block of betaMsg.content) {
              if (block.type === 'text') {
                fullContent += block.text;
                // PLN-01 — in plan mode the model writes the plan as its
                // message right before calling ExitPlanMode, and the SDK's
                // ExitPlanModeInput has no contractual `plan` field. Keep the
                // running text so the gate has a reliable fallback source.
                const phase = this.planPhases.get(conversationId);
                if (phase && phase.phase === 'planning') {
                  phase.planText += block.text;
                }
              } else if (block.type === 'tool_use') {
                // W13-B1: track tool calls so we can fail them on truncation.
                /* W13-B1 */ pendingToolNames.push(block.name);
              }
            }
          }
          // W13-B1: detect truncation stop reason.
          /* W13-B1 */ if (betaMsg?.stop_reason && isTruncationStopReason(String(betaMsg.stop_reason))) {
            truncationStopReason = String(betaMsg.stop_reason);
            this.toolSemaphore.markTruncated(conversationId, truncationStopReason);
          }
        } else if (message.type === 'result') {
          // Store SDK session ID for resume
          const config = this.conversations.get(conversationId);
          if (config) {
            config.sdkSessionId = message.session_id;
          }
          if (message.subtype === 'success' && !fullContent && message.result) {
            fullContent = message.result;
          }
          // Learn the account's real per-model limits, then publish the
          // CLI's authoritative breakdown alongside the derived estimate.
          this.recordObservedLimits(message);
          this.emitContextUsageSnapshot(conversationId, message);
        }
      }

      // W13-B1: Fail all tool calls when the response was truncated.
      /* W13-B1 */ if (truncationStopReason && pendingToolNames.length > 0) {
        const truncMsg =
          `Response was truncated (stop_reason: ${truncationStopReason}). ` +
          `All ${pendingToolNames.length} tool call(s) in this batch are cancelled — ` +
          `please re-issue your request with a shorter response or fewer tools.`;
        console.warn(`[ClaudeAgentAdapter] Truncation detected (background) for ${conversationId}: ${truncMsg}`);
        for (const toolName of pendingToolNames) {
          /* W13-B1 */ this.emitToHandlers(conversationId, 'harness.tool_complete', {
            tool: toolName,
            result: { error: truncMsg, truncated: true },
            success: false,
          });
        }
      }

      // Store the accumulated assistant response
      if (fullContent) {
        this.pushMessage(conversationId, { role: 'assistant', content: fullContent, timestamp: new Date() });
      }

      activeQuery.status = 'completed';
      this.querySuccessCount++;
      this.consecutiveFailCount = 0;
      promptDuration.record(Date.now() - startTime, { conversation_id: conversationId });

      if (this.verbose) console.log(`[ClaudeAgentAdapter] Background query completed for ${conversationId}`);
    } catch (err) {
      activeQuery.status = 'failed';
      this.queryFailCount++;
      this.consecutiveFailCount++;

      // Emit error event — always log regardless of verbose
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ClaudeAgentAdapter] Background query failed for ${conversationId}: ${errorMsg}`);

      const errorEvent = createAgentEvent('harness.error', {
        message: errorMsg,
        provider: 'claude-agent',
      });
      this.emitEventToHandlers(conversationId, errorEvent);
    } finally {
      this.activeQueries.delete(conversationId);
      // PLN-01 — the plan phase is per-turn; never leak it into the next turn.
      this.planPhases.delete(conversationId);
    }
  }

  private emitEventToHandlers(conversationId: string, event: AgentEvent): void {
    const handlers = this.conversationEventHandlers.get(conversationId);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          if (this.verbose) console.error(`[ClaudeAgentAdapter] Event handler error:`, err);
        }
      }
    }
  }

  private emitToHandlers(conversationId: string, kind: AgentEventKind, data: unknown): void {
    const event = createAgentEvent(kind, data as never);
    this.emitEventToHandlers(conversationId, event);
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
  }

  private cleanupConversation(conversationId: string): void {
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

    this.conversations.delete(conversationId);
    this.conversationMessages.delete(conversationId);
    this.conversationWarnings.delete(conversationId);
    this.conversationAgents.delete(conversationId);
    this.contextProbes.delete(conversationId);
    activeSessions.add(-1);
  }
}

