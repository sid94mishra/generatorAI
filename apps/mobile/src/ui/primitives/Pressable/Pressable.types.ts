// MP-03 Pressable contract (03 MP-03).
import type { ReactNode } from 'react';
import type { AccessibilityRole, AccessibilityState } from 'react-native';
import type { HapticConcept } from '@generatorai/design-tokens';

export type PressFeedback = 'scale' | 'highlight' | 'none';

export interface PressableProps {
  onPress?: () => void;
  /** Must also exist as a menu item / accessibilityAction (03 §1.6.5). */
  onLongPress?: () => void;
  /** Default 400. */
  delayLongPress?: number;
  disabled?: boolean;
  /** Appended to accessibilityHint. */
  disabledReason?: string;
  /** Default 'highlight'. iOS scales or highlights; Android always ripples (02 §6.2). */
  feedback?: PressFeedback;
  /** `selection` fires on press-in; every other concept on press. */
  haptic?: HapticConcept;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  accessibilityActions?: ReadonlyArray<{ name: string; label: string }>;
  onAccessibilityAction?: (name: string) => void;
  /** Last resort only; each use is listed in e2e/a11y-allow.json (MD-91). */
  hitSlop?: number;
  /** 'hit' (default) grows the frame to the platform hit target (MD-91); 'none' for rows already ≥ the target. */
  frame?: 'hit' | 'none';
  /** Large surfaces press to 0.985 instead of 0.97 (02 §6.2). */
  large?: boolean;
  /** Android ripple without bounds (icon buttons). */
  borderless?: boolean;
  className?: string;
  testID?: string;
  children: ReactNode;
}
