// ────────────────────────────────────────────────────────────────
// ProjectPullRequestsTab — every open PR across a project's codebases.
//
// A project is several repos; asking "what is in flight here?" should not
// mean opening four GitHub tabs. Codebases that could NOT be listed are
// shown too, muted, with the server's reason — a silently short list is
// indistinguishable from "nothing in flight", which is the one wrong
// answer this tab can give.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, GitPullRequest, Github } from 'lucide-react';
import { useProjectPullRequests } from '@/hooks/queries.js';
import { Badge, Spinner, Tabs, type BadgeTone } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import type { ScmPullRequestState } from '@generatorai/shared';

type StateFilter = 'open' | 'closed' | 'all';

const STATE_TONE: Record<ScmPullRequestState, BadgeTone> = {
  open: 'success',
  merged: 'primary',
  closed: 'danger',
};

/** True when the reason is the one thing Settings can fix. */
export function isConnectReason(reason: string): boolean {
  return /not connected|connect it in settings|no account/i.test(reason);
}

export function ProjectPullRequestsTab({ projectId }: { projectId: string | undefined }) {
  const [state, setState] = useState<StateFilter>('open');
  const { data, isLoading, error } = useProjectPullRequests(projectId, state);
  const navigate = useNavigate();

  return (
    <div className="space-y-3" data-testid="project-pull-requests">
      <Tabs<StateFilter>
        items={[
          { id: 'open', label: 'Open' },
          { id: 'closed', label: 'Closed' },
          { id: 'all', label: 'All' },
        ]}
        value={state}
        onChange={setState}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner size="sm" /> Loading pull requests…
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted px-3.5 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{(error as Error).message}</span>
        </div>
      ) : (
        <>
          {(data?.items.length ?? 0) === 0 ? (
            <p className="py-6 text-sm text-muted-foreground" data-testid="pr-empty">
              No {state === 'all' ? '' : state} pull requests across this project&rsquo;s codebases.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {data!.items.map((pr) => (
                <li key={`${pr.codebaseId}#${pr.number}`}>
                  <button
                    type="button"
                    data-testid="pr-row"
                    onClick={() =>
                      navigate(
                        `/projects/${projectId}/codebases/${pr.codebaseId}/pull-requests/${pr.number}`,
                      )
                    }
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-subtle"
                  >
                    <GitPullRequest
                      className={cn(
                        'h-4 w-4 shrink-0',
                        pr.state === 'open' ? 'text-success' : 'text-muted-foreground',
                      )}
                    />
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      #{pr.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{pr.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {pr.codebaseAlias} · <span className="font-mono">{pr.head} → {pr.base}</span>
                        {pr.author ? ` · ${pr.author}` : ''}
                      </span>
                    </span>
                    {pr.draft && <Badge tone="neutral" size="sm">Draft</Badge>}
                    <Badge tone={STATE_TONE[pr.state]} size="sm" className="capitalize">
                      {pr.state}
                    </Badge>
                    {pr.updatedAt && (
                      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                        {new Date(pr.updatedAt).toLocaleDateString()}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(data?.unavailable.length ?? 0) > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-dashed border-border" data-testid="pr-unavailable">
              {data!.unavailable.map((entry) => (
                <li
                  key={entry.codebaseId}
                  className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-xs text-muted-foreground"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                  <span className="font-medium text-foreground">{entry.alias}</span>
                  <span className="min-w-0 flex-1">{entry.reason}</span>
                  {isConnectReason(entry.reason) && (
                    <Link
                      to="/settings/source-control"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-subtle"
                      data-testid="pr-connect-github"
                    >
                      <Github className="h-3 w-3" /> Connect GitHub
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
