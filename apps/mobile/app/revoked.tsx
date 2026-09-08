// ────────────────────────────────────────────────────────────────
// Revoked — terminal state.
//
// A revoked device must not silently retry: the whole point of revocation is
// that the owner decided this device should stop working. The only way
// forward is a deliberate re-pair, which requires physical access to the
// server's screen.
//
// D22 — on the design system: safe areas, `LockedState`, `Button`.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useAuth } from '../src/auth/AuthProvider';
import { Button } from '../src/components/ui/Button';
import { LockedState } from '../src/components/ui/States';

export default function RevokedScreen(): React.ReactElement {
  const { state, unpair } = useAuth();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const reason = state.status === 'revoked' ? state.reason : 'This device is no longer authorized.';

  return (
    <View
      className="flex-1 items-center justify-center gap-4 bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}
    >
      <LockedState
        title="Access revoked"
        reason={`${reason} To use this app again, pair it from the server's screen.`}
      />
      {/* `Button` defaults to `self-start`, which beat the column's
          `items-center` and left this hanging off the left edge under a
          centred message. */}
      <Button
        full
        label="Pair again"
        size="lg"
        loading={busy}
        accessibilityHint="Forgets this pairing and opens the pairing screen"
        onPress={() => {
          setBusy(true);
          void unpair()
            .catch(() => undefined)
            .finally(() => {
              setBusy(false);
              router.replace('/pair');
            });
        }}
      />
    </View>
  );
}
