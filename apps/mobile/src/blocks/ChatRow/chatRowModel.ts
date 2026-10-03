// MB-48 ChatRow model (03 MB-48; MD-52, MD-60, MDF-57; MG-02, MG-03): what one chat row shows and offers, pure.
// The row contract is client-core's `toChatRowModel` (shared with web); this adds the mobile parts — the leading
// glyph, the meta parts, the menu and the swipe actions — so the list, Home and the palette render one shape.
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { StatusState } from '@generatorai/shared';
import { displayChatTitle, type ChatRowModel } from '@generatorai/shared/ui-contract';
import type { RowPosition } from '../../ui/layout/ListSection/ListSection.types';

export type ChatRowActionId = 'open' | 'pin' | 'unpin' | 'mark-unread' | 'mark-read' | 'stop' | 'archive' | 'unarchive' | 'delete' | 'more';

/** One menu entry (the kit's `MenuEntry` shape, kept structural so this file stays React-free). */
export type ChatRowMenuEntry =
  | { id: ChatRowActionId; label: string; icon: MobileIconConcept; destructive?: boolean; testID?: string }
  | { type: 'separator' };

export interface ChatRowSwipe {
  id: ChatRowActionId;
  label: string;
  icon: MobileIconConcept;
  tone: 'neutral' | 'strong';
}

export interface ChatRowView {
  id: string;
  title: string;
  /** The status glyph (none for a chat that never ran, MB-48). */
  status: StatusState | null;
  archived: boolean;
  pinned: boolean;
  unread: boolean;
  /** Mono project name, absent without a project. */
  project?: string;
  /** Agent name (AgentGlyph) **or** the model label (MG-03), never both. */
  agent?: string;
  model?: string;
  changes?: ChatRowModel['changes'];
  time: string;
  /** Running chats offer Stop (MDF-57). */
  stoppable: boolean;
}

/** Orchestrator workers carry the server's "⚙ " marker in their names; shared with web (ui-contract). */
export { displayChatTitle };

export function chatRowView(model: ChatRowModel): ChatRowView {
  const status = model.status?.state ?? null;
  return {
    id: model.id,
    title: displayChatTitle(model.title),
    status: model.archived ? null : status,
    archived: model.archived,
    pinned: model.pinned === true,
    unread: model.unread === true,
    ...(model.projectName ? { project: model.projectName } : {}),
    ...(model.agentName ? { agent: model.agentName } : model.modelLabel ? { model: model.modelLabel } : {}),
    ...(model.changes ? { changes: model.changes } : {}),
    time: model.lastActivityAt,
    stoppable: !model.archived && status === 'running',
  };
}

/** Long-press menu (MDF-57): Open · Pin / Mark unread · Stop | Archive | Delete… (destructive, confirmed). */
export function chatRowMenu(row: ChatRowView): ChatRowMenuEntry[] {
  const entries: ChatRowMenuEntry[] = [{ id: 'open', label: 'Open', icon: 'chats' }];
  if (!row.archived) {
    entries.push(row.pinned ? { id: 'unpin', label: 'Unpin', icon: 'pin' } : { id: 'pin', label: 'Pin', icon: 'pin' });
    entries.push(row.unread ? { id: 'mark-read', label: 'Mark as read', icon: 'message' } : { id: 'mark-unread', label: 'Mark unread', icon: 'message' });
  }
  if (row.stoppable) entries.push({ id: 'stop', label: 'Stop', icon: 'stop' });
  entries.push({ type: 'separator' });
  entries.push(row.archived ? { id: 'unarchive', label: 'Unarchive', icon: 'archive' } : { id: 'archive', label: 'Archive', icon: 'archive' });
  entries.push({ type: 'separator' });
  entries.push({ id: 'delete', label: 'Delete…', icon: 'trash', destructive: true });
  return entries;
}

/**
 * Swipe actions (MD-52): leading Pin / Mark unread (MG-02; the kit draws them on iOS only), trailing More / Archive.
 * A full swipe runs only the reversible Archive (undo snackbar, MD-26); never Delete.
 */
export function chatRowSwipe(row: ChatRowView): { leading: ChatRowSwipe[]; trailing: ChatRowSwipe[] } {
  const leading: ChatRowSwipe[] = row.archived
    ? []
    : [
        row.pinned ? { id: 'unpin', label: 'Unpin', icon: 'pin', tone: 'neutral' } : { id: 'pin', label: 'Pin', icon: 'pin', tone: 'neutral' },
        row.unread ? { id: 'mark-read', label: 'Read', icon: 'message', tone: 'strong' } : { id: 'mark-unread', label: 'Unread', icon: 'message', tone: 'strong' },
      ];
  const trailing: ChatRowSwipe[] = [
    { id: 'more', label: 'More', icon: 'more', tone: 'neutral' },
    row.archived ? { id: 'unarchive', label: 'Unarchive', icon: 'archive', tone: 'strong' } : { id: 'archive', label: 'Archive', icon: 'archive', tone: 'strong' },
  ];
  return { leading, trailing };
}

export type ChatListEntry =
  | { type: 'header'; key: string; title: 'Pinned' | 'Recent'; count?: number }
  /** `position` places the row in its section's iOS inset group (MChats); absent in flat lists. */
  | { type: 'row'; key: string; row: ChatRowView; position?: RowPosition };

function positioned(rows: readonly ChatRowView[]): ChatListEntry[] {
  return rows.map((row, i) => ({
    type: 'row',
    key: row.id,
    row,
    position: rows.length === 1 ? 'only' : i === 0 ? 'first' : i === rows.length - 1 ? 'last' : 'middle',
  }));
}

/**
 * The list body: a "Pinned" section (only when a row is pinned, MG-02) then "Recent" (MChats: on iOS each section is
 * an inset rounded group, so rows carry their position; Android stays flat). The server returns pinned rows first on
 * the first page, so the split is stable while pages append. Archived and search results stay flat.
 */
export function chatListEntries(rows: readonly ChatRowView[], options: { flat: boolean }): ChatListEntry[] {
  if (options.flat) return rows.map((row) => ({ type: 'row', key: row.id, row }));
  const pinned = rows.filter((r) => r.pinned);
  if (pinned.length === 0) return positioned(rows);
  const rest = rows.filter((r) => !r.pinned);
  return [
    { type: 'header', key: 'h-pinned', title: 'Pinned' },
    ...positioned(pinned),
    ...(rest.length ? [{ type: 'header' as const, key: 'h-recent', title: 'Recent' as const }, ...positioned(rest)] : []),
  ];
}

/** Selection-mode "Select all" toggles between all loaded rows and none (MD-60). */
export function toggleAll(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  return selected.size === ids.length && ids.length > 0 ? new Set() : new Set(ids);
}

/** After a bulk call: only the failed ids stay selected, so a retry never resends removed ids (desktop P2-R36). */
export function afterBulk(failedIds: readonly string[]): Set<string> {
  return new Set(failedIds);
}

export type ChatSort = 'activity' | 'created' | 'name';

export const CHAT_SORTS: ReadonlyArray<{ id: ChatSort; label: string }> = [
  { id: 'activity', label: 'Recent activity' },
  { id: 'created', label: 'Date created' },
  { id: 'name', label: 'Name' },
];

/** The spoken meta (the drawn meta is mono project + AgentGlyph; EntityRow speaks status, title, time, pin, unread). */
export function chatRowSpokenMeta(row: ChatRowView): string {
  return [row.project ? `project ${row.project}` : null, row.agent ? `agent ${row.agent}` : row.model ?? null].filter(Boolean).join(', ');
}
