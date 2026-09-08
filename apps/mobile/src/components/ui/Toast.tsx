// ────────────────────────────────────────────────────────────────
// Toast — transient confirmation.
//
// The app previously had exactly two ways to report an outcome: an `Alert`,
// which stops everything, and nothing at all. Most outcomes are neither —
// "archived", "copied", "sent to the agent" — and on a phone the honest
// place for them is a brief banner that does not take the screen away.
//
// Deliberately anchored to the TOP rather than the bottom: the bottom is
// where the composer, the tab bar and every sheet live, and a toast that
// covers the send button while confirming a send is worse than silence.
//
// v2 adds `variant` (the four-tone vocabulary the rest of the system uses),
// `duration`, and swipe-up to dismiss. `tone` is kept as an alias.
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInUp,
  FadeOutUp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Check, Info, XCircle } from 'lucide-react-native';

import { Touchable } from './Touchable';
import { MAX_SCALE, announce, useReduceMotion } from './accessibility';
import { SPRING_SWIPE } from './motion';
import { haptics } from './haptics';
import { useTheme } from '../../theme/ThemeProvider';

/** @deprecated Use `ToastVariant`. `error` maps to `danger`. */
export type ToastTone = 'success' | 'error' | 'info';
export type ToastVariant = 'info' | 'success' | 'warning' | 'danger';

export interface ToastRequest {
  message: string;
  /** @deprecated Use `variant`. */
  tone?: ToastTone;
  variant?: ToastVariant;
  /** An optional single action, e.g. Undo. */
  action?: { label: string; onPress: () => void };
  /**
   * Milliseconds on screen. Defaults to 3200, or 5000 when there is an action
   * (the user needs time to read it AND reach it). Pass `0` to keep the toast
   * until dismissed — only for outcomes the user must acknowledge.
   */
  duration?: number;
}

interface ToastState extends ToastRequest {
  id: number;
  resolved: ToastVariant;
}

interface ToastApi {
  show: (request: ToastRequest) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, dismiss: () => {} });

const DURATION_MS = 3200;
const DURATION_WITH_ACTION_MS = 5000;

function resolveVariant(request: ToastRequest): ToastVariant {
  if (request.variant) return request.variant;
  if (request.tone === 'error') return 'danger';
  if (request.tone === 'success') return 'success';
  return 'info';
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback((request: ToastRequest) => {
    if (timer.current) clearTimeout(timer.current);
    nextId.current += 1;
    const resolved = resolveVariant(request);
    setToast({ ...request, id: nextId.current, resolved });
    if (resolved === 'danger') haptics.error();
    else if (resolved === 'warning') haptics.warn();
    else if (resolved === 'success') haptics.success();
    // A visual-only confirmation is invisible to a screen-reader user, and
    // this is precisely the class of message they most need.
    announce(request.message);
    const duration = request.duration ?? (request.action ? DURATION_WITH_ACTION_MS : DURATION_MS);
    if (duration > 0) timer.current = setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const api = React.useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} onDismiss={dismiss} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const translateY = useSharedValue(0);

  const icon =
    toast.resolved === 'success' ? (
      <Check size={16} color={colors.success} />
    ) : toast.resolved === 'danger' ? (
      <XCircle size={16} color={colors.danger} />
    ) : toast.resolved === 'warning' ? (
      <AlertTriangle size={16} color={colors.warning} />
    ) : (
      <Info size={16} color={colors['muted-foreground']} />
    );

  // Swipe up to dismiss — the platform gesture for a banner. Downward drag
  // rubber-bands so the toast does not look detachable in that direction.
  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-16, 16])
    .onUpdate((event) => {
      translateY.value = event.translationY < 0 ? event.translationY : event.translationY * 0.15;
    })
    .onEnd((event) => {
      if (event.translationY < -24 || event.velocityY < -500) {
        translateY.value = withSpring(-120, SPRING_SWIPE);
        runOnJS(onDismiss)();
        return;
      }
      translateY.value = withSpring(0, SPRING_SWIPE);
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View pointerEvents="box-none" className="absolute left-0 right-0" style={{ top: insets.top + 8, zIndex: 100 }}>
      <GestureDetector gesture={pan}>
        <Animated.View
          entering={reduceMotion ? undefined : FadeInUp.springify().damping(18)}
          exiting={reduceMotion ? undefined : FadeOutUp.duration(150)}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="mx-4 flex-row items-center gap-2.5 rounded-3xl border border-border bg-overlay px-4 py-3"
          style={[
            dragStyle,
            {
              shadowColor: 'rgb(0,0,0)',
              shadowOpacity: 0.25,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 4 },
              elevation: 12,
            },
          ]}
        >
          {icon}
          <Text numberOfLines={2} maxFontSizeMultiplier={MAX_SCALE.control} className="flex-1 text-sm text-foreground">
            {toast.message}
          </Text>
          {toast.action ? (
            <Touchable
              accessibilityLabel={toast.action.label}
              haptic="commit"
              ripple={false}
              scale="none"
              onPress={() => {
                onDismiss();
                toast.action?.onPress();
              }}
              className="min-h-11 justify-center px-1"
            >
              <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-sm font-semibold text-primary">
                {toast.action.label}
              </Text>
            </Touchable>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Show a toast. Safe outside the provider so a component can be rendered in
 * isolation. Unchanged signature: `toast({ message, tone })` still works.
 */
export function useToast(): (request: ToastRequest) => void {
  return useContext(ToastContext).show;
}

/** Programmatic dismissal — for a toast with `duration: 0`. */
export function useDismissToast(): () => void {
  return useContext(ToastContext).dismiss;
}
