// ML-14 EntityRow (03 ML-14): the two-line entity row of Chats, Projects, Agents, Workflows, Automations, Scripts,
// Home and palette results. min-h-row-2 (68 iOS / 72 Android), pad 12 16. Leading column: status glyph, icon or the
// selection checkbox. Line 1: title (600 when unread), pin, unread dot, relative time (mono). Line 2: meta joined
// by " · " and the trailing slot. Archived: fg-3 title + "Archived" badge. Long-press opens the ContextMenu; every
// menu item and swipe action is an accessibility action (MD-28).
import React from 'react';
import { View } from 'react-native';
import { STATUS_STATE_DEFS } from '@generatorai/shared';
import type { MobileIconConcept } from '@generatorai/design-tokens';

import { cn } from '../../lib/cn';
import { formatRelativeShort } from '../../lib/format';
import { nativePlatform } from '../../platform/geometry';
import { ContextMenu } from '../../native/ContextMenu';
import { Badge } from '../../primitives/Badge';
import { CheckboxBox } from '../../primitives/Checkbox';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import { IOS_GROUP_CORNERS } from '../ListSection/listSectionModel';
import type { EntityRowProps } from './EntityRow.types';
import { entityRowLabel } from './entityRowModel';

export type { EntityLeading, EntityRowAction, EntityRowProps } from './EntityRow.types';

function Leading({ leading }: Pick<EntityRowProps, 'leading'>): React.ReactElement {
  const size = nativePlatform === 'android' ? 24 : 20;
  if ('checkbox' in leading) return <CheckboxBox checked={leading.checkbox} />;
  if ('icon' in leading) return <Icon concept={leading.icon} size={size} tone="fg-2" />;
  const def = STATUS_STATE_DEFS[leading.status];
  return <Icon concept={def.glyph as MobileIconConcept} size={size} tone={def.tone} spinning={def.spin} />;
}

export function EntityRow(props: EntityRowProps): React.ReactElement {
  const { title, leading, meta, time, pinned, unread, archived, trailing, selected = false, onPress, menu, onMenuSelect, preview, position, swipeActions, testID } = props;
  const selecting = 'checkbox' in leading;
  const swipe = swipeActions ?? [];
  const row = (
    <Pressable
      testID={testID}
      onPress={onPress}
      frame="none"
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityLabel={entityRowLabel(props)}
      accessibilityState={selecting ? { checked: leading.checkbox } : { selected }}
      accessibilityActions={swipe.length ? swipe.map((a) => ({ name: a.id, label: a.label })) : undefined}
      onAccessibilityAction={(name) => swipe.find((a) => a.id === name)?.onPress()}
      haptic={selecting ? 'selection' : undefined}
      className={cn('min-h-row-2 flex-row items-start gap-3 px-4 py-3 android:gap-4', selected && 'bg-selected', position && IOS_GROUP_CORNERS[position])}
    >
      <View className="min-h-5.5 justify-center pt-0.5">
        <Leading leading={leading} />
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-center gap-1.5">
          <Text role="transcript" weight={unread ? 600 : 500} tone={archived ? 'fg-3' : 'fg'} numberOfLines={1} className="shrink">
            {title}
          </Text>
          {pinned ? <Icon concept="pin" size={14} tone="fg-3" filled /> : null}
          <View className="flex-1" />
          {unread ? <View className="size-2 rounded-full bg-fg" /> : null}
          {time ? (
            <Text role="monoSm" tone="fg-3" chrome>
              {formatRelativeShort(time)}
            </Text>
          ) : null}
        </View>
        {meta?.length || trailing || archived ? (
          <View className="flex-row items-center gap-2">
            <View className="flex-1 flex-row flex-wrap items-center gap-x-1">
              {archived ? <Badge label="Archived" size="sm" /> : null}
              {(meta ?? []).map((m, i) => (
                <React.Fragment key={i}>
                  {i > 0 ? (
                    <Text role="footnote" tone="fg-3">
                      ·
                    </Text>
                  ) : null}
                  {typeof m === 'string' ? (
                    <Text role="footnote" tone="fg-3" numberOfLines={1} className="shrink">
                      {m}
                    </Text>
                  ) : (
                    m
                  )}
                </React.Fragment>
              ))}
            </View>
            {trailing}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
  if (!menu?.length || !onMenuSelect || selecting) return row;
  return (
    <ContextMenu items={menu} onSelect={onMenuSelect} preview={preview}>
      {row}
    </ContextMenu>
  );
}
