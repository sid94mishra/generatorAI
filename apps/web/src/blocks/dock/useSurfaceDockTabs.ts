// ────────────────────────────────────────────────────────────────
// useSurfaceDockTabs — which dock tab types this surface and this chat get
// (W29 ledger, `platform/surfaceCapabilities`): the types, what the "+" menu
// offers, and the tab the dock opens on. A surface that cannot render a live
// view is never offered its tab; a chat with nothing to show (no orchestrator,
// computer use off) is not either.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import type { DockTabType } from '@generatorai/shared/ui-contract';
import { defaultDockTab, dockAddableTabTypes, dockTabTypes } from '@/platform/surfaceCapabilities.js';

export interface SurfaceDockTabs {
  types: DockTabType[];
  addable: DockTabType[];
  defaultTab: 'changes' | 'files';
}

export function useSurfaceDockTabs(options: { isOrchestrator: boolean; computerUseEnabled: boolean }): SurfaceDockTabs {
  const { isOrchestrator, computerUseEnabled } = options;
  return useMemo(() => {
    const types = dockTabTypes({ isOrchestrator, computerUseEnabled });
    return { types, addable: dockAddableTabTypes(types), defaultTab: defaultDockTab() };
  }, [isOrchestrator, computerUseEnabled]);
}
