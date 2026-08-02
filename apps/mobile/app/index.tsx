// ────────────────────────────────────────────────────────────────
// Entry route — hands off to the tab shell.
//
// Auth resolution, the pairing/revoked redirects, the error screen and push
// registration all live in `AuthGate` (app/_layout.tsx). They CANNOT live
// here: expo-router renders a matched route directly, so a screen reached by
// reload or deep link never passes through this file. Keeping the checks
// here left every other route unguarded — queries fired before the session
// was restored and each screen fell back to its empty state.
//
// By the time this renders the session is known-good.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';

import { useAuth } from '../src/auth/AuthProvider';
import { Spinner } from '../src/components/common/States';

export default function Index(): React.ReactElement {
  const { state } = useAuth();

  // `pairing` is the only non-terminal state that can still reach this route
  // (the gate lets it through so the enrolment spinner is not interrupted).
  if (state.status === 'pairing') {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner />
      </View>
    );
  }

  return <Redirect href="/(tabs)" />;
}
