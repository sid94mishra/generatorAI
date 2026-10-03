// ────────────────────────────────────────────────────────────────
// Push notifications v2: presentation, channels, categories, token (06 §7.2, MX-07).
//
//   1. PRESENT — the foreground handler shows a push unless it is about the item on screen, or the user switched
//      its kind off; it never sets the badge (the app owns it while open, `BadgeSync`).
//   2. CHANNELS — Android channels from the shared vocabulary, created before the permission request (Android 13
//      shows no prompt without one); retired channels are deleted (pre-release cleanup).
//   3. CATEGORIES — every shared category with its actions, on each launch.
//   4. TOKEN — permission + Expo token; null is an ordinary outcome.
// ────────────────────────────────────────────────────────────────

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { NOTIFICATION_CHANNELS, RETIRED_NOTIFICATION_CHANNELS, type NotificationChannelDef } from '@generatorai/shared/ui-contract';

import { prefs } from '../storage/prefs';
import { readNotifyPrefs, shouldPresent } from './notificationFilter';
import { categoryRegistrations } from './notificationCategories';
import { isOnScreen } from './onScreen';
import { normalizePushData } from './pushData';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const raw = notification.request.content.data;
    const data = normalizePushData(raw);
    const present = !isOnScreen(data) && shouldPresent(data ?? raw, readNotifyPrefs((key) => prefs.getString(key)));
    return {
      shouldShowBanner: present,
      shouldShowList: present,
      shouldPlaySound: present && data?.category !== 'done',
      shouldSetBadge: false,
    };
  },
});

export interface PushRegistration {
  token: string;
  provider: 'expo';
  platform: string;
}

const IMPORTANCE: Record<NotificationChannelDef['importance'], Notifications.AndroidImportance> = {
  max: Notifications.AndroidImportance.MAX,
  high: Notifications.AndroidImportance.HIGH,
  default: Notifications.AndroidImportance.DEFAULT,
  low: Notifications.AndroidImportance.LOW,
};

/**
 * Android channels (shared NOTIFICATION_CHANNELS). Every channel is PRIVATE: a secure lock screen shows the redacted
 * public version without action buttons (MD-33, MD-92), so an inline Allow is reachable only when unlocked.
 */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const id of RETIRED_NOTIFICATION_CHANNELS) await Notifications.deleteNotificationChannelAsync(id).catch(() => undefined);
  for (const channel of NOTIFICATION_CHANNELS) {
    const loud = channel.importance === 'max' || channel.importance === 'high';
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      description: channel.description,
      importance: IMPORTANCE[channel.importance],
      ...(loud ? { sound: 'default', enableVibrate: true, vibrationPattern: [0, 250, 250, 250] } : { sound: null, enableVibrate: false }),
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      bypassDnd: false,
    });
  }
}

/** Register every shared category (idempotent). A category that fails to register leaves its pushes without buttons. */
export async function ensureNotificationCategories(): Promise<void> {
  if (Platform.OS === 'web') return;
  for (const category of categoryRegistrations()) {
    try {
      await Notifications.setNotificationCategoryAsync(category.identifier, category.actions, category.options);
    } catch {
      // The notification still arrives; a tap opens the item.
    }
  }
}

/** Request permission and obtain a push token; null when declined or unavailable (the app stays usable). */
export async function requestPushToken(projectId: string): Promise<PushRegistration | null> {
  await ensureAndroidChannels();
  await ensureNotificationCategories();

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (!granted && existing.canAskAgain) {
    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    granted = requested.granted;
  }
  if (!granted) return null;

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: token.data, provider: 'expo', platform: Platform.OS };
  } catch {
    return null;
  }
}
