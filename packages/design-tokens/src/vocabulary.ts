// ────────────────────────────────────────────────────────────────
// The shared class vocabulary (D-08, M-02; 02 §10.2).
//
// One list of design names drives every consumer, so they cannot drift:
//   • emit/vocabulary.ts → css/vocabulary.css  (`@theme inline` that maps each
//     name to its `--gai-*` variable; imported by web now, by mobile's Uniwind
//     CSS in the next pass)
//   • generated/vocabulary.json               (the same lists for Node tools
//     that cannot import TypeScript: the CSS-emission check, the design-system
//     ratchet, ESLint)
//   • REQUIRED_UTILITIES / LEGACY_UTILITY_NAMES (09 §2.1, §2.4)
//
// This module is a leaf: it imports nothing, so the emitters and the root
// index can both depend on it without an import cycle.
// ────────────────────────────────────────────────────────────────

/** Design colour names → `--color-<name>: var(--gai-<name>)` (02 §2.3). */
export const COLOR_NAMES = [
  'ground',
  'surface',
  'raised',
  'overlay',
  'sunken',
  'hover',
  'selected',
  'line-soft',
  'line',
  'line-strong',
  'fg',
  'fg-2',
  'fg-3',
  'accent',
  'on-accent',
  'focus',
  'run',
  'run-bg',
  'ok',
  'ok-bg',
  'warn',
  'warn-bg',
  'err',
  'err-bg',
  'add-bg',
  'del-bg',
  'scrim',
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

/**
 * `text-<status>` resolves to the AA-safe text value, `bg-<status>` (and every
 * other colour utility) to the hue: Tailwind reads `--text-color-*` before
 * `--color-*` for `text-*` only.
 */
export const TEXT_COLOR_OVERRIDES = {
  run: 'run-text',
  ok: 'ok-text',
  warn: 'warn-text',
  err: 'err-text',
} as const satisfies Partial<Record<ColorName, string>>;

/** `shadow-pop` is the only shadow (02 §6.4). */
export const SHADOW_NAMES = ['pop'] as const;

/** Type steps (D-13, 02 §5.2): `text-micro … text-display`. */
export const TEXT_STEPS = ['micro', 'small', 'ui', 'body', 'title', 'heading', 'display'] as const;
export type TextStep = (typeof TEXT_STEPS)[number];

/** Radius steps (D-14, 02 §6.1): `rounded-badge … rounded-dialog`. */
export const RADIUS_STEPS = ['badge', 'control-sm', 'control', 'seg', 'card', 'panel', 'dialog'] as const;
export type RadiusStep = (typeof RADIUS_STEPS)[number];

/** Density-driven heights (D-15, 02 §6.3): `h-*`, `min-h-*`, `max-h-*`. */
export const HEIGHT_NAMES = [
  'control-sm',
  'control',
  'control-lg',
  'nav',
  'item',
  'step',
  'th',
  'row',
  'tab',
  'bar',
  'badge',
  'kbd',
  'panel-bar',
  'dialog-bar',
  'footer',
  // Windows / Linux-custom title strip (D-23): fixed, never density-shrunk.
  'strip',
] as const;
export type HeightName = (typeof HEIGHT_NAMES)[number];

/** Square sizes (`size-control` …): the three control heights. */
export const SIZE_NAMES = ['control-sm', 'control', 'control-lg'] as const satisfies readonly HeightName[];

/** Z layers (D-41, 02 §6.5): `z-base … z-tooltip`. */
export const Z_NAMES = ['base', 'sticky', 'dock', 'rail', 'sidebar', 'dialog', 'dropdown', 'popover', 'toast', 'tooltip'] as const;
export type ZName = (typeof Z_NAMES)[number];

/** Shell widths (D-15, 02 §8): `w-sidebar`, `max-w-dialog` … via `--container-*`. */
export const CONTAINER_NAMES = ['sidebar', 'rail', 'dock', 'dock-run', 'sheet', 'dialog-sm', 'dialog', 'dialog-lg'] as const;
export type ContainerName = (typeof CONTAINER_NAMES)[number];

/** Easing curves: `ease-standard`. */
export const EASE_NAMES = ['standard'] as const;

/** Every side/corner form of `rounded-*`. */
export const RADIUS_UTILITY_PREFIXES = [
  'rounded',
  ...['s', 'e', 't', 'r', 'b', 'l', 'ss', 'se', 'ee', 'es', 'tl', 'tr', 'br', 'bl'].map((side) => `rounded-${side}`),
] as const;

/**
 * Shared tokens: neither legacy nor design-named, and they survive P7
 * (02 §2.3 "Kept tokens"). Bridged to their unprefixed raw variables.
 */
export const SHARED_COLOR_NAMES = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'canvas-bg',
  'canvas-dot',
] as const;

/**
 * The legacy colour bridge (D-06): `--color-<name>: var(--<name>)` in the
 * generated legacy `@theme inline` block of globals.css. Deleted in P7.
 * Collisions with the design vocabulary were renamed in P1-T1 (02 §3):
 * `accent` → `accent-tint`; `surface`, `surface-hover`, `raised`, `overlay`,
 * `accent-foreground` are not bridged.
 */
export const LEGACY_COLOR_NAMES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'subtle',
  'emphasis',
  'primary',
  'primary-emphasis',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent-tint',
  'destructive',
  'destructive-foreground',
  'border',
  'border-muted',
  'input',
  'ring',
  'success',
  'success-muted',
  'warning',
  'warning-muted',
  'info',
  'info-muted',
  'danger',
  'danger-muted',
  'done',
  'sidebar',
  'sidebar-foreground',
  'sidebar-border',
  'sidebar-accent',
  'sidebar-accent-foreground',
] as const;

/** Raw variable behind a legacy bridge name, where it differs from the name. */
export const LEGACY_BRIDGE_SOURCE: Partial<Record<(typeof LEGACY_COLOR_NAMES)[number], string>> = {
  'accent-tint': 'accent',
};

/**
 * Legacy semantic utility names: the ratchet's `legacyTokenUtility` rule and
 * the new-code ESLint restriction match `<prefix>-<name>` for these (09 §2.1).
 */
export const LEGACY_UTILITY_NAMES: readonly string[] = LEGACY_COLOR_NAMES;

/** Utility prefixes that take a colour name. */
export const COLOR_UTILITY_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'outline',
  'fill',
  'stroke',
  'divide',
  'from',
  'via',
  'to',
  'shadow',
  'accent',
  'caret',
  'decoration',
  'placeholder',
] as const;

/** One namespace of the vocabulary: every `<prefix>-<name>` is a design utility. */
export interface VocabularyNamespace {
  id: string;
  prefixes: readonly string[];
  names: readonly string[];
}

export const VOCABULARY_NAMESPACES: readonly VocabularyNamespace[] = [
  { id: 'color', prefixes: COLOR_UTILITY_PREFIXES, names: COLOR_NAMES },
  { id: 'text-color', prefixes: ['text'], names: Object.keys(TEXT_COLOR_OVERRIDES) },
  { id: 'shadow', prefixes: ['shadow'], names: SHADOW_NAMES },
  { id: 'text', prefixes: ['text'], names: TEXT_STEPS },
  { id: 'radius', prefixes: RADIUS_UTILITY_PREFIXES, names: RADIUS_STEPS },
  { id: 'height', prefixes: ['h', 'min-h', 'max-h'], names: HEIGHT_NAMES },
  { id: 'size', prefixes: ['size'], names: SIZE_NAMES },
  { id: 'z', prefixes: ['z'], names: Z_NAMES },
  { id: 'container', prefixes: ['w', 'min-w', 'max-w'], names: CONTAINER_NAMES },
  { id: 'ease', prefixes: ['ease'], names: EASE_NAMES },
];

/**
 * At least one utility per design namespace (09 §2.4). The build must emit each
 * as a selector whose declaration reads a `--gai-*` variable; globals.css
 * safelists them (`@source inline`) so the check does not depend on usage.
 */
export const REQUIRED_UTILITIES = [
  'bg-ground',
  'bg-surface',
  'bg-raised',
  'bg-overlay',
  'bg-sunken',
  'bg-hover',
  'bg-selected',
  'border-line',
  'border-line-soft',
  'border-line-strong',
  'text-fg',
  'text-fg-2',
  'text-fg-3',
  'bg-accent',
  'text-on-accent',
  'outline-focus',
  'bg-run',
  'text-run',
  'bg-run-bg',
  'text-ok',
  'text-warn',
  'text-err',
  'bg-add-bg',
  'bg-del-bg',
  'shadow-pop',
  'bg-scrim',
  'text-micro',
  'text-small',
  'text-ui',
  'text-body',
  'text-title',
  'text-heading',
  'text-display',
  'rounded-badge',
  'rounded-control-sm',
  'rounded-control',
  'rounded-seg',
  'rounded-card',
  'rounded-panel',
  'rounded-dialog',
  'h-control-sm',
  'h-control',
  'h-control-lg',
  'h-bar',
  'h-tab',
  'h-row',
  'h-nav',
  'size-control',
  'z-dialog',
  'z-tooltip',
  'w-sidebar',
  'max-w-dialog',
  'ease-standard',
] as const;

/**
 * The tailwind-merge v3 extension for the design vocabulary (D-09, 02 §10.3).
 * `apps/web/src/ui/lib/cn.ts` passes it to `extendTailwindMerge` at runtime,
 * so a name added above is merged correctly without touching the web app:
 *   • `text-title` is a SIZE (theme `text`), so `cn('text-fg-2', 'text-title')`
 *     keeps both — v2 read every unknown `text-*` as a colour and dropped one;
 *   • `h-row`, `size-control`, `z-dialog` join their default groups, so a later
 *     `h-full` / `size-4` / `z-10` replaces them instead of both surviving.
 * Returned as plain data (no tailwind-merge import) to keep this module a leaf.
 */
export function twMergeExtension() {
  return {
    extend: {
      theme: {
        color: [...COLOR_NAMES, ...SHARED_COLOR_NAMES, ...LEGACY_COLOR_NAMES],
        text: [...TEXT_STEPS],
        radius: [...RADIUS_STEPS],
        shadow: [...SHADOW_NAMES],
        container: [...CONTAINER_NAMES],
        ease: [...EASE_NAMES],
      },
      classGroups: {
        h: [{ h: [...HEIGHT_NAMES] }],
        'min-h': [{ 'min-h': [...HEIGHT_NAMES] }],
        'max-h': [{ 'max-h': [...HEIGHT_NAMES] }],
        size: [{ size: [...SIZE_NAMES] }],
        z: [{ z: [...Z_NAMES] }],
      },
    },
  };
}
