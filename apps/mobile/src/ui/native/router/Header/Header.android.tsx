// ML-02 Header — Android (03 ML-02; MD-86): the native-stack header is hidden and the JS M3 top app bar
// (src/ui/layout/TopAppBar) renders at the top of the screen.
import React from 'react';
import { Stack } from 'expo-router';

import { TopAppBar } from '../../../layout/TopAppBar';
import type { HeaderProps } from './Header.types';

export type { HeaderAction, HeaderProps, HeaderRole } from './Header.types';

/** One object for every render: a fresh literal would re-apply the navigator options on each render (MD-162). */
const HIDDEN = { headerShown: false } as const;

export function Header(props: HeaderProps): React.ReactElement {
  return (
    <>
      <Stack.Screen options={HIDDEN} />
      <TopAppBar {...props} />
    </>
  );
}
