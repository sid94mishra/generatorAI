// ────────────────────────────────────────────────────────────────
// StageEventsTab — the raw event log of one stage instance (P07 WP-7.6):
// every run-scope event whose payload names the instance (`stageRunId`),
// oldest first, with its kind, time and JSON payload. It reads the run
// scope's replay (the same log the run page rebuilds itself from) once,
// when the tab opens; "Refresh" reads it again.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Input, Spinner } from '@/components/ui/index.js';
import { usePlatform } from '@/providers/PlatformProvider.js';

const PAGE_SIZE = 500;

interface StageEvent {
  seq: number;
  kind: string;
  ts: number;
  payload: unknown;
}

/** Every run-scope event of an instance, oldest first. */
async function readStageEvents(
  replay: (afterSeq: number) => Promise<Array<{ seq: number; kind: string; ts: number; payload: unknown }>>,
  stageRunId: string,
): Promise<StageEvent[]> {
  const out: StageEvent[] = [];
  let afterSeq = 0;
  for (;;) {
    const page = await replay(afterSeq);
    for (const row of page) {
      const payload = row.payload as Record<string, unknown> | null;
      if (payload && typeof payload === 'object' && payload['stageRunId'] === stageRunId) {
        out.push({ seq: row.seq, kind: row.kind, ts: row.ts, payload: row.payload });
      }
    }
    if (page.length < PAGE_SIZE) return out;
    afterSeq = page[page.length - 1]!.seq;
  }
}

export function StageEventsTab({ runId, stageRunId }: { runId: string; stageRunId: string }) {
  const platform = usePlatform();
  const [kindFilter, setKindFilter] = useState('');
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['stage-events', runId, stageRunId],
    queryFn: () => readStageEvents((afterSeq) => platform.streamReplay('run', runId, afterSeq, PAGE_SIZE), stageRunId),
    staleTime: Infinity,
  });

  const events = useMemo(() => {
    const f = kindFilter.trim().toLowerCase();
    return f ? (data ?? []).filter((e) => e.kind.toLowerCase().includes(f)) : (data ?? []);
  }, [data, kindFilter]);

  const toggle = (seq: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });

  return (
    <div className="space-y-2" data-testid="stage-events">
      <div className="flex items-center gap-1.5">
        <Input
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          placeholder="Filter by kind (harness., stage_run.)"
          aria-label="Filter events by kind"
          className="h-7 text-[11px]"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh events"
          title="Read the events again"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
        </Button>
      </div>
      {isLoading && (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Spinner size="sm" /> Reading the run's events…
        </p>
      )}
      {error && <p className="text-[11px] text-danger">{error instanceof Error ? error.message : 'Could not read the events'}</p>}
      {data && (
        <p className="text-[10.5px] text-muted-foreground">
          {events.length === data.length ? `${data.length} events` : `${events.length} of ${data.length} events`}
        </p>
      )}
      <ol className="space-y-0.5">
        {events.map((e) => {
          const expanded = open.has(e.seq);
          return (
            <li key={e.seq} className="rounded border border-border/60">
              <Button
                variant="unstyled"
                onClick={() => toggle(e.seq)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left text-[11px] hover:bg-subtle"
              >
                <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {new Date(e.ts).toLocaleTimeString(undefined, { hour12: false })}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-foreground">{e.kind}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{e.seq}</span>
              </Button>
              {expanded && (
                <pre className="max-h-72 overflow-auto border-t border-border/60 bg-subtle px-2 py-1.5 font-mono text-[10.5px] leading-snug text-foreground">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
