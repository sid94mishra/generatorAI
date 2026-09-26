// ────────────────────────────────────────────────────────────────
// The chat dock's Tasks, Computer, Plan and Widget panels as dock-registry
// `Component`s (blocks/dock: memoised, `DockPanelProps` only). What they need
// beyond the tab instance comes from `ChatDockContext`, which the chat page
// provides with a memoised value — so a streamed token re-renders none of
// them.
// ────────────────────────────────────────────────────────────────

import { createContext, lazy, memo, Suspense, useContext } from 'react';
import type { Chat } from '@generatorai/shared';
import type { DockPanelProps } from '@/blocks/dock/index.js';
import { PlanPanel } from '@/blocks/plan/index.js';
import { WidgetHost } from '@/blocks/widgets/index.js';
import { parseWidgetTabId } from '@/lib/widgetTabId.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { TasksPanel } from './TasksPanel.js';

export interface ChatDockContextValue {
  chatId: string | undefined;
  chat: Chat | undefined;
  workspaceId: string | undefined;
  sessionId: string | undefined;
  /** The plan the Plan tab shows (null → the one awaiting review, else the newest). */
  activePlanId: string | null;
  /** Bind a widget instance to its own tab (the unbound tab's launcher). */
  openWidgetTab: (instanceId: string) => void;
}

export const ChatDockContext = createContext<ChatDockContextValue | null>(null);

function useChatDock(): ChatDockContextValue {
  const value = useContext(ChatDockContext);
  if (!value) throw new Error('Chat dock panels need a ChatDockContext provider.');
  return value;
}

// Computer pulls in its own tree (replay, consent, grants) and is never on
// the path to first paint: keep it out of the chat route chunk.
const ComputerPanel = lazy(() => import('./ComputerPanel.js').then((m) => ({ default: m.ComputerPanel })));

export const ChatTasksDockPanel = memo(function ChatTasksDockPanel(_props: DockPanelProps) {
  const { chatId, chat } = useChatDock();
  return <TasksPanel chatId={chatId} chat={chat} />;
});

export const ChatComputerDockPanel = memo(function ChatComputerDockPanel({ active }: DockPanelProps) {
  const { workspaceId } = useChatDock();
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-surface">
          <Spinner size={16} label="Loading" />
        </div>
      }
    >
      <ComputerPanel workspaceId={workspaceId} active={active} />
    </Suspense>
  );
});

export const ChatPlanDockPanel = memo(function ChatPlanDockPanel(_props: DockPanelProps) {
  const { chatId, activePlanId } = useChatDock();
  if (!chatId) return <EmptyState icon="plan" title="No plan yet" className="h-full bg-surface" />;
  return <PlanPanel chatId={chatId} planId={activePlanId} />;
});

export const ChatWidgetDockPanel = memo(function ChatWidgetDockPanel({ id }: DockPanelProps) {
  const { sessionId, openWidgetTab } = useChatDock();
  if (!sessionId) {
    return <EmptyState icon="widgets" title="No active session" description="Start the chat to enable widgets." className="h-full bg-surface" />;
  }
  const instanceId = parseWidgetTabId(id);
  // An unbound tab (from "+") is a launcher, so it never mounts a second live
  // copy of a widget that already has its own tab.
  return instanceId ? (
    <WidgetHost sessionId={sessionId} instanceId={instanceId} />
  ) : (
    <WidgetHost sessionId={sessionId} onOpenWidget={openWidgetTab} />
  );
});
