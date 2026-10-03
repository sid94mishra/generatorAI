// ────────────────────────────────────────────────────────────────
// ProjectsListPage (P5-02; T-01 ListPage; board Projects; 04-screen-map.md
// §2.4, §4.5 #45; F-projects-01).
//
// PageTitle "Projects · N" + New project; FilterBar: search, Active/Archived
// seg (counts), list/grid toggle; B-26 ProjectsTable with the G-13 summary
// columns and the ProjectRowMenu, or an EntityCard grid. Archived projects
// stay reachable here (Archived seg) so they can be unarchived.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import type { Project } from '@generatorai/shared';
import { useNewChatStore } from '@/stores/newChatStore.js';
import { useDeleteProject, useProjects, useUpdateProject } from '@/hooks/projectQueries.js';
import { copyTextToClipboard } from '@/utils/copyToClipboard.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { DataTable } from '@/ui/patterns/DataTable/DataTable.js';
import { CardGrid, EntityCard } from '@/ui/patterns/EntityCard/EntityCard.js';
import { FilterBar } from '@/ui/patterns/FilterBar/FilterBar.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { ListPage } from '@/ui/templates/ListPage/ListPage.js';
import { plural } from './projectFormat.js';
import { PROJECTS_COLUMNS, projectRowMenu, type ProjectRowActions } from './projectsColumns.js';

type ProjectSort = 'updated' | 'name' | 'created';
const time = (d: Date | string) => new Date(d).getTime();
/** Board Projects: the sort chip after the scope seg ("Updated"); the footnote names the order. */
const PROJECT_SORTS: Record<ProjectSort, { label: string; footer: string; compare: (a: Project, b: Project) => number }> = {
  updated: { label: 'Updated', footer: 'last update', compare: (a, b) => time(b.updatedAt) - time(a.updatedAt) },
  name: { label: 'Name', footer: 'name', compare: (a, b) => a.name.localeCompare(b.name) },
  created: { label: 'Created', footer: 'creation date', compare: (a, b) => time(b.createdAt) - time(a.createdAt) },
};

type Scope = 'active' | 'archived';
type ViewMode = 'list' | 'grid';
const VIEW_KEY = 'generatorai:projects:view';

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

export function ProjectsListPage() {
  const navigate = useNavigate();
  const { data: projects, isLoading, isError, error, refetch } = useProjects({ includeSummary: true });
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const confirmer = useConfirm();

  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<Scope>('active');
  const [sort, setSort] = useState<ProjectSort>('updated');
  const [view, setView] = useState<ViewMode>(readView);
  const openNewChat = useNewChatStore((s) => s.open);

  const setViewMode = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };

  const counts = useMemo(() => {
    const all = projects ?? [];
    return { active: all.filter((p) => p.status === 'active').length, archived: all.filter((p) => p.status === 'archived').length };
  }, [projects]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) => p.status === scope)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
      .sort(PROJECT_SORTS[sort].compare);
  }, [projects, search, scope, sort]);

  const actions: ProjectRowActions = {
    onOpen: (p) => navigate(`/projects/${p.id}`),
    onNewChat: (p) => openNewChat({ projectId: p.id }),
    onAddCodebase: (p) => navigate(`/projects/${p.id}/codebases?add=1`),
    onCopyRootPath: (p) => {
      copyTextToClipboard(p.rootPath).catch((err: unknown) => toast.error("Couldn't copy the root path", { description: String(err) }));
    },
    onSettings: (p) => navigate(`/projects/${p.id}/settings`),
    onToggleArchive: (p) => {
      const status = p.status === 'archived' ? 'active' : 'archived';
      updateProject.mutate(
        { id: p.id, status },
        { onError: (err) => toast.error(`Couldn't ${status === 'archived' ? 'archive' : 'unarchive'} "${p.name}"`, { description: String(err) }) },
      );
    },
    onDelete: (p) => void onDelete(p),
  };

  async function onDelete(project: Project) {
    const ok = await confirmer.confirm({
      title: `Delete ${project.name}?`,
      description: 'This permanently deletes the project and all its codebases, configs and worktrees. It can’t be undone.',
      confirmLabel: 'Delete project',
    });
    if (!ok) return;
    deleteProject.mutate(project.id, {
      onError: (err) => toast.error(`Couldn't delete "${project.name}"`, { description: String(err) }),
    });
  }

  const hasFilter = Boolean(search.trim());
  const newProject = (
    <Button variant="primary" icon="plus" onClick={() => navigate('/projects/new')}>
      New project
    </Button>
  );
  const empty = (
    <EmptyState
      framed
      icon={hasFilter ? 'search' : 'projects'}
      title={hasFilter ? 'No matching projects' : scope === 'archived' ? 'No archived projects' : 'No projects yet'}
      description={
        hasFilter
          ? `No ${scope} project matches “${search.trim()}”.`
          : scope === 'archived'
            ? 'Archived projects keep their codebases and worktrees until deleted.'
            : 'Create a project to group codebases and chats.'
      }
      action={
        hasFilter ? (
          <Button size="sm" onClick={() => setSearch('')}>
            Clear search
          </Button>
        ) : scope === 'active' ? (
          newProject
        ) : undefined
      }
    />
  );
  const errorState = isError ? (
    <EmptyState
      framed
      tone="error"
      icon="warning"
      title="Couldn't load projects"
      description={error instanceof Error ? error.message : String(error)}
      action={
        <Button size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      }
    />
  ) : undefined;

  const grid =
    isLoading ? (
      <SkeletonRows rows={4} label="Loading projects" />
    ) : errorState ?? (rows.length === 0 ? empty : (
      <CardGrid columns={3}>
        {rows.map((p) => (
          <EntityCard
            key={p.id}
            title={
              <Link render={<RouterLink to={`/projects/${p.id}`} />} className="truncate">
                {p.name}
              </Link>
            }
            badge={p.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : undefined}
            description={p.description}
            meta={[
              p.summary ? plural(p.summary.codebases, 'codebase') : null,
              p.summary ? `${p.summary.activeChats} active chats` : null,
              `updated ${formatRelativeTime(new Date(p.updatedAt))}`,
            ]
              .filter(Boolean)
              .join(' · ')}
            actions={projectRowMenu(p, actions)}
          />
        ))}
      </CardGrid>
    ));

  return (
    <>
      <ListPage
        header={<PageHeader title="Projects" />}
        title={<PageTitle title="Projects" count={projects ? counts.active : undefined} actions={newProject} />}
        filters={
          <FilterBar
            search={<SearchInput value={search} onValueChange={setSearch} label="Search projects" placeholder="Search projects" />}
            scope={
              <SegmentedControl<Scope>
                value={scope}
                onValueChange={setScope}
                semantics="tabs"
                label="Project status"
                items={[
                  { value: 'active', label: 'Active', count: projects ? counts.active : undefined },
                  { value: 'archived', label: 'Archived', count: projects ? counts.archived : undefined },
                ]}
              />
            }
            sort={
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Chip dropdown icon="sort">
                      {PROJECT_SORTS[sort].label}
                    </Chip>
                  }
                />
                <Menu.Popup align="end">
                  <Menu.RadioGroup value={sort} onValueChange={(next) => setSort(next as ProjectSort)}>
                    {(Object.keys(PROJECT_SORTS) as ProjectSort[]).map((key) => (
                      <Menu.RadioItem key={key} value={key}>
                        {PROJECT_SORTS[key].label}
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Root>
            }
            view={
              <SegmentedControl<ViewMode>
                value={view}
                onValueChange={setViewMode}
                label="Layout"
                items={[
                  { value: 'list', icon: 'list', ariaLabel: 'List view' },
                  { value: 'grid', icon: 'widgets', ariaLabel: 'Grid view' },
                ]}
              />
            }
          />
        }
        content={
          view === 'grid' ? (
            grid
          ) : (
            <DataTable<Project>
              label="Projects"
              columns={PROJECTS_COLUMNS}
              rows={rows}
              getRowId={(p) => p.id}
              onRowClick={(p) => navigate(`/projects/${p.id}`)}
              rowActions={(p) => projectRowMenu(p, actions)}
              actionsWidth={40}
              loading={isLoading}
              error={errorState}
              empty={empty}
            />
          )
        }
        footer={rows.length > 0 ? `Sorted by ${PROJECT_SORTS[sort].footer}. Archived projects keep their codebases and worktrees until deleted.` : undefined}
      />
      {confirmer.dialog}
    </>
  );
}
