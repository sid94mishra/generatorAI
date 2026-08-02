// ────────────────────────────────────────────────────────────────
// recordPlanTool (PLN-01) — non-blocking plan capture for autonomous modes.
//
// The native exit-plan-mode tool only exists while the harness session is in
// plan mode:
//   • Copilot strips `exit_plan_mode` from the tool list whenever the session
//     mode is not `plan`.
//   • Claude only surfaces `ExitPlanMode` under `permissionMode: 'plan'`.
//
// So an autonomous turn physically cannot produce a plan through the gate.
// This host tool closes that gap: it files a real PlanDocument (identical
// storage, identical Plan tab, identical card) and returns IMMEDIATELY, so the
// agent records its intent and then implements without waiting for anyone.
//
// It is registered only for modes whose descriptor sets `usesRecordPlanTool`.
// ────────────────────────────────────────────────────────────────

import type { ToolDefinition } from '../domain/ports/IAgentHarness.js';

export const RECORD_PLAN_TOOL_NAME = 'record_plan';

/** Bounds mirror the plan-content column limits enforced by the API schemas. */
const MAX_TITLE = 200;
const MAX_CONTENT = 500_000;

export interface RecordPlanArgs {
  title: string;
  content: string;
}

export interface RecordPlanResult {
  planId: string;
  fileName: string;
}

/**
 * Builds the `record_plan` tool.
 *
 * @param record Persists the plan and returns its identity. Supplied by
 *   ChatManagementService / StageExecutionService so this module stays free of
 *   service dependencies.
 */
export function createRecordPlanTool(
  record: (args: RecordPlanArgs) => Promise<RecordPlanResult | null>,
): ToolDefinition {
  return {
    name: RECORD_PLAN_TOOL_NAME,
    description:
      'Record an implementation plan for the user to read. Returns immediately and does ' +
      'NOT pause you — after calling it, continue and implement the plan. Call it at most ' +
      'once per turn, and only when the user asked for a plan or the task is large enough ' +
      'to warrant one.',
    parametersSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short imperative title, e.g. "Add OAuth login".',
        },
        content: {
          type: 'string',
          description:
            'The full plan as markdown, with Goal / Approach / Changes / Risks & edge cases / Verification sections.',
        },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
    // Recording a plan writes only to a system-managed location, never to the
    // user's tree, so it never needs a permission prompt.
    skipPermission: true,
    owner: 'plan-mode',
    handler: async (args: Record<string, unknown>) => {
      const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
      const content = typeof args['content'] === 'string' ? args['content'] : '';

      if (!content.trim()) {
        return {
          ok: false,
          error: 'content is required — pass the full plan markdown.',
        };
      }

      const result = await record({
        title: (title || 'Implementation plan').slice(0, MAX_TITLE),
        content: content.slice(0, MAX_CONTENT),
      });

      if (!result) {
        // Never fail the turn over a bookkeeping tool — tell the model to
        // carry on rather than leaving it to invent a retry strategy.
        return {
          ok: false,
          error: 'Plan could not be recorded. Continue with the implementation anyway.',
        };
      }

      return {
        ok: true,
        planId: result.planId,
        fileName: result.fileName,
        message: 'Plan recorded and shown to the user. Continue with the implementation now.',
      };
    },
  };
}
