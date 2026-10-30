// The app badge while the app runs (06 §5.5): on every fresh attention snapshot of the active server, on a push from
// another server (its `data.counts`) and on resume, set the badge to the sum of the last known Needs-you counts of
// the paired servers. In the background the push's own `badge` (the sender's count) applies. Mounted once inside
// the AttentionProvider.
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useAuth } from '../auth/AuthProvider';
import { prefs } from '../storage/prefs';
import { useAttention } from '../stream/AttentionProvider';
import { badgePrefKey, badgeTotal } from './badges';
import { normalizePushData } from './pushData';

export function BadgeSync(): null {
  const { serverId, servers } = useAuth();
  const attention = useAttention();
  const needsYou = attention.stale ? null : (attention.snapshot?.counts.needsYou ?? null);
  const ids = servers.map((s) => s.serverId).join(',');

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const paired = ids ? ids.split(',') : [];
    const apply = (): void => {
      void Notifications.setBadgeCountAsync(badgeTotal(paired, (key) => prefs.getNumber(key, 0))).catch(() => undefined);
    };
    if (serverId && needsYou !== null) prefs.setNumber(badgePrefKey(serverId), needsYou);
    apply();
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const data = normalizePushData(notification.request.content.data);
      const counts = data?.counts as { needsYou?: unknown } | undefined;
      if (typeof data?.serverId !== 'string' || data.serverId === serverId || typeof counts?.needsYou !== 'number') return;
      if (!paired.includes(data.serverId)) return;
      prefs.setNumber(badgePrefKey(data.serverId), counts.needsYou);
      apply();
    });
    const resumed = AppState.addEventListener('change', (next) => {
      if (next === 'active') apply();
    });
    return () => {
      received.remove();
      resumed.remove();
    };
  }, [serverId, needsYou, ids]);

  return null;
}
