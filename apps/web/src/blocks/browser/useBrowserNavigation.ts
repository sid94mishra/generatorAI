// ────────────────────────────────────────────────────────────────
// Browser session control: the address bar (with its remembered URL and the
// sync that hides internal URLs), start / stop / navigate / back / forward /
// reload through native IPC when the desktop bridge is there and REST
// otherwise, the desktop auto-start, and the Share toggle.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { readBrowserTabUrl } from '@/lib/browserTabUrls.js';

import { postBrowserAction, setBrowserShared, startBrowser, stopBrowser, type BrowserDescriptor } from './browserApi.js';
import { isInternalBrowserUrl, normaliseBrowserUrl } from './browserInput.js';
import { nativeBrowserBridge } from './nativeBrowserBridge.js';

export type BrowserBusy = 'start' | 'stop' | 'navigate' | 'action' | 'share';
export type BrowserHistoryAction = 'back' | 'forward' | 'reload';

export interface BrowserNavigationOptions {
  open: boolean;
  workspaceId: string | undefined;
  /** This panel's native tab id (null without one). */
  nativeTabId: string | null;
  nativeAvailable: boolean;
  /** Namespace of the remembered-URL store (`chat:<id>` …); omit to disable. */
  urlScopeKey?: string;
  /** A turn is streaming: the Share toggle is locked. */
  agentBusy: boolean;
  descriptor: BrowserDescriptor | null;
  setDescriptor: React.Dispatch<React.SetStateAction<BrowserDescriptor | null>>;
  refreshDescriptor: () => Promise<void>;
  /** Restart descriptor polling and the live view (after a start). */
  restartSession: () => void;
  setError: (message: string | null) => void;
}

/** The Share toggle's title / accessible name. */
export function shareToggleTitle(agentBusy: boolean, attachedToChat: boolean): string {
  if (agentBusy && !attachedToChat) return 'Cannot re-attach while agent is streaming';
  if (agentBusy && attachedToChat) return 'Cannot detach while agent is streaming';
  return attachedToChat ? 'Sharing with Agent — click to stop sharing' : 'Share with Agent';
}

export function useBrowserNavigation({
  open, workspaceId, nativeTabId, nativeAvailable, urlScopeKey, agentBusy,
  descriptor, setDescriptor, refreshDescriptor, restartSession, setError,
}: BrowserNavigationOptions) {
  // Where this tab was when its view was last torn down. Read exactly once
  // per mount — re-reading as the user browses would make the tab jump back.
  const restoreUrlRef = useRef<string | null | undefined>(undefined);
  if (restoreUrlRef.current === undefined) {
    restoreUrlRef.current = urlScopeKey && nativeTabId ? readBrowserTabUrl(urlScopeKey, nativeTabId) : null;
  }
  // True until the restored page actually lands. While it is in flight the
  // view still reports the internal `about:blank#gai-…` marker, and without
  // this the URL bar would blank out and then flash the address back.
  const restorePendingRef = useRef<boolean>(Boolean(restoreUrlRef.current));
  const [urlInput, setUrlInput] = useState(() => restoreUrlRef.current ?? '');
  const [urlInputFocused, setUrlInputFocused] = useState(false);
  /** This native tab's own live URL (null for internal/blank pages). */
  const [nativeUrl, setNativeUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<BrowserBusy | null>(null);
  /** Guards native-browser auto-start so it fires once per open workspace. */
  const autoStartRef = useRef<string | null>(null);
  const attachedToChat = descriptor?.attachedToChat !== false;

  // ── Auto-start (desktop native browser) ────────────────
  // With the native browser the WebContentsView already exists, so there's
  // no reason to make the user click "Start". Kick off the server session
  // automatically on open so the address bar + controls are live and the
  // agent can share the tab immediately — the user just types a URL and goes.
  useEffect(() => {
    if (!open) { autoStartRef.current = null; return; }
    if (!workspaceId || !nativeAvailable) return;
    if (descriptor?.ready || descriptor?.status === 'starting') return;
    if (loading === 'start') return;
    if (autoStartRef.current === workspaceId) return;
    autoStartRef.current = workspaceId;
    // No initial URL: the address bar may already be pre-filled with this
    // tab's remembered page, and the native view restores it directly.
    // Passing it here too would load the page twice.
    void handleStart({ useUrlInput: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, nativeAvailable, descriptor?.ready, descriptor?.status]);

  const handleStart = useCallback(async (opts?: { useUrlInput?: boolean }) => {
    if (!workspaceId) return;
    setLoading('start'); setError(null);
    try {
      const raw = opts?.useUrlInput === false ? '' : urlInput.trim();
      const normalised = raw ? normaliseBrowserUrl(raw) : undefined;
      const nb = nativeBrowserBridge();
      if (nativeAvailable && nativeTabId && nb) {
        try { await nb.create(nativeTabId, workspaceId, true); } catch { /* ignore */ }
      }
      const d = await startBrowser(workspaceId, normalised);
      setDescriptor(d);
      restartSession();
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(null); }
  }, [workspaceId, urlInput, nativeAvailable, nativeTabId, setDescriptor, restartSession, setError]);

  const handleStop = useCallback(async () => {
    if (!workspaceId) return;
    setLoading('stop');
    try {
      await stopBrowser(workspaceId);
      await refreshDescriptor();
    } finally { setLoading(null); }
  }, [workspaceId, refreshDescriptor]);

  const handleNavigate = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!workspaceId) return;
    const url = urlInput.trim();
    if (!url) return;
    // Enter on a browser that has not been started yet.
    //
    // Auto-start is deliberately desktop-only (the effect above is gated on
    // `nativeAvailable`), so in the web UI the session genuinely is not
    // running until someone presses Start. Submitting the address bar still
    // POSTed a navigate at that missing session, and the server's internal
    // answer — "[BrowserService] No active browser session for workspace
    // <uuid>" — was rendered verbatim next to a hint telling the user to
    // press Start. Typing a URL and hitting Enter plainly means "go there",
    // and `handleStart` already accepts the address bar's contents, so take
    // that path instead of failing.
    if (descriptor?.ready !== true) {
      await handleStart({ useUrlInput: true });
      return;
    }
    setLoading('navigate'); setError(null);
    try {
      const normalised = normaliseBrowserUrl(url);
      const nb = nativeBrowserBridge();
      if (nativeAvailable && nativeTabId && nb) {
        await nb.navigate(nativeTabId, normalised);
        setNativeUrl(normalised);
      } else {
        await postBrowserAction(workspaceId, { kind: 'navigate', url: normalised });
      }
      await refreshDescriptor();
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }, [workspaceId, urlInput, nativeAvailable, nativeTabId, descriptor?.ready, handleStart, refreshDescriptor, setError]);

  const handleAction = useCallback(async (kind: BrowserHistoryAction) => {
    if (!workspaceId) return;
    setLoading('action');
    try {
      const nb = nativeBrowserBridge();
      if (nativeAvailable && nativeTabId && nb) {
        if (kind === 'back') await nb.back(nativeTabId);
        else if (kind === 'forward') await nb.forward(nativeTabId);
        else await nb.reload(nativeTabId);
      } else {
        await postBrowserAction(workspaceId, { kind });
      }
      await refreshDescriptor();
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }, [workspaceId, nativeAvailable, nativeTabId, refreshDescriptor, setError]);

  const handleToggleShare = useCallback(async () => {
    if (!workspaceId || agentBusy) return;
    setLoading('share');
    try {
      const out = await setBrowserShared(workspaceId, !attachedToChat);
      setDescriptor((d) => d ? { ...d, attachedToChat: out.attachedToChat } : d);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(null); }
  }, [workspaceId, attachedToChat, agentBusy, setDescriptor, setError]);

  // ── URL sync ──────────────────────────────────────────
  useEffect(() => {
    if (urlInputFocused) return;
    // In native mode the URL bar must reflect ONLY this tab's own live URL
    // (`nativeUrl`). We must NOT fall back to `descriptor.currentUrl` — that
    // is the workspace-level server session which "follows the active tab",
    // so a freshly-created tab (whose own nativeUrl is still null) would
    // otherwise inherit the previously-active tab's URL. A blank new tab
    // therefore correctly shows an empty address bar.
    const fresh = nativeAvailable ? nativeUrl : descriptor?.currentUrl;
    // Never show the internal discovery marker — leave the bar empty so the
    // placeholder prompts the user to type an address.
    if (isInternalBrowserUrl(fresh)) {
      if (nativeAvailable && !restorePendingRef.current) setUrlInput('');
      return;
    }
    restorePendingRef.current = false;
    if (fresh) setUrlInput(fresh);
  }, [descriptor?.currentUrl, urlInputFocused, nativeAvailable, nativeUrl]);

  /** NativeBrowserView's URL reports: internal pages count as no URL. */
  const onNativeUrlChange = useCallback((u: string | null) => {
    setNativeUrl(isInternalBrowserUrl(u) ? null : u);
  }, []);

  const shareTitle = useMemo(() => shareToggleTitle(agentBusy, attachedToChat), [agentBusy, attachedToChat]);

  return {
    /** The URL this tab had when it was last torn down (read once per mount). */
    restoreUrl: restoreUrlRef.current,
    urlInput, setUrlInput, setUrlInputFocused,
    nativeUrl, onNativeUrlChange,
    loading,
    attachedToChat, shareTitle,
    handleStart, handleStop, handleNavigate, handleAction, handleToggleShare,
  };
}
