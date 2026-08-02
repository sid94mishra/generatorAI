// ────────────────────────────────────────────────────────────────
// usePushNotifications — registration + tap routing.
//
// Registration is idempotent and retried on every foreground, because the OS
// rotates push tokens without warning and a stale token silently stops
// delivering. Re-registering an unchanged token is a cheap no-op upsert.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';

import { useAuth } from '../auth/AuthProvider';
import { requestPushToken } from './push';
import { safeRoute } from './routeGuard';

function projectId(): string | null {
  const value =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function usePushNotifications(): void {
  const { state, fetch: authFetch } = useAuth();
  const authenticated = state.status === 'authenticated';
  const registeredToken = useRef<string | null>(null);

  // ── Registration ────────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated) return;

    let cancelled = false;

    const register = async (): Promise<void> => {
      const id = projectId();
      // Without an EAS project id `getExpoPushTokenAsync` cannot mint a
      // token. Bail quietly: a dev build without EAS configured must still
      // run, just without notifications.
      if (!id) return;

      const registration = await requestPushToken(id);
      if (!registration || cancelled) return;
      if (registeredToken.current === registration.token) return;

      try {
        const response = await authFetch('/api/auth/push-token', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(registration),
        });
        // 501 means the server has push disabled. That is a deployment
        // choice, not an error — stop trying rather than retrying forever.
        if (response.ok || response.status === 501) {
          registeredToken.current = registration.token;
        }
      } catch {
        // Offline. The next foreground retries.
      }
    };

    void register();

    // The OS can rotate the token at any time; this fires when it does.
    const tokenSub = Notifications.addPushTokenListener(() => {
      registeredToken.current = null;
      void register();
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void register();
    });

    return () => {
      cancelled = true;
      tokenSub.remove();
      appStateSub.remove();
    };
  }, [authenticated, authFetch]);

  // ── Tap routing ─────────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated) return;

    // Tap-routing is native-only. `expo-notifications` has no web
    // implementation for the response APIs, and calling them there rejects
    // with `UnavailabilityError: ... is not available on web`. The promise
    // below had no rejection handler, so on the Expo web preview that surfaced
    // as an uncaught error on EVERY screen — noise that buries real faults.
    if (Platform.OS === 'web') return;

    const navigate = (notification: Notifications.Notification | null | undefined): void => {
      const data = notification?.request?.content?.data as { route?: unknown } | undefined;
      const route = safeRoute(data?.route);
      if (route) router.push(route as never);
    };

    // Cold start: the app was killed and launched by a notification tap. The
    // route must survive until the router is mounted, which it is by now.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          navigate(response.notification);
          // Clear it, or every subsequent launch re-navigates to a stale target.
          void Notifications.clearLastNotificationResponseAsync();
        }
      })
      // A failure here means we cannot recover the launch route. That is a
      // lost navigation, never a reason to take the app down.
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      navigate(response.notification);
    });

    return () => sub.remove();
  }, [authenticated]);
}
