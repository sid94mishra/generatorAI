// ────────────────────────────────────────────────────────────────
// F-dock-01 compare row (D-162; board DockChanges): what the list is measured
// against, plus the list's bulk actions — one 40h row.
//
//   [Uncommitted changes ▾]  +N workspace files ········· Keep all · Undo all
//
// The picker is the only compare control: Uncommitted changes (the default in
// a chat), This chat / This run, Last turn — see compareChoices.ts. The
// accessible name stays `Compare against` (09 §5.3). Keep all accepts every
// listed file; Undo all puts them back to the selected base, confirmed first
// (D-28).
// ────────────────────────────────────────────────────────────────

import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import type { CompareOption } from './compareChoices.js';

export interface CompareBarProps {
  base: string;
  onBaseChange: (base: string) => void;
  options: readonly CompareOption[];
  /** Hidden workspace-root files (0 = the chip only shows while they are on). */
  hiddenWorkspaceFiles: number;
  showWorkspaceFiles: boolean;
  onToggleWorkspaceFiles: () => void;
  /** Changed files on screen; the bulk actions need at least one. */
  files: number;
  keptCount: number;
  bulkBusy: 'keep' | 'undo' | null;
  onKeepAll: () => void;
  onUndoAll: () => void;
}

export function CompareBar({
  base,
  onBaseChange,
  options,
  hiddenWorkspaceFiles,
  showWorkspaceFiles,
  onToggleWorkspaceFiles,
  files,
  keptCount,
  bulkBusy,
  onKeepAll,
  onUndoAll,
}: CompareBarProps) {
  const chip = hiddenWorkspaceFiles > 0 || showWorkspaceFiles;
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-3 py-1.5">
      <Select
        size="sm"
        aria-label="Compare against"
        value={base}
        items={options.map((o) => ({
          value: o.value,
          label: o.label,
          ...(o.meta ? { meta: o.meta } : {}),
          ...(o.disabled ? { disabled: true } : {}),
        }))}
        onValueChange={(v) => {
          if (v !== null) onBaseChange(v);
        }}
        className="w-64 max-w-full min-w-0"
      />
      {chip ? (
        <Chip
          size="sm"
          pressed={showWorkspaceFiles}
          onClick={onToggleWorkspaceFiles}
          title={
            showWorkspaceFiles
              ? 'Hide files outside the linked codebases'
              : 'Files the agent wrote at the workspace root (state, notes, summaries), not part of a codebase'
          }
          data-testid="changes-workspace-files-toggle"
        >
          {showWorkspaceFiles
            ? 'Hide workspace files'
            : `+${hiddenWorkspaceFiles} workspace ${hiddenWorkspaceFiles === 1 ? 'file' : 'files'}`}
        </Chip>
      ) : null}
      {files > 0 ? (
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon="check"
            loading={bulkBusy === 'keep'}
            disabled={bulkBusy !== null || files === keptCount}
            title="Mark every changed file as reviewed"
            onClick={onKeepAll}
            data-testid="keep-all"
          >
            Keep all
          </Button>
          <Button
            size="sm"
            variant="danger-ghost"
            icon="undo"
            loading={bulkBusy === 'undo'}
            disabled={bulkBusy !== null}
            title="Put every listed file back the way it was at the selected point"
            onClick={onUndoAll}
            data-testid="undo-all"
          >
            Undo all
          </Button>
        </div>
      ) : null}
    </div>
  );
}
