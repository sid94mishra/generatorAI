// ────────────────────────────────────────────────────────────────
// Chrome-like tab state for the host tab strip (spinner → favicon + title),
// and the per-tab "last visited URL" memory that brings a torn-down native
// tab back where it was. Internal URLs never reach the tab label.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

import { isRestorableBrowserUrl, writeBrowserTabUrl } from '@/lib/browserTabUrls.js';

import { isInternalBrowserUrl } from './browserInput.js';

/** Live tab state a host tab strip can use to render a Chrome-like tab. */
export interface BrowserTabState {
  loading: boolean;
  title: string | null;
  favicon: string | null;
  url: string | null;
}

export interface BrowserTabStateOptions {
  open: boolean;
  nativeAvailable: boolean;
  /** This native tab's own URL (native mode). */
  nativeUrl: string | null;
  /** The descriptor's status and URL (screencast mode). */
  descriptorStatus: string | undefined;
  descriptorUrl: string | undefined;
  urlScopeKey?: string;
  nativeTabId: string | null;
  onTabStateChange?: (state: BrowserTabState) => void;
}

export function useBrowserTabState({ open, nativeAvailable, nativeUrl, descriptorStatus, descriptorUrl, urlScopeKey, nativeTabId, onTabStateChange }: BrowserTabStateOptions) {
  const [tabLoading, setTabLoading] = useState(false);
  const [tabTitle, setTabTitle] = useState<string | null>(null);
  const [tabFavicon, setTabFavicon] = useState<string | null>(null);

  // The callback is read from a ref so a parent passing an inline
  // `onTabStateChange` can't retrigger the emit effect (which would loop:
  // emit → parent setState → new callback identity → emit → …).
  const onTabStateChangeRef = useRef(onTabStateChange);
  useEffect(() => { onTabStateChangeRef.current = onTabStateChange; }, [onTabStateChange]);
  // Last emitted tab-state (serialized) — dedupes redundant host notifications.
  const lastTabStateRef = useRef<string | null>(null);

  // In screencast (web) mode we only know loading from the descriptor status
  // and have no favicon; in native mode NativeBrowserView drives these.
  useEffect(() => {
    if (nativeAvailable) return;
    setTabLoading(descriptorStatus === 'starting');
  }, [nativeAvailable, descriptorStatus]);

  useEffect(() => {
    const url = nativeAvailable ? nativeUrl : (descriptorUrl ?? null);
    const internal = isInternalBrowserUrl(url);
    const next: BrowserTabState = {
      loading: tabLoading,
      title: internal ? null : tabTitle,
      favicon: internal ? null : tabFavicon,
      url,
    };
    // Dedupe: only notify the host when the tab state actually changed.
    const serialized = JSON.stringify(next);
    if (serialized === lastTabStateRef.current) return;
    lastTabStateRef.current = serialized;
    // Remember where this tab is so it can be restored after the view is
    // torn down (navigating away from the chat / run). Only real pages are
    // recorded — a transient blank during teardown must not erase memory.
    if (urlScopeKey && nativeTabId && isRestorableBrowserUrl(url)) {
      writeBrowserTabUrl(urlScopeKey, nativeTabId, url);
    }
    onTabStateChangeRef.current?.(next);
  }, [nativeAvailable, nativeUrl, tabLoading, tabTitle, tabFavicon, descriptorUrl, urlScopeKey, nativeTabId]);

  // Reset tab state when the panel closes so a stale spinner/title doesn't
  // linger on the tab.
  useEffect(() => {
    if (!open) { setTabLoading(false); setTabTitle(null); setTabFavicon(null); }
  }, [open]);

  return {
    /** NativeBrowserView event sinks. */
    onNativeTitleChange: (t: string | null) => setTabTitle(t ?? null),
    onNativeLoadingChange: (l: boolean) => setTabLoading(l),
    onNativeFaviconChange: (f: string | null) => setTabFavicon(f ?? null),
  };
}
