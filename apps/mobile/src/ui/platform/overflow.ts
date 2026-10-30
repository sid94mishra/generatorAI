// The overflow glyph per OS (03 ML-02, MB-22 rows): iOS ⋯ (`more`), Android ⋮ (`more-vertical`).
import type { MobileIconConcept } from '@generatorai/design-tokens';

import { nativePlatform, type NativePlatform } from './geometry';

export function overflowIconFor(platform: NativePlatform): MobileIconConcept {
  return platform === 'android' ? 'more-vertical' : 'more';
}

export const overflowIcon: MobileIconConcept = overflowIconFor(nativePlatform);
