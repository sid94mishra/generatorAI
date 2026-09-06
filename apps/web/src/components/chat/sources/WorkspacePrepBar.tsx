// ────────────────────────────────────────────────────────────────
// WorkspacePrepBar — "the workspace is not ready yet"
// ────────────────────────────────────────────────────────────────
//
// Creating worktrees and checking out branches happens in the background
// after the chat is created, so there is a real window in which the agent
// has nowhere to work. Sending into that window would either fail or, worse,
// run against a half-prepared mount, so Send is held back — but typing is
// not: composing a prompt while the checkout finishes is exactly what a user
// wants to do with those two seconds.
//
// State comes from `chat.workspacePrep`, which the `workspace.prep` SSE event
// invalidates, so this bar clears itself without polling.

import { AlertTriangle, RefreshCw, Settings2 } from 'lucide-react';
import type { WorkspacePrepStatus } from '@generatorai/shared';
import { Button, Spinner } from '@/components/ui/index.js';

export interface WorkspacePrepBarProps {
  status: WorkspacePrepStatus;
  error?: string | undefined;
  /** POST /api/chats/:id/workspace/prepare */
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
  /** Opens the sources editor. */
  onEditSources?: (() => void) | undefined;
}

/** True while the workspace cannot accept a prompt. */
export function isPreparing(status: WorkspacePrepStatus | undefined): boolean {
  return status === 'pending' || status === 'preparing';
}

export function WorkspacePrepBar({
  status,
  error,
  onRetry,
  retrying = false,
  onEditSources,
}: WorkspacePrepBarProps) {
  if (status === 'ready') return null;

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="mb-2 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-muted px-3 py-2"
        data-testid="workspace-prep-error"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
        <span className="min-w-0 flex-1 text-xs text-foreground">
          <span className="font-medium text-danger">Workspace preparation failed.</span>{' '}
          {error ?? 'One of this chat’s sources could not be prepared.'}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {onRetry && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRetry}
              loading={retrying}
              className="h-6 px-2 text-[11px]"
              leftIcon={<RefreshCw className="h-3 w-3" />}
            >
              Retry
            </Button>
          )}
          {onEditSources && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onEditSources}
              className="h-6 px-2 text-[11px]"
              leftIcon={<Settings2 className="h-3 w-3" />}
            >
              Edit sources
            </Button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-2 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2"
      data-testid="workspace-prep-bar"
    >
      <Spinner size="xs" />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
        Preparing workspace… creating worktrees and checking out branches
      </span>
    </div>
  );
}
