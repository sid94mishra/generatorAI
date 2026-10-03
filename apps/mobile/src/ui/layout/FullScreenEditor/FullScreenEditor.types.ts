// ML-11 FullScreenEditor contract (03 ML-11; MD-21, MD-85).
import type { ReactElement, ReactNode } from 'react';
import type { RemovalSource } from '../DirtyGuard/DirtyGuard.types';

export interface FullScreenEditorProps {
  title: string;
  /** The header's text confirm ("Save", "Create", "Add"); the screen's one primary (MD-85: never filled). */
  /** Absent on a wizard whose own sticky bar carries the action (MAutomationCreate: Cancel only, MD-85). */
  primary?: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean };
  /** Default "Cancel" (iOS text; Android ✕ named "Cancel"). */
  cancelLabel?: string;
  onCancel: () => void;
  dirty: boolean;
  /** While dirty, the header carries the change count ("3 changes"; no tinted dirty bar, MD-25). */
  dirtyCount?: number;
  /** A wizard's Stepper (ML-21) under the header. */
  stepper?: ReactElement;
  /** A wizard's Back · Continue bar (ML-23), riding above the keyboard. */
  stickyBar?: ReactElement;
  /** `fixed`: the body does not scroll — a list (ReorderList, a canvas) owns scrolling and its own gutters. */
  body?: 'scroll' | 'fixed';
  /** Pass the screen's navigation so router removal is guarded too. */
  navigation?: RemovalSource;
  children: ReactNode;
  testID?: string;
}
