// ────────────────────────────────────────────────────────────────
// ChatsTable column bindings (B-26 EntityTable bindings; 03-component-
// inventory-domain.md §2.5): checkbox · Title flex · Project 140 ·
// Agent 150 (Avatar 20 + name) · Status 96 · Changes 88 (± mono) ·
// Activity 72 · actions 56. Row menu: Pin/Unpin and Mark as read/unread
// (D-83, when the page passes them), Archive/Unarchive, Delete.
// The title carries the pin glyph and the unread dot (MG-02 data; the server
// lists pinned chats first, so the glyph explains the order).
// A block since P5-04: ChatsList and the ProjectDetail Chats tab share it.
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import type { ChatRowModel } from '@generatorai/shared/ui-contract';
import type { DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';

/** The Status column: a StatusBadge, a neutral "Archived" chip, or a dash (never ran). */
function StatusCell({ row }: { row: ChatRowModel }) {
  if (row.archived) return <Badge tone="neutral">Archived</Badge>;
  if (row.status) return <StatusBadge state={row.status.state} label={row.status.label} context="chat" />;
  return <span className="font-mono text-micro text-fg-3">—</span>;
}

/** The Changes column: "±" mono; a dash until G-02's stats are computed (D-36) or when nothing changed. */
function ChangesCell({ row }: { row: ChatRowModel }) {
  if (!row.changes || (row.changes.additions === 0 && row.changes.deletions === 0)) {
    return <span className="font-mono text-micro text-fg-3">—</span>;
  }
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
      <span className="flex min-w-0 items-center gap-1.5">
        <Link render={<RouterLink to={`/chats/${row.id}`} />} className={cn('truncate', row.unread && 'font-semibold')}>
          {row.title}
        </Link>
        {row.pinned ? <Icon concept="pin" size={12} label="Pinned" className="shrink-0 text-fg-3" /> : null}
        {row.unread ? <StatusDot tone="accent" size="sm" label="Unread" /> : null}
      </span>
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
  /** Pin (true) or unpin (false) — MG-02, shared with mobile. */
  onPin?: (row: ChatRowModel, pinned: boolean) => void;
  /** Mark unread (true) or read (false) — MG-02 / MD-112. */
  onMarkUnread?: (row: ChatRowModel, unread: boolean) => void;
}

/** The row menu: Pin/Unpin and Mark as read/unread, Archive/Unarchive (lifecycle), Delete (danger, confirmed by the caller). */
export function chatRowActions(
  row: ChatRowModel,
  { onArchive, onUnarchive, onDelete, onPin, onMarkUnread }: ChatRowActionsCallbacks,
) {
  const items: MenuButtonItem[] = [];
  if (onPin) {
    items.push(
      row.pinned
        ? { id: 'unpin', label: 'Unpin', icon: 'pin', onSelect: () => onPin(row, false) }
        : { id: 'pin', label: 'Pin', icon: 'pin', onSelect: () => onPin(row, true) },
    );
  }
  if (onMarkUnread) {
    items.push(
      row.unread
        ? { id: 'mark-read', label: 'Mark as read', icon: 'chats', onSelect: () => onMarkUnread(row, false) }
        : { id: 'mark-unread', label: 'Mark as unread', icon: 'chats', onSelect: () => onMarkUnread(row, true) },
    );
  }
  if (items.length > 0) items.push({ type: 'separator' });
  items.push(
    row.archived
      ? { id: 'unarchive', label: 'Unarchive', icon: 'undo', onSelect: () => onUnarchive(row) }
      : { id: 'archive', label: 'Archive', icon: 'archive', onSelect: () => onArchive(row) },
  );
  items.push(
    { type: 'separator' },
    { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: () => onDelete(row) },
  );
  return <MenuButton label={`More actions for ${row.title}`} iconOnly icon="more" items={items} />;
}
