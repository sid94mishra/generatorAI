// ────────────────────────────────────────────────────────────────
// F-dock-01 repository groups — with more than one repository (several
// mounts, or repositories inside one), one group per repository naming it,
// its branch and its ±; a click jumps to its first file (03-domain §6.3
// `MountGroupsBar`). Each repository is committed on its own, so a group can
// carry its own next step (Commit · Push · Pull request), and a folder that
// is no repository says why it has none. Pure view.
// ────────────────────────────────────────────────────────────────

import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';

export interface MountGroup {
  alias: string;
  stats: { files: number; additions: number; deletions: number };
  /** Diff source id of the group's first file (null = nothing to jump to). */
  firstId: string | null;
  /** The mount's absolute path (tooltip) and branch, when known. */
  path?: string;
  branch?: string;
  /** This repository's own next source-control step. */
  action?: { label: string; onClick: () => void };
  /** Why there is no step, when that needs saying ("not a git repository"). */
  note?: string;
}

export interface MountGroupsBarProps {
  groups: readonly MountGroup[];
  onJump: (firstId: string) => void;
}

export function MountGroupsBar({ groups, onJump }: MountGroupsBarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line-soft px-3 py-1.5" data-testid="mount-groups">
      {groups.map((group) => {
        const name = group.alias === '.' ? 'workspace' : group.alias;
        return (
          <span key={group.alias} className="inline-flex items-center gap-0.5" data-testid="mount-group" data-alias={group.alias}>
            <Button
              size="sm"
              variant="secondary"
              disabled={!group.firstId}
              title={group.path ?? group.alias}
              onClick={() => {
                if (group.firstId) onJump(group.firstId);
              }}
            >
              <span className="flex items-center gap-1.5">
                <span className="text-fg">{name}</span>
                {group.branch ? (
                  <span className="inline-flex items-center gap-0.5 font-mono text-micro font-normal text-fg-3">
                    <Icon concept="branch" size={12} />
                    {group.branch}
                  </span>
                ) : null}
                <span className="font-normal text-fg-3">
                  {group.stats.files} {group.stats.files === 1 ? 'file' : 'files'}
                </span>
                <DiffStat added={group.stats.additions} removed={group.stats.deletions} />
                {group.note ? <span className="font-normal text-fg-3">· {group.note}</span> : null}
              </span>
            </Button>
            {group.action ? (
              <Button size="sm" variant="ghost" icon="commit" onClick={group.action.onClick} aria-label={`${group.action.label} ${name}`} data-testid="mount-group-ship">
                {group.action.label}
              </Button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
