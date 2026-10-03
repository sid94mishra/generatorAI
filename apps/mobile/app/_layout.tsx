// ────────────────────────────────────────────────────────────────
// Root layout — provider stack and the pairing gate.
//
// Order matters:
//   GestureHandlerRootView  must wrap everything that gestures
//   SafeAreaProvider        insets are read by the tab bar and sheets
//   ThemeProvider           injects the CSS variables the tree resolves
//   QueryClientProvider     server cache
//   AuthProvider            credentials + transport
//   MuxStreamProvider       one shared stream socket for every screen
// ────────────────────────────────────────────────────────────────

import '../src/theme/global.css';
// Applies the stored theme before the first render; must follow global.css, whose module registers the Uniwind themes.
import '../src/theme/prepaint';
// Installs `global.crypto` before anything imports the auth runtime, which is
// written against WebCrypto. Must be the first side effect. Platform-resolved:
// native installs the JSI/OpenSSL implementation, web asserts the built-in one.
import { installCrypto } from '../src/services/crypto/installCrypto';

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, Stack, SplashScreen, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ServerScope } from '../src/services/auth/ServerScope';
import { ServerQueryProvider } from '../src/services/api/ServerQueryProvider';

import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { NavigationTheme } from '../src/theme/NavigationTheme';
import { PreferencesProvider, usePreferences } from '../src/services/prefs/preferences';
import { setHapticsEnabled as setKitHapticsEnabled, setMotionPreference, setTransparencyPreference } from '../src/ui/platform';
import { useLinkRouting } from '../src/services/navigation/useLinkRouting';
import { consumeLastRoute, useLastRoute } from '../src/services/prefs/lastRoute';
import { AuthProvider, useAuth } from '../src/services/auth/AuthProvider';
import { AppLockGate } from '../src/services/auth/AppLock';
import { Spinner, ToastProvider, useToast, ContextMenuProvider, Button, ErrorState } from '../src/components/ui';
import { usePushNotifications } from '../src/services/notifications/usePushNotifications';
import { useQuickActionLinks } from '../src/services/native/quickActions';
import { MuxStreamProvider } from '../src/services/stream/MuxStreamProvider';
import { useGlobalStream } from '../src/services/stream/useGlobalStream';

installCrypto();

// Held until the theme has been read, so a dark-mode user never sees the
// white flash that an async preference read would guarantee.
void SplashScreen.preventAutoHideAsync();

/**
 * Pushes Settings › Motion and Settings › Haptics into the kit's platform layer (src/ui/platform), which
 * cannot import services (MD-14). Layout effect: the values land before the first kit interaction.
 */
function KitPreferencesBridge(): null {
  const { motion, transparency, haptics } = usePreferences();
  React.useLayoutEffect(() => {
    setMotionPreference(motion);
    setTransparencyPreference(transparency);
    setKitHapticsEnabled(haptics);
  }, [motion, transparency, haptics]);
  return null;
}

/** Applies the theme variables and keeps native chrome in step. */
function ThemedShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { appearance, legacyColors: colors } = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  // The native root behind React matches the theme, so nothing unpainted —
  // a transition, the strip behind the keyboard — shows the system white.
  useEffect(() => {
    if (colors.background) void SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [colors.background]);

  // The splash comes down once the first screen has had frames to paint, not
  // in the same tick that first allows it to render: hiding it there exposed
  // the unpainted root for a frame on every launch.
  useEffect(() => {
    if (!ready) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => void SplashScreen.hideAsync());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [ready]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={appearance === 'dark' ? 'light' : 'dark'} />
      {ready ? <NavigationTheme>{children}</NavigationTheme> : null}
    </View>
  );
}

/**
 * Route-level auth gate.
 *
 * This has to live in the ROOT LAYOUT, not in `app/index.tsx`. expo-router
 * renders the matched route directly, so `/` is the only path that ever went
 * through the gate in `index.tsx`. Any other entry — a reload on `/chats`, a
 * deep link, or a notification tap into `/runs/<id>` — mounted the screen
 * with no restored session. Its TanStack queries fired immediately, the
 * auth `fetch()` threw "Not paired", and the screen settled into its EMPTY
 * state: the app looked signed-in but every list was blank and every detail
 * read "not found", with no error anywhere to explain it.
 *
 * `/pair` and `/revoked` are exempt, otherwise the redirect loops.
 */
const PUBLIC_ROUTES = new Set(['/pair', '/revoked']);

function AuthLifecycle({ children }: { children: React.ReactNode }): React.ReactElement {
  const { state, serverId, initializing, storageLocked } = useAuth();
  const pathname = usePathname();

  // Mounted once for the whole session, above every screen, so a token
  // rotation or a notification tap is handled no matter which route is open.
  // The hook no-ops until the session is authenticated.
  usePushNotifications();
  // Home-screen quick actions / app shortcuts become queued links (M9-07), like a notification tap.
  useQuickActionLinks();
  const toast = useToast();
  const hasIncomingLink = useLinkRouting((message) => toast({ message, tone: 'error' }));

  // W09-a — the `global` scope, subscribed once for the app rather than once
  // per list tab. Without it the Chats / Runs / Automations lists have no live
  // lifecycle events at all and go stale until TanStack refetches them.
  useGlobalStream();

  // Records every restorable route as it changes (MMKV, synchronous), so a
  // cold start within 30 minutes can put the user back mid-transcript.
  useLastRoute();

  // Cold-start restore — exactly once, after the session resolves, and ONLY
  // when the app opened at its entry route: a deep link or a notification tap
  // into `/runs/<id>` is where the user asked to go and must win. The record
  // is consumed either way so a stale route can never replay later.
  const restoredRef = useRef(false);
  useEffect(() => {
    // A locked restore has not resolved anything yet: wait for the retry.
    if (initializing || storageLocked || restoredRef.current) return;
    restoredRef.current = true;
    const target = consumeLastRoute(serverId);
    if (!target || hasIncomingLink) return;
    if (state.status !== 'authenticated') return;
    if (pathname !== '/') return;
    // Pushed on top of Home, not swapped in for it: `replace` left the
    // restored screen as the only history entry, so back closed the app.
    setTimeout(() => router.push(target as Parameters<typeof router.push>[0]), 0);
  }, [initializing, storageLocked, state.status, serverId, pathname, hasIncomingLink]);

  return <>{children}</>;
}

/** The navigator stays mounted while a protected screen waits for auth.
 * Replacing the navigator with an error made its "Pair" action a dead end
 * on native, and prevented incoming pairing links from being handled.
 */
function AuthGate({ children, routeName }: { children: React.ReactNode; routeName: string }): React.ReactElement {
  const { state, initializing, storageLocked } = useAuth();
  const isPublic = PUBLIC_ROUTES.has(`/${routeName}`);

  // Never route on the first frame: `AuthState` starts at `unpaired`, which is
  // indistinguishable from "checked, and there is no session".
  if (initializing) {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner />
      </View>
    );
  }

  // Protected storage refused the read (phone locked at launch). Not
  // `unpaired` — routing to /pair here is what stranded paired users.
  if (storageLocked) return <StorageLocked />;

  if (state.status === 'revoked' && routeName !== 'revoked' && !isPublic) {
    return <Redirect href="/revoked" />;
  }

  if (state.status === 'unpaired' && !isPublic) {
    return <Redirect href="/pair" />;
  }

  // A connection failure must not masquerade as an empty account. Public
  // routes still render so the user can re-pair against a different host.
  if (state.status === 'error' && !isPublic) {
    return <ConnectionError message={state.message} kind={state.kind ?? 'unreachable'} />;
  }

  return <>{children}</>;
}

/**
 * Shown when the session could not be read because the device is locked.
 * The restore re-runs by itself when the app becomes active; the button is
 * for the case where it was already active (a Keystore hiccup on Android).
 */
function StorageLocked(): React.ReactElement {
  const { retryRestore } = useAuth();
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <Spinner />
      <Text accessibilityRole="header" className="text-center text-lg font-semibold text-foreground">
        Unlock to continue
      </Text>
      <Text className="text-center text-sm leading-relaxed text-muted-foreground">
        GeneratorAI keeps its sign-in in this device’s secure storage, which opens once the device is
        unlocked.
      </Text>
      <Button label="Try again" variant="ghost" size="sm" onPress={retryRestore} />
    </View>
  );
}

/**
 * A connection failure is a screen the user has to be able to LEAVE.
 *
 * The previous version was two `Text` nodes: no retry, no way back to
 * pairing, and no explanation of which host was unreachable — a dead end
 * reached by simply walking out of Wi-Fi range.
 */
function ConnectionError({
  message,
  kind,
}: {
  message: string;
  kind: 'unreachable' | 'credential';
}): React.ReactElement {
  const { reconnect } = useAuth();
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <ErrorState
        // A rejected saved session is not an unreachable host, and calling it
        // one sends people to check their Wi-Fi. It is also not a revocation:
        // the pairing is intact and a retry is the right first move.
        title={kind === 'credential' ? 'Sign-in needs refreshing' : 'Can’t reach your server'}
        message={
          kind === 'credential'
            ? `${message} Try again — if it keeps failing, pair this phone from the host again.`
            : message
        }
        onRetry={() => {
          void reconnect();
        }}
      />
      <View className="self-center">
        <Button
          label="Pair with a different host"
          variant="ghost"
          size="sm"
          onPress={() => router.replace('/pair')}
        />
      </View>
    </View>
  );
}

/**
 * The root Stack: the public screens (pairing, the revoked wall), the `(app)` shell with its one native Stack
 * (04 §1.2, MD-18), the development routes and "Page not found". Every screen passes the auth gate.
 */
function RootStack(): React.ReactElement {
  return (
    <Stack
      screenLayout={({ children, route }) => <AuthGate routeName={route.name}>{children}</AuthGate>}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="(app)" />
      {/* Pairing and the revoked wall are full-bleed terminal states: a back
          button would imply somewhere to go back TO, and there is not. */}
      <Stack.Screen name="pair" options={{ gestureEnabled: false }} />
      <Stack.Screen name="revoked" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* One keyboard source for the whole app: frame-accurate IME insets on
            both platforms (see src/components/ui/keyboard.ts). */}
        <KeyboardProvider>
        <ThemeProvider>
          <PreferencesProvider>
            <KitPreferencesBridge />
            <ThemedShell>
              <AuthProvider>
                <ServerScope>
                <ServerQueryProvider>
                  {/* Owns the app's ONE shared stream connection. Above
                      AuthGate so the connection survives a route change and
                      every screen's subscription rides the same socket. */}
                  <MuxStreamProvider>
                    <ToastProvider>
                      {/* Hosts the single shared long-press menu sheet;
                          `ContextMenu`/`useContextMenu` no-op without it. */}
                      <ContextMenuProvider>
                        {/* app-lock-gate: the biometric <AppLockGate> wraps
                            <AuthLifecycle> here — outside the auth gate so a locked
                            app never renders a screen, inside the providers so
                            the gate can read preferences and theme. */}
                        <AppLockGate>
                          <AuthLifecycle>
                          <RootStack />
                          </AuthLifecycle>
                        </AppLockGate>
                        {/* /app-lock-gate */}
                      </ContextMenuProvider>
                    </ToastProvider>
                  </MuxStreamProvider>
                </ServerQueryProvider>
                </ServerScope>
              </AuthProvider>
            </ThemedShell>
          </PreferencesProvider>
        </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
