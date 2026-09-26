// ────────────────────────────────────────────────────────────────
// ControlFlowNode — one instance of the run timeline, by kind (P05):
// a loop (LoopTimelineItem), a map (MapTimelineItem), a planner's expansion
// (ExpansionTimelineItem, P08), a wait (its card),
// a sub-workflow (its child run and mirrored decisions), or a plain stage
// (inside a container: with its loop turns above the transcript). The top
// level and every container body render through here, so any nesting of
// loops and maps works.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { RunCommand } from '@generatorai/workflow-spec';
import { LoopBodyStage, LoopTimelineItem, type RenderStage } from './LoopTimelineItem.js';
import { MapTimelineItem } from './MapTimelineItem.js';
import { ExpansionTimelineItem } from './ExpansionTimelineItem.js';
import { SubworkflowCard, WaitBadge, WaitCard, useRunDecisions } from './ControlFlowCards.js';
import type { StageView } from './types.js';

export interface ControlFlowNodeProps {
  runId: string;
  stage: StageView;
  bodies: Record<string, StageView[]>;
  focusedId: string | null;
  showConnector: boolean;
  renderStage: RenderStage;
  /** A run command on this run; resolves once it settled. */
  onCommand: (command: RunCommand) => Promise<void>;
  /** A body instance of a loop or a map (its loop turns show above its transcript). */
  inContainer?: boolean;
  /** Open the row once the run is over (the last top-level stage). */
  openWhenFinished?: boolean;
}

export function ControlFlowNode(props: ControlFlowNodeProps) {
  const { stage, renderStage, showConnector, runId, onCommand } = props;
  const decisions = useRunDecisions();
  if (stage.loop) return <LoopTimelineItem {...props} />;
  if (stage.map) return <MapTimelineItem {...props} />;
  if (stage.expansion) return <ExpansionTimelineItem {...props} />;
  if (stage.wait) {
    const commandTo = decisions?.commandTo ?? ((_runId: string, c: RunCommand) => onCommand(c));
    return (
      <>
        {renderStage(stage, {
          showConnector,
          headerExtra: <WaitBadge wait={stage.wait} />,
          body: <WaitCard stage={stage} runId={runId} onCommand={commandTo} />,
        })}
      </>
    );
  }
  if (stage.subworkflow) return <>{renderStage(stage, { showConnector, body: <SubworkflowCard stage={stage} /> })}</>;
  if (props.inContainer) return <LoopBodyStage {...props} />;
  return <>{renderStage(stage, { showConnector, ...(props.openWhenFinished !== undefined ? { openWhenFinished: props.openWhenFinished } : {}) })}</>;
}
