// ────────────────────────────────────────────────────────────────
// GroupNode — a container stage (loop §2.1, map §4.1) on the builder canvas
// (React Flow node type `loopNode`; board WorkflowLoopBuilder, P05).
//
// Wraps the WF-15 CanvasGroupNode frame for React Flow: the handles outer
// stages connect to, the store's data (name, key, max iterations or the
// map's list, exit rules, budget), the issue markers and the "…" menu (add a
// stage to the body, duplicate, wrap, unwrap, delete). The body stages are
// child nodes React Flow draws over the frame; the frame is auto-sized
// around them by the store (containerLayout), whose header band is
// GROUP_HEADER tall and whose bottom padding is GROUP_PAD — the frame's
// header row and footer line fit inside those. A loop draws its "next
// iteration" arc in the gap between its header row and its body.
// ────────────────────────────────────────────────────────────────

import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { mapMergeMode, type MapMergeMode, type StageKind } from '@generatorai/workflow-spec';
import { CanvasGroupNode, GROUP_NODE_HEADER_HEIGHT } from '@/blocks/workflow/CanvasGroupNode/CanvasGroupNode.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';
import { useWorkflowBuilderStore, type StageNodeData } from '@/stores/workflowBuilderStore.js';
import { GROUP_HEADER, nodeSize } from '@/stores/workflowContainerLayout.js';
import { ADDABLE_KINDS, KIND_META } from '../model/kindMeta.js';
import { wrapStages } from './canvasActions.js';
import { useCanvasContext } from './canvasContext.js';
import { HANDLE_SIZE, XY_INTERACTIVE } from './canvasTheme.js';
import { NodeMarkers, useStageIssues } from './NodeMarkers.js';

/** How a map's item mounts come back, as its footer says it. */
const MERGE_TEXT: Record<MapMergeMode, string> = {
  none: '',
  sequential: ' · merge',
  pr_per_item: ' · PR per item',
  winner: ' · merge the winner',
};

/** Short label of an exit action. */
const ACTION_LABELS: Record<string, string> = {
  complete: 'until',
  fail: 'fail when',
  pause: 'pause when',
  exhaust: 'stall',
};

/** Exit rules shown in the footer before "+N". */
const MAX_FOOTER_RULES = 3;

/** Outer handles sit at the middle of the header row. */
const GROUP_HANDLE_STYLE: CSSProperties = { top: GROUP_NODE_HEADER_HEIGHT / 2, width: HANDLE_SIZE, height: HANDLE_SIZE };

/** Gap between the frame's header row and the body stages (the arc's room). */
const ARC_ROOM = GROUP_HEADER - GROUP_NODE_HEADER_HEIGHT;
/** Height of the arc's horizontal run inside that gap. */
const ARC_Y = ARC_ROOM / 2 - 2;
const ARC_CORNER = 4;

/**
 * Body stage count and the x of the arc's two ends (the first and last body
 * stage's centres, in the container's frame).
 */
function bodyGeometry(nodes: readonly Node<StageNodeData>[], id: string): [number, number, number] {
  const body = nodes.filter((n) => n.parentId === id);
  if (body.length === 0) return [0, 0, 0];
  const first = body.reduce((a, b) => (b.position.x < a.position.x ? b : a));
  const last = body.reduce((a, b) => (b.position.x + nodeSize(b).width > a.position.x + nodeSize(a).width ? b : a));
  if (first === last) {
    const w = nodeSize(first).width;
    return [1, first.position.x + w * 0.3, first.position.x + w * 0.7];
  }
  return [body.length, first.position.x + nodeSize(first).width / 2, last.position.x + nodeSize(last).width / 2];
}

/** The loop's "next iteration" arc: from the last body stage back to the first. */
function NextIterationArc({ from, to }: { from: number; to: number }) {
  const d =
    `M ${to} ${ARC_ROOM} V ${ARC_Y + ARC_CORNER} Q ${to} ${ARC_Y} ${to - ARC_CORNER} ${ARC_Y} ` +
    `H ${from + ARC_CORNER} Q ${from} ${ARC_Y} ${from} ${ARC_Y + ARC_CORNER} V ${ARC_ROOM}`;
  const arrow = `M ${from - ARC_CORNER} ${ARC_ROOM - 5} L ${from} ${ARC_ROOM} L ${from + ARC_CORNER} ${ARC_ROOM - 5}`;
  const labelStyle: CSSProperties = { left: (from + to) / 2, top: ARC_Y };
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width={to + ARC_CORNER} height={ARC_ROOM}>
        <path d={d} fill="none" stroke="var(--gai-fg-3)" strokeWidth={1.25} strokeDasharray="2 3" />
        <path d={arrow} fill="none" stroke="var(--gai-fg-3)" strokeWidth={1.25} />
      </svg>
      <span
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-badge bg-sunken px-1.5 text-micro whitespace-nowrap text-fg-3"
        style={labelStyle}
      >
        next iteration
      </span>
    </>
  );
}

function Sep() {
  return <span aria-hidden>·</span>;
}

function budgetText(budget: { maxTurns?: number | undefined; maxCostUsd?: number | undefined } | undefined): string | null {
  const parts = [budget?.maxTurns ? `${budget.maxTurns} turns` : null, budget?.maxCostUsd ? `$${budget.maxCostUsd}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function GroupNodeComponent({ id, data, selected }: NodeProps<Node<StageNodeData>>) {
  const { stage, label } = data;
  const selectNode = useWorkflowBuilderStore((s) => s.selectNode);
  const addStage = useWorkflowBuilderStore((s) => s.addStage);
  const duplicateStage = useWorkflowBuilderStore((s) => s.duplicateStage);
  const unwrapContainer = useWorkflowBuilderStore((s) => s.unwrapContainer);
  const removeStage = useWorkflowBuilderStore((s) => s.removeStage);
  const [bodyCount, arcFrom, arcTo] = useWorkflowBuilderStore(useShallow((s) => bodyGeometry(s.nodes, id)));
  const { nodeTags } = useCanvasContext();
  const issues = useStageIssues(id);

  const loop = stage.kind === 'loop' ? stage.loop : undefined;
  const map = stage.kind === 'map' ? stage.map : undefined;
  const noun = map ? 'map' : 'loop';
  const budget = stage.kind === 'loop' || stage.kind === 'map' ? budgetText(stage.budget) : null;

  const addInside = (kind: StageKind) => selectNode(addStage(undefined, { kind, parentKey: id }));

  const items: MenuButtonItem[] = [
    { type: 'label', id: 'add', label: `Add to the ${noun} body` },
    ...ADDABLE_KINDS.map((kind) => ({
      id: `add-${kind}`,
      label: kind === 'loop' || kind === 'map' ? `Nested ${kind}` : KIND_META[kind].name,
      icon: KIND_META[kind].icon,
      onSelect: () => addInside(kind),
    })),
    { type: 'separator' },
    { id: 'duplicate', label: `Duplicate ${noun}`, icon: 'copy', onSelect: () => duplicateStage(id) },
    { id: 'wrap-loop', label: 'Wrap in loop', icon: 'repeat', onSelect: () => wrapStages([id], 'loop') },
    { id: 'wrap-map', label: 'Wrap in map', icon: 'layers', onSelect: () => wrapStages([id], 'map') },
    { id: 'unwrap', label: `Unwrap ${noun}`, icon: 'ungroup', onSelect: () => unwrapContainer(id) },
    { type: 'separator' },
    { id: 'delete', label: `Delete ${noun}`, icon: 'trash', danger: true, onSelect: () => removeStage(id) },
  ];

  const exits = loop?.exits ?? [];
  const footer = (
    <>
      {map ? (
        <>
          <Tooltip content={`For each item of: ${map.items}`}>
            <span className="flex min-w-0 items-center gap-1">
              for each in <span className="max-w-48 truncate font-mono text-fg-2">{map.items}</span>
            </span>
          </Tooltip>
          <Sep />
          <span>{map.concurrency} at once</span>
          {map.workspace === 'mount_per_item' ? (
            <>
              <Sep />
              <span>mount per item{MERGE_TEXT[mapMergeMode(map.merge)]}</span>
            </>
          ) : null}
          {map.toleratedFailurePercent > 0 ? (
            <>
              <Sep />
              <span>tolerates {map.toleratedFailurePercent}% failed</span>
            </>
          ) : null}
        </>
      ) : exits.length === 0 ? (
        <span>no exit rule · runs {loop?.maxIterations ?? '?'} times</span>
      ) : (
        exits.slice(0, MAX_FOOTER_RULES).map((rule, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <Sep /> : null}
            <Tooltip content={`${rule.when}${rule.consecutive > 1 ? ` (${rule.consecutive}× in a row)` : ''} → ${rule.reason}`}>
              <span className="flex min-w-0 items-center gap-1">
                {ACTION_LABELS[rule.action] ?? rule.action}
                <span className="max-w-40 truncate font-mono text-fg-2">{rule.action === 'exhaust' ? rule.reason : rule.when}</span>
                {rule.consecutive > 1 ? <span>×{rule.consecutive}</span> : null}
              </span>
            </Tooltip>
          </span>
        ))
      )}
      {exits.length > MAX_FOOTER_RULES ? <span>+{exits.length - MAX_FOOTER_RULES}</span> : null}
      {bodyCount === 0 ? (
        <>
          <Sep />
          <span className="text-err">empty body</span>
        </>
      ) : null}
      {budget ? <span className="ml-auto shrink-0 font-mono">{budget}</span> : null}
    </>
  );

  return (
    <CanvasGroupNode
      kind={map ? 'map' : 'loop'}
      name={label}
      stageKey={stage.key}
      badge={map ? 'Map' : 'Loop · max'}
      badgeValue={map ? `×${map.concurrency} · ≤${map.maxItems}` : String(loop?.maxIterations ?? '?')}
      selected={selected}
      invalid={issues.errors.length > 0}
      headerExtras={<NodeMarkers issues={issues} tag={nodeTags[id]} />}
      actions={<MenuButton iconOnly label="Stage actions" items={items} size="sm" variant="ghost" className={XY_INTERACTIVE} />}
      footer={footer}
      onClick={() => selectNode(id)}
      frameOverlay={
        <>
          <Handle type="target" position={Position.Left} style={GROUP_HANDLE_STYLE} />
          <Handle type="source" position={Position.Right} style={GROUP_HANDLE_STYLE} />
        </>
      }
    >
      {loop && bodyCount > 0 ? <NextIterationArc from={arcFrom} to={arcTo} /> : null}
    </CanvasGroupNode>
  );
}

export const GroupNode = memo(GroupNodeComponent);
