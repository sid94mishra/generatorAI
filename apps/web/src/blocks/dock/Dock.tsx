// ────────────────────────────────────────────────────────────────
// Dock — the chat / run page's right dock (D-27): S-08 DockFrame + C-19
// DockTabStrip driven by `useDockState` and the page's `DockRegistry`.
// Replaced `components/layout/RightPane.tsx` (the chat page in P4-06, the
// workflow run page in PW-c, which deleted it).
//
// Keeps the historical `right-pane*` testids and accessible names (09 §7.2):
// `right-pane`, `right-pane-tab-<type>`, `right-pane-add-tab`,
// `right-pane-add-<type>`, `right-pane-fullscreen` (Maximize),
// `right-pane-close` (sheet Close), `right-pane-cap-notice`,
// `right-pane-overflow-<type>`, `right-pane-panel-<type>`; "Right side pane",
// "Right pane tabs", "Add tab", "Close <label> tab", "Resize right pane".
// The sheet (window < 1200) is `dock-sheet` (09 §7.3).
//
// Behaviour:
// - Tabs: the default tab first, then the pinned types, then the rest in open
//   order; one selected; the "+" menu offers `addableTabTypes` (extra
//   instances below their cap); overflowing tabs are listed in the "+" menu.
// - Panels mount the first time their tab is selected while the dock is open
//   and then stay mounted — through tab switches, closing the dock and the
//   1200px breakpoint — until their tab is closed.
// - Mode: `panel` ≥ 1200px, `sheet` below (RAIL_QUERY), `full` on a phone-width
//   viewport or a host under 760px. Maximize everywhere but `full`; Escape
//   restores a maximized dock, else closes a sheet.
// ────────────────────────────────────────────────────────────────

import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { RAIL_QUERY, NARROW_VIEWPORT_QUERY, useMediaQuery } from '@/hooks/useMediaQuery.js';
import { DockFrame, DockPanel, type DockMode } from '@/ui/shell/DockFrame/DockFrame.js';
import { DockTabStrip, type DockAddItem, type DockTab } from '@/ui/patterns/DockTabStrip/DockTabStrip.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import type { DockFocusRequest, DockPanelProps, DockRegistry, DockTabDef } from './dockRegistry.js';
import { countOfType, isClosable, ordinals, type DockTabRef } from './dockState.js';
import { useDockState } from './useDockState.js';

/** A host narrower than this cannot hold two readable columns: the dock covers it. */
export const DOCK_MIN_TWO_COLUMN_HOST = 760;

export interface DockProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tab-list persistence key, per chat / run (`dockStorageKeys(scope).tabs(id)`). */
  storageKey: string;
  /** Split-layout persistence key, per page (`dockStorageKeys(scope).layout`). */
  layoutStorageKey?: string;
  /** The tab types (see `dockRegistry.ts`). */
  tabs: DockRegistry;
  /** The tab the dock opens on; always first, never closable. */
  defaultTabType: string;
  /** Types the "+" menu offers (extra instances, Widget). */
  addableTabTypes: readonly string[];
  focusTabRequest?: DockFocusRequest | null;
  /** A tab closed for good: drop what it remembered (a browser tab's URL). */
  onTabClose?: (tab: DockTabRef) => void;
  /** The page's main column. Omitted: the dock renders alone (tests, stories). */
  main?: ReactNode;
  /** Dock width in px: 480, or 440 on run pages (D-27). */
  defaultSize?: number;
  className?: string;
}

interface DockPanelHostProps extends DockPanelProps {
  def: DockTabDef;
  mounted: boolean;
  label: string;
}

/**
 * One tab's body behind a memo boundary: a page re-render (every streamed
 * token) reaches no panel whose def and ctx are unchanged; `def` compares by
 * identity, which is why pages memoise their registry.
 */
const DockPanelHost = memo(function DockPanelHost({ def, mounted, label, id, type, index, active }: DockPanelHostProps) {
  const Body = def.Component;
  return (
    <DockPanel active={active} label={label} data-testid={`right-pane-panel-${type}`} data-tab-id={id}>
      {mounted ? Body ? <Body id={id} type={type} index={index} active={active} /> : def.render?.({ id, type, index, active }) : null}
    </DockPanel>
  );
});

function useDockMode(): [DockMode, (width: number) => void] {
  const rail = useMediaQuery(RAIL_QUERY);
  const phone = useMediaQuery(NARROW_VIEWPORT_QUERY);
  const [hostWidth, setHostWidth] = useState(0);
  const mode: DockMode = phone || (hostWidth > 0 && hostWidth < DOCK_MIN_TWO_COLUMN_HOST) ? 'full' : rail ? 'sheet' : 'panel';
  return [mode, setHostWidth];
}

/** The chat / run right dock. */
export function Dock({
  open,
  onOpenChange,
  storageKey,
  layoutStorageKey,
  tabs: registry,
  defaultTabType,
  addableTabTypes,
  focusTabRequest,
  onTabClose,
  main = null,
  defaultSize = 480,
  className,
}: DockProps) {
  const { state, capNotice, select, add, close } = useDockState({
    storageKey,
    registry,
    defaultTabType,
    focusRequest: focusTabRequest,
    onTabClose,
  });
  const [mode, setHostWidth] = useDockMode();

  // Maximize is a view state: not persisted, dropped when the dock closes or goes full-width.
  const [maximizedRaw, setMaximized] = useState(false);
  if (maximizedRaw && !open) setMaximized(false);
  const maximized = maximizedRaw && mode !== 'full';

  // Panels mount on first selection while open, then stay (see header).
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set(open ? [state.active] : []));
  if (open && state.active && !mounted.has(state.active)) setMounted(new Set(mounted).add(state.active));

  const index = useMemo(() => ordinals(state.tabs), [state.tabs]);

  const labelOf = useCallback(
    (tab: DockTabRef) => {
      const def = registry[tab.type]!;
      const inst = { id: tab.id, index: index.get(tab.id) ?? 1 };
      return def.getTabLabel ? def.getTabLabel(inst) : def.label;
    },
    [registry, index],
  );

  const stripTabs = useMemo<DockTab[]>(
    () =>
      state.tabs.flatMap((tab) => {
        const def = registry[tab.type];
        if (!def) return [];
        const inst = { id: tab.id, index: index.get(tab.id) ?? 1 };
        const count = def.getTabCount?.(inst);
        const dot = def.getTabDot?.(inst);
        return [
          {
            id: tab.id,
            label: labelOf(tab),
            icon: def.getTabIcon ? def.getTabIcon(inst) : def.icon,
            ...(count !== undefined ? { count } : {}),
            ...(dot ? { dot } : {}),
            closable: isClosable(state, tab.id, registry, defaultTabType),
            testId: `right-pane-tab-${tab.type}`,
            overflowTestId: `right-pane-overflow-${tab.type}`,
          },
        ];
      }),
    [state, registry, index, labelOf, defaultTabType],
  );

  const addItems = useMemo<DockAddItem[]>(
    () =>
      addableTabTypes.flatMap((type) => {
        const def = registry[type];
        if (!def) return [];
        const count = countOfType(state, type);
        const offered = def.allowMultiple ? def.maxInstances === undefined || count < def.maxInstances : count === 0;
        if (!offered) return [];
        const description = def.disabled
          ? (def.disabledReason ?? 'Unavailable')
          : def.allowMultiple && def.maxInstances !== undefined && count > 0
            ? `${count} of ${def.maxInstances} open`
            : def.description;
        return [
          {
            value: type,
            label: def.label,
            icon: def.icon,
            ...(description ? { description } : {}),
            ...(def.disabled ? { disabled: true } : {}),
            testId: `right-pane-add-${type}`,
          },
        ];
      }),
    [addableTabTypes, registry, state],
  );

  const onEscape = useCallback(() => {
    if (maximized) setMaximized(false);
    else onOpenChange(false);
  }, [maximized, onOpenChange]);

  const compact = mode !== 'panel';
  const strip = (
    <DockTabStrip
      tabs={stripTabs}
      value={state.active}
      onValueChange={select}
      addItems={addItems}
      onAddSelect={add}
      onCloseTab={close}
      compact={compact}
      maximized={maximized}
      {...(mode !== 'full' ? { onMaximize: () => setMaximized((m) => !m) } : {})}
      onClose={() => onOpenChange(false)}
      labels={{ tablist: 'Right pane tabs', close: 'Close right pane' }}
      testIds={{ add: 'right-pane-add-tab', maximize: 'right-pane-fullscreen', close: 'right-pane-close' }}
    />
  );

  const notice = capNotice ? (
    <div className="shrink-0 border-b border-line-soft p-2">
      <Callout tone="warn" role="status" data-testid="right-pane-cap-notice">
        {capNotice}
      </Callout>
    </div>
  ) : null;

  return (
    <DockFrame
      className={className}
      main={main}
      strip={strip}
      notice={notice}
      open={open}
      mode={mode}
      maximized={maximized}
      splitId="dock"
      {...(layoutStorageKey ? { layoutStorageKey } : {})}
      defaultSize={defaultSize}
      onUserCollapse={() => onOpenChange(false)}
      onEscape={onEscape}
      onHostResize={setHostWidth}
      labels={{ dock: 'Right side pane', sheet: 'Side pane', separator: 'Resize right pane' }}
      testIds={{ dock: 'right-pane', sheet: 'dock-sheet' }}
    >
      {state.tabs.map((tab) => {
        const def = registry[tab.type];
        if (!def) return null;
        return (
          <DockPanelHost
            key={tab.id}
            def={def}
            mounted={mounted.has(tab.id)}
            label={labelOf(tab)}
            id={tab.id}
            type={tab.type}
            index={index.get(tab.id) ?? 1}
            active={tab.id === state.active}
          />
        );
      })}
    </DockFrame>
  );
}
