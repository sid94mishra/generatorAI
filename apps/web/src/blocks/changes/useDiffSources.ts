// ────────────────────────────────────────────────────────────────
// useDiffSources — ChangeSummary → DiffSource[] with lazy bodies
// ────────────────────────────────────────────────────────────────
//
// The summary endpoint returns metadata only, so the file list renders
// instantly no matter how much changed. File bodies are fetched one at a
// time as the user expands them, keyed by the blob pair so an unchanged file
// is a 304 on the wire and a cache hit in the render worker.

import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceChangeFileBodies } from '@/hooks/changesQueries.js';
import type { ChangeSummary, ChangeSummaryFile } from '@/types/changes.js';
import type { DiffSource } from './diffTypes.js';

export interface UseDiffSourcesOptions {
  workspaceId: string | undefined;
  summary: ChangeSummary | undefined;
  base?: string;
  head?: string;
  /** Only these ids are fetched + expanded; everything else stays collapsed. */
  expandedIds: Set<string>;
}

export interface DiffSourceEntry {
  id: string;
  alias: string;
  file: ChangeSummaryFile;
}

/** Stable id for a changed file across repos. */
export function diffSourceId(alias: string, path: string): string {
  return `${alias}::${path}`;
}

export function useDiffSources({
  workspaceId,
  summary,
  base = 'baseline',
  head = 'working',
  expandedIds,
}: UseDiffSourcesOptions) {
  /** Flatten every repo's files into one ordered list. */
  const entries = useMemo<DiffSourceEntry[]>(() => {
    if (!summary) return [];
    return summary.repos.flatMap((repo) =>
      repo.files.map((file) => ({
        id: diffSourceId(repo.alias, file.path),
        alias: repo.alias,
        file,
      })),
    );
  }, [summary]);

  /**
   * One query per expanded file. Binary and oversized files are skipped —
   * for those the renderer shows a placeholder instead.
   */
  const fetchable = useMemo(
    () =>
      entries.filter(
        (e) => expandedIds.has(e.id) && !e.file.isBinary && !e.file.isTooLarge,
      ),
    [entries, expandedIds],
  );

  const results = useWorkspaceChangeFileBodies(workspaceId, fetchable, base, head);

  const bodies = useMemo(() => {
    const map = new Map<string, (typeof results)[number]['data']>();
    fetchable.forEach((entry, i) => {
      const data = results[i]?.data;
      if (data) map.set(entry.id, data);
    });
    return map;
  }, [fetchable, results]);

  const loadingIds = useMemo(() => {
    const set = new Set<string>();
    fetchable.forEach((entry, i) => {
      if (results[i]?.isLoading) set.add(entry.id);
    });
    return set;
  }, [fetchable, results]);

  const sources = useMemo<DiffSource[]>(() => {
    return entries.map((entry) => {
      const body = bodies.get(entry.id);
      const collapsed = !expandedIds.has(entry.id);
      return {
        id: entry.id,
        alias: entry.alias,
        path: entry.file.path,
        collapsed,
        ...(entry.file.lang ? { lang: entry.file.lang } : {}),
        /**
         * The blob pair is both the ETag and the render-worker AST cache key,
         * so re-opening an unchanged file is instant.
         *
         * Deliberately ABSENT until the body arrives. The viewer decides
         * whether a re-render is a new layout target purely by comparing
         * cacheKeys (`areDiffTargetsEqual`), and the blob pair is already
         * known from the summary — so a placeholder and the loaded file would
         * share a key. The viewer would then keep the empty placeholder's
         * measured height (one header row) for the real content, leaving the
         * scroll container far shorter than the diff and the lower files
         * unreachable. No key means "always a new target", which is exactly
         * right for a placeholder.
         */
        ...(body ? { cacheKey: `${entry.file.oldBlob ?? 'none'}:${entry.file.newBlob ?? 'none'}` } : {}),
        oldContents: body?.old?.contents ?? '',
        newContents: body?.new?.contents ?? '',
      } satisfies DiffSource;
    });
  }, [entries, bodies, expandedIds]);

  return { entries, sources, bodies, loadingIds };
}

/** Track which files are expanded, with sensible "open the first N" defaults. */
export function useExpandedDiffs(initialIds: string[] = []) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(initialIds),
  );

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expand = useCallback((id: string) => {
    setExpandedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const expandAll = useCallback((ids: string[]) => {
    setExpandedIds(new Set(ids));
  }, []);

  const collapseAll = useCallback(() => setExpandedIds(new Set()), []);

  return { expandedIds, toggle, expand, expandAll, collapseAll, setExpandedIds };
}
