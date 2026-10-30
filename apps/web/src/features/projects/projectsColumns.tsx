// ────────────────────────────────────────────────────────────────
// ProjectsTable column bindings + ProjectRowMenu (B-26; 03-component-
// inventory-domain.md). Project flex (name + description) · Codebases 84 ·
// Active chats 120 · Last run 272 · Worktrees 76 · Updated 72 · menu 28.
// The G-13 summary feeds every count column (D-58); a count whose source is
// unavailable (`needsYou`/`running` while the attention service is off) is
// simply not shown — never an invented 0 (D-36).
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import { toStatus, type Project } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import type { DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';

const DASH = <span className="font-mono text-micro text-fg-3">—</span>;

function ActiveChatsCell({ project }: { project: Project }) {
  const s = project.summary;
  if (!s) return DASH;
  const extra = s.needsYou ? { tone: 'text-warn', text: `${s.needsYou} needs you` } : s.running ? { tone: 'text-run', text: `${s.running} running` } : null;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="font-mono text-small text-fg">{s.activeChats}</span>
      {extra ? <span className={cn('truncate text-small', extra.tone)}>{extra.text}</span> : null}
    </span>
  );
}

function LastRunCell({ project }: { project: Project }) {
  const run = project.summary?.lastRun;
  if (!run) return DASH;
  const status = toStatus('workflowRun', run.status);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {status ? <StatusBadge state={status.state} label={status.label} /> : null}
      <Link
        render={<RouterLink to={`/workflows/${run.definitionId}/runs/${run.runId}`} />}
        className="min-w-0 truncate text-small text-fg-2"
        onClick={(event) => event.stopPropagation()}
      >
        {run.name}
      </Link>
      <span className="shrink-0 font-mono text-micro text-fg-3">{formatRelativeTime(new Date(run.at))}</span>
    </span>
  );
}

function WorktreesCell({ project }: { project: Project }) {
  const w = project.summary?.worktrees;
  if (!w) return DASH;
  return (
    <span className="font-mono text-small text-fg">
      {w.active}
      {w.orphaned > 0 ? <span className="text-warn"> · {w.orphaned}</span> : null}
    </span>
  );
}

export const PROJECTS_COLUMNS: readonly DataTableColumn<Project>[] = [
  {
    id: 'project',
    header: 'Project',
    width: 'minmax(220px,1fr)',
    cell: (project) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon concept="projects" size={16} className="shrink-0 text-fg-3" />
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <Link render={<RouterLink to={`/projects/${project.id}`} />} className="truncate font-medium">
              {project.name}
            </Link>
            {project.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null}
          </span>
          {project.description ? <span className="truncate text-small text-fg-3">{project.description}</span> : null}
        </span>
      </span>
    ),
  },
  {
    id: 'codebases',
    header: 'Codebases',
    width: 84,
    align: 'end',
    cell: (project) => (project.summary ? <span className="font-mono text-small text-fg">{project.summary.codebases}</span> : DASH),
  },
  { id: 'chats', header: 'Active chats', width: 120, cell: (project) => <ActiveChatsCell project={project} /> },
  { id: 'lastRun', header: 'Last run', width: 272, hideBelow: 1000, cell: (project) => <LastRunCell project={project} /> },
  {
    id: 'worktrees',
    header: 'Worktrees',
    width: 76,
    align: 'end',
    hideBelow: 860,
    cell: (project) => <WorktreesCell project={project} />,
  },
  {
    id: 'updated',
    header: 'Updated',
    width: 72,
    align: 'end',
    mono: true,
    cell: (project) => formatRelativeTime(new Date(project.updatedAt)),
  },
];

export interface ProjectRowActions {
  onOpen: (project: Project) => void;
  onNewChat: (project: Project) => void;
  onAddCodebase: (project: Project) => void;
  onCopyRootPath: (project: Project) => void;
  onSettings: (project: Project) => void;
  onToggleArchive: (project: Project) => void;
  onDelete: (project: Project) => void;
}

/** ProjectRowMenu: Open · New chat in project · Add codebase… · — · Copy root path · Project settings · — · Archive · Delete project…. */
export function projectRowMenu(project: Project, actions: ProjectRowActions) {
  const archived = project.status === 'archived';
  const items: MenuButtonItem[] = [
    { id: 'open', label: 'Open project', icon: 'projects', onSelect: () => actions.onOpen(project) },
    { id: 'new-chat', label: 'New chat in project', icon: 'chats', onSelect: () => actions.onNewChat(project) },
    { id: 'add-codebase', label: 'Add codebase…', icon: 'plus', onSelect: () => actions.onAddCodebase(project) },
    { type: 'separator' },
    { id: 'copy-root', label: 'Copy root path', icon: 'copy', onSelect: () => actions.onCopyRootPath(project) },
    { id: 'settings', label: 'Project settings', icon: 'settings', onSelect: () => actions.onSettings(project) },
    { type: 'separator' },
    archived
      ? { id: 'unarchive', label: 'Unarchive', icon: 'undo', onSelect: () => actions.onToggleArchive(project) }
      : { id: 'archive', label: 'Archive', icon: 'archive', onSelect: () => actions.onToggleArchive(project) },
    { id: 'delete', label: 'Delete project…', icon: 'trash', danger: true, onSelect: () => actions.onDelete(project) },
  ];
  return <MenuButton label={`More actions for ${project.name}`} iconOnly icon="more" size="sm" items={items} />;
}
