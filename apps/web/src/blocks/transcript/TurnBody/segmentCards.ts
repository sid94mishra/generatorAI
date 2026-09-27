// ────────────────────────────────────────────────────────────────
// Segment-card registry — renderers for transcript segments whose cards live
// outside the transcript kit (D-35 extension point, like the tool-card
// registry).
//
// The Workflow Overhaul's `deriveSegments` (client-core) turns a completed
// `run_workflow` / `create_workflow_draft` call into its own segment
// (`workflow_run`, `workflow_draft`): the run card follows the run live from
// the chat's run list, and the draft card opens or publishes the draft. Those
// cards are Overhaul UI, so TurnBody draws them through this registry instead
// of importing them; `app/registries/workflowTranscriptCards.tsx` registers
// them at module load, loaded with the chat and workflow routes. An
// unregistered segment type is not drawn (D-36).
//
//   registerSegmentCard('workflow_run', (segment, ctx) => <RunCard run={segment.run} chatId={ctx.chatId} />);
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { StreamSegment } from '@generatorai/client-core';
import type { TranscriptActions } from '../transcriptContext.js';

export type SegmentCardType = 'workflow_run' | 'workflow_draft';

export type SegmentCardRenderer<T extends SegmentCardType> = (
  segment: Extract<StreamSegment, { type: T }>,
  ctx: TranscriptActions,
) => ReactNode;

const renderers = new Map<SegmentCardType, SegmentCardRenderer<SegmentCardType>>();

/** Register (or replace) the card drawn for a segment type. Returns an unregister function. */
export function registerSegmentCard<T extends SegmentCardType>(type: T, render: SegmentCardRenderer<T>): () => void {
  const entry = render as unknown as SegmentCardRenderer<SegmentCardType>;
  renderers.set(type, entry);
  return () => {
    if (renderers.get(type) === entry) renderers.delete(type);
  };
}

/** The renderer registered for a segment type, if any. */
export function segmentCardRenderer<T extends SegmentCardType>(type: T): SegmentCardRenderer<T> | undefined {
  return renderers.get(type) as unknown as SegmentCardRenderer<T> | undefined;
}
