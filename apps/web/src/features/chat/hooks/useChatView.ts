// ────────────────────────────────────────────────────────────────
// useChatView — the chat page's controller (03-domain §6.4, 04 §0).
//
// Composes the page's concerns into one `{ data, state, actions }`-shaped
// object so the page body is JSX plus local UI state:
//
//   useChatWorkspace    chat record, model/effort/tier, mounts, SSE session
//   useChatStreamState  narrow live-stream selectors and derived flags
//   useChatTranscript   paging, optimistic de-dup, prompt history, scroll
//   useChatGates        plan/question/permission gates, agent mode
//   useChatStopRewind   two-phase Stop, gate cancel, rewound prompt
//   useChatDockRouting  dock keys, focus requests, auto-open rules, caps
//
// The dock FRAME (open state, tabs, width) belongs to the dock host; this
// controller is handed its open state and setter.
// ────────────────────────────────────────────────────────────────

import { useComputerUseSettings } from '@/hooks/composerQueries.js';
import { useSendChatPrompt } from '@/hooks/queries.js';
import { useChatDockRouting } from './useChatDockRouting.js';
import { useChatGates } from './useChatGates.js';
import { useChatStopRewind } from './useChatStopRewind.js';
import { useChatStreamState } from './useChatStreamState.js';
import { useChatTranscript } from './useChatTranscript.js';
import { useChatWorkspace } from './useChatWorkspace.js';

export interface UseChatViewOptions {
  chatId: string | undefined;
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
}

export function useChatView({ chatId, dockOpen, setDockOpen, toggleDock }: UseChatViewOptions) {
  const workspace = useChatWorkspace(chatId);
  const { chat, sessionId } = workspace;
  const chatActive = chat?.status === 'active';

  const stream = useChatStreamState(sessionId);

  // Orchestrator chats get the Background Tasks tab; the Computer tab is only
  // offered when desktop automation is actually on — otherwise it is a tab
  // that can never show anything.
  const isOrchestrator = !!chat?.orchestratorMode;
  const computerUseEnabled = useComputerUseSettings().data?.enabled === true;

  const dock = useChatDockRouting({
    chatId,
    workspaceId: chat?.workspaceId,
    sessionId,
    dockOpen,
    setDockOpen,
    toggleDock,
    isOrchestrator,
    computerUseEnabled,
    awaitingPlanId: stream.awaitingPlanId,
    widgetSurfaceKey: stream.widgetSurfaceKey,
    pathRoots: workspace.pathRoots,
  });

  const gates = useChatGates({
    chatId,
    sessionId,
    chatActive,
    defaultAgentMode: chat?.defaultAgentMode,
    interactionBlocksKey: stream.interactionBlocksKey,
  });

  const stopRewind = useChatStopRewind({
    chatId,
    sessionId,
    chatActive,
    isWorking: stream.isWorking,
  });

  const transcript = useChatTranscript(chatId, sessionId, stream);

  /** Send the composer's prompt as this chat's next turn. */
  const sendPrompt = useSendChatPrompt(chatId ?? '').mutateAsync;

  return {
    workspace,
    chat,
    sessionId,
    chatActive,
    isOrchestrator,
    computerUseEnabled,
    stream,
    transcript,
    gates,
    stopRewind,
    dock,
    sendPrompt,
  };
}

export type ChatView = ReturnType<typeof useChatView>;
