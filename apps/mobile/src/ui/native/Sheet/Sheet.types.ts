// ML-10 Sheet contract (03 ML-10; MD-21, MD-62, MD-85).
import type { ReactNode } from 'react';
import type { RemovalSource } from '../../layout/DirtyGuard/DirtyGuard.types';

export type SheetDetent = 'content' | 'medium' | 'large';

export interface SheetProps {
  title: string;
  subtitle?: string;
  /** Default ['medium', 'large'] (imperative sheets; route sheets take theirs from sheetOptions). */
  detents?: ReadonlyArray<SheetDetent>;
  initialDetent?: number;
  /** Dismiss attempts (drag, ✕, scrim, Back, Escape) ask "Discard changes?" while true. */
  dirty?: boolean;
  onDismiss: () => void;
  /** Selection sheets: a trailing text action ("Done"); never together with `footer` (MD-85). */
  headerAction?: { label: string; onPress: () => void; disabled?: boolean };
  /** In-sheet page back (MD-62): replaces ✕ with a back control named "Back to <label>". */
  back?: { label: string; onPress: () => void };
  /** Action sheets: SheetFooter content, sticky above the keyboard — one full-width lg primary (MD-85). */
  footer?: ReactNode;
  scrollable?: boolean;
  children: ReactNode;
  testID?: string;
}

/** A route sheet passes its navigation so router removal is guarded too. */
export interface RouteSheetProps extends SheetProps {
  navigation?: RemovalSource;
}

export interface SheetHeaderProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Android shows ✕ only on form sheets and full-height sheets; iOS always. */
  closable?: boolean;
  headerAction?: SheetProps['headerAction'];
  back?: SheetProps['back'];
  testID?: string;
}

export type PresentOptions = Omit<SheetProps, 'children' | 'onDismiss'> & { onDismiss?: () => void };

export interface SheetController {
  /** Shows content in the one imperative sheet; a second present replaces it (never stacked, MD-62). */
  present: (content: ReactNode, options: PresentOptions) => void;
  dismiss: () => void;
}
