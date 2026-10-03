// ────────────────────────────────────────────────────────────────
// Task detail read model (D-89): a worker's latest tool calls
// (`BackgroundTaskDetail.lastSteps`) as the same timeline steps the
// transcript draws, and the orchestrator's review as one line. Web's Tasks
// dock and mobile's task detail render these.
// ────────────────────────────────────────────────────────────────

import type { BackgroundTaskDetail } from '@generatorai/shared';
import type { StreamBlock, ToolFileOp } from '../stream/types.js';
import { deriveTimeline } from './deriveTimeline.js';
import type { TimelineStep } from './types.js';

/** The worker's latest tool calls as settled timeline steps (folded the way the transcript folds them). */
export function taskDetailSteps(detail: Pick<BackgroundTaskDetail, 'lastSteps'>): TimelineStep[] {
  const blocks: StreamBlock[] = detail.lastSteps.map((step, i) => ({
    type: 'tool_call',
    blockId: i,
    callId: step.id,
    tool: step.tool,
    args: step.args,
    status: step.status === 'complete' ? 'complete' : 'running',
    ...(step.success === false ? { error: true } : {}),
    ...(step.fileOp ? { fileOp: step.fileOp as ToolFileOp } : {}),
  }));
  return deriveTimeline(blocks, { active: false });
}

/** "Reviewed by the orchestrator · accepted · 1 of 3 rounds"; undefined while nothing was reviewed. */
export function taskReviewLine(detail: Pick<BackgroundTaskDetail, 'outcome' | 'reviewRounds' | 'maxReviewRounds'>): string | undefined {
  const verdict =
    detail.outcome === 'accepted'
      ? 'accepted'
      : detail.outcome === 'in_review'
        ? 'reading the result'
        : detail.outcome === 'reworking'
          ? 'asked for changes'
          : undefined;
  if (!verdict && detail.reviewRounds === 0) return undefined;
  const rounds = `${detail.reviewRounds} of ${detail.maxReviewRounds} review round${detail.maxReviewRounds === 1 ? '' : 's'}`;
  return ['Reviewed by the orchestrator', verdict, rounds].filter(Boolean).join(' · ');
}
