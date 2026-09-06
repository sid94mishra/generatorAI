// ────────────────────────────────────────────────────────────────
// ProjectsListPage — All projects with search, a card / list view
// toggle, a per-project active/inactive switch, and delete. Inactive
// (archived) projects stay visible here so they can be re-activated,
// but are hidden from chat / workflow / automation pickers.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  FolderKanban,
  Calendar,
  Trash2,
  AlertCircle,
  LayoutGrid,
  List as ListIcon,
} from 'lucide-react';

import { useProjects, useDeleteProject, useUpdateProject } from '@/hooks/projectQueries.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { CardGridSkeleton } from '@/components/Skeleton.js';
import { SearchInput, EmptyState, Button, StatusBadge, PageHeader, Switch } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { Toolbar } from '@/components/layout/Toolbar.js';
import { cn } from '@/lib/utils.js';
import type { Project } from '@generatorai/shared';

type ViewMode = 'card' | 'list';
const VIEW_KEY = 'generatorai:projects:view';

function readView(): ViewMode {
  try { return (localStorage.getItem(VIEW_KEY) as ViewMode) ?? 'card'; } catch { return 'card'; }
}

function formatDate(date: string | Date): string {
  const d = new Date(date);
  const diffMins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function ProjectsListPage() {
  const navigate = useNavigate();
  const { data: projects, isLoading, error } = useProjects();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();

  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(() => readView());

  const setViewMode = (v: ViewMode) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };

  const filtered = useMemo(() => {
    if (!projects) return [];
    let result = [...projects];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q),
      );
    }
    // Active first, then most-recently updated.
    return result.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [projects, search]);

  const toggleActive = (project: Project) => {
    updateProject.mutate({ id: project.id, status: project.status === 'active' ? 'archived' : 'active' });
  };

  if (isLoading) {
    return (
      <PageContainer className="space-y-6">
        <PageHeader title="Projects" />
        <CardGridSkeleton count={6} />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <AlertCircle className="h-10 w-10 text-danger" />
        <p className="text-sm text-muted-foreground">Failed to load projects</p>
        <p className="text-xs text-danger">{String(error)}</p>
      </div>
    );
  }

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title="Manage Projects"
        actions={
          <Button
            variant="primary"
            onClick={() => navigate('/projects/new')}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            New Project
          </Button>
        }
      />

      {/* Search + view toggle */}
      <Toolbar className="flex-wrap sm:flex-nowrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search projects…"
          aria-label="Search projects"
          className="min-w-0 max-w-md flex-1"
        />
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-subtle p-0.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setViewMode('card')}
            className={cn(
              'h-auto w-auto gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
              view === 'card' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={view === 'card'}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Cards
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setViewMode('list')}
            className={cn(
              'h-auto w-auto gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
              view === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={view === 'list'}
          >
            <ListIcon className="h-3.5 w-3.5" /> List
          </Button>
        </div>
      </Toolbar>

      {/* Empty states */}
      {filtered.length === 0 && !search.trim() && (
        <EmptyState
          className="rounded-xl border border-dashed border-border"
          icon={<FolderKanban className="h-12 w-12" />}
          title="No projects yet"
          hint="Create a project to organize your codebases and workflows"
          action={
            <Button
              variant="primary"
              onClick={() => navigate('/projects/new')}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              Create First Project
            </Button>
          }
        />
      )}
      {filtered.length === 0 && search.trim() && (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title={<>No projects matching &ldquo;{search}&rdquo;</>}
        />
      )}

      {/* Card view */}
      {filtered.length > 0 && view === 'card' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => {
            const active = project.status === 'active';
            return (
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className={cn(
                  'group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-subtle/40',
                  !active && 'opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle text-primary">
                      <FolderKanban className="h-4.5 w-4.5" />
                    </span>
                    <h3 className="truncate text-sm font-semibold text-foreground">{project.name}</h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={active}
                      onCheckedChange={() => toggleActive(project)}
                      aria-label={`${active ? 'Deactivate' : 'Activate'} ${project.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(project.id)}
                      className="opacity-0 transition-opacity hover:bg-danger-muted hover:text-danger group-hover:opacity-100"
                      aria-label="Delete project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {project.description && (
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{project.description}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDate(project.updatedAt)}
                  </span>
                  <StatusBadge status={active ? 'active' : 'archived'} size="sm" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view */}
      {filtered.length > 0 && view === 'list' && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="divide-y divide-border">
            {filtered.map((project) => {
              const active = project.status === 'active';
              return (
                <div
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 bg-card px-4 py-3 transition-colors hover:bg-subtle',
                    !active && 'opacity-70',
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle text-primary">
                    <FolderKanban className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
                      <StatusBadge status={active ? 'active' : 'archived'} size="sm" />
                    </div>
                    {project.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{project.description}</p>
                    )}
                  </div>
                  <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                    <Calendar className="h-3 w-3" />
                    {formatDate(project.updatedAt)}
                  </span>
                  <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={active}
                      onCheckedChange={() => toggleActive(project)}
                      aria-label={`${active ? 'Deactivate' : 'Activate'} ${project.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(project.id)}
                      className="hover:bg-danger-muted hover:text-danger"
                      aria-label="Delete project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Project"
        description="This will permanently delete the project and all its codebases, configs, and worktrees. This action cannot be undone."
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteProject.mutateAsync(deleteTarget);
            setDeleteTarget(null);
          }
        }}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      />
    </PageContainer>
  );
}
