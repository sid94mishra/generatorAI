// The OS notification permission for Settings › Notifications (MDF-114): granted, provisional (iOS quiet delivery),
// denied or not asked yet — re-read when the app comes back from the system settings — plus asking and opening the
// app's system page.
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export type NotificationPermission = 'granted' | 'provisional' | 'denied' | 'undetermined' | 'unavailable';

async function read(): Promise<NotificationPermission> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const r = await Notifications.getPermissionsAsync();
    if (r.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'provisional';
    if (r.status === 'granted') return 'granted';
    return r.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'unavailable';
  }
}

export function useNotificationPermission(): { status: NotificationPermission | null; request: () => Promise<void>; openSettings: () => void } {
  const [status, setStatus] = useState<NotificationPermission | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = (): void => void read().then((s) => alive && setStatus(s));
    refresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const request = useCallback(async () => {
    try {
      await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true, allowProvisional: false } });
    } catch {
      // Denied or unavailable: the status read below says which.
    }
    setStatus(await read());
  }, []);
  const openSettings = useCallback(() => void Linking.openSettings(), []);
  return { status, request, openSettings };
}
