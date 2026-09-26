// ────────────────────────────────────────────────────────────────
// T-04 Workspace (03 §5 T-04): the chat/run workspace layout — slots only,
// no domain logic (same discipline as T-01 ListPage).
//
//   header  C-01 PageHeader (+ a dockToggle action the caller composes)
//   main    transcript / timeline; pad 20 28 0, gap 18; centred at a max
//           860px reading width when the dock is closed
//   bottom? composer / stage composer; pad 12 28 10
//   dock?   S-08's content (480 default / 440 on run pages, D-27)
//
// `main` and `dock` are laid out through C-20 SplitPane when a `dock` is
// given, so the dock's own subtree (a terminal, a native browser view) is
// never unmounted by `dockOpen` toggling — SplitPane collapses it to 0
// instead (D-27 "closing the dock collapses it; it does not unmount it").
//
// D-27's other half — below a 1200px window the dock becomes a S-09
// non-modal overlay SHEET instead of this inline split, and the header drops
// its meta chips — is shell-level behaviour that belongs to S-08/S-09 (not
// built in this task: only primitives, patterns and this template were in
// scope). This template does not watch the window itself; instead it takes
// the already-decided `narrow` flag and applies its own half of the
// consequence (main's right padding, so content clears a floating sheet
// rendered elsewhere in the tree). Whoever builds S-08 computes `narrow` and
// swaps `dock`'s content between an inline panel and a Sheet — the same
// stable-React-tree requirement then falls on THAT component, not this one.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { workspaceMainMaxWidth, workspaceNarrowPadding } from '../../lib/popup.js';
import { SplitPane } from '../../patterns/SplitPane/SplitPane.js';

export interface WorkspaceProps extends Omit<ComponentProps<'div'>, 'children'> {
  header: ReactNode;
  main: ReactNode;
  bottom?: ReactNode;
  /** S-08's dock content. Its subtree stays mounted while `dockOpen` toggles. */
  dock?: ReactNode;
  /** Whether the dock pane is open (collapsed to 0 otherwise, not unmounted). Default true when `dock` is given. */
  dockOpen?: boolean;
  /** Dock pane default/min width in px. Default 480 (pass 440 on run pages, D-27). */
  dockDefaultSize?: number;
  dockMinSize?: number;
  /** Set by the caller below the 1200px window (D-27); adds main's right padding for the overlay sheet. */
  narrow?: boolean;
  /** Persists the main/dock split ratio; unique per page. */
  splitId?: string;
}

/** Page layout for the chat/run workspace: transcript + composer, optional resizable dock. */
export function Workspace({
  header,
  main,
  bottom,
  dock,
  dockOpen = true,
  dockDefaultSize = 480,
  dockMinSize = 360,
  narrow = false,
  splitId = 'workspace-dock',
  className,
  ...rest
}: WorkspaceProps) {
  const dockClosed = !dock || !dockOpen;

  const mainColumn = (
    <div className={cn('flex min-h-0 flex-1 flex-col', narrow && !dockClosed && workspaceNarrowPadding)}>
      <div
        // The transcript scrolls independently of the page; tabIndex keeps a keyboard user able
        // to reach it directly (axe scrollable-region-focusable — real content overflows here,
        // e.g. narrow mode's extra right padding wraps the transcript onto more lines).
        tabIndex={0}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-4.5 overflow-y-auto px-7 pt-5 -outline-offset-2',
          focusRing,
          dockClosed && cn('mx-auto w-full', workspaceMainMaxWidth),
        )}
      >
        {main}
      </div>
      {bottom != null ? <div className="shrink-0 px-7 pt-3 pb-2.5">{bottom}</div> : null}
    </div>
  );

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-surface text-fg', className)} {...rest}>
      {header}
      {dock != null ? (
        <SplitPane
          id={splitId}
          defaultSize={dockDefaultSize}
          minSize={dockMinSize}
          maxSize="60%"
          collapsed={!dockOpen}
          className="min-h-0 flex-1"
        >
          {[mainColumn, dock]}
        </SplitPane>
      ) : (
        <div className="flex min-h-0 flex-1">{mainColumn}</div>
      )}
    </div>
  );
}
