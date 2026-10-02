// ML-24 FactStrip contract (03 ML-24).
import type { ReactElement } from 'react';

export interface Fact {
  label: string;
  /** A StatusBadge, or text (mono 14/500 when `mono`). */
  value: string | ReactElement;
  mono?: boolean;
}

export interface FactStripProps {
  /** 2–4 facts. */
  facts: ReadonlyArray<Fact>;
  testID?: string;
}
