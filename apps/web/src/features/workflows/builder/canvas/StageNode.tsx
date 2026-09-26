// ────────────────────────────────────────────────────────────────
// StageNode — a non-container stage on the builder canvas (React Flow node
// type `stageNode`; board WorkflowBuilder).
//
// 232 wide, raised card. Header 44h: kind glyph, name over the mono key,
// markers (draft tag, error/warning counts), the "…" menu (Duplicate, Wrap
// in loop / map, Delete). Body: who runs it (agent, check, wait target,
// child workflow) and on what (mono model / command), the description, and
// the pill row (stageSummary). Selected: fg border + ring; an error on the
// stage: err border, and the pill of the failing field in err.
// ────────────────────────────────────────────────────────────────

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';
import { useWorkflowBuilderStore, type StageNodeData } from '@/stores/workflowBuilderStore.js';
import { KIND_META } from '../model/kindMeta.js';
import { wrapStages } from './canvasActions.js';
import { useCanvasContext } from './canvasContext.js';
import { STAGE_HANDLE_STYLE, XY_INTERACTIVE } from './canvasTheme.js';
import { NodeMarkers, useStageIssues } from './NodeMarkers.js';
import { stageLines, stagePills, type StagePill } from './stageSummary.js';

function pillHasError(pill: StagePill, errorFields: readonly string[]): boolean {
  const field = pill.field;
  if (field === undefined) return false;
  return errorFields.some((f) => f === field || f.startsWith(`${field}/`));
}

function StageNodeComponent({ id, data, selected }: NodeProps<Node<StageNodeData>>) {
  const { stage, label } = data;
  const selectNode = useWorkflowBuilderStore((s) => s.selectNode);
  const removeStage = useWorkflowBuilderStore((s) => s.removeStage);
  const duplicateStage = useWorkflowBuilderStore((s) => s.duplicateStage);
  const { nodeTags, agentNames } = useCanvasContext();
  const issues = useStageIssues(id);
  const invalid = issues.errors.length > 0;

  const lines = stageLines(stage, (ref) => agentNames.get(ref));
  const pills = stagePills(stage, stage.parentKey !== undefined);

  const items: MenuButtonItem[] = [
    { id: 'duplicate', label: 'Duplicate stage', icon: 'copy', onSelect: () => duplicateStage(id) },
    { id: 'wrap-loop', label: 'Wrap in loop', icon: 'repeat', onSelect: () => wrapStages([id], 'loop') },
    { id: 'wrap-map', label: 'Wrap in map', icon: 'layers', onSelect: () => wrapStages([id], 'map') },
    { type: 'separator' },
    { id: 'delete', label: 'Delete stage', icon: 'trash', danger: true, onSelect: () => removeStage(id) },
  ];

  return (
    <div
      role="group"
      aria-label={`Stage: ${label}`}
      // React Flow selects on click too, but not a node it already holds as
      // selected while the store moved on (an edge label was clicked).
      onClick={() => selectNode(id)}
      className={cn(
        'w-58 rounded-card border bg-raised text-ui text-fg transition-control',
        selected ? 'border-fg ring-3 ring-selected' : invalid ? 'border-err' : 'border-line hover:border-line-strong',
      )}
    >
      <Handle type="target" position={Position.Left} style={STAGE_HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={STAGE_HANDLE_STYLE} />

      <div className="flex h-bar items-center gap-2 border-b border-line-soft pr-1 pl-3">
        <Icon concept={KIND_META[stage.kind].icon} size={14} className="text-fg-3" />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-semibold">{label}</span>
          <span className="truncate font-mono text-micro text-fg-3">{stage.key}</span>
        </div>
        <NodeMarkers issues={issues} tag={nodeTags[id]} />
        <MenuButton iconOnly label="Stage actions" items={items} size="sm" variant="ghost" className={XY_INTERACTIVE} />
      </div>

      <div className="flex flex-col gap-1.5 px-3 pt-2 pb-2.5">
        <div className={cn('flex min-w-0 items-center gap-1.5 text-small', lines.lead.muted ? 'text-fg-3' : 'text-fg-2')}>
          <Icon concept={lines.lead.icon} size={12} className="text-fg-3" />
          <span className="truncate">{lines.lead.text}</span>
        </div>
        {lines.detail ? <div className="truncate font-mono text-micro text-fg-3">{lines.detail}</div> : null}
        {stage.description ? <p className="truncate text-small text-fg-3">{stage.description}</p> : null}
        {pills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {pills.map((pill) => {
              const err = pillHasError(pill, issues.errorFields);
              return (
                <Tooltip key={pill.id} content={pill.tooltip}>
                  <Chip
                    size="sm"
                    mono={pill.mono ?? false}
                    {...(pill.icon ? { icon: pill.icon } : {})}
                    className={cn(err ? 'border-err text-err' : pill.tone === 'warn' ? 'text-warn' : undefined)}
                  >
                    {pill.label}
                  </Chip>
                </Tooltip>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const StageNode = memo(StageNodeComponent);
