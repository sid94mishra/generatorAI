// ML-15 SwipeRow (03 ML-15; MD-52): RNGH's ReanimatedSwipeable around an EntityRow. iOS: full-height tiles (leading
// 64, trailing 74 each); Android: 74-wide pills, radius 16, inset 4. A full swipe performs the side's last action
// with the `threshold` haptic as it arms. One row open at a time (closeOpenSwipeRow() for scroll / drawer). Every
// action is also an accessibility action on the row (MD-28); callers also list them in the row menu.
import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { geometry, nativePlatform } from '../../platform/geometry';
import { haptic } from '../../platform/haptics';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { SwipeAction, SwipeRowProps } from './SwipeRow.types';
import { fullSwipeAction, fullSwipeDistance, revealWidth } from './swipeRowModel';

export type { SwipeAction, SwipeRowProps } from './SwipeRow.types';

let openRow: SwipeableMethods | null = null;

/** Closes whichever row is open (call when the list scrolls or the drawer opens). */
export function closeOpenSwipeRow(): void {
  openRow?.close();
  openRow = null;
}

function Actions({ actions, side, translation, armAt, onArm, onRun }: { actions: ReadonlyArray<SwipeAction>; side: 'leading' | 'trailing'; translation: SharedValue<number>; armAt: number; onArm: (armed: boolean) => void; onRun: (a: SwipeAction) => void }): React.ReactElement {
  useAnimatedReaction(
    () => Math.abs(translation.value) >= armAt,
    (armed, previous) => {
      if (armed !== previous && previous !== null) runOnJS(onArm)(armed);
    },
    [armAt],
  );
  const android = nativePlatform === 'android';
  const width = side === 'leading' ? geometry().controls.swipeAction.leading : geometry().controls.swipeAction.trailing;
  return (
    <View className={cn('flex-row', android && 'gap-1 py-1 pe-2 ps-2')}>
      {actions.map((a) => (
        <Pressable
          key={a.id}
          onPress={() => onRun(a)}
          frame="none"
          feedback="none"
          accessibilityRole="button"
          accessibilityLabel={a.label}
          className={cn('items-center justify-center gap-1', a.tone === 'strong' ? 'bg-fg-2' : 'bg-line-strong', android && 'rounded-card-lg')}
        >
          <View style={{ width }} className="items-center gap-1">
            <Icon concept={a.icon} size={20} tone={a.tone === 'strong' ? 'surface' : 'fg'} />
            <Text role="caption" tone={a.tone === 'strong' ? 'surface' : 'fg'} chrome numberOfLines={1}>
              {a.label}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export function SwipeRow(props: SwipeRowProps): React.ReactElement {
  const { leading = [], trailing = [], children, testID } = props;
  const ref = useRef<SwipeableMethods>(null);
  const armed = useRef<'leading' | 'trailing' | null>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const controls = geometry().controls.swipeAction;
  const run = (a: SwipeAction): void => {
    ref.current?.close();
    a.onPress();
  };
  const arm = (side: 'leading' | 'trailing') => (on: boolean) => {
    armed.current = on ? side : null;
    if (on) haptic('threshold');
  };
  const side = (s: 'leading' | 'trailing', actions: ReadonlyArray<SwipeAction>, per: number) =>
    actions.length
      ? (_progress: SharedValue<number>, translation: SharedValue<number>) => (
          <Actions actions={actions} side={s} translation={translation} armAt={fullSwipeAction(props, s) ? fullSwipeDistance(rowWidth, revealWidth(actions.length, per)) : Number.POSITIVE_INFINITY} onArm={arm(s)} onRun={run} />
        )
      : undefined;

  const row = React.cloneElement(children, { swipeActions: [...(children.props.swipeActions ?? []), ...[...leading, ...trailing].map((a) => ({ id: a.id, label: a.label, onPress: a.onPress }))] });
  return (
    <View testID={testID} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      <ReanimatedSwipeable
        ref={ref}
        friction={1}
        overshootFriction={4}
        leftThreshold={revealWidth(leading.length, controls.leading) / 2}
        rightThreshold={revealWidth(trailing.length, controls.trailing) / 2}
        renderLeftActions={side('leading', leading, controls.leading)}
        renderRightActions={side('trailing', trailing, controls.trailing)}
        onSwipeableWillOpen={() => {
          if (openRow && openRow !== ref.current) openRow.close();
          openRow = ref.current;
        }}
        onSwipeableOpen={() => {
          const s = armed.current;
          armed.current = null;
          const full = s ? fullSwipeAction(props, s) : undefined;
          if (full) run(full);
        }}
      >
        {/* Opaque, so the action track never shows through the row at rest. */}
        <View className="bg-surface">{row}</View>
      </ReanimatedSwipeable>
    </View>
  );
}
