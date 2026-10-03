// MB-35 RunGraph (03 MB-35; MD-04, MD-25, MD-28; MRunGraph, MWorkflowDetail, MBuilderGraph): a workflow graph on
// GraphCanvas, read-only. Nodes: the status glyph + name (600), the agent or model, the mono key and the status
// word or duration; a loop / map shows its body count; a stage that parks for a person carries the hand glyph.
// Without statuses (a definition) the glyph is the stage kind. `mini` is one button with the summary.
import React from 'react';
import { View } from 'react-native';
import { STATUS_STATE_DEFS } from '@generatorai/shared';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { WorkflowGraph } from '@generatorai/workflow-spec';

import { GraphCanvas, type GraphNode } from '../../ui/layout/GraphCanvas';
import { cn } from '../../ui/lib/cn';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { Text } from '../../ui/primitives/Text';
import { runGraphView, type StageNodeStatus, type StageNodeView } from './model/runGraphModel';

const KIND_ICON: Record<StageNodeView['kind'], MobileIconConcept> = {
  agent: 'agents',
  check: 'check',
  loop: 'repeat',
  map: 'layers',
  subworkflow: 'workflows',
  wait: 'hourglass',
};

export interface RunGraphProps {
  graph: Pick<WorkflowGraph, 'stages' | 'edges'>;
  /** By stage key; a run's statuses (absent on a definition). */
  statuses?: ReadonlyMap<string, StageNodeStatus>;
  variant: 'mini' | 'canvas';
  /** mini: opens the full graph. */
  onPress?: () => void;
  /** canvas: a node tap (the stage key). */
  onNodePress?: (key: string) => void;
  onList?: () => void;
  caption?: string;
  /** The highlighted node (the stage that needs you). */
  focusKey?: string;
  testID?: string;
}

function StageNode({ view, interactive, focused, onPress, node }: { view: StageNodeView; interactive: boolean; focused: boolean; onPress?: (key: string) => void; node: GraphNode }): React.ReactElement {
  const def = view.status ? STATUS_STATE_DEFS[view.status.state] : null;
  const body = (
    <>
      <View className="flex-row items-center gap-1.5">
        {def ? <Icon concept={def.glyph as MobileIconConcept} size={14} tone={def.tone} /> : <Icon concept={KIND_ICON[view.kind]} size={14} tone="fg-3" />}
        <Text role="subhead" weight={600} numberOfLines={1} className="shrink">
          {view.name}
        </Text>
        {view.approval ? <Icon concept="hand" size={12} tone="fg-3" /> : null}
      </View>
      {view.who || view.children ? (
        <Text role="caption" tone="fg-3" numberOfLines={1}>
          {view.children ? `${view.kind === 'map' ? 'Map' : 'Loop'} · ${view.children} stage${view.children === 1 ? '' : 's'}` : view.who}
        </Text>
      ) : null}
      <View className="flex-row items-center justify-between gap-2">
        <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
          {view.key}
        </Text>
        {view.status ? (
          <Text role="monoSm" tone={view.status.state === 'needs_you' ? 'warn' : 'fg-3'} numberOfLines={1}>
            {view.status.detail ?? view.status.label}
          </Text>
        ) : null}
      </View>
    </>
  );
  const frame = cn('flex-1 justify-center gap-0.5 rounded-control border bg-raised px-3', focused ? 'border-warn' : 'border-line');
  if (!interactive) return <View className={frame}>{body}</View>;
  return (
    <Pressable onPress={() => onPress?.(view.key)} frame="none" accessibilityRole="button" accessibilityLabel={node.label} accessibilityHint="Opens the stage" className={frame} testID={`graph-node-${view.key}`}>
      {body}
    </Pressable>
  );
}

export function RunGraph({ graph, statuses, variant, onPress, onNodePress, onList, caption, focusKey, testID }: RunGraphProps): React.ReactElement {
  const view = runGraphView(graph, statuses);
  return (
    <GraphCanvas
      variant={variant}
      layout={view.layout}
      summary={view.summary}
      {...(caption ? { caption } : {})}
      {...(onPress ? { onPress } : {})}
      {...(onNodePress ? { onNodePress } : {})}
      {...(onList ? { onList } : {})}
      renderNode={(node) => <StageNode view={view.nodes.get(node.key)!} node={node} interactive={variant === 'canvas' && Boolean(onNodePress)} focused={node.key === focusKey} {...(onNodePress ? { onPress: onNodePress } : {})} />}
      {...(testID ? { testID } : {})}
    />
  );
}
