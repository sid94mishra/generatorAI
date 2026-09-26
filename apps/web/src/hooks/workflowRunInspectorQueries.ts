// ────────────────────────────────────────────────────────────────
// The run page's stage-inspector reads (features/workflows/run/inspector):
// the raw event log of one stage instance. The stage history and the run
// file content come from hooks/workflowQueries.ts.
// ────────────────────────────────────────────────────────────────

import { useQuery } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';

const PAGE_SIZE = 500;

/** One run-scope event of a stage instance. */
export interface StageEvent {
  seq: number;
  kind: string;
  ts: number;
  payload: unknown;
}

type ReplayPage = (afterSeq: number) => Promise<Array<{ seq: number; kind: string; ts: number; payload: unknown }>>;

/** Every run-scope event whose payload names the instance (`stageRunId`), oldest first. */
export async function readStageEvents(replay: ReplayPage, stageRunId: string): Promise<StageEvent[]> {
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

/**
 * A stage instance's raw events (P07 WP-7.6), read from the run scope's
 * replay once when the tab opens; `refetch` reads them again.
 */
export function useStageEvents(runId: string, stageRunId: string) {
  const platform = usePlatform();
  return useQuery({
    queryKey: ['stage-events', runId, stageRunId],
    queryFn: () => readStageEvents((afterSeq) => platform.streamReplay('run', runId, afterSeq, PAGE_SIZE), stageRunId),
    staleTime: Infinity,
  });
}
