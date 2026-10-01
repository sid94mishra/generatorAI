import React, { lazy, Suspense } from 'react';
import { Redirect } from 'expo-router';

const DevelopmentStories = lazy(() => import('../../../.rnstorybook/Screen'));
export default function StorybookScreen(): React.ReactElement {
  return __DEV__ && process.env.EXPO_PUBLIC_STORYBOOK === '1'
    ? <Suspense fallback={null}><DevelopmentStories /></Suspense>
    : <Redirect href="/" />;
}
