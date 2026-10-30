import { ApiError, createApiClient } from '@generatorai/client-core';
// ────────────────────────────────────────────────────────────────
// usePushNotifications — registration + tap routing.
//
// Registration is idempotent and retried on every foreground, because the OS
// rotates push tokens without warning and a stale token silently stops
// delivering. Re-registering an unchanged token is a cheap no-op upsert.
//
// Every outcome is reported to `usePushStatusStore` so Settings ›
// Notifications can say WHY nothing arrives — a build without an EAS project
// id used to be indistinguishable from a working one.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { usePathname } from 'expo-router';
import { linkQueue } from '../navigation/links';

import { useAuth } from '../auth/AuthProvider';
import { getAuthenticatedFetch } from '../auth/backgroundFetch';
import { prefs } from '../storage/prefs';
import { requestPushToken } from './push';
import { intentFromResponse, submitAnswer, submitDecision, type NotificationIntent } from './notificationCategories';
import { setVisibleScreen } from './onScreen';
import { usePushStatusStore } from './pushStatus';
import { pauseKey, readNotifyPrefs, serverMuteUntil } from './notificationFilter';

export function projectId(): string | null {
  const value =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function usePushNotifications(): void {
  const { state, fetch: authFetch, serverId } = useAuth();
  const authenticated = state.status === 'authenticated';
  const registeredToken = useRef<string | null>(null);
  const setStatus = usePushStatusStore((s) => s.setStatus);
  const preferencesVersion = usePushStatusStore((s) => s.preferencesVersion);
  const pathname = usePathname();

  // ── Foreground duplicates (06 §7.2): the handler hides a push about the item on screen ──
  useEffect(() => {
    setVisibleScreen(serverId, pathname);
  }, [serverId, pathname]);

  // ── Registration ────────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated) {
      setStatus({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    registeredToken.current = null;

    const register = async (): Promise<void> => {
      if (Platform.OS === 'web') {
        setStatus({ kind: 'disabled', reason: 'web' });
        return;
      }
      const id = projectId();
      // Without an EAS project id `getExpoPushTokenAsync` cannot mint a
      // token. The app must still run — but the reason is surfaced, not
      // swallowed: this is the single setting that silently disabled push
      // in every build to date.
      if (!id) {
        setStatus({ kind: 'disabled', reason: 'eas-project-id-missing' });
        return;
      }

      const registration = await requestPushToken(id);
      if (cancelled) return;
      if (!registration) {
        setStatus({ kind: 'no-permission' });
        return;
      }
      if (registeredToken.current === registration.token) return;

      try {
        await createApiClient(authFetch).auth.registerPush(registration);
        if (cancelled) return;
        registeredToken.current = registration.token;
        setStatus({ kind: 'registered' });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError) {
          if (error.status === 501) {
            registeredToken.current = registration.token;
            setStatus({ kind: 'server-disabled' });
          } else {
            setStatus({ kind: 'rejected', httpStatus: error.status });
          }
        } else {
          setStatus({ kind: 'offline' });
        }
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
  }, [authenticated, authFetch, setStatus]);

  // ── Preference sync ─────────────────────────────────────────────
  //
  // The server cannot filter per category, but it can mute the two
  // non-approval categories outright. Engage that when the user has turned
  // both "Run outcomes" and "Chat replies" off, so those pushes are never
  // sent rather than merely hidden in the foreground.
  useEffect(() => {
    if (!authenticated || Platform.OS === 'web') return;
    const paused = serverId ? prefs.getNumber(pauseKey(serverId), 0) : 0;
    const mutedUntil = serverMuteUntil(readNotifyPrefs((k) => prefs.getString(k)), paused || null, Date.now());
    void createApiClient(authFetch).auth.mutePush(mutedUntil).catch(() => {
      // Offline. The foreground filter still applies; re-synced next change.
    });
  }, [authenticated, authFetch, preferencesVersion, serverId]);

  // ── Tap routing ─────────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated) return;

    // Tap-routing is native-only. `expo-notifications` has no web
    // implementation for the response APIs, and calling them there rejects
    // with `UnavailabilityError: ... is not available on web`. The promise
    // below had no rejection handler, so on the Expo web preview that surfaced
    // as an uncaught error on EVERY screen — noise that buries real faults.
    if (Platform.OS === 'web') return;

    const open = (route: string | null): void => {
      if (route) linkQueue.enqueue(route);
    };

    /**
     * Resolve a gate from the notification: Allow once / Deny on an ordinary permission, or a typed reply to a
     * question. The app is in the background (or was just launched in it); nothing is rendered, so the signed
     * fetch comes from the module-level accessor the AuthProvider registers, per server. Every failure path falls
     * back to opening the gate — an answer the user believes they sent must never be silently dropped.
     */
    const resolve = async (
      intent: Extract<NotificationIntent, { type: 'decide' | 'answer' }>,
      notificationId: string,
    ): Promise<void> => {
      const signedFetch = getAuthenticatedFetch(intent.serverId);
      if (!signedFetch) {
        open(intent.route);
        return;
      }
      const outcome = intent.type === 'decide' ? await submitDecision(intent, signedFetch) : await submitAnswer(intent, signedFetch);
      if (outcome === 'settled') {
        // Tidy the shade: an answered prompt left behind invites a second tap, which would just 409.
        void Notifications.dismissNotificationAsync(notificationId).catch(() => {});
        return;
      }
      // Gone / forbidden / failed: show the user what actually happened.
      open(intent.route);
    };

    const handle = (response: Notifications.NotificationResponse | null | undefined): void => {
      if (!response) return;
      const intent = intentFromResponse(
        response.actionIdentifier,
        response.notification?.request?.content?.data,
        Notifications.DEFAULT_ACTION_IDENTIFIER,
        response.userText,
      );
      if (intent.type === 'open') open(intent.route);
      else if (intent.type === 'decide' || intent.type === 'answer') void resolve(intent, response.notification.request.identifier);
    };

    // Cold start: the app was killed and launched by a notification tap. The
    // route must survive until the router is mounted, which it is by now.
    // On iOS an Allow/Deny pressed while the app was KILLED does not reach
    // the listener below (`opensAppToForeground: false`); it is recovered
    // here on the next launch instead, and the server answers 409 if the
    // gate has meanwhile been handled elsewhere — which counts as settled.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          handle(response);
          // Clear it, or every subsequent launch re-navigates to a stale target.
          void Notifications.clearLastNotificationResponseAsync();
        }
      })
      // A failure here means we cannot recover the launch route. That is a
      // lost navigation, never a reason to take the app down.
      .catch(() => {});

    // Foreground and background (app alive) responses: a tap, or an action
    // button. Android also delivers action presses for a killed app through
    // this listener once the JS bundle is loaded for it.
    const sub = Notifications.addNotificationResponseReceivedListener(handle);

    return () => sub.remove();
  }, [authenticated]);
}
