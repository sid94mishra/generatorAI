// ────────────────────────────────────────────────────────────────
// VersionHistoryModal — the builder's version history (P07 WP-7.6):
// every published and test version of the definition, a structural diff
// of any two of them (or of a version and what the editor holds now), and
// "Restore as draft", which loads a version into the editor as unsaved
// changes. Saving then makes it the working draft; nothing is published.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, History, RotateCcw } from 'lucide-react';
import type { WorkflowDefinitionVersionSummary, WorkflowGraph } from '@generatorai/workflow-spec';
import { cn } from '@/lib/utils.js';
import { Badge, Button, Modal, Select, Spinner } from '@/components/ui/index.js';
import { useQueryClient } from '@tanstack/react-query';
import { useDefinitionVersions, useWorkflowDefinitionVersion, workflowKeys } from '@/hooks/workflowQueries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { diffGraphs, isEmptyDiff, previewValue, type FieldChange, type GraphDiff } from './graphDiff.js';

/** The editor's graph, as a diff side. */
const CURRENT = 'current';

interface VersionHistoryModalProps {
  open: boolean;
  onClose: () => void;
  definitionId: string;
  /** The graph in the editor now (the right side of "compare with the editor"). */
  currentGraph: () => WorkflowGraph;
  /** Load a version's graph into the editor as unsaved changes. */
  onRestore: (graph: WorkflowGraph, version: WorkflowDefinitionVersionSummary) => void;
}

function versionLabel(v: WorkflowDefinitionVersionSummary): string {
  return `v${v.version} · ${v.kind === 'published' ? 'published' : 'test run'} · ${new Date(v.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function VersionHistoryModal({ open, onClose, definitionId, currentGraph, onRestore }: VersionHistoryModalProps) {
  const { data: versions, isLoading, error } = useDefinitionVersions(definitionId, { enabled: open });
  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>(CURRENT);

  // Default comparison: the newest version against the editor.
  useEffect(() => {
    if (!open) return;
    if (versions && versions.length > 0 && !versions.some((v) => v.id === fromId)) setFromId(versions[0]!.id);
  }, [open, versions, fromId]);

  const from = useWorkflowDefinitionVersion(open ? definitionId : undefined, fromId || undefined);
  const to = useWorkflowDefinitionVersion(open ? definitionId : undefined, toId !== CURRENT ? toId : undefined);

  const diff = useMemo<GraphDiff | null>(() => {
    if (!open || !from.data) return null;
    const right = toId === CURRENT ? currentGraph() : to.data?.graph;
    return right ? diffGraphs(from.data.graph, right) : null;
    // `currentGraph` reads the store now; re-diff when the sides change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, from.data, to.data, toId]);

  const options = useMemo(
    () => (versions ?? []).map((v) => ({ value: v.id, label: versionLabel(v) })),
    [versions],
  );

  const queryClient = useQueryClient();
  const platform = usePlatform();
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restore = async (v: WorkflowDefinitionVersionSummary) => {
    setRestoring(v.id);
    setRestoreError(null);
    try {
      const record = await queryClient.fetchQuery({
        queryKey: workflowKeys.definitionVersion(definitionId, v.id),
        queryFn: () => platform.getDefinitionVersion(definitionId, v.id),
        staleTime: Infinity,
      });
      onRestore(record.graph, v);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Could not load the version');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" /> Version history
        </span>
      }
      description="Published versions and the snapshots test runs executed. Restoring loads a version into the editor as unsaved changes; saving makes it the draft."
    >
      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Loading versions…
        </p>
      )}
      {error && <p className="text-sm text-danger">{error instanceof Error ? error.message : 'Could not load the versions'}</p>}
      {restoreError && <p className="mb-2 text-sm text-danger">{restoreError}</p>}
      {versions && versions.length === 0 && (
        <p className="text-sm text-muted-foreground">No versions yet: a version is made when the workflow is published or runs as a test run.</p>
      )}

      {versions && versions.length > 0 && (
        <div className="flex max-h-[70vh] min-h-0 gap-4">
          <ol className="w-72 shrink-0 space-y-1 overflow-y-auto pr-1" aria-label="Versions">
            {versions.map((v) => (
              <li
                key={v.id}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs',
                  v.id === fromId || v.id === toId ? 'border-primary/50 bg-primary/5' : 'border-border',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-semibold text-foreground">v{v.version}</span>
                  <Badge tone={v.kind === 'published' ? 'success' : 'neutral'} size="sm">
                    {v.kind === 'published' ? 'published' : 'test'}
                  </Badge>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setFromId(v.id)}>
                    Compare from
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setToId(v.id)}>
                    to
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-1.5 text-[11px]"
                    leftIcon={<RotateCcw className="h-3 w-3" />}
                    loading={restoring === v.id}
                    disabled={restoring !== null}
                    onClick={() => void restore(v)}
                    title="Load this version into the editor as unsaved changes"
                  >
                    Restore as draft
                  </Button>
                </div>
              </li>
            ))}
          </ol>

          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="min-w-[14rem] flex-1">
                <Select aria-label="Compare from" value={fromId} onChange={setFromId} options={options} />
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-[14rem] flex-1">
                <Select
                  aria-label="Compare to"
                  value={toId}
                  onChange={setToId}
                  options={[{ value: CURRENT, label: 'The editor now (unsaved included)' }, ...options]}
                />
              </div>
            </div>
            {(from.isLoading || (toId !== CURRENT && to.isLoading)) && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner size="sm" /> Loading…
              </p>
            )}
            {diff && <DiffView diff={diff} />}
          </div>
        </div>
      )}
    </Modal>
  );
}


function DiffView({ diff }: { diff: GraphDiff }) {
  if (isEmptyDiff(diff)) return <p className="text-sm text-muted-foreground">No differences (canvas positions aside).</p>;
  return (
    <div className="space-y-4 text-xs" data-testid="version-diff">
      {diff.workflow.length > 0 && (
        <DiffSection title="Workflow settings">
          <FieldList fields={diff.workflow} />
        </DiffSection>
      )}
      {diff.stagesAdded.length > 0 && (
        <DiffSection title={`Stages added (${diff.stagesAdded.length})`}>
          <ul className="space-y-0.5">
            {diff.stagesAdded.map((s) => (
              <li key={s.key} className="text-success">
                + <span className="font-mono">{s.key}</span> {s.name} <span className="text-muted-foreground">({s.kind})</span>
              </li>
            ))}
          </ul>
        </DiffSection>
      )}
      {diff.stagesRemoved.length > 0 && (
        <DiffSection title={`Stages removed (${diff.stagesRemoved.length})`}>
          <ul className="space-y-0.5">
            {diff.stagesRemoved.map((s) => (
              <li key={s.key} className="text-danger">
                − <span className="font-mono">{s.key}</span> {s.name} <span className="text-muted-foreground">({s.kind})</span>
              </li>
            ))}
          </ul>
        </DiffSection>
      )}
      {diff.stagesChanged.length > 0 && (
        <DiffSection title={`Stages changed (${diff.stagesChanged.length})`}>
          <div className="space-y-2">
            {diff.stagesChanged.map((s) => (
              <div key={s.key}>
                <p className="font-medium text-foreground">
                  <span className="font-mono">{s.key}</span> {s.name} <span className="text-muted-foreground">({s.kind})</span>
                </p>
                <FieldList fields={s.fields} />
              </div>
            ))}
          </div>
        </DiffSection>
      )}
      {(diff.edgesAdded.length > 0 || diff.edgesRemoved.length > 0 || diff.edgesChanged.length > 0) && (
        <DiffSection title="Edges">
          <ul className="space-y-0.5 font-mono">
            {diff.edgesAdded.map((e) => (
              <li key={`+${e.from}>${e.to}`} className="text-success">
                + {e.from} → {e.to} <span className="text-muted-foreground">({e.on}{e.when ? `, when ${e.when}` : ''})</span>
              </li>
            ))}
            {diff.edgesRemoved.map((e) => (
              <li key={`-${e.from}>${e.to}`} className="text-danger">
                − {e.from} → {e.to}
              </li>
            ))}
            {diff.edgesChanged.map((e) => (
              <li key={`~${e.from}>${e.to}`}>
                ~ {e.from} → {e.to}
                <FieldList fields={e.fields} />
              </li>
            ))}
          </ul>
        </DiffSection>
      )}
    </div>
  );
}

function DiffSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function FieldList({ fields }: { fields: FieldChange[] }) {
  return (
    <ul className="mt-0.5 space-y-0.5 pl-3">
      {fields.map((f) => (
        <li key={f.path} className="break-words font-sans">
          <span className="font-mono text-foreground">{f.path}</span>
          <span className="text-muted-foreground">: </span>
          <span className="font-mono text-danger line-through decoration-danger/40">{previewValue(f.before)}</span>
          <span className="text-muted-foreground"> → </span>
          <span className="font-mono text-success">{previewValue(f.after)}</span>
        </li>
      ))}
    </ul>
  );
}
