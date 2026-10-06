// ────────────────────────────────────────────────────────────────
// One project codebase a run mounts: the mount checkbox, the branch or ref it
// is cut from (the codebase's branches offered as suggestions) and, where the
// caller allows it, the checkout mode. Shared by the Run dialog and the
// automation wizard (D-103), so it lives in blocks/ (query-aware: branches).
// ────────────────────────────────────────────────────────────────

import type { CodebaseDraft } from '@generatorai/client-core';
import type { ProjectCodebase } from '@generatorai/shared';
import { useCodebaseBranches } from '@/hooks/projectQueries.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';

export function CodebaseMountRow({
  projectId,
  draft,
  codebase,
  onChange,
  showMode = true,
}: {
  projectId: string;
  draft: CodebaseDraft;
  codebase: ProjectCodebase | undefined;
  onChange: (patch: Partial<CodebaseDraft>) => void;
  /** Offer Worktree / In place. Off where only a worktree is possible (an unattended automation run). */
  showMode?: boolean;
}) {
  // Branches are listed only for a codebase that is mounted.
  const { data: branches } = useCodebaseBranches(projectId, draft.selected ? codebase?.id : undefined);
  const listId = `codebase-branches-${draft.alias}`;
  return (
    <div role="listitem" className="flex items-center gap-3 border-b border-line-soft py-2 last:border-b-0">
      <Checkbox checked={draft.selected} onCheckedChange={(selected) => onChange({ selected })} aria-label={`Mount ${draft.alias}`} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-mono text-ui text-fg">{draft.alias}</span>
        {codebase ? <span className="truncate text-small text-fg-3">{codebase.url ?? codebase.localPath}</span> : null}
      </div>
      <Input
        size="sm"
        leading="branch"
        value={draft.baseRef}
        onChange={(e) => onChange({ baseRef: e.target.value })}
        disabled={!draft.selected}
        placeholder={codebase?.defaultBranch ?? 'default branch'}
        aria-label={`${draft.alias} branch`}
        list={listId}
        className="w-40"
      />
      <datalist id={listId}>
        {(branches ?? []).map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      {showMode ? (
        <SegmentedControl<CodebaseDraft['mode']>
          value={draft.mode}
          onValueChange={(mode) => onChange({ mode })}
          label={`${draft.alias} checkout`}
          size="sm"
          items={[
            { value: 'worktree', label: 'Worktree', disabled: !draft.selected },
            { value: 'in_place', label: 'In place', disabled: !draft.selected },
          ]}
        />
      ) : null}
    </div>
  );
}
