// MB-32 CheckpointScrubber (MPaneOpen, MPaneChanges): a card over the Changes list — `history` + "Turn 3 of 4" + mono
// time + "Compare" (diff the workspace against that turn), a track of snap stops (past filled, the selected one the
// thumb, later ones hollow) with mono times, the selected turn's prompt, its DiffStat and "Rewind to here" (the
// chat's rewind scopes, MB-08's sheet). Previous / Next turn are accessibility actions; a `selection` haptic per stop.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { WorkspaceCheckpoint } from '@generatorai/client-core';

import { cn } from '../../ui/lib/cn';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { DiffStat } from '../../ui/primitives/DiffStat';
import { Icon } from '../../ui/primitives/Icon';
import { Link } from '../../ui/primitives/Link';
import { Pressable } from '../../ui/primitives/Pressable';
import { Text } from '../../ui/primitives/Text';
import { scrubberStops, selectedStop, stopTime, stopTitle } from './model/scrubberModel';

export interface CheckpointScrubberProps {
  checkpoints: readonly WorkspaceCheckpoint[];
  /** The compare base of the Changes list (the stop it names is preselected). */
  base: string;
  onCompare: (selector: string) => void;
  /** Chat panes: rewind the conversation / code to before this turn (the screen asks for the scope). */
  onRewind?: (turnId: string, prompt: string) => void;
  testID?: string;
}

export function CheckpointScrubber({ checkpoints, base, onCompare, onRewind, testID = 'checkpoint-scrubber' }: CheckpointScrubberProps): React.ReactElement | null {
  const stops = useMemo(() => scrubberStops(checkpoints), [checkpoints]);
  const [picked, setPicked] = useState<string | null>(null);
  if (stops.length === 0) return null;
  const index = picked ? Math.max(0, stops.findIndex((s) => s.key === picked)) : selectedStop(stops, base);
  const stop = stops[index]!;
  const select = (next: number): void => {
    const target = stops[Math.min(stops.length - 1, Math.max(0, next))];
    if (!target || target.key === stop.key) return;
    haptic('selection');
    setPicked(target.key);
  };

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Checkpoints, ${stopTitle(index, stops.length)}, ${stopTime(stop.time)}`}
      accessibilityActions={[
        { name: 'decrement', label: 'Previous turn' },
        { name: 'increment', label: 'Next turn' },
        { name: 'compare', label: 'Compare against this turn' },
        ...(onRewind && stop.turnId ? [{ name: 'rewind', label: 'Rewind to here' }] : []),
      ]}
      onAccessibilityAction={(e) => {
        const name = e.nativeEvent.actionName;
        if (name === 'decrement') select(index - 1);
        else if (name === 'increment') select(index + 1);
        else if (name === 'compare') onCompare(stop.compareValue);
        else if (name === 'rewind' && stop.turnId) onRewind?.(stop.turnId, stop.prompt ?? '');
      }}
      className="mx-4 gap-3 rounded-card bg-raised p-3"
    >
      <View className="flex-row items-center gap-2">
        <Icon concept="history" size={18} tone="fg-2" />
        <Text role="subhead" weight={600}>
          {stopTitle(index, stops.length)}
        </Text>
        <Text role="monoSm" tone="fg-3">
          {stopTime(stop.time)}
        </Text>
        <View className="flex-1" />
        <Link label="Compare" onPress={() => onCompare(stop.compareValue)} testID={`${testID}-compare`} />
      </View>
      <View className="flex-row items-center">
        {stops.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 ? <View className={cn('h-0.5 flex-1', i <= index ? 'bg-fg-2' : 'bg-line-strong')} /> : null}
            <Pressable frame="none" feedback="none" onPress={() => select(i)} className="size-hit items-center justify-center">
              <View className={cn('rounded-full', i === index ? 'size-5 bg-fg' : i < index ? 'size-2.5 bg-fg-2' : 'size-2.5 border border-line-strong bg-surface')} />
            </Pressable>
          </React.Fragment>
        ))}
      </View>
      <View className="flex-row items-end gap-3">
        <View className="flex-1 gap-0.5">
          {stop.prompt ? (
            <Text role="footnote" tone="fg-3" numberOfLines={1}>
              {`You: “${stop.prompt}”`}
            </Text>
          ) : null}
          {stop.fileCount > 0 ? <DiffStat additions={stop.additions} deletions={stop.deletions} files={stop.fileCount} /> : null}
        </View>
        {onRewind && stop.turnId ? <Button label="Rewind to here" icon="undo" size="sm" onPress={() => onRewind(stop.turnId!, stop.prompt ?? '')} testID={`${testID}-rewind`} /> : null}
      </View>
    </View>
  );
}
