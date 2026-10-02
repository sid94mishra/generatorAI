// ML-02 Header — Android (03 ML-02; MD-86): the native-stack header is hidden and the JS M3 top app bar
// (src/ui/layout/TopAppBar) renders at the top of the screen.
import React from 'react';
import { Stack } from 'expo-router';

import { TopAppBar } from '../../../layout/TopAppBar';
import type { HeaderProps } from './Header.types';

export type { HeaderAction, HeaderProps, HeaderRole } from './Header.types';

export function Header(props: HeaderProps): React.ReactElement {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TopAppBar {...props} />
    </>
  );
}
