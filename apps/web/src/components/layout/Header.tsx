// ────────────────────────────────────────────────────────────────
// Header — the legacy global header (D-21): breadcrumb + context actions
//          (Open in editor, chat Archive, side-pane toggle). Since P3-04 it
//          renders only inside app/shell/LegacyHeader, as the first row of
//          the main card, for routes not yet ported. The sidebar toggle moved
//          to the sidebar/rail, the theme toggle to the palette and Settings,
//          connection status to the sidebar footer. Deleted in P7.
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useChat, useArchiveChat } from '@/hooks/queries.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { awaitsUserDecision } from '@generatorai/client-core';
import { useRightPaneStore } from '@/stores/rightPaneStore.js';
import { OpenInEditorButton } from '@/components/shared/OpenInEditorButton.js';
import { cn } from '@/lib/utils.js';
import { Tooltip } from '@/components/Tooltip.js';
import { Badge, type BadgeTone, Button } from '@/components/ui/index.js';
import { PanelRightOpen, PanelRightClose, Archive, MessageSquare } from 'lucide-react';

export function Header() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const rightPaneController = useRightPaneStore((s) => s.controller);

  // Determine context: chat vs dashboard
  const isChatContext = location.pathname.startsWith('/chats/');
  const isDashboard = location.pathname === '/';
  const isChatsListContext = location.pathname === '/chats';
  const isWorkflowsContext = location.pathname.startsWith('/workflows');

  // Section title for the remaining top-level routes (so the header never
  // falls back to the generic app name on a real page).
  const sectionTitle = (() => {
    const p = location.pathname;
    if (p.startsWith('/projects')) return 'Projects';
    if (p.startsWith('/agents')) return 'Agents';
    if (p.startsWith('/scripts')) return 'Scripts';
    if (p.startsWith('/automations')) return 'Automations';
    if (p.startsWith('/settings')) return 'Settings';
    return 'GeneratorAI';
  })();

  const chatId = isChatContext ? routeId : undefined;

  // Chat queries (only active on chat routes)
  const { data: chat } = useChat(isChatContext ? chatId : undefined);

  // Resolve sessionId for stream store — via chatStore
  const resolvedSessionId = chat?.sessionId;
  const streamStatus = useStreamStore((state) => state.streams[resolvedSessionId ?? '']?.status);
  // Stopped on a question, a permission or a plan review. The stream is still
  // "streaming" as far as the provider is concerned — a tool call is open —
  // but nothing is being generated and nothing will be until the user acts.
  const awaitingUser = useStreamStore((state) =>
    awaitsUserDecision(state.streams[resolvedSessionId ?? '']?.blocks),
  );

  // Chat mutations
  const archiveChatMutation = useArchiveChat();

  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  // --- Chat handlers ---
  const handleArchiveChatConfirm = useCallback(() => {
    if (!chatId) return;
    archiveChatMutation.mutateAsync(chatId).then(() => {
      setArchiveConfirmOpen(false);
    }).catch(() => {});
  }, [chatId, archiveChatMutation]);

  // Chat-specific state
  const chatStatus = chat?.status;
  const canArchiveChat = chatStatus === 'active';
  const isChatLoading = archiveChatMutation.isPending;

  return (
    <header
      data-testid="app-header"
      className="@container flex h-11 min-w-0 items-center justify-between gap-2 border-b border-border px-3"
    >
      {/* Left: breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm">
          {isDashboard ? (
            <>
              <span className="font-medium text-[var(--color-foreground)]">Home</span>
            </>
          ) : isChatsListContext ? (
            <>
              <MessageSquare className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
              <span className="font-medium text-[var(--color-foreground)]">Chats</span>
            </>
          ) : isChatContext ? (
            <>
              <MessageSquare className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
              <span className="text-[var(--color-muted-foreground)]">Chats</span>
              {chat && (
                <>
                  <span className="text-[var(--color-muted-foreground)]">/</span>
                  <span title={chat.name} className="min-w-0 truncate font-medium text-[var(--color-foreground)]">{chat.name}</span>
                  <ChatStatusBadge status={chat.status} copilotStatus={streamStatus} awaitingUser={awaitingUser} />
                </>
              )}
            </>
          ) : isWorkflowsContext ? (
            <>
              <span className="font-medium text-[var(--color-foreground)]">Workflows</span>
            </>
          ) : (
            <span className="font-medium text-[var(--color-foreground)]">{sectionTitle}</span>
          )}
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Open the page's subject in a real editor. Page-agnostic: chat,
            workflow run, project and codebase pages each publish their own
            path into `editorTargetStore`, and the button hides itself when
            nothing is published. */}
        <OpenInEditorButton />

        {/* Chat Actions */}
        {isChatContext && chatId && (
          <div className="flex items-center gap-1">
            {canArchiveChat && (
              <ActionButton
                onClick={() => setArchiveConfirmOpen(true)}
                loading={archiveChatMutation.isPending}
                disabled={isChatLoading}
                icon={<Archive className="h-4 w-4" />}
                label="Archive"
                variant="warning"
              />
            )}
          </div>
        )}

        {/* Right side pane toggle — shown only when the current page
            registers a right pane (chat detail, workflow run). */}
        {rightPaneController && (
          <Tooltip content={rightPaneController.open ? 'Hide side pane' : 'Show side pane'}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={rightPaneController.toggle}
              aria-pressed={rightPaneController.open}
              aria-label={rightPaneController.open ? 'Hide side pane' : 'Show side pane'}
              data-testid="header-toggle-right-pane"
              className={cn(
                'rounded-md border p-1 transition-colors',
                rightPaneController.open
                  ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'border-border text-[var(--color-muted-foreground)] hover:bg-subtle hover:text-[var(--color-foreground)]',
              )}
            >
              {rightPaneController.open ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </Button>
          </Tooltip>
        )}
      </div>

      {/* Archive Confirmation Dialog (Chat only) */}
      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title="Archive Chat"
        description="Are you sure you want to archive this chat? You can still view it but won't be able to send new messages."
        confirmLabel="Archive"
        variant="warning"
        loading={archiveChatMutation.isPending}
        onConfirm={handleArchiveChatConfirm}
      />
    </header>
  );
}

// ── Sub-components ──

/** Chat status pill in the header. Reflects the chat's lifecycle status
 *  (active/archived/deleted) but is overridden by the live copilot stream
 *  state (Generating / Processing) while a turn is in flight. Token-based
 *  via the shared Badge so it matches the design system in light + dark. */
function ChatStatusBadge({
  status,
  copilotStatus,
  awaitingUser = false,
}: {
  status: string;
  copilotStatus?: string;
  awaitingUser?: boolean;
}) {
  const live = copilotStatus === 'streaming' || copilotStatus === 'thinking' || copilotStatus === 'pending';
  const isGenerating = (copilotStatus === 'streaming' || copilotStatus === 'thinking') && !awaitingUser;
  const isProcessing = copilotStatus === 'pending' && !awaitingUser;

  let label = status;
  let tone: BadgeTone = status === 'active' ? 'success' : 'neutral';

  if (live && awaitingUser) {
    // The banner under the header says "Paused — waiting for your input"; a
    // pill two lines above it that still said "Generating" sent the opposite
    // message, and it is the one visible from every other tab of the app.
    label = 'Needs input';
    tone = 'warning';
  } else if (isGenerating) {
    label = 'Generating';
    tone = 'info';
  } else if (isProcessing) {
    label = 'Processing';
    tone = 'warning';
  }

  return (
    <Badge tone={tone} size="sm" className="shrink-0 capitalize">
      {label}
    </Badge>
  );
}

interface ActionButtonProps {
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  variant: 'success' | 'warning' | 'destructive' | 'default';
}

function ActionButton({ onClick, loading, disabled, icon, label, variant }: ActionButtonProps) {
  const variantClasses: Record<string, string> = {
    success: 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20',
    warning: 'text-yellow-600 hover:bg-yellow-50 dark:text-yellow-400 dark:hover:bg-yellow-900/20',
    destructive: 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20',
    default: 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent-tint)]',
  };

  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        aria-label={label}
        disabled={disabled || loading}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
          variantClasses[variant],
        )}
      >
        {loading ? (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          icon
        )}
        <span className="hidden @min-[800px]:inline">{label}</span>
      </Button>
    </Tooltip>
  );
}
