// ────────────────────────────────────────────────────────────────
// F-composer-18 / B-05 — the Sources chip under the box and its popover.
//
// The chip names what the agent works in (D-135, via client-core
// `describeMount`): the primary mount and its branch ("payments-api ·
// fix/checkout-flake"), a plain folder by its name alone, and a chat with no
// sources as "Empty workspace" — never the managed folder's alias "main" or
// its `git init` branch. Opening it lists every mount (name, In place /
// Worktree, branch, the user's own folder + copy) with "Edit sources…"; a
// managed path (the empty workspace, a worktree checkout) is never shown as
// the user's folder. Edits go through the Edit sources dialog, never the
// composer. Before the workspace has reported its mounts the chip falls back
// to what the chat was created with.
//
// Chrome: P-09 Chip `dropdown` (Rosetta `.chip` + chevron), like the
// Skills · MCP chip beside it. The popover is ONE `overlay` surface (D-138):
// header, source rows and footer share its background and are split by `line`
// rules — no sunken header band, no boxed cards inside the box.
// ────────────────────────────────────────────────────────────────

import type { WorkspaceMount } from '@generatorai/shared';
import { describeMount, EMPTY_WORKSPACE_LABEL, pathTail, type MountDisplay } from '@generatorai/client-core';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Icon } from '@/ui/icons/Icon.js';
import type { IconConcept } from '@/ui/icons/index.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { PopoverClose, PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { cn } from '@/ui/lib/cn.js';

/** What the chat was created with (shown until the workspace reports its mounts). */
export interface SourceFallback {
  projectLinked: boolean;
  codebases: Array<{ id: string; alias: string; kind: 'git' | 'folder' }>;
  codebasesLoading: boolean;
  folders: string[];
  /** Sources the chat asked for (codebases + local folders). */
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

const KIND_ICON: Record<MountDisplay['kind'], IconConcept> = {
  empty: 'folder-open',
  chat: 'folder-open',
  folder: 'folder-open',
  repo: 'folder-open',
  worktree: 'branch',
};

export function SourcesChipView({ mounts, projectName, fallback, onEditSources, onCopyPath, disabled }: SourcesChipViewProps) {
  const known = mounts && mounts.length > 0 ? mounts.map((m) => ({ mount: m, display: describeMount(m) })) : undefined;
  const primary = known?.[0]?.display;
  const empty = primary ? primary.kind === 'empty' : fallback.count === 0 && !fallback.projectLinked;
  const label = primary
    ? primary.label
    : empty
      ? EMPTY_WORKSPACE_LABEL
      : fallback.count > 0
        ? `${fallback.count} source${fallback.count > 1 ? 's' : ''}`
        : 'Sources';
  const extra = known && known.length > 1 ? known.length - 1 : 0;

  return (
    <PopoverRoot>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Chip dropdown icon={primary ? KIND_ICON[primary.kind] : 'folder-open'} data-testid="composer-sources-chip">
            <span className="inline-flex max-w-full min-w-0 items-baseline gap-1.5">
              <span className={cn('truncate', empty ? 'text-fg-2' : 'text-fg')}>{label}</span>
              {primary?.branch ? <span className="truncate font-mono text-micro text-fg-3">{primary.branch}</span> : null}
              {extra > 0 ? <span className="text-fg-3">+{extra}</span> : null}
            </span>
          </Chip>
        }
      />
      <PopoverPopup side="top" align="start" className="w-110 max-w-full overflow-hidden">
        <div className="flex h-bar items-center gap-2 border-b border-line px-3">
          <Icon concept="folder-open" size={14} className="text-fg-3" />
          <PopoverTitle className="text-ui font-semibold text-fg">Sources</PopoverTitle>
          {known && !empty ? (
            <span className="min-w-0 truncate font-mono text-micro text-fg-3">
              {known.length} source{known.length > 1 ? 's' : ''}
              {projectName ? ` · ${projectName}` : ''}
            </span>
          ) : null}
          {onEditSources ? (
            // Closes the popover as the dialog opens; it used to stay on top of it.
            <PopoverClose
              render={<Button size="sm" variant="ghost" icon="settings" className="ml-auto" />}
              onClick={onEditSources}
            >
              Edit sources…
            </PopoverClose>
          ) : null}
        </div>
        <div className="flex flex-col">
          {known ? (
            known.map(({ mount, display }) => (
              <MountCard key={mount.id} display={display} onCopyPath={onCopyPath} />
            ))
          ) : (
            <FallbackList fallback={fallback} />
          )}
        </div>
        <p className="border-t border-line px-3 py-2 text-micro text-fg-3">Changes take effect from your next message.</p>
      </PopoverPopup>
    </PopoverRoot>
  );
}

/** One mount: name, mode, branch, then the user's folder (or what the agent works in). */
function MountCard({ display, onCopyPath }: { display: MountDisplay; onCopyPath?: ((path: string) => void) | undefined }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line px-3 py-2 first:border-t-0" data-testid="composer-source-mount">
      <div className="flex h-badge min-w-0 items-center gap-2">
        <Icon concept={KIND_ICON[display.kind]} size={14} className="shrink-0 text-fg-3" />
        <span className={cn('truncate text-ui font-medium', display.kind === 'empty' ? 'text-fg-2' : 'text-fg')}>{display.label}</span>
        {display.modeLabel ? (
          <Badge size="sm" className="shrink-0">
            {display.modeLabel}
          </Badge>
        ) : null}
        {display.branch ? (
          <span className="flex min-w-0 items-center gap-1 text-fg-2">
            <Icon concept="branch" size={12} className="shrink-0" />
            <span className="truncate font-mono text-micro">{display.branch}</span>
          </span>
        ) : null}
      </div>
      {display.userPath ? (
        <div className="flex min-w-0 items-center gap-1.5 pl-5.5">
          {display.kind === 'worktree' ? <span className="shrink-0 text-micro text-fg-3">from</span> : null}
          <span className="min-w-0 flex-1 truncate font-mono text-micro text-fg-3" title={display.userPath}>
            {pathTail(display.userPath, display.kind === 'worktree' ? 44 : 50)}
          </span>
          {onCopyPath ? (
            <IconButton
              icon="copy"
              size="sm"
              label={`Copy path of ${display.label}`}
              tooltip={false}
              onClick={() => onCopyPath(display.userPath!)}
            />
          ) : null}
        </div>
      ) : (
        <p className="pl-5.5 text-small text-fg-3">{display.detail}</p>
      )}
    </div>
  );
}

function FallbackList({ fallback }: { fallback: SourceFallback }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-2 text-small">
      {fallback.projectLinked ? (
        <div className="flex flex-col gap-1">
          <p className="text-fg-3">Project codebases</p>
          {fallback.codebasesLoading ? (
            <span className="flex items-center gap-1.5 text-fg-3">
              <Spinner size={12} /> Loading…
            </span>
          ) : fallback.codebases.length === 0 ? (
            <p className="text-fg-3">This project has no codebases yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {fallback.codebases.map((cb) => (
                <Chip key={cb.id} icon={cb.kind === 'folder' ? 'folder-open' : 'branch'}>
                  {cb.alias}
                </Chip>
              ))}
            </div>
          )}
        </div>
      ) : fallback.count === 0 ? (
        <p className="text-fg-3">Nothing linked yet. The agent works in an empty folder of its own.</p>
      ) : (
        <p className="text-fg-2">No project linked</p>
      )}
      {fallback.folders.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-fg-3">Local folders</p>
          {fallback.folders.map((path) => (
            <span key={path} className="truncate rounded-control-sm border border-line px-2 py-1 font-mono text-micro text-fg" title={path}>
              {path}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
