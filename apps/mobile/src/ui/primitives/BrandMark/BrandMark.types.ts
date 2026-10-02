// MP-52 BrandMark contract (03 MP-52).
import type { HarnessProviderId } from '@generatorai/shared';

export type BrandMarkKind = 'app' | 'github' | HarnessProviderId;
export type BrandMarkSize = 16 | 20 | 22 | 26 | 36;

export interface BrandMarkProps {
  mark: BrandMarkKind;
  /** Default 20. */
  size?: BrandMarkSize;
  /** Present → an image with this name; absent → decorative. */
  label?: string;
  testID?: string;
}
