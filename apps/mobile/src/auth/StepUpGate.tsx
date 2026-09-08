// ────────────────────────────────────────────────────────────────
// StepUpGate — mount-time biometric step-up for an exec surface.
//
// Wraps a terminal or browser pane. On first mount per session (or once the
// ten-minute window in `stepUp.ts` has lapsed) it asks the OS to confirm the
// user before the child renders at all — an unlocked phone on a desk must
// not open a shell with two taps. A cancelled prompt renders a "Confirm it's
// you" state with a button, never a blank pane and never the surface.
//
// `active` matters inside a swipeable pager: the neighbour of the current
// page is pre-mounted, and a Face ID prompt for a pane the user is not even
// looking at reads as the app misbehaving. An inactive gate sits on the
// placeholder and prompts the moment it becomes the visible page.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Fingerprint } from 'lucide-react-native';

import { Button } from '../components/ui/Button';
import { useTheme } from '../theme/ThemeProvider';
import { hasFreshStepUp, requireStepUp } from './stepUp';

type Phase = 'checking' | 'confirmed' | 'declined';

export function StepUpGate({
  reason,
  active = true,
  title = 'Confirm it’s you',
  children,
}: {
  /** The sentence the OS prompt shows — "Confirm opening a terminal". */
  reason: string;
  /** Prompt only while visible; the placeholder shows otherwise. */
  active?: boolean;
  title?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>(() => (hasFreshStepUp() ? 'confirmed' : 'checking'));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (phase !== 'checking' || !active) return undefined;
    let alive = true;
    void requireStepUp(reason).then((ok) => {
      if (alive) setPhase(ok ? 'confirmed' : 'declined');
    });
    return () => {
      alive = false;
    };
  }, [phase, active, reason, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
    setPhase('checking');
  }, []);

  if (phase === 'confirmed') return <>{children}</>;

  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <Fingerprint size={32} color={phase === 'declined' ? colors.warning : colors.primary} />
      <Text className="text-center text-base font-semibold text-foreground">{title}</Text>
      <Text className="text-center text-sm leading-relaxed text-muted-foreground">
        {phase === 'declined'
          ? 'This needs a quick check before it opens, so a phone left unlocked cannot reach it.'
          : reason}
      </Text>
      {phase === 'declined' ? <Button label="Confirm" onPress={retry} /> : null}
    </View>
  );
}
