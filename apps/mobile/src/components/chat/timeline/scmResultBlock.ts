// ────────────────────────────────────────────────────────────────
// The `chat.scm.result` transcript block.
//
// The server emits `chat.scm.result` on the session scope after an
// agent-native turn commits (`.github/docs/feature-source-control.md` §5).
// client-core's reducer turns it into a block; this file is the mobile
// side's contract for that block, kept structural on purpose:
//
//   • `asScmResultBlock` narrows by shape, not by the `StreamBlock` union,
//     so the row renders correctly whether or not client-core's union has
//     caught up — and a malformed event renders nothing instead of crashing
//     a transcript.
//   • Nothing else in the timeline needs to know the block exists: the
//     derivation asks this one predicate.
// ────────────────────────────────────────────────────────────────

import type { ScmFlowResult } from '@generatorai/shared';

export interface ScmResultBlock {
  type: 'scm_result';
  blockId: number;
  /** The chat the flow ran for — the conflict actions need it. */
  chatId?: string;
  /** The turn whose change set was committed. */
  turnId?: string;
  result: ScmFlowResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A `ScmFlowResult` is only usable here if it carries a status and an alias. */
function isFlowResult(value: unknown): value is ScmFlowResult {
  if (!isRecord(value)) return false;
  const status = value['status'];
  if (status !== 'ok' && status !== 'conflicts' && status !== 'blocked' && status !== 'failed') return false;
  return typeof value['alias'] === 'string' && Array.isArray(value['steps']);
}

export function asScmResultBlock(block: unknown): ScmResultBlock | null {
  if (!isRecord(block)) return null;
  if (block['type'] !== 'scm_result') return null;
  if (typeof block['blockId'] !== 'number') return null;
  if (!isFlowResult(block['result'])) return null;
  return block as unknown as ScmResultBlock;
}
