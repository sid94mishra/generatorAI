// MP-10 Chip (03 MP-10; MD-49): h32 drawn inside a hit-target frame (MD-91). Filter chips toggle with a leading
// check on both OSes (selection is never colour alone); the remove control has its own 44/48 frame.
import React from 'react';
import { Image, View } from 'react-native';

import { cn } from '../../lib/cn';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import type { ChipProps, ChipVariant } from './Chip.types';

export type { ChipProps, ChipVariant } from './Chip.types';

/** The drawn chip for a variant and state (exported for tests). */
export function chipSurface(variant: ChipVariant, selected: boolean, error: boolean): string {
  if (variant === 'attachment') {
    return cn('min-h-10 flex-row items-center gap-2 rounded-control bg-sunken pe-8 ps-1.5', error ? 'border border-err' : 'border border-line');
  }
  const base = 'min-h-chip flex-row items-center rounded-control-sm ios:gap-1.5 android:gap-2';
  if (variant === 'composer') return cn(base, 'ios:px-2 android:px-1.5');
  if (variant === 'add') return cn(base, 'border border-dashed border-line-strong px-3');
  const edge = selected ? 'bg-selected' : 'border ios:border-line android:border-line-strong';
  return cn(base, 'px-3', edge, variant === 'input' && 'pe-8');
}

function chipName({ label, locked, count, error, variant }: ChipProps): string {
  const parts = [label];
  if (count !== undefined) parts.push(String(count));
  if (locked) parts.push('locked');
  if (variant === 'attachment' && error) parts.push(`failed: ${error}`);
  return parts.join(', ');
}

export function Chip(props: ChipProps): React.ReactElement {
  const { label, variant = 'filter', selected = false, icon, locked = false, count, thumbnail, progress, error, onPress, onRemove, disabled = false, testID } = props;
  const toggles = variant === 'filter';
  const active = toggles && selected;
  const tone = active ? 'fg' : 'fg-2';
  return (
    <View className="self-start">
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled || !onPress}
        haptic={toggles ? 'selection' : undefined}
        accessibilityRole="button"
        accessibilityLabel={chipName({ ...props, variant })}
        accessibilityHint={variant === 'dropdown' ? 'Opens a menu' : error ? 'Retries the upload' : undefined}
        accessibilityState={toggles ? { selected } : undefined}
      >
        <View className={cn(chipSurface(variant, active, Boolean(error)), disabled && 'opacity-40')}>
          {active ? <Icon concept="check" size={16} tone="fg" /> : null}
          {thumbnail ? <Image source={thumbnail} className="size-7 rounded-control android:size-8" /> : null}
          {icon && !active ? <Icon concept={icon} size={14} tone={tone} /> : null}
          <Text role="footnote" weight={500} tone={tone} chrome numberOfLines={1}>
            {label}
          </Text>
          {count !== undefined ? (
            <Text role="monoSm" tone="fg-3" chrome>
              {String(count)}
            </Text>
          ) : null}
          {locked ? <Icon concept="lock" size={12} tone="fg-3" /> : null}
          {variant === 'dropdown' || (variant === 'composer' && !locked) ? <Icon concept="chevron-down" size={14} tone="fg-3" /> : null}
          {variant === 'attachment' && progress !== undefined && progress < 1 ? (
            <View className="absolute inset-x-0 bottom-0 h-0.5 bg-run" style={{ width: `${Math.max(0, progress) * 100}%` }} />
          ) : null}
        </View>
      </Pressable>
      {onRemove && (variant === 'input' || variant === 'attachment') ? (
        <View className="absolute inset-y-0 end-0 justify-center">
          <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove ${label}`} feedback="none">
            <Icon concept="x" size={14} tone="fg-2" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
