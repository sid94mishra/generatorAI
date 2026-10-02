// MB-28 data: the browser session's descriptor (polled slowly, refreshed at once by the stream), the live frame
// (an authenticated JPEG poll — RN Image cannot carry DPoP or read MJPEG — while the tab is on screen), the
// session's `browser.` events (`session` scope `browser:<workspaceId>`: navigation refreshes, the inspector's pick),
// and the actions: start / stop, navigate / back / forward / reload, share with the agent, the inspector, a page
// click, the viewport preset.
import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BrowserDescriptorView } from '@generatorai/client-core';

import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import { bytesToBase64 } from '../../services/lib/base64';
import { useMuxStream } from '../../services/stream/MuxStreamProvider';
import { DESCRIPTOR_EVENTS, selectionFrom, type BrowserSelection } from './model/browserModel';

const FRAME_INTERVAL_MS = 2_000;
export const browserDescriptorKey = (workspaceId: string): readonly unknown[] => ['workspaces', workspaceId, 'browser', 'descriptor'];

export function useBrowserDescriptor(workspaceId: string, active: boolean) {
  const api = useApi();
  return useQuery<BrowserDescriptorView>({
    queryKey: browserDescriptorKey(workspaceId),
    queryFn: () => api.resources.browserDescriptor(workspaceId),
    refetchInterval: active ? 5_000 : false,
  });
}

/** The newest frame as a data URI, polled while `live` (a failed poll keeps the last frame). */
export function useBrowserFrame(workspaceId: string, live: boolean): string | null {
  const api = useApi();
  const frame = useQuery({
    queryKey: ['workspaces', workspaceId, 'browser', 'frame'],
    queryFn: async () => {
      const { data } = await api.resources.browserScreencast(workspaceId, 45, Date.now());
      return `data:image/jpeg;base64,${bytesToBase64(data)}`;
    },
    enabled: live,
    refetchInterval: live ? FRAME_INTERVAL_MS : false,
    retry: false,
    gcTime: 0,
  });
  return frame.data ?? null;
}

/** The session's events; the handler is read through a ref so the subscription never reopens (a pick would be lost). */
export function useBrowserEvents(workspaceId: string, enabled: boolean, onSelection: (sel: BrowserSelection) => void): void {
  const stream = useMuxStream();
  const client = useQueryClient();
  const handler = useRef(onSelection);
  useEffect(() => {
    handler.current = onSelection;
  }, [onSelection]);
  useEffect(() => {
    if (!stream || !enabled) return undefined;
    return stream.subscribe(
      'session',
      `browser:${workspaceId}`,
      (event) => {
        if (DESCRIPTOR_EVENTS.has(event.kind)) void client.invalidateQueries({ queryKey: browserDescriptorKey(workspaceId) });
        const sel = selectionFrom(event);
        if (sel) handler.current(sel);
      },
      { filter: ['browser.'] },
    );
  }, [stream, enabled, workspaceId, client]);
}

export function useBrowserActions(workspaceId: string) {
  const admin = useAdminApi();
  const client = useQueryClient();
  const id = encodeURIComponent(workspaceId);
  const refresh = (): void => void client.invalidateQueries({ queryKey: browserDescriptorKey(workspaceId) });
  const start = useMutation({
    // /start navigates in the background and reports success even when the host blocks the URL: navigate separately.
    mutationFn: async (url: string) => {
      await admin.browser.start(id);
      if (url) await admin.browser.actions(id, { kind: 'navigate', url });
    },
    onSettled: refresh,
  });
  const stop = useMutation({ mutationFn: () => admin.browser.stop(id), onSettled: refresh });
  const act = useMutation({
    mutationFn: (action: { kind: 'navigate'; url: string } | { kind: 'back' } | { kind: 'forward' } | { kind: 'reload' }) => admin.browser.actions(id, action),
    onSettled: refresh,
  });
  const share = useMutation({
    mutationFn: async (on: boolean) => {
      if (on) await admin.browser.attach(id);
      else await admin.browser.detach(id);
      return on;
    },
    onSuccess: (on) => client.setQueryData<BrowserDescriptorView>(browserDescriptorKey(workspaceId), (prev) => (prev ? { ...prev, attachedToChat: on } : prev)),
    onSettled: refresh,
  });
  const inspector = useCallback((on: boolean) => admin.browser.actions(id, { kind: 'inspector', on }), [admin, id]);
  const click = useCallback((x: number, y: number) => admin.browser.input(id, { type: 'mouse.click', x, y }), [admin, id]);
  const resize = useCallback((width: number, height: number) => admin.browser.resize(id, width, height), [admin, id]);
  return { start, stop, act, share, inspector, click, resize };
}
