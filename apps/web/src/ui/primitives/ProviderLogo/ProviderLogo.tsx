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
//
// `mark` draws a server-supplied `ProviderMark` instead (an ACP agent's
// registry icon, sanitised by the server to `{viewBox, nodes}`, ACP-5): its
// nodes become plain SVG elements — only the allow-listed tags and
// attributes are rendered (a second gate after the server's), never markup,
// never a URL. A mark is monochrome: it always draws in the text colour.
// ────────────────────────────────────────────────────────────────

import { createElement, type ComponentProps, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { providerLogo } from '@generatorai/design-tokens';
import type { ProviderMark, ProviderMarkNode } from '@generatorai/shared';
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
  /** A server-supplied mark (an ACP agent's icon); absent = the registry mark of `provider`. */
  mark?: ProviderMark | undefined;
}

/** Elements a mark may contain (ProviderMarkTag); anything else is not rendered. */
const MARK_TAGS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);

/** Mark attribute (SVG name) → React prop. Anything not listed is not rendered. */
const MARK_ATTRS: Record<string, string> = {
  d: 'd',
  cx: 'cx',
  cy: 'cy',
  r: 'r',
  rx: 'rx',
  ry: 'ry',
  x: 'x',
  y: 'y',
  width: 'width',
  height: 'height',
  x1: 'x1',
  y1: 'y1',
  x2: 'x2',
  y2: 'y2',
  points: 'points',
  fill: 'fill',
  stroke: 'stroke',
  opacity: 'opacity',
  transform: 'transform',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'fill-opacity': 'fillOpacity',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-opacity': 'strokeOpacity',
};

/** Paint a mark may use: the text colour or nothing — never a colour of its own. */
const MARK_PAINT = new Set(['currentColor', 'none', 'inherit']);

function markNodes(nodes: readonly ProviderMarkNode[] | undefined, depth = 0): ReactNode[] {
  // Same depth bound as the server's parser keeps a hostile payload from recursing without end.
  if (!nodes || depth > 32) return [];
  return nodes.flatMap((node, i) => {
    if (!MARK_TAGS.has(node.tag)) return [];
    const props: Record<string, string | number> = { key: i };
    for (const [name, value] of Object.entries(node.attrs ?? {})) {
      const prop = Object.prototype.hasOwnProperty.call(MARK_ATTRS, name) ? MARK_ATTRS[name] : undefined;
      if (!prop || typeof value !== 'string') continue;
      if ((prop === 'fill' || prop === 'stroke') && !MARK_PAINT.has(value)) continue;
      props[prop] = value;
    }
    return [createElement(node.tag, props, ...(node.tag === 'g' ? markNodes(node.children, depth + 1) : []))];
  });
}

/** The brand mark of an agent provider. */
export function ProviderLogo({ provider, size = 16, variant = 'color', label, mark, className, ...rest }: ProviderLogoProps) {
  const logo = providerLogo(provider);
  const name = label === true ? logo.title : label;
  const a11y = name ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true as const };
  if (mark && typeof mark.viewBox === 'string' && Array.isArray(mark.nodes)) {
    return (
      <svg
        viewBox={mark.viewBox}
        fill="currentColor"
        focusable="false"
        data-provider={provider}
        data-variant={variant}
        data-mark=""
        className={cn(providerLogoVariants({ size }), className)}
        {...a11y}
        {...rest}
      >
        {markNodes(mark.nodes)}
      </svg>
    );
  }
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
