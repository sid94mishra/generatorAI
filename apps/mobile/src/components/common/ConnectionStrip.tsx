// ────────────────────────────────────────────────────────────────
// ConnectionStrip — one line, app-wide, that says why nothing is moving.
//
// Three states, in priority order:
//   offline       the shared socket is gone and the client has given up
//   reconnecting  the client is retrying (attempt n)
//   rejected      the server refused a scope this device does not hold —
//                 for every phone paired before `read:activity` existed,
//                 that is the Activity feed. Retry re-mints the token and
//                 asks for the scope again.
//
// It is rendered IN FLOW above the root navigator, not as an overlay: a
// banner that sits on top of the header hides the back button for as long as
// the outage lasts, which is precisely when someone wants to leave the
// screen. Being in flow means it pushes the navigator down by 32pt while
// shown, animated on the UI thread and collapsed to a plain cut under Reduce
// Motion.
//
// `ConnectionStripHost` owns the status-bar band so the strip can sit
// directly under it. The subtree is told its top inset is already consumed
// (`SafeAreaInsetsContext`), which is what `Screen`, and react-navigation's
// native-stack header, read — so nothing below double-pads. The band paints
// the same `bg-background` every header in this app already uses, so the
// chrome looks identical to before with the strip hidden.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshCw, ShieldAlert, WifiOff } from 'lucide-react-native';

import { useAuth } from '../../auth/AuthProvider';
import { useMuxStream } from '../../stream/MuxStreamProvider';
import { describeNotice, useStreamHealth, type NoticeTone } from '../../stream/streamHealth';
import { Touchable } from '../ui/Touchable';
import { MAX_SCALE, announce, useReduceMotion } from '../ui/accessibility';
import { haptics } from '../ui/haptics';
import { TIMING } from '../ui/motion';
import { useTheme } from '../../theme/ThemeProvider';

/** Single line. Anything taller competes with the header it sits above. */
const STRIP_HEIGHT = 32;

const TONE_BG: Record<NoticeTone, string> = {
  danger: 'bg-danger-muted',
  warning: 'bg-warning-muted',
};

export function ConnectionStrip(): React.ReactElement | null {
  const connection = useStreamHealth((s) => s.connection);
  const attempt = useStreamHealth((s) => s.attempt);
  const rejected = useStreamHealth((s) => s.rejectedScopes);
  const clearRejected = useStreamHealth((s) => s.clearRejected);
  const stream = useMuxStream();
  const { refreshPermissions } = useAuth();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [busy, setBusy] = useState(false);

  const notice = useMemo(
    () => describeNotice(connection, attempt, rejected),
    [connection, attempt, rejected],
  );
  const visible = notice !== null;

  // The last notice is kept so the line has something to show while it
  // collapses; otherwise the text vanishes a frame before the bar does.
  const lastNotice = useRef(notice);
  if (notice) lastNotice.current = notice;
  const shown = notice ?? lastNotice.current;

  const progress = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    // `TIMING` already carries `ReduceMotion.System`; the explicit branch
    // honours the in-app preference, which the OS switch knows nothing about.
    progress.value = reduceMotion ? (visible ? 1 : 0) : withTiming(visible ? 1 : 0, TIMING);
  }, [visible, reduceMotion, progress]);

  const frame = useAnimatedStyle(() => ({
    height: progress.value * STRIP_HEIGHT,
    opacity: progress.value,
  }));

  // `accessibilityLiveRegion` is Android-only; VoiceOver needs the message
  // spoken explicitly, and "offline" is exactly the kind of thing a
  // screen-reader user cannot otherwise discover.
  useEffect(() => {
    if (notice) announce(notice.message);
  }, [notice]);

  const retry = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    haptics.tap();
    try {
      // Scopes travel inside the access token: a grant made on the desktop is
      // invisible until it is re-minted. Then forget the rejection so the
      // dropped scope is asked for again (`useGlobalStream` re-subscribes on
      // the generation bump).
      await refreshPermissions();
      stream?.resetRejections();
      clearRejected();
    } catch {
      haptics.error();
    } finally {
      setBusy(false);
    }
  }, [busy, refreshPermissions, stream, clearRejected]);

  if (!shown) return null;

  const iconColor = shown.tone === 'danger' ? colors.danger : colors.warning;
  const icon =
    shown.kind === 'offline' ? (
      <WifiOff size={14} color={iconColor} />
    ) : shown.kind === 'reconnecting' ? (
      <RefreshCw size={14} color={iconColor} />
    ) : (
      <ShieldAlert size={14} color={iconColor} />
    );

  return (
    <Animated.View
      style={frame}
      className="overflow-hidden"
      pointerEvents={visible ? 'auto' : 'none'}
      // Hidden from the tree while collapsed, or a screen reader finds a
      // zero-height line about being offline on a healthy app.
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <View
        accessibilityLiveRegion="polite"
        className={`flex-row items-center gap-2 px-4 ${TONE_BG[shown.tone]}`}
        style={{ height: STRIP_HEIGHT }}
      >
        {icon}
        <Text
          accessibilityRole="text"
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className="flex-1 text-xs font-medium text-foreground"
        >
          {shown.message}
        </Text>
        {shown.retry ? (
          <Touchable
            accessibilityLabel="Retry"
            accessibilityHint="Checks for new permissions and reconnects the activity feed"
            accessibilityState={{ busy }}
            disabled={busy}
            haptic="none"
            ripple={false}
            scale="none"
            onPress={() => void retry()}
            className="rounded-full px-2 py-1"
          >
            <Text
              maxFontSizeMultiplier={MAX_SCALE.chrome}
              className="text-xs font-semibold text-primary"
            >
              {busy ? 'Checking…' : 'Retry'}
            </Text>
          </Touchable>
        ) : null}
      </View>
    </Animated.View>
  );
}

/**
 * Owns the status-bar band and mounts the strip directly under it.
 *
 * Everything inside reads a top inset of 0: the band has already been paid
 * for here, and paying it twice is the ~90pt of dead space `Screen`'s header
 * comment warns about.
 */
export function ConnectionStripHost({ children }: { children: React.ReactNode }): React.ReactElement {
  const insets = useSafeAreaInsets();
  const consumed = useMemo(() => ({ ...insets, top: 0 }), [insets]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ConnectionStrip />
      <SafeAreaInsetsContext.Provider value={consumed}>{children}</SafeAreaInsetsContext.Provider>
    </View>
  );
}
