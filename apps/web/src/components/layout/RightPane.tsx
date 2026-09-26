// ────────────────────────────────────────────────────────────────
// RightPane — unified right-side dock with add/close tabs and drag-resize.
//
// One shell that hosts multiple side-panels as tabs. A single "default"
// tab (typically Changes) is required and cannot be removed; the user
// can add other allowed tab kinds via a "+" popover and close them
// individually.
//
// State (per-page open/tab-list/active/width) is persisted to
// localStorage under `storageKey`. This lets the layout survive page
// navigation and app restarts.
//
// Used by:
//   • ChatPage           — Changes (default) + Browser
//   • WorkflowRunPage  — Changes (default) + Inspector + Browser
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Maximize2, Minimize2, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useResizablePane } from '@/hooks/useResizablePane.js';
import { useIsNarrowViewport } from '@/hooks/useMediaQuery.js';
import { Button } from '@/components/ui/index.js';

/**
 * Invisible pointer-target expansion for the pane's 22x22 header icons.
 *
 * They are deliberately drawn small so the tab strip stays dense; WCAG 2.5.8
 * asks for 24x24 of TARGET, which is not the same thing as 24x24 of ink. A
 * pseudo-element takes the hit area past the floor while the header looks
 * exactly as it did.
 */
const HIT_AREA = 'relative before:absolute before:-inset-1 before:content-[""]';

/**
 * What the pane tells a panel about the tab instance it is rendering.
 *
 * `id` is the stable per-tab id assigned by the RightPane (e.g.
 * `terminal-1`, `browser-1`). Panels that need to persist per-tab state (like
 * TerminalPanel's server-side session id) key off it. `index` is the 1-based
 * ordinal among tabs of the same type.
 *
 * `active` is false for every tab except the selected one. EVERY tab is
 * mounted (see the body below — that is what keeps a terminal's scrollback
 * and a browser's page alive across tab switches), so a panel that holds an
 * open socket or decodes frames MUST gate that work on this flag. P1-50:
 * without it, five browser tabs each ran a live screencast socket and decoded
 * every frame while four of them were invisible.
 */
export interface RightPanePanelProps {
  id: string;
  type: string;
  index: number;
  active: boolean;
}

/**
 * How a tab kind renders its body. Two forms:
 *
 *  • `Component` — PREFERRED. A real component type (wrap it in `React.memo`),
 *    rendered as JSX with exactly the `RightPanePanelProps` above. Because it
 *    is a component, React has a fiber boundary to bail out on: while the
 *    parent page re-renders — every streamed token, say — a panel whose props
 *    have not changed does no work. Anything else the panel needs (workspace
 *    id, callbacks) comes from a context or a store the panel reads itself,
 *    never from a closure, which is what would defeat the memo.
 *
 *  • `render` — legacy. A closure called with the same props. It still gets a
 *    component boundary (the pane wraps the call), but since the closure is
 *    usually recreated by the parent's render, the memo cannot hold and the
 *    body re-runs whenever the parent does. Review 6.4 / plan item 18: this
 *    used to be a bare function call inlined into JSX, so EVERY mounted panel
 *    (the 2,000-line browser view, the changes tree, each terminal — visible
 *    or not) rebuilt on every stream frame for the whole turn.
 */
type RightPaneTabBody =
  | { Component: React.ComponentType<RightPanePanelProps>; render?: never }
  | { render: (ctx: RightPanePanelProps) => React.ReactNode; Component?: never };

/**
 * Descriptor for a single tab kind (e.g. `changes`, `browser`, `inspector`).
 * Parents provide the body; the pane owns the chrome.
 */
export type RightPaneTabDef = RightPaneTabBody & {
  /** Human-readable label shown in the tab strip and the "+" menu. */
  label: string;
  /** Short tooltip / long label shown in the "+" menu. */
  description?: string;
  /** Lucide icon element. */
  icon: React.ReactNode;
  /** When true, the tab may appear multiple times. Default: singleton. */
  allowMultiple?: boolean;
  /** Cap on concurrent instances of this tab kind (only meaningful with
   *  `allowMultiple`). When reached, the "+" menu entry is hidden. */
  maxInstances?: number;
  /** Per-instance label override (e.g. live page title per browser tab).
   *  Falls back to `label` when omitted. */
  getTabLabel?: (ctx: { id: string; index: number }) => string;
  /** Per-instance icon override (e.g. per browser tab favicon/spinner).
   *  Falls back to `icon` when omitted. */
  getTabIcon?: (ctx: { id: string; index: number }) => React.ReactNode;
  /** When true, the tab is disabled in the "+" menu (e.g. missing data). */
  disabled?: boolean;
  /** Tooltip shown in the "+" menu when `disabled` is true. */
  disabledReason?: string;
};

interface RightPanePanelHostProps extends RightPanePanelProps {
  def: RightPaneTabDef;
}

/**
 * One mounted tab body. `React.memo` so an inactive panel whose `def` and
 * ctx are unchanged is skipped entirely when the pane re-renders; `def`
 * compares by identity, which is why pages memoise their tab definitions.
 */
const RightPanePanel = React.memo(function RightPanePanel({
  def,
  id,
  type,
  index,
  active,
}: RightPanePanelHostProps) {
  const Body = def.Component;
  return (
    <div
      role="tabpanel"
      aria-hidden={!active}
      data-testid={`right-pane-panel-${type}`}
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col overflow-hidden',
        !active && 'pointer-events-none invisible',
      )}
    >
      {Body ? (
        <Body id={id} type={type} index={index} active={active} />
      ) : (
        def.render?.({ id, type, index, active })
      )}
    </div>
  );
});

interface StoredState {
  tabs: Array<{ id: string; type: string }>;
  active: string;
  width?: number;
}

interface RightPaneProps {
  /** Controlled open state — parent renders the toggle button. */
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Persistence key (unique per page: e.g. `chat`, `workflow-run`). */
  storageKey: string;
  /**
   * Persistence key for the dragged pane width. Defaults to
   * `<storageKey>:width`. Pass a page-level key when `storageKey` is scoped
   * per entity (chat / run) so the user's preferred width stays a single
   * global preference instead of resetting in every conversation.
   */
  widthStorageKey?: string;
  /** Tab kind definitions. Keys used in stored state; values render tabs. */
  tabs: Record<string, RightPaneTabDef>;
  /** Type of the always-present default tab (typically `'changes'`). */
  defaultTabType: string;
  /** Ordered types the user may add via the "+" popover. */
  addableTabTypes: string[];
  /**
   * Imperative request to focus a tab kind. Changing this value adds
   * the tab (if not already present) AND makes it the active tab. Use
   * a monotonically-increasing token (e.g. `Date.now()`) so effect deps
   * re-fire correctly. Set to `null` for no-op.
   *
   * Combined with `onOpenChange(true)` from the parent, this lets things
   * like a `browser.session_created` SSE event pop the Browser tab open
   * automatically when `visibility === 'visible'`.
   *
   * `tabId` addresses one SPECIFIC instance instead of "any tab of this
   * kind". Multi-instance tabs whose identity comes from their content —
   * an open file, say — pass a deterministic id derived from that content,
   * which makes re-opening the same thing focus the existing tab and makes
   * the mapping survive a reload for free.
   */
  focusTabRequest?: { type: string; token: number; tabId?: string } | null;
  /**
   * Fired when a tab instance is permanently closed by the user (NOT when
   * the pane unmounts or the scope changes). Lets owners clean up any
   * per-tab state they persisted alongside the tab — e.g. the browser's
   * remembered URL for that tab.
   */
  onTabClose?: (tab: { id: string; type: string }) => void;
  /** Optional class for the outer aside. */
  className?: string;
}

/** Sanitize / migrate a possibly stale stored state to a valid shape. */
function reconcileState(
  raw: StoredState | null,
  tabs: Record<string, RightPaneTabDef>,
  defaultTabType: string,
): StoredState {
  const defaultId = `${defaultTabType}-1`;
  const fallback: StoredState = {
    tabs: [{ id: defaultId, type: defaultTabType }],
    active: defaultId,
  };
  if (!raw || !Array.isArray(raw.tabs)) return fallback;

  // Drop any tabs whose kind is no longer defined.
  const filtered = raw.tabs.filter((t) => t && typeof t.id === 'string' && typeof t.type === 'string' && tabs[t.type]);
  // Ensure the required default tab is present as the first entry.
  const hasDefault = filtered.some((t) => t.type === defaultTabType);
  const cleaned = hasDefault
    ? filtered
    : [{ id: defaultId, type: defaultTabType }, ...filtered];

  const active =
    typeof raw.active === 'string' && cleaned.some((t) => t.id === raw.active)
      ? raw.active
      : cleaned[0]?.id ?? defaultId;

  return {
    tabs: cleaned.length > 0 ? cleaned : fallback.tabs,
    active,
    width: typeof raw.width === 'number' && Number.isFinite(raw.width) ? raw.width : undefined,
  };
}

function readState(storageKey: string, tabs: Record<string, RightPaneTabDef>, defaultTabType: string): StoredState {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return reconcileState(null, tabs, defaultTabType);
    return reconcileState(JSON.parse(raw) as StoredState, tabs, defaultTabType);
  } catch {
    return reconcileState(null, tabs, defaultTabType);
  }
}

/**
 * Mint a globally-unique tab id. Tab state is scoped per chat / run, but the
 * id itself addresses process-wide resources (the native `WebContentsView`
 * map and its `persist:browser-<tabId>` partition), so ids must not collide
 * across scopes — a timestamp alone can repeat within the same millisecond.
 */
function mintTabId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RightPane({
  open,
  onOpenChange,
  storageKey,
  widthStorageKey,
  tabs,
  defaultTabType,
  addableTabTypes,
  focusTabRequest,
  onTabClose,
  className,
}: RightPaneProps): React.JSX.Element | null {
  // Tab state is scoped to `storageKey` (which includes the chat / run id, so
  // each conversation owns its own set of tabs). The key is held *alongside*
  // the data so a scope switch swaps both atomically — otherwise the persist
  // effect below would write the previous chat's tabs into the new chat's
  // slot in the window between the key changing and the re-read landing.
  const [scoped, setScoped] = useState<{ key: string; data: StoredState }>(() => ({
    key: storageKey,
    data: readState(storageKey, tabs, defaultTabType),
  }));
  // Adjusting state during render is React's recommended pattern for deriving
  // from props; it re-renders immediately so the first painted frame of the
  // new scope already shows that scope's tabs (no flash of the old ones).
  if (scoped.key !== storageKey) {
    setScoped({ key: storageKey, data: readState(storageKey, tabs, defaultTabType) });
  }
  const state = scoped.data;
  const setState = useCallback(
    (updater: StoredState | ((prev: StoredState) => StoredState)) => {
      setScoped((prev) => ({
        key: prev.key,
        data: typeof updater === 'function'
          ? (updater as (p: StoredState) => StoredState)(prev.data)
          : updater,
      }));
    },
    [],
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Below the `md` breakpoint a 320 px+ side column would take 85 % of a
  // phone's width and leave the transcript a sliver; the pane then behaves as
  // a full-width sheet over the content instead, the same treatment the
  // sidebar already gets in AppLayout. The user's own fullscreen toggle is
  // meaningless there, so it is hidden and the resize handle with it.
  const narrowViewport = useIsNarrowViewport();
  const [hostNode, setHostNode] = useState<HTMLElement | null>(null);
  const [hostWidth, setHostWidth] = useState(0);
  useEffect(() => {
    if (!hostNode) return;
    const measure = () => setHostWidth(hostNode.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(hostNode);
    return () => observer.disconnect();
  }, [hostNode]);
  // A desktop sidebar can leave less room than the viewport breakpoint
  // suggests. Use a sheet when two readable columns no longer fit.
  const isNarrow = narrowViewport || (hostWidth > 0 && hostWidth < 760);
  const effectiveFullscreen = fullscreen || isNarrow;
  // N7 — a cap that refuses in silence reads as a bug. Both cap paths (the
  // "+" menu and an imperative focus request) route through `capNotice`, so
  // the user is told why no new tab appeared instead of clicking again.
  const [capNotice, setCapNotice] = useState<string | null>(null);
  const capNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceCap = useCallback((def: RightPaneTabDef, max: number) => {
    setCapNotice(
      `${max} ${def.label} tab${max === 1 ? '' : 's'} is the limit — close one to open another.`,
    );
    if (capNoticeTimer.current) clearTimeout(capNoticeTimer.current);
    capNoticeTimer.current = setTimeout(() => setCapNotice(null), 6000);
  }, []);
  useEffect(() => () => {
    if (capNoticeTimer.current) clearTimeout(capNoticeTimer.current);
  }, []);
  const addMenuRef = useRef<HTMLDivElement>(null);
  // ── Tab-strip overflow ──
  // When the pane is narrow the tab strip can't fit every tab. Rather than
  // exposing a horizontal scrollbar we show as many tabs as fit and collapse
  // the rest behind a "…" menu (the VS Code / Chrome pattern).
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [overflowIds, setOverflowIds] = useState<string[]>([]);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const onTabCloseRef = useRef(onTabClose);
  useEffect(() => { onTabCloseRef.current = onTabClose; }, [onTabClose]);

  // Persist state on every change (open state is stored separately per page
  // to avoid overwrites when the parent controls open via its own storage).
  useEffect(() => {
    // Skip while a scope switch is mid-flight — the render-phase adjustment
    // above will re-run this effect with the reconciled data.
    if (scoped.key !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(scoped.data));
    } catch {
      /* ignore quota errors */
    }
  }, [storageKey, scoped]);

  // Close the "+" popover on outside click / escape.
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!addMenuRef.current) return;
      if (!addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [addMenuOpen]);

  // Close the "…" overflow popover on outside click / escape.
  useEffect(() => {
    if (!overflowMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!overflowMenuRef.current) return;
      if (!overflowMenuRef.current.contains(e.target as Node)) setOverflowMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverflowMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [overflowMenuOpen]);

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.active) ?? state.tabs[0],
    [state.tabs, state.active],
  );

  const addTab = useCallback((type: string) => {
    const def = tabs[type];
    if (!def) return;
    // The cap is evaluated OUTSIDE the state updater: announcing the refusal
    // is a state write of its own, and React may run an updater twice.
    const atCap =
      def.allowMultiple &&
      def.maxInstances !== undefined &&
      state.tabs.filter((t) => t.type === type).length >= def.maxInstances;
    if (atCap) announceCap(def, def.maxInstances!);

    setState((prev) => {
      const existing = prev.tabs.find((t) => t.type === type);
      if (existing && !def.allowMultiple) {
        return { ...prev, active: existing.id };
      }
      // At the cap, focus the oldest instance — same behaviour as the
      // explicit-id path below, never a silent no-op.
      if (atCap) {
        const oldest = prev.tabs.find((t) => t.type === type);
        return oldest ? { ...prev, active: oldest.id } : prev;
      }
      const id = mintTabId(type);
      return {
        ...prev,
        tabs: [...prev.tabs, { id, type }],
        active: id,
      };
    });
    setAddMenuOpen(false);
  }, [tabs, state.tabs, setState, announceCap]);

  const closeTab = useCallback((id: string) => {
    const closing = state.tabs.find((t) => t.id === id);
    // Never allow closing the default (first-of-kind) tab.
    if (!closing || closing.type === defaultTabType) return;
    setState((prev) => {
      const idx = prev.tabs.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const nextTabs = prev.tabs.filter((t) => t.id !== id);
      const nextActive =
        prev.active === id
          ? (prev.tabs[idx - 1]?.id ?? nextTabs[0]?.id ?? prev.active)
          : prev.active;
      return { ...prev, tabs: nextTabs, active: nextActive };
    });
    // Notify AFTER scheduling the state update so owners can drop any per-tab
    // state they persisted (e.g. the browser tab's remembered URL).
    onTabCloseRef.current?.(closing);
  }, [defaultTabType, setState, state.tabs]);

  const selectTab = useCallback((id: string) => {
    setState((prev) => ({ ...prev, active: id }));
  }, []);

  // React to imperative focus-tab requests. Each unique `token` fires
  // exactly one add/focus cycle. The token pattern keeps the effect
  // idempotent even when the parent recomputes the request object.
  const lastFocusTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusTabRequest) return;
    if (lastFocusTokenRef.current === focusTabRequest.token) return;
    lastFocusTokenRef.current = focusTabRequest.token;
    const type = focusTabRequest.type;
    const def = tabs[type];
    if (!def) return;
    // Same reason as `addTab`: the refusal notice is its own state write, so
    // it is decided before the updater runs.
    const atCap =
      def.maxInstances !== undefined &&
      focusTabRequest.tabId !== undefined &&
      !state.tabs.some((t) => t.id === focusTabRequest.tabId) &&
      state.tabs.filter((t) => t.type === type).length >= def.maxInstances;
    if (atCap) announceCap(def, def.maxInstances!);
    setState((prev) => {
      // An explicit id addresses ONE instance: re-opening the same file must
      // focus the tab already showing it rather than reusing whichever file
      // tab happens to be first, or spawning a duplicate.
      const requestedId = focusTabRequest.tabId;
      if (requestedId) {
        const existing = prev.tabs.find((t) => t.id === requestedId);
        if (existing) return { ...prev, active: requestedId };
        if (def.maxInstances) {
          const count = prev.tabs.filter((t) => t.type === type).length;
          // At the cap, focus the oldest instance instead of silently doing
          // nothing — a click that appears to do nothing reads as a bug.
          if (count >= def.maxInstances) {
            const oldest = prev.tabs.find((t) => t.type === type);
            return oldest ? { ...prev, active: oldest.id } : prev;
          }
        }
        return {
          ...prev,
          tabs: [...prev.tabs, { id: requestedId, type }],
          active: requestedId,
        };
      }
      const existing = prev.tabs.find((t) => t.type === type);
      // Auto-focus reuses an existing tab of this kind (whether or not it is
      // multi-instance) so repeated focus requests — e.g. a `session_created`
      // SSE that fires on every reconnect — never spawn duplicate tabs.
      if (existing) {
        return { ...prev, active: existing.id };
      }
      const id = mintTabId(type);
      return {
        ...prev,
        tabs: [...prev.tabs, { id, type }],
        active: id,
      };
    });
    // `state.tabs` participates only in the cap check; `lastFocusTokenRef`
    // still guarantees one add/focus cycle per token even though tab-list
    // changes now re-run this effect.
  }, [focusTabRequest, tabs, state.tabs, setState, announceCap]);

  // Types available in the "+" menu (only those not already open, unless
  // the tab kind opts in to `allowMultiple` and is below its instance cap).
  const availableAdds = useMemo(() => {
    return addableTabTypes
      .map((type) => ({ type, def: tabs[type] }))
      .filter((t): t is { type: string; def: RightPaneTabDef } => !!t.def)
      .filter(({ type, def }) => {
        const count = state.tabs.filter((t) => t.type === type).length;
        if (def.allowMultiple) return !def.maxInstances || count < def.maxInstances;
        return count === 0;
      });
  }, [addableTabTypes, tabs, state.tabs]);

  // 1-based ordinal of each tab among its own kind (for `Browser 2`, etc).
  const tabIndexById = useMemo(() => {
    const counts: Record<string, number> = {};
    const map = new Map<string, number>();
    for (const t of state.tabs) {
      counts[t.type] = (counts[t.type] ?? 0) + 1;
      map.set(t.id, counts[t.type]!);
    }
    return map;
  }, [state.tabs]);

  // ── Overflow measurement ──
  // A tab counts as overflowing when it is scrolled out of the strip's
  // visible box on either side. Measured from layout (not a hardcoded width)
  // so it stays correct for any label length, zoom level or pane width.
  const measureOverflow = useCallback(() => {
    const list = tabListRef.current;
    if (!list) return;
    const scrollLeft = list.scrollLeft;
    const right = scrollLeft + list.clientWidth;
    const TOL = 2; // sub-pixel layout tolerance
    const hidden: string[] = [];
    for (const t of state.tabs) {
      const el = tabElsRef.current.get(t.id);
      if (!el) continue;
      const start = el.offsetLeft;
      const end = start + el.offsetWidth;
      if (start < scrollLeft - TOL || end > right + TOL) hidden.push(t.id);
    }
    setOverflowIds((prev) =>
      prev.length === hidden.length && prev.every((id, i) => id === hidden[i]) ? prev : hidden,
    );
  }, [state.tabs]);

  // Re-measure whenever the tab set changes, the strip is resized (pane drag,
  // window resize, fullscreen toggle) or the strip is scrolled.
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    measureOverflow();
    const ro = new ResizeObserver(() => measureOverflow());
    ro.observe(list);
    for (const el of tabElsRef.current.values()) ro.observe(el);
    list.addEventListener('scroll', measureOverflow, { passive: true });
    window.addEventListener('resize', measureOverflow);
    return () => {
      ro.disconnect();
      list.removeEventListener('scroll', measureOverflow);
      window.removeEventListener('resize', measureOverflow);
    };
  }, [measureOverflow, effectiveFullscreen]);

  // Keep the active tab visible — selecting from the "…" menu (or an
  // imperative focus request) scrolls it into view.
  useEffect(() => {
    const el = tabElsRef.current.get(state.active);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [state.active]);

  /** Select a tab from the overflow menu and reveal it in the strip. */
  const selectTabFromOverflow = useCallback((id: string) => {
    selectTab(id);
    setOverflowMenuOpen(false);
    // Scroll after the click so the strip has settled; the active-tab effect
    // above also fires, this just makes the reveal immediate.
    requestAnimationFrame(() => {
      tabElsRef.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }, [selectTab]);

  // Resizable width (drag handle on the left edge of the pane).
  const resize = useResizablePane({
    storageKey: widthStorageKey ?? `${storageKey}:width`,
    defaultRatio: 0.4,
    minPx: 320,
    maxRatio: 0.75,
    minRemainingPx: 420,
  });

  // The pane sits as the last child of a horizontal flex container. Bind
  // `resize.hostRef` to that container (our parent) so max-width bounds
  // are computed against the visible layout — not the pane itself.
  const paneRef = useRef<HTMLElement | null>(null);
  const setPaneRef = useCallback((el: HTMLElement | null) => {
    paneRef.current = el;
    setHostNode(el?.parentElement ?? null);
    resize.hostRef(el?.parentElement ?? null);
  }, [resize.hostRef]);

  // Exit fullscreen whenever the pane is closed so it re-opens at normal
  // width next time.
  useEffect(() => {
    if (!open && fullscreen) setFullscreen(false);
  }, [open, fullscreen]);

  // Escape for quick keyboard dismissal: leaves fullscreen on desktop; on a
  // narrow viewport the sheet IS the pane, so Escape closes it.
  useEffect(() => {
    if (!effectiveFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // The topmost review popover/dialog owns Escape. Its portal is outside
      // the pane, and dismissal may detach it before this listener runs, so
      // inspect the original event path rather than the current DOM tree.
      if (e.composedPath().some((node) => node instanceof Element
        && ['dialog', 'alertdialog'].includes(node.getAttribute('role') ?? ''))) return;
      if (isNarrow) onOpenChange(false);
      else setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [effectiveFullscreen, isNarrow, onOpenChange]);

  if (!open) return null;

  return (
    <>
      {/* Drag handle — 6px wide vertical strip on the boundary. Hidden in
          fullscreen (the pane covers the whole area) and on narrow viewports
          (there is no side column to resize). */}
      {!effectiveFullscreen && (
        <div
          {...resize.handleProps}
          aria-label="Resize right pane"
          title="Drag or use arrow keys to resize · double-click to reset"
          className={cn(
            'group relative flex shrink-0 cursor-col-resize items-center justify-center',
            'w-1.5 border-l border-r border-[var(--color-border)] bg-[var(--color-border)]/40',
            'transition-colors hover:bg-[var(--color-primary)]/40',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
            resize.dragging && 'bg-[var(--color-primary)]/60',
          )}
        >
          <span className="pointer-events-none absolute h-8 w-0.5 rounded-full bg-[var(--color-muted-foreground)]/40 group-hover:bg-[var(--color-primary)]" />
        </div>
      )}

      {/* Pane host — width bound by useResizablePane, or full overlay when
          fullscreen (covers both the middle content and the pane area). */}
      <aside
        ref={setPaneRef}
        aria-label="Right side pane"
        data-testid="right-pane"
        data-fullscreen={effectiveFullscreen || undefined}
        data-narrow={isNarrow || undefined}
        className={cn(
          'flex min-h-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-card)]/40',
          effectiveFullscreen
            ? 'absolute inset-0 z-30 w-full border-l-0 bg-[var(--color-card)]'
            : 'shrink-0',
          className,
        )}
        style={effectiveFullscreen ? undefined : { width: `${resize.width}px` }}
      >
        {/* Tab strip */}
        <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-[var(--color-border)] bg-[var(--color-card)] px-1.5">
          <div className="relative flex min-w-0 flex-1 items-center">
          <div
            ref={tabListRef}
            role="tablist"
            aria-label="Right pane tabs"
            className={cn(
              'gai-no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto',
              overflowIds.length > 0 && 'gai-edge-fade',
            )}
          >
            {state.tabs.map((t) => {
              const def = tabs[t.type];
              if (!def) return null;
              const isActive = t.id === state.active;
              const isDefault = t.type === defaultTabType;
              const index = tabIndexById.get(t.id) ?? 1;
              const label = def.getTabLabel ? def.getTabLabel({ id: t.id, index }) : def.label;
              const icon = def.getTabIcon ? def.getTabIcon({ id: t.id, index }) : def.icon;
              return (
                <div
                  key={t.id}
                  ref={(el) => {
                    if (el) tabElsRef.current.set(t.id, el);
                    else tabElsRef.current.delete(t.id);
                  }}
                  className={cn(
                    'group relative flex min-w-0 shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors',
                    isActive
                      ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-foreground)]'
                      : 'border-transparent text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
                  )}
                >
                  <Button variant="unstyled"
                    role="tab"
                    aria-selected={isActive}
                    data-testid={`right-pane-tab-${t.type}`}
                    onClick={() => selectTab(t.id)}
                    // The pill is the tab, so the pill is the target. The
                    // button used to be only as big as its text — 17px tall —
                    // and a click on the padding around it selected nothing.
                    className="flex min-w-0 items-center gap-1.5 after:absolute after:inset-0 after:content-['']"
                    title={label}
                  >
                    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>
                    {/* `min-w-0` on both the flex parent and this cell: without
                        it the label's intrinsic width wins over `max-w`, so a
                        long filename stretches the tab instead of ellipsing. */}
                    <span className="min-w-0 max-w-[120px] truncate">{label}</span>
                  </Button>
                  {!isDefault && (
                    <Button variant="unstyled"
                      type="button"
                      aria-label={`Close ${label} tab`}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.id);
                      }}
                      className={cn(
                        // Above the tab's stretched target, with a hit area of its own.
                        'z-10 ml-0.5 rounded p-0.5 text-[var(--color-muted-foreground)] opacity-60 hover:bg-[var(--color-subtle)] hover:opacity-100',
                        HIT_AREA,
                      )}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {/* Soft edge so a clipped tab reads as "there's more" rather than
              looking like a rendering glitch. The "…" menu is the affordance. */}
          {overflowIds.length > 0 && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--color-card)] to-transparent"
            />
          )}
          </div>
          <div ref={addMenuRef} className="relative flex shrink-0 items-center gap-0.5">
            {overflowIds.length > 0 && (
              <div ref={overflowMenuRef} className="relative flex items-center">
                <Button variant="unstyled"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={overflowMenuOpen}
                  aria-label={`Show ${overflowIds.length} more tab${overflowIds.length === 1 ? '' : 's'}`}
                  data-testid="right-pane-tab-overflow"
                  onClick={() => { setAddMenuOpen(false); setOverflowMenuOpen((v) => !v); }}
                  title={`${overflowIds.length} more tab${overflowIds.length === 1 ? '' : 's'}`}
                  className="flex items-center gap-0.5 rounded-md px-1 py-1 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-semibold tabular-nums">{overflowIds.length}</span>
                </Button>
                {overflowMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-40 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg"
                  >
                    <div className="border-b border-[var(--color-border)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      More tabs
                    </div>
                    {overflowIds.map((id) => {
                      const t = state.tabs.find((x) => x.id === id);
                      const def = t ? tabs[t.type] : undefined;
                      if (!t || !def) return null;
                      const index = tabIndexById.get(t.id) ?? 1;
                      const label = def.getTabLabel ? def.getTabLabel({ id: t.id, index }) : def.label;
                      const icon = def.getTabIcon ? def.getTabIcon({ id: t.id, index }) : def.icon;
                      const isActive = t.id === state.active;
                      return (
                        <Button variant="unstyled"
                          key={id}
                          role="menuitem"
                          onClick={() => selectTabFromOverflow(id)}
                          data-testid={`right-pane-overflow-${t.type}`}
                          title={label}
                          className={cn(
                            'flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] transition-colors hover:bg-[var(--color-subtle)]',
                            isActive && 'bg-[var(--color-primary)]/10 text-[var(--color-foreground)]',
                          )}
                        >
                          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-muted-foreground)]">
                            {icon}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <Button variant="unstyled"
              type="button"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              aria-label="Add tab"
              data-testid="right-pane-add-tab"
              onClick={() => { setOverflowMenuOpen(false); setAddMenuOpen((v) => !v); }}
              disabled={availableAdds.length === 0}
              title={availableAdds.length === 0 ? 'All available tabs are already open' : 'Add tab'}
              className={cn(
                'rounded-md p-1 text-[var(--color-muted-foreground)] transition-colors',
                // 22x22 as drawn — under the 24px target floor. The
                // pseudo-element widens the pointer target without changing
                // the header's dense spacing.
                HIT_AREA,
                availableAdds.length === 0
                  ? 'cursor-not-allowed opacity-40'
                  : 'hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
              )}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            {!isNarrow && (
              <Button variant="unstyled"
                type="button"
                aria-label={fullscreen ? 'Exit full screen' : 'Expand to full screen'}
                aria-pressed={fullscreen}
                data-testid="right-pane-fullscreen"
                onClick={() => setFullscreen((v) => !v)}
                className={cn(
                  'rounded-md p-1 transition-colors',
                  HIT_AREA,
                  fullscreen
                    ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                    : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
                )}
                title={fullscreen ? 'Exit full screen' : 'Expand to full screen'}
              >
                {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            )}
            <Button variant="unstyled"
              type="button"
              aria-label="Close right pane"
              data-testid="right-pane-close"
              onClick={() => onOpenChange(false)}
              className={cn(
                'rounded-md p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
                HIT_AREA,
              )}
              title="Close side pane"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
            {addMenuOpen && availableAdds.length > 0 && (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg"
              >
                <div className="border-b border-[var(--color-border)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                  Add tab
                </div>
                {availableAdds.map(({ type, def }) => (
                  <Button variant="unstyled"
                    key={type}
                    role="menuitem"
                    disabled={def.disabled}
                    onClick={() => addTab(type)}
                    data-testid={`right-pane-add-${type}`}
                    title={def.disabled ? def.disabledReason ?? 'Unavailable' : def.description ?? def.label}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] transition-colors',
                      def.disabled
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:bg-[var(--color-subtle)]',
                    )}
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center text-[var(--color-muted-foreground)]">
                      {def.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-[var(--color-foreground)]">{def.label}</div>
                      {def.description && (
                        <div className="truncate text-[10.5px] text-[var(--color-muted-foreground)]">
                          {def.description}
                        </div>
                      )}
                    </div>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Instance-cap refusal (N7). Inline rather than a toast: the cap
            belongs to this pane, and the message has to appear next to the
            control the user just pressed. */}
        {capNotice && (
          <div
            role="status"
            data-testid="right-pane-cap-notice"
            className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-warning)]/10 px-3 py-1.5 text-[11px] text-[var(--color-warning)]"
          >
            {capNotice}
          </div>
        )}

        {/* Body — mount every tab once, hide inactive ones. Keeps stateful
            children (e.g. Browser stream) alive across tab switches. Panels
            gate live work on `active`; see `RightPanePanelProps`. Each body is
            a memoised component (`RightPanePanel`), so a re-render of this pane
            reaches only the panels whose def or ctx actually changed. */}
        <div className="relative min-h-0 flex-1">
          {state.tabs.map((t) => {
            const def = tabs[t.type];
            if (!def) return null;
            return (
              <RightPanePanel
                key={t.id}
                def={def}
                id={t.id}
                type={t.type}
                index={tabIndexById.get(t.id) ?? 1}
                active={t.id === activeTab?.id}
              />
            );
          })}
        </div>
      </aside>
    </>
  );
}

/**
 * Small controlled hook for the parent to manage the pane's open state
 * with localStorage persistence — mirrors the sidebar toggle behaviour.
 */
export function useRightPaneOpen(storageKey: string, initial = false): [boolean, (next: boolean) => void, () => void] {
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(`${storageKey}:open`);
      if (raw != null) return raw === '1';
    } catch { /* noop */ }
    return initial;
  });
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(`${storageKey}:open`, next ? '1' : '0');
    } catch { /* noop */ }
  }, [storageKey]);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  return [open, setOpen, toggle];
}
