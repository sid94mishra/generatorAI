// MP-31 Skeleton (03 MP-31): static placeholders in bg-selected (never shimmer); one busy "Loading" element.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import type { SkeletonProps } from './Skeleton.types';

export type { SkeletonProps } from './Skeleton.types';

function Bar({ width = '60%', height = 10 }: { width?: `${number}%` | number; height?: number }): React.ReactElement {
  return <View className="rounded-full bg-selected" style={{ width, height }} />;
}

function Circle(): React.ReactElement {
  return <View className="size-5 rounded-full bg-selected android:size-6" />;
}

function Row({ two = false }: { two?: boolean }): React.ReactElement {
  return (
    <View className={cn('flex-row items-center gap-3 px-gutter', two ? 'min-h-row-2' : 'min-h-row')}>
      <Circle />
      <View className="flex-1 gap-2">
        <Bar width="60%" />
        {two ? <Bar width="38%" height={8} /> : null}
      </View>
    </View>
  );
}

function Shape({ shape = 'bar', width, height }: Pick<SkeletonProps, 'shape' | 'width' | 'height'>): React.ReactElement {
  if (shape === 'circle') return <Circle />;
  if (shape === 'block') return <View className="rounded-card bg-selected" style={{ width: width ?? '100%', height: height ?? 64 }} />;
  return <Bar width={width} height={height} />;
}

function Preset({ preset, count = 3 }: { preset: NonNullable<SkeletonProps['preset']>; count?: number }): React.ReactElement {
  switch (preset) {
    case 'row':
      return <Row />;
    case 'row-2':
      return <Row two />;
    case 'list':
      return (
        <View>
          {Array.from({ length: count }, (_, i) => (
            <Row key={i} two />
          ))}
        </View>
      );
    case 'card':
      return (
        <View className="gap-3 rounded-card bg-raised p-3">
          <Bar width="40%" />
          <Bar width="90%" height={8} />
          <Bar width="70%" height={8} />
        </View>
      );
    case 'transcript':
      return (
        <View className="gap-3">
          <View className="h-10 w-3/5 self-end rounded-card bg-selected" />
          <Bar width="90%" />
          <Bar width="80%" />
          <Bar width="50%" />
        </View>
      );
  }
}

export function Skeleton({ shape, width, height, preset, count, testID }: SkeletonProps): React.ReactElement {
  return (
    <View accessibilityRole="progressbar" testID={testID} accessible accessibilityLabel="Loading" accessibilityState={{ busy: true }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {preset ? <Preset preset={preset} count={count} /> : <Shape shape={shape} width={width} height={height} />}
      </View>
    </View>
  );
}
