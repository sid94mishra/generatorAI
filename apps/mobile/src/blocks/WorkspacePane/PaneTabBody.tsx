// The pane's tab bodies (03 MB-42 registry): DockTabType → its block — changes → MB-22, files → MB-25, terminal →
// MB-27, browser → MB-28, computer → MB-29, tasks → MB-30, plan → MB-31 — for a chat or a run scope. The chat and
// the run screen both render the pane through this, so a tab looks and behaves the same over either.
import React from 'react';
import type { ToolCallBlock } from '@generatorai/client-core';

import { BrowserTab, ComputerTab } from '../BrowserView/BrowserTab';
import { ChangesPanel } from '../ChangesPanel/ChangesPanel';
import { FileTree } from '../FileTree/FileTree';
import { PlanView } from '../PlanView/PlanView';
import { TasksList } from '../TasksList/TasksList';
import { TerminalPanel } from '../TerminalView/TerminalPanel';
import { requestRewind } from '../RewindSheet/rewindBus';
import type { MobilePaneTab } from './paneRegistry';

const rewindIn = (chatId: string) => (turnId: string, prompt: string): void => requestRewind(chatId, { turnId, prompt });

export interface PaneTabContext {
  workspaceId: string | null;
  /** The chat whose tabs these are (review threads, tasks, plan); null on a run pane. */
  chatId: string | null;
  /** A turn (or stage) is running. */
  agentBusy: boolean;
  agentName?: string | null;
  /** The agent's shell commands (the Terminal tab's "Agent commands"). */
  agentCalls?: readonly ToolCallBlock[];
  /** The plan to open on (a plan card's "Open plan", `?dock=plan&plan=`). */
  planId?: string | null;
  onPlanDecided?: () => void;
}

export function PaneTabBody({ type, active, ctx }: { type: MobilePaneTab; active: boolean; ctx: PaneTabContext }): React.ReactElement | null {
  switch (type) {
    case 'changes':
      return <ChangesPanel workspaceId={ctx.workspaceId} chatId={ctx.chatId} active={active} {...(ctx.chatId ? { onRewind: rewindIn(ctx.chatId) } : {})} />;
    case 'files':
      return <FileTree workspaceId={ctx.workspaceId} chatId={ctx.chatId} active={active} />;
    case 'terminal':
      return <TerminalPanel workspaceId={ctx.workspaceId} active={active} agentBusy={ctx.agentBusy} {...(ctx.agentCalls ? { agentCalls: ctx.agentCalls } : {})} />;
    case 'browser':
      return <BrowserTab workspaceId={ctx.workspaceId} active={active} agentBusy={ctx.agentBusy} agentName={ctx.agentName ?? null} />;
    case 'computer':
      return <ComputerTab workspaceId={ctx.workspaceId} active={active} />;
    case 'tasks':
      return ctx.chatId ? <TasksList chatId={ctx.chatId} active={active} /> : null;
    case 'plan':
      return ctx.chatId ? <PlanView key={ctx.planId ?? 'latest'} chatId={ctx.chatId} active={active} planId={ctx.planId ?? null} agentName={ctx.agentName ?? null} {...(ctx.onPlanDecided ? { onDecided: ctx.onPlanDecided } : {})} /> : null;
    default:
      return null;
  }
}
