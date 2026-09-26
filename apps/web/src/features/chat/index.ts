// features/chat — the chat workspace (04 §0). P4-04 landed the controller;
// the page itself moves here in P4-12.

export { useChatView, type ChatView, type UseChatViewOptions } from './hooks/useChatView.js';
export {
  CHAT_DOCK_OPEN_KEY,
  CHAT_DOCK_TAB_CAPS,
  CHAT_DOCK_WIDTH_KEY,
  type DockFocusRequest,
} from './hooks/useChatDockRouting.js';
export { CHAT_PAGE_SIZE, type ChatPromptHistoryEntry } from './hooks/useChatTranscript.js';
export type { TurnUsage } from './hooks/useChatStreamState.js';
export type { PlanImplementAction } from './hooks/useChatGates.js';
