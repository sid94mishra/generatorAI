// ────────────────────────────────────────────────────────────────
// Terminal dock panel (F-dock-03): registered with the kit dock as a
// `Component`; everything it needs comes from `<TerminalDockProvider>`, so a
// page re-render (every streamed token) reaches no terminal whose props did
// not change. Each dock tab is its own shell (≤ 4, D-27). While the agent
// console is open (a "Ran" step's terminal icon), the tab shows the agent's
// read-only command history instead, until "Back to shell".
//
// xterm and its WebGL addon load with the first terminal, not with the page.
// ────────────────────────────────────────────────────────────────

import { createContext, lazy, memo, Suspense, useContext } from 'react';
import type { ChatMessage } from '@generatorai/shared';
import type { DockPanelProps } from '@/blocks/dock/dockRegistry.js';
import { useActivated } from '@/blocks/dock/useActivated.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { AgentConsole } from './AgentConsole.js';
import type { TerminalWorktreeOption } from './TerminalPanel.js';

const TerminalPanel = lazy(() => import('./TerminalPanel.js').then((m) => ({ default: m.TerminalPanel })));

export interface TerminalAgentConsole {
  /** The command to ring and scroll to. */
  callId: string;
  /** The chat's live stream (in-flight commands). */
  sessionId: string | undefined;
  /** Persisted history. */
  messages: readonly ChatMessage[] | undefined;
  onClose: () => void;
}

export interface TerminalDockContextValue {
  workspaceId: string | undefined;
  onCapture?: (file: File, kind: 'terminal') => void;
  agentBusy?: boolean;
  worktrees?: TerminalWorktreeOption[];
  /** Set while the agent console replaces the shells. */
  agentConsole?: TerminalAgentConsole | null;
}

const TerminalDockContext = createContext<TerminalDockContextValue | null>(null);
export const TerminalDockProvider = TerminalDockContext.Provider;

/** The dock tab label: "Terminal", "Terminal 2" … */
export const terminalTabLabel = ({ index }: { index: number }): string => (index <= 1 ? 'Terminal' : `Terminal ${index}`);

export const TerminalDockPanel = memo(function TerminalDockPanel({ id, index, active }: DockPanelProps) {
  const ctx = useContext(TerminalDockContext);
  // The pinned Terminal tab spawns its shell when first shown, not with the page.
  const activated = useActivated(active);
  if (!ctx) throw new Error('TerminalDockPanel needs a <TerminalDockProvider>');
  if (ctx.agentConsole) return <LiveAgentConsole {...ctx.agentConsole} />;
  if (!activated) return null;
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner size={16} label="Loading terminal" />
        </div>
      }
    >
      <TerminalPanel
        workspaceId={ctx.workspaceId}
        tabId={id}
        label={terminalTabLabel({ index })}
        {...(ctx.onCapture ? { onCapture: ctx.onCapture } : {})}
        {...(ctx.worktrees ? { worktrees: ctx.worktrees } : {})}
        agentBusy={ctx.agentBusy ?? false}
      />
    </Suspense>
  );
});

/** Subscribes to the live stream only while the console is open. */
function LiveAgentConsole({ callId, sessionId, messages, onClose }: TerminalAgentConsole) {
  const stream = useStreamStore((state) => (sessionId ? state.streams[sessionId] : undefined));
  return <AgentConsole messages={messages} stream={stream} selectedCallId={callId} onClose={onClose} />;
}
