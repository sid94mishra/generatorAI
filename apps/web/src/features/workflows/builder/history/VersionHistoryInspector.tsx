// ────────────────────────────────────────────────────────────────
// VersionHistoryInspector — the builder's version history (WF-10, P07
// WP-7.6), shown in place of the inspector: every published and test
// version of the definition, a structural diff of any two of them — or of
// a version and what the editor holds now (the Draft row, unsaved changes
// included) — and "Restore as draft", which loads a version into the
// editor as unsaved changes. Saving then makes it the working draft;
// nothing is published.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState, type ReactNode } from 'react';
import type { WorkflowDefinitionVersionSummary, WorkflowGraph } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useDefinitionVersions, useWorkflowDefinition, useWorkflowDefinitionVersion } from '@/hooks/workflowQueries.js';
import { useFetchDefinitionVersion } from '@/hooks/workflowBuilderQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { VersionChip } from '@/blocks/workflow/chips/WorkflowChips.js';
import {
  DRAFT_ID,
  VersionHistoryPanel,
  type VersionDiffView,
  type VersionHistoryRow,
} from '@/blocks/workflow/VersionHistoryPanel/VersionHistoryPanel.js';
import { diffGraphs } from './graphDiff.js';
import { diffRows, diffSummary } from './diffRows.js';

export interface VersionHistoryInspectorProps {
  definitionId: string;
  /** The graph in the editor now (the Draft side of a comparison). */
  currentGraph: () => WorkflowGraph;
  /** Load a version's graph into the editor as unsaved changes. */
  onRestore: (graph: WorkflowGraph, version: WorkflowDefinitionVersionSummary) => void;
  onClose: () => void;
  /** Replaces the intro line ("Every run pins the version it started on. Run 248 ran v7."). */
  runPinnedHint?: ReactNode;
}

const DEFAULT_INTRO =
  'Every run pins the version it started on. Restoring loads a version into the editor as unsaved changes; saving makes it the draft.';

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function VersionHistoryInspector({ definitionId, currentGraph, onRestore, onClose, runPinnedHint }: VersionHistoryInspectorProps) {
  const { data: versions, isLoading, error } = useDefinitionVersions(definitionId);
  const { data: record } = useWorkflowDefinition(definitionId);
  const fetchVersion = useFetchDefinitionVersion();
  const status = useWorkflowBuilderStore((s) => s.status);
  const revision = useWorkflowBuilderStore((s) => s.revision);
  const isDirty = useWorkflowBuilderStore((s) => s.isDirty);
  const hasUnpublishedChanges = useWorkflowBuilderStore((s) => s.hasUnpublishedChanges);
  const currentVersionId = useWorkflowBuilderStore((s) => s.currentVersionId);

  // null until the user ticks something: the default compares the newest version with the editor.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [compared, setCompared] = useState<readonly [string, string] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const byId = useMemo(() => new Map((versions ?? []).map((v) => [v.id, v])), [versions]);
  const newest = versions?.[0];
  const defaultPair = newest ? ([newest.id, DRAFT_ID] as const) : null;
  const selected = picked ?? (defaultPair ? [...defaultPair] : []);
  const rank = (id: string) => (id === DRAFT_ID ? Number.POSITIVE_INFINITY : (byId.get(id)?.version ?? 0));
  const ordered = (ids: readonly string[]) => [...ids].sort((a, b) => rank(a) - rank(b)) as unknown as readonly [string, string];
  const pair = compared ?? (picked === null ? defaultPair : null);
  const [leftId, rightId] = pair ? ordered(pair) : [undefined, undefined];

  const left = useWorkflowDefinitionVersion(definitionId, leftId && leftId !== DRAFT_ID ? leftId : undefined);
  const right = useWorkflowDefinitionVersion(definitionId, rightId && rightId !== DRAFT_ID ? rightId : undefined);

  const diff = useMemo<VersionDiffView | null>(() => {
    if (!leftId || !rightId) return null;
    const name = (id: string) => (id === DRAFT_ID ? 'Draft' : `v${byId.get(id)?.version ?? '?'}`);
    const title = `${name(leftId)} ↔ ${name(rightId)}`;
    const graphOf = (id: string, q: typeof left) => (id === DRAFT_ID ? currentGraph() : q.data?.graph);
    const before = graphOf(leftId, left);
    const after = graphOf(rightId, right);
    const failure = left.error ?? right.error;
    if (failure) return { title, rows: [], error: message(failure, 'Could not load the version') };
    if (!before || !after) return { title, rows: [], loading: true };
    const d = diffGraphs(before, after);
    return { title, summary: diffSummary(d), rows: diffRows(d) };
    // `currentGraph` reads the store now; the nonce re-reads it on "Diff".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftId, rightId, left.data, right.data, left.error, right.error, byId, nonce]);

  const rows = useMemo<VersionHistoryRow[]>(
    () =>
      (versions ?? []).map((v) => ({
        id: v.id,
        version: v.version,
        kind: v.kind,
        createdAt: new Date(v.createdAt),
        hash: v.contentHash,
        live: v.id === currentVersionId,
      })),
    [versions, currentVersionId],
  );

  const restore = async (id: string) => {
    const summary = byId.get(id);
    if (!summary) return;
    setRestoringId(id);
    setRestoreError(null);
    try {
      const version = await fetchVersion(definitionId, id);
      onRestore(version.graph, summary);
    } catch (err) {
      setRestoreError(message(err, 'Could not load the version'));
    } finally {
      setRestoringId(null);
    }
  };

  const live = currentVersionId ? byId.get(currentVersionId)?.version : undefined;
  const nextVersion = (versions ?? []).reduce((max, v) => Math.max(max, v.version), 0) + 1;
  const publishable = status === 'draft' || hasUnpublishedChanges || isDirty;
  const meta = isDirty
    ? 'Unsaved changes in the editor'
    : status === 'draft'
      ? 'Never published'
      : hasUnpublishedChanges
        ? 'Saved, not published'
        : 'Same as the live version';

  const selectionKey = [...selected].sort().join('|');
  const comparedKey = pair ? [...pair].sort().join('|') : '';

  return (
    <VersionHistoryPanel
      intro={runPinnedHint ?? DEFAULT_INTRO}
      draft={{
        badges: (
          <>
            <VersionChip status="draft" />
            {record?.authoredBy ? <Badge icon="agents">Agent draft</Badge> : null}
          </>
        ),
        revision,
        meta,
        note: publishable
          ? `Publishing makes it v${nextVersion}${live != null ? ` and replaces v${live} for new runs.` : '.'}`
          : undefined,
      }}
      versions={rows}
      loading={isLoading}
      error={error ? message(error, 'Could not load the versions') : null}
      selected={selected}
      onSelectionChange={setPicked}
      onCompare={() => {
        if (selected.length !== 2) return;
        setCompared([selected[0]!, selected[1]!]);
        setNonce((n) => n + 1);
      }}
      compared={selected.length === 2 && selectionKey === comparedKey}
      onRestore={(id) => void restore(id)}
      restoringId={restoringId}
      restoreError={restoreError}
      diff={diff}
      onClose={onClose}
    />
  );
}
