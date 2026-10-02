// MP-49 Popover contract (03 MP-49): only where a native Menu cannot host the content (slash / mention suggestions).
import type { ReactNode, RefObject } from 'react';
import type { View } from 'react-native';

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'composer': above the composer (the Popover is rendered inside the composer's container); or a view to anchor to
   * (measured relative to the Popover's container, which must contain it). */
  anchor: 'composer' | RefObject<View | null>;
  /** Default 'top'. */
  placement?: 'top' | 'bottom';
  children: ReactNode;
  /** "Suggestions" — read with the result count when given. */
  accessibilityLabel: string;
  /** Announced when it changes ("4 results"). */
  resultCount?: number;
  testID?: string;
}
