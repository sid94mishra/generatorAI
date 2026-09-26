// ────────────────────────────────────────────────────────────────
// W44 — FauxProvider
//
// A deterministic IAgentHarness implementation for testing.
// Shipped in the package (not test files) so any consumer's test suite
// can import it without reaching into __tests__ directories.
//
// Callers configure a script of responses before calling sendPrompt.
// The provider replays the script, pausing at tool_call entries until
// provideToolResult() is called.
//
// Usage:
//   const faux = new FauxProvider();
//   faux.script([
//     { type: 'text', content: 'I will read the file.' },
//     { type: 'tool_call', name: 'Read', input: { file_path: '/foo' } },
//     // test calls: await faux.provideToolResult(callId, 'hello')
//     { type: 'text', content: 'The file contains: hello' },
//     { type: 'complete' },
//   ]);
//   await harness.sendPromptAndWait(convId, 'read /foo');
// ────────────────────────────────────────────────────────────────

import type {
  IAgentHarness,
  IHarnessClientLifecycle,
  IHarnessModelDiscovery,
  IHarnessConversationLifecycle,
  IHarnessMessaging,
  IHarnessEvents,
  HarnessClientEvent,
  HarnessClientState,
  HarnessModel,
  CreateConversationParams,
  ConversationResult,
  ConversationWarning,
  HarnessAgentInfo,
  ConversationMessage,
  ConversationResponse,
  AttachmentRef,
  SendPromptOptions,
  ProviderCapabilities,
  PermissionRequest,
} from '@generatorai/core';
import type { AgentEvent, AgentQuestion } from '@generatorai/shared';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path';

// ── Model catalog ────────────────────────────────────────────────
//
// P2-00 — extracted to a standalone constant so `HarnessRegistry` can report
// the same catalog synchronously (it needs a model list before any
// conversation exists to call `getModels()` on) without duplicating it.
export const FAUX_MODELS: HarnessModel[] = [
  {
    id: 'faux-model',
    name: 'Faux Model',
    provider: 'faux',
    description: 'Deterministic faux model for testing',
    promptTokenLimit: 200_000,
    totalContextWindow: 200_000,
  },
];

// ── Script entry types ──────────────────────────────────────────

/** Emit text token-by-token (word-split for realism). */
export interface FauxTextEntry {
  type: 'text';
  content: string;
}

/** Emit a tool_start event and wait for provideToolResult(). */
export interface FauxToolCallEntry {
  type: 'tool_call';
  name: string;
  input: Record<string, unknown>;
  /** Caller may override the callId; defaults to auto-assigned. */
  callId?: string;
}

/**
 * Invoke one of the conversation's REGISTERED tools (the `tools` handed to
 * `createConversation`, e.g. the orchestrator's `spawn_background_agent`) with
 * `input`, emitting tool_start / tool_complete around the real handler — so a
 * scripted chat can drive GeneratorAI's own tools end to end, the way a real
 * model does. An unknown tool completes with `success: false`.
 */
export interface FauxToolInvokeEntry {
  type: 'tool_invoke';
  name: string;
  input: Record<string, unknown>;
  callId?: string;
}

/** Emit a tool_error event (for B1 truncation testing). */
export interface FauxToolErrorEntry {
  type: 'tool_error';
  name: string;
  error: string;
  callId?: string;
}

/** End the turn with success. */
export interface FauxCompleteEntry {
  type: 'complete';
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
}

/** End the turn with semantic cancellation (not a throw). */
export interface FauxCancelledEntry {
  type: 'cancelled';
  reason?: 'user_abort' | 'timeout' | 'budget_exceeded';
}

/**
 * End the turn with stop_reason='length' — all pending tool calls receive
 * a synthetic error, exercising the W13/B1 truncation guard.
 */
export interface FauxTruncatedEntry {
  type: 'truncated';
}

/** End the turn with a harness error. */
export interface FauxErrorEntry {
  type: 'error';
  message: string;
}

/** Max-turns exhaustion delivered as an in-band error (not a throw). */
export interface FauxExhaustedEntry {
  type: 'exhausted';
  maxTurns: number;
}

/**
 * P2-00 — write, overwrite or delete a real file under the conversation's
 * `workingDirectory`, so a scripted turn produces a REAL diff for the
 * Changes dock / git status to find (09-verification.md §4.2: "file edits
 * happen in a seeded dummy repo so the Changes dock has real diffs").
 *
 * Emits a `harness.tool_start` / `harness.tool_complete` pair around the
 * write, with a best-effort `fileOp` line-count stat, so the transcript shows
 * a tool card exactly like a real Write/Edit tool call would.
 */
export interface FauxFileEditEntry {
  type: 'file_edit';
  /** Relative to `CreateConversationParams.workingDirectory` (or absolute). */
  path: string;
  /** New full file content. Ignored when `op` is 'delete'. */
  content?: string;
  /**
   * Defaults to 'delete' when `content` is omitted, otherwise 'update' when
   * the file already exists on disk and 'create' when it does not.
   */
  op?: 'create' | 'update' | 'delete';
  /** Tool name shown in the transcript. Defaults to 'Write' (or 'Delete'). */
  toolName?: string;
  callId?: string;
}

/**
 * P2-00 — drive `CreateConversationParams.onQuestionRequest`, the same
 * blocking gate a real provider's clarifying-question tool uses
 * (`ChatManagementService.buildQuestionHandler`). Requires plan mode to be
 * enabled and the handler to have been installed on this conversation;
 * otherwise the entry is skipped with a `harness.warning` event rather than
 * throwing, since not every conversation configures the gate.
 */
export interface FauxAskQuestionEntry {
  type: 'ask_question';
  questions: AgentQuestion[];
}

/**
 * P2-00 — drive `CreateConversationParams.onPermissionRequest`, the same
 * blocking gate a real provider's tool-permission callback uses
 * (`ChatManagementService.buildPermissionHandler`). Same "skip with a
 * warning, don't throw" behaviour as {@link FauxAskQuestionEntry} when no
 * handler is installed.
 *
 * TODO(P2-00): `onPlanReviewRequest` (the plan-mode "review and approve the
 * plan" gate) and the HKS-01 hook bridge are NOT emulated yet — FauxProvider
 * never calls either, so a script cannot drive those interaction kinds today.
 */
export interface FauxPermissionRequestEntry {
  type: 'permission_request';
  request: PermissionRequest;
}

export type FauxScriptEntry =
  | FauxTextEntry
  | FauxToolCallEntry
  | FauxToolInvokeEntry
  | FauxToolErrorEntry
  | FauxCompleteEntry
  | FauxCancelledEntry
  | FauxTruncatedEntry
  | FauxErrorEntry
  | FauxExhaustedEntry
  | FauxFileEditEntry
  | FauxAskQuestionEntry
  | FauxPermissionRequestEntry;

/**
 * P2-00 — `GENERATORAI_TEST_FAUX_SCRIPT=<path.json>` file shape: turn-scripts
 * keyed by conversation NAME (the chat's human-readable name, not its id —
 * ids don't exist yet when the fixture is authored). Each array is consumed
 * in order, exactly like repeated calls to {@link FauxProvider.script}.
 */
export type FauxScriptFile = Record<string, FauxScriptEntry[][]>;

/** P2-00 — wires `GENERATORAI_TEST_FAUX_SCRIPT` into a `FauxProvider` instance. */
export interface FauxScriptSource {
  /** Path to the JSON `FauxScriptFile`. */
  filePath: string;
  /**
   * Resolves a conversation id to the human-readable name
   * `FauxScriptFile` is keyed by (typically the chat's `name`). Returning
   * `undefined` means "no script for this conversation" — never throws past
   * this boundary; a failing resolver is treated the same way.
   */
  resolveConversationName: (conversationId: string) => Promise<string | undefined>;
  logger?: { warn: (message: string) => void };
}

// ── Internal session state ────────────────────────────────────────

interface FauxConversationState {
  id: string;
  params: CreateConversationParams;
  messages: ConversationMessage[];
  handlers: Array<(event: AgentEvent) => void>;
  warnings: ConversationWarning[];
  /** Script to replay on the next sendPrompt. May be multi-turn. */
  pendingScript: FauxScriptEntry[][];
  /** Map from callId to resolver, populated at tool_call pause points. */
  pendingTools: Map<string, (result: unknown) => void>;
  /** Set while a sendPromptAndWait is in flight. */
  inFlight: boolean;
  /**
   * P2-00 — whether GENERATORAI_TEST_FAUX_SCRIPT has already been consulted
   * for this conversation. Applied lazily on the FIRST `sendPromptAndWait`
   * rather than at `createConversation` — see that method's comment for why.
   */
  scriptFileApplied: boolean;
}

// ── FauxProvider ─────────────────────────────────────────────────

let callIdSeq = 0;
function nextCallId(): string {
  return `faux-call-${++callIdSeq}`;
}

/**
 * P2-R21(c) — line count for a `fileOp` diff stat. `text.split('\n').length`
 * over-counts by one whenever `text` ends with a trailing newline (the
 * common case for a real file): `'a\nb\n'.split('\n')` is `['a', 'b', '']`,
 * length 3, for what is actually a 2-line file. Empty content is 0 lines.
 */
function countLines(text: string): number {
  if (text === '') return 0;
  const parts = text.split('\n').length;
  return text.endsWith('\n') ? parts - 1 : parts;
}

/**
 * W44 — Deterministic test double for IAgentHarness.
 *
 * Create one per test; call script() before sendPrompt; await provideToolResult()
 * when the test needs to supply a tool response.
 */
export class FauxProvider implements IAgentHarness {
  private state: HarnessClientState = 'stopped';
  private readonly clientHandlers: Array<(e: HarnessClientEvent) => void> = [];
  private readonly conversations = new Map<string, FauxConversationState>();
  private readonly capabilitiesOverride: Partial<ProviderCapabilities>;
  private readonly scriptSource: FauxScriptSource | undefined;
  private scriptFileCache: Promise<FauxScriptFile> | undefined;

  /**
   * W44 — configurable capabilities so conformance tests can exercise edge
   * cases.
   * P2-00 — `scriptSource` wires `GENERATORAI_TEST_FAUX_SCRIPT`: a fixture
   * file of turn-scripts keyed by conversation name, applied automatically
   * (once, lazily, on the conversation's first `sendPromptAndWait`) once the
   * conversation's name can be resolved.
   */
  constructor(opts: { capabilities?: Partial<ProviderCapabilities>; scriptSource?: FauxScriptSource } = {}) {
    this.capabilitiesOverride = opts.capabilities ?? {};
    this.scriptSource = opts.scriptSource;
  }

  // ── IHarnessClientLifecycle ─────────────────────────────────────

  capabilities(): ProviderCapabilities {
    return {
      vision: false,
      reasoning: false,
      reasoningEfforts: [],
      maxParallelTools: 8,
      planMode: false,
      mcpServers: false,
      skillDirectories: false,
      fullToolGating: true,
      sessionPersistence: false,
      budgetTracking: false,
      computerUse: false, // MINOR-4: explicit fail-closed default (L9)
      ...this.capabilitiesOverride,
    };
  }

  async initialize(): Promise<void> {
    this.state = 'running';
    this.emit({ type: 'client.started' });
  }

  async stop(): Promise<void> {
    this.state = 'stopped';
    this.emit({ type: 'client.stopped' });
  }

  async forceStop(): Promise<void> {
    return this.stop();
  }

  getClientState(): HarnessClientState {
    return this.state;
  }

  async ping(): Promise<boolean> {
    return this.state === 'running';
  }

  async shutdown(): Promise<void> {
    return this.stop();
  }

  onClientEvent(handler: (event: HarnessClientEvent) => void): () => void {
    this.clientHandlers.push(handler);
    return () => {
      const idx = this.clientHandlers.indexOf(handler);
      if (idx !== -1) this.clientHandlers.splice(idx, 1);
    };
  }

  private emit(event: HarnessClientEvent): void {
    for (const h of this.clientHandlers) h(event);
  }

  // ── IHarnessModelDiscovery ──────────────────────────────────────

  async getModels(): Promise<HarnessModel[]> {
    return [...FAUX_MODELS];
  }

  // ── IHarnessConversationLifecycle ───────────────────────────────

  async createConversation(params: CreateConversationParams): Promise<string> {
    const conv: FauxConversationState = {
      id: params.conversationId,
      params,
      messages: [],
      handlers: [],
      warnings: [],
      pendingScript: [],
      pendingTools: new Map(),
      inFlight: false,
      scriptFileApplied: false,
    };
    this.conversations.set(params.conversationId, conv);
    // Pre-registered via script(entries) with no conversationId, queued
    // before this conversation existed. This was previously dead code — the
    // "apply to the next created conversation" fallback documented on
    // `script()` never actually ran.
    this._transferScripts(conv);
    // P2-00 — GENERATORAI_TEST_FAUX_SCRIPT is applied lazily, on the first
    // `sendPromptAndWait` (see there), NOT here. Callers that build their
    // conversation config from a name that only becomes durable (e.g. a
    // caller-side DB row) AFTER `createConversation` returns — GeneratorAI's
    // own ChatManagementService.createChat does exactly this, persisting the
    // chat row only after the harness conversation is created — would
    // otherwise race a name lookup against a row that does not exist yet.
    return params.conversationId;
  }

  /** P2-00 — load (and cache) the GENERATORAI_TEST_FAUX_SCRIPT fixture file. */
  private async loadScriptFile(): Promise<FauxScriptFile> {
    const source = this.scriptSource;
    if (!source) return {};
    this.scriptFileCache ??= (async () => {
      try {
        const raw = await readFile(source.filePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('expected a JSON object keyed by conversation name');
        }
        return parsed as FauxScriptFile;
      } catch (err) {
        source.logger?.warn(
          `[FauxProvider] failed to load GENERATORAI_TEST_FAUX_SCRIPT file "${source.filePath}": ${String(err)}`,
        );
        return {};
      }
    })();
    return this.scriptFileCache;
  }

  /** P2-00 — resolve this conversation's name and queue its scripted turns, if any. */
  private async applyScriptFile(conv: FauxConversationState): Promise<void> {
    const source = this.scriptSource;
    if (!source) return;
    let name: string | undefined;
    try {
      name = await source.resolveConversationName(conv.id);
    } catch {
      name = undefined; // resolution is best-effort — never block conversation creation on it
    }
    if (!name) return;
    const file = await this.loadScriptFile();
    const turns = file[name];
    if (!turns) return;
    for (const turn of turns) conv.pendingScript.push(turn);
  }

  async resumeConversation(conversationId: string, params?: CreateConversationParams): Promise<void> {
    if (!this.conversations.has(conversationId) && params) {
      await this.createConversation(params);
    }
  }

  hasLiveConversation(conversationId: string): boolean {
    return this.conversations.has(conversationId);
  }

  async listConversations(): Promise<string[]> {
    return [...this.conversations.keys()];
  }

  async getLastConversationId(): Promise<string | null> {
    const keys = [...this.conversations.keys()];
    return keys[keys.length - 1] ?? null;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
  }

  async destroyConversation(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
  }

  getConversationWarnings(conversationId: string): ConversationWarning[] {
    return this.conversations.get(conversationId)?.warnings ?? [];
  }

  async selectAgent(_conversationId: string, _agentName: string): Promise<void> {
    // no-op in faux
  }

  async listAgents(_conversationId: string): Promise<HarnessAgentInfo[]> {
    return [];
  }

  // ── IHarnessMessaging ───────────────────────────────────────────

  async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    // Fire and forget
    void this.sendPromptAndWait(conversationId, prompt, attachments, undefined, options);
  }

  async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    _attachments?: AttachmentRef[],
    signal?: AbortSignal,
    _options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`FauxProvider: unknown conversation ${conversationId}`);
    if (conv.inFlight) throw new Error(`FauxProvider: turn already in flight for ${conversationId}`);

    // P2-00 — GENERATORAI_TEST_FAUX_SCRIPT, applied once, lazily, on the
    // first turn (see createConversation's comment for why not there).
    if (this.scriptSource && !conv.scriptFileApplied) {
      conv.scriptFileApplied = true;
      await this.applyScriptFile(conv);
    }

    conv.inFlight = true;
    conv.messages.push({ role: 'user', content: prompt, timestamp: new Date() });

    // Dequeue the next script turn
    const script = conv.pendingScript.shift() ?? [];
    let assistantText = '';

    // W44 / W13-B1: Pre-scan for a 'truncated' entry.
    // If present, ALL tool_call entries that precede it in the script are
    // immediately failed (no waiting for provideToolResult). This exercises
    // the truncation guard without hanging on the first tool_call.
    const truncatedIdx = script.findIndex((e) => e.type === 'truncated');
    if (truncatedIdx !== -1) {
      const truncatedScript = script.slice(0, truncatedIdx);
      for (const entry of truncatedScript) {
        if (entry.type === 'text') {
          const words = (entry as FauxTextEntry).content.split(' ');
          for (const word of words) {
            const token = words.indexOf(word) === 0 ? word : ` ${word}`;
            this.broadcast(conversationId, { kind: 'harness.token', data: { text: token } });
            assistantText += token;
          }
        } else if (entry.type === 'tool_call') {
          const tc = entry as FauxToolCallEntry;
          const callId = tc.callId ?? nextCallId();
          this.broadcast(conversationId, {
            kind: 'harness.tool_start',
            data: { tool: tc.name, args: tc.input, callId },
          });
          this.broadcast(conversationId, {
            kind: 'harness.tool_complete',
            data: {
              tool: tc.name,
              result: 'Response was truncated (stop_reason: length). All tool calls in this batch are cancelled. Please re-issue your request.',
              callId,
              success: false,
            },
          });
        }
      }
      this.broadcast(conversationId, { kind: 'harness.idle', data: {} });
      conv.inFlight = false;
      return { content: assistantText };
    }

    // P2-R21(b) — set when a `permission_request` entry resolves denied, so
    // the very next `file_edit` entry (the common "propose, ask, apply"
    // script shape — see fixtures/sandbox.faux.json) is skipped instead of
    // silently proceeding as if it had been granted. Consumed (reset) by
    // the next entry regardless of its type, so a later, unrelated
    // file_edit is never wrongly skipped.
    let deniedPermissionPending = false;

    try {
      for (const entry of script) {
        // Honour abort signal between entries
        if (signal?.aborted) {
          this.broadcast(conversationId, {
            kind: 'harness.cancelled',
            data: { reason: 'user_abort', provider: 'faux' },
          });
          conv.inFlight = false;
          return { content: assistantText };
        }

        // Consumed by 'file_edit' below; reset for every other entry type so
        // a denial only ever gates the file_edit immediately following it.
        const gatedByDeniedPermission = deniedPermissionPending;
        deniedPermissionPending = false;

        switch (entry.type) {
          case 'text': {
            // Emit word-by-word for realism
            const words = entry.content.split(' ');
            for (const word of words) {
              const token = words.indexOf(word) === 0 ? word : ` ${word}`;
              this.broadcast(conversationId, { kind: 'harness.token', data: { text: token } });
              assistantText += token;
            }
            break;
          }

          case 'tool_call': {
            const callId = entry.callId ?? nextCallId();
            this.broadcast(conversationId, {
              kind: 'harness.tool_start',
              data: { tool: entry.name, args: entry.input, callId },
            });
            // Pause until provideToolResult() is called
            const result = await new Promise<unknown>((resolve) => {
              conv.pendingTools.set(callId, resolve);
            });
            this.broadcast(conversationId, {
              kind: 'harness.tool_complete',
              data: { tool: entry.name, result, callId, success: true },
            });
            break;
          }

          case 'tool_invoke': {
            const callId = entry.callId ?? nextCallId();
            this.broadcast(conversationId, {
              kind: 'harness.tool_start',
              data: { tool: entry.name, args: entry.input, callId },
            });
            const tool = conv.params.tools?.find((t) => t.name === entry.name);
            let result: unknown;
            let success = true;
            if (!tool) {
              result = `FauxProvider: no registered tool named "${entry.name}"`;
              success = false;
            } else {
              try {
                result = await tool.handler(entry.input);
              } catch (err) {
                result = err instanceof Error ? err.message : String(err);
                success = false;
              }
            }
            this.broadcast(conversationId, {
              kind: 'harness.tool_complete',
              data: { tool: entry.name, result, callId, success },
            });
            break;
          }

          case 'tool_error': {
            const callId = entry.callId ?? nextCallId();
            this.broadcast(conversationId, {
              kind: 'harness.tool_start',
              data: { tool: entry.name, args: {}, callId },
            });
            this.broadcast(conversationId, {
              kind: 'harness.tool_complete',
              data: { tool: entry.name, result: entry.error, callId, success: false },
            });
            break;
          }

          case 'file_edit': {
            const callId = entry.callId ?? nextCallId();
            const isDelete = entry.op === 'delete' || (entry.op === undefined && entry.content === undefined);
            const toolName = entry.toolName ?? (isDelete ? 'Delete' : 'Write');

            // P2-R21(a) — no `process.cwd()` fallback. In the sandbox that
            // resolves to wherever this process happens to have been
            // started from — e.g. apps/server inside a real checkout, not
            // a sandboxed workspace — so a relative script path (or `../`)
            // could write into the real checkout instead of a throwaway
            // dir. A conversation that scripts file_edit must supply a
            // workspace; this errors the step rather than guessing one.
            const workspaceDir = conv.params.workingDirectory;
            if (!workspaceDir) {
              const message =
                'FauxProvider: "file_edit" script entry requires CreateConversationParams.workingDirectory — refusing to fall back to process.cwd().';
              this.broadcast(conversationId, { kind: 'harness.error', data: { message, provider: 'faux' } });
              conv.inFlight = false;
              throw new Error(message);
            }
            const workspaceRoot = resolvePath(workspaceDir);
            const absPath = resolvePath(workspaceRoot, entry.path);
            const relFromWorkspace = relative(workspaceRoot, absPath);
            // `isAbsolute` also catches path.relative's cross-drive-letter
            // case on Windows, where it returns the absolute `to` path
            // instead of one starting with '..'.
            if (relFromWorkspace.startsWith('..') || isAbsolute(relFromWorkspace)) {
              const message = `FauxProvider: "file_edit" path "${entry.path}" resolves outside the conversation's workspace (${workspaceRoot}) — refusing to touch it.`;
              this.broadcast(conversationId, { kind: 'harness.error', data: { message, provider: 'faux' } });
              conv.inFlight = false;
              throw new Error(message);
            }

            // P2-R21(b) — a permission_request denied immediately before
            // this entry means whatever it was gating must not happen.
            // Report it the way a real provider's tool reports a denied
            // permission (a failed tool_complete), and never touch disk.
            if (gatedByDeniedPermission) {
              this.broadcast(conversationId, {
                kind: 'harness.tool_start',
                data: { tool: toolName, args: { file_path: entry.path }, callId },
              });
              this.broadcast(conversationId, {
                kind: 'harness.tool_complete',
                data: {
                  tool: toolName,
                  result: 'Permission denied — the preceding permission_request was not granted.',
                  callId,
                  success: false,
                },
              });
              break;
            }

            this.broadcast(conversationId, {
              kind: 'harness.tool_start',
              data: { tool: toolName, args: { file_path: entry.path }, callId },
            });

            let previousContent: string | undefined;
            try {
              previousContent = await readFile(absPath, 'utf8');
            } catch {
              previousContent = undefined; // file does not exist yet — that's fine
            }
            const resolvedOp = entry.op ?? (isDelete ? 'delete' : previousContent === undefined ? 'create' : 'update');

            if (resolvedOp === 'delete') {
              await rm(absPath, { force: true });
            } else {
              await mkdir(dirname(absPath), { recursive: true });
              await writeFile(absPath, entry.content ?? '', 'utf8');
            }

            // P2-R21(c) — countLines (not a raw split('\n').length) so a
            // trailing newline doesn't over-count by one.
            const oldLines = previousContent === undefined ? 0 : countLines(previousContent);
            const newLines = resolvedOp === 'delete' ? 0 : countLines(entry.content ?? '');
            const fileOp = {
              kind: resolvedOp,
              filePath: entry.path,
              additions: resolvedOp === 'delete' ? 0 : newLines,
              deletions: resolvedOp === 'delete' ? oldLines : previousContent === undefined ? 0 : oldLines,
            };

            this.broadcast(conversationId, {
              kind: 'harness.tool_complete',
              data: { tool: toolName, result: `${resolvedOp} ${entry.path}`, callId, success: true, fileOp },
            });
            break;
          }

          case 'ask_question': {
            const handler = conv.params.onQuestionRequest;
            if (!handler) {
              this.broadcast(conversationId, {
                kind: 'harness.warning',
                data: {
                  message: 'FauxProvider: "ask_question" script entry ignored — this conversation has no onQuestionRequest handler (plan mode may be disabled).',
                  provider: 'faux',
                },
              });
              break;
            }
            await handler({ questions: entry.questions });
            break;
          }

          case 'permission_request': {
            const handler = conv.params.onPermissionRequest;
            if (!handler) {
              this.broadcast(conversationId, {
                kind: 'harness.warning',
                data: {
                  message: 'FauxProvider: "permission_request" script entry ignored — this conversation has no onPermissionRequest handler.',
                  provider: 'faux',
                },
              });
              break;
            }
            const decision = await handler(entry.request);
            // P2-R21(b) — honour the answer instead of discarding it: a
            // denial must not let the script continue as though it had been
            // granted. Surface it in the transcript and gate the very next
            // file_edit entry (see the top of this loop and that case).
            if (!decision.granted) {
              deniedPermissionPending = true;
              this.broadcast(conversationId, {
                kind: 'harness.warning',
                data: {
                  message: `FauxProvider: permission denied for "${entry.request.description}"${decision.reason ? ` (${decision.reason})` : ''}.`,
                  provider: 'faux',
                },
              });
            }
            break;
          }

          case 'truncated': {
            // Should not be reached (handled by pre-scan above), but kept as safety.
            this.broadcast(conversationId, { kind: 'harness.idle', data: {} });
            conv.inFlight = false;
            return { content: assistantText };
          }

          case 'cancelled': {
            this.broadcast(conversationId, {
              kind: 'harness.cancelled',
              data: { reason: entry.reason ?? 'user_abort', provider: 'faux' },
            });
            conv.inFlight = false;
            return { content: assistantText };
          }

          case 'error': {
            this.broadcast(conversationId, {
              kind: 'harness.error',
              data: { message: entry.message, provider: 'faux' },
            });
            conv.inFlight = false;
            throw new Error(entry.message);
          }

          case 'exhausted': {
            this.broadcast(conversationId, {
              kind: 'harness.error',
              data: {
                message: `Max turns reached (${entry.maxTurns}). The agent stopped automatically.`,
                provider: 'faux',
              },
            });
            conv.inFlight = false;
            return { content: assistantText };
          }

          case 'complete': {
            if (entry.usage) {
              this.broadcast(conversationId, {
                kind: 'harness.usage',
                data: {
                  model: 'faux-model',
                  inputTokens: entry.usage.inputTokens ?? 0,
                  outputTokens: entry.usage.outputTokens ?? 0,
                  cost: entry.usage.cost,
                  provider: 'faux',
                },
              });
            }
            if (assistantText) {
              this.broadcast(conversationId, {
                kind: 'harness.message_complete',
                data: { content: assistantText },
              });
              conv.messages.push({ role: 'assistant', content: assistantText, timestamp: new Date() });
            }
            this.broadcast(conversationId, { kind: 'harness.idle', data: {} });
            conv.inFlight = false;
            return { content: assistantText };
          }
        }
      }

      // Script ended without an explicit terminal entry — auto-complete
      if (assistantText) {
        this.broadcast(conversationId, {
          kind: 'harness.message_complete',
          data: { content: assistantText },
        });
        conv.messages.push({ role: 'assistant', content: assistantText, timestamp: new Date() });
      }
      this.broadcast(conversationId, { kind: 'harness.idle', data: {} });
    } finally {
      conv.inFlight = false;
    }

    return { content: assistantText };
  }

  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    return this.conversations.get(conversationId)?.messages ?? [];
  }

  async abortConversation(conversationId: string): Promise<void> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    // Resolve all pending tools immediately so the turn can unblock
    for (const [callId, resolve] of conv.pendingTools) {
      resolve('__aborted__');
      conv.pendingTools.delete(callId);
    }
    this.broadcast(conversationId, {
      kind: 'harness.cancelled',
      data: { reason: 'user_abort', provider: 'faux' },
    });
  }

  // ── IHarnessEvents ──────────────────────────────────────────────

  onConversationEvent(
    conversationId: string,
    handler: (event: AgentEvent) => void,
  ): () => void {
    const conv = this.conversations.get(conversationId);
    if (!conv) {
      // Lazy registration — conversation may not exist yet
      return () => {};
    }
    conv.handlers.push(handler);
    return () => {
      const idx = conv.handlers.indexOf(handler);
      if (idx !== -1) conv.handlers.splice(idx, 1);
    };
  }

  private broadcast(conversationId: string, event: AgentEvent): void {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;
    for (const h of conv.handlers) {
      try { h(event); } catch { /* handler errors must not kill the provider */ }
    }
  }

  // ── Test-control API ────────────────────────────────────────────

  /**
   * W44 — Configure the response script for one turn.
   * Each call to script() appends a turn script. Scripts are dequeued in order:
   * the first sendPrompt call replays the first script, the second call replays
   * the second script, etc.
   *
   * @example
   * faux.script([
   *   { type: 'text', content: 'Let me check the file.' },
   *   { type: 'tool_call', name: 'Read', input: { file_path: '/x' } },
   *   { type: 'text', content: 'Done.' },
   *   { type: 'complete' },
   * ]);
   */
  script(entries: FauxScriptEntry[], conversationId?: string): void {
    if (conversationId) {
      const conv = this.conversations.get(conversationId);
      if (conv) { conv.pendingScript.push(entries); return; }
    }
    // Apply to the next created/existing conversation
    this._pendingScripts.push(entries);
  }

  private _pendingScripts: FauxScriptEntry[][] = [];

  /** Called after createConversation to transfer pending scripts. */
  private _transferScripts(conv: FauxConversationState): void {
    while (this._pendingScripts.length > 0) {
      conv.pendingScript.push(this._pendingScripts.shift()!);
    }
  }

  /**
   * W44 — Supply the result for a paused tool_call entry.
   * The pending tool call resolves and the script resumes.
   *
   * @param callId   The callId from the FauxToolCallEntry, or the auto-assigned id.
   *                 If you didn't set callId in the script entry, call nextPendingCallId()
   *                 to discover it, or provide the tool result to ALL pending tools.
   * @param result   The value the tool handler returns.
   */
  async provideToolResult(callId: string, result: unknown): Promise<void> {
    for (const conv of this.conversations.values()) {
      const resolve = conv.pendingTools.get(callId);
      if (resolve) {
        conv.pendingTools.delete(callId);
        resolve(result);
        return;
      }
    }
    throw new Error(`FauxProvider: no pending tool call with id=${callId}`);
  }

  /**
   * W44 — Provide a result for the FIRST pending tool call across all conversations.
   * Useful when the test does not care about the callId.
   */
  async provideNextToolResult(result: unknown): Promise<void> {
    for (const conv of this.conversations.values()) {
      const [callId, resolve] = conv.pendingTools.entries().next().value ?? [];
      if (callId && resolve) {
        conv.pendingTools.delete(callId);
        resolve(result);
        return;
      }
    }
    throw new Error('FauxProvider: no pending tool call');
  }

  /**
   * W44 — Returns true if there is a tool call waiting for a result.
   */
  hasPendingToolCall(): boolean {
    for (const conv of this.conversations.values()) {
      if (conv.pendingTools.size > 0) return true;
    }
    return false;
  }

  /**
   * W44 — Returns ids of all pending tool calls across all conversations.
   */
  pendingCallIds(): string[] {
    const ids: string[] = [];
    for (const conv of this.conversations.values()) {
      ids.push(...conv.pendingTools.keys());
    }
    return ids;
  }
}
