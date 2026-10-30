// MP-27 Menu contract (03 MP-27; MD-63).
import type { ReactElement } from 'react';
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface MenuItem {
  id: string;
  label: string;
  icon?: MobileIconConcept;
  /** Disabled reason or secondary text. */
  subtitle?: string;
  /** Last group, err text; irreversible ones still confirm through AlertDialog after selection. */
  destructive?: boolean;
  /** Stateful item (MD-63): rendered as a checked / unchecked toggle. */
  checked?: boolean;
  disabled?: boolean;
  /** Submenu. */
  children?: ReadonlyArray<MenuEntry>;
  testID?: string;
}

export interface MenuSeparator {
  type: 'separator';
}

export type MenuEntry = MenuItem | MenuSeparator;

/** The trigger gets `onPress` injected where the platform needs it (Android, JS path). */
export type MenuTrigger = ReactElement<{ onPress?: () => void }>;

export interface MenuProps {
  items: ReadonlyArray<MenuEntry>;
  onSelect: (id: string) => void;
  /** An IconButton / Chip / Button; rendered inside the native trigger slot. */
  trigger: MenuTrigger;
  /** iOS menu title; Android header row. */
  title?: string;
  /** The trigger's name for assistive tech (defaults to the trigger's `label`); the hint says "Opens a menu". */
  accessibilityLabel?: string;
  testID?: string;
}
