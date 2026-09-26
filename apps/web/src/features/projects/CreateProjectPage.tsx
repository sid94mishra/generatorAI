// ────────────────────────────────────────────────────────────────
// CreateProjectPage (P5-03; T-03 FormWithAside; D-32 recipe, content from
// mobile MProjectCreate; F-projects-11; 04-screen-map.md §3, §4.5 #46).
//
// Sections Basics (name, description), Worktrees (retention seg, max
// codebases), Repositories (repeatable codebase rows, same fields as the
// ProjectDetail inline form); aside "What will be created"; ActionBar with
// Cancel / Create project. On submit the project is created, then each
// repository is linked in order — a failed link is reported but does not
// block landing on the new project.
// ────────────────────────────────────────────────────────────────

import { useState, type FormEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import type { WorktreeRetentionPolicy } from '@generatorai/shared';
import { useCreateProject, useLinkCodebase } from '@/hooks/projectQueries.js';
import { ActionBar } from '@/ui/patterns/ActionBar/ActionBar.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { FormSection } from '@/ui/patterns/FormSection/FormSection.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { SummaryAside } from '@/ui/patterns/SummaryAside/SummaryAside.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { FormWithAside } from '@/ui/templates/FormWithAside/FormWithAside.js';
import {
  CodebaseDraftFields,
  codebaseDraftProblem,
  codebaseLinkParams,
  emptyCodebaseDraft,
  type CodebaseDraft,
} from './CodebaseDraftFields.js';
import {
  CODEBASE_TYPE_LABEL,
  DEFAULT_MAX_CODEBASES,
  DEFAULT_RETENTION,
  MAX_CODEBASES_LIMIT,
  RETENTION_OPTIONS,
  plural,
  retentionHint,
} from './projectFormat.js';
import { useNarrow } from './useNarrow.js';

interface RepoRow extends CodebaseDraft {
  key: string;
}

let rowSeq = 0;
function newRow(): RepoRow {
  rowSeq += 1;
  return { ...emptyCodebaseDraft(), key: `repo-${rowSeq}` };
}

export function CreateProjectPage() {
  const navigate = useNavigate();
  const createProject = useCreateProject();
  const linkCodebase = useLinkCodebase();
  const [ref, narrow] = useNarrow<HTMLDivElement>();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [retention, setRetention] = useState<WorktreeRetentionPolicy>(DEFAULT_RETENTION);
  const [maxCodebases, setMaxCodebases] = useState(DEFAULT_MAX_CODEBASES);
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const updateRepo = (key: string, patch: Partial<CodebaseDraft>) =>
    setRepos((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const problems = repos.map(codebaseDraftProblem);
  const reposValid = problems.every((p) => p === null);
  const tooMany = repos.length > maxCodebases;
  const canSubmit = Boolean(name.trim()) && reposValid && !tooMany && !submitting;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const project = await createProject.mutateAsync({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        settings: { worktreeRetention: retention, maxCodebases },
      });
      for (const repo of repos) {
        try {
          await linkCodebase.mutateAsync({ projectId: project.id, ...codebaseLinkParams(repo) });
        } catch (err) {
          toast.error(`Couldn't add "${repo.alias.trim()}"`, { description: err instanceof Error ? err.message : String(err) });
        }
      }
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast.error("Couldn't create the project", { description: err instanceof Error ? err.message : String(err) });
      setSubmitting(false);
    }
  };

  const createLabel = repos.length > 0 ? `Create project + ${plural(repos.length, 'repository', 'repositories')}` : 'Create project';

  return (
    <form onSubmit={(e) => void submit(e)} className="h-full min-h-0" aria-label="New project">
      <FormWithAside
        ref={ref}
        asideCollapsed={narrow}
        header={
          <PageHeader
            breadcrumb={<Breadcrumb items={[{ label: 'Projects', render: <RouterLink to="/projects" /> }, { label: 'New project' }]} />}
          />
        }
        form={
          <>
            <PageTitle title="New project" description="Group codebases, chats and runs" />
            <FormSection title="Basics" first>
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="payments-service" autoFocus />
              </Field>
              <Field label="Description" optional>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What do these codebases do together?"
                />
              </Field>
            </FormSection>

            <FormSection title="Worktrees" columns={2}>
              <Field label="Worktree retention" hint={retentionHint(retention)} className="col-span-2">
                <SegmentedControl<WorktreeRetentionPolicy>
                  value={retention}
                  onValueChange={setRetention}
                  items={RETENTION_OPTIONS.map((o) => ({ value: o.value, label: o.short }))}
                  label="Worktree retention"
                  className="self-start"
                />
              </Field>
              <Field
                label="Max codebases"
                error={tooMany ? `This project would start with ${repos.length} repositories.` : undefined}
              >
                <NumberField
                  value={maxCodebases}
                  onValueChange={(v) => setMaxCodebases(Math.max(1, Math.min(MAX_CODEBASES_LIMIT, v ?? 1)))}
                  min={1}
                  max={MAX_CODEBASES_LIMIT}
                  aria-label="Max codebases"
                  invalid={tooMany}
                />
              </Field>
            </FormSection>

            <FormSection
              title="Repositories"
              hint={repos.length > 0 ? String(repos.length) : 'optional — you can add them later'}
            >
              {repos.length === 0 ? (
                <EmptyState
                  framed
                  icon="branch"
                  title="No repositories yet"
                  description="Remote repositories clone in the background after you create the project."
                  action={
                    <Button icon="plus" onClick={() => setRepos([newRow()])}>
                      Add repository
                    </Button>
                  }
                />
              ) : (
                <>
                  {repos.map((repo, index) => (
                    <Card key={repo.key}>
                      <Card.Header
                        title={repo.alias.trim() || `Repository ${index + 1}`}
                        action={
                          <IconButton
                            size="sm"
                            icon="trash"
                            label={`Remove repository ${index + 1}`}
                            onClick={() => setRepos((rows) => rows.filter((r) => r.key !== repo.key))}
                          />
                        }
                      />
                      <Card.Body padding="lg">
                        <CodebaseDraftFields
                          draft={repo}
                          onChange={(patch) => updateRepo(repo.key, patch)}
                          label={`Repository ${index + 1} source`}
                        />
                        {problems[index] ? <p className="text-small text-fg-3">{problems[index]}</p> : null}
                      </Card.Body>
                    </Card>
                  ))}
                  <Button icon="plus" className="self-start" onClick={() => setRepos((rows) => [...rows, newRow()])}>
                    Add repository
                  </Button>
                </>
              )}
            </FormSection>
          </>
        }
        aside={
          <SummaryAside
            title="What will be created"
            sections={[
              { label: 'Project', content: name.trim() || '—' },
              {
                label: 'Repositories',
                content:
                  repos.length === 0 ? (
                    'None yet'
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {repos.map((r, i) => (
                        <li key={r.key} className="truncate">
                          {r.alias.trim() || `Repository ${i + 1}`}{' '}
                          <span className="text-small text-fg-3">· {CODEBASE_TYPE_LABEL[r.type]}</span>
                        </li>
                      ))}
                    </ul>
                  ),
              },
              { label: 'Worktree retention', content: RETENTION_OPTIONS.find((o) => o.value === retention)?.label },
              { label: 'Max codebases', content: maxCodebases },
            ]}
          />
        }
        actions={
          <ActionBar
            hint="Remote repositories clone in the background; progress shows in each codebase’s Logs."
            secondary={<Button onClick={() => navigate('/projects')}>Cancel</Button>}
            primary={
              <Button type="submit" variant="primary" disabled={!canSubmit} loading={submitting}>
                {createLabel}
              </Button>
            }
          />
        }
      />
    </form>
  );
}
