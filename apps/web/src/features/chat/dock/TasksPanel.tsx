// ────────────────────────────────────────────────────────────────
// F-dock-06 TasksPanel — the chat dock's Tasks tab (orchestrator chats only,
// D-27). A host for the Tasks-section registry (tasks/tasksSections.ts): one
// visible section owns the whole panel; several stack under their titles.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import type { Chat } from '@generatorai/shared';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import {
  useTasksSections,
  visibleTasksSections,
  type TasksSectionContext,
  type TasksSectionDefinition,
} from './tasks/tasksSections.js';

export interface TasksPanelProps {
  chatId: string | undefined;
  chat: Chat | undefined;
}

function noCount(): undefined {
  return undefined;
}

function StackedSection({ section, ctx }: { section: TasksSectionDefinition; ctx: TasksSectionContext }) {
  const useCount = section.useCount ?? noCount;
  const count = useCount(ctx);
  return (
    <section aria-label={section.title} data-testid={`tasks-section-${section.id}`} className="flex flex-col border-b border-line-soft">
      <SectionHeader variant="title" level={3} title={section.title} count={count} className="px-3 pt-2" />
      {section.render(ctx)}
    </section>
  );
}

export function TasksPanel({ chatId, chat }: TasksPanelProps) {
  const all = useTasksSections();
  const visible = useMemo(
    () => (chatId && chat ? visibleTasksSections(all, { chatId, chat }) : []),
    [all, chatId, chat],
  );

  if (!chatId || !chat || visible.length === 0) {
    return (
      <EmptyState
        icon="tasks"
        title="No background tasks"
        description="The orchestrator starts them when it splits the work."
        className="h-full"
      />
    );
  }

  if (visible.length === 1) {
    const only = visible[0]!;
    return (
      <section aria-label={only.title} data-testid={`tasks-section-${only.id}`} className="flex h-full min-h-0 flex-col bg-surface">
        {only.render({ chatId, chat, stacked: false })}
      </section>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface">
      {visible.map((section) => (
        <StackedSection key={section.id} section={section} ctx={{ chatId, chat, stacked: true }} />
      ))}
    </div>
  );
}
