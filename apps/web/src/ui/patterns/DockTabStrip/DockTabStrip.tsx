// ────────────────────────────────────────────────────────────────
// C-19 DockTabStrip — the side dock's tab bar (03 §3 C-19; Rosetta
// `role="tablist" aria-label="Side dock"` 44h of btn-sm tabs).
//
// 44h (`h-bar`), pad 0 8 (0 6 0 8 narrow), gap 2, border-b `line-soft`.
// Tabs are Base UI Tabs (tablist, arrow keys, Home/End, Enter/Space) drawn as
// sm buttons at 28h (`h-control`): 14 icon · label · Count / dot; active
// `bg-selected text-fg`, inactive ghost. `compact` (narrow sheet): inactive
// tabs are icon-only (P-03 md square, label as name + tooltip) and a Close
// ib-sm closes the dock. After the tabs: "+" ib-sm (a P-30 menu of
// `addItems`, or a plain `onAdd` button), a spacer, Maximize ib-sm.
//
// Overflow: the tab row clips (`overflow-x-hidden`, no scrollbar); tabs that
// are not fully visible are listed at the top of the "+" menu ("More tabs")
// and the "+" button carries their count. Picking one selects it and the row
// scrolls it into view (programmatically, as does keyboard focus).
//
// Closable tabs: an inline x (pointer only, hover-revealed on inactive tabs)
// plus Delete on the focused tab and middle-click. The x is `aria-hidden` and
// out of the tab order: a button inside `role="tablist"` is not an allowed
// child (axe aria-required-children); keyboard and AT users close with Delete
// (`aria-keyshortcuts`). Its `aria-label` ("Close X tab") stays for pointer
// test selectors (agent-tests smokes).
// ────────────────────────────────────────────────────────────────

import { useCallback, useLayoutEffect, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';
import { Count } from '../../primitives/Count/Count.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Menu } from '../../primitives/Menu/Menu.js';
import { StatusDot, type DotTone } from '../../primitives/StatusDot/StatusDot.js';
import { Tooltip } from '../../primitives/Tooltip/Tooltip.js';

export interface DockTab {
  id: string;
  label: string;
  icon: IconConcept;
  /** Trailing mono count (changed files, open problems). */
  count?: number;
  /** Trailing status dot; `label` is its accessible meaning (never colour alone). */
  dot?: { tone: DotTone; label: string };
  /** Shows the close x and enables Delete / middle-click (needs `onCloseTab`). */
  closable?: boolean;
  /** `data-testid` of the tab button (e.g. `right-pane-tab-changes`). */
  testId?: string;
  /** `data-testid` of this tab's row in the "More tabs" overflow menu. */
  overflowTestId?: string;
}

export interface DockAddItem {
  value: string;
  label: string;
  icon?: IconConcept;
  /** Second line (e.g. "2 of 5 open"). */
  description?: string;
  disabled?: boolean;
  testId?: string;
}

export interface DockTabStripLabels {
  /** Accessible name of the tablist. Default "Side dock". */
  tablist?: string;
  /** "+" button. Default "Add tab". */
  add?: string;
  /** Heading of the add group in the "+" menu. Default "Open another panel". */
  addGroup?: string;
  /** Heading of the overflow group in the "+" menu. Default "More tabs". */
  overflowGroup?: string;
  /** Maximize button (not maximized). Default "Maximize". */
  maximize?: string;
  /** Maximize button while maximized. Default "Restore". */
  restore?: string;
  /** Close (narrow) button. Default "Close dock". */
  close?: string;
  /** Close x of a tab. Default `Close ${label} tab`. */
  closeTab?: (label: string) => string;
}

export interface DockTabStripProps extends Omit<ComponentProps<'div'>, 'children' | 'onClose'> {
  tabs: readonly DockTab[];
  /** Id of the active tab. */
  value: string;
  onValueChange: (id: string) => void;
  /** "+" without `addItems`: a plain button. */
  onAdd?: () => void;
  /** "+" menu rows ("Open another panel"). */
  addItems?: readonly DockAddItem[];
  onAddSelect?: (value: string) => void;
  /** Maximize ib-sm; omitted = no button (the narrow sheet has none). */
  onMaximize?: () => void;
  /** Maximized: the button is pressed and reads `labels.restore`. */
  maximized?: boolean;
  /** Close ib-sm, shown only when `compact` (the narrow sheet). */
  onClose?: () => void;
  /** Close one closable tab (x, Delete, middle-click). */
  onCloseTab?: (id: string) => void;
  /** Narrow layout: inactive tabs icon-only, Close shown. */
  compact?: boolean;
  labels?: DockTabStripLabels;
  /** `data-testid`s of the trailing buttons (`right-pane-add-tab` …). */
  testIds?: { add?: string; maximize?: string; close?: string };
}

const tabClass = cn(
  'inline-flex h-control min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-control-sm border border-transparent px-2',
  'text-small font-medium whitespace-nowrap text-fg-2 select-none transition-control hover:bg-hover hover:text-fg',
  'aria-selected:bg-selected aria-selected:text-fg aria-selected:hover:bg-selected',
  focusRing,
);

// On IconButton sm (which keeps the 24px hitSlop): a 16px box inside the tab's right padding.
const closeXClass = 'absolute top-1/2 right-1 size-4 -translate-y-1/2 rounded-badge text-fg-3';

/**
 * Ids of the tabs not fully inside the scrolled tab row (re-measured on resize
 * and scroll). The active tab is scrolled into the row first, on every measure:
 * a tab that grows (a count appears in its label) or a dock that narrows must
 * not push the selected tab into the "+" menu.
 */
function useOverflowIds(listRef: RefObject<HTMLDivElement | null>, layoutKey: string, activeId: string): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const keepActiveVisible = () => {
      const el = Array.from(list.querySelectorAll<HTMLElement>('[data-dock-tab]')).find((node) => node.dataset.dockTab === activeId);
      if (!el) return;
      const left = el.offsetLeft;
      const right = left + el.offsetWidth;
      if (left < list.scrollLeft) list.scrollLeft = left;
      else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
    };
    const measure = () => {
      keepActiveVisible();
      // Layout offsets inside the (positioned) row, so transforms and zoom do not skew it.
      const left = list.scrollLeft;
      const right = left + list.clientWidth;
      const next: string[] = [];
      for (const el of Array.from(list.querySelectorAll<HTMLElement>('[data-dock-tab]'))) {
        const start = el.offsetLeft;
        const end = start + el.offsetWidth;
        // 1px tolerance for sub-pixel layout.
        if (start < left - 1 || end > right + 1) next.push(el.dataset.dockTab ?? '');
      }
      setIds((prev) => (prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next));
    };
    measure();
    list.addEventListener('scroll', measure, { passive: true });
    // Re-measure only when a width actually changed: the observer also reports
    // every element once on observe, and reading tab offsets forces a layout of
    // the whole page — costly in the middle of a long streaming answer.
    const widths = new WeakMap<Element, number>();
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            let changed = false;
            for (const entry of entries) {
              const width = entry.contentRect.width;
              if (widths.get(entry.target) !== width) {
                widths.set(entry.target, width);
                changed = true;
              }
            }
            if (changed) measure();
          });
    if (ro) {
      ro.observe(list);
      for (const el of Array.from(list.children)) ro.observe(el);
    }
    return () => {
      list.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
    // `layoutKey` changes with the tab set, the active tab and `compact`: re-measure then.
  }, [listRef, layoutKey, activeId]);
  return ids;
}

/** The side dock tab bar: tabs, "+" menu (with overflow), Maximize, Close (narrow). */
export function DockTabStrip({
  tabs,
  value,
  onValueChange,
  onAdd,
  addItems,
  onAddSelect,
  onMaximize,
  maximized = false,
  onClose,
  onCloseTab,
  compact = false,
  labels,
  testIds,
  className,
  ...rest
}: DockTabStripProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabKey = tabs.map((t) => t.id).join('\u0000');
  const overflowIds = useOverflowIds(listRef, `${tabKey}|${compact}`, value);
  const overflowTabs = tabs.filter((t) => overflowIds.includes(t.id));

  const addLabel = labels?.add ?? 'Add tab';
  const closeTabLabel = labels?.closeTab ?? ((label: string) => `Close ${label} tab`);

  const closeTab = useCallback(
    (tab: DockTab) => {
      if (tab.closable && onCloseTab) onCloseTab(tab.id);
    },
    [onCloseTab],
  );

  const hasAddItems = (addItems?.length ?? 0) > 0;
  const menuMode = hasAddItems || overflowTabs.length > 0;
  const showAdd = menuMode || onAdd !== undefined;
  const addBadge = overflowTabs.length > 0 ? <Count bubble>{overflowTabs.length}</Count> : undefined;
  const addName = overflowTabs.length > 0 ? `${addLabel}, ${overflowTabs.length} more` : addLabel;

  return (
    <div
      className={cn(
        'flex h-bar shrink-0 items-center gap-0.5 border-b border-line-soft pl-1',
        compact ? 'pr-1.5' : 'pr-2',
        className,
      )}
      data-compact={compact || undefined}
      {...rest}
    >
      <Tabs.Root value={value} onValueChange={(next) => onValueChange(String(next))} className="flex min-w-0 self-stretch">
        <Tabs.List
          ref={listRef}
          aria-label={labels?.tablist ?? 'Side dock'}
          // Clips without a scrollbar: hidden tabs are reachable from the "+" menu.
          // px-1 / self-stretch leave room for the 2px focus-ring offset inside the clip.
          className="relative flex min-w-0 items-center gap-0.5 self-stretch overflow-x-hidden px-1"
        >
          {tabs.map((tab) => {
            const active = tab.id === value;
            const iconOnly = compact && !active;
            const closable = Boolean(tab.closable && onCloseTab);
            const showX = closable && !iconOnly;
            const tabEl = (
              <Tabs.Tab
                value={tab.id}
                data-testid={tab.testId}
                aria-label={iconOnly ? (tab.dot ? `${tab.label} (${tab.dot.label})` : tab.label) : undefined}
                // Labels truncate at 120px (page titles, file names): the full one on hover.
                title={iconOnly ? undefined : tab.label}
                aria-keyshortcuts={closable ? 'Delete' : undefined}
                onKeyDown={(event) => {
                  if (event.key === 'Delete' && closable) {
                    event.preventDefault();
                    closeTab(tab);
                  }
                }}
                onAuxClick={(event) => {
                  if (event.button === 1 && closable) {
                    event.preventDefault();
                    closeTab(tab);
                  }
                }}
                className={cn(
                  tabClass,
                  iconOnly && 'relative size-control justify-center px-0',
                  showX && 'pr-6',
                  // A tab the row cannot fit lives in the "+" menu; do not leave half of it showing.
                  overflowIds.includes(tab.id) && 'invisible',
                )}
              >
                <Icon concept={tab.icon} size={14} />
                {iconOnly ? (
                  tab.dot ? (
                    <span className="pointer-events-none absolute top-0.5 right-0.5 flex">
                      <StatusDot tone={tab.dot.tone} size="sm" />
                    </span>
                  ) : null
                ) : (
                  <>
                    <span className="max-w-30 min-w-0 truncate">{tab.label}</span>
                    {tab.count != null ? <Count>{tab.count}</Count> : null}
                    {tab.dot ? <StatusDot tone={tab.dot.tone} size="sm" label={tab.dot.label} /> : null}
                  </>
                )}
              </Tabs.Tab>
            );
            return (
              <div key={tab.id} data-dock-tab={tab.id} className="group relative flex shrink-0">
                {/* Always wrapped (tooltip only when icon-only): activating a tab must not
                    remount it, or keyboard focus is lost. */}
                <Tooltip content={tab.label} side="bottom" disabled={!iconOnly}>
                  {tabEl}
                </Tooltip>
                {showX ? (
                  <IconButton
                    size="sm"
                    icon="x"
                    label={closeTabLabel(tab.label)}
                    tooltip={false}
                    tabIndex={-1}
                    aria-hidden
                    onClick={() => closeTab(tab)}
                    className={cn(closeXClass, !active && 'opacity-0 group-hover:opacity-100')}
                  />
                ) : null}
              </div>
            );
          })}
        </Tabs.List>
      </Tabs.Root>

      {showAdd ? (
        menuMode ? (
          <Menu.Root>
            <Menu.Trigger
              render={
                <IconButton
                  size="sm"
                  icon="plus"
                  label={addName}
                  badge={addBadge}
                  tooltip={false}
                  data-testid={testIds?.add}
                />
              }
            />
            <Menu.Popup align="start">
              {overflowTabs.length > 0 ? (
                <Menu.Group>
                  <Menu.GroupLabel>{labels?.overflowGroup ?? 'More tabs'}</Menu.GroupLabel>
                  {overflowTabs.map((tab) => (
                    <Menu.Item
                      key={tab.id}
                      icon={tab.icon}
                      data-testid={tab.overflowTestId}
                      className={tab.id === value ? 'bg-selected' : undefined}
                      onClick={() => onValueChange(tab.id)}
                    >
                      {tab.label}
                    </Menu.Item>
                  ))}
                </Menu.Group>
              ) : null}
              {overflowTabs.length > 0 && (hasAddItems || onAdd) ? <Menu.Separator /> : null}
              {hasAddItems ? (
                <Menu.Group>
                  <Menu.GroupLabel>{labels?.addGroup ?? 'Open another panel'}</Menu.GroupLabel>
                  {addItems?.map((item) => (
                    <Menu.Item
                      key={item.value}
                      icon={item.icon}
                      description={item.description}
                      disabled={item.disabled}
                      data-testid={item.testId}
                      onClick={() => onAddSelect?.(item.value)}
                    >
                      {item.label}
                    </Menu.Item>
                  ))}
                </Menu.Group>
              ) : onAdd ? (
                <Menu.Item icon="plus" onClick={onAdd}>
                  {addLabel}
                </Menu.Item>
              ) : null}
            </Menu.Popup>
          </Menu.Root>
        ) : (
          <IconButton size="sm" icon="plus" label={addLabel} onClick={onAdd} data-testid={testIds?.add} />
        )
      ) : null}

      <span className="min-w-0 flex-1" aria-hidden />

      {onMaximize ? (
        <IconButton
          size="sm"
          icon="maximize"
          label={maximized ? (labels?.restore ?? 'Restore') : (labels?.maximize ?? 'Maximize')}
          pressed={maximized}
          onClick={onMaximize}
          data-testid={testIds?.maximize}
        />
      ) : null}
      {compact && onClose ? (
        <IconButton size="sm" icon="x" label={labels?.close ?? 'Close dock'} onClick={onClose} data-testid={testIds?.close} />
      ) : null}
    </div>
  );
}
