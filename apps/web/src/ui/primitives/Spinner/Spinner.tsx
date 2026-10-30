// ────────────────────────────────────────────────────────────────
// P-12 Spinner — the Running glyph (`loader` → loader-circle) turning once a
// second (03 §2 P-12, D-20). The only spinner in the design. It stops under the
// "Reduce motion" setting / OS preference (`reduced:` variant + the global
// reduced-motion rule). Colour inherits; callers tone it (`text-run`).
// ────────────────────────────────────────────────────────────────

import type { IconSize } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon, type IconProps } from '../../icons/Icon.js';

export interface SpinnerProps extends Omit<IconProps, 'concept' | 'size'> {
  size?: Extract<IconSize, 12 | 14 | 16>;
  /** Accessible name ("Loading"). Omit when the surrounding control already says it. */
  label?: string;
}

/** Busy indicator: the rotating Running glyph. Decorative unless `label` is given. */
export function Spinner({ size = 16, label, className, ...rest }: SpinnerProps) {
  return (
    <Icon
      concept="loader"
      size={size}
      className={cn('animate-spin reduced:animate-none', className)}
      label={label}
      {...rest}
    />
  );
}
