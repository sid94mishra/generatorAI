// features/chat — the chat workspace (04 §0). P4-04 landed the controller;
// the page itself moves here in P4-12.

export { useChatView, type ChatView, type UseChatViewOptions } from './hooks/useChatView.js';
export { CHAT_DOCK_KEYS, CHAT_DOCK_TAB_CAPS, type DockFocusRequest } from './hooks/useChatDockRouting.js';
export { CHAT_PAGE_SIZE, type ChatPromptHistoryEntry } from './hooks/useChatTranscript.js';
export type { TurnUsage } from './hooks/useChatStreamState.js';
export type { PlanImplementAction } from './hooks/useChatGates.js';
export { ChatTranscript, type ChatTranscriptProps } from './components/ChatTranscript.js';

// Dock panels (P4-11): Tasks (+ its section registry, the D-35 extension point),
// Computer, Plan and Widget as dock-registry Components.
export {
  ChatComputerDockPanel,
  ChatDockContext,
  ChatPlanDockPanel,
  ChatTasksDockPanel,
  ChatWidgetDockPanel,
  type ChatDockContextValue,
} from './dock/chatDockPanels.js';
export { TasksPanel, type TasksPanelProps } from './dock/TasksPanel.js';
export {
  listTasksSections,
  registerTasksSection,
  useTasksSections,
  visibleTasksSections,
  type RegisterTasksSectionOptions,
  type TasksSectionContext,
  type TasksSectionDefinition,
} from './dock/tasks/tasksSections.js';
export { BackgroundTasksSection, useBackgroundTasksCount } from './dock/tasks/BackgroundTasksSection.js';
