// ────────────────────────────────────────────────────────────────
// useWorkbenchPane — a legacy chat / run screen claims the workspace pane.
//
// The pane (blocks/WorkspacePane, MB-42) is shell chrome; the screen owns
// what goes in it. Until M6 rebuilds the tabs as blocks, the bodies are the
// legacy tool sections (WorkbenchTab) and the counts come from the existing
// workbench index (useWorkbench). Pinned tabs always; Tasks, Computer and Plan
// only when they apply (MD-23). The Session tool is not a pane tab (MD-95).
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { DOCK_PINNED_TABS } from '@generatorai/shared/ui-contract';

import { useAuth } from '../../services/auth/AuthProvider';
import {
  PANE_TABS,
  paneTabTypes,
  useClaimPaneScope,
  usePaneStore,
  type MobilePaneTab,
  type PaneClaim,
} from '../../blocks/WorkspacePane';
import { WorkbenchTab, type ToolFocus, type WorkbenchTabProps } from './WorkbenchTab';
import type { ToolDescriptor, ToolId } from './workbenchModel';

export type { ToolFocus } from './WorkbenchTab';

/** A workbench tool id as a pane tab (the Session tool has no tab). */
export function paneTabForTool(tool: ToolId): MobilePaneTab | null {
  return tool === 'session' ? null : tool;
}

export interface UseWorkbenchPaneInput {
  kind: 'chat' | 'run';
  id: string | undefined;
  title: string;
  path: string;
  tools: readonly ToolDescriptor[];
  /** The screen's own focus request (the changes tray, a tool row) rides in `changesFocus`. */
  body: Omit<WorkbenchTabProps, 'type' | 'active' | 'filesFocus' | 'onOpenInFiles'>;
}

export interface WorkbenchPane {
  /** This screen's pane is open. */
  open: boolean;
  active: MobilePaneTab;
  openTab: (tab: MobilePaneTab) => void;
  close: () => void;
}

export function useWorkbenchPane({ kind, id, title, path, tools, body }: UseWorkbenchPaneInput): WorkbenchPane {
  const { serverId } = useAuth();
  const [filesFocus, setFilesFocus] = useState<ToolFocus | null>(null);
  const nonce = useRef(0);

  const openInFiles = useCallback((p: string, alias?: string) => {
    nonce.current += 1;
    setFilesFocus({ path: p, ...(alias ? { alias } : {}), nonce: nonce.current });
    usePaneStore.getState().openTab('files');
  }, []);

  const tabs = useMemo(() => {
    const has = (t: ToolId): ToolDescriptor | undefined => tools.find((d) => d.id === t);
    const plan = has('plan');
    const types = kind === 'run'
      ? [...DOCK_PINNED_TABS]
      : paneTabTypes({ tasks: Boolean(has('tasks')), computer: Boolean(has('computer')), plan: Boolean(plan && plan.glimpse !== 'No plan yet') });
    return types.map((type) => {
      const tool = has(type);
      return {
        id: type,
        type,
        label: PANE_TABS[type].label,
        icon: PANE_TABS[type].icon,
        ...(tool?.count ? { count: tool.count } : {}),
        ...(tool?.attention ? { attention: true } : {}),
      };
    });
  }, [tools, kind]);

  const claim = useMemo<PaneClaim | null>(
    () =>
      id && serverId
        ? {
            scope: { serverId, kind, id },
            title,
            path,
            tabs,
            renderTab: (type, ctx) => (
              <WorkbenchTab
                {...body}
                type={type}
                active={ctx.active}
                filesFocus={filesFocus}
                onOpenInFiles={openInFiles}
              />
            ),
          }
        : null,
    [id, serverId, kind, title, path, tabs, body, filesFocus, openInFiles],
  );
  useClaimPaneScope(claim);

  const open = usePaneStore((s) => s.open && s.claim?.scope.id === id);
  const active = usePaneStore((s) => s.active);
  return {
    open,
    active,
    openTab: (tab) => usePaneStore.getState().openTab(tab),
    close: () => usePaneStore.getState().setOpen(false),
  };
}
