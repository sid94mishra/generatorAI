// ────────────────────────────────────────────────────────────────
// Revoked — terminal state.
//
// A revoked device must not silently retry: the whole point of revocation is
// that the owner decided this device should stop working. The only way
// forward is a deliberate re-pair, which requires physical access to the
// server's screen.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../src/auth/AuthProvider';

export default function RevokedScreen(): React.ReactElement {
  const { state, unpair } = useAuth();
  const reason = state.status === 'revoked' ? state.reason : 'This device is no longer authorized.';

  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <Text className="text-center text-lg font-semibold text-danger">Access revoked</Text>
      <Text className="text-center text-sm text-muted-foreground">{reason}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          await unpair();
          router.replace('/pair');
        }}
        className="rounded-lg bg-primary-emphasis px-5 py-3"
      >
        <Text className="font-semibold text-primary-foreground">Pair again</Text>
      </Pressable>
    </View>
  );
}
