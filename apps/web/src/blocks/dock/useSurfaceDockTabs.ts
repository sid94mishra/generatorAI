// ────────────────────────────────────────────────────────────────
// useSurfaceDockTabs — which dock tab types this surface and this chat get
// (W29 ledger, `platform/surfaceCapabilities`): the types, what the "+" menu
// offers, and the tab the dock opens on. A surface that cannot render a live
// view is never offered its tab; a chat with nothing to show (no orchestrator,
// computer use off) is not either.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { defaultDockTab, dockAddableTabTypes, dockTabTypes, type ChatDockTabType } from '@/platform/surfaceCapabilities.js';

export interface SurfaceDockTabs {
  types: ChatDockTabType[];
  addable: ChatDockTabType[];
  defaultTab: 'changes' | 'files';
}

export function useSurfaceDockTabs(options: { isOrchestrator: boolean; computerUseEnabled: boolean; devicesEnabled?: boolean }): SurfaceDockTabs {
  const { isOrchestrator, computerUseEnabled, devicesEnabled = false } = options;
  return useMemo(() => {
    const types = dockTabTypes({ isOrchestrator, computerUseEnabled, devicesEnabled });
    return { types, addable: dockAddableTabTypes(types), defaultTab: defaultDockTab() };
  }, [isOrchestrator, computerUseEnabled, devicesEnabled]);
}
