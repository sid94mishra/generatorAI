// ────────────────────────────────────────────────────────────────
// CodexProvider — IAgentHarness wrapping `codex app-server` (JSON-RPC).
//
// W37 — Codex provider. Speaks newline-delimited JSON-RPC 2.0 over the stdio
// of a long-lived `codex app-server` child process.
//
// ── Protocol provenance ──────────────────────────────────────────
// Every method name, notification name and payload type used here comes from
// `protocol/codex.generated.ts`, which is emitted by `pnpm generate:schemas`
// from `schemas/codex/codex_app_server_protocol.schemas.json` — the artifact
// `codex app-server generate-json-schema` produces from the pinned
// `@openai/codex` binary. `CODEX_METHODS` in that file is derived from the
// artifact's own request/notification unions, so a method renamed upstream
// changes the generated table and fails CI's `git diff` rather than surfacing
// as a runtime "unknown method".
//
// This replaces a hand-invented vocabulary (`session.create`, `turn`,
// `turn.steer { signal: 'cancel' }`, a `-32001` rate-limit code) that the real
// app-server has never spoken. The differences were not cosmetic:
//
//   • Threads, not sessions. `thread/start` → `thread.id`; `thread/resume`
//     rejoins one. There is no `session.create`.
//   • `turn/steer` INJECTS INPUT into a running turn. Sending it to cancel —
//     as the previous code did — would have appended a message rather than
//     stopping anything. Cancellation is `turn/interrupt`.
//   • Notifications carry `turnId` as well as `threadId`, so a late terminal
//     event from an abandoned turn is identified by its id instead of being
//     guessed at with a timed drain. The old `cancelDrainMs` window is gone.
//   • The server sends REQUESTS to the client (approvals, elicitations,
//     dynamic tool calls) and blocks the turn until one is answered. The
//     previous provider never replied to any of them, so any turn that asked
//     for approval hung until the RPC deadline. Every server request is now
//     answered, fail-closed by default.
//   • Rate limiting arrives as `codexErrorInfo: "rateLimitExceeded"` (or
//     `usageLimitExceeded` / `serverOverloaded`) on an error notification,
//     never as JSON-RPC code -32001, so the old backoff was unreachable.
//
// Architecture laws honoured:
//   L9:  capabilities() declared, never probed.
//   L17: ProviderInstanceId routing via MultiHarness — this class is stateless
//        per provider type; routing is the registry's concern.
//   L18: protocol types generated from a pinned upstream artifact.
//   W13: truncation guard — a context-window stop fails pending tool calls.
//   W13: semantic cancellation — abort emits `harness.cancelled`, not throws.
//   W13: rate limiting triggers exponential backoff with jitter.
// ────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type {
  IAgentHarness,
  CreateConversationParams,
  ForkConversationOptions,
  ForkConversationResult,
  RewindConversationOptions,
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
  McpServerConfig,
  PermissionRequest,
} from '@generatorai/core';
import type { AgentEvent, AgentQuestion } from '@generatorai/shared';
import { HarnessSessionError } from '@generatorai/shared';
import { buildHarnessEnv } from '../../childEnv.js';
import type { CodexProviderOptions } from '../../types.js';
import type {
  JSONRPCErrorError,
  V2AskForApproval,
  V2CodexErrorInfo,
  V2ErrorNotification,
  V2ItemCompletedNotification,
  V2ItemStartedNotification,
  V2AgentMessageDeltaNotification,
  V2FileUpdateChange,
  V2GetAccountResponse,
  V2Model,
  V2ModelListResponse,
  V2ReasoningSummaryTextDeltaNotification,
  V2ReasoningTextDeltaNotification,
  V2ThreadTokenUsageUpdatedNotification,
  V2TurnStartedNotification,
  V2SandboxMode,
  V2SandboxPolicy,
  V2ThreadItemsListResponse,
  V2ThreadResumeResponse,
  V2AccountRateLimitsUpdatedNotification,
  V2CommandExecutionOutputDeltaNotification,
  V2ConfigWarningNotification,
  V2ContextCompactedNotification,
  V2DeprecationNoticeNotification,
  V2FileChangeOutputDeltaNotification,
  V2FileChangePatchUpdatedNotification,
  V2GetAccountRateLimitsResponse,
  V2GuardianWarningNotification,
  V2ListMcpServerStatusResponse,
  V2McpToolCallProgressNotification,
  V2ModelReroutedNotification,
  V2PlanDeltaNotification,
  V2FileSystemAccessMode,
  V2FileSystemPath,
  V2RateLimitSnapshot,
  V2ReasoningSummaryPartAddedNotification,
  V2RequestPermissionProfile,
  V2ThreadClosedNotification,
  V2ThreadStatusChangedNotification,
  V2TurnDiffUpdatedNotification,
  V2TurnPlanStep,
  V2TurnPlanUpdatedNotification,
  V2WarningNotification,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
  PermissionsRequestApprovalParams,
  CommandExecutionApprovalDecision,
  FileChangeApprovalDecision,
  V2ThreadForkParams,
  V2ThreadForkResponse,
  V2ThreadRevertParams,
  V2ThreadRollbackParams,
  V2ThreadStartParams,
  V2ThreadStartResponse,
  V2ThreadItem,
  V2Turn,
  V2TurnCompletedNotification,
  V2TurnError,
  V2TurnStartParams,
  V2TurnStartResponse,
  V2UserInput,
} from '../../protocol/codex.generated.js';

// ── Type aliases for clarity ─────────────────────────────────────

type Listener<T> = (event: T) => void;
type UnsubFn = () => void;

/** A JSON-RPC message read off the child's stdout, before discrimination. */
interface IncomingMessage {
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JSONRPCErrorError;
}

interface ConversationState {
  /** The Codex thread id (`thread/start` → `thread.id`). */
  threadId: string;
  params: CreateConversationParams;
  /**
   * Per-turn sandbox override carrying the chat's extra writable roots.
   *
   * `V2ThreadStartParams` has no sandbox-policy field — only `sandbox`, a
   * `V2SandboxMode` enum — so the roots cannot be attached to the thread.
   * `V2TurnStartParams.sandboxPolicy` ("Override the sandbox policy for this
   * turn and subsequent turns") is the only place the pinned protocol accepts
   * `writableRoots`, so it is sent with every turn. Undefined when the caller
   * asked for no extra directories, or when the sandbox is not
   * `workspace-write` (a read-only or full-access sandbox has no notion of an
   * extra writable root).
   */
  sandboxPolicy?: V2SandboxPolicy;
  listeners: Set<Listener<AgentEvent>>;
  warnings: ConversationWarning[];
  inFlight: boolean;
  /**
   * Id of the turn currently being awaited, once `turn/start` has answered.
   *
   * This is what makes the old timed "drain" unnecessary: every turn
   * notification carries the turn it belongs to, so a terminal event owed by a
   * turn the user cancelled is recognised by its id and dropped, rather than
   * being raced against a 2-second window and possibly ending the NEXT turn
   * with empty content.
   */
  activeTurnId: string | null;
  /**
   * Settles the turn currently being awaited inside `sendPromptAndWait`.
   *
   * Without this, `abortConversation()` could emit `harness.cancelled` but had
   * no way to make the awaited promise settle — and `inFlight` is only cleared
   * in `sendPromptAndWait`'s `finally`, which needs that promise to settle. One
   * Stop therefore wedged the conversation permanently.
   */
  settleTurn: (() => void) | null;
  /**
   * Ends the awaited turn as a FAILURE (`harness.error` + `harness.idle`)
   * rather than a cancellation.
   *
   * `settleTurn` emits `harness.cancelled`, which is the right story for a
   * Stop and the wrong one for a thread that died under us: a thread that
   * reaches `systemError`, or is closed while a turn is in flight, will never
   * send another notification, so without this the turn sat until the RPC
   * deadline and then surfaced as a timeout with no explanation.
   */
  failTurn: ((message: string) => void) | null;
  /**
   * Set by `abortConversation()` / an aborted signal so a retry loop parked in
   * a rate-limit backoff does not start another attempt after the user stopped.
   */
  cancelRequested: boolean;
  /**
   * Turn ids this conversation is finished with.
   *
   * `activeTurnId` alone is not enough to attribute a notification, because it
   * is only known once `turn/start` has ANSWERED. A turn cancelled locally can
   * have its `turn/completed` arrive after the next turn's request has gone
   * out but before that turn's response has been read — a window in which
   * `activeTurnId` is null and the stale terminal event would end the new turn
   * immediately with empty content. Remembering retired ids closes it.
   *
   * Bounded: only the most recent ids matter, and a conversation can run for
   * thousands of turns.
   */
  retiredTurns: Set<string>;
  /**
   * Command items the current turn started. Codex keeps an interrupted
   * command running as a thread "background terminal", so Stop has to end
   * these explicitly — and only these: a terminal an earlier turn left running
   * on purpose (a dev server) must survive a Stop on a later turn.
   */
  turnCommandItems: Set<string>;
  /**
   * The paths each `fileChange` item touches, by item id. A v2 approval
   * request names only the item, so without this the card the user is asked to
   * Allow or Deny said "Apply file changes" and showed `{ "reason": null }` —
   * consent to an edit with no idea what was being edited.
   */
  fileChangePaths: Map<string, Array<{ path: string; kind?: string }>>;
  /** The last turn ran in the plan-mode read-only sandbox; see `sandboxPolicyForTurn`. */
  sandboxNarrowedForPlan?: boolean;
}

/** How many finished turn ids to remember per conversation. */
const RETIRED_TURN_MEMORY = 32;

// ── Errors ───────────────────────────────────────────────────────

/**
 * A JSON-RPC **error response** (`{ id, error: { code, message } }`).
 *
 * These used to be `resolve`d as if they were successes, which is how a failed
 * thread start silently degraded into "use the caller's own id" and handed back
 * a thread the binary had never heard of.
 */
export class CodexRpcError extends Error {
  constructor(readonly code: number, message: string, readonly data?: unknown) {
    super(`Codex JSON-RPC error ${code}: ${message}`);
    this.name = 'CodexRpcError';
  }
}

/**
 * A turn that failed with backpressure, carrying the upstream classification.
 *
 * Distinct from `CodexRpcError` because rate limiting is reported on an `error`
 * NOTIFICATION mid-turn (`codexErrorInfo`), not as an error response to the
 * request that started the turn.
 */
export class CodexRateLimitedError extends Error {
  constructor(readonly info: V2CodexErrorInfo, message: string) {
    super(message);
    this.name = 'CodexRateLimitedError';
  }
}

/**
 * Upstream error classifications that mean "try again later" rather than "this
 * turn is broken". Read off `TurnError.codexErrorInfo`.
 */
const RETRYABLE_ERROR_INFO: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'usageLimitExceeded',
  'serverOverloaded',
]);

/**
 * Upstream classifications meaning the model ran out of room. Treated the way
 * a `stop_reason: length` is: every tool call still open in the batch is failed
 * so the model cannot believe work happened that did not (W13/B1).
 */
const TRUNCATION_ERROR_INFO: ReadonlySet<string> = new Set(['contextWindowExceeded']);

/** `V2CodexErrorInfo` is a union of bare strings and single-key objects. */
function errorInfoTag(info: V2CodexErrorInfo | null | undefined): string | null {
  if (typeof info === 'string') return info;
  if (info && typeof info === 'object') {
    const keys = Object.keys(info);
    return keys[0] ?? null;
  }
  return null;
}

function isRetryable(err: unknown): err is CodexRateLimitedError {
  return err instanceof CodexRateLimitedError;
}

// ── Utility helpers ──────────────────────────────────────────────

function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4); // ±20% jitter
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thread items that represent a tool the model invoked. */
const TOOL_ITEM_TYPES: ReadonlySet<string> = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'webSearch',
  // Codex's multi-agent feature. A collab call (spawnAgent, sendInput,
  // followupTask, …) IS a delegation, and mapping it as an ordinary tool call
  // named `Agent` is what makes a Codex multi-agent run render as sub-agent
  // steps in the same timeline as Claude's `Task` and the orchestrator's own
  // background workers. Unmapped, these items were silently dropped and a
  // Codex collab turn looked like the model doing nothing for minutes.
  'collabAgentToolCall',
]);

/** The tool name a `collabAgentToolCall` reports — `inferKind` reads it as a sub-agent. */
const COLLAB_TOOL_NAME = 'Agent';

/**
 * `subAgentActivity` → the provider-neutral sub-agent info type.
 *
 * Codex reports sub-agent lifecycle separately from the collab tool call, and
 * these are what let a sub-agent step spin and settle; `interacted` is
 * progress, not a state change, so it carries no started/completed meaning.
 */
function subAgentInfoType(kind: unknown): string | undefined {
  switch (kind) {
    case 'started': return 'subagent_started';
    case 'completed': return 'subagent_completed';
    case 'interrupted': return 'subagent_failed';
    case 'interacted': return 'subagent_progress';
    default: return undefined;
  }
}

/** A display name for a tool item, and its arguments where the item carries any. */
function describeToolItem(item: V2ThreadItem): { tool: string; args: unknown } {
  const anyItem = item as unknown as Record<string, unknown>;
  switch (item.type) {
    case 'commandExecution':
      return { tool: 'shell', args: { command: anyItem['command'], cwd: anyItem['cwd'] } };
    case 'fileChange':
      return { tool: 'apply_patch', args: { changes: anyItem['changes'] } };
    case 'mcpToolCall':
      return {
        tool: `${String(anyItem['server'] ?? 'mcp')}/${String(anyItem['tool'] ?? '')}`,
        args: anyItem['arguments'],
      };
    case 'dynamicToolCall':
      return { tool: String(anyItem['tool'] ?? 'tool'), args: anyItem['arguments'] };
    case 'collabAgentToolCall':
      return {
        tool: COLLAB_TOOL_NAME,
        args: {
          tool: anyItem['tool'],
          prompt: anyItem['prompt'],
          model: anyItem['model'],
          receiverThreadIds: anyItem['receiverThreadIds'],
        },
      };
    default:
      return { tool: item.type, args: anyItem };
  }
}

/**
 * Whether a completed tool item succeeded, and the text to report as its result.
 *
 * Each item type spells success differently — an exit code, a patch status, an
 * `error` object, a `success` boolean — so the mapping is explicit per type
 * rather than a hopeful `!item.error`.
 */
function summariseToolResult(item: V2ThreadItem): { success: boolean; result: string } {
  const anyItem = item as unknown as Record<string, unknown>;
  const asText = (v: unknown): string =>
    typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);

  switch (item.type) {
    case 'commandExecution': {
      const exitCode = anyItem['exitCode'];
      const status = anyItem['status'];
      const success = status === 'completed' && (exitCode == null || exitCode === 0);
      const output = asText(anyItem['aggregatedOutput']);
      // A failed command with nothing on stdout/stderr used to persist as an
      // empty result: the transcript then showed "Failed" with no reason. The
      // exit code (and a sandbox denial, which Codex reports as a non-zero
      // exit with no output) is the only signal there is — keep it.
      const suffix = success
        ? ''
        : status === 'completed' && typeof exitCode === 'number'
          ? `\n[exit code ${exitCode}]`
          : status && status !== 'completed'
            ? `\n[${String(status)}]`
            : '';
      return { success, result: `${output}${suffix}`.replace(/^\n/, '') };
    }
    case 'fileChange':
      return { success: anyItem['status'] === 'completed', result: asText(anyItem['changes']) };
    case 'mcpToolCall':
      return {
        success: anyItem['status'] === 'completed' && anyItem['error'] == null,
        result: asText(anyItem['error'] ?? anyItem['result']),
      };
    case 'dynamicToolCall':
      return {
        // `success` is the tool's own verdict; `status: completed` only means
        // the call finished, and a failed host tool finishes too.
        success: typeof anyItem['success'] === 'boolean' ? anyItem['success'] : anyItem['status'] === 'completed',
        result: asText(anyItem['contentItems']),
      };
    case 'collabAgentToolCall':
      // `V2CollabAgentToolCallStatus` is inProgress | completed | failed |
      // interrupted; only `completed` is a success.
      return {
        success: anyItem['status'] === 'completed',
        result: asText(anyItem['agentsStates'] ?? anyItem['status']),
      };
    default:
      return { success: true, result: asText(anyItem) };
  }
}

/**
 * Per-operation +/− stats for a `fileChange` item that touched exactly one
 * file, in the same shape the Claude adapter attaches to `tool_complete`, so a
 * Codex edit renders the same chips in the transcript. Multi-file patches carry
 * no single `fileOp`; the Changes pane shows those from git.
 */
function fileOpForChange(item: V2ThreadItem): { kind: 'create' | 'edit' | 'delete'; filePath: string; additions: number; deletions: number } | undefined {
  if (item.type !== 'fileChange') return undefined;
  const changes = (item as unknown as { changes?: V2FileUpdateChange[] }).changes ?? [];
  if (changes.length !== 1) return undefined;
  const [change] = changes as [V2FileUpdateChange];
  let additions = 0;
  let deletions = 0;
  for (const line of (change.diff ?? '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  const kind = change.kind?.type === 'add' ? 'create' : change.kind?.type === 'delete' ? 'delete' : 'edit';
  // An added file's diff is often the raw content rather than a hunk.
  if (kind === 'create' && additions === 0 && change.diff) additions = change.diff.split('\n').filter(Boolean).length;
  return { kind, filePath: change.path, additions, deletions };
}

/**
 * Translate our MCP server definitions into Codex's `mcp_servers` config table
 * (the same keys `~/.codex/config.toml` takes), sent per thread via
 * `thread/start`'s `config` overrides. Legacy SSE servers have no Codex
 * transport and are reported rather than silently dropped.
 */
function toCodexMcpServers(
  servers: Record<string, McpServerConfig> | undefined,
  warnings: ConversationWarning[],
): Record<string, Record<string, unknown>> | undefined {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(servers ?? {})) {
    if (server.enabled === false) continue;
    const common: Record<string, unknown> = {
      ...(server.tools?.length ? { enabled_tools: server.tools } : {}),
      ...(server.timeoutMs ? { tool_timeout_sec: Math.ceil(server.timeoutMs / 1000) } : {}),
    };
    if (server.type === 'stdio' && server.command) {
      out[name] = {
        command: server.command,
        ...(server.args?.length ? { args: server.args } : {}),
        ...(server.env && Object.keys(server.env).length ? { env: server.env } : {}),
        ...(server.cwd ? { cwd: server.cwd } : {}),
        ...common,
      };
    } else if (server.type === 'http' && server.url) {
      out[name] = {
        url: server.url,
        ...(server.headers && Object.keys(server.headers).length ? { http_headers: server.headers } : {}),
        ...common,
      };
    } else {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: `mcpServers.${name}`, provider: 'codex', reason: `transport "${server.type}" is not supported by Codex` },
      });
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * One line of English for a requested permission profile, so the approval card
 * can say what is actually being asked for instead of showing a method name.
 */
function describePermissionProfile(profile: V2RequestPermissionProfile | undefined): string {
  /** `V2FileSystemPath` is a union — a literal path, a glob, or a named root. */
  const pathLabel = (p: V2FileSystemPath): string => {
    switch (p.type) {
      case 'path': return p.path;
      case 'glob_pattern': return p.pattern;
      default: return p.value.kind;
    }
  };
  const parts: string[] = [];
  const fs = profile?.fileSystem;
  if (fs) {
    const byAccess = (want: V2FileSystemAccessMode): string[] =>
      (fs.entries ?? []).filter((e) => e.access === want).map((e) => pathLabel(e.path));
    // `read` / `write` are the fields upstream is replacing with `entries`;
    // both are read so a server on either side of that migration is described.
    const reads = [...(fs.read ?? []), ...byAccess('read')].filter(Boolean);
    const writes = [...(fs.write ?? []), ...byAccess('write')].filter(Boolean);
    if (reads.length) parts.push(`read ${reads.join(', ')}`);
    if (writes.length) parts.push(`write ${writes.join(', ')}`);
  }
  if (profile?.network?.enabled) parts.push('network access');
  return parts.length ? parts.join('; ') : 'unspecified additional access';
}

function rememberFileChange(conv: ConversationState, itemId: string | undefined, changes: unknown): void {
  if (!itemId || !Array.isArray(changes)) return;
  const entries = changes
    .map((c) => c as { path?: unknown; kind?: unknown })
    .filter((c) => typeof c.path === 'string' && c.path)
    .map((c) => ({
      path: c.path as string,
      ...(typeof c.kind === 'string'
        ? { kind: c.kind }
        : c.kind && typeof (c.kind as { type?: unknown }).type === 'string'
          ? { kind: (c.kind as { type: string }).type }
          : {}),
    }));
  if (entries.length) conv.fileChangePaths.set(itemId, entries);
}

/** A file-change approval carries only an item id; put the files back on it. */
function withFileChangePaths(conv: ConversationState | undefined, method: string, params: unknown): unknown {
  if (method !== 'item/fileChange/requestApproval' || !conv) return params;
  const p = (params ?? {}) as Record<string, unknown>;
  if (p['changes'] || p['fileChanges']) return params;
  const known = conv.fileChangePaths.get(String(p['itemId'] ?? ''));
  return known ? { ...p, changes: known } : params;
}

/** Map a Codex approval request onto the host's permission request vocabulary. */
function toPermissionRequest(method: string, params: unknown): PermissionRequest {
  const p = (params ?? {}) as Record<string, unknown>;
  if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
    const command = Array.isArray(p['command']) ? (p['command'] as string[]).join(' ') : String(p['command'] ?? '');
    return {
      type: 'shell_exec',
      description: `Run command: ${command}`,
      details: {
        toolName: 'shell',
        command,
        cwd: p['cwd'],
        reason: p['reason'],
        // The card used to show a bare command string. Codex already parsed it
        // ("reads src/a.ts", "searches for foo") and says when the prompt is
        // really about reaching a host on the network — both were dropped, so
        // a network approval read as an ordinary shell command.
        ...(p['commandActions'] ? { commandActions: p['commandActions'] } : {}),
        ...(p['networkApprovalContext'] ? { networkApprovalContext: p['networkApprovalContext'] } : {}),
        ...(p['kind'] ? { kind: p['kind'] } : {}),
        provider: 'codex',
      },
    };
  }
  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
    const files = Array.isArray(p['changes'])
      ? (p['changes'] as Array<{ path?: unknown }>).map((c) => String(c.path ?? '')).filter(Boolean)
      : p['changes'] && typeof p['changes'] === 'object'
        ? Object.keys(p['changes'] as object) // legacy shape: { "<path>": change }
        : [];
    const shown = files.slice(0, 4).map((f) => f.split(/[\\/]/).slice(-2).join('/'));
    return {
      type: 'file_write',
      description: files.length
        ? `Edit ${shown.join(', ')}${files.length > shown.length ? ` and ${files.length - shown.length} more` : ''}`
        : 'Apply file changes',
      details: {
        toolName: 'apply_patch',
        changes: p['changes'] ?? p['fileChanges'],
        reason: p['reason'],
        ...(p['grantRoot'] ? { grantRoot: p['grantRoot'] } : {}),
        provider: 'codex',
      },
    };
  }
  if (method === 'item/permissions/requestApproval') {
    const perms = (p as unknown as PermissionsRequestApprovalParams).permissions;
    return {
      type: 'other',
      description: `Grant additional file system/network permissions: ${describePermissionProfile(perms)}`,
      details: {
        toolName: 'permissions',
        permissions: perms,
        reason: p['reason'],
        cwd: p['cwd'],
        provider: 'codex',
      },
    };
  }
  return { type: 'other', description: method, details: { ...p, provider: 'codex' } };
}

/** "Plan: 2/5 done" plus one checklist line per step. */
function describePlan(steps: readonly V2TurnPlanStep[], explanation?: string | null): string {
  const done = steps.filter((s) => s.status === 'completed').length;
  const lines = [`Plan: ${done}/${steps.length} done`];
  if (explanation?.trim()) lines.push(explanation.trim());
  for (const s of steps) {
    const mark = s.status === 'completed' ? '[x]' : s.status === 'inProgress' ? '[~]' : '[ ]';
    lines.push(`${mark} ${s.step}`);
  }
  return lines.join('\n');
}

/**
 * Parse the markdown checklist a `plan` ITEM carries as free text back into the
 * same step shape `turn/plan/updated` sends structurally.
 *
 * Codex reports the plan twice in different shapes — a structured turn-level
 * notification and a streamed text item — and the UI must not have to know
 * which one produced a given update, so both land on one representation.
 */
function parsePlanText(text: string): V2TurnPlanStep[] {
  const steps: V2TurnPlanStep[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = /^[-*]?\s*\[( |x|X|~|-)\]\s*(.+)$/.exec(line);
    if (!m) continue;
    const mark = m[1]!;
    steps.push({
      step: m[2]!.trim(),
      status: mark === 'x' || mark === 'X' ? 'completed' : mark === ' ' ? 'pending' : 'inProgress',
    });
  }
  return steps;
}

/**
 * One line summarising a quota snapshot.
 *
 * Codex reports two independent windows (typically a short rolling one and a
 * weekly one); naming only the first is how a user hits a weekly cap while the
 * UI shows plenty of headroom, so both are described when both are present.
 */
function describeRateLimits(snapshot: V2RateLimitSnapshot): string {
  const windows: string[] = [];
  const describe = (label: string, w: { usedPercent: number; resetsAt?: number | null } | null | undefined): void => {
    if (!w) return;
    const pct = Math.round(w.usedPercent);
    // `resetsAt` is a unix SECONDS timestamp in this protocol; rendering it as
    // milliseconds put every reset in 1970.
    const resets = typeof w.resetsAt === 'number'
      ? `, resets ${new Date(w.resetsAt * 1000).toISOString()}`
      : '';
    windows.push(`${label} ${pct}% used${resets}`);
  };
  describe('primary', snapshot.primary);
  describe('secondary', snapshot.secondary);
  const name = snapshot.limitName ?? snapshot.limitId ?? 'usage';
  return windows.length ? `${name}: ${windows.join('; ')}` : `${name}: no window reported`;
}

/** MCP runtime states that mean "this server did not come up". */
const MCP_FAILED_STATUSES: ReadonlySet<string> = new Set([
  'failed',
  'authenticationRequired',
  'cancelled',
]);

/**
 * Codex's own desktop-control plugins, and the MCP server that hosts them
 * (identifiers verified against codex 0.153 with the ChatGPT desktop app).
 *
 * Inherited from the user's Codex config, these let a GeneratorAI chat drive
 * the user's real desktop and Chrome — outside GeneratorAI's own permission
 * and computer-use consent, which its browser and computer tools go through.
 * Observed live: a chat asked to read GeneratorAI's shared browser reached for
 * Codex Computer Use and tried to take over Google Chrome. They are switched
 * off per thread; the user's Codex app keeps them.
 */
const CODEX_DEVICE_CONTROL_PLUGINS = [
  'unified-computer-use@openai-bundled',
  'computer-use@openai-bundled',
  'browser@openai-bundled',
] as const;
const CODEX_DEVICE_CONTROL_MCP_SERVERS = ['node_repl'] as const;

// ── CodexProvider ────────────────────────────────────────────────

/**
 * W37 — IAgentHarness backed by `codex app-server` JSON-RPC over stdio.
 *
 * Lifecycle:
 *   1. `initialize()` spawns `codex app-server`, completes the `initialize`
 *      handshake and sends the `initialized` notification.
 *   2. `createConversation()` calls `thread/start` (or `thread/resume` when the
 *      caller supplies a provider session id) and keeps the thread id.
 *   3. `sendPromptAndWait()` calls `turn/start` and consumes the `item/*` and
 *      `turn/*` notifications it produces.
 *   4. `abortConversation()` calls `turn/interrupt` for the active turn.
 *   5. `shutdown()` sends `SIGTERM`, waits, then escalates to `SIGKILL`.
 */
export class CodexProvider implements IAgentHarness {
  private readonly opts: Required<
    Omit<CodexProviderOptions, 'logger' | 'binaryPath' | 'env' | 'defaultModel' | 'onApproval'>
  > & {
    binaryPath?: string;
    env?: Record<string, string | undefined>;
    defaultModel?: string;
    logger?: CodexProviderOptions['logger'];
    onApproval?: CodexProviderOptions['onApproval'];
  };

  private proc: ChildProcess | null = null;
  /** Kept so `shutdown()` can close it — an orphaned readline holds the stdout fd open. */
  private rl: ReadlineInterface | null = null;
  private clientState: HarnessClientState = 'starting';
  private rpcIdCounter = 0;
  // Pending RPC calls indexed by id
  private pendingRpc = new Map<
    string | number,
    {
      resolve: (result: unknown) => void;
      reject: (e: Error) => void;
      /** Deadline timer — cleared on settle so a dead child can't leak it. */
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  // Notification handlers — fired for every incoming JSON-RPC notification
  private notificationListeners = new Set<(method: string, params: unknown) => void>();
  private clientEventListeners = new Set<Listener<HarnessClientEvent>>();
  /** Rolling tail of the child's stderr — see `stderrCaptureBytes`. */
  private stderrTail = '';
  /** True once we have asked the child to exit, so its exit is not an error. */
  private stopping = false;

  private conversations = new Map<string, ConversationState>();
  /** Codex version reported by the `initialize` handshake (from its user agent). */
  private codexVersion: string | undefined;
  /** Last skill-root set sent, so an unchanged union is not re-sent. */
  private appliedSkillRoots = '';
  /**
   * Latest quota snapshot: read once after `initialize`, then kept current by
   * `account/rateLimits/updated`. Cached rather than fetched on demand because
   * the push notification is the only place a MID-TURN change appears, and
   * `getAccountInfo()` is called from the registry's health path where an extra
   * round trip to a busy binary is not free.
   */
  private rateLimits: V2RateLimitSnapshot | undefined;
  /** Unsubscribe for the provider-level notification handler. */
  private globalNotificationUnsub: UnsubFn | null = null;

  constructor(opts: CodexProviderOptions = {}) {
    this.opts = {
      args: opts.args ?? ['app-server'],
      // No invented default model. `codex-mini` was not a model the binary
      // offers, and sending an unknown name fails the thread start. Omitting
      // `model` lets the server pick its own configured default, which is the
      // only correct behaviour when the caller has not chosen one.
      defaultModel: opts.defaultModel,
      defaultCwd: opts.defaultCwd ?? process.cwd(),
      approvalPolicy: opts.approvalPolicy ?? 'never',
      sandboxMode: opts.sandboxMode ?? 'workspace-write',
      baseBackoffMs: opts.baseBackoffMs ?? 1_000,
      maxBackoffRetries: opts.maxBackoffRetries ?? 4,
      rpcTimeoutMs: opts.rpcTimeoutMs ?? 30_000,
      shutdownGraceMs: opts.shutdownGraceMs ?? 5_000,
      stderrCaptureBytes: opts.stderrCaptureBytes ?? 8_192,
      clientName: opts.clientName ?? 'generatorai',
      clientVersion: opts.clientVersion ?? '0.1.0',
      binaryPath: opts.binaryPath,
      env: opts.env,
      logger: opts.logger,
      onApproval: opts.onApproval,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    const bin = this.opts.binaryPath ?? 'codex';
    this.stopping = false;

    // Wrap spawn in a Promise that rejects if the binary fails to start (e.g. ENOENT).
    // The 'error' event fires via nextTick (before setImmediate), so if ENOENT fires,
    // reject() wins before resolve() — guaranteeing initialize() throws on bad binary.
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, this.opts.args, {
        cwd: this.opts.defaultCwd,
        // Codex executes model-authored shell commands, so it must never
        // inherit the vault key, the desktop admin token, source-control
        // tokens or DB credentials. `buildHarnessEnv` gives it the base
        // allowlist (PATH, locale, proxy, etc.) plus only what the caller
        // explicitly injects via `opts.env` (e.g. `OPENAI_API_KEY`).
        env: buildHarnessEnv({ extra: this.opts.env }),
        // W12: stderr is PIPED, not inherited. Inheriting it dumped the child's
        // diagnostics into the server's own console where nothing could attach
        // them to the failure they explain.
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.proc = proc;

      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (chunk: string) => this.captureStderr(chunk));

      // Error handler fires on next tick — rejects initialize() if binary missing
      proc.once('error', (err) => {
        const msg = err.message.includes('ENOENT')
          ? `Codex CLI not found at "${bin}". Install Codex (npm i -g @openai/codex, or the ChatGPT desktop app), or set CODEX_CLI_PATH to its location.`
          : err.message;
        this.clientState = 'error';
        const detailed = this.withStderr(msg);
        for (const h of this.clientEventListeners) h({ type: 'client.error', data: { message: detailed } });
        // Nothing can answer an outstanding call once spawn itself failed.
        this.failAllPendingRpc(new Error(detailed));
        reject(new Error(detailed));
      });

      // Ongoing exit handler (fires after init phase)
      proc.on('exit', (code, sig) => {
        // A child we asked to stop is NOT an error, and neither is a clean
        // signal death: `kill('SIGTERM')` yields `code === null`, so keying
        // purely off `code === 0` reported every orderly shutdown — including
        // our own SIGKILL escalation — as a provider failure.
        const clean = this.stopping || code === 0;
        this.clientState = clean ? 'stopped' : 'error';
        const message = this.withStderr(
          sig ? `codex exited on signal ${sig}` : `codex exited with code ${code}`,
        );
        for (const h of this.clientEventListeners) {
          h({
            type: clean ? 'client.stopped' : 'client.error',
            data: clean ? undefined : { message },
          });
        }
        // Drain the pending map. A response can never arrive for a dead child,
        // so leaving these unsettled hangs every caller — `ping()` included —
        // for the lifetime of the process.
        this.failAllPendingRpc(new Error(message));
        // Any turn parked on notifications is equally unreachable now.
        this.settleAllTurns();
      });

      // Wire up JSON-RPC message reading from stdout
      const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
      this.rl = rl;
      rl.on('line', (line) => this.onStdoutLine(line));

      // If we reach setImmediate, the process started without ENOENT
      setImmediate(resolve);
    });

    // The app-server requires the `initialize` handshake before it will accept
    // any other method, and expects the `initialized` notification afterwards.
    // Neither was sent before; every call was made against a server that had
    // not agreed to talk yet.
    try {
      const init = await this.rpc<{ userAgent?: string }>('initialize', {
        clientInfo: { name: this.opts.clientName, version: this.opts.clientVersion },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      // `<client>/<codex version> (<os>)` — the only place the binary names itself.
      this.codexVersion = /\/(\d+\.\d+\.\d+[^\s]*)/.exec(init?.userAgent ?? '')?.[1];
      this.notify('initialized', undefined);
    } catch (err) {
      this.globalNotificationUnsub?.();
      this.globalNotificationUnsub = null;
      const message = err instanceof Error ? err.message : String(err);
      await this.shutdown().catch(() => { /* best effort */ });
      // AFTER shutdown, which sets 'stopped': a provider whose bring-up failed
      // must report 'error', or a supervisor reads it as an orderly stop and
      // never retries.
      this.clientState = 'error';
      throw new Error(`CodexProvider: initialize handshake failed: ${message}`);
    }

    // Provider-wide notifications (config warnings, deprecations, quota
    // updates, thread lifecycle) are NOT scoped to a turn and several carry no
    // `threadId` at all, so the per-turn subscription in `runTurnOnce` could
    // never see them — it drops anything whose thread is not its own.
    this.globalNotificationUnsub?.();
    this.globalNotificationUnsub = this.onNotification((method, params) =>
      this.handleGlobalNotification(method, params),
    );

    // One read so `getAccountInfo()` can report quota without a round trip.
    // Best effort: an older binary answers "method not found", and a signed-out
    // one has no quota to report — neither is a bring-up failure.
    try {
      const quota = await this.rpc<V2GetAccountRateLimitsResponse>('account/rateLimits/read', {
        excludeResetCreditDetails: true,
      });
      if (quota?.rateLimits) this.rateLimits = quota.rateLimits;
    } catch { /* optional */ }

    this.clientState = 'running';
  }

  async stop(): Promise<void> { await this.shutdown(); }

  async forceStop(): Promise<void> {
    this.stopping = true;
    this.teardownIo();
    this.proc?.kill('SIGKILL');
    this.proc = null;
    this.clientState = 'stopped';
    this.failAllPendingRpc(new Error('CodexProvider: force-stopped'));
    this.settleAllTurns();
  }

  async shutdown(): Promise<void> {
    const proc = this.proc;
    this.stopping = true;
    this.teardownIo();
    this.proc = null;
    this.clientState = 'stopped';
    this.failAllPendingRpc(new Error('CodexProvider: shut down'));
    this.settleAllTurns();
    if (!proc || proc.exitCode != null || proc.signalCode != null) return;

    // SIGTERM then WAIT. Killing and immediately nulling `this.proc` leaks a
    // child that ignores SIGTERM (or is mid-tool-call): the handle is gone
    // before anyone can escalate.
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.opts.logger?.warn?.(
          `[CodexProvider] codex did not exit ${this.opts.shutdownGraceMs} ms after SIGTERM — escalating to SIGKILL`,
        );
        proc.kill('SIGKILL');
        resolve();
      }, this.opts.shutdownGraceMs);
      timer.unref?.();
      proc.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  getClientState(): HarnessClientState { return this.clientState; }

  async ping(): Promise<boolean> {
    // There is no `ping` method in the protocol. `model/list` is the cheapest
    // real request that proves the child is alive AND answering — the previous
    // `ping` call was an invented method the server would reject, so this
    // returned false for a perfectly healthy binary.
    try {
      await this.rpc('model/list', { limit: 1 });
      return true;
    } catch { return false; }
  }

  onClientEvent(handler: Listener<HarnessClientEvent>): UnsubFn {
    this.clientEventListeners.add(handler);
    return () => this.clientEventListeners.delete(handler);
  }

  // ── Capabilities (L9: declared, never probed) ────────────────────

  capabilities(): ProviderCapabilities {
    return {
      // Codex accepts `image` / `localImage` user input parts.
      vision: true,
      // Models advertise `supportedReasoningEfforts`; turns take an `effort`.
      reasoning: true,
      // Per-model efforts come from `model/list`; this is the host-wide set.
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      planMode: false,
      // `mcpServerStatus/list`, `mcpServer/tool/call` and MCP elicitation
      // requests are all in the protocol.
      mcpServers: true,
      // `skills/extraRoots/set` takes directories, scoped to the app-server
      // process rather than a thread (the composer warns, C-19).
      skills: 'directories',
      // Approvals are per-command/patch and only fire under an approval policy
      // that asks for them — not a gate on every tool call (PD-17).
      approvalGating: 'exec_and_patch',
      // `dynamicTools` are accepted on `thread/start` only.
      hostTools: 'start_only',
      // `outputSchema` on `turn/start`.
      structuredOutput: 'native',
      // Threads are persisted server-side and rejoinable via `thread/resume`.
      sessionPersistence: true,
      // `thread/fork { lastTurnId }` and `thread/revert { beforeTurnId }` are
      // in the protocol (0.154); `thread/rollback` is the deprecated fallback.
      conversationFork: true,
      conversationRewind: true,
      // `account/login/start` (ChatGPT browser flow) + `account/logout`.
      accountLogin: true,
      budgetTracking: false,
      computerUse: false,
    };
  }

  // ── Model discovery ───────────────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    const models: HarnessModel[] = [];
    try {
      // `model/list` is paginated. The previous version read a single
      // unpaginated `models` array that the protocol does not have, so it
      // always returned nothing.
      let cursor: string | undefined;
      do {
        const page = await this.rpc<V2ModelListResponse>('model/list', {
          ...(cursor ? { cursor } : {}),
        });
        for (const m of page.data ?? []) {
          if (m.hidden) continue;
          // The account's default model leads, as it does in Codex's own picker.
          if (m.isDefault) models.unshift(this.toHarnessModel(m));
          else models.push(this.toHarnessModel(m));
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    } catch {
      // Binary not running or not authenticated — an empty list is the
      // contract here (W41: getModels never throws).
      return models;
    }
    return models;
  }

  private toHarnessModel(m: V2Model): HarnessModel {
    const efforts = (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort).filter(Boolean);
    return {
      id: m.id,
      name: m.displayName || m.model || m.id,
      provider: 'codex',
      description: m.description || undefined,
      supportsReasoning: efforts.length > 0,
      ...(efforts.length ? { reasoningEfforts: efforts, defaultReasoningEffort: m.defaultReasoningEffort } : {}),
      ...(m.inputModalities ? { supportsVision: m.inputModalities.includes('image') } : {}),
    };
  }

  /**
   * Credential state, read from Codex itself (`account/read`) — the same call
   * Codex's own clients make. Lets the registry tell "installed but signed out"
   * apart from "ready" instead of inferring it from the catalog, which Codex
   * serves even to a signed-out user.
   */
  async getAccountInfo(): Promise<{
    tokenSource?: string;
    apiKeySource?: string;
    email?: string;
    subscriptionType?: string;
    apiProvider?: string;
    /**
     * Latest quota snapshot, when Codex has reported one. ADDITIVE and
     * optional: `AccountAware` in `HarnessRegistry` is a structural type, so a
     * caller that does not know about this field is unaffected, and a binary
     * that never answers `account/rateLimits/read` simply omits the key.
     */
    rateLimits?: V2RateLimitSnapshot;
  }> {
    const res = await this.rpc<V2GetAccountResponse>('account/read', {});
    const quota = this.rateLimits ? { rateLimits: this.rateLimits } : {};
    const account = res.account;
    if (!account) {
      return res.requiresOpenaiAuth ? { tokenSource: 'none', ...quota } : { apiProvider: 'codex', ...quota };
    }
    switch (account.type) {
      case 'apiKey':
        return { apiKeySource: 'OPENAI_API_KEY', apiProvider: 'openai', ...quota };
      case 'chatgpt':
        return { ...(account.email ? { email: account.email } : {}), subscriptionType: account.planType, apiProvider: 'openai', ...quota };
      default:
        return { apiProvider: account.type, ...quota };
    }
  }

  /**
   * Sign in through Codex's own ChatGPT browser flow.
   *
   * `account/login/start { type: 'chatgpt' }` answers with the URL to open;
   * Codex completes the OAuth exchange itself and announces the outcome on
   * `account/login/completed`, which the registry's next probe (triggered by
   * the host after the browser flow) turns into "authenticated". The method
   * never blocks on the browser: the user may take minutes, or close the tab.
   */
  async startLogin(): Promise<{ authUrl?: string; loginId?: string; completed?: boolean }> {
    const res = await this.rpc<{ type: string; authUrl?: string; loginId?: string }>('account/login/start', {
      type: 'chatgpt',
    });
    if (res?.type === 'chatgpt' && res.authUrl) {
      this.opts.logger?.info?.(`[CodexProvider] ChatGPT sign-in started (login ${res.loginId ?? '?'})`);
      return { authUrl: res.authUrl, ...(res.loginId ? { loginId: res.loginId } : {}) };
    }
    // An API-key or already-signed-in answer completes without a browser.
    return { completed: true };
  }

  /** Sign the Codex account out (`account/logout`). */
  async logout(): Promise<void> {
    await this.rpc('account/logout', {});
    this.rateLimits = undefined;
  }

  /** Codex CLI version from the handshake, when it reported one. */
  getVersion(): string | undefined {
    return this.codexVersion;
  }

  // ── Conversation lifecycle ────────────────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const warnings: ConversationWarning[] = [];

    // W12 — rejoin the caller's existing thread when one was handed over,
    // rather than starting the model over with no memory of the chat.
    let threadId: string;
    if (params.resumeProviderSessionId) {
      const resumed = await this.rpc<V2ThreadResumeResponse>('thread/resume', {
        threadId: params.resumeProviderSessionId,
        ...(params.model ? { model: params.model } : {}),
        approvalPolicy: this.opts.approvalPolicy,
        sandbox: this.opts.sandboxMode,
        // A resumed thread needs its instructions, MCP servers and delegation
        // policy re-asserted: they are per-process settings, and without them
        // a chat resumed after a restart ran as a bare Codex session.
        ...this.threadOverrides(params, warnings),
        // The chat's own primary mount, NOT the server's cwd. Resuming a
        // thread rooted somewhere else is how a chat bound to a worktree ends
        // up reading and writing the GeneratorAI checkout instead.
        cwd: params.workingDirectory ?? this.opts.defaultCwd,
        excludeTurns: true,
      });
      threadId = resumed.thread.id;
    } else {
      const startParams: V2ThreadStartParams & { dynamicTools?: unknown[] } = {
        ...(params.model ?? this.opts.defaultModel
          ? { model: params.model ?? this.opts.defaultModel }
          : {}),
        cwd: params.workingDirectory ?? this.opts.defaultCwd,
        approvalPolicy: this.opts.approvalPolicy,
        sandbox: this.opts.sandboxMode,
        serviceName: this.opts.clientName,
        ...this.threadOverrides(params, warnings),
        // Host tools (orchestration, questions, widgets…) as Codex dynamic
        // tools; Codex calls them back through `item/tool/call`. Experimental
        // API, enabled by the `experimentalApi` capability sent at initialize —
        // which is also why the pinned (non-experimental) schema lacks the field.
        ...(params.tools?.length
          ? {
              dynamicTools: params.tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                inputSchema: t.parametersSchema,
              })),
            }
          : {}),
      };
      const started = await this.rpc<V2ThreadStartResponse>('thread/start', startParams);
      threadId = started.thread.id;
    }

    // Codex starts MCP servers asynchronously and reports a failure only if
    // someone asks, so a server that never came up was invisible: its tools
    // were simply missing and the model improvised around them.
    await this.collectMcpStartupWarnings(threadId, warnings);

    this.conversations.set(params.conversationId, {
      threadId,
      params,
      ...(this.buildSandboxPolicy(params, warnings)),
      listeners: new Set(),
      warnings,
      inFlight: false,
      activeTurnId: null,
      settleTurn: null,
      failTurn: null,
      cancelRequested: false,
      retiredTurns: new Set(),
      turnCommandItems: new Set(),
      fileChangePaths: new Map(),
    });
    await this.syncSkillRoots();
    return params.conversationId;
  }

  /**
   * Point Codex at the skill directories of every live conversation.
   *
   * Codex scopes extra skill roots to the app-server process, not a thread,
   * and one process serves every conversation here — so the union is the only
   * faithful mapping. Skills in a root are discovered, not auto-injected, so a
   * root one chat added is merely available to another. Best-effort: a failure
   * leaves Codex's own skill discovery in place.
   */
  /**
   * Record a `ConversationWarning` for every MCP server that failed to start.
   *
   * Best effort by design: `mcpServerStatus/list` is absent on older binaries
   * and a chat with no MCP servers has nothing to report, so a failure here
   * must never take the conversation down with it — the chat still works, it
   * just has fewer tools, which is exactly what the warning says.
   */
  private async collectMcpStartupWarnings(
    threadId: string,
    warnings: ConversationWarning[],
  ): Promise<void> {
    try {
      const res = await this.rpc<V2ListMcpServerStatusResponse>('mcpServerStatus/list', {
        threadId,
        // The tool catalogue is not needed to answer "did it start?", and
        // asking for it makes the call proportional to every server's
        // inventory on a path that runs for every new chat.
        detail: 'toolsAndAuthOnly',
      });
      for (const server of res?.data ?? []) {
        const status = server.runtimeStatus;
        if (status && MCP_FAILED_STATUSES.has(status)) {
          warnings.push({
            code: 'MCP_SERVER_FAILED',
            params: { server: server.name, provider: 'codex', status },
          });
        } else if (server.toolsError) {
          // It connected but its catalogue could not be read, so it has no
          // usable tools — the same outcome for the user as a failed start.
          warnings.push({
            code: 'MCP_SERVER_FAILED',
            params: { server: server.name, provider: 'codex', reason: server.toolsError },
          });
        }
      }
    } catch (err) {
      this.opts.logger?.debug?.(
        `[CodexProvider] mcpServerStatus/list unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async syncSkillRoots(): Promise<void> {
    const roots = [...new Set(
      [...this.conversations.values()].flatMap((c) => c.params.skillDirectories ?? []),
    )].sort();
    const key = roots.join('\n');
    if (key === this.appliedSkillRoots) return;
    try {
      await this.rpc('skills/extraRoots/set', { extraRoots: roots });
      this.appliedSkillRoots = key;
    } catch (err) {
      this.opts.logger?.warn?.(`[CodexProvider] skills/extraRoots/set failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Settings shared by `thread/start` and `thread/resume`: instructions, and
   * per-thread config overrides. Overrides use the same keys as
   * `~/.codex/config.toml` and layer ON TOP of the user's own Codex config,
   * which stays in effect.
   */
  private threadOverrides(
    params: CreateConversationParams,
    warnings: ConversationWarning[],
  ): Pick<V2ThreadStartParams, 'baseInstructions' | 'developerInstructions' | 'config'> {
    const config: Record<string, unknown> = {};
    // Requesting a writable sandbox in a directory Codex has not seen makes it
    // trust that directory by appending `[projects."<dir>"]` to the user's own
    // ~/.codex/config.toml — one permanent entry per chat workspace. Trusting it
    // for this thread through the config override gives the same sandbox and
    // leaves the user's file alone (verified against codex 0.153).
    if (this.opts.sandboxMode !== 'read-only') {
      const cwd = params.workingDirectory ?? this.opts.defaultCwd;
      config['projects'] = { [cwd]: { trust_level: 'trusted' } };
    }
    config['plugins'] = Object.fromEntries(CODEX_DEVICE_CONTROL_PLUGINS.map((id) => [id, { enabled: false }]));
    // The chat's own servers are listed after, so one it names explicitly wins.
    config['mcp_servers'] = {
      ...Object.fromEntries(CODEX_DEVICE_CONTROL_MCP_SERVERS.map((name) => [name, { enabled: false }])),
      ...toCodexMcpServers(params.mcpServers, warnings),
    };
    // `Agent` / `Task` in `excludedBuiltinTools` is the platform asking for the
    // harness's OWN delegation to be off (orchestrator chats, which delegate
    // through `spawn_background_agent`). Codex's equivalent is its multi-agent
    // feature; left on, an orchestrator handed work to Codex-internal
    // sub-agents that never appear as Background Tasks.
    const excluded = params.excludedBuiltinTools ?? [];
    if (excluded.includes('Agent') || excluded.includes('Task')) {
      config['features'] = { multi_agent: false };
    }
    return {
      ...this.buildInstructions(params, warnings),
      ...(Object.keys(config).length ? { config } : {}),
    };
  }

  /**
   * Maps our system-message config onto the two instruction slots the protocol
   * has, and records a warning when the caller asked for something Codex cannot
   * express — a silently dropped system prompt is how a conversation ends up
   * behaving nothing like the caller configured it.
   */
  private buildInstructions(
    params: CreateConversationParams,
    warnings: ConversationWarning[],
  ): Pick<V2ThreadStartParams, 'baseInstructions' | 'developerInstructions'> {
    const out: Pick<V2ThreadStartParams, 'baseInstructions' | 'developerInstructions'> = {};
    const sys = params.systemMessage;
    if (sys?.content) {
      if (sys.mode === 'replace') out.baseInstructions = sys.content;
      else out.developerInstructions = sys.content;
    } else if (params.systemPromptAppend) {
      out.developerInstructions = params.systemPromptAppend;
    }
    if (params.maxTurns != null) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: 'maxTurns', provider: 'codex' },
      });
    }
    // `codex app-server` is ONE shared child process for the whole provider,
    // spawned in `initialize()` before any conversation exists (see the
    // `spawn` there). A process environment is fixed at spawn time and the
    // protocol has no per-thread env field, so per-conversation variables
    // (`GENERATORAI_WORKSPACE_ROOT`, `GENERATORAI_SCRATCH_DIR`) cannot be
    // delivered without giving every chat its own binary. Say so rather than
    // silently dropping them — provider-wide values still go through
    // `CodexProviderOptions.env`.
    if (params.env && Object.keys(params.env).length > 0) {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: { field: 'env', provider: 'codex', reason: 'shared app-server process' },
      });
    }
    return out;
  }

  /**
   * Map `additionalDirectories` onto the only field in the pinned protocol
   * that accepts extra writable roots.
   *
   * Codex's sandbox is a policy, not a list of mounts: outside
   * `workspace-write` there is nothing for a writable root to widen (a
   * `readOnly` policy has no `writableRoots` member at all, and
   * `dangerFullAccess` already grants everything), so anything else is
   * reported as unsupported instead of being quietly reshaped.
   */
  private buildSandboxPolicy(
    params: CreateConversationParams,
    warnings: ConversationWarning[],
  ): Pick<ConversationState, 'sandboxPolicy'> {
    const dirs = [...new Set(params.additionalDirectories ?? [])];
    if (dirs.length === 0) return {};
    if (this.opts.sandboxMode !== 'workspace-write') {
      warnings.push({
        code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
        params: {
          field: 'additionalDirectories',
          provider: 'codex',
          reason: `sandbox mode "${this.opts.sandboxMode}" has no writable roots`,
        },
      });
      return {};
    }
    return { sandboxPolicy: { type: 'workspaceWrite', writableRoots: dirs } };
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    if (!this.conversations.has(conversationId) && params) {
      await this.createConversation(params);
    }
    // Codex threads are server-side and stateful; a live one needs no resume.
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

  /**
   * W12 — the provider's own id for this conversation, so a runtime recycle can
   * hand it to a fresh adapter as `resumeProviderSessionId` and keep the
   * thread's history instead of starting cold.
   */
  getProviderSessionId(conversationId: string): string | undefined {
    return this.conversations.get(conversationId)?.threadId;
  }

  /**
   * Branch a thread through `throughAnchor` (a Codex turn id) into a new
   * thread, then register it as `newConversationId` by resuming it — the
   * resume path re-asserts instructions, MCP servers and sandbox exactly as a
   * chat reopened after a restart would get them.
   */
  async forkConversation(
    conversationId: string,
    options: ForkConversationOptions,
  ): Promise<ForkConversationResult> {
    const threadId = this.conversations.get(conversationId)?.threadId ?? options.sourceProviderSessionId;
    if (!threadId) {
      throw new HarnessSessionError(`Conversation ${conversationId} has no Codex thread to fork`);
    }
    const anchor = options.throughAnchor;
    if (anchor && anchor.kind !== 'turn') {
      throw new HarnessSessionError(`Codex forks by turn id; got a ${anchor.kind} anchor`);
    }
    const warnings: ConversationWarning[] = [];
    const params = options.params;
    const forked = await this.rpc<V2ThreadForkResponse>('thread/fork', {
      threadId,
      ...(anchor ? { lastTurnId: anchor.id } : {}),
      ...(params.model ? { model: params.model } : {}),
      cwd: params.workingDirectory ?? this.opts.defaultCwd,
      approvalPolicy: this.opts.approvalPolicy,
      sandbox: this.opts.sandboxMode,
      ...this.threadOverrides(params, warnings),
      excludeTurns: true,
    } satisfies V2ThreadForkParams);
    await this.createConversation({
      ...params,
      conversationId: options.newConversationId,
      resumeProviderSessionId: forked.thread.id,
    });
    return { providerSessionId: forked.thread.id };
  }

  /**
   * Drop the tail of a thread's history in place. `thread/revert` needs the
   * first DROPPED turn; when the caller could not name it (a turn recorded
   * before anchors were captured) the deprecated `thread/rollback` drops by
   * count instead. Rewinding to before the first turn starts a fresh thread.
   */
  async rewindConversation(
    conversationId: string,
    options: RewindConversationOptions,
  ): Promise<ForkConversationResult> {
    let conv = this.conversations.get(conversationId);
    if (conv?.inFlight) {
      throw new HarnessSessionError(`Conversation ${conversationId} has a turn in flight`);
    }
    if (!options.keepThrough) {
      // Nothing survives: the cheapest faithful history is an empty thread.
      if (conv) {
        conv.listeners.clear();
        this.conversations.delete(conversationId);
      }
      await this.createConversation({ ...options.params, conversationId });
      return { providerSessionId: this.conversations.get(conversationId)?.threadId };
    }
    const threadId = conv?.threadId ?? options.providerSessionId;
    if (!threadId) {
      throw new HarnessSessionError(`Conversation ${conversationId} has no Codex thread to rewind`);
    }
    if (!conv) {
      // Load the thread first: revert/rollback act on a loaded thread.
      await this.createConversation({
        ...options.params,
        conversationId,
        resumeProviderSessionId: threadId,
      });
      conv = this.conversations.get(conversationId);
    }
    const dropFrom = options.dropFrom;
    let reverted = false;
    if (dropFrom?.kind === 'turn') {
      try {
        await this.rpc('thread/revert', { threadId, beforeTurnId: dropFrom.id } satisfies V2ThreadRevertParams);
        reverted = true;
      } catch (err) {
        this.opts.logger?.warn?.(
          `[CodexProvider] thread/revert failed, falling back to thread/rollback: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (!reverted) {
      if (options.droppedTurns < 1) return { providerSessionId: threadId };
      await this.rpc('thread/rollback', { threadId, numTurns: options.droppedTurns } satisfies V2ThreadRollbackParams);
    }
    return { providerSessionId: threadId };
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      try {
        await this.rpc('thread/delete', { threadId: conv.threadId });
      } catch { /* best effort */ }
      this.conversations.delete(conversationId);
      await this.syncSkillRoots();
    }
  }

  /**
   * Release this process's hold on the conversation WITHOUT deleting the
   * Codex thread.
   *
   * Callers use destroy for teardown — a force-cancelled turn, an archived
   * chat, a session closed during recovery — and resume the chat later from
   * its stored thread id (`resumeProviderSessionId`). Deleting the thread here,
   * as this used to, erased the chat's Codex history on the first hard Stop
   * and made every later resume fail. `deleteConversation` still deletes.
   */
  async destroyConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    if (conv.inFlight) void this.interruptActiveTurn(conv);
    conv.settleTurn?.();
    conv.listeners.clear();
    this.conversations.delete(conversationId);
    await this.syncSkillRoots();
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversations.get(conversationId)?.warnings ?? [];
  }

  async selectAgent(conversationId: string, agentName: string): Promise<void> {
    // Codex has no agent-selection method. Record it rather than pretending it
    // worked, so the caller can surface "this provider ignored your agent".
    const conv = this.conversations.get(conversationId);
    conv?.warnings.push({
      code: 'AGENT_NOT_REGISTERED',
      params: { agent: agentName, provider: 'codex' },
    });
  }

  async listAgents(_conversationId: string): Promise<HarnessAgentInfo[]> {
    return [];
  }

  // ── Messaging ────────────────────────────────────────────────────

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    // Fire-and-forget wrapper. `sendPromptAndWait` rejects on several paths; an
    // un-caught `void` here surfaces each as an unhandled rejection that can
    // take the whole process down under `--unhandled-rejections=strict`.
    void this.sendPromptAndWait(conversationId, prompt, attachments, undefined, options).catch((err: unknown) => {
      const conv = this.conversations.get(conversationId);
      const message = err instanceof Error ? err.message : String(err);
      if (conv) this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
      this.opts.logger?.warn?.(`[CodexProvider] sendPrompt("${conversationId}") failed: ${message}`);
    });
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`CodexProvider: no conversation "${conversationId}"`);
    if (conv.inFlight) throw new Error(`CodexProvider: conversation "${conversationId}" already has a turn in flight`);
    conv.inFlight = true;
    conv.cancelRequested = false;

    try {
      return await this.doTurn(conv, prompt, attachments, signal, options);
    } finally {
      // Retire BEFORE clearing, so a terminal event still owed by this turn is
      // recognised as stale rather than attributed to whatever runs next.
      if (conv.activeTurnId) {
        conv.retiredTurns.add(conv.activeTurnId);
        while (conv.retiredTurns.size > RETIRED_TURN_MEMORY) {
          const oldest = conv.retiredTurns.values().next().value as string | undefined;
          if (oldest === undefined) break;
          conv.retiredTurns.delete(oldest);
        }
      }
      conv.inFlight = false;
      conv.settleTurn = null;
      conv.failTurn = null;
      conv.activeTurnId = null;
      conv.cancelRequested = false;
    }
  }

  /**
   * Run one turn, retrying on upstream backpressure with exponential backoff.
   *
   * The retry lives HERE rather than inside the notification handler so the
   * whole turn — request and stream alike — is re-attempted as a unit.
   */
  private async doTurn(
    conv: ConversationState,
    prompt: string,
    attachments: AttachmentRef[] | undefined,
    signal: AbortSignal | undefined,
    options: SendPromptOptions | undefined,
  ): Promise<ConversationResponse> {
    let lastPartial = '';
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.runTurnOnce(conv, prompt, attachments, signal, options, (text) => {
          lastPartial = text;
        });
      } catch (err) {
        if (!isRetryable(err) || attempt >= this.opts.maxBackoffRetries) throw err;
        const delayMs = jitter(this.opts.baseBackoffMs * Math.pow(2, attempt));
        this.opts.logger?.warn?.(
          `[CodexProvider] ${errorInfoTag(err.info) ?? 'backpressure'}; retrying in ${Math.round(delayMs)} ms ` +
          `(attempt ${attempt + 1}/${this.opts.maxBackoffRetries})`,
        );
        await sleep(delayMs);
        // A Stop pressed while we were parked in the backoff must not be
        // followed by yet another attempt.
        if (conv.cancelRequested || signal?.aborted) {
          this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'codex' } });
          return { content: lastPartial };
        }
      }
    }
  }

  /** One `turn/start` request plus the notification stream it produces. */
  private runTurnOnce(
    conv: ConversationState,
    prompt: string,
    attachments: AttachmentRef[] | undefined,
    signal: AbortSignal | undefined,
    options: SendPromptOptions | undefined,
    reportPartial: (text: string) => void,
  ): Promise<ConversationResponse> {
    // A retry attempt must not inherit the previous attempt's turn id. That id
    // is only replaced once the new `turn/start` ANSWERS, and the new turn's
    // first notification can arrive in the same stdout chunk as that answer —
    // readline emits both lines before the promise callback runs — so the
    // guard below would drop it as belonging to another turn and the retried
    // turn would never finish. Retire it now; the guard then fails open until
    // the new id is known, exactly as it does for a first attempt.
    if (conv.activeTurnId) {
      conv.retiredTurns.add(conv.activeTurnId);
      conv.activeTurnId = null;
    }
    conv.turnCommandItems = new Set();
    conv.fileChangePaths = new Map();
    const turnParams: V2TurnStartParams = {
      threadId: conv.threadId,
      input: this.buildInput(prompt, attachments),
      // `SendPromptOptions` carries only `agentMode` / `permissionMode`. Codex
      // has no per-turn agent mode, and its per-turn approval policy is the
      // nearest analogue of a permission mode: a caller asking for `plan` or
      // `dontAsk` must not silently get the thread's default.
      ...(this.approvalPolicyForTurn(options)),
      // The chat's extra writable roots. `thread/start` cannot carry them, so
      // every turn re-asserts the policy (see `ConversationState.sandboxPolicy`).
      ...this.sandboxPolicyForTurn(conv, options),
      // "This turn and subsequent turns" — re-sent each turn so a change made
      // between turns (or a resumed thread) always takes the chat's effort.
      ...(conv.params.reasoningEffort ? { effort: conv.params.reasoningEffort } : {}),
    };

    let assistantText = '';
    /** Text of the agent message currently streaming, and its item id. */
    let currentMessageId: string | null = null;
    /** Final-answer text, when Codex marks one; preferred as the turn's content. */
    let finalAnswer: string | null = null;
    /** Reasoning text per reasoning item, and which delta kind each item uses. */
    const reasoningText = new Map<string, string>();
    const reasoningKind = new Map<string, 'summary' | 'raw'>();
    /** Streamed `plan` item text, accumulated until the item completes. */
    const planText = new Map<string, string>();
    /** Turn ids already announced as compacted — the notice must not repeat. */
    const compactedTurns = new Set<string>();
    /** Token usage: thread totals when this turn began, and the latest report. */
    let usageAtStart: { input: number; output: number; cached: number } | null = null;
    let usageLatest: { input: number; output: number; cached: number } | null = null;
    let turnStartedAt = Date.now();
    const model = conv.params.model ?? this.opts.defaultModel ?? '';
    /**
     * Tool calls seen but not yet resolved. Pruned on completion — leaving
     * completed ids here makes a truncation stop emit `tool_complete
     * success:false` for tools that already succeeded, telling the model to
     * redo work it has done and (for a write or delete) possibly redo it
     * destructively.
     */
    const pendingToolItems = new Set<string>();

    return new Promise<ConversationResponse>((resolve, reject) => {
      let settled = false;
      // Assigned below, but `cancel()` can run before we get there (a signal
      // that was already aborted), so it must start life callable.
      let unsub: UnsubFn = () => { /* not subscribed yet */ };

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort);
        conv.settleTurn = null;
        conv.failTurn = null;
        unsub();
      };

      /**
       * The single place a turn is cancelled from — used by the external
       * signal, by `abortConversation()` (via `conv.settleTurn`) and by child
       * exit. It SETTLES the promise; emitting `harness.cancelled` without
       * settling is what wedged the conversation forever.
       */
      const cancel = (): void => {
        conv.cancelRequested = true;
        finish(() => {
          // Calls still open were stopped, not completed. Left alone they read
          // as finished (or spin forever) — Codex's own completion for them
          // arrives after the turn is retired and is dropped.
          for (const callId of pendingToolItems) {
            this.broadcast(conv, {
              kind: 'harness.tool_complete',
              data: { tool: callId, result: 'Stopped before it finished.', callId, success: false },
            });
          }
          pendingToolItems.clear();
          this.broadcast(conv, { kind: 'harness.cancelled', data: { reason: 'user_abort', provider: 'codex' } });
          reportPartial(assistantText);
          resolve({ content: assistantText });
        });
      };

      const onAbort = (): void => {
        void this.interruptActiveTurn(conv);
        cancel();
      };

      if (signal?.aborted || conv.cancelRequested) {
        cancel();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      conv.settleTurn = cancel;

      /**
       * End the turn because the THREAD died, not because the user stopped it.
       *
       * Preserve streamed partial text, but reject the awaited operation.
       * Workflow callers use that promise to decide success and retry; an
       * error event alone would let a dead thread mark its stage completed.
       */
      conv.failTurn = (message: string): void => {
        finish(() => {
          for (const callId of pendingToolItems) {
            this.broadcast(conv, {
              kind: 'harness.tool_complete',
              data: { tool: callId, result: message, callId, success: false },
            });
          }
          pendingToolItems.clear();
          this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
          this.broadcast(conv, { kind: 'harness.idle', data: {} });
          reportPartial(assistantText);
          reject(new Error(message));
        });
      };

      /**
       * A `subAgentActivity` item, as a provider-neutral sub-agent notice.
       *
       * The same item arrives on both `item/started` and `item/completed`, so
       * each (item, kind) pair is announced exactly once — otherwise a
       * sub-agent step would be opened twice and settle against the wrong one.
       */
      const announcedSubAgent = new Set<string>();
      const emitSubAgentActivity = (item: V2ThreadItem): void => {
        const anyItem = item as unknown as Record<string, unknown>;
        const infoType = subAgentInfoType(anyItem['kind']);
        if (!infoType) return;
        const dedupeKey = `${item.id}:${String(anyItem['kind'])}`;
        if (announcedSubAgent.has(dedupeKey)) return;
        announcedSubAgent.add(dedupeKey);
        const label = String(anyItem['agentPath'] ?? anyItem['agentThreadId'] ?? 'sub-agent');
        const verb = infoType === 'subagent_started'
          ? 'started'
          : infoType === 'subagent_completed'
            ? 'completed'
            : infoType === 'subagent_failed'
              ? 'failed'
              : 'progress';
        this.broadcast(conv, {
          kind: 'harness.session_info',
          data: {
            infoType,
            message: `Sub-agent ${verb}: ${label}`,
            toolCallId: item.id,
            ...(typeof anyItem['agentThreadId'] === 'string'
              ? { agentId: anyItem['agentThreadId'] }
              : {}),
          },
        });
      };

      /**
       * The turn's plan, in one shape.
       *
       * Deduped on the rendered form because Codex re-sends an unchanged plan
       * on every turn-level update; without this an agent that touches its
       * plan between each of ten tool calls files ten identical checklists.
       */
      let lastPlanMessage = '';
      const emitPlanUpdate = (steps: readonly V2TurnPlanStep[], explanation?: string | null): void => {
        const message = describePlan(steps, explanation);
        if (message === lastPlanMessage) return;
        lastPlanMessage = message;
        this.broadcast(conv, {
          kind: 'harness.session_info',
          data: {
            infoType: 'plan_update',
            message,
            steps: steps.map((s) => ({ step: s.step, status: s.status })),
            completed: steps.filter((s) => s.status === 'completed').length,
            total: steps.length,
            ...(explanation ? { explanation } : {}),
            provider: 'codex',
          },
        });
      };

      /** Fail every still-open tool call — used when the model was truncated. */
      const failOpenToolCalls = (why: string): void => {
        for (const callId of pendingToolItems) {
          this.broadcast(conv, {
            kind: 'harness.tool_complete',
            data: {
              tool: callId,
              result:
                `Response was truncated (${why}). All tool calls in this batch are ` +
                `cancelled. Please re-issue your request.`,
              callId,
              success: false,
            },
          });
        }
        pendingToolItems.clear();
      };

      unsub = this.onNotification((method, params) => {
        // Every turn notification is keyed by thread AND turn, so events owed
        // by a turn we already walked away from are dropped by id rather than
        // guessed at with a timer.
        const p = params as Record<string, unknown> | undefined;
        if (!p || p['threadId'] !== conv.threadId) return;
        const turnId = p['turnId'];
        if (typeof turnId === 'string') {
          // A turn we have already finished with can still owe a terminal
          // event. Drop it explicitly — `activeTurnId` is null until
          // `turn/start` answers, so an `activeTurnId`-only guard fails OPEN
          // during exactly the window in which the stale event arrives.
          if (conv.retiredTurns.has(turnId)) return;
          if (conv.activeTurnId && turnId !== conv.activeTurnId) return;
        }

        switch (method) {
          case 'turn/started': {
            const turn = (params as V2TurnStartedNotification).turn;
            if (turn?.id) {
              turnStartedAt = Date.now();
              this.broadcast(conv, { kind: 'harness.turn_start', data: { turnId: turn.id } });
            }
            break;
          }

          case 'item/agentMessage/delta': {
            const notif = params as V2AgentMessageDeltaNotification;
            const delta = notif.delta ?? '';
            if (delta) {
              // A turn can hold several agent messages (commentary between tool
              // calls, then the final answer). Separate them rather than running
              // one message's last word into the next one's first.
              if (notif.itemId && notif.itemId !== currentMessageId) {
                if (currentMessageId !== null && assistantText && !assistantText.endsWith('\n\n')) {
                  assistantText += '\n\n';
                }
                currentMessageId = notif.itemId;
              }
              this.broadcast(conv, { kind: 'harness.token', data: { text: delta } });
              assistantText += delta;
              reportPartial(assistantText);
            }
            break;
          }

          // ── Live tool output ────────────────────────────────────
          //
          // Codex streams a running command's stdout/stderr, a patch's
          // application log and an MCP tool's progress notes while the call is
          // still open. All three land on `tool_progress` — the SAME infoType
          // the Claude mapper uses for its own tool progress — keyed by the
          // tool call they belong to, so the console and the tool chip can
          // show them without either surface learning a Codex-specific type.
          case 'item/commandExecution/outputDelta':
          case 'item/fileChange/outputDelta': {
            const notif = params as V2CommandExecutionOutputDeltaNotification | V2FileChangeOutputDeltaNotification;
            if (!notif.delta) break;
            this.broadcast(conv, {
              kind: 'harness.session_info',
              data: {
                infoType: 'tool_progress',
                message: notif.delta,
                toolCallId: notif.itemId,
                provider: 'codex',
              },
            });
            break;
          }

          case 'item/fileChange/patchUpdated': {
            const notif = params as V2FileChangePatchUpdatedNotification;
            const paths = (notif.changes ?? []).map((c) => c.path).filter(Boolean);
            rememberFileChange(conv, notif.itemId, notif.changes);
            if (paths.length === 0) break;
            this.broadcast(conv, {
              kind: 'harness.session_info',
              data: {
                infoType: 'tool_progress',
                message: `Patching ${paths.join(', ')}`,
                toolCallId: notif.itemId,
                changes: notif.changes,
                provider: 'codex',
              },
            });
            break;
          }

          case 'item/mcpToolCall/progress': {
            const notif = params as V2McpToolCallProgressNotification;
            if (!notif.message) break;
            this.broadcast(conv, {
              kind: 'harness.session_info',
              data: {
                infoType: 'tool_progress',
                message: notif.message,
                toolCallId: notif.itemId,
                provider: 'codex',
              },
            });
            break;
          }

          // ── Plan / todo updates ─────────────────────────────────
          //
          // Codex reports the same plan two ways — structurally on the turn,
          // and as a streamed markdown checklist item — and both are folded
          // into one `plan_update` so no surface has to know which arrived.
          case 'turn/plan/updated': {
            const notif = params as V2TurnPlanUpdatedNotification;
            const steps = notif.plan ?? [];
            if (steps.length === 0) break;
            emitPlanUpdate(steps, notif.explanation);
            break;
          }

          case 'item/plan/delta': {
            // Accumulated, not relayed: a `plan_update` is an ITEM (it is a
            // state change, not a token), so emitting one per delta would put
            // a dozen near-identical checklists in the transcript. The item's
            // completion below emits exactly one.
            const notif = params as V2PlanDeltaNotification;
            if (notif.delta) planText.set(notif.itemId, (planText.get(notif.itemId) ?? '') + notif.delta);
            break;
          }

          // ── Reasoning summary part boundaries ───────────────────
          case 'item/reasoning/summaryPartAdded': {
            const notif = params as V2ReasoningSummaryPartAddedNotification;
            // The deltas of every summary part arrive on one stream, so
            // without a break the last word of one paragraph ran straight into
            // the first word of the next. Only between parts, never before the
            // first one, and never twice for the same boundary.
            if (notif.summaryIndex === 0) break;
            const seen = reasoningText.get(notif.itemId) ?? '';
            if (!seen || seen.endsWith('\n\n')) break;
            reasoningText.set(notif.itemId, `${seen}\n\n`);
            this.broadcast(conv, { kind: 'harness.reasoning_delta', data: { text: '\n\n' } });
            break;
          }

          // ── Compaction ──────────────────────────────────────────
          //
          // `compact_boundary` is the infoType the Claude mapper already emits
          // for its own `SDKCompactBoundaryMessage`, so a Codex compaction
          // renders through the same path rather than needing new UI.
          case 'thread/compacted': {
            const notif = params as V2ContextCompactedNotification;
            if (compactedTurns.has(notif.turnId)) break;
            compactedTurns.add(notif.turnId);
            this.broadcast(conv, {
              kind: 'harness.session_info',
              data: { infoType: 'compact_boundary', message: 'Context compacted (auto)', provider: 'codex' },
            });
            break;
          }

          // ── Model reroute ───────────────────────────────────────
          case 'model/rerouted': {
            const notif = params as V2ModelReroutedNotification;
            this.broadcast(conv, {
              kind: 'harness.session_info',
              data: {
                infoType: 'model_rerouted',
                message: `Model rerouted from ${notif.fromModel} to ${notif.toModel} (${String(notif.reason)})`,
                fromModel: notif.fromModel,
                toModel: notif.toModel,
                reason: notif.reason,
                provider: 'codex',
              },
            });
            break;
          }

          // ── Working-tree diff ───────────────────────────────────
          case 'turn/diff/updated': {
            const notif = params as V2TurnDiffUpdatedNotification;
            if (!notif.diff) break;
            this.broadcast(conv, {
              kind: 'harness.session_info',
              data: { infoType: 'turn_diff', message: notif.diff, diff: notif.diff, provider: 'codex' },
            });
            break;
          }

          case 'item/reasoning/summaryTextDelta':
          case 'item/reasoning/textDelta': {
            const notif = params as V2ReasoningSummaryTextDeltaNotification | V2ReasoningTextDeltaNotification;
            const kind = method === 'item/reasoning/summaryTextDelta' ? 'summary' : 'raw';
            // Some models stream both a summary and the raw text for one item;
            // relaying both would show the reasoning twice. First kind wins.
            const seen = reasoningKind.get(notif.itemId);
            if (seen && seen !== kind) break;
            reasoningKind.set(notif.itemId, kind);
            if (notif.delta) {
              reasoningText.set(notif.itemId, (reasoningText.get(notif.itemId) ?? '') + notif.delta);
              this.broadcast(conv, { kind: 'harness.reasoning_delta', data: { text: notif.delta } });
            }
            break;
          }

          case 'thread/tokenUsage/updated': {
            const usage = (params as V2ThreadTokenUsageUpdatedNotification).tokenUsage;
            if (!usage) break;
            const total = {
              input: usage.total.inputTokens,
              output: usage.total.outputTokens,
              cached: usage.total.cachedInputTokens ?? 0,
            };
            // The first report of a turn already includes that turn's first
            // request, so its baseline is the total minus `last`.
            usageAtStart ??= {
              input: total.input - usage.last.inputTokens,
              output: total.output - usage.last.outputTokens,
              cached: total.cached - (usage.last.cachedInputTokens ?? 0),
            };
            usageLatest = total;
            this.broadcast(conv, {
              kind: 'harness.context_usage',
              data: {
                provider: 'codex',
                ...(model ? { model } : {}),
                source: 'provider',
                // What the most recent request actually occupied.
                currentTokens: usage.last.inputTokens + usage.last.outputTokens,
                ...(usage.modelContextWindow ? { totalContextWindow: usage.modelContextWindow, promptTokenLimit: usage.modelContextWindow } : {}),
                // The same request the total describes, split the way the
                // gauge shows it. Codex counts cached tokens INSIDE
                // `inputTokens` (the OpenAI convention), so the uncached part
                // is the difference — and input + cache read + output adds up
                // to the figure above them. Without this the Codex popover had
                // no token rows at all: a percentage, and nothing behind it.
                apiUsage: {
                  input: Math.max(0, usage.last.inputTokens - (usage.last.cachedInputTokens ?? 0)),
                  cacheRead: usage.last.cachedInputTokens ?? 0,
                  ...(usage.last.cacheWriteInputTokens ? { cacheWrite: usage.last.cacheWriteInputTokens } : {}),
                  output: usage.last.outputTokens,
                },
              },
            });
            break;
          }

          case 'item/started': {
            const item = (params as V2ItemStartedNotification).item;
            if (item?.type === 'subAgentActivity') {
              emitSubAgentActivity(item);
              break;
            }
            if (item && TOOL_ITEM_TYPES.has(item.type)) {
              const { tool, args } = describeToolItem(item);
              pendingToolItems.add(item.id);
              if (item.type === 'commandExecution') conv.turnCommandItems.add(item.id);
              if (item.type === 'fileChange') rememberFileChange(conv, item.id, (item as unknown as { changes?: unknown }).changes);
              this.broadcast(conv, {
                kind: 'harness.tool_start',
                data: { tool, args, callId: item.id },
              });
            }
            break;
          }

          case 'item/completed': {
            const item = (params as V2ItemCompletedNotification).item;
            if (!item) break;
            if (item.type === 'subAgentActivity') {
              emitSubAgentActivity(item);
              break;
            }
            if (TOOL_ITEM_TYPES.has(item.type)) {
              const { tool } = describeToolItem(item);
              const { success, result } = summariseToolResult(item);
              const fileOp = success ? fileOpForChange(item) : undefined;
              pendingToolItems.delete(item.id);
              this.broadcast(conv, {
                kind: 'harness.tool_complete',
                data: { tool, result, callId: item.id, success, ...(fileOp ? { fileOp } : {}) },
              });
            } else if (item.type === 'agentMessage') {
              // One discrete assistant segment. The completed item carries its
              // authoritative text (deltas can be coalesced upstream), and the
              // chat persists each segment separately, in order.
              const { text, phase } = item as unknown as { text?: string; phase?: string };
              if (typeof text === 'string' && text.trim()) {
                this.broadcast(conv, { kind: 'harness.message_complete', data: { content: text } });
                if (phase === 'final_answer') finalAnswer = text;
              }
            } else if (item.type === 'plan') {
              // The authoritative text of a plan the deltas were building.
              const text = (item as unknown as { text?: string }).text
                ?? planText.get(item.id)
                ?? '';
              planText.delete(item.id);
              const steps = parsePlanText(text);
              if (steps.length) emitPlanUpdate(steps);
              break;
            } else if (item.type === 'contextCompaction') {
              // The item form of `thread/compacted`; one notice either way.
              const turnKey = conv.activeTurnId ?? item.id;
              if (!compactedTurns.has(turnKey)) {
                compactedTurns.add(turnKey);
                this.broadcast(conv, {
                  kind: 'harness.session_info',
                  data: { infoType: 'compact_boundary', message: 'Context compacted (auto)', provider: 'codex' },
                });
              }
              break;
            } else if (item.type === 'reasoning') {
              const streamed = reasoningText.get(item.id) ?? '';
              const { summary, content } = item as unknown as { summary?: string[]; content?: string[] };
              const full = (summary?.length ? summary : content ?? []).join('\n\n');
              const text = full.length >= streamed.length ? full : streamed;
              if (text.trim()) this.broadcast(conv, { kind: 'harness.reasoning_complete', data: { content: text } });
            }
            break;
          }

          case 'error': {
            const notif = params as V2ErrorNotification;
            // `willRetry` means the server is handling it, so the turn must NOT
            // be ended — but saying nothing left the user watching a spinner
            // through a retry that can take tens of seconds, with no way to
            // tell it apart from a hang.
            if (notif.willRetry) {
              this.broadcast(conv, {
                kind: 'harness.session_info',
                data: {
                  infoType: 'provider_retry',
                  message: `Codex is retrying: ${notif.error?.message ?? 'transient error'}`,
                  ...(errorInfoTag(notif.error?.codexErrorInfo)
                    ? { errorInfo: errorInfoTag(notif.error?.codexErrorInfo) }
                    : {}),
                  provider: 'codex',
                },
              });
              break;
            }
            const tag = errorInfoTag(notif.error?.codexErrorInfo);
            const message = notif.error?.message ?? 'Unknown Codex error';
            if (tag && RETRYABLE_ERROR_INFO.has(tag)) {
              finish(() => reject(new CodexRateLimitedError(notif.error!.codexErrorInfo!, message)));
              break;
            }
            if (tag && TRUNCATION_ERROR_INFO.has(tag)) {
              finish(() => {
                failOpenToolCalls(tag);
                this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
                resolve({ content: assistantText });
              });
              break;
            }
            finish(() => {
              this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
              reject(new Error(message));
            });
            break;
          }

          case 'turn/completed': {
            const turn: V2Turn | undefined = (params as V2TurnCompletedNotification).turn;
            // `turn/completed` identifies its turn inside the payload rather
            // than as a sibling `turnId`, so the guard above cannot see it.
            if (turn?.id) {
              if (conv.retiredTurns.has(turn.id)) break;
              if (conv.activeTurnId && turn.id !== conv.activeTurnId) break;
            }
            finish(() => {
              const status = turn?.status;
              if (status === 'interrupted') {
                this.broadcast(conv, {
                  kind: 'harness.cancelled',
                  data: { reason: 'user_abort', provider: 'codex' },
                });
                resolve({ content: assistantText });
                return;
              }
              if (status === 'failed') {
                const err: V2TurnError | null | undefined = turn?.error;
                const tag = errorInfoTag(err?.codexErrorInfo);
                const message = err?.message ?? 'Codex turn failed';
                if (tag && RETRYABLE_ERROR_INFO.has(tag)) {
                  reject(new CodexRateLimitedError(err!.codexErrorInfo!, message));
                  return;
                }
                if (tag && TRUNCATION_ERROR_INFO.has(tag)) failOpenToolCalls(tag);
                this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
                reject(new Error(message));
                return;
              }
              if (usageLatest && usageAtStart) {
                this.broadcast(conv, {
                  kind: 'harness.usage',
                  data: {
                    model,
                    // Uncached input and cache reads apart, as the other
                    // providers report them: `inputTokens` alone made a turn
                    // that re-read a 35k cached prefix eight times look like
                    // 282k tokens of fresh input.
                    inputTokens: Math.max(
                      0,
                      usageLatest.input - usageAtStart.input - (usageLatest.cached - usageAtStart.cached),
                    ),
                    cacheReadTokens: usageLatest.cached - usageAtStart.cached,
                    outputTokens: usageLatest.output - usageAtStart.output,
                    durationMs: Date.now() - turnStartedAt,
                    provider: 'codex',
                  },
                });
              }
              // `providerTurnId` is the anchor `thread/fork` / `thread/revert` take.
              if (turn?.id) this.broadcast(conv, { kind: 'harness.turn_end', data: { turnId: turn.id, providerTurnId: turn.id } });
              this.broadcast(conv, { kind: 'harness.idle', data: {} });
              resolve({ content: finalAnswer ?? assistantText });
            });
            break;
          }

          default:
            break;
        }
      });

      // Fire the turn request. Notifications drive completion, but the request
      // itself can still fail.
      this.rpc<V2TurnStartResponse>('turn/start', turnParams).then(
        (res) => {
          conv.activeTurnId = res.turn?.id ?? null;
          // A turn that was cancelled between the request and its answer must
          // be interrupted now that we finally know its id.
          if (conv.cancelRequested) void this.interruptActiveTurn(conv);
        },
        (err: unknown) => {
          finish(() => {
            const message = err instanceof Error ? err.message : String(err);
            this.broadcast(conv, { kind: 'harness.error', data: { message, provider: 'codex' } });
            reject(err instanceof Error ? err : new Error(message));
          });
        },
      );
    });
  }

  /**
   * Maps a per-turn permission mode onto Codex's per-turn approval policy.
   *
   * Only the modes with an honest Codex equivalent are mapped; the rest fall
   * through to the thread's policy rather than being approximated. Returning
   * `{}` is deliberate — an unmapped mode must inherit, not silently become
   * `never`.
   */
  private approvalPolicyForTurn(
    options: SendPromptOptions | undefined,
  ): Pick<V2TurnStartParams, 'approvalPolicy'> {
    switch (options?.permissionMode) {
      case 'bypassPermissions':
      case 'dontAsk':
        return { approvalPolicy: 'never' }; // security-ok: not a default — translates the caller's EXPLICIT bypass request into Codex's vocabulary
      case 'acceptEdits':
      case 'default':
        return { approvalPolicy: 'on-request' };
      case 'plan':
        // Codex has no plan mode. The guarantee a plan turn needs — nothing is
        // written — comes from the READ-ONLY SANDBOX this turn also gets (see
        // `sandboxPolicyForTurn`), not from the approval policy. It used to be
        // `untrusted`, which asks the user before every command that is not on
        // Codex's short safe list: a plan turn's whole first step is reading
        // code, and each `nl -ba src/pricing/money.js` stopped at an
        // Allow / Deny card. With the sandbox holding the line, `on-request`
        // lets reads run and still routes any attempt to write to the user.
        return { approvalPolicy: 'on-request' };
      default:
        return {};
    }
  }

  /**
   * The sandbox for this turn.
   *
   * A turn's `sandboxPolicy` applies to "this turn and subsequent turns", so a
   * plan turn's read-only sandbox has to be explicitly UNDONE by the next
   * ordinary turn — otherwise approving a plan and then asking for anything
   * else would leave the chat unable to write for the rest of the thread.
   */
  private sandboxPolicyForTurn(
    conv: ConversationState,
    options: SendPromptOptions | undefined,
  ): Pick<V2TurnStartParams, 'sandboxPolicy'> {
    const planning = options?.permissionMode === 'plan' || options?.agentMode === 'plan';
    if (planning) {
      conv.sandboxNarrowedForPlan = true;
      return { sandboxPolicy: { type: 'readOnly' } };
    }
    if (conv.sandboxPolicy) {
      conv.sandboxNarrowedForPlan = false;
      return { sandboxPolicy: conv.sandboxPolicy };
    }
    if (!conv.sandboxNarrowedForPlan) return {};
    conv.sandboxNarrowedForPlan = false;
    switch (this.opts.sandboxMode) {
      case 'danger-full-access':
        return { sandboxPolicy: { type: 'dangerFullAccess' } };
      case 'read-only':
        return { sandboxPolicy: { type: 'readOnly' } };
      default:
        return { sandboxPolicy: { type: 'workspaceWrite' } };
    }
  }

  /** Build the `input` array, carrying image attachments through as local images. */
  private buildInput(prompt: string, attachments?: AttachmentRef[]): V2UserInput[] {
    const input: V2UserInput[] = [{ type: 'text', text: prompt, text_elements: [] }];
    for (const att of attachments ?? []) {
      if (att.type !== 'file' || !att.path) continue;
      // Attachments used to be accepted and dropped on the floor. Images are
      // the one kind the protocol takes inline; anything else is mentioned by
      // path so the model can open it with its own file tools.
      if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(att.path)) {
        input.push({ type: 'localImage', path: att.path });
      } else {
        // `mention` is a resource/connector mention, not a readable file
        // attachment. Give the model an explicit local-file reference so it
        // can use its file tools even when the upload lives outside cwd.
        input.push({
          type: 'text',
          text: `User-attached file: ${JSON.stringify({ name: att.displayName ?? att.path, path: att.path })}\nRead this file with your file tools when needed for the user's request.`,
          text_elements: [],
        });
      }
    }
    return input;
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return [];
    const out: ConversationMessage[] = [];
    try {
      // `thread/items/list` is real and paginated; the previous version
      // returned `[]` with a comment claiming Codex "does not expose message
      // history", which it does.
      let cursor: string | undefined;
      do {
        const page = await this.rpc<V2ThreadItemsListResponse>('thread/items/list', {
          threadId: conv.threadId,
          ...(cursor ? { cursor } : {}),
        });
        for (const entry of page.data ?? []) {
          const item = entry.item;
          if (item?.type === 'userMessage') {
            const content = (item as unknown as { content?: Array<{ text?: string }> }).content;
            out.push({
              role: 'user',
              content: (content ?? []).map((c) => c.text ?? '').join(''),
            });
          } else if (item?.type === 'agentMessage') {
            out.push({ role: 'assistant', content: (item as unknown as { text?: string }).text ?? '' });
          }
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    } catch {
      // History is best-effort; a failure here must not break the caller.
    }
    return out;
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv || !conv.inFlight) return;
    conv.cancelRequested = true;
    // W13: settle the turn ourselves rather than waiting for the binary to
    // acknowledge. `settleTurn` emits `harness.cancelled` AND resolves the
    // awaited promise, which is what releases `inFlight`; the interrupt below
    // is the courtesy notification to the child.
    void this.interruptActiveTurn(conv);
    conv.settleTurn?.();
  }

  /**
   * Best-effort `turn/interrupt`, deliberately not awaited by callers: a wedged
   * or dead child must not be able to hold a Stop hostage.
   */
  private async interruptActiveTurn(conv: ConversationState): Promise<void> {
    const turnId = conv.activeTurnId;
    if (!turnId) return; // turn/start has not answered yet — nothing to interrupt
    // Read now: the caller settles the turn right after this returns control.
    const commandItems = new Set(conv.turnCommandItems);
    const { threadId } = conv;
    try {
      await this.rpc('turn/interrupt', { threadId, turnId });
    } catch { /* best effort */ }
    if (commandItems.size === 0) return;
    // `turn/interrupt` ends the turn but leaves a running command alive as a
    // background terminal (verified against codex 0.153: it even outlives the
    // app-server). Terminate the ones this turn started.
    try {
      const listed = await this.rpc<{ data?: Array<{ itemId: string; processId: string }> }>(
        'thread/backgroundTerminals/list',
        { threadId },
      );
      await Promise.all(
        (listed.data ?? [])
          .filter((t) => commandItems.has(t.itemId))
          .map((t) =>
            this.rpc('thread/backgroundTerminals/terminate', { threadId, processId: t.processId }).catch(() => undefined),
          ),
      );
    } catch (err) {
      this.opts.logger?.warn?.(
        `[CodexProvider] could not stop the commands of an interrupted turn: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Events ────────────────────────────────────────────────────────

  onConversationEvent(
    conversationId: string,
    handler: Listener<AgentEvent>,
  ): UnsubFn {
    const conv = this.conversations.get(conversationId);
    if (!conv) return () => { /* noop */ };
    conv.listeners.add(handler);
    return () => conv.listeners.delete(handler);
  }

  // ── Private helpers ───────────────────────────────────────────────

  private broadcast(conv: ConversationState, event: AgentEvent): void {
    for (const h of conv.listeners) h(event);
  }

  /** The conversation using a given Codex thread, when one is live. */
  private convForThread(threadId: unknown): ConversationState | undefined {
    if (typeof threadId !== 'string') return undefined;
    return [...this.conversations.values()].find((c) => c.threadId === threadId);
  }

  /**
   * A notice that belongs to every open chat (a config warning, a deprecation,
   * a quota change) — none of which name a thread.
   */
  private broadcastAll(event: AgentEvent): void {
    for (const conv of this.conversations.values()) this.broadcast(conv, event);
  }

  /**
   * Notifications that are NOT scoped to the turn being awaited.
   *
   * Three groups the per-turn handler structurally cannot serve:
   *   • provider-wide notices (`warning`, `configWarning`, `deprecationNotice`)
   *     which carry no `threadId`, so the per-turn thread guard drops them;
   *   • `account/rateLimits/updated`, likewise thread-less, and needed even
   *     when no turn is running;
   *   • thread lifecycle (`thread/status/changed`, `thread/closed`), which must
   *     settle an in-flight turn — a thread in `systemError` will never send
   *     another notification, so the turn would otherwise hang until the RPC
   *     deadline and surface as an unexplained timeout.
   *
   * Handled ONLY here, never also in `runTurnOnce`, so nothing is emitted twice.
   */
  private handleGlobalNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    const warn = (message: string, details?: string | null): void => {
      if (!message.trim()) return;
      const event: AgentEvent = {
        kind: 'harness.session_info',
        data: {
          infoType: 'provider_warning',
          message,
          ...(details ? { details } : {}),
          provider: 'codex',
        },
      };
      const conv = this.convForThread(p['threadId']);
      if (conv) this.broadcast(conv, event);
      else this.broadcastAll(event);
    };

    switch (method) {
      case 'warning':
        warn((params as V2WarningNotification).message);
        return;

      case 'guardianWarning':
        warn((params as V2GuardianWarningNotification).message);
        return;

      case 'configWarning': {
        const notif = params as V2ConfigWarningNotification;
        // The path is the actionable half — "your config is wrong" with no
        // file to open is not something a user can do anything about.
        warn(
          notif.path ? `${notif.summary} (${notif.path})` : notif.summary,
          notif.details ?? null,
        );
        return;
      }

      case 'deprecationNotice': {
        const notif = params as V2DeprecationNoticeNotification;
        warn(`Deprecated: ${notif.summary}`, notif.details ?? null);
        return;
      }

      case 'account/rateLimits/updated': {
        const snapshot = (params as V2AccountRateLimitsUpdatedNotification).rateLimits;
        if (!snapshot) return;
        this.rateLimits = snapshot;
        this.broadcastAll({
          kind: 'harness.session_info',
          data: {
            infoType: 'rate_limits',
            message: describeRateLimits(snapshot),
            rateLimits: snapshot,
            provider: 'codex',
          },
        });
        return;
      }

      case 'thread/status/changed': {
        const notif = params as V2ThreadStatusChangedNotification;
        const conv = this.convForThread(notif.threadId);
        if (!conv) return;
        if (notif.status?.type !== 'systemError') {
          this.opts.logger?.debug?.(
            `[CodexProvider] thread ${notif.threadId} → ${String(notif.status?.type)}`,
          );
          return;
        }
        conv.failTurn?.('The Codex thread entered a system error state.');
        return;
      }

      case 'thread/closed': {
        const conv = this.convForThread((params as V2ThreadClosedNotification).threadId);
        conv?.failTurn?.('The Codex thread was closed before the turn finished.');
        return;
      }

      default:
        return;
    }
  }

  /** Parse one NDJSON line from the child's stdout. */
  private onStdoutLine(line: string): void {
    if (!line.trim()) return;
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(line) as IncomingMessage;
    } catch {
      return; // Non-JSON line (e.g. a startup banner) — ignore.
    }

    // A message carrying BOTH an id and a method is a server→client REQUEST
    // and must be answered, or the turn that raised it blocks until it times
    // out. This branch did not exist before.
    if (msg.id != null && typeof msg.method === 'string') {
      this.handleServerRequest(msg.id, msg.method, msg.params);
      return;
    }

    if (msg.id != null) {
      const pending = this.pendingRpc.get(msg.id);
      if (!pending) return;
      this.clearPending(msg.id);
      // A JSON-RPC error response is a FAILURE. Resolving it as a success is
      // what let a failed thread start pass silently.
      if (msg.error) {
        pending.reject(new CodexRpcError(msg.error.code, msg.error.message, msg.error.data));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (typeof msg.method === 'string') {
      const { method, params } = msg;
      for (const h of [...this.notificationListeners]) h(method, params);
    }
  }

  /**
   * Answer a server→client request.
   *
   * Fail-closed: unless the host supplies an `onApproval` decision, anything
   * that would run a command, write a file or widen permissions is DECLINED.
   * The important part is that it is answered at all — an unanswered approval
   * stalls the turn indefinitely, which is what happened before.
   */
  private handleServerRequest(id: string | number, method: string, params: unknown): void {
    const respond = (result: unknown): void => this.writeMessage({ id, result });
    const respondError = (code: number, message: string): void =>
      this.writeMessage({ id, error: { code, message } });

    const threadId = (params as { threadId?: unknown } | undefined)?.threadId;
    const conv = typeof threadId === 'string'
      ? [...this.conversations.values()].find((c) => c.threadId === threadId)
      : undefined;

    const decide = async (): Promise<void> => {
      // Host tools answer themselves; nothing below applies to them.
      if (method === 'item/tool/call') {
        respond(await this.runHostTool(conv, params));
        return;
      }
      // A question is not an approval: it goes to the chat's question gate, and
      // the answer is content, not a decision. Routing it through the approval
      // path (or answering `{}` as this used to) threw the model's question
      // away and left it to guess.
      if (method === 'item/tool/requestUserInput') {
        respond(await this.answerUserInput(conv, params as ToolRequestUserInputParams));
        return;
      }
      // The conversation's own permission handler (the chat's approval UI) is
      // the authority when there is one; the provider-wide hook next; and with
      // neither, fail closed.
      let approved: boolean;
      /** The user asked not to be re-prompted for this kind of call. */
      let remember = false;
      const ask = conv?.params.onPermissionRequest;
      if (ask) {
        const answer = await ask(toPermissionRequest(method, withFileChangePaths(conv, method, params)));
        approved = answer.granted;
        remember = answer.granted && answer.remember === true;
      } else {
        approved = (this.opts.onApproval ? await this.opts.onApproval({ method, params }) : 'decline') === 'accept';
      }

      switch (method) {
        case 'item/commandExecution/requestApproval': {
          // `acceptForSession` is Codex's own "don't ask again", so honouring
          // the user's remembered choice stops the binary re-prompting for the
          // rest of the thread instead of asking on every single command.
          const decision: CommandExecutionApprovalDecision = approved
            ? (remember ? 'acceptForSession' : 'accept')
            : 'decline';
          respond({ decision });
          return;
        }
        case 'item/fileChange/requestApproval': {
          const decision: FileChangeApprovalDecision = approved
            ? (remember ? 'acceptForSession' : 'accept')
            : 'decline';
          respond({ decision });
          return;
        }
        // Legacy approval methods, still emitted by older binaries.
        case 'execCommandApproval':
        case 'applyPatchApproval':
          respond({
            decision: approved
              ? (remember ? 'approved_for_session' : 'approved')
              : { denied: { rejection: 'Denied by host policy.' } },
          });
          return;
        case 'item/permissions/requestApproval': {
          // Never auto-granted: reaching here means a human (or the host's
          // explicit `onApproval` hook) said yes. The grant echoes back exactly
          // the profile that was requested — inventing a different one would
          // hand the model access nobody was shown — and is scoped to the
          // TURN, so a widened sandbox does not outlive the request for it.
          if (!approved) {
            respondError(-32001, 'Permission escalation declined by host policy.');
            return;
          }
          const requested = (params as PermissionsRequestApprovalParams | undefined)?.permissions ?? {};
          respond({ permissions: requested, scope: 'turn' });
          return;
        }
        case 'mcpServer/elicitation/request':
          respond({ action: approved ? 'accept' : 'decline' });
          return;
        case 'account/chatgptAuthTokens/refresh':
        case 'attestation/generate':
          respondError(-32601, `${method} is not supported by this host.`);
          return;
        default:
          respondError(-32601, `Unhandled server request "${method}".`);
      }
    };

    void decide().catch((err: unknown) => {
      // An approval callback that throws must not leave the request dangling.
      respondError(-32603, err instanceof Error ? err.message : String(err));
    });
  }

  /**
   * Answer `item/tool/requestUserInput` through the chat's question gate.
   *
   * Codex BLOCKS the turn on this when `isBlocking` is set, and the previous
   * `{ answers: {} }` reply told the model "the user declined to answer every
   * question" — so a model that stopped to ask which of two APIs to use was
   * told nothing and picked one at random. `onQuestionRequest` is the same gate
   * Claude's `AskUserQuestion` goes through, so a Codex question renders as the
   * platform's own question card with no provider-specific UI.
   *
   * Still answered — with an empty map — when the conversation registered no
   * handler: an unanswered request stalls the turn until the RPC deadline.
   */
  private async answerUserInput(
    conv: ConversationState | undefined,
    params: ToolRequestUserInputParams | undefined,
  ): Promise<ToolRequestUserInputResponse> {
    const questions = params?.questions ?? [];
    const gate = conv?.params.onQuestionRequest;
    if (!gate || questions.length === 0) return { answers: {} };

    const asked: AgentQuestion[] = questions.map((q) => ({
      id: q.id,
      header: q.header,
      question: q.question,
      options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })),
      // Codex's schema has no multi-select flag; a question that wants several
      // answers still returns an array, so nothing is lost by asking for one.
      multiSelect: false,
      // `isOther` is Codex saying "an answer outside the options is allowed".
      allowFreeform: q.isOther === true,
    }));

    try {
      const response = await gate({ questions: asked });
      const answers: Record<string, { answers: string[] }> = {};
      for (const q of questions) {
        const picked = response.answers?.[q.id];
        if (picked?.length) answers[q.id] = { answers: picked };
        // A user who dismissed the card and typed a reply instead has answered
        // — just not in the structured shape. Dropping that text would ask the
        // model to proceed as though nobody said anything.
        else if (response.freeformResponse) answers[q.id] = { answers: [response.freeformResponse] };
      }
      return { answers };
    } catch (err) {
      this.opts.logger?.warn?.(
        `[CodexProvider] question gate failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { answers: {} };
    }
  }

  /**
   * Execute a host tool Codex called (`item/tool/call`) with the handler the
   * conversation registered, and shape the result as Codex expects. A missing
   * tool or a throwing handler is reported to the model as a failed call — it
   * must be answered either way, or the turn blocks.
   */
  private async runHostTool(
    conv: ConversationState | undefined,
    params: unknown,
  ): Promise<{ success: boolean; contentItems: Array<{ type: 'inputText'; text: string }> }> {
    const { tool, arguments: args } = (params ?? {}) as { tool?: string; arguments?: unknown };
    const text = (v: string) => [{ type: 'inputText' as const, text: v }];
    const def = conv?.params.tools?.find((t) => t.name === tool);
    if (!def) return { success: false, contentItems: text(`Tool "${String(tool)}" is not available in this conversation.`) };
    try {
      const out = await def.handler((args && typeof args === 'object' ? args : {}) as Record<string, unknown>);
      return { success: true, contentItems: text(typeof out === 'string' ? out : JSON.stringify(out ?? null)) };
    } catch (err) {
      return { success: false, contentItems: text(err instanceof Error ? err.message : String(err)) };
    }
  }

  private rpcIdNext(): number {
    return ++this.rpcIdCounter;
  }

  private clearPending(id: string | number): void {
    const pending = this.pendingRpc.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRpc.delete(id);
  }

  /** Reject and drop every outstanding call — the child can no longer answer. */
  private failAllPendingRpc(err: Error): void {
    if (this.pendingRpc.size === 0) return;
    const entries = [...this.pendingRpc.entries()];
    this.pendingRpc.clear();
    for (const [, pending] of entries) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
  }

  /** Cancel every in-flight turn — used when the child dies or we shut down. */
  private settleAllTurns(): void {
    for (const conv of this.conversations.values()) conv.settleTurn?.();
  }

  private teardownIo(): void {
    this.globalNotificationUnsub?.();
    this.globalNotificationUnsub = null;
    // A readline interface left open keeps its 'line' listener — and the
    // stdout fd — alive for the lifetime of the provider.
    this.rl?.close();
    this.rl = null;
    this.proc?.stdout?.removeAllListeners('data');
    this.proc?.stderr?.removeAllListeners('data');
  }

  private captureStderr(chunk: string): void {
    const cap = this.opts.stderrCaptureBytes;
    if (cap <= 0) return;
    this.stderrTail = (this.stderrTail + chunk).slice(-cap);
  }

  /** Attach the captured stderr tail to a message, when there is any. */
  private withStderr(message: string): string {
    const tail = this.stderrTail.trim();
    return tail ? `${message}\n--- codex stderr (last ${tail.length} bytes) ---\n${tail}` : message;
  }

  /** Write one JSON-RPC message to the child's stdin. */
  private writeMessage(message: Record<string, unknown>): void {
    const stdin = this.proc?.stdin;
    if (!stdin || stdin.destroyed) return;
    stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  }

  /** Send a notification (no id, no reply expected). */
  private notify(method: string, params: unknown): void {
    this.writeMessage(params === undefined ? { method } : { method, params });
  }

  private async rpc<R = unknown>(method: string, params?: unknown): Promise<R> {
    const proc = this.proc;
    if (!proc?.stdin || proc.stdin.destroyed) {
      throw new Error('CodexProvider: not initialized (call initialize() first)');
    }
    const id = this.rpcIdNext();
    return new Promise<R>((resolve, reject) => {
      // Every call is bounded. Without this a child that accepts the write and
      // never answers holds its caller forever, and `pendingRpc` grows without
      // limit — the map is only otherwise pruned by a matching response.
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(
          this.withStderr(`CodexProvider: '${method}' timed out after ${this.opts.rpcTimeoutMs} ms`),
        ));
      }, this.opts.rpcTimeoutMs);
      timer.unref?.();

      this.pendingRpc.set(id, {
        resolve: resolve as (r: unknown) => void,
        reject,
        timer,
      });

      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      proc.stdin!.write(payload + '\n', (err) => {
        if (!err) return;
        this.clearPending(id);
        reject(new Error(`CodexProvider: failed to write '${method}' to codex stdin: ${err.message}`));
      });
    });
  }

  private onNotification(handler: (method: string, params: unknown) => void): UnsubFn {
    this.notificationListeners.add(handler);
    return () => this.notificationListeners.delete(handler);
  }
}

/** Re-exported so hosts can type an approval policy without a deep import. */
export type CodexApprovalPolicy = V2AskForApproval;
export type CodexSandboxMode = V2SandboxMode;
