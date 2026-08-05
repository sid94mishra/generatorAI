// ────────────────────────────────────────────────────────────────
// Agent-mode policy (PLN-01)
//
// Every behavioural difference between modes is resolved HERE, from the
// shared `AGENT_MODE_REGISTRY` descriptor — never from an inline
// `if (mode === 'plan')` at a call site. Adding a mode is a registry entry
// plus (optionally) an instruction block below.
// ────────────────────────────────────────────────────────────────

import {
  agentModeDescriptor,
  DEFAULT_AGENT_MODE,
  type AgentMode,
  type AgentModeDescriptor,
  type ChatPermissionMode,
} from '@generatorai/shared';
import type { HarnessPermissionMode } from '../domain/ports/IAgentHarness.js';

/**
 * Per-turn context the plan/question gates need.
 *
 * The gates are installed once at conversation-creation time but must report
 * against the CURRENT turn, so `sendPrompt` refreshes this before every send
 * and the handlers close over the mutable holder.
 */
export interface TurnContext {
  chatId: string;
  sessionId: string;
  turnId: string;
  agentMode: AgentMode;
  /** Plans surfaced during this turn, for transcript persistence. */
  planIds: string[];
  /** Question gates opened during this turn, for transcript persistence. */
  interactionIds: string[];
  /**
   * Monotonic ordinal handed out to every ordered item of the turn — each
   * tool call, and each plan/question card. Persisting it is what lets the
   * transcript be rebuilt in true chronological order after a reload; without
   * it the cards can only be appended after the final answer.
   */
  nextSequence: number;
  /** planId | interactionId → the ordinal that card was issued. */
  cardSequence: Map<string, number>;
}

/** The behavioural contract for a mode. Re-exported so callers need one import. */
export function resolveModeDescriptor(mode: AgentMode | undefined): AgentModeDescriptor {
  return agentModeDescriptor(mode ?? DEFAULT_AGENT_MODE);
}

/**
 * Fallback permission mode for a chat that never chose one.
 *
 * Historically this was hard-coded to `bypassPermissions`, which means a
 * remotely reachable server would run fully unattended agents with no approval
 * gate — the plan's G14. It is now a startup-configured value so the server can
 * be secure by default off-loopback while a single-user loopback install keeps
 * its autonomous behaviour. See `setDefaultChatPermissionMode`.
 */
let defaultChatPermissionMode: ChatPermissionMode = 'bypassPermissions';

/**
 * Sets the fallback permission mode for chats that did not pick one.
 *
 * Called exactly once during server startup. Deliberately a module-level
 * setting rather than a parameter: it is a deployment-posture decision, and
 * threading it through every `sendPrompt` call site would guarantee that one
 * path eventually forgets it and silently reverts to the unsafe default.
 */
export function setDefaultChatPermissionMode(mode: ChatPermissionMode): void {
  defaultChatPermissionMode = mode;
}

export function getDefaultChatPermissionMode(): ChatPermissionMode {
  return defaultChatPermissionMode;
}

/**
 * Maps an agent mode onto the harness permission mode for a turn.
 *
 * The mode's declared `permissionMode` always wins over the chat's configured
 * policy — that is what makes plan mode's read-only guarantee structural
 * rather than advisory. Only `auto`, whose descriptor asks for
 * `bypassPermissions`, defers to the chat so an operator can still opt a chat
 * into `acceptEdits`/`default` prompting.
 */
export function resolveTurnPermissionMode(
  agentMode: AgentMode,
  chatPermissionMode: ChatPermissionMode | undefined,
): HarnessPermissionMode {
  const descriptor = resolveModeDescriptor(agentMode);
  if (descriptor.permissionMode !== 'bypassPermissions') {
    return descriptor.permissionMode as HarnessPermissionMode;
  }
  return (chatPermissionMode ?? defaultChatPermissionMode) as HarnessPermissionMode;
}

/**
 * Whether a chat-level permission handler should be attached at all.
 *
 * This gate is a behaviour-preservation guard, not an optimisation. On Claude,
 * merely PROVIDING `onPermissionRequest` forces the SDK out of
 * `bypassPermissions` into `'default'` (see HITL-06 in ClaudeAgentProvider),
 * which would turn every existing autonomous chat into a prompt storm. So we
 * only attach it when the chat actually asked for gated permissions.
 */
export function shouldAttachPermissionHandler(
  chatPermissionMode: ChatPermissionMode | undefined,
): boolean {
  return (chatPermissionMode ?? defaultChatPermissionMode) !== 'bypassPermissions';
}

/**
 * Shared rule appended to every mode's instructions.
 *
 * The `plans/` folder is the human review record. If the agent rewrote its own
 * plan after a reviewer commented on it, an "approved" plan would no longer be
 * the artefact that was approved. Reads stay allowed — the agent must be able
 * to re-read its plan while implementing it.
 */
const PLANS_FOLDER_RULE = `The \`plans/\` folder in the workspace is managed by the system and is the
user's review record. You may READ files there, but never create, edit, move or
delete anything inside it — the platform records plans for you.`;

/** Shared markdown skeleton so a plan reads the same however it was produced. */
const PLAN_TEMPLATE = `   # <Short imperative title>

   ## Goal
   One paragraph: what changes for the user when this is done.

   ## Approach
   The chosen approach and, briefly, what you rejected and why.

   ## Changes
   A table or list of concrete edits: file path → what changes there.

   ## Risks & edge cases
   What could break, and what you will do about it.

   ## Verification
   How the change will be proven to work (tests, commands, manual checks).`;

/**
 * Plan-mode workflow instructions (blocking gate).
 *
 * Claude receives this via `planModeInstructions`, which replaces the default
 * code-implementation workflow body inside the plan-mode system reminder (the
 * CLI still wraps it with its read-only preamble and ExitPlanMode footer).
 * Copilot gets the same guidance appended to the system message.
 */
export const PLAN_MODE_INSTRUCTIONS = `You are in PLAN MODE. Do not modify any files, run mutating commands, or start implementing.

Your job this turn is to produce a clear, reviewable implementation plan.

1. RESEARCH — read the relevant code, configuration, and docs. Prefer reading
   real files over assuming. Note the exact files you would change.
2. ASK — if the request is ambiguous, or there are two or more defensible
   approaches, ask the user before committing to one. Use your question tool
   with concrete, mutually exclusive options and a short trade-off for each.
   Do not ask about things you can determine by reading the code.
3. WRITE THE PLAN — as markdown, in your reply, using this structure:

${PLAN_TEMPLATE}

4. SUBMIT — call your exit-plan-mode tool to hand the plan to the user for
   approval. Write the FULL plan text in your reply first; the reply is what
   gets captured as the plan document.

Keep the plan specific and short enough to review. Do not pad it.

${PLANS_FOLDER_RULE}`;

/**
 * Auto-mode instructions (non-blocking plan capture).
 *
 * The native exit-plan-mode tool is only registered while the session is in
 * plan mode, so an autonomous turn CANNOT use it. Instead the host exposes
 * `record_plan`, which files the plan and returns immediately. The agent then
 * implements without waiting — the plan is a durable record of intent, not a
 * gate.
 *
 * Delivered via the system message, which is fixed for the life of the
 * conversation while the mode is chosen per turn. The wording is therefore
 * explicitly scoped to "when you are NOT in plan mode" so it stays correct if
 * the user switches to Plan without the conversation being rebuilt.
 */
export const AUTO_MODE_PLAN_INSTRUCTIONS = `PLAN RECORDING (applies when you are NOT in plan mode)

When you are working autonomously, never wait for approval and never ask the
user to confirm before acting.

If the user asks you to plan something — or the task is large enough that you
would naturally write a plan first — call the \`record_plan\` tool ONCE with
the full plan before you start editing. Use this structure for the content:

${PLAN_TEMPLATE}

\`record_plan\` returns immediately and does NOT pause you. After calling it,
carry straight on and implement the plan. Do not call it for trivial
single-file edits, and do not call it more than once per turn.

If you ARE in plan mode, ignore this section and use your exit-plan-mode tool
instead — that is the path that asks the user for approval.

${PLANS_FOLDER_RULE}`;

/** The instruction block for a mode, or `undefined` when it needs none. */
export function instructionsForMode(mode: AgentMode | undefined): string | undefined {
  const descriptor = resolveModeDescriptor(mode);
  if (descriptor.planGate === 'blocking') return PLAN_MODE_INSTRUCTIONS;
  if (descriptor.usesRecordPlanTool) return AUTO_MODE_PLAN_INSTRUCTIONS;
  return undefined;
}

/**
 * Builds the system-message append used by providers that have no native
 * plan-mode reminder (Copilot).
 */
export function buildPlanModeSystemAppend(custom?: string): string {
  return `\n\n${custom ?? PLAN_MODE_INSTRUCTIONS}`;
}

/** Prompt sent back to the agent once a plan is approved. */
export function buildApprovalContinuationPrompt(title: string): string {
  return (
    `The plan "${title}" was APPROVED by the user. ` +
    `Implement it now, following the plan exactly. ` +
    `If you discover the plan is wrong, stop and explain rather than improvising.`
  );
}
