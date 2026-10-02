// ML-19 KeyValueList contract (03 ML-19).
import type { ReactElement } from 'react';

export interface KeyValueItem {
  label: string;
  value: string | ReactElement;
  mono?: boolean;
  /** A "Copy <label>" control and accessibility action (string values only). */
  copyable?: boolean;
}

export interface KeyValueListProps {
  items: ReadonlyArray<KeyValueItem>;
  testID?: string;
}
