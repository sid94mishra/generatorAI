// ────────────────────────────────────────────────────────────────
// P-01 Icon — the only way to draw a glyph (D-17, 03-component-inventory-kit).
//
// `<Icon concept="changes" size={14} />`. Sizes 12/14/16/20 (default 16),
// stroke 1.75 scaling with the 24 viewBox (no absoluteStrokeWidth). Colour
// inherits currentColor; tone it with a text utility (`text-fg-3`, `text-run`).
// With `label` the glyph is an image with that name; without, it is hidden
// from assistive tech (the surrounding control carries the name).
// Other SVG attributes (`data-testid`, `aria-*` …) pass through to the <svg>.
// ────────────────────────────────────────────────────────────────

import type { SVGProps } from 'react';
import { ICON, type IconConcept, type IconSize } from '@generatorai/design-tokens';

import { cn } from '../lib/cn.js';
import { ICON_REGISTRY } from './registry.js';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref' | 'children'> {
  concept: IconConcept;
  /** px; 16 by default. */
  size?: IconSize;
  /** Accessible name. Omit for decorative glyphs. */
  label?: string;
}

/** Draws one icon concept from the registry (D-17). Decorative unless `label` is given. */
export function Icon({ concept, size = ICON.defaultSize, label, className, ...rest }: IconProps) {
  const Glyph = ICON_REGISTRY[concept];
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <Glyph
      size={size}
      strokeWidth={ICON.strokeWidth}
      className={cn('shrink-0', className)}
      data-icon={concept}
      {...a11y}
      {...rest}
    />
  );
}
