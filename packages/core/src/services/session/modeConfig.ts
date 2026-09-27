// ────────────────────────────────────────────────────────────────
// Mode config and gate wiring (WP-2.6; RV-41 P6/P7).
//
// The conversation outlives any single turn while the agent mode is chosen
// per turn, so everything a mode can need is installed once: the three gate
// callbacks, the Claude plan-mode instructions, the auto-mode plan-recording
// block, and the non-blocking `record_plan` tool. The callbacks look up the
// turn in flight and hand it to the owner's gate port.
// ────────────────────────────────────────────────────────────────

import type { AgentMode, AgentToolPolicy } from '@generatorai/shared';
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import { createRecordPlanTool, RECORD_PLAN_TOOL_NAME } from '../../tools/recordPlanTool.js';
import { AUTO_MODE_PLAN_INSTRUCTIONS, PLAN_MODE_INSTRUCTIONS, PLAN_MODE_TURN_PREFIX } from '../agentModePolicy.js';
import { appendSystemBlock, appendTools, type ConversationConfig } from './cfg.js';
import { withAgentToolPolicy, type GatePort, type TurnContextRegistry } from './gates.js';

export interface ModeConfigInput {
  conversationId: string;
  turns: TurnContextRegistry;
  /** The owner's gates; undefined when plan mode is not wired (nothing is installed). */
  gates: GatePort | undefined;
  /** Unattended sessions (orchestrator workers) never open a gate: nobody would answer. */
  attended: boolean;
  /** The bound agent's tool groups, enforced in the permission gate (W-53). */
  groups: AgentToolPolicy;
  /** Replaces the default plan-mode workflow text (Claude, plan-mode turns). */
  planModeInstructions?: string | undefined;
  /**
   * Put this construction-time permission mode on the config. A chat attaches
   * its mode only when it asks for gated permissions (`shouldAttachPermissionHandler`),
   * which is part of its binding key; a stage passes none — its mode travels
   * per turn from the run's `PermissionModeSource`.
   */
  attachPermissionMode?: { mode: string | undefined } | undefined;
}

export function applyModeConfig(cfg: ConversationConfig, i: ModeConfigInput): void {
  if (!i.gates || !i.attended) return;
  const port = withAgentToolPolicy(i.gates, i.groups);
  const { turns, conversationId } = i;

  cfg['onPlanReviewRequest'] = async (req: Parameters<NonNullable<GatePort['planReview']>>[0]) => {
    const turn = turns.get(conversationId);
    // Not wired for this owner, or no turn to report against: let the agent
    // proceed rather than hang.
    if (!turn || !port.planReview) return { approved: true, action: 'implement_interactive' as const };
    return port.planReview(req, turn);
  };
  cfg['onQuestionRequest'] = async (req: Parameters<NonNullable<GatePort['question']>>[0]) => {
    const turn = turns.get(conversationId);
    if (!turn || !port.question) return { answers: {} };
    return port.question(req, turn);
  };
  cfg['onPermissionRequest'] = async (req: Parameters<GatePort['permission']>[0]) => {
    const turn = turns.get(conversationId);
    // Reaching the handler means the harness did not auto-allow the call; a
    // silent allow here is the failure review 5.1 was about.
    if (!turn) return { granted: false, reason: 'No approval channel is available for this session.' };
    return port.permission(req, turn);
  };

  // Both instruction blocks go in regardless of the owner's default mode —
  // the mode is chosen per turn. `planModeInstructions` is Claude-only and
  // applies only on `permissionMode: 'plan'` turns; the system block reaches
  // every provider on every turn and is scoped to "when NOT in plan mode".
  cfg['planModeInstructions'] = i.planModeInstructions ?? PLAN_MODE_INSTRUCTIONS;
  appendSystemBlock(cfg, `\n\n${AUTO_MODE_PLAN_INSTRUCTIONS}`);

  // `record_plan`: autonomous turns file a plan without a gate; in plan mode
  // (providers without a native plan tool) the same call is the review gate.
  const existing = Array.isArray(cfg['tools']) ? (cfg['tools'] as ToolDefinition[]) : [];
  if (port.recordPlan && !existing.some((t) => t.name === RECORD_PLAN_TOOL_NAME)) {
    const record = port.recordPlan;
    appendTools(cfg, [
      createRecordPlanTool(async (args) => {
        const turn = turns.get(conversationId);
        return turn ? record(args, turn) : null;
      }),
    ]);
  }

  if (i.attachPermissionMode) cfg['permissionMode'] = i.attachPermissionMode.mode;
}

/**
 * Plan mode for a provider without a native plan gate (Codex, OpenCode, ACP):
 * nothing else tells the model it is planning, so the turn's prompt says so
 * (P7). Providers with a native gate get it from `permissionMode: 'plan'`.
 */
export function planPromptPrefix(agentMode: AgentMode, nativePlanGate: boolean): string {
  return agentMode === 'plan' && !nativePlanGate ? PLAN_MODE_TURN_PREFIX : '';
}
