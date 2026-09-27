// ────────────────────────────────────────────────────────────────
// ChatsTable column bindings (B-26 EntityTable bindings; 03-component-
// inventory-domain.md §2.5): checkbox · Title flex · Project 140 ·
// Agent 150 (Avatar 20 + name) · Status 96 · Changes 88 (± mono) ·
// Activity 72 · actions 56. Row menu: Archive/Unarchive, Delete.
// A block since P5-04: ChatsList and the ProjectDetail Chats tab share it.
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import type { ChatRowModel } from '@generatorai/shared/ui-contract';
import type { DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';

/** The Status column: a StatusBadge, a neutral "Archived" chip, or a dash (never ran). */
function StatusCell({ row }: { row: ChatRowModel }) {
  if (row.archived) return <Badge tone="neutral">Archived</Badge>;
  if (row.status) return <StatusBadge state={row.status.state} label={row.status.label} context="chat" />;
  return <span className="font-mono text-micro text-fg-3">—</span>;
}

/** The Changes column: "±" mono, or a dash until G-02's stats are computed (D-36). */
function ChangesCell({ row }: { row: ChatRowModel }) {
  if (!row.changes) return <span className="font-mono text-micro text-fg-3">—</span>;
  return (
    <span className="font-mono text-micro">
      <span className="text-ok">+{row.changes.additions}</span>{' '}
      <span className="text-err">−{row.changes.deletions}</span>
    </span>
  );
}

export const CHATS_COLUMNS: readonly DataTableColumn<ChatRowModel>[] = [
  {
    id: 'title',
    header: 'Title',
    width: 'minmax(240px,1fr)',
    cell: (row) => (
      <Link render={<RouterLink to={`/chats/${row.id}`} />} className="truncate">
        {row.title}
      </Link>
    ),
  },
  {
    id: 'project',
    header: 'Project',
    width: 140,
    hideBelow: 1080,
    cell: (row) => <span className="truncate text-small text-fg-2">{row.projectName ?? '—'}</span>,
  },
  {
    id: 'agent',
    header: 'Agent',
    width: 150,
    cell: (row) =>
      row.agentName ? (
        <span className="flex min-w-0 items-center gap-2 text-fg-2">
          <Avatar name={row.agentName} size={20} decorative />
          <span className="truncate">{row.agentName}</span>
        </span>
      ) : (
        <span className="text-small text-fg-3">—</span>
      ),
  },
  { id: 'status', header: 'Status', width: 96, cell: (row) => <StatusCell row={row} /> },
  {
    id: 'changes',
    header: 'Changes',
    width: 88,
    align: 'end',
    hideBelow: 1080,
    cell: (row) => <ChangesCell row={row} />,
  },
  {
    id: 'activity',
    header: 'Activity',
    width: 72,
    align: 'end',
    mono: true,
    cell: (row) => formatRelativeTime(new Date(row.lastActivityAt)),
  },
] as const;

export interface ChatRowActionsCallbacks {
  onArchive: (row: ChatRowModel) => void;
  onUnarchive: (row: ChatRowModel) => void;
  onDelete: (row: ChatRowModel) => void;
}

/** The row menu: Archive/Unarchive (lifecycle), Delete (danger, confirmed by the caller). */
export function chatRowActions(row: ChatRowModel, { onArchive, onUnarchive, onDelete }: ChatRowActionsCallbacks) {
  const items: MenuButtonItem[] = row.archived
    ? [{ id: 'unarchive', label: 'Unarchive', icon: 'undo', onSelect: () => onUnarchive(row) }]
    : [{ id: 'archive', label: 'Archive', icon: 'archive', onSelect: () => onArchive(row) }];
  items.push(
    { type: 'separator' },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: () => onDelete(row) },
  );
  return <MenuButton label={`More actions for ${row.title}`} iconOnly icon="more" items={items} />;
}
