// ────────────────────────────────────────────────────────────────
// Push notification registration and routing.
//
// Three responsibilities, in the order they matter:
//
//   1. REGISTER the device's token with the paired server, and re-register
//      whenever the OS rotates it (which it does without warning).
//   2. ROUTE a tap to the exact screen the notification is about. A
//      notification that dumps you on the home screen is worse than none.
//   3. HANDLE the cold-start case: the app was killed, the user tapped a
//      notification, and the route must survive until the router is ready.
// ────────────────────────────────────────────────────────────────

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Foreground presentation.
 *
 * Banners are shown even while the app is open: the user may be reading one
 * chat while a different run blocks, and silently swallowing that is exactly
 * the failure this feature exists to prevent.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface PushRegistration {
  token: string;
  provider: 'expo';
  platform: string;
}

/**
 * Android notification channels.
 *
 * Created before any token request, because Android 13+ will not even show
 * the permission prompt until a channel exists. Separate channels let a user
 * silence completions while keeping approvals audible — the alternative is
 * an all-or-nothing switch, and users pick "nothing".
 */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('approval', {
    name: 'Approvals',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync('failed', {
    name: 'Failures',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync('completed', {
    name: 'Completions',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

/**
 * Request permission and obtain a push token.
 *
 * Returns null when the user declines or the device cannot receive push —
 * both are ordinary outcomes, not errors. The app must remain fully usable
 * without notifications.
 */
export async function requestPushToken(projectId: string): Promise<PushRegistration | null> {
  await ensureAndroidChannels();

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted || existing.ios?.status === 2; /* PROVISIONAL */

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
    // Offline, or no network at first launch. The caller retries later;
    // failing to get a token must never block using the app.
    return null;
  }
}

/** Deep-link target carried in a notification's data payload. */
export function routeFromNotification(
  notification: Notifications.Notification | null | undefined,
): string | null {
  const data = notification?.request?.content?.data as { route?: unknown } | undefined;
  const route = data?.route;
  if (typeof route !== 'string' || route.length === 0) return null;

  // Only in-app paths. A notification is attacker-influenced in the sense
  // that its content originates from agent output, so an absolute URL here
  // could open an arbitrary site or another app.
  if (!route.startsWith('/') || route.startsWith('//')) return null;
  return route;
}
