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
// Installs `global.crypto` before anything imports the auth runtime, which is
// written against WebCrypto. Must be the first side effect. Platform-resolved:
// native installs the JSI/OpenSSL implementation, web asserts the built-in one.
import { installCrypto } from '../src/crypto/installCrypto';

import React, { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Redirect, Stack, SplashScreen, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react-native';

import { IconButton } from '../src/components/ui/Button';
import { goBack } from '../src/components/ui/Screen';

import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { PreferencesProvider } from '../src/prefs/preferences';
import { consumeLastRoute, useLastRoute } from '../src/prefs/lastRoute';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { AppLockGate } from '../src/auth/AppLock';
import { Spinner, ToastProvider, ContextMenuProvider, Button, ErrorState } from '../src/components/ui';
import { usePushNotifications } from '../src/notifications/usePushNotifications';
import { MuxStreamProvider } from '../src/stream/MuxStreamProvider';
import { useGlobalStream } from '../src/stream/useGlobalStream';
import { ConnectionStripHost } from '../src/components/common/ConnectionStrip';
import { ErrorBoundary } from '../src/navigation/ErrorBoundary';

installCrypto();

// Held until the theme has been read, so a dark-mode user never sees the
// white flash that an async preference read would guarantee.
void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A phone loses connectivity constantly; retrying forever just drains
      // battery and hides the real state from the user.
      retry: 2,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

/** Applies the theme variables and keeps native chrome in step. */
function ThemedShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { style, appearance, colors } = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    void SplashScreen.hideAsync();
  }, []);

  return (
    <View style={[style, { flex: 1, backgroundColor: colors.background }]}>
      <StatusBar style={appearance === 'dark' ? 'light' : 'dark'} />
      {ready ? children : null}
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

function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { state, initializing } = useAuth();
  const pathname = usePathname();

  // Mounted once for the whole session, above every screen, so a token
  // rotation or a notification tap is handled no matter which route is open.
  // The hook no-ops until the session is authenticated.
  usePushNotifications();

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
    if (initializing || restoredRef.current) return;
    restoredRef.current = true;
    const target = consumeLastRoute();
    if (!target) return;
    if (state.status !== 'authenticated') return;
    if (pathname !== '/' && pathname !== '/(tabs)') return;
    router.replace(target as Parameters<typeof router.replace>[0]);
  }, [initializing, state.status, pathname]);

  const isPublic = PUBLIC_ROUTES.has(pathname);

  // Never route on the first frame: `AuthState` starts at `unpaired`, which is
  // indistinguishable from "checked, and there is no session".
  if (initializing) {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner />
      </View>
    );
  }

  if (state.status === 'revoked' && pathname !== '/revoked') {
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
      <Button
        label="Pair with a different host"
        variant="ghost"
        size="sm"
        onPress={() => router.replace('/pair')}
      />
    </View>
  );
}

/**
 * The navigation stack for everything outside the tab shell.
 *
 * This was a bare `<Slot />`, which renders the matched route with NO
 * navigator around it: detail screens had no header, no title and — the real
 * problem — no back button. Once you tapped into a run, a chat or Settings,
 * the only way out was the OS back gesture, with nothing on screen saying
 * where you were or that going back was possible.
 *
 * The tab group draws its own header, so it opts out of this one.
 */
function RootStack(): React.ReactElement {
  const { colors } = useTheme();

  /**
   * An explicit back button for every pushed screen.
   *
   * The navigator only draws one when there is history to pop, so arriving by
   * deep link, push notification or a direct URL left detail screens with no
   * way out. `goBack` falls back to the natural parent instead.
   */
  const headerBack =
    (fallback: Parameters<typeof goBack>[0]) =>
    () => (
      <IconButton
        accessibilityLabel="Back"
        icon={<ChevronLeft size={24} color={colors.foreground} />}
        onPress={() => goBack(fallback)}
      />
    );

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.foreground },
        contentStyle: { backgroundColor: colors.background },
        // The platform push transition, explicitly: `slide_from_right` on
        // Android matches predictive back's own preview, and the iOS default
        // keeps the interactive edge-swipe pop alive.
        animation: Platform.OS === 'android' ? 'slide_from_right' : 'default',
        gestureEnabled: true,
        // Off-screen tab stacks stop re-rendering during a chat stream.
        freezeOnBlur: true,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* Pairing and the revoked wall are full-bleed terminal states: a back
          button would imply somewhere to go back TO, and there is not. */}
      <Stack.Screen name="pair" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="revoked" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="index" options={{ headerShown: false }} />

      <Stack.Screen
        name="chats/[id]"
        options={{ title: 'Chat', headerLeft: headerBack('/(tabs)/chats') }}
      />
      <Stack.Screen
        name="runs/[id]"
        options={{ title: 'Run', headerLeft: headerBack('/(tabs)/runs') }}
      />
      <Stack.Screen
        name="workflows/[id]"
        options={{ title: 'Workflow', headerLeft: headerBack('/(tabs)/runs') }}
      />
      <Stack.Screen
        name="projects/[id]"
        options={{ title: 'Project', headerLeft: headerBack('/(tabs)/projects') }}
      />
      <Stack.Screen
        name="automations/[id]"
        options={{ title: 'Automation', headerLeft: headerBack('/(tabs)/runs') }}
      />
      <Stack.Screen
        name="changes/[workspaceId]/index"
        options={{ title: 'Changes', headerLeft: headerBack('/(tabs)') }}
      />
      <Stack.Screen
        name="changes/[workspaceId]/file"
        options={{ title: 'Diff', headerLeft: headerBack('/(tabs)') }}
      />
      <Stack.Screen
        name="terminal/[workspaceId]"
        options={{ title: 'Terminal', headerLeft: headerBack('/(tabs)') }}
      />
      {/* Settings screens draw their own collapsing large title and back
          button through <Screen>. Leaving the navigator header on would stack
          an empty title bar above every one of them. */}
      <Stack.Screen name="settings/index" options={{ headerShown: false }} />
      <Stack.Screen name="settings/appearance" options={{ headerShown: false }} />
      <Stack.Screen name="settings/notifications" options={{ headerShown: false }} />
      <Stack.Screen name="settings/providers" options={{ headerShown: false }} />
      <Stack.Screen name="settings/capabilities" options={{ headerShown: false }} />
      <Stack.Screen name="settings/source-control" options={{ headerShown: false }} />
      <Stack.Screen name="settings/tools" options={{ headerShown: false }} />
      <Stack.Screen name="settings/diagnostics" options={{ headerShown: false }} />
      <Stack.Screen name="settings/about" options={{ headerShown: false }} />
      <Stack.Screen name="settings/security" options={{ headerShown: false }} />
      <Stack.Screen name="settings/accessibility" options={{ headerShown: false }} />

      {/* ── Route-addressable sheets (plan §6.2) ──────────────────────
          These are exactly the routes push notifications carry:
            /approvals                                the whole queue
            /chats/[id]/gate/[interactionId]          one pending gate
            /chats/[id]/plan/[planId]                 a plan + its decision
            /scope-request                            ask for a permission
          Presented as a form sheet on iOS (detents where the OS supports
          them) and a modal on Android. Each draws its own title row and
          Close through `RouteSheet`, which also copes with arriving cold
          (no history to pop) by falling back to the tab shell. */}
      <Stack.Screen name="approvals" options={sheetOptions} />
      <Stack.Screen name="chats/[id]/gate/[interactionId]" options={sheetOptions} />
      <Stack.Screen name="chats/[id]/plan/[planId]" options={sheetOptions} />
      <Stack.Screen name="scope-request" options={sheetOptions} />
    </Stack>
  );
}

/**
 * How a route sheet is presented.
 *
 * iOS: `formSheet` is the native `UISheetPresentationController`, with
 * medium/large detents and a grabber; a swipe down dismisses. Android has
 * no system sheet for a navigator route, so it is a modal that slides up.
 * Web preview: a modal too.
 */
const sheetOptions: React.ComponentProps<typeof Stack.Screen>['options'] =
  Platform.OS === 'ios'
    ? {
        headerShown: false,
        presentation: 'formSheet',
        sheetAllowedDetents: [0.6, 1],
        sheetGrabberVisible: true,
        sheetCornerRadius: 24,
        gestureEnabled: true,
      }
    : {
        headerShown: false,
        presentation: 'modal',
        animation: 'slide_from_bottom',
        gestureEnabled: true,
      };

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PreferencesProvider>
            <ThemedShell>
              <QueryClientProvider client={queryClient}>
                <AuthProvider>
                  {/* Owns the app's ONE shared stream connection. Above
                      AuthGate so the connection survives a route change and
                      every screen's subscription rides the same socket. */}
                  <MuxStreamProvider>
                    <ToastProvider>
                      {/* Hosts the single shared long-press menu sheet;
                          `ContextMenu`/`useContextMenu` no-op without it. */}
                      <ContextMenuProvider>
                        {/* app-lock-gate: the biometric <AppLockGate> wraps
                            <AuthGate> here — outside the auth gate so a locked
                            app never renders a screen, inside the providers so
                            the gate can read preferences and theme. */}
                        <AppLockGate>
                          <AuthGate>
                          {/* D0/S7 — the one line that says the socket is
                              down, retrying, or refused a scope this phone
                              does not hold. In flow above the navigator so
                              it never covers a back button. */}
                          <ConnectionStripHost>
                            {/* A render error on any screen lands here
                                instead of blanking the app. */}
                            <ErrorBoundary scope="root">
                              <RootStack />
                            </ErrorBoundary>
                          </ConnectionStripHost>
                          </AuthGate>
                        </AppLockGate>
                        {/* /app-lock-gate */}
                      </ContextMenuProvider>
                    </ToastProvider>
                  </MuxStreamProvider>
                </AuthProvider>
              </QueryClientProvider>
            </ThemedShell>
          </PreferencesProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
