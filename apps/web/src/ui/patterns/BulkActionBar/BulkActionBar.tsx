// ────────────────────────────────────────────────────────────────
// C-06 BulkActionBar (03 §3 C-06; Rosetta `role="toolbar"` floating bar
// "N selected"; ChatsList).
//
// Floats inside the main card: absolute, bottom 20, centred; 40h, pad
// 0 6 0 12, gap 4, level-1 float (overlay, line, card radius, `shadow-pop`).
// Contents: "N selected" (mono N) · separator · `actions` (ToolbarButtons
// rendering ghost sm Buttons; danger-ghost for delete) · separator ·
// "Select all N" · "Clear Esc". A P-47 Toolbar: one tab stop, arrow keys.
// Escape clears the selection while the bar is shown (not from inside a
// text field or an open overlay). It sits in the page, never over the native
// browser view, so it carries no `data-gai-overlay` (03 §1.3 item 5).
// ────────────────────────────────────────────────────────────────

import { useEffect, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { floatSurface } from '../../lib/popup.js';
import { Button } from '../../primitives/Button/Button.js';
import { Toolbar, ToolbarButton, ToolbarSeparator } from '../../primitives/Toolbar/Toolbar.js';

export interface BulkActionBarProps {
  /** Selected rows. The bar renders nothing at 0. */
  count: number;
  /** All rows matching the current filter (for "Select all N"). */
  total?: number;
  /** ToolbarButtons: `<ToolbarButton render={<Button variant="ghost" size="sm" icon="archive" />}>Archive</ToolbarButton>`. */
  actions: ReactNode;
  onSelectAll?: () => void;
  onClear: () => void;
  className?: string;
  'data-testid'?: string;
}

function inEditableOrOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
    Boolean(target.closest('[data-gai-overlay], [data-gai-keys="own"]'))
  );
}

/** Floating toolbar for actions on the selected rows of a list. */
export function BulkActionBar({ count, total, actions, onSelectAll, onClear, className, 'data-testid': testId }: BulkActionBarProps) {
  useEffect(() => {
    if (count === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || inEditableOrOverlay(event.target)) return;
      if (document.querySelector('[data-gai-overlay="dialog"], [data-gai-overlay="menu"]')) return;
      onClear();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [count, onClear]);

  if (count === 0) return null;
  return (
    <Toolbar
      label="Bulk actions"
      data-testid={testId}
      className={cn(
        floatSurface,
        'absolute bottom-5 left-1/2 z-sticky h-panel-bar -translate-x-1/2 gap-1 rounded-card pr-1.5 pl-3 text-ui',
        className,
      )}
    >
      <span className="mr-1 whitespace-nowrap text-fg" aria-live="polite">
        <span className="font-mono">{count}</span> selected
      </span>
      <ToolbarSeparator />
      {actions}
      {onSelectAll && total !== undefined && total > count ? (
        <>
          <ToolbarSeparator />
          <ToolbarButton render={<Button variant="ghost" size="sm" />} onClick={onSelectAll}>
            Select all <span className="font-mono">{total}</span>
          </ToolbarButton>
        </>
      ) : null}
      <ToolbarButton render={<Button variant="ghost" size="sm" shortcut={['Esc']} />} onClick={onClear}>
        Clear
      </ToolbarButton>
    </Toolbar>
  );
}
