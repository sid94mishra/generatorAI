// ────────────────────────────────────────────────────────────────
// P-26 Tabs (underline) (03 §2 P-26; Base UI Tabs; Rosetta `.tabs`/`.tab`).
//
// List: gap 20 (`density="page"`) or 12 with pad 0 16 (`density="panel"`,
// inspectors/dock panels); bottom 1px `border-line-soft`. Tab 36h (`h-tab`),
// `text-ui` 500 `text-fg-2`, gap 6; the active tab is `text-fg` with a 2px
// **fg** (never accent) underline drawn as a bottom border that overlaps the
// list's own border (`-mb-px`) rather than an inline `var()` box-shadow.
// Optional trailing count (`font-mono text-micro text-fg-3`). Router links
// go through `render` on the item. Never nest a Tabs inside another Tabs.
//
// `children` (usually `TabsPanel`s) render after the list, inside the SAME
// `Tabs.Root` the list uses — a `TabsPanel` rendered outside `<Tabs>` has no
// root context and throws (Base UI). Omit `children` when the caller drives
// visible content itself (switching on `value` instead of panels).
// ────────────────────────────────────────────────────────────────

import type { ReactElement, ReactNode } from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: ReactNode;
  disabled?: boolean;
  /** Renders the tab as a router link. */
  render?: ReactElement;
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly TabItem[];
  density?: 'page' | 'panel';
  /** Accessible name of the tab list. */
  label?: string;
  className?: string;
  /** `TabsPanel`s (or any content) rendered inside the same `Tabs.Root` as the list. */
  children?: ReactNode;
}

/** Underline tabs switching visible content (pair with `TabsPanel`). */
export function Tabs({ value, onValueChange, items, density = 'page', label, className, children }: TabsProps) {
  return (
    <BaseTabs.Root value={value} onValueChange={(next) => onValueChange(next as string)} className={className}>
      <BaseTabs.List
        aria-label={label}
        className={cn('flex border-b border-line-soft', density === 'panel' ? 'gap-3 px-4' : 'gap-5')}
      >
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            render={item.render}
            className={cn(
              'flex h-tab -mb-px items-center gap-1.5 border-b-2 border-transparent text-ui font-medium text-fg-2 transition-control',
              'data-active:border-fg data-active:text-fg',
              'data-disabled:cursor-not-allowed data-disabled:text-fg-3',
              focusRing,
            )}
          >
            {item.label}
            {item.count != null ? <span className="font-mono text-micro text-fg-3">{item.count}</span> : null}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  );
}

/** A tab's content panel; renders only while its tab is active (`keepMounted` to preserve state). */
export const TabsPanel = BaseTabs.Panel;
