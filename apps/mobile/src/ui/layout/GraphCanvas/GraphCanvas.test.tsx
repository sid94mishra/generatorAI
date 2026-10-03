// ML-31 GraphCanvas: layered layout, the mini button's name, the canvas controls.
import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';

import { renderThemed } from '../../__tests__/themed';
import { Text } from '../../primitives/Text';
import { GraphCanvas } from './GraphCanvas';
import { GRAPH_NODE, fitTransform, layoutGraph } from './graphLayout';

const NODES = [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
  { key: 'c', label: 'C' },
  { key: 'd', label: 'D' },
];

describe('layoutGraph', () => {
  it('puts each node one layer after its deepest predecessor', () => {
    const layout = layoutGraph(NODES, [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'd' },
    ]);
    const y = Object.fromEntries(layout.nodes.map((n) => [n.key, n.y]));
    expect(y.a).toBeLessThan(y.b!);
    expect(y.b).toBe(y.c);
    expect(y.d).toBeGreaterThan(y.b!);
    expect(layout.edges).toHaveLength(4);
    expect(layout.height).toBe(GRAPH_NODE.pad * 2 + 3 * GRAPH_NODE.height + 2 * GRAPH_NODE.gapY);
    expect(layout.width).toBe(GRAPH_NODE.pad * 2 + 2 * GRAPH_NODE.width + GRAPH_NODE.gapX);
  });

  it('survives a cycle and drops edges to unknown nodes', () => {
    const layout = layoutGraph(NODES.slice(0, 2), [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
      { from: 'a', to: 'zz' },
    ]);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(2);
  });

  it('fits a layout into a box without upscaling past the cap', () => {
    expect(fitTransform({ width: 200, height: 100 }, { width: 100, height: 100 }).scale).toBe(0.5);
    expect(fitTransform({ width: 10, height: 10 }, { width: 100, height: 100 }, 1.25).scale).toBe(1.25);
  });
});

describe('GraphCanvas (ML-31)', () => {
  const layout = layoutGraph(NODES.slice(0, 2), [{ from: 'a', to: 'b', label: 'on failure', dashed: true }]);

  it('mini: one button named by the summary', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<GraphCanvas variant="mini" layout={layout} renderNode={(n) => <Text>{n.label}</Text>} summary="2 stages" onPress={onPress} />);
    await user.press(screen.getByRole('button', { name: '2 stages' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('canvas: zoom controls and the List alternative', async () => {
    const onList = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<GraphCanvas variant="canvas" layout={layout} renderNode={(n) => <Text>{n.label}</Text>} summary="2 stages" onList={onList} />);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fit to screen' })).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Show as a list' }));
    expect(onList).toHaveBeenCalled();
  });
});
