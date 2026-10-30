// "Page not found" (04 §1.2, desktop R-6 parity): a link or a stale route that matches no screen lands here, with
// one way back Home. Copy matches web's NotFoundPage.
import React from 'react';
import { router } from 'expo-router';

import { Header } from '../../ui/native/router/Header';
import { Screen } from '../../ui/layout/Screen';
import { EmptyState } from '../../ui/primitives/EmptyState';

const goHome = (): void => {
  if (router.canDismiss()) router.dismissAll();
  router.replace('/');
};

export default function NotFoundScreen(): React.ReactElement {
  return (
    <Screen header={<Header role="detail" title="Page not found" onBack={goHome} />} scroll="none" testID="not-found">
      <EmptyState
        icon="info"
        title="Page not found"
        description="There is nothing at this address. It may have moved, or the link is wrong."
        action={{ label: 'Go home', icon: 'home', onPress: goHome }}
      />
    </Screen>
  );
}
