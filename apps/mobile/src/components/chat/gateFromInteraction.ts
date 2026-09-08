// ────────────────────────────────────────────────────────────────
// gateFromInteraction — a pending server interaction as a gate card.
//
// The stream reducer builds `PermissionBlock` / `QuestionBlock` from live
// events, so a gate that opened while the screen was mounted is already in
// the store. One that was ALREADY pending when the screen mounts — a cold
// load, the Home decision card, a push deep link — arrives only through
// `GET /api/chats/:id/interactions`, whose pending rows carry the payload
// the gate was opened with. This rebuilds the block shapes the reducer
// would have produced, so the same cards render from either source.
//
// Pure, so the chat screen and the gate sheet share one conversion and the
// rule "pending only, first row wins" is unit-tested without a renderer.
// ────────────────────────────────────────────────────────────────

import type { InteractionSummary, PlanSummary, StreamBlock } from '@generatorai/client-core';

export type PermissionBlock = Extract<StreamBlock, { type: 'permission' }>;
export type QuestionBlock = Extract<StreamBlock, { type: 'question' }>;

export type Gate =
  | { kind: 'permission'; block: PermissionBlock }
  | { kind: 'question'; block: QuestionBlock }
  | { kind: 'plan'; plan: PlanSummary }
  | { kind: 'unknown' };

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Rebuild the block shapes the stream reducer would have produced. */
export function gateFromPayload(
  interactionId: string,
  kind: string,
  payload: Record<string, unknown>,
): Gate {
  if (kind === 'tool_permission') {
    return {
      kind: 'permission',
      block: {
        type: 'permission',
        blockId: 0,
        interactionId,
        toolName: str(payload['toolName'], 'Tool'),
        permissionType: str(payload['type']),
        description: str(payload['description']),
        inputSummary: str(payload['inputSummary']),
        permissionMode: str(payload['permissionMode']),
        status: 'pending',
      },
    };
  }
  if (kind === 'question') {
    return {
      kind: 'question',
      block: {
        type: 'question',
        blockId: 0,
        interactionId,
        questions: Array.isArray(payload['questions'])
          ? (payload['questions'] as QuestionBlock['questions'])
          : [],
        status: 'pending',
      },
    };
  }
  if (kind === 'plan_review') {
    return {
      kind: 'plan',
      plan: {
        planId: str(payload['planId']),
        revision: Number(payload['revision'] ?? 1),
        title: str(payload['title'], 'Plan'),
        summary: str(payload['summary']),
        status: 'awaiting_review',
        actions: Array.isArray(payload['actions']) ? (payload['actions'] as string[]) : [],
        interactionId,
      },
    };
  }
  return { kind: 'unknown' };
}

/**
 * The gate the chat is blocked on, from the server's interaction list — or
 * null when nothing is pending. The server refuses a prompt while ANY row
 * is pending, so the first pending row is the one to surface.
 */
export function pendingGateFrom(rows: readonly InteractionSummary[] | undefined): Gate | null {
  if (!rows) return null;
  const row = rows.find((r) => r.status === 'pending');
  if (!row) return null;
  const gate = gateFromPayload(row.interactionId, row.kind, row.payload ?? {});
  return gate.kind === 'unknown' ? null : gate;
}
