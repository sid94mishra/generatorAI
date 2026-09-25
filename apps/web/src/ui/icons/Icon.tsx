// ────────────────────────────────────────────────────────────────
// P-01 Icon — the only way to draw a glyph (D-17, 03-component-inventory-kit).
//
// `<Icon concept="changes" size={14} />`. Sizes 12/14/16/20 (default 16),
// stroke 1.75 scaling with the 24 viewBox (no absoluteStrokeWidth). Colour
// inherits currentColor; tone it with a text utility (`text-fg-3`, `text-run`).
// With `label` the glyph is an image with that name; without, it is hidden
// from assistive tech (the surrounding control carries the name).
// ────────────────────────────────────────────────────────────────

import { ICON, type IconConcept, type IconSize } from '@generatorai/design-tokens';

import { ICON_REGISTRY } from './registry.js';

export interface IconProps {
  concept: IconConcept;
  /** px; 16 by default. */
  size?: IconSize;
  /** Accessible name. Omit for decorative glyphs. */
  label?: string;
  className?: string;
}

export function Icon({ concept, size = ICON.defaultSize, label, className }: IconProps) {
  const Glyph = ICON_REGISTRY[concept];
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <Glyph
      size={size}
      strokeWidth={ICON.strokeWidth}
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
      data-icon={concept}
      {...a11y}
    />
  );
}
