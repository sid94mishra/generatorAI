// The focused stage's own file changes (D-22): its "before" checkpoint to the
// next checkpoint of another stage (the state it left behind), or to the
// workspace now when nothing ran after it. Fetched only while the dock is open.

import { useMemo } from 'react';
import { useWorkspaceChangeSummary, useWorkspaceCheckpoints } from '@/hooks/queries.js';
import type { FileChange, StageView } from './model/types.js';

export function useStageFiles(
  workspaceId: string | undefined,
  stage: StageView | null,
  dockOpen: boolean,
): { files?: FileChange[]; note?: string } {
  const enabled = dockOpen && !!workspaceId && !!stage;
  const { data: cps } = useWorkspaceCheckpoints(workspaceId, {}, enabled);
  const own = useMemo(() => {
    if (!stage || !cps) return undefined;
    const mine = cps.checkpoints
      .filter((c) => c.stageRunId === stage.id && c.phase !== 'after')
      .sort((a, b) => a.seq - b.seq)[0];
    if (!mine) return null;
    const next = cps.checkpoints
      .filter((c) => c.repoAlias === mine.repoAlias && c.seq > mine.seq && c.stageRunId && c.stageRunId !== stage.id)
      .sort((a, b) => a.seq - b.seq)[0];
    return { base: `stage:${stage.id}`, head: next ? `checkpoint:${next.id}` : 'working', toNext: !!next };
  }, [stage, cps]);
  const { data: summary } = useWorkspaceChangeSummary(workspaceId, own ? { base: own.base, head: own.head } : {}, enabled && !!own);
  return useMemo(() => {
    if (!stage) return {};
    if (own === null) {
      return { files: [], note: 'This stage has no checkpoint: it cannot change files, or it has not started.' };
    }
    if (!own || !summary) return {};
    const multi = summary.repos.length > 1;
    const files: FileChange[] = summary.repos.flatMap((r) =>
      r.files.map((f) => ({
        path: multi && r.alias !== '.' ? `${r.alias}/${f.path}` : f.path,
        kind: f.status,
        source: 'workspace' as const,
      })),
    );
    const parallel = (stage.parallelWith?.length ?? 0) > 0 ? ' Stages that ran alongside it are included.' : '';
    return {
      files,
      note: `Changed from this stage’s checkpoint to ${own.toNext ? 'the next stage’s' : 'the workspace now'}.${parallel}`,
    };
  }, [stage, own, summary]);
}
