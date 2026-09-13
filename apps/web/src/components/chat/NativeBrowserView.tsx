// ────────────────────────────────────────────────────────────────
// NativeBrowserView — Phase 2/3 SPA-side branch for the Integrated Browser.
//
// When running inside the desktop shell with the native-browser feature
// flag on (`window.generatoraiDesktop.browser.available === true`), the
// SPA hands off page rendering to a real Electron `WebContentsView` sitting
// on top of the workbench DOM. This component:
//
//   1. Calls `desktop.browser.create(workspaceId)` on mount and
//      `desktop.browser.destroy(...)` on unmount.
//   2. Positions the WCV using `ResizeObserver` on its placeholder <div>
//      → `desktop.browser.setBounds(workspaceId, rect)` via IPC.
//   3. Polls a 1 s WCV screenshot as a CSS `background-image` on the
//      placeholder so the transitions (start/stop, tab switch, overlay
//      obscure) are seamless — the same trick VSCode's integrated
//      browser uses.
//   4. Runs an overlay hit-test loop (Radix portals, dialogs, menus,
//      toasts) and calls `setVisible(false)` when any workbench chrome
//      overlaps the WCV rect, so DOM overlays always paint on top.
//   5. Subscribes to `onDidNavigate` / `onTitleUpdated` so the parent
//      URL bar and status pill reflect page state without polling.
//
// This is entirely opt-in: if the desktop bridge isn't present (web
// build, desktop without the flag), the parent `BrowserPanel` renders
// its existing screencast path instead.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

import { isRestorableBrowserUrl as isRestorable } from '@/lib/browserTabUrls.js';

export interface NativeBrowserViewProps {
  /** Globally-unique browser tab id (the primary key for this WCV). */
  tabId: string;
  /** Owning workspace — passed to create() so the host can carry the
   *  `gai-<workspaceId>` discovery marker on the active tab. */
  workspaceId: string;
  /** Fires on every navigation so the parent URL bar stays in sync. */
  onUrlChange?: (url: string | null) => void;
  /** Fires on every title update. */
  onTitleChange?: (title: string | null) => void;
  /** Fires when the native page fails to load a main frame. */
  onError?: (message: string) => void;
  /** Fires when the page load state changes (Chrome-like tab spinner). */
  onLoadingChange?: (loading: boolean) => void;
  /** Fires with the page's favicon URL (or null if none). */
  onFaviconChange?: (favicon: string | null) => void;
  /**
   * URL this tab was showing the last time it was mounted. The native view is
   * destroyed when you navigate away from the chat / run, so on remount we
   * re-open that page instead of leaving a blank tab. Only read once, at
   * mount — later changes are ignored so we never yank the page out from
   * under the user.
   */
  restoreUrl?: string | null;
}

/** CSS classes we consider workbench overlays that MUST paint on top. */
const OVERLAY_SELECTORS: readonly string[] = [
  // Radix UI primitives — dropdowns, popovers, dialogs, tooltips.
  '[data-radix-popper-content-wrapper]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  // Common toast / notification containers.
  '.sonner-toast',
  '[data-sonner-toaster]',
  // Modal backdrop patterns (tailwind, our own conventions).
  '[data-modal-open="true"]',
];

/**
 * Detect whether any tracked overlay overlaps the given rect (in
 * client coordinates). O(n) over the overlays; typical count is
 * 0 in idle state and 1–2 with a popover open, so it's cheap.
 */
function hasOverlayOverlap(rect: DOMRect): boolean {
  const overlays = document.querySelectorAll<HTMLElement>(OVERLAY_SELECTORS.join(','));
  for (const el of Array.from(overlays)) {
    // Skip zero-size / hidden overlays.
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (window.getComputedStyle(el).visibility === 'hidden') continue;
    if (
      r.right > rect.left &&
      r.left < rect.right &&
      r.bottom > rect.top &&
      r.top < rect.bottom
    ) return true;
  }
  return false;
}

/**
 * True when the container is not actually visible — e.g. its RightPane
 * tabpanel is inactive (`visibility:hidden`) or collapsed. Because
 * `visibility:hidden` preserves layout, a plain bounds check can't tell;
 * we use `checkVisibility()` (which accounts for ancestor visibility /
 * display) plus a zero-size fallback. When hidden we must tell main to
 * hide the WCV so it stops painting over the now-active tab.
 */
function isContainerHidden(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return true;
  const cv = (el as unknown as { checkVisibility?: (opts?: { checkVisibilityCSS?: boolean }) => boolean }).checkVisibility;
  if (typeof cv === 'function') {
    try { if (cv.call(el, { checkVisibilityCSS: true }) === false) return true; } catch { /* ignore */ }
  }
  // Fallback for engines without checkVisibility: walk ancestors for a
  // visibility:hidden that would suppress paint.
  let node: HTMLElement | null = el;
  while (node) {
    if (window.getComputedStyle(node).visibility === 'hidden') return true;
    node = node.parentElement;
  }
  return false;
}

export function NativeBrowserView({ tabId, workspaceId, onUrlChange, onTitleChange, onError, onLoadingChange, onFaviconChange, restoreUrl }: NativeBrowserViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [placeholderBg, setPlaceholderBg] = useState<string | null>(null);
  const [obscured, setObscured] = useState(false);
  const restoreUrlRef = useRef(restoreUrl);

  // Mount / unmount lifecycle: create the WCV on mount, destroy on unmount.
  useEffect(() => {
    const api = window.generatoraiDesktop?.browser;
    if (!api) return;
    let cancelled = false;
    void api.create(tabId, workspaceId, false).then(async (descriptor) => {
      if (cancelled) return;
      onUrlChange?.(descriptor.currentUrl);
      onTitleChange?.(descriptor.title);
      if (descriptor.favicon) onFaviconChange?.(descriptor.favicon);
      // Restore the page this tab had open before it was torn down. Skipped
      // when the view already carries a real page (tab reuse) so we never
      // clobber live navigation state.
      const remembered = restoreUrlRef.current;
      if (!remembered || !isRestorable(remembered)) return;
      if (isRestorable(descriptor.currentUrl)) return;
      try {
        await api.navigate(tabId, remembered);
      } catch {
        /* a dead bookmark must not break the tab */
      }
    }).catch((err: unknown) => {
      onError?.((err as Error)?.message ?? 'Failed to create native browser view');
    });
    return () => {
      cancelled = true;
      void api.destroy(tabId).catch(() => undefined);
    };
    // We intentionally exclude callback refs to avoid re-creating the WCV
    // when the parent re-renders with a new closure identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, workspaceId]);

  // Bounds sync — mirror the container's client-rect into WCV coordinates.
  // Runs whenever the container resizes AND on scroll of any ancestor
  // (nested split-panes, drawer transitions). Debounced 16 ms so the WCV
  // moves during layout without hammering IPC.
  useEffect(() => {
    const api = window.generatoraiDesktop?.browser;
    const el = containerRef.current;
    if (!api || !el) return;
    let raf: number | null = null;
    let lastX = -1, lastY = -1, lastW = -1, lastH = -1;
    const push = () => {
      raf = null;
      const rect = el.getBoundingClientRect();
      // Pixel-snap using window.devicePixelRatio so the WCV lands on
      // integer physical pixels — this is the VSCode trick that
      // prevents ½ px drift during split-handle drag.
      const dpr = window.devicePixelRatio || 1;
      const snap = (v: number) => Math.round(v * dpr) / dpr;
      const x = Math.max(0, Math.floor(snap(rect.left)));
      const y = Math.max(0, Math.floor(snap(rect.top)));
      const w = Math.max(0, Math.floor(snap(rect.width)));
      const h = Math.max(0, Math.floor(snap(rect.height)));
      // A collapsed container (its tab hidden, the pane closing) is not a
      // place to put the view: sending it moved the view to the window origin.
      // Keep the last real bounds; visibility is handled by the loop below.
      if (w < 4 || h < 4) return;
      if (x === lastX && y === lastY && w === lastW && h === lastH) return;
      lastX = x; lastY = y; lastW = w; lastH = h;
      void api.setBounds(tabId, { x, y, width: w, height: h }).catch(() => undefined);
    };
    const schedule = () => {
      if (raf != null) return;
      raf = window.requestAnimationFrame(push);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    // Scroll on any ancestor moves us too — cheap window scroll listener.
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      if (raf != null) window.cancelAnimationFrame(raf);
    };
  }, [tabId]);

  // Placeholder screenshot poll — every ~1 s ask main for a data-URL
  // screenshot of the WCV and paint it as CSS background-image. When
  // the WCV is temporarily hidden (overlay obscure) users see the
  // pixels instead of a black hole.
  useEffect(() => {
    const api = window.generatoraiDesktop?.browser;
    if (!api) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const dataUrl = await api.screenshot(tabId);
        if (!cancelled && dataUrl) setPlaceholderBg(dataUrl);
      } catch { /* ignore */ }
      if (!cancelled) timer = setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tabId]);

  // Overlay / visibility loop — poll DOM every 100 ms. Hide the WCV when
  // either (a) a registered workbench overlay overlaps its rect, or (b) the
  // container itself is hidden (e.g. an inactive RightPane tab uses
  // `visibility:hidden`, which preserves layout so a bounds check alone
  // can't detect it). This mirrors VSCode's `BrowserOverlayManager` and
  // fixes the WCV painting over other tabs after a tab switch.
  useEffect(() => {
    const api = window.generatoraiDesktop?.browser;
    const el = containerRef.current;
    if (!api || !el) return;
    let cancelled = false;
    let lastHidden: boolean | null = null;
    const tick = (): void => {
      if (cancelled) return;
      const rect = el.getBoundingClientRect();
      // This RightPane browser tab is hidden when its tabpanel is inactive
      // (`visibility:hidden`, which preserves layout) or a workbench overlay
      // overlaps it. Only the visible tab paints its WCV.
      const nowHidden = isContainerHidden(el) || hasOverlayOverlap(rect);
      if (nowHidden !== lastHidden) {
        const wasHidden = lastHidden;
        lastHidden = nowHidden;
        setObscured(nowHidden);
        void api.setVisible(tabId, !nowHidden).catch(() => undefined);
        // Becoming visible → this is now the tab the user is viewing, so move
        // the durable `gai-<workspaceId>` discovery marker onto it. The agent
        // "follows the active tab": server ops re-bind to whichever WCV holds
        // the workspace marker. Skip the very first tick when already hidden.
        if (!nowHidden && wasHidden !== false) {
          void api.setActiveTab?.(workspaceId, tabId).catch(() => undefined);
        }
      }
      timer = setTimeout(tick, 100);
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Hide on unmount so a lingering WCV never paints over other UI.
      void api.setVisible(tabId, false).catch(() => undefined);
    };
  }, [tabId, workspaceId]);

  // Subscribe to lifecycle events so the parent URL bar reacts natively.
  useEffect(() => {
    const api = window.generatoraiDesktop?.browser;
    if (!api) return;
    /**
     * Immediately refresh the placeholder background whenever the WCV
     * navigates (URL bar Enter, back/forward, in-page nav). Without this
     * the CSS placeholder is stale for up to ~1s after any navigation,
     * which is visible in DOM screenshots (Playwright/screen recording)
     * and briefly when a workbench overlay hides the WCV right after
     * a nav completes.
     */
    const refreshPlaceholder = async (): Promise<void> => {
      try {
        // A short debounce absorbs the burst of `did-navigate` +
        // `did-finish-load` events fired on a single navigation.
        await new Promise((r) => setTimeout(r, 250));
        const dataUrl = await api.screenshot(tabId);
        if (dataUrl) setPlaceholderBg(dataUrl);
      } catch { /* ignore */ }
    };
    const unsubNav = api.onDidNavigate((evt) => {
      if (evt.tabId === tabId && evt.url) {
        onUrlChange?.(evt.url);
        void refreshPlaceholder();
      }
    });
    const unsubFinish = api.onDidFinishLoad((evt) => {
      if (evt.tabId === tabId) void refreshPlaceholder();
    });
    const unsubTitle = api.onTitleUpdated((evt) => {
      if (evt.tabId === tabId) onTitleChange?.(evt.title ?? null);
    });
    const unsubFail = api.onDidFailLoad((evt) => {
      if (evt.tabId === tabId && evt.errorDescription) {
        onError?.(evt.errorDescription);
      }
    });
    const unsubLoading = api.onLoadingChanged?.((evt) => {
      if (evt.tabId === tabId) onLoadingChange?.(evt.loading === true);
    });
    const unsubFavicon = api.onFaviconUpdated?.((evt) => {
      if (evt.tabId === tabId) onFaviconChange?.(evt.favicon ?? null);
    });
    return () => {
      unsubNav();
      unsubFinish();
      unsubTitle();
      unsubFail();
      unsubLoading?.();
      unsubFavicon?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 bg-black"
      style={placeholderBg ? {
        backgroundImage: `url(${placeholderBg})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      } : undefined}
      aria-label="Native browser view"
    >
      {obscured && (
        <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-2 text-[10px] text-white/60">
          <span className="rounded bg-black/40 px-1.5 py-0.5">Paused (overlay open)</span>
        </div>
      )}
    </div>
  );
}
