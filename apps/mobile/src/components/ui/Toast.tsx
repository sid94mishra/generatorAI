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
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Check, Info } from 'lucide-react-native';

import { Touchable } from './Touchable';
import { MAX_SCALE, announce, useReduceMotion } from './accessibility';
import { haptics } from './haptics';
import { useTheme } from '../../theme/ThemeProvider';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastRequest {
  message: string;
  tone?: ToastTone;
  /** An optional single action, e.g. Undo. */
  action?: { label: string; onPress: () => void };
}

interface ToastState extends ToastRequest {
  id: number;
}

const ToastContext = createContext<(request: ToastRequest) => void>(() => {});

const DURATION_MS = 3200;

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback(
    (request: ToastRequest) => {
      if (timer.current) clearTimeout(timer.current);
      nextId.current += 1;
      setToast({ ...request, id: nextId.current });
      if (request.tone === 'error') haptics.error();
      else if (request.tone === 'success') haptics.success();
      // A visual-only confirmation is invisible to a screen-reader user, and
      // this is precisely the class of message they most need.
      announce(request.message);
      timer.current = setTimeout(() => setToast(null), DURATION_MS);
    },
    [],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} onDismiss={dismiss} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({
  toast,
  onDismiss,
}: {
  toast: ToastState;
  onDismiss: () => void;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  const icon =
    toast.tone === 'success' ? (
      <Check size={16} color={colors.success} />
    ) : toast.tone === 'error' ? (
      <AlertTriangle size={16} color={colors.danger} />
    ) : (
      <Info size={16} color={colors['muted-foreground']} />
    );

  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0"
      style={{ top: insets.top + 8, zIndex: 100 }}
    >
      <Animated.View
        entering={reduceMotion ? undefined : FadeInUp.springify().damping(18)}
        exiting={reduceMotion ? undefined : FadeOutUp.duration(150)}
        accessibilityLiveRegion="polite"
        className="mx-4 flex-row items-center gap-2.5 rounded-3xl border border-border bg-overlay px-4 py-3"
        style={{
          shadowColor: 'rgb(0,0,0)',
          shadowOpacity: 0.25,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 4 },
          elevation: 12,
        }}
      >
        {icon}
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={MAX_SCALE.control}
          className="flex-1 text-sm text-foreground"
        >
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
          >
            <Text className="text-sm font-semibold text-primary">{toast.action.label}</Text>
          </Touchable>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** Safe outside the provider so a component can be rendered in isolation. */
export function useToast(): (request: ToastRequest) => void {
  return useContext(ToastContext);
}
