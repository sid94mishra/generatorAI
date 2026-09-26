// ────────────────────────────────────────────────────────────────
// ProjectDetail · Chats (P5-04; F-projects-04; G-14). The B-26 ChatsTable
// (blocks/chats-table) filtered server-side by `?projectId=`, with an
// All / Active / Archived scope (server counts). The Project column is
// dropped — every row is this project.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { chatLiveSets, toChatRowModel } from '@generatorai/client-core';
import type { ChatRowModel } from '@generatorai/shared/ui-contract';
import { CHATS_COLUMNS } from '@/blocks/chats-table/chatsColumns.js';
import { useAttention } from '@/hooks/attentionQueries.js';
import { useChatPages } from '@/hooks/chatListQueries.js';
import { DataTable } from '@/ui/patterns/DataTable/DataTable.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';

type Scope = 'all' | 'active' | 'archived';
const COLUMNS = CHATS_COLUMNS.filter((c) => c.id !== 'project');

export function ChatsTab({ projectId, projectName, onNewChat }: { projectId: string; projectName: string; onNewChat: () => void }) {
  const [scope, setScope] = useState<Scope>('active');
  const query = useMemo(
    () => ({ projectId: [projectId], ...(scope !== 'all' ? { status: scope } : {}), sort: 'activity' as const }),
    [projectId, scope],
  );
  const { data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useChatPages(query);
  const attention = useAttention({ projectId });
  const live = chatLiveSets(attention.data);
  const rows: ChatRowModel[] = useMemo(
    () => (data?.items ?? []).map((item) => toChatRowModel(item, live, projectName)),
    [data, live, projectName],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SegmentedControl<Scope>
          value={scope}
          onValueChange={setScope}
          semantics="tabs"
          label="Chat status"
          items={[
            { value: 'all', label: 'All', count: data?.counts.all },
            { value: 'active', label: 'Active', count: data?.counts.active },
            { value: 'archived', label: 'Archived', count: data?.counts.archived },
          ]}
        />
        <Button className="ml-auto" icon="plus" onClick={onNewChat}>
          New chat
        </Button>
      </div>
      <DataTable<ChatRowModel>
        label="Project chats"
        columns={COLUMNS}
        rows={rows}
        getRowId={(row) => row.id}
        loading={isLoading}
        error={
          isError ? (
            <EmptyState framed tone="error" icon="warning" title="Couldn't load chats" description={String(error)} />
          ) : undefined
        }
        empty={
          <EmptyState
            framed
            icon="chats"
            title={scope === 'archived' ? 'No archived chats' : 'No chats in this project yet'}
            description="Chats started in this project appear here."
            action={
              scope === 'archived' ? undefined : (
                <Button icon="plus" onClick={onNewChat}>
                  New chat
                </Button>
              )
            }
          />
        }
        footer={
          rows.length > 0 && data ? (
            <span className="flex items-center gap-2">
              Showing {rows.length} of {data.total}
              {hasNextPage ? (
                <Button size="sm" variant="ghost" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                  Load more
                </Button>
              ) : null}
            </span>
          ) : undefined
        }
      />
    </div>
  );
}
