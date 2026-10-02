// ML-02 Header contract (03 ML-02; MD-18, MD-22, MD-85, MD-86, MD-94).
import type { ReactNode } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { BreadcrumbSegment } from '../../../layout/Breadcrumb/Breadcrumb.types';
import type { MenuEntry } from '../../Menu/Menu.types';
import type { IconButtonProps } from '../../../primitives/IconButton/IconButton.types';
import type { StatusBadgeProps } from '../../../primitives/StatusBadge/StatusBadge.types';

export type HeaderRole = 'top' | 'detail' | 'workspace' | 'modal';

export interface HeaderAction {
  /** testID `header-${id}` unless testID is set. */
  id: string;
  icon: MobileIconConcept;
  /** Accessibility label; also the overflow-menu label. */
  label: string;
  onPress?: () => void;
  /** Renders as a Menu trigger (⋯ / ⋮). */
  menu?: ReadonlyArray<MenuEntry>;
  onMenuSelect?: (id: string) => void;
  /** Tablet toggles. */
  selected?: boolean;
  badge?: IconButtonProps['badge'];
  /** Overflow only (MD-22). */
  destructive?: boolean;
  testID?: string;
}

export interface HeaderProps {
  role: HeaderRole;
  title: string;
  /** 'detail' | 'workspace'; the last segment is the parent. */
  breadcrumb?: ReadonlyArray<BreadcrumbSegment>;
  /** 'detail' | 'workspace': rendered as the StatusLine under the header. */
  status?: StatusBadgeProps;
  /** Home: "Wed, Sep 23 · ● Connected local:3100". */
  subtitle?: ReactNode;
  /** Trailing, in order; beyond the platform max they go into the ⋯ / ⋮ menu. */
  actions?: ReadonlyArray<HeaderAction>;
  /** Role 'top' (and tablet). */
  onSidebarToggle?: () => void;
  sidebarToggleState?: 'drawer' | 'shown' | 'hidden';
  /** Role 'detail' | 'workspace' (set by the shell's useHeaderNav). */
  onBack?: () => void;
  /** Role 'workspace'. */
  paneToggle?: { open: boolean; count: number; attention: boolean; onPress: () => void };
  /** Role 'modal' (MD-85: a text action, never filled). */
  modal?: { cancelLabel?: string; onCancel: () => void; primary?: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean } };
  /** Default true for role 'top' on iOS; Android only Home (MD-94). */
  largeTitle?: boolean;
  /**
   * iOS: an opaque bar the content starts below, for content that does not adjust its insets under a transparent
   * bar (the legacy screens hosted in the M5 shell, MD-141). Default false (transparent, MD-133).
   */
  opaque?: boolean;
  /** Content offset: the Android bar turns raised when content scrolls under it. */
  scroll?: SharedValue<number>;
  /** Sub-ids (03 §1.5): sidebar toggle `menu-button`, back (e.g. `chat-back`), pane toggle `pane-toggle`. */
  testIDs?: Partial<Record<'sidebarToggle' | 'back' | 'paneToggle', string>>;
  testID?: string;
}
