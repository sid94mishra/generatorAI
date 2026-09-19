// ────────────────────────────────────────────────────────────────
// CreateProjectPage — Create a new project, optionally with one or more
// repositories (codebases) added up-front. On submit the project is
// created first, then each repository is linked in sequence.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FolderKanban, FolderOpen, Plus, Trash2, GitBranch } from 'lucide-react';
import { useCreateProject, useLinkCodebase } from '@/hooks/projectQueries.js';
import { toast } from '@/components/Toast.js';
import { Select, Button, Input, Textarea, PageHeader } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { cn } from '@/lib/utils.js';
import { DirectoryBrowser } from '@/components/chat/sources/DirectoryBrowser.js';
import type { ProjectSettings, CodebaseType } from '@generatorai/shared';

interface RepoDraft {
  id: string;
  alias: string;
  type: CodebaseType;
  url: string;
  localPath: string;
  branch: string;
}

function newRepo(): RepoDraft {
  return { id: `repo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, alias: '', type: 'git-remote', url: '', localPath: '', branch: '' };
}

function repoValid(r: RepoDraft): boolean {
  if (!r.alias.trim()) return false;
  return r.type === 'git-remote' ? !!r.url.trim() : !!r.localPath.trim();
}

export function CreateProjectPage() {
  const navigate = useNavigate();
  const createProject = useCreateProject();
  const linkCodebase = useLinkCodebase();

  const [name, setName] = useState('');
  /** Repo row whose folder picker is open, or null. */
  const [browsingRepoId, setBrowsingRepoId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [worktreeRetention, setWorktreeRetention] = useState<'immediate' | 'hours-24' | 'hours-72' | 'manual'>('hours-24');
  const [maxCodebases, setMaxCodebases] = useState(10);
  const [repos, setRepos] = useState<RepoDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const updateRepo = (id: string, patch: Partial<RepoDraft>) =>
    setRepos((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Every added repo row must be complete before the form can submit.
  const reposValid = repos.every(repoValid);
  const canSubmit = !!name.trim() && reposValid && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !reposValid) return;
    setSubmitting(true);

    const settings: Partial<ProjectSettings> = { worktreeRetention, maxCodebases };

    try {
      const project = await createProject.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        settings,
      });

      // Link each repository. Failures are surfaced but don't block navigation.
      let linked = 0;
      for (const r of repos) {
        try {
          await linkCodebase.mutateAsync({
            projectId: project.id,
            alias: r.alias.trim(),
            type: r.type,
            url: r.type === 'git-remote' ? r.url.trim() : undefined,
            localPath: r.type !== 'git-remote' ? r.localPath.trim() : undefined,
            defaultBranch: r.branch.trim() || undefined,
          });
          linked += 1;
        } catch (err) {
          toast({ variant: 'error', title: `Failed to add "${r.alias.trim()}"`, description: err instanceof Error ? err.message : String(err) });
        }
      }

      if (repos.length > 0) {
        toast({ variant: 'success', title: 'Project created', description: `${linked} of ${repos.length} repositories linked${linked ? ' — cloning in progress' : ''}.` });
      }
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to create project', description: err instanceof Error ? err.message : String(err) });
      setSubmitting(false);
    }
  };

  return (
    <PageContainer variant="narrow" className="max-w-2xl space-y-6">
      <Button
        type="button"
        variant="ghost"
        onClick={() => navigate('/projects')}
        className="flex h-auto items-center gap-1.5 rounded-none px-0 py-0.5 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Projects
      </Button>

      <PageHeader
        leading={
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <FolderKanban className="h-5 w-5 text-primary" />
          </div>
        }
        title="Create Project"
        subtitle="Organize codebases, configs, and scoped workflows"
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Project Name<span className="text-danger">*</span>
          </label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., E-Commerce Platform"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What codebases and workflows does this project group?"
          />
        </div>

        {/* Settings */}
        <div className="space-y-4 rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground">Settings</h3>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Worktree Retention Policy</label>
            <Select
              value={worktreeRetention}
              onChange={(v) => setWorktreeRetention(v as typeof worktreeRetention)}
              aria-label="Worktree Retention Policy"
              options={[
                { value: 'immediate', label: 'Immediate cleanup' },
                { value: 'hours-24', label: 'Keep for 24 hours' },
                { value: 'hours-72', label: 'Keep for 72 hours' },
                { value: 'manual', label: 'Manual cleanup only' },
              ]}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Max Codebases</label>
            <Input
              type="number"
              value={maxCodebases}
              onChange={(e) => setMaxCodebases(Math.max(1, Math.min(50, Number(e.target.value))))}
              min={1}
              max={50}
              aria-label="Max Codebases"
            />
          </div>
        </div>

        {/* Repositories */}
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-foreground">Repositories</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Optionally add one or more repositories now — they'll be linked when the project is created.</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setRepos((cur) => [...cur, newRepo()])}
            >
              Add repository
            </Button>
          </div>

          {repos.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border py-6 text-center">
              <GitBranch className="h-6 w-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">No repositories added. You can also add them later.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {repos.map((r, i) => (
                <div key={r.id} className="rounded-lg border border-border bg-subtle/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">Repository {i + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setRepos((cur) => cur.filter((x) => x.id !== r.id))}
                      aria-label="Remove repository"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-muted-foreground">Alias*</label>
                      <Input
                        value={r.alias}
                        onChange={(e) => updateRepo(r.id, { alias: e.target.value })}
                        className="mt-0.5 text-xs"
                        placeholder="frontend"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground">Type</label>
                      <Select
                        value={r.type}
                        onChange={(v) => updateRepo(r.id, { type: v as CodebaseType })}
                        className="mt-0.5"
                        aria-label={`Repository ${i + 1} type`}
                        options={[
                          { value: 'git-remote', label: 'Remote Git Repo' },
                          { value: 'git-local', label: 'Local Git Repo' },
                          { value: 'local-dir', label: 'Local Directory' },
                        ]}
                      />
                    </div>
                  </div>
                  {r.type === 'git-remote' ? (
                    <div className="mt-3">
                      <label className="block text-[10px] text-muted-foreground">Repository URL*</label>
                      <Input
                        value={r.url}
                        onChange={(e) => updateRepo(r.id, { url: e.target.value })}
                        className="mt-0.5 font-mono text-xs"
                        placeholder="https://github.com/org/repo.git"
                      />
                    </div>
                  ) : (
                    <div className="mt-3">
                      <label className="block text-[10px] text-muted-foreground">Local Path*</label>
                      {/* Browse, not just type: the path is on the SERVER host,
                          so the OS file picker would answer for the wrong
                          machine whenever the two differ. */}
                      <div className="mt-0.5 flex items-center gap-2">
                        <Input
                          value={r.localPath}
                          onChange={(e) => updateRepo(r.id, { localPath: e.target.value })}
                          className="font-mono text-xs"
                          placeholder="/path/to/repo"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          leftIcon={<FolderOpen className="h-3.5 w-3.5" />}
                          onClick={() => setBrowsingRepoId(r.id)}
                        >
                          Browse
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="mt-3">
                    <label className="block text-[10px] text-muted-foreground">Default Branch</label>
                    <Input
                      value={r.branch}
                      onChange={(e) => updateRepo(r.id, { branch: e.target.value })}
                      className="mt-0.5 text-xs"
                      placeholder="main (optional)"
                    />
                  </div>
                  {!repoValid(r) && (
                    <p className={cn('mt-2 text-[10px] text-warning')}>
                      Provide an alias and {r.type === 'git-remote' ? 'a repository URL' : 'a local path'}.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => navigate('/projects')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit} loading={submitting}>
            {repos.length > 0 ? `Create Project + ${repos.length} Repo${repos.length > 1 ? 's' : ''}` : 'Create Project'}
          </Button>
        </div>
      </form>

      <DirectoryBrowser
        open={browsingRepoId !== null}
        onClose={() => setBrowsingRepoId(null)}
        onPick={(picked) => {
          if (browsingRepoId) updateRepo(browsingRepoId, { localPath: picked });
          setBrowsingRepoId(null);
        }}
        initialPath={repos.find((r) => r.id === browsingRepoId)?.localPath || undefined}
      />
    </PageContainer>
  );
}
