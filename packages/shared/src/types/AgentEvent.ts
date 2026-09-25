// ────────────────────────────────────────────────────────────────
// AgentEvent — Discriminated union of all system events
// Domain value object: pure TypeScript, zero external imports
// Provider-agnostic: all harness providers (copilot, claude-agent, etc.)
// map their native events onto these generic event kinds.
// ────────────────────────────────────────────────────────────────

import type { HookPhase } from './HookDefinition.js';
import type {
  ComputerActionPath,
  ComputerConsentDecision,
  ComputerRefusalCode,
} from './ComputerUse.js';
import type { TerminalHostKind } from './Terminal.js';
import type { ScmFlowResult } from './SourceControl.js';
import type { SttEngineKind } from './Voice.js';

/**
 * Per-operation file-change stats, derived from the provider's structured
 * tool output (Claude `FileWriteOutput` / `FileEditOutput`). Rides on
 * `harness.tool_complete` so the streaming panel can show "+A −D" per
 * write/edit without diffing anything client-side.
 */
export interface FileOpStat {
  /** What the operation did to the file. */
  kind: 'create' | 'update' | 'edit' | 'delete';
  /** Workspace-relative when derivable; otherwise as reported. */
  filePath: string;
  additions: number;
  deletions: number;
  /**
   * Unified-diff hunks of the operation, for inline rendering in the
   * transcript. Present only for providers that return a structured patch
   * (Claude Write/Edit), and capped — see `hunksTruncated`.
   */
  hunks?: FileOpHunk[];
  /** True when `hunks` was cut at the size cap; the Changes tab has the rest. */
  hunksTruncated?: boolean;
}

/** One hunk of a unified diff: `lines` carry their leading ' ', '+' or '-'. */
export interface FileOpHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export type AgentEvent =
  // ── LLM Harness Events (provider-agnostic) ──
  // These events are the common interface that all harness adapters
  // (agent-harness-providers: copilot, claude-agent) map their native SDK events to.
  | { kind: 'harness.token'; data: { text: string } }
  | {
      kind: 'harness.message_complete';
      data: {
        content: string;
        /**
         * The provider's own id for the assistant message this text closed —
         * on Claude the `SDKAssistantMessage.uuid`. It is the anchor a
         * conversation fork/rewind is expressed in (`forkSession.upToMessageId`),
         * so the chat service persists the last one seen in a turn as
         * `ChatMessageMetadata.providerAnchor`.
         */
        providerMessageId?: string;
      };
    }
  | { kind: 'harness.user_message'; data: { content: string } }
  | { kind: 'harness.reasoning_delta'; data: { text: string } }
  | { kind: 'harness.reasoning_complete'; data: { content: string } }
  | { kind: 'harness.tool_start'; data: { tool: string; args: unknown; callId?: string | null; parentToolCallId?: string } }
  | { kind: 'harness.tool_complete'; data: { tool: string; result: unknown; callId?: string | null; success?: boolean; parentToolCallId?: string; fileOp?: FileOpStat } }
  | { kind: 'harness.idle'; data: Record<string, never> }
  | { kind: 'harness.error'; data: { message: string; provider?: string } }
  /**
   * Non-fatal problem the user must see (an MCP server that failed to start,
   * a credential that could not be resolved). The turn continues.
   */
  | { kind: 'harness.warning'; data: { message: string; code?: string; provider?: string; details?: Record<string, unknown> } }
  /** W13 / X-4 — semantic cancellation outcome. Not an error: the user pressed Stop. */
  | { kind: 'harness.cancelled'; data: { reason: 'user_abort' | 'timeout' | 'budget_exceeded'; provider?: string } }
  | { kind: 'harness.session_start'; data: { provider?: string } }
  /**
   * What a turn spent. `inputTokens` is UNCACHED input; prompt-cache traffic
   * is reported apart in `cacheReadTokens` / `cacheWriteTokens` (every
   * provider sends them — the type simply never said so).
   */
  | {
      kind: 'harness.usage';
      data: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        cost?: number;
        durationMs?: number;
        provider?: string;
      };
    }
  /**
   * Provider-neutral snapshot of how full the model's context window is.
   *
   * Emitted whenever a provider reports authoritative context numbers
   * (Copilot `session.usage_info` / `metadata.contextInfo`, Claude
   * `getContextUsage()`), and after compaction so the gauge drops. `source`
   * distinguishes provider-reported truth from a client-side derivation, so
   * the UI can label estimates honestly instead of implying precision.
   */
  | {
      kind: 'harness.context_usage';
      data: {
        provider?: string;
        model?: string;
        /** 'provider' = reported by the SDK; 'derived' = computed from token counts. */
        source: 'provider' | 'derived';
        /** Tokens currently occupying the context window. */
        currentTokens: number;
        /** Denominator: the model's maximum PROMPT tokens. */
        promptTokenLimit?: number;
        /** Advertised total window (prompt + completion). Display only. */
        totalContextWindow?: number;
        /** Token count at which the provider auto-compacts, when known. */
        compactionThreshold?: number;
        /** Sub-agent id — absent for the main agent. Sub-agent context is tracked separately. */
        agentId?: string;
        /** Number of messages currently in the conversation. */
        messagesLength?: number;
        /** Where the tokens are going. All fields optional — providers differ. */
        breakdown?: {
          system?: number;
          tools?: number;
          mcpTools?: number;
          memoryFiles?: number;
          conversation?: number;
          toolCalls?: number;
          toolResults?: number;
          attachments?: number;
          userMessages?: number;
          assistantMessages?: number;
          skills?: number;
          agents?: number;
        };
        /** Raw API token counters for the most recent call. */
        apiUsage?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
        };
      };
    }
  | { kind: 'harness.turn_start'; data: { turnId: string } }
  | {
      kind: 'harness.turn_end';
      data: {
        turnId: string;
        /**
         * The provider's own id for the turn that just ended (Codex `turn.id`).
         * Anchor for `thread/fork { lastTurnId }` / `thread/revert { beforeTurnId }`.
         */
        providerTurnId?: string;
      };
    }
  | { kind: 'harness.session_info'; data: { infoType: string; message: string; [key: string]: unknown } }
  | { kind: 'harness.unknown'; data: { raw: unknown; provider?: string } }
  // ── Harness Client Lifecycle Events ──
  | { kind: 'harness.client_started'; data: { provider?: string } }
  | { kind: 'harness.client_stopped'; data: { message?: string; provider?: string } }
  | { kind: 'harness.client_error'; data: { message: string; provider?: string } }
  | { kind: 'harness.client_restarting'; data: { message?: string; provider?: string } }
  // ── Chat Events ──
  | { kind: 'chat.created'; data: { chatId: string; name: string } }
  // A paired device asked for more scopes / an admin answered (S2 scope-request flow).
  // Lifecycle kinds: they fan out to the global scope so admin devices' lists refresh.
  | { kind: 'device.scope_requested'; data: { requestId: string; deviceId: string; deviceName: string | null; platform: string | null; scopes: string[] } }
  | { kind: 'device.scope_request_resolved'; data: { requestId: string; deviceId: string; deviceName: string | null; status: 'approved' | 'denied' | 'cancelled'; scopes: string[] } }
  | { kind: 'chat.prompt_sent'; data: { chatId: string; prompt: string } }
  | { kind: 'chat.prompt_failed'; data: { chatId: string; error: string } }
  | { kind: 'chat.archived'; data: { chatId: string } }
  | { kind: 'chat.deleted'; data: { chatId: string } }
  // ── Agent-native source control (doc §5) ──
  //
  // Emitted on the chat's SESSION scope after a turn whose chat opted into
  // `sourceControl.autoCommit`: the PLATFORM committed (and optionally pushed
  // / opened a PR), not the agent. One event per git-capable mount, keyed by
  // `turnId` so a re-run after a resolved conflict corrects the same card.
  // `blocked` / `conflicts` results are emitted too — that is how the
  // transcript explains "no PR possible: <reason>".
  | { kind: 'chat.scm.result'; data: { chatId: string; turnId: string; alias: string; result: ScmFlowResult } }
  // ── Orchestrator Background-Task Events (routed to the PARENT chat scope) ──
  | { kind: 'chat.background_task.spawned'; data: { chatId: string; parentChatId: string; taskId: string; taskName: string; model?: string; taskIndex?: number } }
  | { kind: 'chat.background_task.status'; data: { chatId: string; parentChatId: string; taskId: string; taskName: string; status: string } }
  | { kind: 'chat.background_task.completed'; data: { chatId: string; parentChatId: string; taskId: string; taskName: string; status: string; summary?: string } }
  | { kind: 'chat.background_task.failed'; data: { chatId: string; parentChatId: string; taskId: string; taskName: string; error?: string } }
  // Live progress of one background worker, on the PARENT chat scope (throttled by the emitter).
  | {
      kind: 'chat.background_task.progress';
      data: {
        chatId: string;
        parentChatId: string;
        taskId: string;
        taskName: string;
        status: string;
        /** What the worker is doing right now: a tool name, or 'thinking' / 'writing'. */
        currentStep?: string;
        /** Last assistant text excerpt (truncated). */
        lastText?: string;
        toolCalls: number;
        startedAt: number;
      };
    }
  // ── Rewind / fork (chat-scoped) ──
  | {
      kind: 'chat.rewound';
      data: {
        chatId: string;
        /** The turn the user rewound TO THE START OF. */
        turnId: string;
        scope: 'all' | 'code' | 'conversation';
        /** The prompt of that turn, so the composer can offer it back. */
        prompt?: string;
        conversation: 'native' | 'synthetic' | 'skipped';
        files?: { restored: number; deleted: number; skipped: number; mounts: number };
      };
    }
  | { kind: 'chat.forked'; data: { chatId: string; forkChatId: string; turnId?: string; conversation: 'native' | 'synthetic' } }
  // ── Plan Mode Events (chat-scoped; every payload MUST carry chatId) ──
  | { kind: 'chat.mode_changed'; data: { chatId: string; previous: string; next: string } }
  | { kind: 'chat.plan.drafting'; data: { chatId: string; turnId: string } }
  | { kind: 'chat.plan.created'; data: { chatId: string; planId: string; revision: number; title: string; fileName: string; summary: string; turnId?: string } }
  | { kind: 'chat.plan.updated'; data: { chatId: string; planId: string; revision: number; summary?: string } }
  | { kind: 'chat.plan.review_requested'; data: { chatId: string; planId: string; interactionId: string; revision: number; summary: string; actions: string[]; recommendedAction?: string } }
  | { kind: 'chat.plan.decided'; data: { chatId: string; planId: string; interactionId?: string; approved: boolean; action?: string; feedback?: string } }
  | { kind: 'chat.plan.expired'; data: { chatId: string; planId: string; interactionId?: string; reason: string } }
  | { kind: 'chat.plan.extraction_failed'; data: { chatId: string; turnId: string; reason: string } }
  | { kind: 'chat.question.asked'; data: { chatId: string; interactionId: string; turnId?: string; questions: unknown[] } }
  | { kind: 'chat.question.answered'; data: { chatId: string; interactionId: string; answers: Record<string, string[]>; freeformResponse?: string } }
  | { kind: 'chat.question.expired'; data: { chatId: string; interactionId: string; reason: string } }
  // chat.permission — a tool call is waiting on the user's allow/deny (chat permission modes `default` / `acceptEdits`).
  | { kind: 'chat.permission.requested'; data: { chatId: string; interactionId: string; turnId?: string; toolName: string; type: string; description: string; inputSummary: string; permissionMode: string } }
  | { kind: 'chat.permission.resolved'; data: { chatId: string; interactionId: string; behavior: 'allow' | 'deny'; message?: string } }
  | { kind: 'chat.permission.expired'; data: { chatId: string; interactionId: string; reason: string } }

  // ── Agents (first-class agent entity) ──
  | { kind: 'agent.created'; data: { agentId: string; ref: string; name: string; scope: string } }
  | { kind: 'agent.updated'; data: { agentId: string; ref: string; name: string; version: number } }
  | { kind: 'agent.deleted'; data: { agentId: string; ref: string; soft: boolean } }
  | { kind: 'chat.agent_changed'; data: { chatId: string; agentRef?: string; agentVersion?: number } }
  // ── Harness plan passthrough (telemetry/observability only) ──
  | { kind: 'harness.plan_changed'; data: { operation: string } }
  | { kind: 'harness.mode_changed'; data: { previousMode: string; newMode: string } }
  // ── WorkflowRun Lifecycle Events ──
  | { kind: 'workflow_run.created'; data: { workflowRunId: string; name: string; workflowDefinitionId: string } }
  | { kind: 'workflow_run.starting'; data: { workflowRunId: string } }
  | { kind: 'workflow_run.running'; data: { workflowRunId: string } }
  | { kind: 'workflow_run.paused'; data: { workflowRunId: string; reason?: string } }
  | { kind: 'workflow_run.resumed'; data: { workflowRunId: string } }
  | { kind: 'workflow_run.cancelling'; data: { workflowRunId: string } }
  | { kind: 'workflow_run.completed'; data: { workflowRunId: string } }
  | { kind: 'workflow_run.failed'; data: { workflowRunId: string; error: string } }
  | { kind: 'workflow_run.cancelled'; data: { workflowRunId: string } }
  | { kind: 'workflow_run.retried'; data: { workflowRunId: string; ancestorRunId?: string } }
  // ── WorkflowRun Orchestration Events ──
  | { kind: 'workflow_run.orchestration_started'; data: { workflowRunId: string; hasCodebases: boolean; hasPreprocessing: boolean } }
  | { kind: 'workflow_run.worktree_creating'; data: { workflowRunId: string; codebaseCount: number; codebases: Array<{ alias: string; codebaseId: string }> } }
  | { kind: 'workflow_run.worktree_created'; data: { workflowRunId: string; worktrees: Record<string, string> } }
  | { kind: 'workflow_run.preprocessing_started'; data: { workflowRunId: string; stepCount: number } }
  | { kind: 'workflow_run.preprocessing_completed'; data: { workflowRunId: string; results: Array<{ stepName: string; success: boolean; durationMs: number }> } }
  | { kind: 'workflow_run.preprocessing_step_started'; data: { workflowRunId: string; stepName: string; stepType: string } }
  | { kind: 'workflow_run.preprocessing_step_completed'; data: { workflowRunId: string; stepName: string; success: boolean; durationMs: number } }
  | { kind: 'workflow_run.preprocessing_step_failed'; data: { workflowRunId: string; stepName: string; error: string } }
  | { kind: 'workflow_run.stage_validation'; data: { workflowRunId: string; stageRunId: string; stageName: string; passed: boolean; failures: string[] } }
  | { kind: 'workflow_run.orchestration_failed'; data: { workflowRunId: string; error: string } }
  | { kind: 'workflow_run.orchestration_completed'; data: { workflowRunId: string; preprocessingResults: unknown[]; postProcessingResults?: unknown[] } }
  // ── WorkflowRun Sandbox Events ──
  | { kind: 'workflow_run.sandbox_created'; data: { workflowRunId: string; sandboxName: string; cliUrl: string; isDockerSandbox: boolean } }
  | { kind: 'workflow_run.sandbox_destroyed'; data: { workflowRunId: string } }
  // ── WorkflowRun Post-Processing Events ──
  | { kind: 'workflow_run.postprocessing_started'; data: { workflowRunId: string; stepCount: number } }
  | { kind: 'workflow_run.postprocessing_completed'; data: { workflowRunId: string; results: Array<{ stepName: string; success: boolean; durationMs: number }> } }
  | { kind: 'workflow_run.postprocessing_step_started'; data: { workflowRunId: string; stepName: string; stepType: string } }
  | { kind: 'workflow_run.postprocessing_step_completed'; data: { workflowRunId: string; stepName: string; success: boolean; durationMs: number } }
  | { kind: 'workflow_run.postprocessing_step_failed'; data: { workflowRunId: string; stepName: string; error: string } }
  // ── WorkflowRun Permission Events ──
  | { kind: 'workflow_run.permission_mode_changed'; data: { workflowRunId: string; mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan'; previous?: string } }
  // ── StageRun Events ──
  | { kind: 'stage_run.pending'; data: { stageRunId: string; workflowRunId: string; name: string } }
  | { kind: 'stage_run.queued'; data: { stageRunId: string; workflowRunId: string; name: string } }
  | { kind: 'stage_run.running'; data: { stageRunId: string; workflowRunId: string; sessionId?: string; name?: string } }
  | { kind: 'stage_run.step_started'; data: { stageRunId: string; workflowRunId: string; step: number; totalSteps: number; label: string } }
  | { kind: 'stage_run.step_completed'; data: { stageRunId: string; workflowRunId: string; step: number } }
  | { kind: 'stage_run.paused'; data: { stageRunId: string; workflowRunId: string; reason?: string } }
  | { kind: 'stage_run.resumed'; data: { stageRunId: string; workflowRunId: string } }
  | { kind: 'stage_run.completed'; data: { stageRunId: string; workflowRunId: string; name?: string } }
  | { kind: 'stage_run.failed'; data: { stageRunId: string; workflowRunId: string; error: string; name?: string } }
  | { kind: 'stage_run.cancelled'; data: { stageRunId: string; workflowRunId: string } }
  | { kind: 'stage_run.skipped'; data: { stageRunId: string; workflowRunId: string; reason: string } }
  | { kind: 'stage_run.retrying'; data: { stageRunId: string; workflowRunId: string; retryCount: number } }
  // HITL — human-in-the-loop lifecycle events.
  | { kind: 'stage_run.awaiting_input'; data: { stageRunId: string; workflowRunId: string; interruptData?: unknown; prompt?: string } }
  | { kind: 'stage_run.input_received'; data: { stageRunId: string; workflowRunId: string; value?: unknown } }
  // ── Session Events ──
  | { kind: 'session.created'; data: { sessionId: string; name?: string } }
  | { kind: 'session.active'; data: { sessionId: string } }
  | { kind: 'session.paused'; data: { sessionId: string; reason?: string } }
  | { kind: 'session.closing'; data: { sessionId: string } }
  | { kind: 'session.closed'; data: { sessionId: string } }
  | {
      kind: 'session.error';
      data: {
        sessionId: string;
        message: string;
        code?: string;
        category?: string;
        recoverable?: boolean;
      };
    }
  // ── Git Events ──
  | { kind: 'git.clone_start'; data: { repoUrl: string } }
  | { kind: 'git.clone_progress'; data: { percent: number; message: string } }
  | { kind: 'git.clone_complete'; data: { localPath: string } }
  | { kind: 'git.commit'; data: { sha: string; message: string } }
  | { kind: 'git.push'; data: { branch: string } }
  | { kind: 'git.pr_created'; data: { url: string; number: number } }
  // ── Workspace / checkpoint events ──
  //
  // `workspace.changed` replaces the Changes panel's polling loop. It is
  // debounced at the emitter (never by dropping events in the bus, which
  // would violate the per-session ordering invariant) so a write-heavy agent
  // turn produces at most a couple of refetches.
  //
  // `workflowRunId` / `chatId` (when present) let the EventBus→StreamBroker
  // bridge republish to the run / chat scopes.
  | {
      kind: 'workspace.changed';
      data: {
        workspaceId: string;
        repoAlias: string;
        /** Paths touched since the last emit — may be empty when unknown. */
        changedPaths: string[];
        stats: { files: number; additions: number; deletions: number };
        checkpointId?: string;
        chatId?: string;
        workflowRunId?: string;
      };
    }
  // A file's review state moved (Keep / Unkeep / a discard that dropped
  // rows). Carries only the workspace id: the client's response is to
  // refetch the change summary, which is where `kept` actually lives.
  | {
      kind: 'workspace.review_changed';
      data: {
        workspaceId: string;
        chatId?: string;
        workflowRunId?: string;
      };
    }
  | {
      kind: 'checkpoint.created';
      data: {
        workspaceId: string;
        checkpointId: string;
        repoAlias: string;
        checkpointKind: string;
        label?: string;
        turnId?: string;
        stageRunId?: string;
        chatId?: string;
        workflowRunId?: string;
      };
    }
  // Mount preparation (worktrees created, branches checked out). Gates the
  // first prompt of a chat; the composer shows "Preparing workspace…" until
  // `ready`, and the error text when preparation failed.
  | {
      kind: 'workspace.prep';
      data: {
        workspaceId: string;
        status: 'preparing' | 'ready' | 'error';
        error?: string;
        chatId?: string;
      };
    }
  | {
      kind: 'checkpoint.restored';
      data: {
        workspaceId: string;
        checkpointId: string;
        repoAlias: string;
        preRestoreCheckpointId: string | null;
        restoredCount: number;
        deletedCount: number;
        skipped: Array<{ path: string; reason: string }>;
        chatId?: string;
        workflowRunId?: string;
      };
    }
  // ── Script Events ──
  | { kind: 'script.stdout'; data: { line: string; scriptId: string } }
  | { kind: 'script.stderr'; data: { line: string; scriptId: string } }
  | { kind: 'script.exit'; data: { code: number; scriptId: string } }
  // ── Hook Events ──
  // `workflowRunId` (when present) lets the EventBus→StreamBroker bridge
  // republish these to scope='run', so workflow- and stage-level hook
  // lifecycle is visible in the run-scoped SSE stream / run timeline UI.
  // `hookId`/`hookType`/`stageRunId`/`sessionId`/`durationMs` let the run
  // inspector pair started/completed and attribute the hook to its stage.
  | { kind: 'hook.started'; data: { hookName: string; phase: HookPhase; workflowRunId?: string; hookId?: string; hookType?: string; stageRunId?: string; sessionId?: string } }
  | { kind: 'hook.completed'; data: { hookName: string; phase: HookPhase; result?: unknown; workflowRunId?: string; hookId?: string; hookType?: string; stageRunId?: string; sessionId?: string; durationMs?: number } }
  | { kind: 'hook.failed'; data: { hookName: string; phase: HookPhase; error: string; workflowRunId?: string; hookId?: string; hookType?: string; stageRunId?: string; sessionId?: string; durationMs?: number } }
  | { kind: 'hook.skipped'; data: { hookName: string; phase: HookPhase; reason: string; workflowRunId?: string } }
  // ── Artifact Events ──
  | { kind: 'artifact.created'; data: { artifactId: string; name: string; mimeType: string } }
  | { kind: 'artifact.available'; data: { artifactId: string; downloadUrl: string } }
  // ── Permission Events ──
  | { kind: 'permission.requested'; data: { type: string; description: string } }
  | { kind: 'permission.granted'; data: { type: string } }
  | { kind: 'permission.denied'; data: { type: string; reason?: string } }
  // ── EventBus Internal Events (EVT-02) ──
  | {
      kind: 'subscriber.error';
      data: {
        subscriberName: string;
        channel: string;
        sourceKind: string;
        sourceSequenceId: number;
        sourceSessionId: string;
        error: string;
      };
    }
  // ── Integrated Browser Events ──
  // Emitted by BrowserService on session lifecycle + agent/user actions.
  // Payloads never carry inline images — screenshots/HAR/DOM live as
  // WorkspaceArtifacts (`browser_screenshot`, `browser_dom`, `browser_har`)
  // and events reference them by artifactId (INV-3, keeps stream_cursors
  // small).
  | { kind: 'browser.session_created'; data: { workspaceId: string; mode: 'native' | 'screencast'; url?: string } }
  | { kind: 'browser.session_stopped'; data: { workspaceId: string; reason?: string } }
  | {
      kind: 'browser.session_updated';
      data: {
        workspaceId: string;
        /** Present when the update was toggling agent-sharing. */
        attachedToChat?: boolean;
        /** Human-readable trigger ('user' | 'prompt' | 'system'). */
        reason?: string;
      };
    }
  | {
      kind: 'browser.action_started';
      data: {
        workspaceId: string;
        action: string;
        target?: string;
        url?: string;
        from?: 'agent' | 'user' | 'inspector' | 'system';
      };
    }
  | {
      kind: 'browser.action_completed';
      data: {
        workspaceId: string;
        action: string;
        target?: string;
        url?: string;
        from?: 'agent' | 'user' | 'inspector' | 'system';
        ok: boolean;
        artifactId?: string;
        durationMs?: number;
        error?: string;
      };
    }
  | {
      kind: 'browser.snapshot';
      data: {
        workspaceId: string;
        artifactId: string;
        artifactType: 'browser_screenshot' | 'browser_dom' | 'browser_har' | 'browser_video' | 'browser_console_log';
        url?: string;
        from?: 'agent' | 'user' | 'inspector' | 'system';
      };
    }
  | {
      kind: 'browser.selection';
      data: {
        workspaceId: string;
        artifactId: string;
        url: string;
        cssSelector?: string;
        xpath?: string;
      };
    }
  | { kind: 'browser.error'; data: { workspaceId: string; error: string; kind?: 'crash' | 'timeout' | 'blocked' | 'capacity' | 'unknown' } }
  // ── Computer Use Events ──
  // Emitted by ComputerService. Like browser events these never carry inline
  // image data — screenshots are written as `computer_screenshot` artifacts
  // first and referenced by artifactId (INV-3).
  | { kind: 'computer.session_started'; data: { workspaceId: string; provider: string; providerVersion: string; platform: string } }
  | { kind: 'computer.session_stopped'; data: { workspaceId: string; reason?: string } }
  | {
      kind: 'computer.snapshot';
      data: {
        workspaceId: string;
        appIdentity: string;
        appLabel: string;
        windowTitle: string;
        snapshotId: string;
        elementCount: number;
        truncated: boolean;
        artifactId?: string;
      };
    }
  | {
      kind: 'computer.action';
      data: {
        workspaceId: string;
        chatId?: string;
        appIdentity: string;
        appLabel: string;
        action: string;
        /** Element label or identifier — NEVER typed content. */
        target?: string;
        path: ComputerActionPath;
        verified: boolean;
        artifactId?: string;
        durationMs?: number;
      };
    }
  | {
      kind: 'computer.refusal';
      data: {
        workspaceId: string;
        chatId?: string;
        appIdentity?: string;
        appLabel?: string;
        action: string;
        code: ComputerRefusalCode;
        message: string;
      };
    }
  | {
      kind: 'computer.consent_required';
      data: {
        workspaceId: string;
        chatId?: string;
        requestId: string;
        appIdentity: string;
        appLabel: string;
        action: string;
        summary: string;
        path: ComputerActionPath;
        expiresAt: number;
      };
    }
  | {
      kind: 'computer.consent_resolved';
      data: {
        workspaceId: string;
        requestId: string;
        decision: ComputerConsentDecision | 'expired';
      };
    }
  | { kind: 'computer.error'; data: { workspaceId: string; error: string; kind?: 'crash' | 'timeout' | 'capacity' | 'unknown' } }
  // ── Integrated Terminal Events ──
  // Lifecycle only; raw output stays on the dedicated WebSocket transport
  // (`/api/workspaces/:id/terminals/:sid/stream`) to keep the event log
  // small. The SPA subscribes to these to auto-focus tabs / show toasts.
  | { kind: 'terminal.session_created'; data: { workspaceId: string; sessionId: string; host: TerminalHostKind; pid: number | null; cwd: string; shell: string } }
  | { kind: 'terminal.session_closed'; data: { workspaceId: string; sessionId: string; code: number; signal?: string; reason?: string } }
  | { kind: 'terminal.session_resized'; data: { workspaceId: string; sessionId: string; cols: number; rows: number } }
  // ── Voice Module Events ──
  // Lifecycle only; audio never travels over the EventBus/SSE — it stays on
  // the dedicated `/api/stt/stream` WebSocket, same reasoning as Terminal's
  // raw PTY bytes. `workspaceId` is nullable — see Voice.ts file header.
  | { kind: 'voice.stt_session_started'; data: { workspaceId: string | null; sessionId: string; engine: SttEngineKind } }
  | { kind: 'voice.stt_session_ended'; data: { workspaceId: string | null; sessionId: string; reason: string } }
  // Phase 1 — pause/resume (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C.3/C.4).
  | { kind: 'voice.stt_paused'; data: { workspaceId: string | null; sessionId: string } }
  | { kind: 'voice.stt_resumed'; data: { workspaceId: string | null; sessionId: string } }
  // Phase 3 — TTS (speak()) lifecycle.
  | { kind: 'voice.tts_session_started'; data: { workspaceId: string | null; sessionId: string } }
  | { kind: 'voice.tts_session_ended'; data: { workspaceId: string | null; sessionId: string } }
  // ── Widget Events ──
  // Emitted by WidgetService on widget lifecycle + user/agent actions.
  // Widgets are rendered in an iframe on the client; the payload
  // references the `WidgetInstance` row keyed by `instanceId`.
  | {
      kind: 'harness.widget.render';
      data: {
        instanceId: string;
        descriptorId: string;
        extensionId: string;
        component: string;
        surface: 'inline' | 'widget';
        title?: string;
        props: unknown;
        assetsBase: string;                // absolute URL prefix for /api/widget-assets
        entry: string;                     // relative to assetsBase — e.g. 'ui/card.html'
        callId?: string | null;
        state?: unknown;                   // initial state (so refresh/replay re-hydrates)
      };
    }
  | {
      kind: 'harness.widget.state';
      data: { instanceId: string; state: unknown; patch?: unknown };
    }
  | {
      kind: 'harness.widget.action';
      data: {
        instanceId: string;
        action: string;
        payload?: unknown;
        from: 'agent' | 'user';
      };
    }
  | {
      // Agent → widget imperative action dispatch. The client bridge
      // forwards this to the iframe as `widget:invoke` and posts the
      // result back via POST /api/widgets/:id/invoke-result, resolving the
      // server-side pending promise the `widget_action` / `widget_exec`
      // tool is awaiting.
      kind: 'harness.widget.invoke';
      data: { instanceId: string; invokeId: string; action: string; args: unknown };
    }
  | {
      // Host → widget teardown handshake. Emitted by WidgetService.close so
      // the client bridge asks the live widget to commit its final state
      // (via widget:state) before the instance is marked closed. The widget
      // replies by POSTing /api/widgets/:id/teardown-ack, resolving the
      // server-side pending promise so the close finalizes with fresh state.
      kind: 'harness.widget.teardown';
      data: { instanceId: string; teardownId: string; reason?: string };
    }
  | { kind: 'harness.widget.closed'; data: { instanceId: string; reason?: string } }
  | { kind: 'harness.widget.error'; data: { instanceId: string; error: string } }
  // ── Extension Lifecycle Events ──
  | { kind: 'extension.installed'; data: { id: string; version: string; scope: 'system' | 'user' | 'workspace'; workspaceId?: string } }
  | { kind: 'extension.uninstalled'; data: { id: string; scope: 'system' | 'user' | 'workspace'; workspaceId?: string } }
  | { kind: 'extension.reloaded'; data: { id: string; scope: 'system' | 'user' | 'workspace' } }
  | { kind: 'extension.error'; data: { id: string; error: string } }
  // ── Automation Execution Events (Track B) ──
  | { kind: 'automation_execution.started'; data: { executionId: string; automationId: string } }
  | { kind: 'automation_execution.progress'; data: { executionId: string; automationId: string; completedRuns: number; failedRuns: number; totalRuns: number } }
  | { kind: 'automation_execution.completed'; data: { executionId: string; automationId: string } }
  | { kind: 'automation_execution.failed'; data: { executionId: string; automationId: string; error?: string } }
  /** Some iterations succeeded and some failed. Alerted like `.failed`. */
  | { kind: 'automation_execution.partial'; data: { executionId: string; automationId: string; completedRuns: number; failedRuns: number; error?: string } }
  | { kind: 'automation_execution.cancelled'; data: { executionId: string; automationId: string } }
  | { kind: 'automation_execution.recovered'; data: { executionId: string; automationId: string; finalStatus: 'completed' | 'failed' | 'cancelled' | 'partial'; error?: string } }
  /** The scheduler decided NOT to run a due slot (missed while offline, or overlap). */
  | { kind: 'automation.schedule_skipped'; data: { automationId: string; reason: 'missed' | 'overlap'; scheduledFor: string; missedCount?: number; nextRunAt?: string; note: string } }
  /** Overlap policy `queue`: the due slot is held until the in-flight execution finishes. */
  | { kind: 'automation.schedule_deferred'; data: { automationId: string; scheduledFor: string; note: string } }
  | { kind: 'automation_execution.iteration_started'; data: { executionId: string; iterationIndex: number; label?: string } }
  | { kind: 'automation_execution.iteration_completed'; data: { executionId: string; iterationIndex: number; workflowRunId: string } }
  | { kind: 'automation_execution.iteration_failed'; data: { executionId: string; iterationIndex: number; error?: string } }
  | { kind: 'automation_execution.iteration_retried'; data: { executionId: string; iterationIndex: number; attempt: number; maxAttempts: number } };

/** All possible event kind strings */
export type AgentEventKind = AgentEvent['kind'];

/** Persisted event row — after event is saved to the event store */
export interface PersistedEvent {
  id: number;
  sessionId: string;
  sequenceId: number;
  kind: AgentEventKind;
  data: unknown;
  timestamp: number;
  /** FK to the workflow run this event belongs to */
  workflowRunId?: string;
  /** FK to the stage run this event belongs to */
  stageRunId?: string;
}

// ── Type Guards ──

export function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as AgentEvent).kind === 'string' &&
    'data' in value
  );
}

export function isHarnessEvent(event: AgentEvent): boolean {
  return event.kind.startsWith('harness.');
}

export function isWorkflowRunEvent(event: AgentEvent): boolean {
  return event.kind.startsWith('workflow_run.');
}

export function isStageRunEvent(event: AgentEvent): boolean {
  return event.kind.startsWith('stage_run.');
}

export function isChatEvent(event: AgentEvent): boolean {
  return event.kind.startsWith('chat.');
}

export function isSessionEvent(event: AgentEvent): boolean {
  return event.kind.startsWith('session.');
}

export function isGitEvent(event: AgentEvent): boolean {
  return event.kind.startsWith('git.');
}

export function isHookEvent(event: AgentEvent): boolean {
  return event.kind.startsWith('hook.');
}

export function isBrowserEvent(event: AgentEvent): boolean {
  return event.kind.startsWith('browser.');
}

export function isComputerEvent(event: AgentEvent): boolean {
  return event.kind.startsWith('computer.');
}

/** Helper to create a typed AgentEvent */
export function createAgentEvent<K extends AgentEventKind>(
  kind: K,
  data: Extract<AgentEvent, { kind: K }>['data'],
): AgentEvent {
  return { kind, data } as AgentEvent;
}

// ── Typed Narrowing (EVT-03) ──
//
// Consumers historically wrote `const data = event.data as Record<string, unknown>`
// and then picked fields by string key — losing every type guarantee at the
// boundary. The helpers below let callers narrow by `kind` and get a fully
// typed `data` without any `as` cast. Example:
//
//   if (isEventOfKind(event, 'workflow_run.created')) {
//     // event.data is now typed { workflowRunId: string; name: string; ... }
//     return event.data.workflowRunId;
//   }
//
// Use `narrowEvent` when you want an Option-style return (null when the kind
// doesn't match) rather than a `if` narrowing.

/** Narrows an unknown-ish event shape to a specific AgentEvent kind. */
export function isEventOfKind<K extends AgentEventKind>(
  event: { kind: string; data: unknown } | AgentEvent,
  kind: K,
): event is Extract<AgentEvent, { kind: K }> {
  return event.kind === kind;
}

/** Returns the event if its kind matches, otherwise null. */
export function narrowEvent<K extends AgentEventKind>(
  event: { kind: string; data: unknown } | AgentEvent,
  kind: K,
): Extract<AgentEvent, { kind: K }> | null {
  return event.kind === kind ? (event as Extract<AgentEvent, { kind: K }>) : null;
}
