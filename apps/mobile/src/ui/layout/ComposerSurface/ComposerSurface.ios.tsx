// iOS composer surface (MD-03): the glass capsule (GlassSurface `composer` radius 28) with the opaque fallback.
import React from 'react';

import { GlassSurface } from '../../native/GlassSurface';
import type { ComposerSurfaceProps } from './ComposerSurface.types';

export function ComposerSurface({ children, testID }: ComposerSurfaceProps): React.ReactElement {
  return (
    <GlassSurface radiusStep="composer" className="mx-3 mt-2 gap-2 pb-2 pe-3 ps-4 pt-3" testID={testID}>
      {children}
    </GlassSurface>
  );
}
