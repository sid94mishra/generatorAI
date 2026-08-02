// ────────────────────────────────────────────────────────────────
// ProjectCodebasesTab — Project selector, codebase picker, post-processing
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { Info, GitBranch } from 'lucide-react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useProjects, useProjectCodebases } from '@/hooks/projectQueries.js';
import { Badge, Select, Spinner } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';

const MAX_CODEBASES = 3;

export function ProjectCodebasesTab() {
  const projectId = useWorkflowBuilderStore((s) => s.projectId);
  const setProjectId = useWorkflowBuilderStore((s) => s.setProjectId);
  const selectedCodebases = useWorkflowBuilderStore((s) => s.selectedCodebases);
  const setSelectedCodebases = useWorkflowBuilderStore((s) => s.setSelectedCodebases);
  const gitRepositories = useWorkflowBuilderStore((s) => s.gitRepositories);
  const setGitRepositories = useWorkflowBuilderStore((s) => s.setGitRepositories);
  const autoCommit = useWorkflowBuilderStore((s) => s.autoCommit);
  const setAutoCommit = useWorkflowBuilderStore((s) => s.setAutoCommit);
  const autoCreatePR = useWorkflowBuilderStore((s) => s.autoCreatePR);
  const setAutoCreatePR = useWorkflowBuilderStore((s) => s.setAutoCreatePR);

  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: codebases, isLoading: codebasesLoading } = useProjectCodebases(projectId ?? undefined);

  const handleProjectChange = useCallback(
    (newProjectId: string) => {
      setProjectId(newProjectId || null);
      // Store's setProjectId already clears selectedCodebases
      setGitRepositories([]);
    },
    [setProjectId, setGitRepositories],
  );

  const toggleCodebase = useCallback(
    (alias: string) => {
      if (selectedCodebases.includes(alias)) {
        setSelectedCodebases(selectedCodebases.filter((a) => a !== alias));
        setGitRepositories(gitRepositories.filter((r) => r.alias !== alias));
      } else {
        if (selectedCodebases.length >= MAX_CODEBASES) return;
        const codebase = codebases?.find((c) => c.alias === alias);
        if (!codebase) return;
        setSelectedCodebases([...selectedCodebases, alias]);
        setGitRepositories([
          ...gitRepositories,
          {
            url: codebase.url ?? codebase.localPath ?? '',
            branch: codebase.defaultBranch,
            alias: codebase.alias,
          },
        ]);
      }
    },
    [selectedCodebases, setSelectedCodebases, gitRepositories, setGitRepositories, codebases],
  );

  return (
    <div className="space-y-6">
      {/* Project Selector */}
      <div>
        <label htmlFor="project-select" className="mb-1.5 block text-sm font-medium text-foreground">
          Project
        </label>
        <Select
          id="project-select"
          value={projectId ?? ''}
          onChange={(v) => handleProjectChange(v)}
          placeholder={projectsLoading ? 'Loading projects…' : undefined}
          options={[
            { value: '', label: 'No Project (Global Workflow)' },
            ...(projects ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Link a project to access its codebases and artifacts.
        </p>
      </div>

      {/* Codebases */}
      {projectId && (
        <div>
          <div className="mb-3 flex items-center gap-1 rounded-md bg-info-muted px-3 py-2 text-xs text-info">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>Select up to {MAX_CODEBASES} codebases. Worktrees are created per run. Use {'{{alias}}/path'} in prompts.</span>
          </div>

          <label className="mb-2 block text-sm font-medium text-foreground">
            Codebases
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({selectedCodebases.length}/{MAX_CODEBASES} selected)
            </span>
          </label>

          {codebasesLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Spinner size="sm" /> Loading codebases...
            </div>
          ) : !codebases || codebases.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No codebases linked to this project. Link codebases in the project settings first.
            </p>
          ) : (
            <div className="space-y-2">
              {codebases.map((codebase) => {
                const isSelected = selectedCodebases.includes(codebase.alias);
                const isDisabled = !isSelected && selectedCodebases.length >= MAX_CODEBASES;
                const notReady = codebase.status !== 'ready';
                return (
                  <label
                    key={codebase.id}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3 transition-all',
                      notReady
                        ? 'opacity-50 cursor-not-allowed border-border'
                        : isSelected
                          ? 'border-primary bg-primary/5 cursor-pointer'
                          : isDisabled
                            ? 'opacity-50 cursor-not-allowed border-border'
                            : 'border-border hover:border-primary/50 cursor-pointer',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDisabled || notReady}
                      onChange={() => toggleCodebase(codebase.alias)}
                      className="mt-0.5 h-4 w-4 rounded text-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">
                          {codebase.alias}
                        </span>
                        <Badge
                          tone={codebase.status === 'ready' ? 'success' : codebase.status === 'cloning' ? 'warning' : 'danger'}
                          size="sm"
                        >
                          {codebase.status}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground truncate">
                        {codebase.url ?? codebase.localPath ?? 'local'}
                        {codebase.defaultBranch && ` · ${codebase.defaultBranch}`}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Post-Processing Options */}
      {selectedCodebases.length > 0 && (
        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            Post-Processing
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer transition-all hover:border-primary/50">
              <input
                type="checkbox"
                checked={autoCommit}
                onChange={(e) => setAutoCommit(e.target.checked)}
                className="h-4 w-4 rounded text-primary"
              />
              <div>
                <div className="text-sm font-medium text-foreground">
                  Auto-commit changes
                </div>
                <div className="text-xs text-muted-foreground">
                  Automatically commit and push generated changes to the feature branch after workflow completes.
                </div>
              </div>
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer transition-all hover:border-primary/50">
              <input
                type="checkbox"
                checked={autoCreatePR}
                onChange={(e) => setAutoCreatePR(e.target.checked)}
                className="h-4 w-4 rounded text-primary"
              />
              <div>
                <div className="text-sm font-medium text-foreground">
                  Auto-create Pull Request
                </div>
                <div className="text-xs text-muted-foreground">
                  Automatically create a PR after committing changes. Requires GitHub CLI (gh) to be installed.
                </div>
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
