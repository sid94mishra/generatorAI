// Keeps the home-screen widgets (iOS) and the Quick Settings tile (Android) current (06 §7.4, §7.5): the active server's live items (the live store, folded and
// redacted) with the attention feed's counts. A change of the Needs-you rows or count is written at once; any other
// change waits WIDGET_DEBOUNCE_MS (WidgetKit's reload budget); going to the background and coming back write the
// latest at once. A cached snapshot is not written as fresh data. With no server paired the widgets say so.
// In a development build, items of a server that is not paired (the `/live?script=` fixture) preview the widgets.
// Mounted once inside the AttentionProvider.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { useLiveMap } from '../../live/liveStore';
import { buildWidgetSnapshot, isUrgentWidgetChange, snapshotFingerprint, WIDGET_DEBOUNCE_MS, type WidgetSnapshot } from '../../live/widgetSnapshot';
import { useAttention } from '../../stream/AttentionProvider';
import { setTileFromSnapshot, tileAvailable } from '../quickSettingsTile';
import { currentWidgetPalette, startWidgetPaletteSync, type WidgetPalette } from '../widgetPalette';
import { homeWidgetsAvailable, writeWidgetSnapshot } from './homeWidgets';

interface Writer {
  /** Take the latest snapshot: written at once when urgent (Needs you, palette), else after the debounce. */
  push(next: WidgetSnapshot): void;
  /** Write the latest now when it differs from what the widgets show. */
  flush(): void;
  dispose(): void;
}

function createWriter(): Writer {
  let latest: WidgetSnapshot | null = null;
  let written: WidgetSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    const next = latest;
    if (!next || (written && snapshotFingerprint(written) === snapshotFingerprint(next))) return;
    writeWidgetSnapshot(next);
    // The Android Quick Settings tile takes its state from the same snapshot (06 §7.5).
    setTileFromSnapshot(next);
    written = next;
  };
  return {
    push(next) {
      latest = next;
      if (isUrgentWidgetChange(written, next) || written?.palette !== next.palette) flush();
      else timer ??= setTimeout(flush, WIDGET_DEBOUNCE_MS);
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export function HomeWidgetsSync(): null {
  const { serverId, servers } = useAuth();
  const attention = useAttention();
  const map = useLiveMap();
  const [palette, setPalette] = useState<WidgetPalette | null>(() => currentWidgetPalette());
  useEffect(() => startWidgetPaletteSync(setPalette), []);

  const [writer] = useState(createWriter);

  const label = servers.find((s) => s.serverId === serverId)?.label ?? 'Server';
  const counts = attention.snapshot?.counts ?? null;
  const fresh = !attention.stale;

  useEffect(() => {
    if (!palette || (!homeWidgetsAvailable() && !tileAvailable())) return;
    let server: { id: string; name: string } | null = serverId ? { id: serverId, name: label } : null;
    let useCounts = counts;
    if (__DEV__) {
      const paired = new Set(servers.map((s) => s.serverId));
      const preview = Object.values(map).find((s) => !paired.has(s.serverId));
      if (preview) {
        server = { id: preview.serverId, name: preview.serverName };
        useCounts = null;
      }
    }
    // A paired server's cached snapshot is not fresh data: keep what the widgets show.
    if (server?.id === serverId && serverId && !fresh) return;
    const next = buildWidgetSnapshot({ map, server, counts: server?.id === serverId ? useCounts : null, palette, now: Date.now() });
    writer.push(next);
  }, [writer, map, serverId, label, counts, fresh, palette, servers]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'active') writer.flush();
    });
    return () => {
      sub.remove();
      writer.dispose();
    };
  }, [writer]);

  return null;
}
