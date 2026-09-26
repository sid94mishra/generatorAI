// ────────────────────────────────────────────────────────────────
// ControlFlowNode — one instance of the run's stage table, by kind (P05):
// a loop (LoopRow), a map (MapRow), a planner's expansion (ExpansionRow,
// P08), a wait (its card), a sub-workflow (its child run and mirrored
// decisions), or a plain stage (inside a container: with its loop turns
// above the transcript). The top level and every container body render
// through here, so any nesting of loops and maps works; body rows render
// one `depth` deeper so the page's StageRow indents them.
// ────────────────────────────────────────────────────────────────

import type { RunCommand } from '@generatorai/workflow-spec';
import { LoopBodyStage, LoopRow } from './LoopRow.js';
import { MapRow } from './MapRow.js';
import { ExpansionRow } from './ExpansionRow.js';
import { SubworkflowCard, WaitBadge, WaitCard, useRunDecisions } from './ControlFlowCards.js';
import type { RenderStage } from '../model/renderStage.js';
import type { StageView } from '../model/types.js';

export interface ControlFlowNodeProps {
  runId: string;
  stage: StageView;
  bodies: Record<string, StageView[]>;
  focusedId: string | null;
  /** False for the last row of a list. */
  showConnector: boolean;
  renderStage: RenderStage;
  /** A run command on this run; resolves once it settled. */
  onCommand: (command: RunCommand) => Promise<void>;
  /** A body instance of a loop or a map (its loop turns show above its transcript). */
  inContainer?: boolean;
  /** Open the row once the run is over (the last top-level stage). */
  openWhenFinished?: boolean;
  /** Nesting depth (0 = top level); container bodies render at depth + 1. */
  depth?: number;
}

export function ControlFlowNode(props: ControlFlowNodeProps) {
  const { stage, renderStage, showConnector, runId, onCommand, depth = 0 } = props;
  const decisions = useRunDecisions();
  if (stage.loop) return <LoopRow {...props} />;
  if (stage.map) return <MapRow {...props} />;
  if (stage.expansion) return <ExpansionRow {...props} />;
  if (stage.wait) {
    const commandTo = decisions?.commandTo ?? ((_runId: string, c: RunCommand) => onCommand(c));
    return (
      <>
        {renderStage(stage, {
          showConnector,
          depth,
          headerExtra: <WaitBadge wait={stage.wait} />,
          body: <WaitCard stage={stage} runId={runId} onCommand={commandTo} />,
        })}
      </>
    );
  }
  if (stage.subworkflow) return <>{renderStage(stage, { showConnector, depth, body: <SubworkflowCard stage={stage} /> })}</>;
  if (props.inContainer) return <LoopBodyStage stage={stage} showConnector={showConnector} renderStage={renderStage} depth={depth} />;
  return (
    <>
      {renderStage(stage, {
        showConnector,
        depth,
        ...(props.openWhenFinished !== undefined ? { openWhenFinished: props.openWhenFinished } : {}),
      })}
    </>
  );
}

/** A container's body instances, one depth deeper (shared by the loop, map and expansion rows). */
export function BodyRows({
  list,
  parent,
}: {
  list: StageView[];
  parent: Pick<ControlFlowNodeProps, 'runId' | 'bodies' | 'focusedId' | 'renderStage' | 'onCommand' | 'depth'>;
}) {
  const depth = (parent.depth ?? 0) + 1;
  return (
    <>
      {list.map((s, i) => (
        <ControlFlowNode
          key={s.id}
          runId={parent.runId}
          stage={s}
          bodies={parent.bodies}
          focusedId={parent.focusedId}
          showConnector={i < list.length - 1}
          renderStage={parent.renderStage}
          onCommand={parent.onCommand}
          depth={depth}
          inContainer
        />
      ))}
    </>
  );
}
