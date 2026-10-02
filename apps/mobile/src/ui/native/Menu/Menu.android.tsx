// MP-27 Menu — Android: the M3 Compose DropdownMenu through Expo UI, anchored to the trigger (hosted as RN content),
// on the overlay surface. Glyphs lead (RN Icon hosted in the item slot), checks trail, destructive text is err,
// groups are split by dividers, a submenu swaps the items in place with a back item (M3 has no cascading menu).
// Falls back to the JS path without the ExpoUI module.
import React, { useState } from 'react';
import { View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { Icon } from '../../primitives/Icon';
import { compose } from '../expoUi.android';
import type { MenuItem, MenuProps } from './Menu.types';
import { MenuJs } from './MenuJs';
import { entriesAt, findMenuItem, menuGroups } from './menuModel';

export type { MenuEntry, MenuItem, MenuProps, MenuSeparator } from './Menu.types';

export function Menu(props: MenuProps): React.ReactElement {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  if (!compose) return <MenuJs {...props} />;
  const { ui } = compose;
  const { items, onSelect, trigger, title, testID } = props;
  const close = (): void => {
    setOpen(false);
    setPath([]);
  };
  const parent = path.length ? findMenuItem(items, path[path.length - 1]!) : undefined;
  const glyph = (concept: NonNullable<MenuItem['icon']>, tone: 'fg-2' | 'err' | 'fg'): React.ReactElement => (
    <ui.RNHostView matchContents>
      <View>
        <Icon concept={concept} size={22} tone={tone} />
      </View>
    </ui.RNHostView>
  );
  const row = (item: MenuItem): React.ReactElement => (
    <ui.DropdownMenuItem
      key={item.id}
      enabled={!item.disabled}
      onClick={() => {
        if (item.children) setPath((p) => [...p, item.id]);
        else {
          close();
          onSelect(item.id);
        }
      }}
      elementColors={{ textColor: item.destructive ? colors.err : colors.fg, disabledTextColor: colors.fg3 }}
    >
      <ui.DropdownMenuItem.Text>
        {item.subtitle ? (
          <ui.Column>
            <ui.Text color={item.disabled ? colors.fg3 : item.destructive ? colors.err : colors.fg}>{item.label}</ui.Text>
            <ui.Text color={colors.fg3}>{item.subtitle}</ui.Text>
          </ui.Column>
        ) : (
          <ui.Text color={item.disabled ? colors.fg3 : item.destructive ? colors.err : colors.fg}>{item.label}</ui.Text>
        )}
      </ui.DropdownMenuItem.Text>
      {item.icon ? <ui.DropdownMenuItem.LeadingIcon>{glyph(item.icon, item.destructive ? 'err' : 'fg-2')}</ui.DropdownMenuItem.LeadingIcon> : null}
      {item.checked || item.children ? (
        <ui.DropdownMenuItem.TrailingIcon>{glyph(item.children ? 'chevron-right' : 'check', 'fg')}</ui.DropdownMenuItem.TrailingIcon>
      ) : null}
    </ui.DropdownMenuItem>
  );

  return (
    <View testID={testID} className="self-start">
      <ui.Host matchContents>
        <ui.DropdownMenu expanded={open} onDismissRequest={close} color={colors.overlay}>
          <ui.DropdownMenu.Trigger>
            <ui.RNHostView matchContents>
              <View>{React.cloneElement(trigger, { onPress: () => setOpen(true) })}</View>
            </ui.RNHostView>
          </ui.DropdownMenu.Trigger>
          <ui.DropdownMenu.Items>
            {parent ? (
              <ui.DropdownMenuItem onClick={() => setPath((p) => p.slice(0, -1))}>
                <ui.DropdownMenuItem.Text>
                  <ui.Text color={colors.fg2}>{parent.label}</ui.Text>
                </ui.DropdownMenuItem.Text>
                <ui.DropdownMenuItem.LeadingIcon>{glyph('back', 'fg-2')}</ui.DropdownMenuItem.LeadingIcon>
              </ui.DropdownMenuItem>
            ) : title ? (
              <ui.DropdownMenuItem enabled={false}>
                <ui.DropdownMenuItem.Text>
                  <ui.Text color={colors.fg3}>{title}</ui.Text>
                </ui.DropdownMenuItem.Text>
              </ui.DropdownMenuItem>
            ) : null}
            {menuGroups(entriesAt(items, path)).map((group, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <ui.HorizontalDivider /> : null}
                {group.map(row)}
              </React.Fragment>
            ))}
          </ui.DropdownMenu.Items>
        </ui.DropdownMenu>
      </ui.Host>
    </View>
  );
}
