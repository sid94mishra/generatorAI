// ────────────────────────────────────────────────────────────────
// F-dock-01 CompareSegment + "Compare against" (03-domain §3.3; board
// DockChanges "This turn / This chat / Branch vs main").
//
// The segment is the quick switch between the three designed modes, mapped
// onto today's base selectors: This turn = the newest turn (`turn:<id>`),
// This chat = `baseline` ("Since session start"), Branch = the first mount's
// branch base (`ref:<sha>`). The Select beside it is the precise picker —
// every mount's branch base and the last turns / checkpoints (09 §5.3 pins
// it as `Compare against`). When the base is none of the three quick modes,
// no segment is selected. A mode with no data behind it is disabled with the
// reason (D-36).
//
// Under it (when there are changes) the list bar: the "+N workspace files"
// chip and the bulk Keep all / Undo all (D-28).
// ────────────────────────────────────────────────────────────────

import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import type { CompareOption } from './useChangesModel.js';

export type CompareMode = 'turn' | 'chat' | 'branch';

export interface CompareModes {
  /** Selector of the newest turn, if any turn was recorded. */
  turn: string | null;
  /** Selector and label of the first mount's branch base, if known. */
  branch: { value: string; label: string } | null;
}

/** The three quick modes, derived from the full compare list (newest checkpoints first). */
export function compareModesOf(options: readonly CompareOption[]): CompareModes {
  const turn = options.find((o) => o.value.startsWith('turn:'))?.value ?? null;
  const branchOption = options.find((o) => o.value.startsWith('ref:'));
  const ref = branchOption?.label.match(/^Branch base \((.*)\)$/)?.[1];
  return {
    turn,
    branch: branchOption ? { value: branchOption.value, label: ref ? `Branch vs ${ref}` : 'Branch' } : null,
  };
}

export interface CompareBarProps {
  base: string;
  onBaseChange: (base: string) => void;
  options: readonly CompareOption[];
}

export function CompareBar({ base, onBaseChange, options }: CompareBarProps) {
  const modes = compareModesOf(options);
  const current: CompareMode | '' =
    base === 'baseline' ? 'chat' : base === modes.turn ? 'turn' : base === modes.branch?.value ? 'branch' : '';
  const items: SegmentedItem<CompareMode>[] = [
    { value: 'turn', label: 'This turn', disabled: !modes.turn, reason: 'No turn has been recorded yet' },
    { value: 'chat', label: 'This chat' },
    {
      value: 'branch',
      label: modes.branch?.label ?? 'Branch',
      disabled: !modes.branch,
      reason: 'No branch base: the source is not a git branch',
    },
  ];
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-3 py-1.5">
      <SegmentedControl<CompareMode>
        label="Compare"
        value={current as CompareMode}
        items={items}
        onValueChange={(mode) => {
          if (mode === 'chat') onBaseChange('baseline');
          else if (mode === 'turn' && modes.turn) onBaseChange(modes.turn);
          else if (mode === 'branch' && modes.branch) onBaseChange(modes.branch.value);
        }}
      />
      <Select
        size="sm"
        aria-label="Compare against"
        value={base}
        items={options}
        onValueChange={(v) => { if (v !== null) onBaseChange(v as typeof base & string); }}
        className="max-w-60 min-w-32 flex-1"
      />
    </div>
  );
}

export interface ChangesListBarProps {
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

export function ChangesListBar({
  hiddenWorkspaceFiles,
  showWorkspaceFiles,
  onToggleWorkspaceFiles,
  files,
  keptCount,
  bulkBusy,
  onKeepAll,
  onUndoAll,
}: ChangesListBarProps) {
  const chip = hiddenWorkspaceFiles > 0 || showWorkspaceFiles;
  if (!chip && files === 0) return null;
  return (
    <div className="flex h-strip shrink-0 items-center gap-1 border-b border-line-soft px-3">
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
          {/* Keep all accepts every changed file at its current content,
              resolved server-side; Undo all is confirmed first (D-28). */}
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
            title="Restore every changed file to its base revision"
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
