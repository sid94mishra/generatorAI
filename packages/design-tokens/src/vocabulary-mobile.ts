// ────────────────────────────────────────────────────────────────
// The mobile-only class vocabulary (MD-70; mobile 02 §3.8).
//
// Concepts web does not have (`w-drawer`, `min-h-row-2`, `rounded-composer` …).
// Web never imports these names and no shared name changes for mobile (MD-12):
//   • emit/vocabulary.ts → css/vocabulary-mobile.css  (`@theme inline` → `--gai-*`)
//   • generated/vocabulary-mobile.json                (mobile lint, check:design)
//   • mobileTwMergeExtension()                        (apps/mobile ui/lib/cn.ts)
//
// A leaf like vocabulary.ts: it imports only that module.
// ────────────────────────────────────────────────────────────────

import { RADIUS_UTILITY_PREFIXES, twMergeExtension, type VocabularyNamespace } from './vocabulary.js';

export const MOBILE_TEXT_STEPS = ['detail-title', 'transcript', 'mono-lg', 'mono', 'mono-sm'] as const;
export type MobileTextStep = (typeof MOBILE_TEXT_STEPS)[number];

export const MOBILE_RADIUS_STEPS = ['seg-item', 'card-lg', 'group', 'nav', 'field', 'code', 'composer', 'new', 'toast'] as const;
export type MobileRadiusStep = (typeof MOBILE_RADIUS_STEPS)[number];

export const MOBILE_HEIGHT_NAMES = [
  'chip',
  'seg',
  'field',
  'search',
  'search-sm',
  'row-2',
  'bar-lg',
  'hit',
  'icon-button',
  'icon-button-sm',
  'new',
  'toast',
  'badge-sm',
] as const;
export type MobileHeightName = (typeof MOBILE_HEIGHT_NAMES)[number];

export const MOBILE_SIZE_NAMES = ['hit', 'icon-button', 'icon-button-sm'] as const satisfies readonly MobileHeightName[];
/** `min-w-hit`. */
export const MOBILE_WIDTH_NAMES = ['hit'] as const satisfies readonly MobileHeightName[];

export const MOBILE_CONTAINER_NAMES = ['drawer', 'pane'] as const;
export type MobileContainerName = (typeof MOBILE_CONTAINER_NAMES)[number];

export const MOBILE_SPACING_NAMES = ['gutter', 'gutter-title'] as const;
export type MobileSpacingName = (typeof MOBILE_SPACING_NAMES)[number];

export const MOBILE_SHADOW_NAMES = ['float'] as const;

/** Window-size classes (MD-24), emitted as literal `--breakpoint-*` (medium:, expanded:). */
export const MOBILE_BREAKPOINTS = { medium: 600, expanded: 840 } as const;

/** Shared utilities with no mobile meaning; the mobile design lint rejects them. */
export const MOBILE_BANNED_SHARED_UTILITIES = [
  'h-strip',
  'min-h-strip',
  'max-h-strip',
  'w-rail',
  'min-w-rail',
  'max-w-rail',
  'z-rail',
  'w-aside',
  'max-w-aside',
  'w-side-rail',
  'max-w-side-rail',
  'w-inspector',
  'max-w-inspector',
  'h-th', // use min-h-th: section labels grow with text
] as const;

const SPACING_PREFIXES = [
  'p', 'px', 'py', 'ps', 'pe', 'pt', 'pb',
  'm', 'mx', 'my', 'ms', 'me', 'mt', 'mb',
  'gap', 'gap-x', 'gap-y',
  'inset', 'start', 'end', 'top', 'bottom',
] as const;

export const MOBILE_VOCABULARY_NAMESPACES: readonly VocabularyNamespace[] = [
  { id: 'm-text', prefixes: ['text'], names: MOBILE_TEXT_STEPS },
  { id: 'm-radius', prefixes: RADIUS_UTILITY_PREFIXES, names: MOBILE_RADIUS_STEPS },
  { id: 'm-height', prefixes: ['h', 'min-h', 'max-h'], names: MOBILE_HEIGHT_NAMES },
  { id: 'm-size', prefixes: ['size'], names: MOBILE_SIZE_NAMES },
  { id: 'm-width', prefixes: ['min-w'], names: MOBILE_WIDTH_NAMES },
  { id: 'm-container', prefixes: ['w', 'min-w', 'max-w'], names: MOBILE_CONTAINER_NAMES },
  { id: 'm-spacing', prefixes: SPACING_PREFIXES, names: MOBILE_SPACING_NAMES },
  { id: 'm-shadow', prefixes: ['shadow'], names: MOBILE_SHADOW_NAMES },
];

/** The shape tailwind-merge's `extendTailwindMerge` takes, as plain data. */
export interface TwMergeExtensionData {
  extend: {
    theme: Record<string, string[]>;
    classGroups: Record<string, Array<Record<string, string[]>>>;
  };
}

/**
 * tailwind-merge v3 extension for mobile = the shared extension + the mobile
 * names (02 §3.8). Plain data, like `twMergeExtension()`.
 */
export function mobileTwMergeExtension(): TwMergeExtensionData {
  const { theme, classGroups } = twMergeExtension().extend;
  const heights = [...classGroups.h[0]!.h, ...MOBILE_HEIGHT_NAMES];
  return {
    extend: {
      theme: {
        ...theme,
        text: [...theme.text, ...MOBILE_TEXT_STEPS],
        radius: [...theme.radius, ...MOBILE_RADIUS_STEPS],
        shadow: [...theme.shadow, ...MOBILE_SHADOW_NAMES],
        container: [...theme.container, ...MOBILE_CONTAINER_NAMES],
        spacing: [...MOBILE_SPACING_NAMES],
      },
      classGroups: {
        ...classGroups,
        h: [{ h: heights }],
        'min-h': [{ 'min-h': heights }],
        'max-h': [{ 'max-h': heights }],
        size: [{ size: [...classGroups.size[0]!.size, ...MOBILE_SIZE_NAMES] }],
        'min-w': [{ 'min-w': [...MOBILE_WIDTH_NAMES] }],
      },
    },
  };
}
