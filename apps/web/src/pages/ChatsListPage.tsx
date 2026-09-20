// ────────────────────────────────────────────────────────────────
// ChatsListPage — Dedicated page showing all chats with search,
//                 filter, quick create, and bulk select/delete.
// ────────────────────────────────────────────────────────────────

import React, { useState, useMemo, useLayoutEffect, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
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

/** Estimated row height fed to the virtualizer before it measures the real
 * DOM node; @tanstack/react-virtual's `measureElement` corrects this after
 * each row's first render, so it only needs to be in the right ballpark. */
const CHAT_ROW_ESTIMATE = 76;

export function ChatsListPage() {
  const [createChatOpen, setCreateChatOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setCreateChatOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
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

  // ── Virtualization ──
  // Measured on /chats with 359 real chats: 7,538 DOM nodes, worst long task
  // 334ms. Mounting only the rows near the viewport is the fix.
  //
  // PageContainer is the actual scroll parent here
  // (`h-full overflow-y-auto` — see layout/PageContainer.tsx), not the
  // window, so the virtualizer observes that node directly.
  const scrollElRef = useRef<HTMLDivElement>(null);
  // Wraps just the chat list. Everything above it (header, toolbar, the
  // selection bar) scrolls in the same PageContainer, so its height has to
  // be added to every virtual row's offset via `scrollMargin`.
  const listStartRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Deliberately no dependency array: this has to re-measure after every
  // commit, since the conditionally-rendered selection bar above the list can
  // resize it. The `Math.abs` guard below keeps it from looping — once the
  // measured offset stabilizes, `setScrollMargin` stops being called.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const scrollEl = scrollElRef.current;
    const listStart = listStartRef.current;
    if (!scrollEl || !listStart) return;
    // Content-relative offset of the list within the scroll container; stable
    // across scroll position (scrollTop cancels the rect delta), so this only
    // actually changes when something above the list resizes — e.g. toggling
    // selection mode.
    const next =
      listStart.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  });

  const rowVirtualizer = useVirtualizer({
    count: filteredChats.length,
    getScrollElement: () => scrollElRef.current,
    estimateSize: () => CHAT_ROW_ESTIMATE,
    overscan: 8,
    scrollMargin,
  });

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
    <PageContainer ref={scrollElRef} className="animate-fade-in">
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
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-accent/50 px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectedIds.size === filteredChats.length ? deselectAll : selectAll}
              className="text-foreground"
              leftIcon={
                selectedIds.size === filteredChats.length ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4" />
                )
              }
            >
              {selectedIds.size === filteredChats.length ? 'Deselect All' : 'Select All'}
            </Button>
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
              aria-label="Cancel selection"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Search & Filter */}
        <Toolbar
          className="mb-6 flex-wrap sm:flex-nowrap"
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
            aria-label="Search chats"
            className="min-w-0 flex-1"
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
          <div ref={listStartRef} style={{ position: 'relative', height: rowVirtualizer.getTotalSize() }}>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${
                  (rowVirtualizer.getVirtualItems()[0]?.start ?? 0) - rowVirtualizer.options.scrollMargin
                }px)`,
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const chat = filteredChats[virtualRow.index];
                if (!chat) return null;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="pb-2"
                  >
                    <ChatCard
                      chat={chat}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(chat.id)}
                      onToggleSelect={() => toggleSelect(chat.id)}
                      onClick={() => toggleSelect(chat.id)}
                    />
                  </div>
                );
              })}
            </div>
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
      // A link when the row navigates, so middle-click, ctrl-click and "copy
      // link address" all work; a plain click handler in selection mode,
      // where the row toggles a checkbox and goes nowhere.
      {...(selectionMode ? { onClick } : { href: `/chats/${chat.id}` })}
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
