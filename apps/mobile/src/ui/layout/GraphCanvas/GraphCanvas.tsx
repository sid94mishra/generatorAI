// ML-31 GraphCanvas (03 MB-35 canvas part; MD-04, MD-25, MD-28): the read-only node graph under RunGraph. Nodes are
// views the caller renders at laid-out positions; edges are SVG curves in `line-strong` (dashed for failure paths,
// 2 pt when traversed — never a status colour, MD-25) with their labels in `fg-3`. `canvas`: one transform layer
// driven by pinch, pan and double-tap (zoom in; past 2× zooms back out), and a bottom zoom bar − n% + | Fit List
// (iOS glass, Android a raised pill). The SVG layer is hidden from assistive tech; each node stays an element in reading order, and
// "List" leads to the equivalent list. `mini`: a static, scaled preview inside one button named by the summary.
import React, { useCallback, useEffect, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

import { useThemeColors } from '../../lib/themeColors';
import { nativePlatform } from '../../platform/geometry';
import { useReduceMotion } from '../../platform/motion';
import { GlassSurface } from '../../native/GlassSurface';
import { Icon } from '../../primitives/Icon';
import { IconButton } from '../../primitives/IconButton';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { GraphCanvasProps, GraphLayout } from './GraphCanvas.types';
import { GRAPH_ZOOM, clampZoom, fitTransform } from './graphLayout';

export type { GraphCanvasProps } from './GraphCanvas.types';

const MINI_HEIGHT = 168;

function Edges({ layout }: { layout: GraphLayout }): React.ReactElement {
  const colors = useThemeColors();
  return (
    <View className="absolute start-0 top-0" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={layout.width} height={layout.height}>
      {layout.edges.map((e) => (
        <Path key={e.id} d={e.path} stroke={colors.lineStrong} strokeWidth={e.emphasis ? 2 : 1.25} strokeDasharray={e.dashed ? '5 4' : undefined} fill="none" />
      ))}
      {layout.edges
        .filter((e) => e.label)
        .map((e) => (
          <SvgText key={`${e.id}-label`} x={e.mid.x} y={e.mid.y - 4} fill={colors.fg3} fontSize={11} textAnchor="middle">
            {e.label}
          </SvgText>
        ))}
    </Svg>
    </View>
  );
}

function Nodes({ layout, renderNode }: Pick<GraphCanvasProps, 'layout' | 'renderNode'>): React.ReactElement {
  return (
    <>
      {layout.nodes.map((n) => (
        <View key={n.key} className="absolute" style={{ left: n.x, top: n.y, width: n.width, height: n.height }}>
          {renderNode(n)}
        </View>
      ))}
    </>
  );
}

function Mini({ layout, renderNode, summary, onPress, caption, testID }: GraphCanvasProps): React.ReactElement {
  const [width, setWidth] = useState(0);
  const fit = fitTransform(layout, { width, height: MINI_HEIGHT }, 1);
  return (
    <Pressable onPress={onPress} frame="none" feedback="scale" large accessibilityRole="button" accessibilityLabel={summary} accessibilityHint="Opens the full graph" className="overflow-hidden rounded-card border border-line-soft bg-sunken" testID={testID}>
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height: MINI_HEIGHT }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {width > 0 ? (
          <View className="absolute" style={{ left: fit.x, top: fit.y, width: layout.width, height: layout.height, transform: [{ translateX: (-layout.width * (1 - fit.scale)) / 2 }, { translateY: (-layout.height * (1 - fit.scale)) / 2 }, { scale: fit.scale }] }}>
            <Edges layout={layout} />
            <Nodes layout={layout} renderNode={renderNode} />
          </View>
        ) : null}
      </View>
      <View className="absolute end-2 start-2 top-2 flex-row items-center justify-between" pointerEvents="none">
        {caption ? (
          <Text role="caption" tone="fg-3">
            {caption}
          </Text>
        ) : (
          <View />
        )}
        <Text role="caption" tone="fg-3">
          Tap for full screen
        </Text>
      </View>
    </Pressable>
  );
}

function Canvas({ layout, renderNode, onList, summary, testID }: GraphCanvasProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [percent, setPercent] = useState(100);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  useAnimatedReaction(
    () => Math.round(scale.get() * 100),
    (now, before) => {
      if (now !== before) scheduleOnRN(setPercent, now);
    },
  );

  const apply = useCallback(
    (next: { scale: number; x: number; y: number }) => {
      const to = (v: number): number => (reduceMotion ? v : withTiming(v, { duration: 200 }));
      scale.set(to(next.scale));
      tx.set(to(next.x));
      ty.set(to(next.y));
    },
    [reduceMotion, scale, tx, ty],
  );
  const fit = useCallback(() => apply(fitTransform(layout, box)), [apply, layout, box]);
  useEffect(() => {
    if (box.width > 0) fit();
    // Fit once per size / layout change; a pan or zoom afterwards is the reader's.
  }, [box.width, box.height, layout.width, layout.height]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Zoom by a factor around the box centre. */
  const zoomBy = (factor: number): void => {
    const current = scale.get();
    const next = clampZoom(current * factor);
    const k = next / current;
    const cx = box.width / 2;
    const cy = box.height / 2;
    apply({ scale: next, x: cx - (cx - tx.get()) * k, y: cy - (cy - ty.get()) * k });
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.set(scale.get());
      startX.set(tx.get());
      startY.set(ty.get());
    })
    .onUpdate((e) => {
      const next = clampZoom(startScale.get() * e.scale);
      const k = next / startScale.get();
      scale.set(next);
      tx.set(e.focalX - (e.focalX - startX.get()) * k);
      ty.set(e.focalY - (e.focalY - startY.get()) * k);
    });
  const pan = Gesture.Pan()
    .minDistance(4)
    .averageTouches(true)
    .onStart(() => {
      startX.set(tx.get());
      startY.set(ty.get());
    })
    .onUpdate((e) => {
      tx.set(startX.get() + e.translationX);
      ty.set(startY.get() + e.translationY);
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      const current = scale.get();
      const next = current >= 2 ? clampZoom(current / (GRAPH_ZOOM.step * GRAPH_ZOOM.step)) : clampZoom(current * GRAPH_ZOOM.step * GRAPH_ZOOM.step);
      const k = next / current;
      scale.set(withTiming(next, { duration: 200 }));
      tx.set(withTiming(e.x - (e.x - tx.get()) * k, { duration: 200 }));
      ty.set(withTiming(e.y - (e.y - ty.get()) * k, { duration: 200 }));
    });
  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  // The layer scales about its top-left corner, then translates.
  const layerStyle = useAnimatedStyle(() => {
    const k = scale.get();
    return { transform: [{ translateX: tx.get() - (layout.width * (1 - k)) / 2 }, { translateY: ty.get() - (layout.height * (1 - k)) / 2 }, { scale: k }] };
  });

  const ios = nativePlatform === 'ios';
  const bar = (
    <View className="flex-row items-center gap-1 px-1">
      <IconButton icon="zoom-out" label="Zoom out" onPress={() => zoomBy(1 / GRAPH_ZOOM.step)} testID="graph-zoom-out" />
      <Text role="monoSm" tone="fg-2" accessibilityLabel={`Zoom ${percent} percent`}>
        {`${percent}%`}
      </Text>
      <IconButton icon="zoom-in" label="Zoom in" onPress={() => zoomBy(GRAPH_ZOOM.step)} testID="graph-zoom-in" />
      <View className="h-6 w-px bg-line" />
      <IconButton icon="maximize" label="Fit to screen" onPress={fit} testID="graph-fit" />
      {onList ? <IconButton icon="list" label="Show as a list" onPress={onList} testID="graph-list" /> : null}
    </View>
  );

  return (
    <View className="flex-1 overflow-hidden bg-sunken" testID={testID}>
      <GestureDetector gesture={gesture}>
        <View className="flex-1" onLayout={(e: LayoutChangeEvent) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} accessibilityLabel={summary}>
          <Animated.View className="absolute start-0 top-0" style={[{ width: layout.width, height: layout.height }, layerStyle]}>
            <Edges layout={layout} />
            <Nodes layout={layout} renderNode={renderNode} />
          </Animated.View>
        </View>
      </GestureDetector>
      <View className="absolute bottom-4 end-0 start-0 items-center gap-2" pointerEvents="box-none">
        <View className="flex-row items-center gap-1" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon concept="pointer" size={12} tone="fg-3" />
          <Text role="caption" tone="fg-3">
            Pinch to zoom · drag to pan
          </Text>
        </View>
        {ios ? (
          <GlassSurface radiusStep="full" interactive>
            {bar}
          </GlassSurface>
        ) : (
          <View className="rounded-full border border-line-soft bg-raised">{bar}</View>
        )}
      </View>
    </View>
  );
}

export function GraphCanvas(props: GraphCanvasProps): React.ReactElement {
  return props.variant === 'mini' ? <Mini {...props} /> : <Canvas {...props} />;
}
