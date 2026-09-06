// ────────────────────────────────────────────────────────────────
// SourcesPanel — the chat's mounts, at a glance
// ────────────────────────────────────────────────────────────────
//
// One row per mount: what it is called, how it was materialised, which
// branch it sits on and where it lives on disk. This is the answer to "where
// is the agent actually writing?", which before the mount rewrite could only
// be inferred from the shape of a path in the Changes tab.
//
// Rendered above the Files tree, so the tree's sections and this list read as
// the same set of things.

import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderGit2,
  GitBranch,
  Home,
  Settings2,
} from 'lucide-react';
import type { WorkspaceMount } from '@generatorai/shared';
import { Badge, Button, Spinner, Tooltip } from '@/components/ui/index.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { cn } from '@/lib/utils.js';

const MODE_LABEL: Record<string, string> = {
  'in-place': 'In place',
  worktree: 'Worktree',
  generated: 'Generated',
};

export interface SourcesPanelProps {
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

export function SourcesPanel({
  workspaceId,
  onEditSources,
  embedded = false,
  className,
}: SourcesPanelProps) {
  const { data, isLoading } = useWorkspaceInfo(workspaceId);
  const [open, setOpen] = useState(true);

  const mounts = (data?.mounts ?? []).filter((m) => m.status !== 'removed');

  return (
    <div
      className={cn(
        'text-xs',
        !embedded && 'rounded-lg border border-border',
        className,
      )}
      data-testid="sources-panel"
    >
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-5 w-5"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Hide sources' : 'Show sources'}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </Button>
        <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">Sources</span>
        <span className="text-[10px] text-muted-foreground">
          {mounts.length} {mounts.length === 1 ? 'mount' : 'mounts'}
        </span>
        {onEditSources && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-5 gap-1 px-1.5 text-[10px]"
            onClick={onEditSources}
            leftIcon={<Settings2 className="h-3 w-3" />}
          >
            Edit sources…
          </Button>
        )}
      </div>

      {open && (
        <div className="p-1.5">
          {isLoading ? (
            <div className="flex items-center gap-2 px-1.5 py-2 text-muted-foreground">
              <Spinner size="xs" /> Loading sources…
            </div>
          ) : mounts.length === 0 ? (
            <p className="px-1.5 py-2 text-muted-foreground">
              No sources — the agent works in a managed scratch workspace.
            </p>
          ) : (
            <ul className="space-y-1">
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
    <div className="rounded-md border border-border px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-medium text-foreground" title={mount.alias}>
          {mount.alias}
        </span>
        {primary && (
          <Tooltip content="The agent's working directory">
            <span className="inline-flex items-center text-primary" aria-label="Working directory">
              <Home className="h-3 w-3" />
            </span>
          </Tooltip>
        )}
        <Badge tone="neutral" size="sm">
          {MODE_LABEL[mount.mode] ?? mount.mode}
        </Badge>
        {mount.git?.branch && (
          <span
            className="inline-flex min-w-0 items-center gap-1 text-[10.5px] text-muted-foreground"
            title={
              mount.git.baseRef
                ? `${mount.git.branch} (from ${mount.git.baseRef})`
                : mount.git.branch
            }
          >
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">{mount.git.branch}</span>
          </span>
        )}
        {mount.hasUncommittedChanges && (
          <Tooltip content="Uncommitted changes in this mount">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
              aria-label="Uncommitted changes"
              data-testid="mount-dirty"
            />
          </Tooltip>
        )}
        <StatusChip status={mount.status} error={mount.error} />
      </div>

      <div className="mt-1 flex items-center gap-1">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground"
          title={mount.path}
        >
          {mount.path}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-4 w-4 shrink-0"
          onClick={copy}
          title="Copy path"
          aria-label={`Copy path of ${mount.alias}`}
        >
          {copied ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
        </Button>
      </div>

      {mount.status === 'error' && mount.error && (
        <p className="mt-1 flex items-start gap-1 text-[10.5px] text-danger">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>{mount.error}</span>
        </p>
      )}
    </div>
  );
}

function StatusChip({ status, error }: { status: string; error?: string | undefined }) {
  if (status === 'ready') {
    return (
      <Badge tone="success" size="sm" className="ml-auto shrink-0">
        Ready
      </Badge>
    );
  }
  if (status === 'preparing') {
    return (
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
        <Spinner size="xs" /> Preparing
      </span>
    );
  }
  return (
    <Badge tone="danger" size="sm" className="ml-auto shrink-0" title={error}>
      Error
    </Badge>
  );
}
