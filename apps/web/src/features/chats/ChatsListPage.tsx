// ────────────────────────────────────────────────────────────────
// ChatsListPage (P3-07; T-01 ListPage; 04-screen-map.md §2.1 ChatsList,
// §4.3 parity checklist) — the first page ported to the redesigned kit.
//
// PageHeader + PageTitle "Chats · N" + FilterBar (search, All/Active/Archived
// seg with server counts, Project/Agent/Status/Tags chips, sort) + a
// virtualized DataTable with infinite paging + a floating BulkActionBar.
// Rows show and change the pin / read state shared with mobile (D-83).
// "New chat" opens the NewChatDialog (features/chats/create) via
// useNewChatStore — the dialog itself is mounted once by app/ShellRoute.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { chatLiveSets, toChatRowModel } from '@generatorai/client-core';
import type { ChatBulkResult, ChatListSort, ChatListState } from '@generatorai/shared';
import type { ChatRowModel, CreateChatDraft } from '@generatorai/shared/ui-contract';
import { useNewChatStore } from '@/stores/newChatStore.js';
import {
  useBulkArchiveChats,
  useBulkDeleteChats,
  ChatBulkError,
  useChatPages,
  useSetChatPinned,
  useSetChatUnread,
} from '@/hooks/chatListQueries.js';
import { useArchiveChat, useDeleteChat, useUnarchiveChat } from '@/hooks/queries.js';
import { useAttention } from '@/hooks/attentionQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { BulkActionBar } from '@/ui/patterns/BulkActionBar/BulkActionBar.js';
import { DataTable } from '@/ui/patterns/DataTable/DataTable.js';
import { FilterBar } from '@/ui/patterns/FilterBar/FilterBar.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { ToolbarButton } from '@/ui/primitives/Toolbar/Toolbar.js';
import { ListPage } from '@/ui/templates/ListPage/ListPage.js';
import {
  AgentFilterChip,
  FiltersCollapsedChip,
  ProjectFilterChip,
  SortChip,
  StatusFilterChip,
  TagsFilterChip,
} from './ChatsFilterControls.js';
import { CHATS_COLUMNS, chatRowActions } from '@/blocks/chats-table/chatsColumns.js';
import { shortcutFor } from '@/lib/shortcuts.js';

type Scope = 'all' | 'active' | 'archived';
const SCOPE_ITEMS: readonly Omit<SegmentedItem<Scope>, 'count'>[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

export function ChatsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const openNewChat = useNewChatStore((s) => s.open);
  // `?new=1` opens the dialog; Home's "More options" also hands over its draft
  // in the navigation state (04 R-1) — kept as a fallback alongside the direct
  // `/chats/new` route link.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    openNewChat((location.state as { draft?: Partial<CreateChatDraft> } | null)?.draft);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, openNewChat, location.state]);

  // ── Filters ──
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const [scope, setScope] = useState<Scope>('all');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [agentRefs, setAgentRefs] = useState<string[]>([]);
  const [states, setStates] = useState<ChatListState[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<ChatListSort>('activity');
  const hasFilters =
    Boolean(debouncedSearch) ||
    scope !== 'all' ||
    projectIds.length > 0 ||
    agentRefs.length > 0 ||
    states.length > 0 ||
    tags.length > 0;

  const query = useMemo(
    () => ({
      ...(scope !== 'all' ? { status: scope } : {}),
      ...(projectIds.length ? { projectId: projectIds } : {}),
      ...(agentRefs.length ? { agentRef: agentRefs } : {}),
      ...(states.length ? { state: states } : {}),
      ...(tags.length ? { tag: tags } : {}),
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      sort,
    }),
    [scope, projectIds, agentRefs, states, tags, debouncedSearch, sort],
  );

  const {
    data: chatList,
    isLoading,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useChatPages(query);

  const attention = useAttention();
  const live = chatLiveSets(attention.data);
  const { data: projects } = useProjects();
  const projectsById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects]);
  const rows: ChatRowModel[] = useMemo(
    () =>
      (chatList?.items ?? []).map((item) =>
        toChatRowModel(item, live, item.projectId ? projectsById.get(item.projectId) : undefined),
      ),
    [chatList, live, projectsById],
  );

  // A new filter is a new list: a selection from the previous one must not
  // carry into a bulk action (P2-R14, same rule as the legacy page).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => setSelectedIds(new Set()), [scope, projectIds, agentRefs, states, tags, debouncedSearch, sort]);

  const confirmer = useConfirm();
  const bulkArchive = useBulkArchiveChats();
  const bulkDelete = useBulkDeleteChats();
  const archiveChat = useArchiveChat();
  const unarchiveChat = useUnarchiveChat();
  const deleteChat = useDeleteChat();
  const setPinned = useSetChatPinned();
  const setUnread = useSetChatUnread();

  const clearSelection = () => setSelectedIds(new Set());
  const selectAllLoaded = () => setSelectedIds(new Set(rows.map((r) => r.id)));

  const runBulk = async (
    ids: string[],
    verb: 'archive' | 'delete',
    mutateAsync: (ids: string[]) => Promise<ChatBulkResult>,
  ) => {
    try {
      await mutateAsync(ids);
      clearSelection();
    } catch (err) {
      if (err instanceof ChatBulkError) {
        setSelectedIds(new Set(err.result.failed.map((f) => f.id)));
        toast.error(err.message, { description: err.result.failed[0]?.message });
      } else {
        toast.error(`Failed to ${verb}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const onBulkArchive = () => void runBulk(Array.from(selectedIds), 'archive', (ids) => bulkArchive.mutateAsync(ids));
  const onBulkDelete = async () => {
    const count = selectedIds.size;
    const ok = await confirmer.confirm({
      title: `Delete ${count} chat${count === 1 ? '' : 's'}`,
      description: `This permanently deletes ${count} selected chat${count === 1 ? '' : 's'}. This cannot be undone.`,
      confirmLabel: `Delete ${count}`,
    });
    if (ok) void runBulk(Array.from(selectedIds), 'delete', (ids) => bulkDelete.mutateAsync(ids));
  };

  const onRowArchive = (row: ChatRowModel) => {
    archiveChat.mutate(row.id, {
      onError: (err) => toast.error(`Couldn't archive "${row.title}"`, { description: String(err) }),
    });
  };
  const onRowUnarchive = (row: ChatRowModel) => {
    unarchiveChat.mutate(row.id, {
      onError: (err) => toast.error(`Couldn't unarchive "${row.title}"`, { description: String(err) }),
    });
  };
  const onRowPin = (row: ChatRowModel, pinned: boolean) => {
    setPinned.mutate(
      { chatId: row.id, pinned },
      { onError: (err) => toast.error(`Couldn't ${pinned ? 'pin' : 'unpin'} "${row.title}"`, { description: String(err) }) },
    );
  };
  const onRowMarkUnread = (row: ChatRowModel, unread: boolean) => {
    setUnread.mutate(
      { chatId: row.id, unread },
      { onError: (err) => toast.error(`Couldn't change "${row.title}"`, { description: String(err) }) },
    );
  };
  const onRowDelete = async (row: ChatRowModel) => {
    const ok = await confirmer.confirm({
      title: `Delete "${row.title}"`,
      description: 'This permanently deletes this chat. This cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    deleteChat.mutate(row.id, {
      onError: (err) => toast.error(`Couldn't delete "${row.title}"`, { description: String(err) }),
    });
  };

  const clearAllFilters = () => {
    setSearch('');
    setScope('all');
    setProjectIds([]);
    setAgentRefs([]);
    setStates([]);
    setTags([]);
  };

  const scopeItems: SegmentedItem<Scope>[] = SCOPE_ITEMS.map((item) => ({
    ...item,
    count: chatList ? chatList.counts[item.value] : undefined,
  }));

  return (
    <>
      <ListPage
        header={<PageHeader title="Chats" />}
        title={
          <PageTitle
            title="Chats"
            count={chatList ? chatList.total : undefined}
            actions={
              <Button variant="primary" icon="plus" shortcut={shortcutFor('chat.new')} onClick={() => openNewChat()}>
                New chat
              </Button>
            }
          />
        }
        filters={
          <FilterBar
            search={
              <SearchInput value={search} onValueChange={setSearch} label="Search chats" placeholder="Search chats" />
            }
            scope={
              <SegmentedControl
                value={scope}
                onValueChange={setScope}
                items={scopeItems}
                semantics="tabs"
                label="Chats status"
              />
            }
            filters={
              <>
                <ProjectFilterChip value={projectIds} onChange={setProjectIds} />
                <AgentFilterChip value={agentRefs} onChange={setAgentRefs} />
                <StatusFilterChip value={states} onChange={setStates} />
                <TagsFilterChip value={tags} onChange={setTags} />
              </>
            }
            filtersCollapsed={
              <FiltersCollapsedChip
                projectIds={projectIds}
                agentRefs={agentRefs}
                states={states}
                tags={tags}
                onProjectIdsChange={setProjectIds}
                onAgentRefsChange={setAgentRefs}
                onStatesChange={setStates}
                onTagsChange={setTags}
              />
            }
            sort={<SortChip value={sort} onChange={setSort} />}
          />
        }
        content={
          <DataTable<ChatRowModel>
            label="Chats"
            columns={CHATS_COLUMNS}
            rows={rows}
            getRowId={(row) => row.id}
            getRowLabel={(row) => row.title}
            selection={selectedIds}
            onSelectionChange={setSelectedIds}
            rowActions={(row) =>
              chatRowActions(row, {
                onArchive: onRowArchive,
                onUnarchive: onRowUnarchive,
                onDelete: (r) => void onRowDelete(r),
                onPin: onRowPin,
                onMarkUnread: onRowMarkUnread,
              })
            }
            actionsWidth={56}
            virtualized
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
            }}
            loading={isLoading}
            error={
              isError ? (
                <EmptyState
                  tone="error"
                  icon="warning"
                  title="Couldn't load chats"
                  description={error instanceof Error ? error.message : String(error)}
                  action={
                    <Button size="sm" onClick={() => void refetch()}>
                      Retry
                    </Button>
                  }
                />
              ) : undefined
            }
            empty={
              <EmptyState
                icon="chats"
                title={hasFilters ? 'No matching chats' : 'No chats yet'}
                description={hasFilters ? 'No chats match your filters.' : 'Start your first chat.'}
                action={
                  hasFilters ? (
                    <Button size="sm" onClick={clearAllFilters}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" icon="plus" onClick={() => openNewChat()}>
                      New chat
                    </Button>
                  )
                }
              />
            }
            footer={
              rows.length > 0 && chatList
                ? `Showing ${rows.length} of ${chatList.total}${hasNextPage ? ' · Scroll to load more' : ''}`
                : undefined
            }
          />
        }
        overlay={
          <BulkActionBar
            count={selectedIds.size}
            total={chatList?.total}
            onSelectAll={selectAllLoaded}
            onClear={clearSelection}
            actions={
              <>
                <ToolbarButton
                  render={<Button variant="ghost" size="sm" icon="archive" loading={bulkArchive.isPending} />}
                  onClick={onBulkArchive}
                >
                  Archive
                </ToolbarButton>
                <ToolbarButton
                  render={<Button variant="danger-ghost" size="sm" icon="trash" loading={bulkDelete.isPending} />}
                  onClick={() => void onBulkDelete()}
                >
                  Delete
                </ToolbarButton>
              </>
            }
          />
        }
      />
      {confirmer.dialog}
    </>
  );
}
