import React from 'react';
import { Alert, View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import { GraphCanvas } from './GraphCanvas';
import type { GraphNode } from './GraphCanvas.types';
import { layoutGraph } from './graphLayout';

const NODES = [
  { key: 'scan', label: 'Scan dependencies' },
  { key: 'assess_risk', label: 'Assess risk' },
  { key: 'apply_upgrades', label: 'Apply upgrades' },
  { key: 'run_tests', label: 'Run test suite' },
  { key: 'open_pr', label: 'Open PR' },
  { key: 'notify_owner', label: 'Notify owner' },
];
const EDGES = [
  { from: 'scan', to: 'assess_risk' },
  { from: 'assess_risk', to: 'apply_upgrades', label: "when max_risk == 'high'" },
  { from: 'apply_upgrades', to: 'run_tests', emphasis: true },
  { from: 'run_tests', to: 'open_pr' },
  { from: 'run_tests', to: 'notify_owner', dashed: true, label: 'on failure' },
];
const LAYOUT = layoutGraph(NODES, EDGES);

function Node({ node }: { node: GraphNode }): React.ReactElement {
  return (
    <Pressable onPress={() => Alert.alert(node.label)} frame="none" accessibilityRole="button" accessibilityLabel={node.label} className="flex-1 justify-center rounded-control border border-line bg-raised px-3">
      <Text role="subhead" weight={600} numberOfLines={1}>
        {node.label}
      </Text>
      <Text role="monoSm" tone="fg-3" numberOfLines={1}>
        {node.key}
      </Text>
    </Pressable>
  );
}

function GraphCanvasGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Mini (one button, the summary is its name)">
        <GraphCanvas variant="mini" layout={LAYOUT} renderNode={(n) => <Node node={n} />} summary="6 stages, 1 branch" caption="Published v7 · read-only" onPress={() => Alert.alert('Open full graph')} />
      </StorySection>
      <StorySection title="Canvas: pinch, pan, double-tap; + − Fit List">
        <View className="h-96 overflow-hidden rounded-card">
          <GraphCanvas variant="canvas" layout={LAYOUT} renderNode={(n) => <Node node={n} />} summary="6 stages" onList={() => Alert.alert('List')} />
        </View>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <GraphCanvas variant="mini" layout={LAYOUT} renderNode={(n) => <Node node={n} />} summary="6 stages" onPress={() => undefined} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'Layout/GraphCanvas', component: GraphCanvasGallery } satisfies Meta<typeof GraphCanvasGallery>;
export default meta;
export const Graph: StoryObj<typeof meta> = {};
