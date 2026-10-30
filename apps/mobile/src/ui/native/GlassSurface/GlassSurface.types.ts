// MP-38 GlassSurface contract (03 MP-38; 02 §8.2; MD-72). iOS floating chrome only.
import type { ReactNode } from 'react';

export type GlassRadiusStep = 'composer' | 'new' | 'toast' | 'full';

export interface GlassSurfaceProps {
  /** Radius from tokens, never a number. */
  radiusStep: GlassRadiusStep;
  /** GlassView isInteractive: buttons, NewAction, the ↓ Latest pill. */
  interactive?: boolean;
  /** Documents the merge group; neighbours merge when wrapped in one <GlassGroup>. */
  group?: string;
  /** Layout and padding only. */
  className?: string;
  children?: ReactNode;
  testID?: string;
}

export interface GlassGroupProps {
  children: ReactNode;
  className?: string;
}
