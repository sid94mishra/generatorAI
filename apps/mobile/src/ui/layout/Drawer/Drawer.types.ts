// ML-06 Drawer contract (03 ML-06; MD-28, MD-46, MD-59, MD-95).
import type { ReactNode } from 'react';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { NavDestinationId } from '@generatorai/shared/ui-contract';

export interface DrawerProps {
  /** Server switcher trigger + New chat (h52). */
  header: ReactNode;
  /** The search field in button mode (opens the palette, MD-46). */
  search: ReactNode;
  /** DrawerNavItem × NAV_DESTINATIONS. */
  nav: ReactNode;
  /** Needs you / Running sections (AttentionList drawer variant). */
  live?: ReactNode;
  /** Connection status + Settings. */
  footer: ReactNode;
  /** modal = the phone drawer inside an overlay SidePanel · persistent = the tablet sidebar. */
  variant: 'modal' | 'persistent';
  testID?: string;
}

export interface DrawerNavItemProps {
  destination: NavDestinationId;
  label: string;
  icon: MobileIconConcept;
  selected: boolean;
  onPress: () => void;
  /** A neutral count after the label (none on the seven destinations today). */
  count?: number;
}

export interface DrawerSectionProps {
  label: string;
  count?: number;
  /** 'warn' for Needs you. */
  countTone?: 'warn' | 'fg-3';
  /** Overflow row "Show all (N)" (more than five rows). */
  showAll?: { label: string; onPress: () => void };
  children: ReactNode;
  /** On the section header (`drawer-inbox` for Needs you, MD-95). */
  testID?: string;
}

export interface DrawerLiveRowProps {
  title: string;
  /** needs-you: the warn hand · running: a spinner. */
  kind: 'needs-you' | 'running';
  /** Ask verb ("Approve", "git push") or the mono elapsed time ("4:12"). */
  trailing?: string;
  trailingMono?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}
