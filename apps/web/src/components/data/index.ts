// ────────────────────────────────────────────────────────────────
// Data-display kit — the standard card/row anatomy for list screens.
//
//   import { EntityCard, EntityListRow, FilterTabs } from '@/components/data/index.js';
//
//   EntityCard    — grid views (projects, scripts, templates)
//   EntityListRow — list views (chats, automations, recent runs)
//   FilterTabs    — segmented status filter (All / Active / …)
// ────────────────────────────────────────────────────────────────

export { EntityCard, type EntityCardProps } from './EntityCard.js';
export {
  EntityListRow,
  type EntityListRowProps,
  type EntityListRowSize,
} from './EntityListRow.js';
export { FilterTabs, type FilterTabsProps, type FilterTabOption } from './FilterTabs.js';
