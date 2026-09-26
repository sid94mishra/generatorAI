// ────────────────────────────────────────────────────────────────
// Browser descriptor polling (09-verification.md §5.2): 400 ms while the
// session is starting, stopping or not yet ready, 4 s otherwise, 2 s after an
// error. A 401/403 stops polling for good (`browserDenied`).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';

import { fetchBrowserDescriptor, isAuthDenial, type BrowserDescriptor } from './browserApi.js';

export const DESCRIPTOR_POLL_TRANSIENT_MS = 400;
export const DESCRIPTOR_POLL_IDLE_MS = 4000;
export const DESCRIPTOR_POLL_RETRY_MS = 2000;

/** Starting, stopping, or active but not ready yet: poll fast. */
export function isTransientDescriptor(d: BrowserDescriptor): boolean {
  return d.status === 'starting' || d.status === 'stopping' || (d.status === 'active' && !d.ready);
}

export interface BrowserDescriptorState {
  descriptor: BrowserDescriptor | null;
  setDescriptor: React.Dispatch<React.SetStateAction<BrowserDescriptor | null>>;
  /** The server refused this device browser authority (401/403) — a
   *  different empty state from "the browser is simply not running". */
  browserDenied: boolean;
  /** Bumped by {@link restart}; the live-view socket re-opens on it too. */
  sessionKey: number;
  /** Restart polling (and the live view) — after a start. */
  restart: () => void;
  /** Fetch the descriptor once, now. Rejects on failure. */
  refresh: () => Promise<void>;
}

export function useBrowserDescriptor({ open, workspaceId }: { open: boolean; workspaceId: string | undefined }): BrowserDescriptorState {
  const [descriptor, setDescriptor] = useState<BrowserDescriptor | null>(null);
  const [browserDenied, setBrowserDenied] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const d = await fetchBrowserDescriptor(workspaceId);
        if (cancelled) return;
        setBrowserDenied(false);
        setDescriptor(d);
        timer = setTimeout(tick, isTransientDescriptor(d) ? DESCRIPTOR_POLL_TRANSIENT_MS : DESCRIPTOR_POLL_IDLE_MS);
      } catch (err) {
        if (cancelled) return;
        // A 401/403 is a verdict, not a hiccup: this device is missing
        // `exec:browser` and no amount of retrying changes that. Polling on
        // regardless turned one missing scope into ~1,900 denied requests an
        // hour, EACH writing a 'critical' audit row — `/workspaces/:id/browser`
        // is riskLevel 'high' — so an idle chat tab quietly flooded the
        // security log. Stop, and let the empty state say why. The effect
        // re-runs (and so re-tries) when the workspace, `open` or the session
        // key change, which is when the answer could actually differ.
        if (isAuthDenial(err)) {
          setBrowserDenied(true);
          return;
        }
        timer = setTimeout(tick, DESCRIPTOR_POLL_RETRY_MS);
      }
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [open, workspaceId, sessionKey]);

  const restart = useCallback(() => setSessionKey((k) => k + 1), []);
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const d = await fetchBrowserDescriptor(workspaceId);
    setDescriptor(d);
  }, [workspaceId]);

  return { descriptor, setDescriptor, browserDenied, sessionKey, restart, refresh };
}
