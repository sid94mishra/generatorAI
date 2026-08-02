// ────────────────────────────────────────────────────────────────
// PLN-01 — Claude plan-mode gate
//
// The Claude Agent SDK surfaces plan mode through two built-in tools that are
// routed to `canUseTool`:
//
//   ExitPlanMode      — the model has finished planning and wants approval
//   AskUserQuestion   — the model needs clarification before it can plan
//
// Neither is a "permission" in the domain sense, so the adapter demultiplexes
// them out of the generic permission path and into dedicated blocking handlers.
// ────────────────────────────────────────────────────────────────

import type { AgentQuestion, PlanAction } from '@generatorai/shared';

export const EXIT_PLAN_MODE_TOOL = 'ExitPlanMode';
export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion';

/** Tools the plan gate owns. They must never reach the generic permission handler. */
export function isPlanGateTool(toolName: string): boolean {
  return toolName === EXIT_PLAN_MODE_TOOL || toolName === ASK_USER_QUESTION_TOOL;
}

/**
 * Built-in Claude tools that write to the filesystem. Used after plan approval
 * to decide what `acceptEdits` may auto-allow.
 */
const FILE_WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'FileWrite',
  'FileEdit',
  'create_file',
  'edit_file',
  'str_replace',
]);

const FILE_READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'FileRead']);

export function isFileWriteTool(toolName: string): boolean {
  return FILE_WRITE_TOOLS.has(toolName);
}

export function isFileReadTool(toolName: string): boolean {
  return FILE_READ_TOOLS.has(toolName);
}

/**
 * Extracts the plan text from an `ExitPlanMode` tool call.
 *
 * IMPORTANT: the SDK's `ExitPlanModeInput` declares only a deprecated
 * `allowedPrompts` field plus an open index signature — there is **no
 * contractual `plan` field**. The plan lives in `ExitPlanModeOutput`, which we
 * never see from `canUseTool`. So we try, in order:
 *
 *   1. `input.plan` (opportunistic — permitted by the index signature)
 *   2. the assistant text accumulated during this turn (in plan mode the model
 *      writes the plan as its message right before calling ExitPlanMode)
 *
 * Returns `null` when neither source yields content, so the caller can fail
 * loudly instead of opening a review gate on an empty plan.
 */
export function extractPlanContent(
  input: Record<string, unknown>,
  accumulatedTurnText: string,
): string | null {
  const candidates = [input['plan'], input['planContent'], input['content']];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  const accumulated = accumulatedTurnText.trim();
  return accumulated.length > 0 ? accumulated : null;
}

/** Derives a one-line summary from plan markdown (first heading or first line). */
export function derivePlanSummary(planContent: string): string {
  const lines = planContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading?.[1]) return heading[1].trim().slice(0, 200);
    if (!trimmed.startsWith('```')) return trimmed.replace(/^[-*]\s*/, '').slice(0, 200);
  }
  return 'Implementation plan';
}

/**
 * Actions offered for a Claude plan. Claude has no equivalent of Copilot's
 * `ExitPlanModeAction` list, so we offer the full domain set.
 */
export const CLAUDE_PLAN_ACTIONS: PlanAction[] = [
  'implement_interactive',
  'implement_autopilot',
  'exit_only',
];

interface RawQuestion {
  question?: unknown;
  header?: unknown;
  options?: unknown;
  multiSelect?: unknown;
}

/**
 * Normalises `AskUserQuestionInput` into the domain shape.
 *
 * Claude's contract: 1-4 questions, each with 2-4 options, `header` capped at
 * 12 characters, and **no "Other" option** — the host is expected to render the
 * free-text escape hatch itself, so `allowFreeform` is always true here.
 */
export function normaliseClaudeQuestions(input: Record<string, unknown>): AgentQuestion[] {
  const raw = Array.isArray(input['questions']) ? (input['questions'] as RawQuestion[]) : [];
  return raw.map((q, index) => {
    const options = Array.isArray(q.options) ? q.options : [];
    return {
      id: `q${index}`,
      header: typeof q.header === 'string' ? q.header.slice(0, 12) : `Q${index + 1}`,
      question: typeof q.question === 'string' ? q.question : '',
      options: options.map((o) => {
        const opt = (o ?? {}) as Record<string, unknown>;
        return {
          label: typeof opt['label'] === 'string' ? opt['label'] : String(opt['label'] ?? ''),
          description: typeof opt['description'] === 'string' ? opt['description'] : undefined,
          preview: typeof opt['preview'] === 'string' ? opt['preview'] : undefined,
        };
      }),
      multiSelect: q.multiSelect === true,
      allowFreeform: true,
    } satisfies AgentQuestion;
  });
}

/**
 * Builds the `updatedInput` Claude expects back from an `AskUserQuestion`
 * approval: the ORIGINAL questions array plus an `answers` record keyed by the
 * question **text** (not our synthetic id), values being the selected labels.
 */
export function buildAskUserQuestionResult(
  input: Record<string, unknown>,
  normalised: AgentQuestion[],
  answers: Record<string, string[]>,
  freeformResponse?: string,
): Record<string, unknown> {
  const answerMap: Record<string, string | string[]> = {};
  for (const question of normalised) {
    const selected = answers[question.id];
    if (!selected || selected.length === 0) continue;
    answerMap[question.question] = question.multiSelect ? selected : (selected[0] ?? '');
  }
  return {
    ...input,
    questions: input['questions'] ?? normalised,
    answers: answerMap,
    ...(freeformResponse ? { response: freeformResponse } : {}),
  };
}
