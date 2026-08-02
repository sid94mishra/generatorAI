// ────────────────────────────────────────────────────────────────
// Chat Zod validation schemas
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { BrowserConfigSchema } from './BrowserConfigSchema.js';
import { AGENT_MODES, coerceAgentMode, type AgentMode } from '../types/AgentMode.js';

/**
 * Agent mode, accepting the pre-rename `interactive` alias.
 *
 * Exported workflow definitions and older API clients still send
 * `'interactive'`; `coerceAgentMode` folds it onto `'auto'` so a single
 * boundary handles both without leaking the legacy value into the domain.
 */
export const AgentModeSchema = z
  .string()
  .transform((v, ctx) => {
    const mode = coerceAgentMode(v);
    if (!mode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid agent mode. Allowed: ${AGENT_MODES.join(', ')}`,
      });
      return z.NEVER;
    }
    return mode;
  }) as unknown as z.ZodType<AgentMode>;

/** Agent harness configuration — provider-agnostic settings for LLM sessions */
const AgentHarnessConfigSchema = z.object({
  model: z.string().optional(),
  systemMessage: z.object({
    mode: z.enum(['append', 'replace']).default('append'),
    content: z.string(),
  }).optional(),
  systemPromptAppend: z.string().optional(),
  streaming: z.boolean().optional(),
  mcpServers: z.record(z.object({
    type: z.enum(['http', 'stdio']),
    url: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
  })).optional(),
  availableTools: z.array(z.string()).optional(),
  excludedTools: z.array(z.string()).optional(),
  skillDirectories: z.array(z.string()).optional(),
  disabledSkills: z.array(z.string()).optional(),
  customAgents: z.array(z.object({
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    tools: z.array(z.string()).optional(),
  })).optional(),
  provider: z.object({
    name: z.string(),
    baseUrl: z.string().url(),
    apiKey: z.string(),
    model: z.string().optional(),
  }).optional(),
  configDir: z.string().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
  /**
   * Agent provider for this chat. Omit to route by `model`, falling back to
   * the server's primary provider.
   */
  harnessType: z.enum(['copilot', 'claude-agent']).optional(),
  contextTier: z.enum(['default', 'long_context']).optional(),
  maxTurns: z.number().int().min(1).optional(),
  /**
   * Permission policy for this chat's tool calls. Defaults to
   * `bypassPermissions` — which preserves today's fully-autonomous behaviour.
   * Plan mode forces `plan` for the duration of a planning turn.
   */
  permissionMode: z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']).optional(),
  /**
   * Claude-native: replaces the default plan-mode workflow body in the
   * plan-mode system reminder. Copilot approximates this via the system message.
   */
  planModeInstructions: z.string().max(20_000).optional(),
}).partial();

/** Zod schema for creating a Chat */
export const CreateChatSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  model: z.string().optional(),
  /** Agent harness configuration (provider-agnostic — works with copilot, claude-agent, etc.) */
  harnessConfig: AgentHarnessConfigSchema.optional(),
  /** Project ID — scopes this chat to a project and its codebases */
  projectId: z.string().uuid().optional(),
  /** Codebase IDs from the project to link to this chat */
  codebaseIds: z.array(z.string().uuid()).max(5).optional(),
  /** Whether to create a worktree for code changes (optional — user chooses) */
  createWorktree: z.boolean().optional(),
  /** Whether to use a worktree (alias for createWorktree, used by workspace management) */
  useWorktree: z.boolean().optional(),
  /** Local folder paths to use as working directory */
  gitRepositories: z.array(z.object({
    url: z.string().min(1).max(500),
    // Required to match ChatLocalFolder — downstream services key codebases by
    // `alias`, so an omitted alias would surface as `undefined` at runtime.
    alias: z.string().min(1).max(100),
  })).max(3).optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  /**
   * Integrated Browser configuration (v13). When `enabled: true`, chat
   * creation auto-boots a per-workspace Chromium and appends CDP endpoint
   * details to the harness system prompt so the `playwright-cli` skill can
   * attach.
   */
  browserConfig: BrowserConfigSchema.optional(),
  /**
   * Orchestrator mode — when true, this chat runs the orchestrator system
   * prompt and gets the background-agent tool set. The UI restricts this to
   * powerful models; the server injects the prompt + tools on create.
   */
  orchestratorMode: z.boolean().optional(),
  /** Set on WORKER chats spawned by an orchestrator: the parent chat id. */
  parentChatId: z.string().uuid().optional(),
  /** Set on WORKER chats: background-task metadata. */
  backgroundTask: z.object({
    orchestratorChatId: z.string().uuid(),
    taskName: z.string().min(1).max(120),
    taskIndex: z.number().int().min(0).optional(),
    status: z.enum(['spawned', 'running', 'needs_review', 'completed', 'failed', 'cancelled']).optional(),
  }).optional(),
  /** Sticky per-chat default agent mode; overridable per turn from the composer. */
  defaultAgentMode: AgentModeSchema.optional(),
  /** Chat-scoped permission policy (defaults to `bypassPermissions`). */
  permissionMode: z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']).optional(),
});

// ────────────────────────────────────────────────────────────────
// Plan mode request schemas
// ────────────────────────────────────────────────────────────────

/** PUT /api/chats/:id/plans/:planId/content */
export const UpdatePlanContentSchema = z.object({
  content: z.string().min(1).max(500_000),
  summary: z.string().max(2000).optional(),
  /** Optimistic concurrency — rejects with 409 when the plan moved on. */
  expectedRevision: z.number().int().min(1),
});

/** POST /api/chats/:id/plans/:planId/comments */
export const CreatePlanCommentSchema = z.object({
  body: z.string().min(1).max(10_000),
  revision: z.number().int().min(1),
  anchor: z
    .object({
      startLine: z.number().int().min(0),
      endLine: z.number().int().min(0),
      quotedText: z.string().max(10_000),
      contentHash: z.string().max(128),
    })
    .optional(),
});

/** POST /api/chats/:id/plans/:planId/decision */
export const PlanDecisionSchema = z.object({
  approved: z.boolean(),
  action: z.enum(['exit_only', 'implement_interactive', 'implement_autopilot']).optional(),
  feedback: z.string().max(50_000).optional(),
  /** Use the latest user-edited revision as the approved content. */
  useEditedContent: z.boolean().optional(),
  expectedRevision: z.number().int().min(1).optional(),
});

/** POST /api/chats/:id/interactions/:interactionId/respond */
export const AnswerQuestionSchema = z.object({
  answers: z.record(z.array(z.string().max(4000))).default({}),
  freeformResponse: z.string().max(20_000).optional(),
});

/** PATCH /api/chats/:id/permission-mode */
export const SetChatPermissionModeSchema = z.object({
  mode: z.enum(['bypassPermissions', 'default', 'acceptEdits', 'plan']),
});

/**
 * POST /api/workflow-runs/:runId/stages/:stageId/approve
 *
 * `outcome` is the modern tri-state verdict. The legacy boolean `approved` is
 * still accepted so existing clients keep working: `true` → approved,
 * `false` → changes_requested (never `rejected`, which must be explicit
 * because it terminates the run).
 */
export const StageReviewDecisionSchema = z.object({
  outcome: z.enum(['approved', 'changes_requested', 'rejected']).optional(),
  approved: z.boolean().optional(),
  /** Free-text change request sent to the agent as a follow-up prompt. */
  followUpPrompt: z.string().max(50_000).optional(),
  /** Why the stage was rejected — surfaced on the failed stage. */
  reason: z.string().max(10_000).optional(),
  value: z.unknown().optional(),
});

/** Zod schema for sending a chat prompt */
export const SendChatPromptSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  attachments: z.array(z.object({
    type: z.literal('file'),
    path: z.string(),
    displayName: z.string().optional(),
  })).optional(),
  /**
   * Per-turn agent mode. Omit to fall back to the chat's `defaultAgentMode`,
   * then to {@link DEFAULT_AGENT_MODE}.
   */
  mode: AgentModeSchema.optional(),
});
