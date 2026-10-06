// ────────────────────────────────────────────────────────────────
// S-08 DockFrame (03 §4 S-08; D-19, D-27, D-38; 06 §2.5, §4.3).
//
// The right dock of the chat / run workspace, inside the main card:
//   aside · C-19 tab strip (`strip`) · optional `notice` · the panels.
// Panels (`DockPanel`) stay mounted when inactive: `absolute inset-0`,
// `visibility:hidden` + `aria-hidden`, never `display:none`
// (`NativeBrowserView.isContainerHidden()` relies on it).
//
// ONE stable React tree across the 1200px breakpoint (06 §4.3 item 3):
// the dock body is rendered exactly once, as an absolutely positioned child
// of this frame's host, inside S-09 `NarrowDockSheet` (always the same
// element). Only styling changes between the modes the caller decides:
//   panel  ≥ 1200: a C-20 SplitPane lays out `main` + an EMPTY spacer panel;
//          the body tracks the spacer's width (ResizeObserver, written straight
//          to the element's style — no React render per drag frame). The
//          separator is keyboard-resizable and persisted per page.
//   sheet  < 1200: the spacer collapses; the body is the 380px non-modal
//          sheet; `main` keeps a 404px gutter (380 + 24) so nothing hides.
//   full   viewport < 768 (or a host too narrow for two columns): the sheet
//          takes the whole host width; no Maximize.
// `maximized`: the body covers the whole host, the main column is hidden and
// inert (06 §4.3 item 4 — still inside the main card).
// Closed: the spacer collapses to 0 and the body is `visibility:hidden` +
// `inert` — collapsed, never unmounted (06 §4.3 item 2).
//
// Escape (`onEscape`) fires only in the sheet / full / maximized modes, and not
// when the key belongs to something else: a layer of its own (a menu, a
// dialog), a surface that owns every key (`data-gai-keys="own"`, the
// terminal), or a handler that already took it.
// ────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { workspaceNarrowPadding } from '../../lib/popup.js';
import { SplitPane } from '../../patterns/SplitPane/SplitPane.js';
import { NarrowDockSheet } from '../NarrowDockSheet/NarrowDockSheet.js';

export type DockMode = 'panel' | 'sheet' | 'full';

export interface DockFrameProps {
  /** The page's main column (transcript + composer). */
  main: ReactNode;
  /** The dock's C-19 DockTabStrip. */
  strip: ReactNode;
  /** A strip-width message under the tab strip (e.g. an instance-cap notice). */
  notice?: ReactNode;
  /** The panels (`DockPanel`s), all mounted. */
  children: ReactNode;
  open: boolean;
  mode: DockMode;
  maximized?: boolean;
  /** Split id (unique per page) and the localStorage key of its persisted layout. */
  splitId: string;
  layoutStorageKey?: string;
  /** Dock width in px: 480 default (440 on runs), min 360, max 60 % (D-27, 06 §2.5). */
  defaultSize?: number;
  minSize?: number;
  maxSize?: number | string;
  /** The user dragged the separator past the minimum: the dock collapsed. */
  onUserCollapse?: () => void;
  /** Escape in the sheet / full / maximized modes (see the header). */
  onEscape?: () => void;
  /** Width of the frame's host (the page row), for callers that pick `mode` from it. */
  onHostResize?: (width: number) => void;
  /** Accessible names: the dock `aside`, the sheet dialog, the separator. */
  labels?: { dock?: string; sheet?: string; separator?: string };
  /** `data-testid`s of the dock `aside` and of the sheet (sheet modes only). */
  testIds?: { dock?: string; sheet?: string };
  className?: string;
}

/** Nodes on an event's path that make an Escape somebody else's. */
function escapeBelongsElsewhere(event: KeyboardEvent, surface: Element | null): boolean {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element) || node === surface) continue;
    if (node.getAttribute('data-gai-keys') === 'own') return true;
    if (node.hasAttribute('data-gai-overlay')) return true;
    const role = node.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog') return true;
  }
  return false;
}

/** The chat / run dock: a resizable panel at ≥ 1200px, a non-modal sheet below, one stable tree. */
export function DockFrame({
  main,
  strip,
  notice,
  children,
  open,
  mode,
  maximized = false,
  splitId,
  layoutStorageKey,
  defaultSize = 480,
  minSize = 360,
  maxSize = '60%',
  onUserCollapse,
  onEscape,
  onHostResize,
  labels,
  testIds,
  className,
}: DockFrameProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const sheet = mode !== 'panel';
  const tracksSpacer = mode === 'panel' && !maximized;

  // Panel mode: the body's width follows the spacer panel (drag, keyboard, window resize).
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const spacer = spacerRef.current;
    if (!surface) return undefined;
    if (!tracksSpacer || !spacer) {
      surface.style.removeProperty('width');
      return undefined;
    }
    const sync = () => {
      surface.style.width = `${spacer.getBoundingClientRect().width}px`;
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(sync);
    ro.observe(spacer);
    return () => ro.disconnect();
  }, [tracksSpacer]);

  // The host's width, for the caller's "two columns no longer fit" rule.
  const onHostResizeRef = useRef(onHostResize);
  onHostResizeRef.current = onHostResize;
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const report = () => onHostResizeRef.current?.(host.clientWidth);
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const escapable = open && (sheet || maximized);
  useEffect(() => {
    if (!escapable) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (escapeBelongsElsewhere(event, surfaceRef.current)) return;
      onEscapeRef.current?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [escapable]);

  return (
    <div ref={hostRef} className={cn('relative flex min-h-0 min-w-0 flex-1', className)}>
      {/* Before the split in DOM order, so the separator's hit area paints above the body's edge. */}
      <NarrowDockSheet
        ref={surfaceRef}
        active={sheet && !maximized}
        fullWidth={mode === 'full'}
        open={open}
        {...(labels?.sheet ? { label: labels.sheet } : {})}
        {...(sheet && testIds?.sheet ? { 'data-testid': testIds.sheet } : {})}
        className={cn(
          'flex min-h-0 flex-col',
          maximized
            ? 'absolute inset-0 z-dock bg-surface text-fg'
            : !sheet && 'absolute inset-y-0 right-0 overflow-hidden border-l border-line-soft bg-surface text-fg',
        )}
      >
        <aside
          aria-label={labels?.dock ?? 'Side pane'}
          data-testid={testIds?.dock}
          data-state={open ? 'open' : 'closed'}
          data-mode={mode}
          data-maximized={maximized || undefined}
          // The legacy RightPane attributes, kept for specs/smokes (09 §7.2).
          data-fullscreen={maximized || mode === 'full' || undefined}
          data-narrow={mode === 'full' || undefined}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {strip}
          {notice}
          <div className="relative min-h-0 flex-1">{children}</div>
        </aside>
      </NarrowDockSheet>
      <SplitPane
        id={splitId}
        {...(layoutStorageKey ? { storageKey: layoutStorageKey } : {})}
        defaultSize={defaultSize}
        minSize={minSize}
        maxSize={maxSize}
        collapsed={!open || sheet}
        onCollapsedChange={(collapsed) => {
          if (collapsed) onUserCollapse?.();
        }}
        resizable={open && !sheet && !maximized}
        {...(labels?.separator ? { separatorLabel: labels.separator } : {})}
        mainFocusable={false}
        sideFocusable={false}
      >
        {[
          <div
            key="main"
            inert={maximized}
            className={cn(
              // The sheet's gutter eases in with the sheet's slide (D-108).
              'flex min-h-0 min-w-0 flex-1 flex-col motion-size',
              maximized && 'invisible',
              mode === 'sheet' && open && !maximized && workspaceNarrowPadding,
            )}
          >
            {main}
          </div>,
          <div key="spacer" ref={spacerRef} aria-hidden className="min-h-0 flex-1" />,
        ]}
      </SplitPane>
    </div>
  );
}

export interface DockPanelProps extends ComponentProps<'div'> {
  active: boolean;
  /** The panel's accessible name (its tab's label). */
  label?: string;
}

/**
 * One tab's body: always mounted, `absolute inset-0`; inactive = `visibility:hidden`
 * + `aria-hidden` + no pointer events (never `display:none`). The tab switched to
 * fades in (D-108, `duration-fast`); the one left hides at once, so two never overlap.
 */
export function DockPanel({ active, label, className, children, ...rest }: DockPanelProps) {
  return (
    <div
      role="tabpanel"
      aria-label={label}
      aria-hidden={!active}
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col overflow-hidden',
        active ? 'transition-opacity duration-fast ease-in-out' : 'pointer-events-none invisible opacity-0',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
