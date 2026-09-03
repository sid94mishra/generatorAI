// ────────────────────────────────────────────────────────────────
// Header — Context-aware actions for Chats,
//          connection status, dark mode toggle
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useChat, useArchiveChat } from '@/hooks/queries.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { useConnectionStore } from '@/stores/connectionStore.js';
import { useRightPaneStore } from '@/stores/rightPaneStore.js';
import { cn } from '@/lib/utils.js';
import { Tooltip } from '@/components/Tooltip.js';
import { Badge, type BadgeTone } from '@/components/ui/index.js';
import {
  Sun,
  Moon,
  PanelLeftOpen,
  PanelRightOpen,
  PanelRightClose,
  Monitor,
  Archive,
  MessageSquare,
} from 'lucide-react';

interface HeaderProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function Header({ sidebarOpen, onToggleSidebar }: HeaderProps) {
  // Worst state across the scopes this tab is subscribed to. 'disconnected'
  // entries with zero received events are ignored — that is the initial
  // record for a scope whose subscription never opened (or a stale default),
  // not an outage.
  const streamHealth = useConnectionStore((s) => {
    let health: 'connected' | 'reconnecting' | 'disconnected' = 'connected';
    for (const info of Object.values(s.connections)) {
      if (info.state === 'reconnecting') health = 'reconnecting';
      if (info.state === 'disconnected' && info.eventsReceived > 0) return 'disconnected';
    }
    return health;
  });
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, setMode } = useTheme();
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
      className="flex h-10 items-center justify-between border-b border-border bg-background px-3"
    >
      {/* Left: sidebar toggle (only when collapsed — the open-state toggle
          lives on the sidebar itself) + breadcrumb */}
      <div className="flex items-center gap-3">
        {!sidebarOpen && (
          <Tooltip content="Show sidebar">
            <button
              onClick={onToggleSidebar}
              aria-label="Show sidebar"
              data-testid="header-toggle-sidebar"
              className="rounded-md border border-border p-1 text-[var(--color-muted-foreground)] transition-colors hover:bg-subtle hover:text-[var(--color-foreground)]"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
        <div className="flex items-center gap-2 text-sm">
          {isDashboard ? (
            <>
              <span className="font-medium text-[var(--color-foreground)]">Dashboard</span>
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
                  <span className="font-medium text-[var(--color-foreground)]">{chat.name}</span>
                  <ChatStatusBadge status={chat.status} copilotStatus={streamStatus} />
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

      {/* Right: actions + connection status + theme toggle */}
      <div className="flex items-center gap-2">
        {/* Live-stream health. Quietly absent while everything is connected;
            a server restart or dropped socket used to be completely invisible
            (observed live: server killed mid-turn, page showed nothing). */}
        {streamHealth !== 'connected' && (
          <Tooltip
            content={
              streamHealth === 'reconnecting'
                ? 'Live updates interrupted — reconnecting. Anything missed is replayed on reconnect.'
                : 'Live updates disconnected. The page will keep retrying; refresh if this persists.'
            }
          >
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                streamHealth === 'reconnecting'
                  ? 'border-[var(--color-warning)]/40 text-[var(--color-warning)]'
                  : 'border-[var(--color-danger)]/40 text-[var(--color-danger)]',
              )}
            >
              <span className={cn(
                'h-1.5 w-1.5 rounded-full',
                streamHealth === 'reconnecting'
                  ? 'animate-pulse bg-[var(--color-warning)]'
                  : 'bg-[var(--color-danger)]',
              )} />
              {streamHealth === 'reconnecting' ? 'Reconnecting…' : 'Live updates off'}
            </span>
          </Tooltip>
        )}
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

        {/* Separator */}
        {chatId && <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />}

        {/* Light/dark/system cycle. The PALETTE is not cycled here — with six
            themes a blind rotation stops being a shortcut and starts being a
            way to lose the theme you had. That lives in Settings. */}
        <Tooltip content={`Appearance: ${mode}`}>
          <button
            onClick={() => {
              const next = mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark';
              setMode(next);
            }}
            aria-label={`Appearance: ${mode}. Click to change.`}
            className="rounded-md border border-border p-1 text-[var(--color-muted-foreground)] hover:bg-subtle hover:text-[var(--color-foreground)]"
          >
          {mode === 'dark' ? (
            <Moon className="h-4 w-4" />
          ) : mode === 'light' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Monitor className="h-4 w-4" />
          )}
          </button>
        </Tooltip>

        {/* Right side pane toggle — shown only when the current page
            registers a right pane (chat detail, workflow run). */}
        {rightPaneController && (
          <Tooltip content={rightPaneController.open ? 'Hide side pane' : 'Show side pane'}>
            <button
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
            </button>
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
function ChatStatusBadge({ status, copilotStatus }: { status: string; copilotStatus?: string }) {
  const isGenerating = copilotStatus === 'streaming' || copilotStatus === 'thinking';
  const isProcessing = copilotStatus === 'pending';

  let label = status;
  let tone: BadgeTone = status === 'active' ? 'success' : 'neutral';

  if (isGenerating) {
    label = 'Generating';
    tone = 'info';
  } else if (isProcessing) {
    label = 'Processing';
    tone = 'warning';
  }

  return (
    <Badge tone={tone} size="sm" className="capitalize">
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
    default: 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]',
  };

  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
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
        <span className="hidden sm:inline">{label}</span>
      </button>
    </Tooltip>
  );
}
