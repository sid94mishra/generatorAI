// MP-47 Collapsible contract (03 MP-47).
import type { ReactNode } from 'react';

export interface CollapsibleProps {
  /** Controlled. */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  header: ReactNode;
  children: ReactNode;
  accessibilityLabel: string;
  testID?: string;
}
