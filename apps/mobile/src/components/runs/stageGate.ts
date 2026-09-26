// ────────────────────────────────────────────────────────────────
// stageGate — which card a stage parked on a human decision needs.
//
// A stage parks on four kinds of gate (`interruptData.kind`). Three happen
// INSIDE a turn — a tool permission, a question, a plan review — and are the
// chat's gates with a stage behind them, so they render as the chat's cards
// and are answered through the stage conversation API (P03b). The fourth,
// the completion review, stays the approval card and the `approve` command.
//
// Pure: the card blocks are rebuilt from `interruptData` (what the run
// query carries after a reload), not from the live stream.
// ────────────────────────────────────────────────────────────────

import type { PermissionBlock, PlanSummary, QuestionBlock } from '@generatorai/client-core';

export type StageGate =
  | { kind: 'permission'; interactionId: string; block: PermissionBlock }
  | { kind: 'question'; interactionId: string; block: QuestionBlock }
  | { kind: 'plan'; interactionId: string; plan: PlanSummary }
  /** The completion review (or a gate this build does not know): the approval card. */
  | { kind: 'review' };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function stageGateOf(interruptData: unknown): StageGate {
  if (!interruptData || typeof interruptData !== 'object' || Array.isArray(interruptData)) return { kind: 'review' };
  const d = interruptData as Record<string, unknown>;
  const interactionId = str(d['interactionId']);
  if (!interactionId) return { kind: 'review' };
  switch (d['kind']) {
    case 'tool_permission': {
      const request = (d['request'] && typeof d['request'] === 'object' ? d['request'] : {}) as Record<string, unknown>;
      return {
        kind: 'permission',
        interactionId,
        block: {
          type: 'permission',
          blockId: 0,
          interactionId,
          toolName: str(d['toolName']) || str(request['type']) || 'tool',
          permissionType: str(d['type']) || str(request['type']),
          description: str(d['description']) || str(request['description']),
          inputSummary: str(d['inputSummary']),
          permissionMode: str(d['permissionMode']),
          status: 'pending',
        },
      };
    }
    case 'question':
      return {
        kind: 'question',
        interactionId,
        block: {
          type: 'question',
          blockId: 0,
          interactionId,
          questions: Array.isArray(d['questions']) ? (d['questions'] as QuestionBlock['questions']) : [],
          status: 'pending',
        },
      };
    case 'plan_review':
      return {
        kind: 'plan',
        interactionId,
        plan: {
          planId: str(d['planId']),
          revision: typeof d['revision'] === 'number' ? d['revision'] : 1,
          title: str(d['title']) || 'Plan',
          summary: str(d['summary']),
          status: 'awaiting_review',
          actions: Array.isArray(d['actions']) ? (d['actions'] as unknown[]).filter((a): a is string => typeof a === 'string') : [],
          interactionId,
        },
      };
    default:
      return { kind: 'review' };
  }
}
