// ────────────────────────────────────────────────────────────────
// SourcesBlock — the chat's mounts, at a glance (B-05).
//
// One row per mount: what it is called, how it was materialised, which
// branch it sits on and where it lives on disk. This is the answer to "where
// is the agent actually writing?", which before the mount rewrite could only
// be inferred from the shape of a path in the Changes tab.
//
// Rendered above the Files tree (FilesPanel's `sources` slot), so the tree's
// sections and this list read as the same set of things. Restyled onto the
// kit from the legacy `components/chat/sources/SourcesPanel`; the mount-card
// idiom follows the composer's SourcesChip popover.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { WorkspaceMount } from '@generatorai/shared';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { cn } from '@/ui/lib/cn.js';

const MODE_LABEL: Record<string, string> = {
  'in-place': 'In place',
  worktree: 'Worktree',
  generated: 'Generated',
};

export interface SourcesBlockProps {
  workspaceId: string | undefined;
  /**
   * Opens the source editor. Omitted on surfaces that cannot edit (a run's
   * workspace, or a chat whose page does not host the dialog), which hides
   * the action rather than offering one that does nothing.
   */
  onEditSources?: (() => void) | undefined;
  /** Renders the list without the outer card border (inside a panel). */
  embedded?: boolean;
  className?: string;
}

export function SourcesBlock({ workspaceId, onEditSources, embedded = false, className }: SourcesBlockProps) {
  const { data, isLoading } = useWorkspaceInfo(workspaceId);
  const [open, setOpen] = useState(true);

  const mounts = (data?.mounts ?? []).filter((m) => m.status !== 'removed');

  return (
    <div
      className={cn('text-small', !embedded && 'rounded-card border border-line-soft', className)}
      data-testid="sources-panel"
    >
      <div className="flex items-center gap-1.5 border-b border-line-soft px-2 py-1.5">
        <IconButton
          icon={open ? 'chevron-down' : 'chevron-right'}
          label={open ? 'Hide sources' : 'Show sources'}
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          tooltip={false}
        />
        <Icon concept="folder-open" size={14} className="text-fg-3" />
        <span className="font-medium text-fg">Sources</span>
        <span className="text-micro text-fg-3">
          {mounts.length} {mounts.length === 1 ? 'mount' : 'mounts'}
        </span>
        {onEditSources && (
          <Button type="button" variant="ghost" size="sm" icon="settings" className="ml-auto" onClick={onEditSources}>
            Edit sources…
          </Button>
        )}
      </div>

      {open && (
        <div className="p-1.5">
          {isLoading ? (
            <div className="flex items-center gap-2 px-1.5 py-2 text-fg-3">
              <Spinner size={12} /> Loading sources…
            </div>
          ) : mounts.length === 0 ? (
            <p className="px-1.5 py-2 text-fg-3">
              No sources — the agent works in a managed scratch workspace.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {mounts.map((mount, i) => (
                <li key={mount.id || mount.alias}>
                  <MountRow mount={mount} primary={i === 0} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MountRow({ mount, primary }: { mount: WorkspaceMount; primary: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(mount.path).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => undefined,
    );
  };

  return (
    <div className="rounded-control border border-line-soft px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-medium text-fg" title={mount.alias}>
          {mount.alias}
        </span>
        {primary && (
          <Tooltip content="The agent's working directory">
            <span className="inline-flex items-center text-fg" aria-label="Working directory">
              <Icon concept="home" size={12} />
            </span>
          </Tooltip>
        )}
        <Badge tone="neutral">{MODE_LABEL[mount.mode] ?? mount.mode}</Badge>
        {mount.git?.branch && (
          <span
            className="inline-flex min-w-0 items-center gap-1 text-micro text-fg-3"
            title={mount.git.baseRef ? `${mount.git.branch} (from ${mount.git.baseRef})` : mount.git.branch}
          >
            <Icon concept="branch" size={12} className="shrink-0" />
            <span className="truncate">{mount.git.branch}</span>
          </span>
        )}
        {mount.hasUncommittedChanges && (
          <Tooltip content="Uncommitted changes in this mount">
            <span
              className="size-1.5 shrink-0 rounded-full bg-warn"
              aria-label="Uncommitted changes"
              data-testid="mount-dirty"
            />
          </Tooltip>
        )}
        <StatusChip status={mount.status} error={mount.error} />
      </div>

      <div className="mt-1 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-fg-3" title={mount.path}>
          {mount.path}
        </span>
        <IconButton
          icon={copied ? 'check' : 'copy'}
          label={`Copy path of ${mount.alias}`}
          size="sm"
          tooltip="Copy path"
          onClick={copy}
        />
      </div>

      {mount.status === 'error' && mount.error && (
        <p className="mt-1 flex items-start gap-1 text-micro text-err">
          <Icon concept="warning" size={12} className="mt-px shrink-0" />
          <span>{mount.error}</span>
        </p>
      )}
    </div>
  );
}

function StatusChip({ status, error }: { status: string; error?: string | undefined }) {
  if (status === 'ready') {
    return (
      <Badge tone="ok" className="ml-auto shrink-0">
        Ready
      </Badge>
    );
  }
  if (status === 'preparing') {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-micro text-fg-3">
        <Spinner size={12} /> Preparing
      </span>
    );
  }
  return (
    <Badge tone="err" className="ml-auto shrink-0" title={error}>
      Error
    </Badge>
  );
}
