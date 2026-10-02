// MP-27 Menu — the JS path (Jest, the web preview, clients without Expo UI) and the panel ContextMenu's JS path
// reuses. An anchored list over a transparent scrim: iOS glyphs trail and checks lead, Android glyphs lead and checks
// trail; destructive rows are err; submenus open in place with a back row. Back / Escape / scrim tap close it.
import React, { useCallback, useState } from 'react';
import { Modal, Pressable as RNPressable, View, useWindowDimensions } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Separator } from '../../primitives/Separator';
import { Text } from '../../primitives/Text';
import type { MenuEntry, MenuItem, MenuProps } from './Menu.types';
import { entriesAt, findMenuItem, menuGroups } from './menuModel';

export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PANEL_WIDTH = 240;
const EDGE = 8;

/**
 * Where the panel goes for an anchor: below it, end-aligned and kept on screen; `match` (an exposed dropdown) takes
 * the anchor's width and start edge (exported for tests).
 */
export function panelPosition(anchor: MenuAnchor, window: { width: number; height: number }, match = false): { top: number; left: number; width: number } {
  const width = match ? anchor.width : PANEL_WIDTH;
  const left = match ? anchor.x : anchor.x + anchor.width - width;
  const top = anchor.y + anchor.height + 4;
  return {
    top: Math.min(Math.max(EDGE, top), Math.max(EDGE, window.height - EDGE - 320)),
    left: Math.min(Math.max(EDGE, left), Math.max(EDGE, window.width - EDGE - width)),
    width,
  };
}

function MenuRow({ item, onPress }: { item: MenuItem; onPress: () => void }): React.ReactElement {
  const android = nativePlatform === 'android';
  const tone = item.disabled ? 'fg-3' : item.destructive ? 'err' : 'fg';
  const glyph = item.icon ? <Icon concept={item.icon} size={android ? 22 : 18} tone={item.destructive ? 'err' : 'fg-2'} /> : null;
  const check = item.checked ? <Icon concept="check" size={16} tone="fg" /> : null;
  return (
    <Pressable
      testID={item.testID}
      onPress={onPress}
      disabled={item.disabled}
      disabledReason={item.subtitle}
      frame="none"
      accessibilityRole="menuitem"
      accessibilityLabel={item.subtitle && !item.disabled ? `${item.label}, ${item.subtitle}` : item.label}
      accessibilityState={item.checked === undefined ? undefined : { checked: item.checked }}
      className="min-h-item flex-row items-center gap-3 px-4 py-2"
    >
      {android ? glyph : <View className="w-4">{check}</View>}
      <View className="flex-1">
        <Text role="body" tone={tone} numberOfLines={2}>
          {item.label}
        </Text>
        {item.subtitle ? (
          <Text role="footnote" tone="fg-3">
            {item.subtitle}
          </Text>
        ) : null}
      </View>
      {item.children ? <Icon concept="chevron-right" size={14} tone="fg-3" /> : null}
      {android ? check : glyph}
    </Pressable>
  );
}

/** The menu list with in-place submenus. */
export function MenuPanel({ items, title, onSelect, onClose, width = PANEL_WIDTH }: { items: ReadonlyArray<MenuEntry>; title?: string; onSelect: (id: string) => void; onClose: () => void; width?: number }): React.ReactElement {
  const [path, setPath] = useState<string[]>([]);
  const parent = path.length ? findMenuItem(items, path[path.length - 1]!) : undefined;
  const groups = menuGroups(entriesAt(items, path));
  const press = (item: MenuItem): void => {
    if (item.children) setPath((p) => [...p, item.id]);
    else {
      onClose();
      onSelect(item.id);
    }
  };
  return (
    <View
      accessibilityViewIsModal
      accessibilityRole="menu"
      onAccessibilityEscape={onClose}
      className="overflow-hidden rounded-card bg-overlay py-1 shadow-pop"
      style={{ width }}
    >
      {parent ? (
        <Pressable onPress={() => setPath((p) => p.slice(0, -1))} frame="none" accessibilityRole="button" accessibilityLabel={`Back from ${parent.label}`} className="min-h-item flex-row items-center gap-2 px-4">
          <Icon concept="chevron-left" size={14} tone="fg-3" />
          <Text role="footnote" weight={600} tone="fg-3">
            {parent.label}
          </Text>
        </Pressable>
      ) : title ? (
        <View className="min-h-th justify-center px-4">
          <Text role="footnote" tone="fg-3">
            {title}
          </Text>
        </View>
      ) : null}
      {groups.map((group, i) => (
        <View key={i}>
          {i > 0 ? <Separator variant={nativePlatform === 'android' ? 'line' : 'band'} /> : null}
          {group.map((item) => (
            <MenuRow key={item.id} item={item} onPress={() => press(item)} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** A MenuPanel in a transparent modal at an anchor. */
export function AnchoredMenu({ open, anchor, items, title, onSelect, onClose, match = false }: { open: boolean; anchor: MenuAnchor | null; items: ReadonlyArray<MenuEntry>; title?: string; onSelect: (id: string) => void; onClose: () => void; match?: boolean }): React.ReactElement {
  const window = useWindowDimensions();
  const { width, ...at } = anchor ? panelPosition(anchor, window, match) : { top: EDGE, left: EDGE, width: PANEL_WIDTH };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <RNPressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} className="absolute inset-0" />
      <View className="absolute" style={at}>
        {open ? <MenuPanel items={items} title={title} onSelect={onSelect} onClose={onClose} width={width} /> : null}
      </View>
    </Modal>
  );
}

export function MenuJs({ items, onSelect, trigger, title, testID }: MenuProps): React.ReactElement {
  // A callback ref held in state: the trigger's handler measures it (no ref read during render).
  const [node, setNode] = useState<View | null>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback(() => {
    node?.measureInWindow?.((x, y, width, height) => setAnchor({ x, y, width, height }));
    setOpen(true);
  }, [node]);
  return (
    <View ref={setNode} collapsable={false} testID={testID} className={cn('self-start')}>
      {React.cloneElement(trigger, { onPress: show })}
      <AnchoredMenu open={open} anchor={anchor} items={items} title={title} onSelect={onSelect} onClose={() => setOpen(false)} />
    </View>
  );
}
