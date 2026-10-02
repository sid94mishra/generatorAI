// ML-13 ListRow contract (03 ML-13; MD-49, MD-59, MD-30).
import type { ReactElement, ReactNode } from 'react';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { SegmentedControlProps } from '../../native/SegmentedControl/SegmentedControl.types';
import type { SelectProps } from '../../native/Select/Select.types';
import type { NumberFieldProps } from '../../primitives/NumberField/NumberField.types';
import type { RowPosition } from '../ListSection/ListSection.types';

export type ListRowKind =
  | 'navigation'
  | 'toggle'
  | 'value'
  | 'info'
  | 'picker'
  | 'radio'
  | 'check'
  | 'stepper'
  | 'segmented'
  | 'destructive'
  | 'link'
  | 'requires-admin';

export interface ListRowProps {
  kind: ListRowKind;
  title: string;
  subtitle?: string;
  icon?: MobileIconConcept;
  value?: string;
  mono?: boolean;
  /** radio / check */
  selected?: boolean;
  /** toggle */
  switchValue?: boolean;
  /** toggle (and check, with the next value) */
  onValueChange?: (v: boolean) => void;
  /** picker: the row is the Select (its label = title). */
  picker?: Omit<SelectProps, 'label' | 'presentation'>;
  stepper?: Omit<NumberFieldProps, 'label'>;
  segmented?: Omit<SegmentedControlProps<string>, 'accessibilityLabel'>;
  /** "Changed ↶" chip (MAgentPickerCaps), "This device" tag (MD-30). */
  provenance?: ReactNode;
  /** Badge / StatusBadge before the trailing part. */
  badge?: ReactElement;
  onPress?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  /** iOS group corners when rows are rendered by a virtualised list (no wrapping ListSection). */
  position?: RowPosition;
  /** value / info: long-press (and an accessibility action) copies the value. */
  copyable?: boolean;
  testID?: string;
}
