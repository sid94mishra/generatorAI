// ────────────────────────────────────────────────────────────────
// WorkflowNewPage (PW-a; T-03 FormWithAside; board WorkflowNew; 04 §1
// `/workflows/new`). Pick a start point — Blank canvas, From a template
// (category + search, preview of the stage chain and inputs) or Import JSON
// (checked by the server) —, fill the basics (name, project, description,
// codebases) and "Create draft and open builder" (Ctrl ↵). Replaces the
// builder's unsaved "new" mode as the way in; templates stay reachable from
// Settings → Templates too.
// ────────────────────────────────────────────────────────────────

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import type { WorkflowTemplate } from '@generatorai/workflow-spec';
import { useCreateWorkflowDefinition } from '@/hooks/workflowQueries.js';
import { useTemplates } from '@/hooks/queries.js';
import { useProjectCodebases, useProjects } from '@/hooks/projectQueries.js';
import { describeWorkflowApiError, formatWorkflowApiIssue, KeyChip } from '@/blocks/workflow/index.js';
import { downloadBlobAsFile } from '@/utils/downloadBlobAsFile.js';
import { ActionBar } from '@/ui/patterns/ActionBar/ActionBar.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { ChoiceCardGrid } from '@/ui/patterns/ChoiceCardGrid/ChoiceCardGrid.js';
import { Dropzone } from '@/ui/patterns/Dropzone/Dropzone.js';
import { FormSection } from '@/ui/patterns/FormSection/FormSection.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Icon } from '@/ui/icons/index.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { FormWithAside } from '@/ui/templates/FormWithAside/FormWithAside.js';
import { readWorkflowFile, useWorkflowImport } from '../useWorkflowImport.js';
import { plural, sampleWorkflowDocument } from '../workflowFormat.js';
import {
  TEMPLATE_CATEGORY_LABELS,
  blockingReason,
  documentSummary,
  draftGraph,
  importDocumentWith,
  stageOutline,
  type DraftBasics,
  type StartPoint,
} from './newWorkflowModel.js';
import { modChord } from '@/lib/shortcuts.js';

const NO_PROJECT = '__none__';

export function WorkflowNewPage() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const { data: templates, isLoading: templatesLoading } = useTemplates();
  const { data: projects } = useProjects();
  const create = useCreateWorkflowDefinition();
  const { importDocument, pending: importing } = useWorkflowImport();

  const [start, setStart] = useState<StartPoint>('blank');
  const [category, setCategory] = useState<string>('all');
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [document, setDocument] = useState<{ fileName: string; value: unknown } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [basics, setBasics] = useState<DraftBasics>({ name: '', description: '', projectId: '', codebaseAliases: [] });
  const [nameTouched, setNameTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: codebases } = useProjectCodebases(basics.projectId || undefined);

  const template = templates?.find((t) => t.id === templateId);
  const setBasic = <K extends keyof DraftBasics>(key: K, value: DraftBasics[K]) => setBasics((prev) => ({ ...prev, [key]: value }));

  // The basics follow the chosen template/document until the person edits the name.
  const adopt = (name: string, description: string) => {
    if (nameTouched) return;
    setBasics((prev) => ({ ...prev, name, description }));
  };
  const pickTemplate = (t: WorkflowTemplate) => {
    setTemplateId(t.id);
    adopt(t.graph.workflow.name, t.graph.workflow.description ?? '');
  };

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates ?? []) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return [...counts.entries()];
  }, [templates]);
  const shownTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    return (templates ?? [])
      .filter((t) => category === 'all' || t.category === category)
      .filter((t) => !q || t.graph.workflow.name.toLowerCase().includes(q) || (t.graph.workflow.description ?? '').toLowerCase().includes(q));
  }, [templates, category, templateSearch]);

  const blocked = blockingReason(start, basics, { template, document: document?.value });
  const busy = create.isPending || importing;
  const stageCount =
    start === 'template' ? template?.graph.stages.length ?? 0 : start === 'import' ? documentSummary(document?.value)?.stages ?? 0 : 0;

  const submit = async () => {
    if (blocked || busy) return;
    setSubmitError(null);
    if (start === 'import') {
      const outcome = await importDocument(importDocumentWith(document?.value, basics));
      if (outcome.ok) navigate(`/workflows/${outcome.record.id}/edit`);
      else setSubmitError(outcome.error);
      return;
    }
    try {
      const record = await create.mutateAsync(draftGraph(start, basics, template));
      navigate(`/workflows/${record.id}/edit`);
    } catch (err) {
      const e = describeWorkflowApiError(err, 'The draft could not be created');
      setSubmitError([e.message, ...e.issues.map(formatWorkflowApiIssue)].join('\n'));
    }
  };

  // Ctrl/⌘ ↵ creates (inside this page only).
  const shortcuts = useRef({ submit });
  shortcuts.current = { submit };
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const root = rootRef.current;
      const target = e.target as Node | null;
      if (!root || e.defaultPrevented || !(target === globalThis.document.body || (target && root.contains(target)))) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void shortcuts.current.submit();
      }
    };
    globalThis.document.addEventListener('keydown', onKeyDown);
    return () => globalThis.document.removeEventListener('keydown', onKeyDown);
  }, []);

  const onFile = async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    setFileError(null);
    const read = await readWorkflowFile(file);
    if (!read.ok) {
      setDocument(null);
      setFileError(read.error);
      return;
    }
    const summary = documentSummary(read.document);
    if (!summary) {
      setDocument(null);
      setFileError('This JSON is not a workflow document (it has no "workflow" object).');
      return;
    }
    setDocument({ fileName: file.name, value: read.document });
    adopt(summary.name, summary.description);
  };

  // ── Sections ──

  const startSection = (
    <FormSection title="Start from" first>
      <ChoiceCardGrid
        label="Start point"
        columns={3}
        value={start}
        onValueChange={(v) => setStart(v as StartPoint)}
        options={[
          { value: 'blank', icon: 'plus', title: 'Blank canvas', description: 'Add stages yourself.' },
          {
            value: 'template',
            icon: 'layers',
            title: 'From a template',
            description: templates ? `${plural(templates.length, 'ready-made workflow')}.` : 'Ready-made workflows.',
            disabled: templates?.length === 0,
          },
          { value: 'import', icon: 'upload', title: 'Import JSON', description: 'A workflow document (the file Export writes). Checked before import.' },
        ]}
      />
    </FormSection>
  );

  const templateSection =
    start === 'template' ? (
      <FormSection title="Templates" hint={templates ? String(templates.length) : undefined}>
        <div className="flex items-center gap-2">
          <Select
            aria-label="Template category"
            size="sm"
            value={category}
            onValueChange={(v) => setCategory(v ?? 'all')}
            className="w-48"
            items={[
              { value: 'all', label: 'All categories', meta: templates ? String(templates.length) : undefined },
              ...categories.map(([c, n]) => ({ value: c, label: TEMPLATE_CATEGORY_LABELS[c as WorkflowTemplate['category']] ?? c, meta: String(n) })),
            ]}
          />
          <SearchInput
            value={templateSearch}
            onValueChange={setTemplateSearch}
            label="Search templates"
            placeholder="Search templates"
            shortcut={null}
            size="sm"
            className="ml-auto w-56"
          />
        </div>
        {template ? <TemplatePreview template={template} /> : null}
        {templatesLoading ? (
          <SkeletonRows rows={2} label="Loading templates" />
        ) : shownTemplates.length === 0 ? (
          <EmptyState framed icon="search" title="No templates found" />
        ) : (
          <ChoiceCardGrid
            label="Template"
            columns={3}
            value={templateId}
            onValueChange={(v) => {
              const t = templates?.find((x) => x.id === v);
              if (t) pickTemplate(t);
            }}
            options={shownTemplates.map((t) => ({
              value: t.id,
              title: t.graph.workflow.name,
              description: `${plural(t.graph.stages.length, 'stage')} · ${TEMPLATE_CATEGORY_LABELS[t.category] ?? t.category}`,
            }))}
          />
        )}
      </FormSection>
    ) : null;

  const summary = documentSummary(document?.value);
  const importSection =
    start === 'import' ? (
      <FormSection title="Workflow document" hint="A .json file up to 5 MB">
        <Dropzone accept=".json,application/json" multiple={false} onFiles={(files) => void onFile(files)} />
        {fileError ? <Callout tone="err" title={fileError} /> : null}
        {document && summary ? (
          <Card>
            <Card.Body padding="sm" className="flex items-center gap-2 text-small">
              <Icon concept="file-text" size={14} className="text-fg-3" />
              <span className="font-mono text-fg">{document.fileName}</span>
              <span className="text-fg-3">
                · {summary.name || 'unnamed'} · {plural(summary.stages, 'stage')}
              </span>
            </Card.Body>
          </Card>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon="download"
          className="self-start"
          onClick={() => void downloadBlobAsFile(new Blob([sampleWorkflowDocument()], { type: 'application/json' }), 'workflow-template.workflow.json')}
        >
          Download a sample document
        </Button>
      </FormSection>
    ) : null;

  const basicsSection = (
    <FormSection title="Basics">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Name" className="col-span-2">
          <Input
            value={basics.name}
            onChange={(e) => {
              setNameTouched(true);
              setBasic('name', e.target.value);
            }}
            placeholder="Issue fix with review"
            maxLength={200}
          />
        </Field>
        <Field label="Project">
          <Select
            value={basics.projectId || NO_PROJECT}
            onValueChange={(v) =>
              setBasics((prev) => ({ ...prev, projectId: !v || v === NO_PROJECT ? '' : v, codebaseAliases: [] }))
            }
            items={[{ value: NO_PROJECT, label: 'No project', icon: 'projects' }, ...(projects ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>
      </div>
      <Field label="Description" optional>
        <Input value={basics.description} onChange={(e) => setBasic('description', e.target.value)} placeholder="What the workflow does" maxLength={2000} />
      </Field>
      {basics.projectId && codebases && codebases.length > 0 ? (
        <Field label={`Codebases · ${basics.codebaseAliases.length} of ${codebases.length}`} hint="Each run mounts the ticked codebases; a worktree is created for each run.">
          <div className="grid grid-cols-2 gap-2">
            {codebases.map((c) => (
              <Card key={c.id} selected={basics.codebaseAliases.includes(c.alias)}>
                <Card.Body padding="sm" className="flex items-center gap-2.5">
                  <Checkbox
                    checked={basics.codebaseAliases.includes(c.alias)}
                    onCheckedChange={(on) =>
                      setBasic('codebaseAliases', on ? [...basics.codebaseAliases, c.alias] : basics.codebaseAliases.filter((a) => a !== c.alias))
                    }
                    aria-label={`Mount ${c.alias}`}
                  />
                  <Icon concept="branch" size={14} className="text-fg-3" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-mono text-ui text-fg">{c.alias}</span>
                    <span className="truncate font-mono text-micro text-fg-3">
                      {c.url ?? c.localPath}
                      {c.defaultBranch ? ` · ${c.defaultBranch}` : ''}
                    </span>
                  </span>
                </Card.Body>
              </Card>
            ))}
          </div>
        </Field>
      ) : null}
      {submitError ? (
        <Callout tone="err" title="The draft was not created" role="alert">
          <span className="whitespace-pre-wrap">{submitError}</span>
        </Callout>
      ) : null}
    </FormSection>
  );

  const hint = blocked
    ? blocked
    : start === 'blank'
      ? `Creates an empty draft, ${basics.name.trim()}.`
      : start === 'template' && template
        ? `Creates a draft, ${basics.name.trim()}, with ${plural(stageCount, 'stage')} from ${template.graph.workflow.name}.`
        : `Imports ${document?.fileName ?? 'the document'} as a draft, ${basics.name.trim()}, with ${plural(stageCount, 'stage')}.`;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col" data-testid="workflow-new-page">
      <FormWithAside
        header={
          <PageHeader
            breadcrumb={<Breadcrumb items={[{ label: 'Workflows', render: <RouterLink to="/workflows" /> }, { label: 'New workflow' }]} />}
            actions={<IconButton icon="x" label="Close" render={<RouterLink to="/workflows" />} />}
          />
        }
        form={
          <>
            <PageTitle title="New workflow" description="Pick a starting point. New workflows start as drafts: test run them, then publish." variant="detail" />
            {startSection}
            {templateSection}
            {importSection}
            {basicsSection}
          </>
        }
        actions={
          <ActionBar
            hint={<span data-testid="workflow-new-hint">{hint}</span>}
            secondary={
              <Button variant="ghost" render={<RouterLink to="/workflows" />}>
                Cancel
              </Button>
            }
            primary={
              <Button variant="primary" shortcut={modChord('Enter')} disabled={blocked != null} loading={busy} onClick={() => void submit()}>
                Create draft and open builder
              </Button>
            }
          />
        }
      />
    </div>
  );
}

function TemplatePreview({ template }: { template: WorkflowTemplate }) {
  const outline = stageOutline(template.graph);
  const inputs = template.graph.workflow.variables;
  return (
    <Card data-testid="template-preview">
      <Card.Body padding="sm" className="flex flex-col gap-2 text-small">
        {template.graph.workflow.description ? <p className="text-fg-2">{template.graph.workflow.description}</p> : null}
        <div className="flex gap-3">
          <span className="w-14 shrink-0 text-fg-3">Stages</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {outline.map((s, i) => (
              <Fragment key={s.key}>
                {i > 0 ? <Icon concept="chevron-right" size={12} className="text-fg-3" /> : null}
                {s.body.length > 0 ? (
                  <Chip size="sm" icon={s.kind === 'loop' ? 'retry' : 'layers'} mono>
                    {s.key}
                    {s.max !== undefined ? <span className="ml-1 text-fg-3">max {s.max}</span> : null}
                    {s.body.map((b) => (
                      <KeyChip key={b} stageKey={b} outlined />
                    ))}
                  </Chip>
                ) : (
                  <KeyChip stageKey={s.key} outlined />
                )}
              </Fragment>
            ))}
          </span>
        </div>
        <div className="flex gap-3">
          <span className="w-14 shrink-0 text-fg-3">Inputs</span>
          <span className="min-w-0 text-fg-2">
            {inputs.length > 0 ? (
              <>
                <span className="font-mono">{inputs.map((v) => v.name).join(' · ')}</span> <span className="text-fg-3">asked for at launch</span>
              </>
            ) : (
              <span className="text-fg-3">None</span>
            )}
          </span>
        </div>
      </Card.Body>
    </Card>
  );
}
