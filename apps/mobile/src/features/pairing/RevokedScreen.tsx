// Revoked (04 §2.11, R-REVOKED; `/revoked`, root, no chrome): the EmptyState recipe — "Access revoked", the server's
// reason, and "Pair again", which forgets this pairing and opens the pairing screen. A revoked device never retries on
// its own: the owner decided it should stop.
import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../../services/auth/AuthProvider';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { nouns } from '../../ui/platform/nouns';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';

type Href = Parameters<typeof router.replace>[0];

export default function RevokedScreen(): React.ReactElement {
  const { state, unpair } = useAuth();
  const [busy, setBusy] = useState(false);
  const n = nouns();
  const reason = state.status === 'revoked' && state.reason ? state.reason : `This ${n.device} was removed from the server.`;
  const again = (): void => {
    setBusy(true);
    void unpair()
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        router.replace('/pair' as Href);
      });
  };
  return (
    <Screen header={<Header role="detail" title="" />} scroll="none" testID="revoked">
      <View className="flex-1 justify-center gap-4 px-6">
        <EmptyState icon="lock" title="Access revoked" description={`${reason} To use the app again, pair it with a new code from the server.`} />
        <Button label="Pair again" size="lg" fullWidth loading={busy} onPress={again} testID="revoked-pair-again" />
      </View>
    </Screen>
  );
}
