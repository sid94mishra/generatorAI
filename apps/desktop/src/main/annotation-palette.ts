// ────────────────────────────────────────────────────────────────
// Validation of the native-browser overlay palette (06 §4.4).
//
// The renderer sends the palette for the annotation, element-picker and
// region-capture overlays; main interpolates it into scripts it runs in
// third-party pages. Nothing unchecked may reach `executeJavaScript`, so every
// value must be a plain `#rrggbb` (or, for the shadow, a compact `rgba()`)
// literal. Anything else — a missing, partial or non-object palette — falls
// back to the default theme's dark palette as a whole, never key by key, so a
// half-valid palette cannot mix two themes.
// ────────────────────────────────────────────────────────────────

import { annotationPalette, DEFAULT_THEME, type AnnotationPalette } from '@generatorai/design-tokens';

export type { AnnotationPalette };

/** The palette used whenever the renderer sends none or an invalid one. */
export const DEFAULT_ANNOTATION_PALETTE: Readonly<AnnotationPalette> = Object.freeze(annotationPalette(DEFAULT_THEME, 'dark'));

const HEX6 = /^#[0-9a-f]{6}$/i;
const RGBA = /^rgba\(\d{1,3},\d{1,3},\d{1,3},(0|1|0?\.\d+)\)$/;

const COLOUR_KEYS = [
  'accent',
  'onAccent',
  'done',
  'bg',
  'panel',
  'text',
  'sub',
  'border',
  'input',
  'danger',
] as const satisfies ReadonlyArray<Exclude<keyof AnnotationPalette, 'shadow'>>;

/**
 * Return a palette containing exactly the known keys when every one is valid,
 * else a copy of `DEFAULT_ANNOTATION_PALETTE`. Extra keys are dropped.
 */
export function sanitizeAnnotationPalette(input: unknown): AnnotationPalette {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ...DEFAULT_ANNOTATION_PALETTE };
  const record = input as Record<string, unknown>;
  const out = {} as AnnotationPalette;
  for (const key of COLOUR_KEYS) {
    const value = record[key];
    if (typeof value !== 'string' || !HEX6.test(value)) return { ...DEFAULT_ANNOTATION_PALETTE };
    out[key] = value;
  }
  const shadow = record.shadow;
  if (typeof shadow !== 'string' || !RGBA.test(shadow)) return { ...DEFAULT_ANNOTATION_PALETTE };
  out.shadow = shadow;
  return out;
}
