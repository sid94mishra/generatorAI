// ────────────────────────────────────────────────────────────────
// PLN-01 — Copilot plan-mode bridges
//
// The Copilot SDK exposes plan mode as first-class session callbacks:
//   SessionConfig.onExitPlanModeRequest — the agent finished planning
//   SessionConfig.onUserInputRequest    — the agent needs clarification
// plus the per-message `MessageOptions.agentMode` switch.
//
// This module translates between those vendor shapes and the domain shapes so
// the same handlers can be installed on BOTH the create and the resume path
// (a handler missing on resume silently kills plan mode after a restart).
// ────────────────────────────────────────────────────────────────

import type { AgentMode, AgentQuestion, PlanAction } from '@generatorai/shared';

/**
 * Copilot's session-mode vocabulary.
 *
 * Deliberately narrowed to the two values this adapter ever sets. The SDK's
 * `MessageOptions.agentMode` also allows `autopilot`/`shell`, but its
 * `session.mode.set` RPC accepts a smaller union — keeping this narrow means
 * the compiler checks the RPC call instead of us casting.
 */
export type CopilotSessionMode = 'interactive' | 'plan';

/**
 * Maps a domain agent mode onto the Copilot CLI's session-mode vocabulary.
 *
 * The two vocabularies are deliberately separate: ours describes intent
 * (`auto` = "work autonomously"), the CLI's describes its own runtime modes.
 * `auto` maps to the CLI's `interactive`, which is its ordinary
 * work-and-edit mode — the naming collision is exactly why the translation
 * lives here rather than leaking a vendor string into the domain.
 *
 * Unknown modes fall back to `interactive` so a future domain mode can never
 * send the CLI a value it will reject.
 */
export function toCopilotSessionMode(mode: AgentMode | undefined): CopilotSessionMode {
  return mode === 'plan' ? 'plan' : 'interactive';
}

/** Maps a CLI session mode back onto the domain vocabulary. */
export function fromCopilotSessionMode(mode: string | undefined): AgentMode | undefined {
  if (mode === 'plan') return 'plan';
  if (mode === 'interactive') return 'auto';
  // `autopilot` / `shell` have no domain equivalent in v1 — reporting
  // `undefined` keeps the session-mode cache honest instead of guessing.
  return undefined;
}

/** Copilot's `ExitPlanModeAction` values. */
type CopilotExitAction = 'exit_only' | 'interactive' | 'autopilot' | 'autopilot_fleet';

/**
 * Normalises Copilot's action strings into the domain set.
 *
 * Never trust the raw provider strings — the SDK types them loosely as
 * `string[]` on `ExitPlanModeRequest`, and unknown future values must not leak
 * into the UI or the database.
 */
export function normalisePlanActions(actions: readonly string[] | undefined): PlanAction[] {
  const mapped = new Set<PlanAction>();
  for (const action of actions ?? []) {
    switch (action as CopilotExitAction) {
      case 'exit_only':
        mapped.add('exit_only');
        break;
      case 'interactive':
        mapped.add('implement_interactive');
        break;
      case 'autopilot':
      // `autopilot_fleet` (parallel workers) is deliberately collapsed into the
      // single-agent autopilot action; fleet mode is not exposed in v1.
      case 'autopilot_fleet':
        mapped.add('implement_autopilot');
        break;
      default:
        break;
    }
  }
  // Always give the user a way out even if the provider sent nothing usable.
  if (mapped.size === 0) {
    mapped.add('implement_interactive');
    mapped.add('exit_only');
  }
  return [...mapped];
}

/** Maps a domain action back to the Copilot `selectedAction` string. */
export function toCopilotAction(action: PlanAction | undefined): CopilotExitAction | undefined {
  switch (action) {
    case 'exit_only':
      return 'exit_only';
    case 'implement_interactive':
      return 'interactive';
    case 'implement_autopilot':
      return 'autopilot';
    default:
      return undefined;
  }
}

/**
 * Resolves the plan text from a Copilot exit-plan-mode request.
 *
 * `planContent` is declared OPTIONAL on `ExitPlanModeRequest`, so we fall back
 * to the summary and finally to the accumulated assistant text. Returns `null`
 * when nothing usable is available so the caller can fail loudly rather than
 * open a review gate on an empty plan.
 */
export function resolveCopilotPlanContent(
  planContent: string | undefined,
  summary: string | undefined,
  accumulatedTurnText: string,
): string | null {
  if (planContent && planContent.trim().length > 0) return planContent;
  const accumulated = accumulatedTurnText.trim();
  if (accumulated.length > 0) return accumulated;
  if (summary && summary.trim().length > 0) return summary;
  return null;
}

/**
 * Wraps Copilot's single-question `UserInputRequest` in the domain's
 * multi-question shape.
 */
export function normaliseCopilotQuestion(request: {
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
}): AgentQuestion[] {
  return [
    {
      id: 'q0',
      header: deriveHeader(request.question),
      question: request.question,
      options: (request.choices ?? []).map((choice) => ({ label: choice })),
      multiSelect: false,
      allowFreeform: request.allowFreeform !== false,
    },
  ];
}

/** Collapses the domain answer record into Copilot's flat `answer` string. */
export function flattenAnswer(
  answers: Record<string, string[]>,
  freeformResponse: string | undefined,
  choices: readonly string[] | undefined,
): { answer: string; wasFreeform: boolean } {
  const selected = answers['q0'] ?? [];
  const answer = selected.length > 0 ? selected.join(', ') : (freeformResponse ?? '');
  const known = new Set(choices ?? []);
  const wasFreeform = selected.length === 0 || selected.some((s) => !known.has(s));
  return { answer, wasFreeform };
}

/** Best-effort ≤12-char chip label, matching the Claude question contract. */
function deriveHeader(question: string): string {
  const words = question.replace(/[?.!]/g, '').trim().split(/\s+/);
  let header = '';
  for (const word of words) {
    const next = header ? `${header} ${word}` : word;
    if (next.length > 12) break;
    header = next;
  }
  return header || 'Question';
}
