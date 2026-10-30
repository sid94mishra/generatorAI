// The composer's feedback through the kit: toasts only for problems and background notes (MD-26 / MD-58 — no
// success toasts; a success is announced to screen readers instead), haptic concepts (02 §7), announcements.
import { AccessibilityInfo } from 'react-native';

import { haptic } from '../../ui/platform/haptics';
import { toast } from '../../ui/primitives/Toast';

export type NotifyVariant = 'success' | 'info' | 'warning' | 'danger';
export type Notify = (options: { message: string; variant?: NotifyVariant; duration?: number }) => void;

export const notify: Notify = ({ message, variant, duration }) => {
  if (variant === 'success') {
    AccessibilityInfo.announceForAccessibility?.(message);
    return;
  }
  toast({ kind: variant === 'danger' || variant === 'warning' ? 'error' : 'background', message, ...(duration ? { durationMs: duration } : {}) });
};

export const haptics = {
  tap: (): void => haptic('selection'),
  select: (): void => haptic('selection'),
  success: (): void => haptic('success'),
  commit: (): void => haptic('success'),
  error: (): void => haptic('error'),
  warn: (): void => haptic('warning'),
};

export function announce(text: string): void {
  AccessibilityInfo.announceForAccessibility?.(text);
}
