// ────────────────────────────────────────────────────────────────
// WorkflowDetailPage (PW-a; T-02 DetailPage; board WorkflowDetail; 04 §2.6,
// §4.7 #55). Replaces pages/WorkflowDefinitionPage.tsx.
//
// Header: Workflows / name, WF-01 status (Published vN / Draft rev N),
// Versions N, Unpublished changes; Open in builder, Publish, Test run, Run,
// More (Export JSON, Delete…). Title: description + meta (stages,
// approvals, revision, created, tags). Banners: migration notes
// (`needsAttention`), agent draft, archived. Body: Stages, Setup, Variables;
// rail: Runs (G-10 stats, run search, version + trigger per run). `?run=1`
// opens the Run dialog (R-5; the list's "Run…").
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router';
import type { InvocationResult } from '@generatorai/workflow-spec';
import {
  useDefinitionVersions,
  useDeleteWorkflowDefinition,
  useExportWorkflowDefinition,
  usePublishDefinition,
  useWorkflowDefinition,
} from '@/hooks/workflowQueries.js';
import { useProject } from '@/hooks/projectQueries.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { downloadBlobAsFile } from '@/utils/downloadBlobAsFile.js';
import { exportFileName } from '@/utils/workflowExport.js';
import { RunDialog, VersionChip, type InvocationTarget } from '@/blocks/workflow/index.js';
import { Banner } from '@/ui/patterns/Banner/Banner.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { DetailPage } from '@/ui/templates/DetailPage/DetailPage.js';
import { useNarrow } from '@/lib/useNarrow.js';
import { formatShortDate, plural } from '../workflowFormat.js';
import { SetupCard, StagesCard, VariablesCard } from './DefinitionCards.js';
import { RunsRail } from './RunsRail.js';

type RunMode = 'run' | 'test';

export function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: definition, isLoading, error } = useWorkflowDefinition(id);
  const { data: versions } = useDefinitionVersions(id);
  const { data: project } = useProject(definition?.graph.workflow.projectId ?? undefined);
  const publish = usePublishDefinition();
  const exportDefinition = useExportWorkflowDefinition();
  const deleteDefinition = useDeleteWorkflowDefinition();
  const confirmer = useConfirm();
  const [measureRef, narrow] = useNarrow<HTMLDivElement>();
  const workflow = definition?.graph.workflow;
  usePageTitle(workflow?.name);

  // Published versions only (test runs pin `test` versions); by id for the runs rail.
  const published = useMemo(() => (versions ?? []).filter((v) => v.kind === 'published'), [versions]);
  const versionNumbers = useMemo(() => new Map((versions ?? []).map((v) => [v.id, v.version])), [versions]);
  const versionLabels = useMemo(() => new Map((versions ?? []).map((v) => [v.id, v.kind === 'published' ? `v${v.version}` : 'test'])), [versions]);
  const currentVersion = definition?.currentVersionId ? versionNumbers.get(definition.currentVersionId) : undefined;

  const runParam = params.get('run');
  const runMode: RunMode | null = runParam === 'test' ? 'test' : runParam ? 'run' : null;
  const openRun = (mode: RunMode) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('run', mode === 'test' ? 'test' : '1');
        return next;
      },
      { replace: true },
    );
  const closeRun = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('run');
        return next;
      },
      { replace: true },
    );

  if (!id) return null;
  if (isLoading) return <SkeletonRows rows={6} label="Loading workflow" className="p-7" />;
  if (error || !definition || !workflow) {
    return (
      <EmptyState
        className="h-full"
        tone="error"
        icon="warning"
        title={error ? "Couldn't load the workflow" : 'Workflow not found'}
        description={error instanceof Error ? error.message : undefined}
        action={
          <Button render={<RouterLink to="/workflows" />} size="sm">
            Back to Workflows
          </Button>
        }
      />
    );
  }

  const isDraft = definition.status !== 'published';
  const canPublish = isDraft || definition.hasUnpublishedChanges;
  const approvals = definition.graph.stages.filter(
    (s) => ('approval' in s && !!s.approval) || (s.kind === 'wait' && s.wait.type === 'approval'),
  ).length;

  // A draft has no published version: it runs its working graph as a test run.
  const publishedTarget: InvocationTarget = { kind: 'definition', workflowDefinitionId: id };
  const testTarget: InvocationTarget = { kind: 'definition', workflowDefinitionId: id, testRun: true };
  const dialogTest = isDraft || runMode === 'test';

  const onStarted = (result: InvocationResult) => {
    closeRun();
    navigate(`/workflows/${result.workflowDefinitionId}/runs/${result.runId}`);
  };

  const onPublish = () =>
    publish.mutate(id, {
      onSuccess: () => toast.done(`${workflow.name} published`),
      onError: (err) => toast.error('Publish failed', { description: err instanceof Error ? err.message : String(err) }),
    });

  const onExport = async () => {
    const text = await exportDefinition.mutateAsync(id).catch(() => null);
    if (text !== null) await downloadBlobAsFile(new Blob([text], { type: 'application/json' }), exportFileName(workflow.name));
  };

  const onDelete = async () => {
    const ok = await confirmer.confirm({
      title: `Delete ${workflow.name}?`,
      description: 'A workflow that has runs is archived instead, so its run history stays readable.',
      confirmLabel: 'Delete workflow',
    });
    if (!ok) return;
    try {
      const outcome = await deleteDefinition.mutateAsync(id);
      if ('archived' in outcome) toast.info(`${workflow.name} was archived`, { description: `It has ${plural(outcome.runs, 'run')}; its run history stays readable.` });
      navigate('/workflows');
    } catch (err) {
      toast.error("Couldn't delete the workflow", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const author = definition.authoredBy;
  const banner = (
    <>
      {definition.needsAttention.length > 0 ? (
        <Banner
          tone="warn"
          lead="Needs attention"
          detail={definition.needsAttention.join(' · ')}
          action={
            <Button size="sm" render={<RouterLink to={`/workflows/${id}/edit`} />}>
              Open in builder
            </Button>
          }
        />
      ) : null}
      {author ? (
        <Banner
          tone="info"
          lead="Agent draft"
          detail={`Drafted by ${author.clientName ?? author.kind.replace('_', ' ')}${author.via ? ` via ${author.via.toUpperCase()}` : ''} · ${formatShortDate(author.at)}. Publishing needs a person.`}
        />
      ) : null}
      {definition.archivedAt ? <Banner tone="info" lead="Archived" detail="This workflow is archived; its run history stays readable." /> : null}
    </>
  );

  const runHint =
    !isDraft && currentVersion !== undefined
      ? `Run starts published v${currentVersion} (rev ${definition.revision}).${definition.hasUnpublishedChanges ? ' Test run is for the unpublished edits in the builder.' : ''}`
      : isDraft
        ? 'A draft runs only as a test run; publish it to run a fixed version.'
        : undefined;

  return (
    <div ref={measureRef} className="h-full min-h-0">
      <DetailPage
        railStacked={narrow}
        header={
          <PageHeader
            breadcrumb={<Breadcrumb items={[{ label: 'Workflows', render: <RouterLink to="/workflows" /> }, { label: workflow.name }]} />}
            status={
              <span className="flex items-center gap-2">
                <VersionChip status={definition.status} version={currentVersion} revision={isDraft ? definition.revision : undefined} />
                {definition.hasUnpublishedChanges && !isDraft ? <Badge>Unpublished changes</Badge> : null}
              </span>
            }
            meta={
              published.length > 0 ? (
                <Chip size="sm" variant="ghost" icon="history">
                  Versions <span className="font-mono">{published.length}</span>
                </Chip>
              ) : undefined
            }
            actions={
              <>
                <Button icon="edit" render={<RouterLink to={`/workflows/${id}/edit`} />}>
                  Open in builder
                </Button>
                {canPublish ? (
                  <Button icon="upload" loading={publish.isPending} onClick={onPublish}>
                    Publish
                  </Button>
                ) : null}
                {!isDraft && definition.hasUnpublishedChanges ? (
                  <Button icon="view" onClick={() => openRun('test')}>
                    Test run
                  </Button>
                ) : null}
                <Button variant="primary" icon="play" onClick={() => openRun(isDraft ? 'test' : 'run')}>
                  {isDraft ? 'Test run' : 'Run'}
                </Button>
                <MenuButton
                  label="More actions"
                  iconOnly
                  icon="more"
                  items={[
                    { id: 'export', label: 'Export JSON', icon: 'download', onSelect: () => void onExport() },
                    { type: 'separator' },
                    { id: 'delete', label: 'Delete workflow…', icon: 'trash', danger: true, onSelect: () => void onDelete() },
                  ]}
                />
              </>
            }
          />
        }
        title={
          <PageTitle
            variant="detail"
            title={workflow.name}
            description={workflow.description}
            meta={[
              plural(definition.graph.stages.length, 'stage'),
              ...(approvals > 0 ? [plural(approvals, 'approval')] : []),
              `revision ${definition.revision}`,
              `created ${formatShortDate(definition.createdAt)}`,
              ...(workflow.tags.length > 0 ? [workflow.tags.join(' · ')] : []),
            ]}
          />
        }
        banner={definition.needsAttention.length > 0 || author || definition.archivedAt ? banner : undefined}
        content={
          <div className="flex flex-col gap-4">
            {runHint ? <p className="text-small text-fg-3">{runHint}</p> : null}
            <StagesCard graph={definition.graph} />
            <div className={narrow ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-2 gap-4'}>
              <SetupCard graph={definition.graph} projectName={project?.name} />
              <VariablesCard graph={definition.graph} />
            </div>
          </div>
        }
        rail={<RunsRail definitionId={id} versionLabels={versionLabels} />}
      />
      <RunDialog
        open={runMode !== null}
        onOpenChange={(open) => (open ? undefined : closeRun())}
        workflowName={workflow.name}
        badge={<VersionChip status={dialogTest ? 'draft' : 'published'} version={dialogTest ? undefined : currentVersion} revision={dialogTest ? definition.revision : undefined} />}
        variables={workflow.variables}
        stages={definition.graph.stages.map((s) => ({ key: s.key, name: s.name }))}
        projectId={workflow.projectId}
        lifecycle={workflow.lifecycle}
        target={dialogTest ? testTarget : publishedTarget}
        submitLabel={dialogTest ? 'Test run' : 'Run'}
        {...(!dialogTest && definition.hasUnpublishedChanges ? { testRunTarget: testTarget } : {})}
        hint={
          currentVersion !== undefined
            ? `Published workflows run v${currentVersion}. Test run is for drafts and unpublished edits.`
            : 'A draft runs its working graph as a test run.'
        }
        onStarted={onStarted}
      />
      {confirmer.dialog}
    </div>
  );
}
