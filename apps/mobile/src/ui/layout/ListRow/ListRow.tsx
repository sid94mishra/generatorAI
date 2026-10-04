// ML-13 ListRow (03 ML-13; MD-49, MD-59): one row element per kind. iOS min-h-row 52, pad 10 16, gap 12, glyph 20;
// Android min-h 56 (72 with a subtitle), gap 16, glyph 24. Title body, subtitle footnote fg-3, value subhead fg-3.
// Trailing per kind: navigation › (iOS only), toggle Switch (the whole row toggles), radio ✓ / leading radio,
// check leading box, stepper NumberField, segmented below the label, destructive err text, link ↗,
// requires-admin "Requires admin access · Request" + lock. Values can be copied (long-press + accessibility action).
import React from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { SegmentedControl } from '../../native/SegmentedControl';
import { Select } from '../../native/Select';
import { Switch } from '../../native/Switch';
import { CheckboxBox } from '../../primitives/Checkbox';
import { Icon } from '../../primitives/Icon';
import { NumberField } from '../../primitives/NumberField';
import { Pressable } from '../../primitives/Pressable';
import { RADIO_SIDE, Radio } from '../../primitives/RadioGroup';
import { Text } from '../../primitives/Text';
import { IOS_GROUP_CORNERS } from '../ListSection/listSectionModel';
import type { ListRowProps } from './ListRow.types';
import { listRowColumns, listRowLabel, listRowPress, listRowRole } from './listRowModel';

export type { ListRowKind, ListRowProps } from './ListRow.types';

export function ListRow(props: ListRowProps): React.ReactElement {
  const { kind, title, subtitle, icon, value, mono = false, selected = false, switchValue = false, provenance, badge, disabled = false, disabledReason, position, copyable = false, testID } = props;
  const android = nativePlatform === 'android';
  const surface = position ? IOS_GROUP_CORNERS[position] : undefined;

  if (kind === 'picker' && props.picker) {
    return (
      <View className={surface}>
        <Select {...props.picker} label={title} presentation="row" disabled={disabled || props.picker.disabled} testID={props.picker.testID ?? testID} />
      </View>
    );
  }

  const glyph = icon ? <Icon concept={icon} size={android ? 24 : 20} tone={kind === 'destructive' ? 'err' : 'fg-2'} /> : null;
  // A disabled row stays a (disabled) control so its role and reason are announced.
  const press = listRowPress(props);
  const copy = copyable && value ? () => void Clipboard.setStringAsync(value) : undefined;
  const titleTone = disabled ? 'fg-3' : kind === 'destructive' ? 'err' : 'fg';
  const columns = listRowColumns(kind, value);

  const text = (
    <View className={cn('gap-0.5', columns.title)}>
      <Text role="body" tone={titleTone}>
        {title}
      </Text>
      {subtitle ? (
        <Text role="footnote" tone="fg-3">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  let trailing: React.ReactNode = null;
  if (kind === 'navigation' || kind === 'value' || kind === 'info') {
    trailing = (
      <>
        {value ? (
          <Text role={mono ? 'mono' : 'subhead'} tone="fg-3" numberOfLines={1} selectable={copyable} className="shrink">
            {value}
          </Text>
        ) : null}
        {kind === 'navigation' && !android ? <Icon concept="chevron-right" size={14} tone="fg-3" /> : null}
      </>
    );
  } else if (kind === 'toggle') {
    trailing = <Switch value={switchValue} onValueChange={(v) => props.onValueChange?.(v)} label={title} disabled={disabled} />;
  } else if (kind === 'radio' && RADIO_SIDE === 'trailing') {
    trailing = <Radio value={title} selected={selected} disabled={disabled} />;
  } else if (kind === 'stepper' && props.stepper) {
    trailing = <NumberField {...props.stepper} label={title} disabled={disabled || props.stepper.disabled} />;
  } else if (kind === 'link') {
    trailing = <Icon concept="external-link" size={14} tone="fg-3" />;
  } else if (kind === 'requires-admin') {
    trailing = (
      <View className="shrink flex-row items-center gap-1">
        <Text role="footnote" tone="fg-3" numberOfLines={2} className="shrink" align="end">
          Requires admin access · Request
        </Text>
        <Icon concept="lock" size={14} tone="fg-3" />
      </View>
    );
  }

  const leading =
    kind === 'check' ? <CheckboxBox checked={selected} disabled={disabled} /> : kind === 'radio' && RADIO_SIDE === 'leading' ? <Radio value={title} selected={selected} disabled={disabled} /> : glyph;

  const row = (
    <>
      <View className="flex-row items-center gap-3 android:gap-4">
        {leading}
        {kind === 'check' || (kind === 'radio' && RADIO_SIDE === 'leading') ? glyph : null}
        {text}
        {provenance}
        {badge}
        <View
          className={cn('flex-row items-center gap-2', columns.trailing)}
          importantForAccessibility={kind === 'stepper' || kind === 'segmented' ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={!(kind === 'stepper' || kind === 'segmented')}
        >
          {trailing}
        </View>
      </View>
      {kind === 'segmented' && props.segmented ? <SegmentedControl {...props.segmented} accessibilityLabel={title} fullWidth /> : null}
    </>
  );

  const frame = cn(
    'gap-2 px-4 py-2.5 justify-center',
    subtitle ? 'min-h-row android:min-h-row-2' : 'min-h-row',
    kind === 'segmented' && 'py-3',
    surface,
  );
  const role = listRowRole(kind);
  if (!press && !copy) {
    return (
      <View testID={testID} className={frame} accessible={kind !== 'stepper' && kind !== 'segmented'} accessibilityLabel={kind === 'stepper' || kind === 'segmented' ? undefined : listRowLabel(props)}>
        {row}
      </View>
    );
  }
  const state =
    kind === 'toggle' ? { checked: switchValue } : kind === 'radio' || kind === 'check' ? { checked: selected } : undefined;
  return (
    <Pressable
      testID={testID}
      onPress={press}
      onLongPress={copy}
      disabled={disabled}
      disabledReason={disabledReason}
      frame="none"
      haptic={kind === 'radio' || kind === 'check' ? 'selection' : undefined}
      accessibilityRole={role}
      accessibilityLabel={listRowLabel(props)}
      accessibilityHint={kind === 'requires-admin' ? 'Request admin access' : undefined}
      accessibilityState={state}
      accessibilityActions={copy ? [{ name: 'copy', label: 'Copy' }] : undefined}
      onAccessibilityAction={(name) => name === 'copy' && copy?.()}
      className={cn(frame, 'items-stretch')}
    >
      {row}
    </Pressable>
  );
}
