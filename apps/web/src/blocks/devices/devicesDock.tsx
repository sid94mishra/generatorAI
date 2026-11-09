// ────────────────────────────────────────────────────────────────
// Devices dock panel (docs/devices DV-10): registered with the kit dock as a
// `Component`; everything it needs comes from `<DevicesDockProvider>`. Each
// Devices tab is its own device (≤ 4); only the selected tab streams (P1-50).
// ────────────────────────────────────────────────────────────────

import { createContext, lazy, memo, Suspense, useCallback, useContext } from 'react';
import type { DockPanelProps } from '@/blocks/dock/dockRegistry.js';
import { useActivated } from '@/blocks/dock/useActivated.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

const DevicesPanel = lazy(() => import('./DevicesPanel.js').then((m) => ({ default: m.DevicesPanel })));

export interface DevicesTabState {
  name: string | null;
  running: boolean;
  agentActive: boolean;
}

export interface DevicesDockContextValue {
  workspaceId: string | undefined;
  /** Namespace of each tab's remembered device (`chat:<id>`). */
  scopeKey: string;
  onCapture?: (file: File) => void;
  agentBusy?: boolean;
  agentName?: string;
  /** The first Devices tab follows the device the agent opens. */
  firstTabId?: string;
  onTabStateChange?: (tabId: string, state: DevicesTabState) => void;
}

const DevicesDockContext = createContext<DevicesDockContextValue | null>(null);
export const DevicesDockProvider = DevicesDockContext.Provider;

/** The tab label: the device's name, else "Devices" / "Devices 2". */
export function devicesDockTabLabel(state: DevicesTabState | undefined, index: number): string {
  return state?.name ?? (index <= 1 ? 'Devices' : `Devices ${index}`);
}

export const DevicesDockPanel = memo(function DevicesDockPanel({ id, active, index }: DockPanelProps) {
  const ctx = useContext(DevicesDockContext);
  if (!ctx) throw new Error('DevicesDockPanel needs a <DevicesDockProvider>');
  const { onTabStateChange } = ctx;
  const onState = useCallback((state: DevicesTabState) => onTabStateChange?.(id, state), [onTabStateChange, id]);
  const activated = useActivated(active);
  if (!activated) return null;
  if (!ctx.workspaceId) {
    return <div className="p-4 text-small text-fg-3">Devices are not available until this chat has a workspace.</div>;
  }
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner size={16} label="Loading devices" />
        </div>
      }
    >
      <DevicesPanel
        workspaceId={ctx.workspaceId}
        tabId={id}
        scopeKey={ctx.scopeKey}
        visible={active}
        followAgent={ctx.firstTabId ? ctx.firstTabId === id : index <= 1}
        {...(ctx.onCapture ? { onCapture: ctx.onCapture } : {})}
        agentBusy={ctx.agentBusy ?? false}
        {...(ctx.agentName ? { agentName: ctx.agentName } : {})}
        onTabStateChange={onState}
      />
    </Suspense>
  );
});
