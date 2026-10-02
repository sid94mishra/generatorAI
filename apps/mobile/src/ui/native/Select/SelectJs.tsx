// MP-24 Select — the drawn field + the kit's anchored menu. It is the Android presentation (an M3 exposed dropdown:
// outlined h56 field with ▾ and a menu matching the field width, MD-130), and the iOS JS path (Jest, web, clients
// without Expo UI): label at the start, value fg-3 + ⇅ at the end. Haptic: selection on change.
import React, { useRef, useState } from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { haptic } from '../../platform/haptics';
import { nativePlatform } from '../../platform/geometry';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import { RadioGroup, RadioOption } from '../../primitives/RadioGroup';
import { SearchInput } from '../../primitives/SearchInput';
import { AnchoredMenu, type MenuAnchor } from '../Menu/MenuJs';
import { SheetModal } from '../Sheet/SheetJs';
import type { SelectProps } from './Select.types';
import { filterSelectOptions, selectAccessibilityLabel, selectMenuItems, selectValueText, selectedOption } from './selectModel';

/** `searchable`: a sheet with a compact SearchInput over a RadioGroup; choosing applies and closes (03 MP-24). */
function SelectSearchSheet({ open, onClose, props, onPick }: { open: boolean; onClose: () => void; props: SelectProps; onPick: (v: string) => void }): React.ReactElement {
  const [query, setQuery] = useState('');
  const shown = filterSelectOptions(props.options, query);
  return (
    <SheetModal open={open} title={props.label} detents={['large']} onDismiss={onClose} scrollable>
      <View className="px-4 pb-2">
        <SearchInput value={query} onChangeText={setQuery} placeholder={`Search ${props.label.toLowerCase()}`} size="compact" />
      </View>
      <RadioGroup
        value={props.value}
        onValueChange={(v) => {
          onPick(v);
          onClose();
        }}
        accessibilityLabel={props.label}
      >
        {shown.map((o) => (
          <RadioOption key={o.value} value={o.value} label={o.label} description={o.description} disabled={o.disabled} />
        ))}
      </RadioGroup>
      {shown.length === 0 ? (
        <Text role="subhead" tone="fg-3" align="center" className="p-6">
          No matches
        </Text>
      ) : null}
    </SheetModal>
  );
}

export function SelectJs(props: SelectProps): React.ReactElement {
  const { label, value, options, onValueChange, presentation = 'row', disabled = false, testID } = props;
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const android = nativePlatform === 'android';
  const outlined = android || presentation === 'field';
  const chosen = selectedOption(options, value);
  const show = (): void => {
    if (!props.searchable) ref.current?.measureInWindow?.((x, y, width, height) => setAnchor({ x, y, width, height }));
    setOpen(true);
  };
  const select = (v: string): void => {
    if (v === value) return;
    haptic('selection');
    onValueChange(v);
  };
  return (
    <View ref={ref} collapsable={false}>
      {outlined && !android ? (
        <Text role="subhead" tone="fg-2" className="px-1 pb-1.5">
          {label}
        </Text>
      ) : null}
      <Pressable
        testID={testID}
        onPress={show}
        disabled={disabled}
        frame="none"
        accessibilityRole="button"
        accessibilityLabel={selectAccessibilityLabel(props)}
        accessibilityHint={props.searchable ? 'Opens a list' : 'Opens a menu'}
        accessibilityState={{ expanded: open }}
        className={cn(
          'min-h-field flex-row items-center gap-3',
          android ? 'relative rounded-field border border-line-strong px-4' : outlined ? 'rounded-field bg-sunken ps-3 pe-2' : 'px-4',
          disabled && 'opacity-60',
        )}
      >
        {android ? (
          <View className="absolute -top-2.5 start-3 bg-surface px-1">
            <Text role="caption" tone="fg-2">
              {label}
            </Text>
          </View>
        ) : !outlined ? (
          <Text role="body" className="flex-1" numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        <Text role="body" tone={chosen && (android || outlined) ? 'fg' : 'fg-3'} numberOfLines={1} className={android || outlined ? 'flex-1' : 'shrink'}>
          {selectValueText(props)}
        </Text>
        <Icon concept={android ? 'chevron-down' : 'expand-all'} size={android ? 24 : 14} tone="fg-3" />
      </Pressable>
      {props.searchable ? (
        <SelectSearchSheet open={open} onClose={() => setOpen(false)} props={props} onPick={select} />
      ) : null}
      <AnchoredMenu open={open && !props.searchable} anchor={anchor} match={android || outlined} items={selectMenuItems(options, value)} onSelect={select} onClose={() => setOpen(false)} />
    </View>
  );
}
