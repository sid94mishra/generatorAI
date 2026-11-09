// ────────────────────────────────────────────────────────────────
// The Devices tab's device list: polled while the tab is visible (faster while
// a device is starting), plus start / stop / agent access, and the
// `devices:<workspaceId>` events (the agent opened a device, asked for one).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { openMultiplexedStream } from '@/platform/muxStream.js';
import { fetchDevices, setDeviceAccess, startDevice, stopDevice, type DevicesListing } from './devicesApi.js';

const POLL_MS = 4000;
const POLL_STARTING_MS = 1500;

export interface DevicesState {
  listing: DevicesListing | null;
  loading: boolean;
  error: string | null;
  /** Device keys with a start or stop in flight. */
  busy: ReadonlySet<string>;
  refresh: (fresh?: boolean) => Promise<void>;
  start: (device: string) => Promise<boolean>;
  stop: (device: string) => Promise<void>;
  setAccess: (device: string, allowed: boolean) => Promise<void>;
  actionError: string | null;
  clearActionError: () => void;
}

export function useDevices(workspaceId: string | undefined, active: boolean): DevicesState {
  const [listing, setListing] = useState<DevicesListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (fresh = false) => {
      if (!workspaceId) return;
      setLoading(true);
      try {
        const next = await fetchDevices(workspaceId, fresh);
        if (mounted.current) {
          setListing(next);
          setError(null);
        }
      } catch (err) {
        if (mounted.current) setError((err as Error).message);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [workspaceId],
  );

  const starting = listing?.devices.some((d) => d.state === 'starting') || busy.size > 0;
  useEffect(() => {
    if (!active || !workspaceId) return;
    void refresh(listing === null);
    const t = setInterval(() => void refresh(), starting ? POLL_STARTING_MS : POLL_MS);
    return () => clearInterval(t);
    // `listing === null` only matters for the first fetch of a mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, workspaceId, starting, refresh]);

  const withBusy = useCallback(async <T,>(device: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy((prev) => new Set(prev).add(device));
    setActionError(null);
    try {
      return await fn();
    } catch (err) {
      if (mounted.current) setActionError((err as Error).message);
      return undefined;
    } finally {
      if (mounted.current) {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(device);
          return next;
        });
        void refresh(true);
      }
    }
  }, [refresh]);

  const start = useCallback(
    async (device: string) => (workspaceId ? (await withBusy(device, () => startDevice(workspaceId, device))) !== undefined : false),
    [workspaceId, withBusy],
  );
  const stop = useCallback(
    async (device: string) => {
      if (workspaceId) await withBusy(device, () => stopDevice(workspaceId, device));
    },
    [workspaceId, withBusy],
  );
  const setAccess = useCallback(
    async (device: string, allowed: boolean) => {
      if (!workspaceId) return;
      try {
        await setDeviceAccess(workspaceId, device, allowed);
      } catch (err) {
        setActionError((err as Error).message);
      }
      void refresh();
    },
    [workspaceId, refresh],
  );

  return { listing, loading, error, busy, refresh, start, stop, setAccess, actionError, clearActionError: () => setActionError(null) };
}

export interface DevicesEvent {
  kind: 'devices.opened' | 'devices.access_requested' | 'devices.closed';
  device: string;
  name?: string;
  by?: 'agent' | 'user';
}

/** `devices.*` events for this workspace (the agent opened or asked for a device). */
export function useDevicesEvents(workspaceId: string | undefined, onEvent: (event: DevicesEvent) => void): void {
  const latest = useRef(onEvent);
  latest.current = onEvent;
  useEffect(() => {
    if (!workspaceId) return;
    const stream = openMultiplexedStream(
      'session',
      `devices:${workspaceId}`,
      {
        onMessage: (event) => {
          try {
            const frame = JSON.parse(event.data) as { kind?: string; payload?: Record<string, unknown>; data?: Record<string, unknown> };
            const body = frame.payload ?? frame.data ?? {};
            if (
              (frame.kind === 'devices.opened' || frame.kind === 'devices.access_requested' || frame.kind === 'devices.closed') &&
              typeof body['device'] === 'string'
            ) {
              latest.current({
                kind: frame.kind,
                device: body['device'],
                ...(typeof body['name'] === 'string' ? { name: body['name'] } : {}),
                ...(body['by'] === 'agent' || body['by'] === 'user' ? { by: body['by'] } : {}),
              });
            }
          } catch {
            // malformed frame
          }
        },
      },
      ['devices.'],
    );
    return () => stream.close();
  }, [workspaceId]);
}
