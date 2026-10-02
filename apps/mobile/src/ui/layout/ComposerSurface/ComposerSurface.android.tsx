// Android composer surface (MD-03): a tonal `raised` card with a 1px `line-soft` border, radius 28.
import React from 'react';
import { View } from 'react-native';

import type { ComposerSurfaceProps } from './ComposerSurface.types';

export function ComposerSurface({ children, testID }: ComposerSurfaceProps): React.ReactElement {
  return (
    <View testID={testID} className="mx-3 mb-2 mt-2 gap-2 rounded-composer border border-line-soft bg-raised pb-2 pe-2 ps-4 pt-3">
      {children}
    </View>
  );
}
