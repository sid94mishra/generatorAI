// MP-27 Menu — iOS: a SwiftUI Menu (UIMenu) through Expo UI: SF Symbols, the destructive role, groups split by
// dividers, submenus, checked items as toggles (MD-63), the title as the first section's header. The RN trigger is
// hosted as the menu's label (RNHostView) with its own touches off, so the tap opens the native menu; the menu, not
// the hosted view, is the accessibility element. Falls back to the JS path without the ExpoUI module.
import React from 'react';
import { View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { swiftUI, type SwiftUIKit } from '../expoUi.ios';
import type { MenuEntry, MenuItem, MenuProps } from './Menu.types';
import { MenuJs } from './MenuJs';
import { menuGroups, sfSymbolFor } from './menuModel';

export type { MenuEntry, MenuItem, MenuProps, MenuSeparator } from './Menu.types';

/** SwiftUI menu content for entries: Buttons (destructive role), Toggles for checked items, nested Menus, Dividers
 * between groups. Shared with ContextMenu.ios. */
export function swiftMenuEntries(kit: SwiftUIKit, list: ReadonlyArray<MenuEntry>, onSelect: (id: string) => void): React.ReactElement[] {
  const { ui, modifiers: m } = kit;
  const item = (entry: MenuItem): React.ReactElement => {
    const symbol = sfSymbolFor(entry.icon) as SFSymbol | undefined;
    const mods = [m.disabled(Boolean(entry.disabled))];
    if (entry.children) {
      return (
        <ui.Menu key={entry.id} label={entry.label} systemImage={symbol}>
          {swiftMenuEntries(kit, entry.children, onSelect)}
        </ui.Menu>
      );
    }
    if (entry.checked !== undefined) {
      return <ui.Toggle key={entry.id} isOn={entry.checked} label={entry.label} systemImage={symbol} onIsOnChange={() => onSelect(entry.id)} modifiers={mods} />;
    }
    if (entry.subtitle) {
      return (
        <ui.Button key={entry.id} systemImage={symbol} role={entry.destructive ? 'destructive' : 'default'} onPress={() => onSelect(entry.id)} modifiers={mods}>
          <ui.Text>{entry.label}</ui.Text>
          <ui.Text>{entry.subtitle}</ui.Text>
        </ui.Button>
      );
    }
    return <ui.Button key={entry.id} label={entry.label} systemImage={symbol} role={entry.destructive ? 'destructive' : 'default'} onPress={() => onSelect(entry.id)} modifiers={mods} />;
  };
  return menuGroups(list).map((group, i) => (
    <React.Fragment key={i}>
      {i > 0 ? <ui.Divider /> : null}
      {group.map(item)}
    </React.Fragment>
  ));
}

export function Menu(props: MenuProps): React.ReactElement {
  const kit = swiftUI;
  if (!kit) return <MenuJs {...props} />;
  const { ui, modifiers: m } = kit;
  const { items, onSelect, trigger, title, accessibilityLabel, testID } = props;
  const entries = (list: ReadonlyArray<MenuEntry>): React.ReactElement[] => swiftMenuEntries(kit, list, onSelect);

  const name = accessibilityLabel ?? (trigger.props as { label?: string }).label ?? 'More';
  return (
    <View testID={testID} className="self-start">
      <ui.Host matchContents>
        <ui.Menu
          label={
            <ui.RNHostView matchContents>
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {trigger}
              </View>
            </ui.RNHostView>
          }
          modifiers={[m.accessibilityLabel(name), m.accessibilityHint('Opens a menu')]}
        >
          {title ? <ui.Section title={title}>{entries(items)}</ui.Section> : entries(items)}
        </ui.Menu>
      </ui.Host>
    </View>
  );
}
