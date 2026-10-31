// ────────────────────────────────────────────────────────────────
// SideChatPanel — a side chat in its dock tab (D-180): a compact header strip
// (mode badge, name, working dot, actions), the chat's transcript and its
// composer. Kit only (D-178): Badge, StatusDot, MenuButton, the chat page's
// own ChatTranscript and the shared Composer.
//
// Actions: Keep (joins the chat list), Open as main chat, Send to main chat (a
// chat reference on the parent's composer, D-179) and Discard (deletes it and
// closes the tab). A quick question is read-only and says so under the strip.
// ────────────────────────────────────────────────────────────────

import { createContext, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router';
import type { Chat, SideChatMode } from '@generatorai/shared';
import { harnessProviderLabel } from '@generatorai/shared/ui-contract';
import { Composer } from '@/blocks/composer/index.js';
import type { DockPanelProps } from '@/blocks/dock/index.js';
import { parseSideTabId } from '@/lib/sideTabId.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import { ChatTranscript } from '../components/ChatTranscript.js';
import { useChatView } from '../hooks/useChatView.js';

export const SIDE_MODE_LABEL: Record<SideChatMode, string> = {
  question: 'Quick question',
  fork: 'Fork',
  new: 'Side chat',
};

/** What a side chat tab needs from the chat it sits beside. */
export interface SideChatDockContextValue {
  parentChatId: string | undefined;
  /** Attach this side chat to the parent's next message. */
  sendToMain: (chat: Chat) => void;
  keep: (chatId: string) => void;
  /** Delete the side chat and close its tab. */
  discard: (chatId: string) => void;
  /** Close the tab of a side chat that no longer exists. */
  closeTab: (chatId: string) => void;
  /** A message went out: its first one names the side chat (tab label, chip). */
  refresh: (chatId: string) => void;
}

export const SideChatDockContext = createContext<SideChatDockContextValue | null>(null);

function useSideChatDock(): SideChatDockContextValue {
  const ctx = useContext(SideChatDockContext);
  if (!ctx) throw new Error('SideChatPanel needs a SideChatDockContext');
  return ctx;
}

const noop = () => undefined;

export function SideChatDockPanel({ id }: DockPanelProps) {
  const chatId = parseSideTabId(id);
  if (!chatId) return <EmptyState icon="message" title="No side chat in this tab" />;
  return <SideChatView chatId={chatId} />;
}

function SideChatView({ chatId }: { chatId: string }) {
  const ctx = useSideChatDock();
  const navigate = useNavigate();
  const view = useChatView({ chatId, dockOpen: false, setDockOpen: noop, toggleDock: noop });
  const { chat, sessionId, workspace, stream, stopRewind, gates } = view;
  const { isWorking } = stream;
  const sendPrompt = view.sendPrompt;
  const send = useCallback(
    async ({ prompt, attachments, mode, chatRefs }: { prompt: string; attachments: File[]; mode?: 'auto' | 'plan'; chatRefs?: Array<{ chatId: string; mode: 'auto' | 'summary' | 'recent' | 'full' }> }) => {
      await sendPrompt({ prompt, attachments, ...(mode ? { mode } : {}), ...(chatRefs?.length ? { chatRefs } : {}) });
      ctx.refresh(chatId);
    },
    [sendPrompt, ctx, chatId],
  );

  if (workspace.chatLoading) {
    return (
      <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading side chat">
        <Skeleton width={160} />
        <Skeleton shape="block" className="h-row" />
      </div>
    );
  }
  if (workspace.chatError || !chat) {
    return (
      <EmptyState
        icon="message"
        title="This side chat is gone"
        description="It was discarded."
        action={
          <Button size="sm" onClick={() => ctx.closeTab(chatId)}>
            Close tab
          </Button>
        }
      />
    );
  }

  const mode: SideChatMode = chat.sideMode ?? 'new';
  const kept = !chat.sideOfChatId;
  const agentName = chat.agentSnapshot?.driving?.name;
  const harnessLabel = workspace.harnessProvider ? harnessProviderLabel(workspace.harnessProvider) : null;
  const items: MenuButtonItem[] = [
    ...(kept ? [] : [{ id: 'keep', label: 'Keep as a chat', icon: 'pin' as const, onSelect: () => ctx.keep(chat.id) }]),
    { id: 'open', label: 'Open as main chat', icon: 'external-link', onSelect: () => navigate(`/chats/${chat.id}`) },
    ...(ctx.parentChatId
      ? [{ id: 'send', label: 'Send to main chat', icon: 'send' as const, onSelect: () => ctx.sendToMain(chat) }]
      : []),
    { type: 'separator', id: 'sep' },
    { id: 'discard', label: 'Discard', icon: 'trash', danger: true, onSelect: () => ctx.discard(chat.id) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="side-chat" data-side-mode={mode}>
      <div className="flex h-row shrink-0 items-center gap-2 border-b border-line-soft px-3">
        <Badge tone={mode === 'question' ? 'run' : 'neutral'}>{SIDE_MODE_LABEL[mode]}</Badge>
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-fg" title={chat.name}>
          {chat.name}
        </span>
        {kept ? <Badge tone="ok">Kept</Badge> : null}
        {isWorking ? <StatusDot tone="run" label="Working" /> : null}
        <MenuButton label="Side chat actions" icon="more" iconOnly items={items} align="end" size="sm" data-testid="side-chat-actions" />
      </div>
      {mode === 'question' ? (
        <p className="shrink-0 border-b border-line-soft px-3 py-1.5 text-small text-fg-3">
          Read-only — it can look at the files but not change them, and knows the conversation up to when you asked.
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatTranscript
          view={view}
          agentName={agentName ?? harnessLabel ?? 'Agent'}
          harnessLabel={harnessLabel}
          harnessProvider={agentName ? undefined : (workspace.harnessProvider ?? undefined)}
          canRewind={false}
        />
      </div>
      {view.chatActive && sessionId ? (
        <div className="shrink-0 px-2 pb-2">
          <Composer
            sessionId={sessionId}
            chat={chat}
            disabled={false}
            placeholder={mode === 'question' ? 'Ask about the chat — it reads, it does not change files…' : 'Message the side chat…'}
            selectedModel={workspace.effectiveModel}
            onModelChange={workspace.changeModel}
            workspaceId={chat.workspaceId}
            projectId={chat.projectId}
            showModelSelector={false}
            showAgentModePicker={mode !== 'question'}
            agentMode={gates.agentMode}
            onAgentModeChange={gates.setAgentMode}
            isStreaming={isWorking}
            stopState={stopRewind.stop}
            onStop={stopRewind.stop.press}
            pendingInteractionLabel={gates.pendingInteractionLabel}
            onCancelPendingInteraction={stopRewind.cancelPendingInteraction}
            {...(agentName ? { agentName } : {})}
            customSendFn={send}
          />
        </div>
      ) : null}
    </div>
  );
}
