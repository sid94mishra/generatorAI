// MP-28 ContextMenu contract (03 MP-28; MD-28).
import type { ReactElement } from 'react';
import type { MenuEntry } from '../Menu/Menu.types';

/** The wrapped row: a kit Pressable-like element. ContextMenu injects the long-press, the accessibility actions
 * (one per enabled menu item, MD-28) and the hint. */
export interface ContextMenuTargetProps {
  onLongPress?: () => void;
  accessibilityActions?: ReadonlyArray<{ name: string; label: string }>;
  onAccessibilityAction?: (name: string) => void;
  accessibilityHint?: string;
}

export interface ContextMenuProps {
  items: ReadonlyArray<MenuEntry>;
  onSelect: (id: string) => void;
  /** iOS only: the lifted preview over the blurred scene. */
  preview?: ReactElement;
  disabled?: boolean;
  children: ReactElement<ContextMenuTargetProps>;
  testID?: string;
}
