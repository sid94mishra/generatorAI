// ────────────────────────────────────────────────────────────────
// ProviderLogo — an agent provider's brand mark (D-132).
//
// Draws the mark of `provider` from the one registry
// (`PROVIDER_LOGOS`, packages/design-tokens/src/provider-logos.ts); an id the
// registry does not know gets the neutral mark, never another vendor's logo.
// Sizes follow the icon scale (12 · 14 · 16 · 20) plus 24 for a provider tile.
//
// `color` (default) uses the brand colour where the brand has one (Claude's
// orange) and the text colour for monochrome brands (OpenAI, GitHub, OpenCode),
// so every mark reads on every theme. `mono` always draws in the text colour —
// for a selected row or a tinted context that recolours its contents.
//
// Decorative by default (the provider's name is written next to it); pass
// `label` (or `label` = true for the brand's own name) to make it an image.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cva } from 'class-variance-authority';
import { providerLogo } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';

export type ProviderLogoSize = 12 | 14 | 16 | 20 | 24;

const providerLogoVariants = cva('inline-block shrink-0', {
  variants: {
    size: {
      12: 'size-3',
      14: 'size-3.5',
      16: 'size-4',
      20: 'size-5',
      24: 'size-6',
    },
  },
  defaultVariants: { size: 16 },
});

export interface ProviderLogoProps extends Omit<ComponentProps<'svg'>, 'children' | 'fill' | 'viewBox'> {
  /** Provider id (`claude-agent`, `codex`, `copilot`, `opencode`, `acp`, `faux` …). */
  provider: string;
  size?: ProviderLogoSize;
  /** `color`: brand colour where the brand has one. `mono`: always the text colour. */
  variant?: 'color' | 'mono';
  /** Accessible name. `true` = the brand's name from the registry; absent = decorative. */
  label?: string | true;
}

/** The brand mark of an agent provider. */
export function ProviderLogo({ provider, size = 16, variant = 'color', label, className, ...rest }: ProviderLogoProps) {
  const logo = providerLogo(provider);
  const name = label === true ? logo.title : label;
  const a11y = name ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true as const };
  const fill = variant === 'color' && logo.brandColor ? logo.brandColor : 'currentColor';
  return (
    <svg
      viewBox={logo.viewBox}
      fill={fill}
      focusable="false"
      data-provider={provider}
      data-variant={variant}
      className={cn(providerLogoVariants({ size }), className)}
      {...a11y}
      {...rest}
    >
      {logo.paths.map((path) => (
        <path key={path.d.slice(0, 24)} d={path.d} fillRule={path.fillRule} clipRule={path.fillRule} />
      ))}
    </svg>
  );
}
