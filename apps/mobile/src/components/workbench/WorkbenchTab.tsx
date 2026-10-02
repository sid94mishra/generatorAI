// ────────────────────────────────────────────────────────────────
// WorkbenchTab — one legacy session tool as a body of the workspace pane.
//
// M5-03 re-hosts the existing tool sections inside the new pane (MB-42)
// until M6 replaces each with its block (MB-22…MB-31). The pane keeps
// visited tabs mounted and passes `active` so hidden heavy tools (terminal,
// browser, computer) pause. Changes and Files keep their own file detail
// with a back row (uncontrolled), so Back inside a tab stays in the tab.
// ────────────────────────────────────────────────────────────────

import React from 'react';

import { EmptyState } from '../ui/States';
import { checkFeature } from '../../services/auth/featureGate';
import { FilesSection } from '../chat/workbench/FilesSection';
import { ChangesSection } from '../chat/workbench/ChangesSection';
import { TasksSection } from '../chat/workbench/TasksSection';
import { PlanSection } from '../chat/workbench/PlanSection';
import { TerminalSection } from '../chat/workbench/TerminalSection';
import { BrowserSection } from '../chat/workbench/BrowserSection';
import { LockedPane } from '../chat/panes/LockedPane';
import { ComputerPane } from '../chat/panes/ComputerPane';
import { COMPUTER_SCOPE, computerFeature } from '../chat/panes/paneModel';
import type { MobilePaneTab } from '../../blocks/WorkspacePane';

type WithActive<P> = React.ComponentType<P & { active?: boolean }>;
const TerminalPane = TerminalSection as WithActive<React.ComponentProps<typeof TerminalSection>>;
const BrowserPane = BrowserSection as WithActive<React.ComponentProps<typeof BrowserSection>>;

/** A request to open one file in a tool. `nonce` re-asks for the same file. */
export interface ToolFocus {
  path: string;
  alias?: string;
  nonce: number;
}

export interface WorkbenchTabProps {
  type: MobilePaneTab;
  active: boolean;
  workspaceId: string | null;
  scopes: readonly string[];
  chatId?: string | null;
  planId?: string | null;
  agentBusy?: boolean;
  changesFocus?: ToolFocus | null;
  filesFocus?: ToolFocus | null;
  onOpenInFiles?: (path: string, alias?: string) => void;
  onOpenInChanges?: (path: string, alias?: string) => void;
  onPlanDecided?: () => void;
}

export function WorkbenchTab({
  type,
  active,
  workspaceId,
  scopes,
  chatId = null,
  planId = null,
  agentBusy = false,
  changesFocus = null,
  filesFocus = null,
  onOpenInFiles,
  onOpenInChanges,
  onPlanDecided,
}: WorkbenchTabProps): React.ReactElement | null {
  const noWorkspace = <EmptyState title="No workspace yet" message="A workspace is created the first time the agent runs here." />;
  switch (type) {
    case 'changes':
      return workspaceId ? (
        <ChangesSection
          workspaceId={workspaceId}
          chatId={chatId}
          focusPath={changesFocus?.path ?? null}
          focusNonce={changesFocus?.nonce ?? 0}
          active={active}
          {...(onOpenInFiles ? { onOpenInFiles } : {})}
        />
      ) : (
        noWorkspace
      );
    case 'files':
      return workspaceId ? (
        <FilesSection
          workspaceId={workspaceId}
          active={active}
          focusPath={filesFocus?.path ?? null}
          focusAlias={filesFocus?.alias ?? null}
          {...(onOpenInChanges ? { onOpenInChanges } : {})}
        />
      ) : (
        noWorkspace
      );
    case 'terminal': {
      if (!workspaceId) return noWorkspace;
      const terminal = checkFeature('terminal', scopes);
      return terminal.available ? (
        <TerminalPane workspaceId={workspaceId} active={active} />
      ) : (
        <LockedPane title="Terminal is not enabled" feature={terminal} scope="exec:terminal" />
      );
    }
    case 'browser': {
      if (!workspaceId) return noWorkspace;
      const browser = checkFeature('browser', scopes);
      return browser.available ? (
        <BrowserPane workspaceId={workspaceId} active={active} agentBusy={agentBusy} />
      ) : (
        <LockedPane title="Browser is not enabled" feature={browser} scope="exec:browser" />
      );
    }
    case 'computer': {
      if (!workspaceId) return noWorkspace;
      const computer = computerFeature(scopes);
      return computer.available ? (
        <ComputerPane workspaceId={workspaceId} active={active} />
      ) : (
        <LockedPane title="Computer use is not enabled on this device" feature={computer} scope={COMPUTER_SCOPE} />
      );
    }
    case 'tasks':
      return chatId ? <TasksSection chatId={chatId} active={active} /> : null;
    case 'plan':
      return chatId ? (
        <PlanSection key={planId ?? 'latest'} chatId={chatId} active={active} initialPlanId={planId} {...(onPlanDecided ? { onDecided: onPlanDecided } : {})} />
      ) : null;
    default:
      return null;
  }
}
