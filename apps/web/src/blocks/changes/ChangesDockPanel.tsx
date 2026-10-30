// ────────────────────────────────────────────────────────────────
// The Changes panel as a dock tab (blocks/dock registry, D-27).
//
// The dock renders `Component` with `DockPanelProps` only; everything the
// panel needs (workspace, chat, review scope, focus requests) comes from
// `ChangesDockContext`, which the page provides once with a memoised value —
// so a page re-render on every streamed token never reaches this panel.
// The panel body is lazy: the diff renderer (Shiki grammars, workers) stays
// off the path to first paint.
// ────────────────────────────────────────────────────────────────

import { createContext, lazy, memo, Suspense, useContext } from 'react';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import type { DockPanelProps } from '@/blocks/dock/dockRegistry.js';
import type { ChangesPanelProps } from './ChangesPanel.js';

const ChangesPanel = lazy(() => import('./ChangesPanel.js').then((m) => ({ default: m.ChangesPanel })));

/** What the page hands the Changes tab. */
export const ChangesDockContext = createContext<ChangesPanelProps | null>(null);

function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center text-fg-3">
      <Spinner size={16} label="Loading changes" />
    </div>
  );
}

/** Registry `Component` for the `changes` tab type. */
export const ChangesDockPanel = memo(function ChangesDockPanel(_props: DockPanelProps) {
  const props = useContext(ChangesDockContext);
  return (
    <Suspense fallback={<PanelLoading />}>
      <ChangesPanel {...(props ?? {})} />
    </Suspense>
  );
});
