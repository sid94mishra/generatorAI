// ────────────────────────────────────────────────────────────────
// S-12 FindBarFrame (03-kit S-12; D-32 restyle): the desktop Cmd/Ctrl+F find
// bar — a C-32 FindWidget anchored top-right of the main card, below its 44px
// header row, 8px from the edge. Visuals only: the find session (Chromium's
// `findInPage` over IPC) lives in app/shell/FindBar.
//
// The caller renders it inside the MainCard (its `relative` box is the
// containing block). It floats over page content, so it sits on the popover
// layer; FindWidget already carries `data-gai-overlay` (D-19).
// ────────────────────────────────────────────────────────────────

import { cn } from '../../lib/cn.js';
import { FindWidget, type FindWidgetProps } from '../../patterns/FindWidget/FindWidget.js';

export type FindBarFrameProps = FindWidgetProps;

/** The app-level find bar, pinned under the page header at the card's right edge. */
export function FindBarFrame({ className, label = 'Find in page', placeholder = 'Find in page', ...rest }: FindBarFrameProps) {
  return (
    <FindWidget
      data-testid="find-bar"
      label={label}
      placeholder={placeholder}
      className={cn('absolute top-13 right-2 z-popover', className)}
      {...rest}
    />
  );
}
