// ────────────────────────────────────────────────────────────────
// F-dock-01 Changes toolbar (03-domain §3.3; board DockChanges).
//
// 40h bar: ± and the change count (plus "N to review · M kept" once
// something is kept) on the left; on the right the comments popover (a slot,
// review only), Show file tree, Expand all, View settings (Unified / Split,
// Wrap lines, tree Left / Right), Checkpoints & rewind, Refresh. Pure view.
//
// The accessible names and `data-testid`s are pinned by the Changes-panel
// characterization tests and the e2e / desktop smokes (09 §5.3) — keep them.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import type { DiffViewMode } from './diffTypes.js';
import type { TreePosition } from './useChangesViewSettings.js';

export interface ChangesToolbarProps {
  stats: { files: number; additions: number; deletions: number };
  keptCount: number;
  /** The review comments popover (its own trigger); omitted without review. */
  commentsSlot?: ReactNode;
  showTree: boolean;
  onToggleTree: () => void;
  allExpanded: boolean;
  /** Nothing can be expanded (no files, or only binary / too-large ones). */
  expandDisabled: boolean;
  onToggleExpandAll: () => void;
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
  wrapLines: boolean;
  onToggleWrapLines: () => void;
  treePosition: TreePosition;
  onPlaceTree: (position: TreePosition) => void;
  checkpointsOpen: boolean;
  onToggleCheckpoints: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}

export function ChangesToolbar({
  stats,
  keptCount,
  commentsSlot,
  showTree,
  onToggleTree,
  allExpanded,
  expandDisabled,
  onToggleExpandAll,
  viewMode,
  onViewModeChange,
  wrapLines,
  onToggleWrapLines,
  treePosition,
  onPlaceTree,
  checkpointsOpen,
  onToggleCheckpoints,
  refreshing,
  onRefresh,
}: ChangesToolbarProps) {
  return (
    <div className="flex h-panel-bar shrink-0 items-center gap-2 border-b border-line-soft pr-1.5 pl-3">
      {stats.additions > 0 || stats.deletions > 0 ? <DiffStat added={stats.additions} removed={stats.deletions} /> : null}
      <span className="shrink-0 text-small text-fg-2" data-testid="changes-count">
        {stats.files} {stats.files === 1 ? 'change' : 'changes'}
      </span>
      {keptCount > 0 ? (
        <span className="min-w-0 truncate text-small text-fg-3" data-testid="changes-kept-count">
          {stats.files - keptCount} to review · {keptCount} kept
        </span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {commentsSlot}
        <IconButton
          size="sm"
          icon="sidebar"
          label={showTree ? 'Hide file tree' : 'Show file tree'}
          pressed={showTree}
          onClick={onToggleTree}
        />
        <IconButton
          size="sm"
          icon={allExpanded ? 'collapse-all' : 'expand-all'}
          label={allExpanded ? 'Collapse all files' : 'Expand all files'}
          disabled={expandDisabled}
          onClick={onToggleExpandAll}
        />
        <Menu.Root modal={false}>
          <Menu.Trigger render={<IconButton size="sm" icon="settings" label="View settings" />} />
          <Menu.Popup align="end">
            <Menu.Group>
              <Menu.GroupLabel>View</Menu.GroupLabel>
              <Menu.CheckboxItem checked={viewMode === 'unified'} onCheckedChange={() => onViewModeChange('unified')}>
                Unified view
              </Menu.CheckboxItem>
              {/* Added and deleted files have no second side; saying so up
                  front keeps Split from looking broken on new files. */}
              <Menu.CheckboxItem
                checked={viewMode === 'split'}
                onCheckedChange={() => onViewModeChange('split')}
                title="Added and deleted files always render in a single column."
              >
                Split view
              </Menu.CheckboxItem>
            </Menu.Group>
            <Menu.Separator />
            <Menu.CheckboxItem checked={wrapLines} onCheckedChange={onToggleWrapLines}>
              Wrap lines
            </Menu.CheckboxItem>
            <Menu.Separator />
            <Menu.Group>
              <Menu.GroupLabel>File tree position</Menu.GroupLabel>
              <Menu.CheckboxItem checked={treePosition === 'left'} onCheckedChange={() => onPlaceTree('left')}>
                Left
              </Menu.CheckboxItem>
              <Menu.CheckboxItem checked={treePosition === 'right'} onCheckedChange={() => onPlaceTree('right')}>
                Right
              </Menu.CheckboxItem>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Root>
        <IconButton
          size="sm"
          icon="history"
          label="Checkpoints & rewind"
          pressed={checkpointsOpen}
          onClick={onToggleCheckpoints}
        />
        <IconButton size="sm" icon="refresh" label="Refresh" loading={refreshing} disabled={refreshing} onClick={onRefresh} />
      </div>
    </div>
  );
}
