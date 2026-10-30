// ────────────────────────────────────────────────────────────────
// Codebase parts shared by ProjectDetail's Codebases tab and CodebaseDetail
// (P5-04, P5-05): the status badge, the live codebase list (G-16 polling +
// completion toasts) and the Logs dialog (G-16 ring buffer + current job).
// ────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CodebaseJob, CodebaseStatus, ProjectCodebase } from '@generatorai/shared';
import { useCodebaseLogs, useFetchCodebase, useProjectCodebases } from '@/hooks/projectQueries.js';
import { Badge, type BadgeTone } from '@/ui/primitives/Badge/Badge.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { codebaseStatusView, formatDuration, isCodebaseBusy } from './projectFormat.js';

const TONE_BADGE: Record<'ok' | 'warn' | 'err' | 'idle', BadgeTone> = { ok: 'ok', warn: 'warn', err: 'err', idle: 'neutral' };

/** Ready / Fetching / Cloning / Stale / Error for one codebase. */
export function CodebaseStatusBadge({ codebase }: { codebase: Pick<ProjectCodebase, 'status' | 'lastFetchedAt'> }) {
  const view = codebaseStatusView(codebase);
  if (view.tone === 'run') return <StatusBadge state="running" label={view.label} />;
  return <Badge tone={TONE_BADGE[view.tone]}>{view.label}</Badge>;
}

/**
 * A project's codebases, polled every 3 s while any clone/fetch runs (G-16),
 * with a completion toast when one lands (D-30: background completions and
 * errors only).
 */
export function useLiveCodebases(projectId: string | undefined) {
  const [live, setLive] = useState(false);
  const query = useProjectCodebases(projectId, { refetchInterval: live ? 3000 : false });
  const previous = useRef(new Map<string, CodebaseStatus>());
  useEffect(() => {
    const codebases = query.data;
    if (!codebases) return;
    setLive(codebases.some((cb) => isCodebaseBusy(cb.status)));
    for (const cb of codebases) {
      const before = previous.current.get(cb.id);
      if (before && isCodebaseBusy(before) && !isCodebaseBusy(cb.status)) {
        if (cb.status === 'error') {
          toast.error(`“${cb.alias}” failed`, { description: 'The git operation did not finish.', ...(cb.lastError ? { logs: cb.lastError } : {}) });
        } else {
          toast.done(`“${cb.alias}” is ready`);
        }
      }
      previous.current.set(cb.id, cb.status);
    }
  }, [query.data]);
  return query;
}

/** Fetch with the standard error toast; the job's progress shows in Logs. */
export function useFetchCodebaseAction(projectId: string | undefined) {
  const fetchCodebase = useFetchCodebase();
  const run = (codebase: ProjectCodebase) => {
    if (!projectId) return;
    fetchCodebase.mutate(
      { projectId, codebaseId: codebase.id },
      {
        onError: (err) =>
          toast.error(`Couldn't fetch “${codebase.alias}”`, { description: err instanceof Error ? err.message : String(err) }),
      },
    );
  };
  return { run, pendingId: fetchCodebase.isPending ? fetchCodebase.variables?.codebaseId : undefined };
}

const JOB_STATE = {
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
} as const satisfies Record<CodebaseJob['status'], 'running' | 'succeeded' | 'failed'>;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export interface CodebaseLogsDialogProps {
  projectId: string | undefined;
  codebase: ProjectCodebase | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** G-16 Logs: the codebase's clone/fetch output tail and the current job. */
export function CodebaseLogsDialog({ projectId, codebase, open, onOpenChange }: CodebaseLogsDialogProps) {
  const busy = codebase ? isCodebaseBusy(codebase.status) : false;
  const logs = useCodebaseLogs(open ? projectId : undefined, open ? codebase?.id : undefined, { limit: 500, isLive: busy });
  const job = logs.data?.job;
  const lines = logs.data?.lines ?? [];
  const scroller = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const elapsed = job ? (job.endedAt ? new Date(job.endedAt).getTime() : Date.now()) - new Date(job.startedAt).getTime() : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={codebase ? `Logs · ${codebase.alias}` : 'Logs'}
      badge={job ? <StatusBadge state={JOB_STATE[job.status]} label={job.status === 'running' ? (job.kind === 'fetch' ? 'Fetching' : 'Cloning') : undefined} /> : undefined}
      data-testid="codebase-logs"
    >
      <DialogBody className="gap-3">
        {job ? (
          <p className="font-mono text-micro text-fg-3">
            {job.kind} · started {timeOf(job.startedAt)} · {formatDuration(elapsed)}
          </p>
        ) : null}
        {job?.error ? (
          <Callout tone="err" title="The last job failed">
            {job.error}
          </Callout>
        ) : !job && codebase?.lastError ? (
          <Callout tone="err" title="Last error">
            {codebase.lastError}
          </Callout>
        ) : null}
        {logs.isError ? (
          <EmptyState tone="error" icon="warning" title="Couldn't load the logs" description={String(logs.error)} />
        ) : lines.length === 0 ? (
          <EmptyState
            framed
            icon="terminal"
            title={logs.isLoading ? 'Loading logs…' : job && job.status !== 'running' ? 'No output' : 'No output yet'}
            description={
              logs.isLoading
                ? undefined
                : job && job.status !== 'running'
                  ? `The last ${job.kind} finished without printing anything.`
                  : 'Clone and fetch output appears here while a job runs (kept until the server restarts).'
            }
          />
        ) : (
          <div
            ref={scroller}
            className="min-h-0 flex-1 overflow-auto rounded-card border border-line-soft bg-sunken px-3 py-2.5 font-mono text-small"
            role="log"
            aria-label="Git output"
          >
            {lines.map((line, i) => (
              <div key={i} className="flex gap-3 whitespace-pre-wrap">
                <span className="shrink-0 text-fg-3">{timeOf(line.ts)}</span>
                <span className={line.stream === 'stderr' ? 'text-fg-2' : 'text-fg'}>{line.text}</span>
              </div>
            ))}
          </div>
        )}
      </DialogBody>
      <DialogFooter hint={busy ? 'The job keeps running if you close this dialog.' : undefined}>
        <Button onClick={() => onOpenChange(false)}>Close</Button>
      </DialogFooter>
    </Dialog>
  );
}
