// ────────────────────────────────────────────────────────────────
// ChatsListPage — Dedicated page showing all chats with search,
//                 filter, quick create, and bulk select/delete.
// ────────────────────────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChats, useBulkDeleteChats } from '@/hooks/queries.js';
import { CreateChatDialog } from '@/components/chat/CreateChatDialog.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { SearchInput, EmptyState, Button, Spinner, Badge, StatusBadge, PageHeader } from '@/components/ui/index.js';
import { EntityListRow, FilterTabs } from '@/components/data/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { Toolbar } from '@/components/layout/Toolbar.js';
import { cn } from '@/lib/utils.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import {
  MessageSquare,
  Plus,
  Archive,
  Clock,
  CheckSquare,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { Chat } from '@generatorai/shared';

type StatusFilter = 'all' | 'active' | 'archived';

export function ChatsListPage() {
  const navigate = useNavigate();
  const [createChatOpen, setCreateChatOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data: chats, isLoading } = useChats();
  const bulkDelete = useBulkDeleteChats();

  // ── Bulk selection state ──
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  /** Filtered and sorted chat list based on search and status filter */
  const filteredChats = useMemo(() => {
    if (!chats) return [];
    let result = [...chats];

    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return result;
  }, [chats, search, statusFilter]);

  // ── Bulk selection helpers ──

  /** Toggle a single chat's selection */
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Select all visible (filtered) chats */
  const selectAll = () => {
    setSelectedIds(new Set(filteredChats.map((c) => c.id)));
  };

  /** Deselect all */
  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  /** Enter selection mode with all visible chats pre-selected */
  const enterSelectionMode = () => {
    setSelectionMode(true);
    selectAll();
  };

  /** Exit selection mode and clear selection */
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  /** Confirm and execute bulk chat deletion */
  const confirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    await bulkDelete.mutateAsync(Array.from(selectedIds));
    setBulkDeleteOpen(false);
    exitSelectionMode();
  };

  return (
    <PageContainer variant="narrow" className="animate-fade-in">
      {/* Bulk-delete confirmation dialog */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => { if (!open) setBulkDeleteOpen(false); }}
        title={`Delete ${selectedIds.size} Chat${selectedIds.size === 1 ? '' : 's'}`}
        description={`Are you sure you want to delete ${selectedIds.size} selected chat${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel={`Delete ${selectedIds.size}`}
        variant="destructive"
        loading={bulkDelete.isPending}
        onConfirm={confirmBulkDelete}
      />

        {/* Header */}
        <PageHeader
          className="mb-6"
          title="Chats"
          subtitle="Your AI conversations"
          actions={
            <>
              {/* Bulk select toggle */}
              {!selectionMode && chats && chats.length > 0 && (
                <Button
                  variant="secondary"
                  onClick={enterSelectionMode}
                  title="Select multiple chats for bulk actions"
                  leftIcon={<CheckSquare className="h-4 w-4" />}
                >
                  Select
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => setCreateChatOpen(true)}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                New Chat
              </Button>
            </>
          }
        />

        {/* ── Selection Toolbar — shown when in bulk selection mode ── */}
        {selectionMode && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-accent/50 px-4 py-2">
            <button
              onClick={selectedIds.size === filteredChats.length ? deselectAll : selectAll}
              className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:opacity-80"
            >
              {selectedIds.size === filteredChats.length ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {selectedIds.size === filteredChats.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-xs text-muted-foreground">
              {selectedIds.size} of {filteredChats.length} selected
            </span>
            <div className="flex-1" />
            <Button
              variant="danger"
              size="sm"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={selectedIds.size === 0 || bulkDelete.isPending}
              loading={bulkDelete.isPending}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Delete Selected
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={exitSelectionMode}
              title="Cancel selection"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Search & Filter */}
        <Toolbar
          className="mb-6"
          end={
            <FilterTabs
              options={(['all', 'active', 'archived'] as StatusFilter[]).map((s) => ({
                id: s,
                label: s.charAt(0).toUpperCase() + s.slice(1),
              }))}
              value={statusFilter}
              onChange={(id) => setStatusFilter(id as StatusFilter)}
            />
          }
        >
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search chats..."
            className="flex-1"
          />
        </Toolbar>

        {/* Chat List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" className="text-muted-foreground" />
          </div>
        ) : filteredChats.length === 0 ? (
          <EmptyState
            className="rounded-lg border border-dashed border-border bg-card"
            icon={<MessageSquare className="h-10 w-10" />}
            title={search || statusFilter !== 'all' ? 'No matching chats' : 'No chats yet'}
            hint={
              search || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Start your first AI conversation'
            }
            action={
              !search && statusFilter === 'all' ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setCreateChatOpen(true)}
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  New Chat
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2">
            {filteredChats.map((chat) => (
              <ChatCard
                key={chat.id}
                chat={chat}
                selectionMode={selectionMode}
                selected={selectedIds.has(chat.id)}
                onToggleSelect={() => toggleSelect(chat.id)}
                onClick={() => {
                  if (selectionMode) toggleSelect(chat.id);
                  else navigate(`/chats/${chat.id}`);
                }}
              />
            ))}
          </div>
        )}

      <CreateChatDialog open={createChatOpen} onOpenChange={setCreateChatOpen} />
    </PageContainer>
  );
}

/**
 * ChatCard — Individual chat row in the list.
 * In selection mode, displays a checkbox and highlights selected items.
 */
function ChatCard({
  chat,
  selectionMode,
  selected,
  onToggleSelect,
  onClick,
}: {
  chat: Chat;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  return (
    <EntityListRow
      onClick={onClick}
      className={cn(selectionMode && selected && 'ring-2 ring-ring bg-primary/5')}
      leading={
        selectionMode ? (
          <div
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleSelect(); } }}
            className="shrink-0 cursor-pointer"
          >
            {selected ? (
              <CheckSquare className="h-5 w-5 text-primary" />
            ) : (
              <Square className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        ) : (
          <div className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg',
            chat.status === 'active'
              ? 'bg-info-muted'
              : 'bg-subtle',
          )}>
            {chat.status === 'active' ? (
              <MessageSquare className="h-5 w-5 text-info" />
            ) : (
              <Archive className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        )
      }
      title={
        <>
          <span className="truncate">{chat.name}</span>
          {chat.model && (
            <Badge tone="neutral" size="sm">
              {chat.model}
            </Badge>
          )}
        </>
      }
      description={
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(new Date(chat.updatedAt))}
          </span>
          {chat.tags && chat.tags.length > 0 && (
            <span className="flex gap-1">
              {chat.tags.slice(0, 2).map((tag) => (
                <Badge key={tag} tone="neutral" size="sm">
                  {tag}
                </Badge>
              ))}
            </span>
          )}
        </span>
      }
      trailing={<StatusBadge status={chat.status} size="sm" />}
    />
  );
}

export default ChatsListPage;
