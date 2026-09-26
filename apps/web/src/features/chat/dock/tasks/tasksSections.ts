// ────────────────────────────────────────────────────────────────
// Tasks-panel section registry (F-dock-06; 03 §1.5; D-35 extension point).
//
// The chat dock's Tasks tab (orchestrator chats only) is a stack of SECTIONS.
// The redesign registers one, "Background tasks" (id `background-agents`,
// order 100). The Workflow Overhaul (P06) adds "Workflow runs from this chat"
// and "Drafts" WITHOUT reopening the panel: it registers entries from a
// registration file in `app/registries/` (never from inside a feature — a
// feature may not import another feature).
//
//   import { registerTasksSection } from '@/features/chat/index.js';
//
//   registerTasksSection({
//     id: 'workflow-runs',                 // unique, kebab-case; also the testid suffix
//     title: 'Workflow runs from this chat',
//     order: 200,                          // ascending; built-ins use 100
//     when: ({ chat }) => chat.orchestratorMode === true,   // optional, pure
//     useCount: ({ chatId }) => useChatWorkflowRuns(chatId).data?.length, // optional hook
//     render: (ctx) => <WorkflowRunsSection {...ctx} />,   // render a component: hooks live there
//   }, { replace: Boolean(import.meta.hot) });                // hot reload re-runs this file
//
// Contract:
// - `render(ctx)` is called during the host's render. Return a component
//   element (`<MySection {...ctx} />`) and keep hooks inside that component.
// - `useCount(ctx)` IS a React hook (called unconditionally, once per render,
//   for each visible section). Return `undefined` while the count is unknown —
//   the host then draws no number (D-36: never a placeholder).
// - `when(ctx)` must be pure and cheap; a hidden section mounts nothing.
// - With ONE visible section the section owns the whole panel (its own
//   header, empty state and detail view — the board's layout). With several,
//   `ctx.stacked` is true and the host draws each section's title + count
//   above it; a section should then skip its own title row.
// - Registering an id twice throws (two packages fighting over one slot is a
//   bug, not an override) — except with `{ replace: Boolean(import.meta.hot) }`,
//   which a registration file passes so a hot reload replaces its own entry.
//   `registerTasksSection` returns an unregister function (tests). Registrations after first render are picked up
//   (`useTasksSections` subscribes), so a lazily loaded chunk may register.
// ────────────────────────────────────────────────────────────────

import { useSyncExternalStore, type ReactNode } from 'react';
import type { Chat } from '@generatorai/shared';

export interface TasksSectionContext {
  /** The orchestrator chat whose Tasks tab is showing. */
  chatId: string;
  chat: Chat;
  /** Several sections are visible: the host draws the title and count row. */
  stacked: boolean;
}

export interface TasksSectionDefinition {
  /** Unique, kebab-case. Rendered as `data-testid="tasks-section-<id>"`. */
  id: string;
  /** Heading the host draws when sections are stacked; also the region's name. */
  title: string;
  /** Ascending. Built-in sections use 100; leave gaps for later entries. */
  order: number;
  /** Pure visibility check for this chat. Omitted = always visible. */
  when?: (ctx: Omit<TasksSectionContext, 'stacked'>) => boolean;
  /** React hook: the section's item count, or undefined while unknown. */
  useCount?: (ctx: TasksSectionContext) => number | undefined;
  /** The section body. Return a component element; hooks live inside it. */
  render: (ctx: TasksSectionContext) => ReactNode;
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let sections: readonly TasksSectionDefinition[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function sortSections(list: TasksSectionDefinition[]): TasksSectionDefinition[] {
  return list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export interface RegisterTasksSectionOptions {
  /**
   * Replace an entry with the same id instead of throwing. Only for a
   * registration file re-run by hot reload: pass `Boolean(import.meta.hot)`.
   */
  replace?: boolean;
}

/** Add a section. Throws on a malformed or duplicate id. Returns an unregister function. */
export function registerTasksSection(
  definition: TasksSectionDefinition,
  options: RegisterTasksSectionOptions = {},
): () => void {
  if (!ID_PATTERN.test(definition.id)) {
    throw new Error(`Tasks section id "${definition.id}" must be kebab-case.`);
  }
  const existing = sections.some((s) => s.id === definition.id);
  if (existing && !options.replace) {
    throw new Error(`Tasks section "${definition.id}" is already registered.`);
  }
  sections = sortSections([...sections.filter((s) => s.id !== definition.id), definition]);
  emit();
  return () => {
    const next = sections.filter((s) => s !== definition);
    if (next.length === sections.length) return;
    sections = next;
    emit();
  };
}

/** Every registered section, ordered by `order` then id. */
export function listTasksSections(): readonly TasksSectionDefinition[] {
  return sections;
}

/** The sections visible for one chat (their `when` passes), in order. */
export function visibleTasksSections(
  all: readonly TasksSectionDefinition[],
  ctx: Omit<TasksSectionContext, 'stacked'>,
): TasksSectionDefinition[] {
  return all.filter((s) => (s.when ? s.when(ctx) : true));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The registry, live: re-renders when a section is registered or removed. */
export function useTasksSections(): readonly TasksSectionDefinition[] {
  return useSyncExternalStore(subscribe, listTasksSections, listTasksSections);
}
