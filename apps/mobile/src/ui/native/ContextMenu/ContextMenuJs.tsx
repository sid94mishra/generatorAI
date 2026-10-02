// MP-28 ContextMenu — the long-press menu drawn by the kit: Android's presentation (no preview, no scrim; the anchored
// menu under the row, the row highlighted while it is open; MD-130) and the iOS JS path (Jest, web, clients without
// Expo UI). Haptic: longPress on open.
import React, { useRef, useState } from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { haptic } from '../../platform/haptics';
import { AnchoredMenu, type MenuAnchor } from '../Menu/MenuJs';
import type { ContextMenuProps } from './ContextMenu.types';
import { contextTargetProps } from './contextMenuModel';

export function ContextMenuJs({ items, onSelect, disabled = false, children, testID }: ContextMenuProps): React.ReactElement {
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const show = (): void => {
    haptic('longPress');
    ref.current?.measureInWindow?.((x, y, width, height) => setAnchor({ x, y, width, height }));
    setOpen(true);
  };
  const target = React.cloneElement(children, {
    ...contextTargetProps({ items, onSelect, disabled }, children.props.accessibilityHint),
    onLongPress: disabled ? children.props.onLongPress : show,
  });
  return (
    <View ref={ref} collapsable={false} testID={testID} className={cn(open && 'bg-selected')}>
      {target}
      <AnchoredMenu open={open} anchor={anchor} items={items} onSelect={onSelect} onClose={() => setOpen(false)} />
    </View>
  );
}
