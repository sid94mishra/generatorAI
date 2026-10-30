// ────────────────────────────────────────────────────────────────
// StageEventsTab — the raw event log of one stage instance (P07 WP-7.6):
// every run-scope event whose payload names the instance (`stageRunId`),
// oldest first, with its kind, time and JSON payload. It reads the run
// scope's replay (the same log the run page rebuilds itself from) once,
// when the tab opens; "Refresh" reads it again.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useStageEvents } from '@/hooks/workflowRunInspectorQueries.js';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { Collapsible } from '@/ui/primitives/Collapsible/Collapsible.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

export function StageEventsTab({ runId, stageRunId }: { runId: string; stageRunId: string }) {
  const [kindFilter, setKindFilter] = useState('');
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const { data, isLoading, isFetching, error, refetch } = useStageEvents(runId, stageRunId);

  const events = useMemo(() => {
    const f = kindFilter.trim().toLowerCase();
    return f ? (data ?? []).filter((e) => e.kind.toLowerCase().includes(f)) : (data ?? []);
  }, [data, kindFilter]);

  const setExpanded = (seq: number, expanded: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(seq);
      else next.delete(seq);
      return next;
    });

  return (
    <div className="flex flex-col gap-2" data-testid="stage-events">
      <div className="flex items-center gap-1.5">
        <SearchInput
          value={kindFilter}
          onValueChange={setKindFilter}
          label="Filter events by kind"
          placeholder="Filter by kind (harness., stage_run.)"
          shortcut={null}
          size="sm"
          className="min-w-0 flex-1"
        />
        <IconButton
          size="sm"
          icon="refresh"
          label="Refresh events"
          tooltip="Read the events again"
          onClick={() => void refetch()}
          disabled={isFetching}
          loading={isFetching}
        />
      </div>
      {isLoading ? (
        <p className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={12} /> Reading the run's events…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-err">
          {error instanceof Error ? error.message : 'Could not read the events'}
        </p>
      ) : null}
      {data ? (
        <p className="text-small text-fg-3">
          {events.length === data.length ? `${data.length} events` : `${events.length} of ${data.length} events`}
        </p>
      ) : null}
      <ol className="flex flex-col gap-0.5">
        {events.map((e) => (
          <li key={e.seq} className="rounded-control border border-line-soft px-1.5">
            <Collapsible
              open={open.has(e.seq)}
              onOpenChange={(next) => setExpanded(e.seq, next)}
              triggerClassName="w-full"
              trigger={
                <span className="flex min-w-0 items-center gap-1.5 text-small">
                  <span className="shrink-0 font-mono text-fg-3 tabular-nums">
                    {new Date(e.ts).toLocaleTimeString(undefined, { hour12: false })}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-fg">{e.kind}</span>
                  <span className="shrink-0 font-mono text-micro text-fg-3">#{e.seq}</span>
                </span>
              }
              panelClassName="pb-1.5"
            >
              <CodeBlock lang="json" className="max-h-72 overflow-auto">
                {JSON.stringify(e.payload, null, 2)}
              </CodeBlock>
            </Collapsible>
          </li>
        ))}
      </ol>
    </div>
  );
}
