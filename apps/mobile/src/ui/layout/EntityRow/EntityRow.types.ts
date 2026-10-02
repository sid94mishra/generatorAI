// ML-14 EntityRow contract (03 ML-14; MD-27, MD-59, MD-60).
import type { ReactElement } from 'react';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { StatusState } from '@generatorai/shared';
import type { MenuEntry } from '../../native/Menu/Menu.types';
import type { RowPosition } from '../ListSection/ListSection.types';

export type EntityLeading = { status: StatusState } | { icon: MobileIconConcept } | { checkbox: boolean };

export interface EntityRowAction {
  id: string;
  label: string;
  onPress: () => void;
}

export interface EntityRowProps {
  title: string;
  /** Status glyph (StatusBadge's glyph only), an icon, or the selection-mode checkbox (MD-60). */
  leading: EntityLeading;
  /** Joined with " · " (strings are footnote fg-3; elements render as given, e.g. AgentGlyph, mono project). */
  meta?: ReadonlyArray<ReactElement | string>;
  /** Spoken words for element meta (a mono project, an AgentGlyph), which the label cannot read from the element. */
  metaLabel?: string;
  /** ISO time → relative mono ("3m", "now", "1h"). */
  time?: string;
  pinned?: boolean;
  /** Rendered only when the field exists (MG-02, MD-27). */
  unread?: boolean;
  archived?: boolean;
  /** DiffStat | StatusBadge sm | Button tonal sm | timer. */
  trailing?: ReactElement;
  selected?: boolean;
  onPress: () => void;
  /** Long-press ContextMenu + accessibility actions (MD-28). */
  menu?: ReadonlyArray<MenuEntry>;
  onMenuSelect?: (id: string) => void;
  /** iOS context-menu preview. */
  preview?: ReactElement;
  position?: RowPosition;
  /** Set by SwipeRow: its actions as accessibility actions (MD-28). */
  swipeActions?: ReadonlyArray<EntityRowAction>;
  testID?: string;
}
