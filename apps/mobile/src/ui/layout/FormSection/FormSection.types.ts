// ML-22 FormSection contract (03 ML-22; MD-68).
import type { ReactNode } from 'react';

export interface FormSectionProps {
  title: string;
  hint?: string;
  children: ReactNode;
  /** grouped: fields in one inset group (iOS default; use Input presentation="row") · stacked: outlined fields with
   * gap 16 (Android default). */
  variant?: 'grouped' | 'stacked';
  testID?: string;
}
