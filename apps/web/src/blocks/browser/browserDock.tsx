// ────────────────────────────────────────────────────────────────
// Browser dock panel (F-dock-04): registered with the kit dock as a
// `Component`; everything it needs comes from `<BrowserDockProvider>`. Each
// page is its own dock tab (≤ 5, D-27) keyed by the tab id (its own native
// view / screencast session); only the active tab streams (P1-50).
// ────────────────────────────────────────────────────────────────

import { createContext, lazy, memo, Suspense, useCallback, useContext } from 'react';
import type { DockPanelProps } from '@/blocks/dock/dockRegistry.js';
import { useActivated } from '@/blocks/dock/useActivated.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import type { BrowserCaptureHandler } from './useBrowserAnnotations.js';
import type { BrowserTabState } from './useBrowserTabState.js';

const BrowserPanel = lazy(() => import('./BrowserPanel.js').then((m) => ({ default: m.BrowserPanel })));

export interface BrowserDockContextValue {
  workspaceId: string | undefined;
  /** Namespace of each tab's remembered URL (`chat:<id>`, `workflow-run:<id>`). */
  urlScopeKey?: string;
  onCapture?: BrowserCaptureHandler;
  /** A turn is streaming: detach is locked and the agent strip shows. */
  agentBusy?: boolean;
  agentName?: string;
  /** A tab's page title / favicon / loading changed (drives its label). */
  onTabStateChange?: (tabId: string, state: BrowserTabState) => void;
}

const BrowserDockContext = createContext<BrowserDockContextValue | null>(null);
export const BrowserDockProvider = BrowserDockContext.Provider;

/** The tab label: the page title, else "Browser" / "Browser 2". */
export function browserDockTabLabel(state: BrowserTabState | null | undefined, index: number): string {
  const title = (state?.title ?? '').trim();
  return title || (index <= 1 ? 'Browser' : `Browser ${index}`);
}

export const BrowserDockPanel = memo(function BrowserDockPanel({ id, active }: DockPanelProps) {
  const ctx = useContext(BrowserDockContext);
  if (!ctx) throw new Error('BrowserDockPanel needs a <BrowserDockProvider>');
  const { onTabStateChange } = ctx;
  const onStateChange = useCallback((state: BrowserTabState) => onTabStateChange?.(id, state), [onTabStateChange, id]);
  // The pinned Browser tab starts its session when first shown, not with the page.
  const activated = useActivated(active);
  if (!activated) return null;
  if (!ctx.workspaceId) {
    return <div className="p-4 text-small text-fg-3">Browser is not available until this chat has a workspace.</div>;
  }
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner size={16} label="Loading browser" />
        </div>
      }
    >
      <BrowserPanel
        workspaceId={ctx.workspaceId}
        tabId={id}
        open
        // Every tab stays mounted; only the selected one holds a live socket.
        visible={active}
        {...(ctx.urlScopeKey ? { urlScopeKey: ctx.urlScopeKey } : {})}
        {...(ctx.onCapture ? { onCapture: ctx.onCapture } : {})}
        agentBusy={ctx.agentBusy ?? false}
        {...(ctx.agentName ? { agentName: ctx.agentName } : {})}
        onTabStateChange={onStateChange}
      />
    </Suspense>
  );
});
