// ────────────────────────────────────────────────────────────────
// F-composer-18 / B-05 — the Sources chip under the box and its popover.
//
// The chip names the primary mount and its branch ("payments-api ·
// fix/checkout-flake"). Opening it lists every mount (alias, Worktree / In
// place, branch, path + copy) with "Edit sources…"; edits go through the
// Edit sources dialog, never the composer. Before the workspace has reported
// its mounts (or when there is none) the chip falls back to what the chat was
// created with — its project codebases and local folders — so it never shows
// an empty control.
// ────────────────────────────────────────────────────────────────

import type { WorkspaceMount } from '@generatorai/shared';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Icon } from '@/ui/icons/Icon.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { cn } from '@/ui/lib/cn.js';

/** A project codebase or local folder the chat was created with (fallback when no mounts are known). */
export interface SourceFallback {
  projectLinked: boolean;
  codebases: Array<{ id: string; alias: string; kind: 'git' | 'folder' }>;
  codebasesLoading: boolean;
  folders: string[];
  /** Linked codebases + local folders with a path. */
  count: number;
}

export interface SourcesChipViewProps {
  /** The workspace's mounts, primary first; empty/undefined until known. */
  mounts: WorkspaceMount[] | undefined;
  projectName?: string | undefined;
  fallback: SourceFallback;
  onEditSources?: (() => void) | undefined;
  onCopyPath?: ((path: string) => void) | undefined;
  disabled?: boolean;
}

const MODE_LABEL: Record<WorkspaceMount['mode'], string> = {
  worktree: 'Worktree',
  'in-place': 'In place',
  generated: 'Generated',
};

export function SourcesChipView({ mounts, projectName, fallback, onEditSources, onCopyPath, disabled }: SourcesChipViewProps) {
  const known = mounts && mounts.length > 0 ? mounts : undefined;
  const primary = known?.[0];
  const label = primary
    ? primary.alias
    : fallback.count > 0
      ? `${fallback.count} Codebase${fallback.count > 1 ? 's' : ''}`
      : 'Codebase';
  const branch = primary?.git?.branch;
  const extra = known && known.length > 1 ? known.length - 1 : 0;

  return (
    <PopoverRoot>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="sm"
            icon="folder-open"
            trailingIcon="chevron-down"
            className="max-w-full gap-1.5 border-line px-2 text-small data-popup-open:bg-selected"
          />
        }
      >
        <span className="inline-flex max-w-full min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium text-fg">{label}</span>
          {branch ? <span className="truncate font-mono text-micro text-fg-3">{branch}</span> : null}
          {extra > 0 ? <span className="text-micro text-fg-3">+{extra}</span> : null}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" className="w-110 max-w-full overflow-hidden">
        <div className="flex h-bar items-center gap-2 border-b border-line-soft bg-sunken px-3">
          <Icon concept="folder-open" size={14} className="text-fg-3" />
          <PopoverTitle className="text-ui font-medium text-fg">Sources</PopoverTitle>
          {known ? (
            <span className="min-w-0 truncate text-small text-fg-3">
              {known.length} mount{known.length > 1 ? 's' : ''}
              {projectName ? ` · ${projectName}` : ''}
            </span>
          ) : null}
          {onEditSources ? (
            <Button size="sm" variant="ghost" icon="settings" onClick={onEditSources} className="ml-auto">
              Edit sources…
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5 p-2">
          {known ? (
            known.map((m) => (
              <div key={m.id} className="flex flex-col gap-0.5 rounded-control border border-line-soft px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon concept={m.mode === 'worktree' ? 'branch' : 'folder-open'} size={14} className="shrink-0 text-fg-3" />
                  <span className="truncate text-ui font-medium text-fg">{m.alias}</span>
                  <span className="shrink-0 rounded-badge bg-sunken px-1.5 text-micro text-fg-2">{MODE_LABEL[m.mode]}</span>
                  {m.git?.branch ? (
                    <span className="flex min-w-0 items-center gap-1 font-mono text-micro text-fg-3">
                      <Icon concept="branch" size={12} />
                      <span className="truncate">{m.git.branch}</span>
                    </span>
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 flex-1 truncate font-mono text-micro text-fg-3">{m.path}</span>
                  {onCopyPath ? (
                    <IconButton icon="copy" size="sm" label={`Copy path of ${m.alias}`} tooltip={false} onClick={() => onCopyPath(m.path)} />
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <FallbackList fallback={fallback} />
          )}
        </div>
        {known ? (
          <p className="border-t border-line-soft px-3 py-2 text-micro text-fg-3">
            Edits apply to the next turn; existing mounts keep their history.
          </p>
        ) : null}
      </PopoverPopup>
    </PopoverRoot>
  );
}

function FallbackList({ fallback }: { fallback: SourceFallback }) {
  return (
    <div className="flex flex-col gap-2 px-1 text-small">
      {fallback.projectLinked ? (
        <div className="flex flex-col gap-1">
          <p className="text-fg-3">Project codebases</p>
          {fallback.codebasesLoading ? (
            <span className="flex items-center gap-1.5 text-fg-3">
              <Spinner size={12} /> Loading…
            </span>
          ) : fallback.codebases.length === 0 ? (
            <p className="text-fg-3">No codebases in project.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {fallback.codebases.map((cb) => (
                <span key={cb.id} className="inline-flex h-control-sm items-center gap-1 rounded-control-sm border border-line px-2 text-fg">
                  <Icon concept={cb.kind === 'folder' ? 'folder-open' : 'branch'} size={12} className="text-fg-3" />
                  {cb.alias}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <p className="text-fg-2">No project linked</p>
          <p className="text-fg-3">Codebases are configured during chat creation.</p>
        </div>
      )}
      {fallback.folders.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-fg-3">Local folders</p>
          {fallback.folders.map((path) => (
            <span key={path} className={cn('truncate rounded-control-sm border border-line-soft px-2 py-1 font-mono text-micro text-fg')}>
              {path}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
