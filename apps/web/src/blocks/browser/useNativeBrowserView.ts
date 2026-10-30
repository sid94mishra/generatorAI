// ────────────────────────────────────────────────────────────────
// Native browser view driver (06-desktop-and-shell.md §4, D-19, D-27).
//
// Inside the desktop shell the page is a real Electron `WebContentsView`
// painted above the DOM; the SPA only reserves its rectangle (the
// placeholder `<div>` this hook's `containerRef` goes on). The driver:
//
//   1. create(tabId, workspaceId, false) on mount, destroy on unmount, and
//      re-opens the tab's remembered page once (`restoreUrl`).
//   2. Mirrors the container's rect into view bounds (ResizeObserver, window
//      resize and ancestor scroll, rAF-scheduled, DPR-snapped).
//   3. Polls a screenshot into `placeholderBg` so hiding the view (an overlay
//      over it, a tab switch) shows the page instead of a hole.
//   4. Every 100 ms hides the view when the container is hidden or a
//      `data-gai-overlay` layer that is not its ancestor overlaps it
//      (`obscured`); on becoming visible it moves the workspace's discovery
//      marker onto this tab (`setActiveTab`: the agent follows the active tab).
//   5. Relays navigation / title / loading / favicon / load-failure events.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

import { isRestorableBrowserUrl as isRestorable } from '@/lib/browserTabUrls.js';

import { nativeBrowserBridge } from './nativeBrowserBridge.js';
import { domOcclusionDeps, isContainerHidden, isObscured, MIN_VISIBLE_EDGE } from './nativeBrowserOcclusion.js';

export interface NativeBrowserViewOptions {
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

export interface NativeBrowserViewState {
  /** Goes on the placeholder element whose rect the view occupies. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Last screenshot of the page (data URL), painted behind the view. */
  placeholderBg: string | null;
  /** True while the view is hidden (container hidden or overlapped). */
  obscured: boolean;
}

/** Placeholder refresh cadence: while someone can see it / while nobody can. */
const PLACEHOLDER_WATCHED_MS = 2000;
const PLACEHOLDER_IDLE_MS = 1000;
/** Absorbs the `did-navigate` + `did-finish-load` burst of one navigation. */
const PLACEHOLDER_NAV_DEBOUNCE_MS = 250;
/** Overlay / visibility loop cadence. */
const VISIBILITY_POLL_MS = 100;

/**
 * Container rect → view bounds: pixel-snapped with the device pixel ratio so
 * the view lands on integer physical pixels (the VS Code trick that prevents
 * ½ px drift during a split-handle drag). Null for a collapsed container (its
 * tab hidden, the pane closing): that is not a place to put the view — it
 * would move to the window origin.
 */
export function snapViewBounds(
  rect: { left: number; top: number; width: number; height: number },
  dpr: number,
): { x: number; y: number; width: number; height: number } | null {
  const snap = (v: number): number => Math.round(v * dpr) / dpr;
  const x = Math.max(0, Math.floor(snap(rect.left)));
  const y = Math.max(0, Math.floor(snap(rect.top)));
  const width = Math.max(0, Math.floor(snap(rect.width)));
  const height = Math.max(0, Math.floor(snap(rect.height)));
  if (width < MIN_VISIBLE_EDGE || height < MIN_VISIBLE_EDGE) return null;
  return { x, y, width, height };
}

export function useNativeBrowserView({ tabId, workspaceId, onUrlChange, onTitleChange, onError, onLoadingChange, onFaviconChange, restoreUrl }: NativeBrowserViewOptions): NativeBrowserViewState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [placeholderBg, setPlaceholderBg] = useState<string | null>(null);
  const [obscured, setObscured] = useState(false);
  const restoreUrlRef = useRef(restoreUrl);

  // Mount / unmount lifecycle: create the WCV on mount, destroy on unmount.
  useEffect(() => {
    const api = nativeBrowserBridge();
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
  // (nested split-panes, drawer transitions), coalesced to one push per frame
  // so the WCV moves during layout without hammering IPC.
  useEffect(() => {
    const api = nativeBrowserBridge();
    const el = containerRef.current;
    if (!api || !el) return;
    let raf: number | null = null;
    let lastX = -1, lastY = -1, lastW = -1, lastH = -1;
    const push = () => {
      raf = null;
      // Keep the last real bounds for a collapsed container; visibility is
      // handled by the loop below.
      const b = snapViewBounds(el.getBoundingClientRect(), window.devicePixelRatio || 1);
      if (!b) return;
      if (b.x === lastX && b.y === lastY && b.width === lastW && b.height === lastH) return;
      lastX = b.x; lastY = b.y; lastW = b.width; lastH = b.height;
      void api.setBounds(tabId, b).catch(() => undefined);
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

  // Placeholder screenshot poll — ask main for a data-URL screenshot of the
  // WCV and paint it as CSS background-image. When the WCV is temporarily
  // hidden (overlay obscure) users see the pixels instead of a black hole.
  useEffect(() => {
    const api = nativeBrowserBridge();
    if (!api) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      // Only while someone can see it. The placeholder exists to cover the
      // moment the live view is hidden, so it only has to be current while
      // the view is showing; a tab in the background, a minimised window or
      // a pane on another dock tab was still being captured, encoded and
      // shipped over IPC every second.
      const el = containerRef.current;
      const watching = !document.hidden && !!el && !isContainerHidden(el);
      if (watching) {
        try {
          const dataUrl = await api.screenshot(tabId);
          if (!cancelled && dataUrl) setPlaceholderBg(dataUrl);
        } catch { /* ignore */ }
      }
      if (!cancelled) timer = setTimeout(tick, watching ? PLACEHOLDER_WATCHED_MS : PLACEHOLDER_IDLE_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tabId]);

  // Overlay / visibility loop. Hide the WCV when either (a) a floating layer
  // overlaps its rect, or (b) the container itself is hidden (an inactive
  // dock tab uses `visibility:hidden`, which preserves layout so a bounds
  // check alone can't detect it). This mirrors VS Code's
  // `BrowserOverlayManager` and keeps the WCV from painting over other tabs.
  useEffect(() => {
    const api = nativeBrowserBridge();
    const el = containerRef.current;
    if (!api || !el) return;
    let cancelled = false;
    let lastHidden: boolean | null = null;
    const tick = (): void => {
      if (cancelled) return;
      const nowHidden = isContainerHidden(el) || isObscured(el, domOcclusionDeps);
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
      timer = setTimeout(tick, VISIBILITY_POLL_MS);
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, VISIBILITY_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Hide on unmount so a lingering WCV never paints over other UI.
      void api.setVisible(tabId, false).catch(() => undefined);
    };
  }, [tabId, workspaceId]);

  // Subscribe to lifecycle events so the parent URL bar reacts natively.
  useEffect(() => {
    const api = nativeBrowserBridge();
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
        await new Promise((r) => setTimeout(r, PLACEHOLDER_NAV_DEBOUNCE_MS));
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

  return { containerRef, placeholderBg, obscured };
}
