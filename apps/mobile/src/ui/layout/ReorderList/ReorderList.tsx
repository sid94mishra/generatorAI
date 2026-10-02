// ML-16 ReorderList (03 ML-16) on react-native-reorderable-list (Reanimated + RNGH, JS only): each row gets a drag
// handle (grip 20, drawn 36 × 28 in a 44 / 48 frame) that lifts on touch (scale + shadow-pop), `dragStart` haptic on
// lift, `dragTick` per slot passed, `canMove` vetoes a drop. Every handle also offers Move up / Move down actions
// (MD-28); callers put the same items in the row menu. Reduce Motion drops the reorder animation.
import React from 'react';
import { Pressable as RNPressable, View } from 'react-native';
import ReorderableList, { useIsActive, useReorderableDrag } from 'react-native-reorderable-list';

import { cn } from '../../lib/cn';
import { haptic } from '../../platform/haptics';
import { useReduceMotion } from '../../platform/motion';
import { Icon } from '../../primitives/Icon';
import type { ReorderListProps } from './ReorderList.types';
import { allowedMove, moveActions } from './reorderModel';

export type { ReorderListProps } from './ReorderList.types';

function DragHandle({ label, actions, onAction }: { label: string; actions: Array<{ name: string; label: string }>; onAction: (name: string) => void }): React.ReactElement {
  const drag = useReorderableDrag();
  return (
    <RNPressable
      onPressIn={drag}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Drag to reorder"
      accessibilityActions={actions}
      onAccessibilityAction={(e) => onAction(e.nativeEvent.actionName)}
      className="min-h-hit min-w-hit items-center justify-center"
    >
      <View className="h-7 w-9 items-center justify-center rounded-control">
        <Icon concept="grip" size={20} tone="fg-3" />
      </View>
    </RNPressable>
  );
}

function Cell({ children }: { children: React.ReactNode }): React.ReactElement {
  const active = useIsActive();
  return <View className={cn(active && 'bg-raised shadow-pop')}>{children}</View>;
}

export function ReorderList<T>({ data, keyExtractor, renderItem, canMove, onMove, editing, itemLabel, testID }: ReorderListProps<T>): React.ReactElement {
  const reduced = useReduceMotion();
  const move = (from: number, to: number): void => {
    const item = data[from];
    if (item !== undefined && allowedMove(from, to, data.length, canMove)) onMove(keyExtractor(item), to);
  };
  return (
    <ReorderableList
      testID={testID}
      data={data as T[]}
      keyExtractor={keyExtractor}
      dragEnabled={editing}
      animationDuration={reduced ? 0 : 200}
      onDragStart={() => haptic('dragStart')}
      onIndexChange={() => haptic('dragTick')}
      onReorder={({ from, to }) => move(from, to)}
      renderItem={({ item, index }) => (
        <Cell>
          {renderItem(
            item,
            editing ? (
              <DragHandle
                label={`Reorder ${itemLabel ? itemLabel(item) : keyExtractor(item)}`}
                actions={moveActions(index, data.length, canMove)}
                onAction={(name) => move(index, name === 'moveUp' ? index - 1 : index + 1)}
              />
            ) : null,
          )}
        </Cell>
      )}
    />
  );
}
