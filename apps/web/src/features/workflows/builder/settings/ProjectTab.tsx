// ────────────────────────────────────────────────────────────────
// Project tab: the owning project (`workflow.projectId`) and the run
// lifecycle — the codebases a run mounts (up to 3), whether they mount as
// worktrees, whether a run needs one, and the post-processing flags
// (commit, push the work branch, open a pull request).
// ────────────────────────────────────────────────────────────────

import { useShallow } from 'zustand/react/shallow';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useProjectCodebases, useProjects } from '@/hooks/projectQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { FieldIssues } from '../fields/FieldIssues.js';
import { InspectorNote, InspectorRow, InspectorSection } from '../fields/InspectorLayout.js';

const MAX_CODEBASES = 3;
/** The Select's value for "no project" (a global workflow). */
const NO_PROJECT = '__none__';

function Option({ title, description }: { title: string; description: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-ui text-fg">{title}</span>
      <span className="text-small text-fg-3">{description}</span>
    </span>
  );
}

export function ProjectTab() {
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? null);
  const lifecycle = useWorkflowBuilderStore((s) => s.workflow.lifecycle);
  const { autoCommit, autoPush, autoCreatePR } = useWorkflowBuilderStore(useShallow((s) => s.workflow.lifecycle.postProcessing));
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const setProjectId = useWorkflowBuilderStore((s) => s.setProjectId);
  const setCodebaseAliases = useWorkflowBuilderStore((s) => s.setCodebaseAliases);
  const setPostProcessing = useWorkflowBuilderStore((s) => s.setPostProcessing);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);

  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: codebases, isLoading: codebasesLoading } = useProjectCodebases(projectId ?? undefined);
  const selected = lifecycle.codebaseAliases;

  const toggleCodebase = (alias: string) => {
    if (selected.includes(alias)) {
      setCodebaseAliases(selected.filter((a) => a !== alias));
      return;
    }
    if (selected.length >= MAX_CODEBASES) return;
    if (!codebases?.some((c) => c.alias === alias)) return;
    setCodebaseAliases([...selected, alias]);
  };

  const projectItems = [
    { value: NO_PROJECT, label: 'No project (global workflow)' },
    ...(projects ?? []).filter((p) => p.status === 'active' || p.id === projectId).map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <>
      <InspectorSection title="Project">
        <InspectorRow label="Project" hint="Link a project to access its codebases and artifacts.">
          <Select
            id="project-select"
            aria-label="Project"
            size="sm"
            value={projectId ?? NO_PROJECT}
            // The store's setProjectId also clears the selected codebases.
            onValueChange={(v) => setProjectId(!v || v === NO_PROJECT ? null : v)}
            placeholder={projectsLoading ? 'Loading projects…' : undefined}
            items={projectItems}
          />
          <FieldIssues issues={issues.filter((i) => i.path === '/workflow/projectId')} />
        </InspectorRow>
      </InspectorSection>

      {projectId ? (
        <InspectorSection title="Codebases" count={`${selected.length}/${MAX_CODEBASES}`} data-testid="workflow-codebases">
          <Callout tone="info">
            Select up to {MAX_CODEBASES} codebases. Worktrees are created per run. Use{' '}
            <span className="font-mono">{'{{run.codebases.<alias>.path}}'}</span> in prompts.
          </Callout>
          {codebasesLoading ? (
            <p className="flex items-center gap-2 text-small text-fg-3">
              <Spinner size={14} /> Loading codebases…
            </p>
          ) : !codebases || codebases.length === 0 ? (
            <p className="rounded-card border border-dashed border-line px-3 py-4 text-center text-small text-fg-3">
              No codebases linked to this project. Link codebases in the project settings first.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {codebases.map((codebase) => {
                const isSelected = selected.includes(codebase.alias);
                const notReady = codebase.status !== 'ready';
                const disabled = notReady || (!isSelected && selected.length >= MAX_CODEBASES);
                return (
                  <li key={codebase.id} className="rounded-card border border-line-soft px-3 py-2">
                    <Checkbox
                      className="items-start"
                      checked={isSelected}
                      disabled={disabled}
                      onCheckedChange={() => toggleCodebase(codebase.alias)}
                      label={
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-ui text-fg">{codebase.alias}</span>
                            <Badge tone={codebase.status === 'ready' ? 'ok' : codebase.status === 'cloning' ? 'warn' : 'err'}>
                              {codebase.status}
                            </Badge>
                          </span>
                          <span className="truncate text-small text-fg-3">
                            {codebase.url ?? codebase.localPath ?? 'local'}
                            {codebase.defaultBranch ? ` · ${codebase.defaultBranch}` : ''}
                          </span>
                        </span>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <FieldIssues issues={issues.filter((i) => i.path.startsWith('/workflow/lifecycle/codebaseAliases'))} />
          <div className="flex flex-col gap-2">
            <Switch
              checked={lifecycle.useWorktree}
              onCheckedChange={(useWorktree) => updateWorkflow({ lifecycle: { ...lifecycle, useWorktree } })}
              label="Mount codebases as isolated worktrees"
            />
            <InspectorNote>Off mounts the checkout in place: the run edits it directly.</InspectorNote>
            <Switch
              checked={lifecycle.requiresCodebase}
              onCheckedChange={(requiresCodebase) => updateWorkflow({ lifecycle: { ...lifecycle, requiresCodebase } })}
              label="Refuse to start without a codebase"
            />
          </div>
        </InspectorSection>
      ) : null}

      {selected.length > 0 ? (
        <InspectorSection title="Post-processing" hint="After the stages complete">
          <Checkbox
            checked={autoCommit}
            onCheckedChange={(v) => setPostProcessing('autoCommit', v)}
            data-testid="workflow-auto-commit"
            className="items-start"
            label={<Option title="Auto-commit changes" description="Commit the run's changes to the work branch when the workflow completes." />}
          />
          <Checkbox
            checked={autoPush}
            disabled={!autoCommit}
            onCheckedChange={(v) => setPostProcessing('autoPush', v)}
            data-testid="workflow-auto-push"
            className="items-start"
            label={<Option title="Push the work branch" description="Push after committing. Never to the default branch — the run cuts a work branch first." />}
          />
          <Checkbox
            checked={autoCreatePR}
            disabled={!autoCommit}
            onCheckedChange={(v) => setPostProcessing('autoCreatePR', v)}
            data-testid="workflow-auto-create-pr"
            className="items-start"
            label={
              <Option
                title="Auto-create pull request"
                description="Create a PR after committing changes. Requires the GitHub CLI (gh) to be installed."
              />
            }
          />
          <FieldIssues issues={issues.filter((i) => i.path.startsWith('/workflow/lifecycle/postProcessing'))} />
        </InspectorSection>
      ) : null}
    </>
  );
}
