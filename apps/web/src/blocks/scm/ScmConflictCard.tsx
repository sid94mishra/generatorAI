// ────────────────────────────────────────────────────────────────
// ScmConflictCard — the conflict card's view (ScmConflictActions wires it).
//
// A conflict is reported with the working tree UNTOUCHED (the flow dry-runs
// the merge), so the options are genuinely different decisions:
//   Resolve manually → apply the merge, edit the files, Continue
//   Ask the agent    → apply the merge and hand the files to this chat's agent
//                      as a normal, watchable turn; the user still Continues
//   Abort            → `git merge --abort`, nothing changed
// ────────────────────────────────────────────────────────────────

import type { ScmConflictReport } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

/** idle: choose · manual/agent: the merge is applied, Continue or Abort · resolved: Continue succeeded. */
export type ScmConflictMode = 'idle' | 'manual' | 'agent' | 'resolved';

export interface ScmConflictCardProps {
  conflicts: ScmConflictReport;
  mode: ScmConflictMode;
  /** A conflict action is in flight. */
  busy?: boolean;
  /** The last action's failure (unresolved paths, server error). */
  error?: string | null;
  /** Offers "Ask the agent" — only where a chat is in scope. */
  canAskAgent?: boolean;
  onResolveManually?: () => void;
  onAskAgent?: () => void;
  onContinue?: () => void;
  onAbort?: () => void;
  /** Opens one conflicted file in the user's editor, when that is possible. */
  onOpenFile?: (path: string) => void;
  className?: string;
}

export function ScmConflictCard({
  conflicts,
  mode,
  busy = false,
  error,
  canAskAgent = false,
  onResolveManually,
  onAskAgent,
  onContinue,
  onAbort,
  onOpenFile,
  className,
}: ScmConflictCardProps) {
  const fileCount = conflicts.files.length;
  const mergeApplied = mode === 'manual' || mode === 'agent';
  const abort = (
    <Button variant="danger-ghost" size="sm" icon="x" disabled={busy} data-testid="scm-conflict-abort" onClick={onAbort}>
      Abort
    </Button>
  );

  return (
    <Callout
      tone="warn"
      className={className}
      data-testid="scm-conflict-card"
      title={
        <>
          Merging <span className="font-mono text-small">{conflicts.base}</span> into{' '}
          <span className="font-mono text-small">{conflicts.head}</span> conflicts
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-2">
        <p>
          {fileCount} {fileCount === 1 ? 'file' : 'files'} need a decision before this branch can be pushed.
        </p>

        <ul className="flex min-w-0 flex-col gap-0.5" data-testid="scm-conflict-files">
          {conflicts.files.map((file) => (
            <li key={file} className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate font-mono text-small text-fg">{file}</span>
              {onOpenFile && mergeApplied ? (
                <Button variant="ghost" size="sm" onClick={() => onOpenFile(file)}>
                  Open in editor
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {mode === 'idle' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" icon="edit" disabled={busy} data-testid="scm-conflict-manual" onClick={onResolveManually}>
              Resolve manually
            </Button>
            {canAskAgent ? (
              <Button size="sm" icon="agents" disabled={busy} data-testid="scm-conflict-agent" onClick={onAskAgent}>
                Ask the agent
              </Button>
            ) : null}
            {abort}
            {busy ? <Spinner size={14} label="Working" /> : null}
          </div>
        ) : mode === 'resolved' ? (
          <p role="status" className="flex items-center gap-1.5">
            <Icon concept="status-succeeded" size={14} className="text-ok" />
            Merge resolved.
          </p>
        ) : (
          <>
            <p data-testid="scm-conflict-instructions">
              {mode === 'agent'
                ? 'The agent is resolving the conflicts in this chat. Review the files, then Continue.'
                : 'The merge is applied to the working tree with conflict markers. Edit the files above, then Continue.'}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="primary"
                size="sm"
                icon="play"
                loading={busy}
                data-testid="scm-conflict-continue"
                onClick={onContinue}
              >
                Continue
              </Button>
              {abort}
            </div>
          </>
        )}

        {error ? (
          <p role="alert" className="text-err" data-testid="scm-conflict-error">
            {error}
          </p>
        ) : null}
      </div>
    </Callout>
  );
}
