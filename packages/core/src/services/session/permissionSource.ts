// ────────────────────────────────────────────────────────────────
// PermissionModeSource (WP-2.7; W-07, W-19, PD-17, PD-18, RV-30).
//
// Where a session's persistent permission policy comes from, re-read every
// turn so a mode change applies from the next turn on:
//   chat  — the chat row;
//   run   — the run row → the stage's `session.permissionMode` → the
//           workflow's → the trigger's (an automation's declared mode) →
//           undefined, which `resolveTurnPermissionMode` resolves to the
//           deployment posture. A NULL run mode is never bypass. For a
//           trigger-started run the automation's mode is a CEILING over the
//           definition layers: the more restrictive of the two wins, so a
//           definition cannot widen what the automation's owner declared
//           (P02 review R5). An explicit run-row mode (admin-gated for
//           bypass) still decides.
// ────────────────────────────────────────────────────────────────

import type { AgentMode, ChatPermissionMode, WorkflowRun } from '@generatorai/shared';
import type { SessionSpec } from '@generatorai/workflow-spec';
import type { SendPromptOptions } from '../../domain/ports/IAgentHarness.js';
import { getDefaultChatPermissionMode, resolveTurnPermissionMode } from '../agentModePolicy.js';
import { capabilityLevelsFor } from './capabilityLevels.js';
import { ComposeError, type ComposeWarning } from './types.js';

export interface PermissionModeSource {
  kind: 'chat' | 'run';
  /** The persistent mode, or undefined to use the deployment posture. */
  read(): Promise<ChatPermissionMode | undefined>;
}

/** Engine-state key a run's trigger-declared mode is kept under (PD-18). */
export const TRIGGER_PERMISSION_MODE_KEY = '__triggerPermissionMode';

/** A run's mode through its layers, without the deployment posture. */
export function runPermissionMode(
  run: Pick<WorkflowRun, 'permissionMode' | 'variables'>,
  stage: SessionSpec | undefined,
  workflow: SessionSpec | undefined,
): ChatPermissionMode | undefined {
  if (run.permissionMode) return run.permissionMode as ChatPermissionMode;
  const raw = run.variables?.[TRIGGER_PERMISSION_MODE_KEY];
  const trigger = typeof raw === 'string' ? (raw as ChatPermissionMode) : undefined;
  const definition = (stage?.permissionMode ?? workflow?.permissionMode) as ChatPermissionMode | undefined;
  if (!trigger) return definition;
  if (!definition) return trigger;
  return (PERMISSIVENESS[definition] ?? 3) <= (PERMISSIVENESS[trigger] ?? 3) ? definition : trigger;
}

/** How much a mode lets through without asking (higher = more). */
const PERMISSIVENESS: Record<string, number> = { plan: 0, default: 1, acceptEdits: 2, dontAsk: 2, bypassPermissions: 3 };

/** The run source: every read goes back to the run row. */
export function runPermissionSource(
  readRun: () => Promise<Pick<WorkflowRun, 'permissionMode' | 'variables'>>,
  stage: SessionSpec | undefined,
  workflow: SessionSpec | undefined,
): PermissionModeSource {
  return { kind: 'run', read: async () => runPermissionMode(await readRun(), stage, workflow) };
}

/** Per-turn provider options: the turn's agent mode over the source's policy. */
export async function turnOptionsFrom(agentMode: AgentMode, source: PermissionModeSource): Promise<SendPromptOptions> {
  return { agentMode, permissionMode: resolveTurnPermissionMode(agentMode, await source.read()) };
}

/**
 * PD-17 — what a run mode means on a provider's gating level:
 * - `per_call`: every mode is enforceable;
 * - `exec_and_patch` (Codex): `default`/`acceptEdits` ask per command and
 *   patch, not per tool (a warning); `plan` runs in the read-only sandbox;
 * - `none` (opencode): only `bypassPermissions`/`acceptEdits` — `default` and
 *   `plan` cannot be held and are refused.
 * `mode` undefined means the deployment posture.
 */
export function checkPermissionGating(
  provider: string | undefined,
  mode: string | undefined,
): { warning?: ComposeWarning } {
  const levels = capabilityLevelsFor(provider);
  if (!levels) return {};
  const effective = mode ?? getDefaultChatPermissionMode();
  if (levels.approvalGating === 'none' && (effective === 'default' || effective === 'plan')) {
    throw new ComposeError(
      'PERMISSION_GATING_UNSUPPORTED',
      `The ${provider} provider never asks before acting, so it cannot run under the '${effective}' permission mode. ` +
        `Use 'acceptEdits' or 'bypassPermissions', or pick a provider that asks per call.`,
    );
  }
  if (levels.approvalGating === 'exec_and_patch' && (effective === 'default' || effective === 'acceptEdits')) {
    return {
      warning: {
        code: 'permission_gating_exec_and_patch',
        message: `${provider} asks per command and per patch, not per tool: other tool calls run under its sandbox policy`,
        params: { provider, mode: effective },
      },
    };
  }
  return {};
}
