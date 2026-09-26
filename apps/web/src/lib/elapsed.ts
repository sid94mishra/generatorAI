// Elapsed time for the sidebar's Running rows ("4:12", "1:05:30"), ticking.

import { useEffect, useState } from 'react';

/** `since` → `m:ss` under an hour, `h:mm:ss` after; `0:00` for a future or bad time. */
export function formatElapsed(sinceIso: string, now: number): string {
  const since = Date.parse(sinceIso);
  const total = Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The current time, re-read every `intervalMs` while `enabled`. */
export function useNow(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}
