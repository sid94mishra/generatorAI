// ────────────────────────────────────────────────────────────────
// Colour utilities.
//
// Deliberately dependency-free: this module is consumed by the web build
// (Vite), the mobile build (Metro) and a Node code-generator, so it must not
// assume a DOM, `Buffer`, or any package that ships CJS-only.
//
// Everything here operates on 8-bit sRGB with an optional alpha channel,
// which is exactly what both CSS custom properties and React Native style
// values accept.
// ────────────────────────────────────────────────────────────────

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
 *
 * The 8-digit form matters: the existing web tokens encode muted status
 * colours as `#23863626`, i.e. colour + alpha in one literal.
 */
export function parseHex(hex: string): Rgba {
  if (!HEX_RE.test(hex)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  let body = hex.slice(1);
  if (body.length === 3 || body.length === 4) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = Number.parseInt(body.slice(0, 2), 16);
  const g = Number.parseInt(body.slice(2, 4), 16);
  const b = Number.parseInt(body.slice(4, 6), 16);
  const a = body.length === 8 ? Number.parseInt(body.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

function toHexPair(n: number): string {
  return clamp255(n).toString(16).padStart(2, '0');
}

/** Serialize back to `#rrggbb`, or `#rrggbbaa` when alpha < 1. */
export function toHex({ r, g, b, a }: Rgba): string {
  const base = `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`;
  if (a >= 1) return base;
  return `${base}${toHexPair(a * 255)}`;
}

/** Serialize to `rgb(...)` / `rgba(...)`. React Native accepts both. */
export function toRgbaString({ r, g, b, a }: Rgba): string {
  if (a >= 1) return `rgb(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)})`;
  // 4 decimals is enough to round-trip an 8-bit alpha channel exactly.
  const alpha = Number.parseFloat(a.toFixed(4));
  return `rgba(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}, ${alpha})`;
}

/**
 * The precise equivalent of CSS `color-mix(in srgb, <colour> <p>%, transparent)`.
 *
 * Mixing against `transparent` in sRGB leaves the colour channels untouched
 * and scales alpha by `p`, so this is an exact substitution rather than an
 * approximation. That equality is what lets the mobile build ship literal
 * values while the web keeps its `color-mix()` authoring style.
 */
export function withAlpha(colour: string | Rgba, percent: number): Rgba {
  const c = typeof colour === 'string' ? parseHex(colour) : colour;
  return { ...c, a: c.a * (percent / 100) };
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG 2.1 contrast ratio, 1..21.
 *
 * Both arguments must be opaque — contrast against a translucent colour is
 * undefined without knowing what is behind it, and silently compositing
 * against an assumed backdrop is how "accessible" palettes end up failing in
 * the one place they matter.
 */
export function contrastRatio(fg: string | Rgba, bg: string | Rgba): number {
  const f = typeof fg === 'string' ? parseHex(fg) : fg;
  const b = typeof bg === 'string' ? parseHex(bg) : bg;
  if (f.a < 1 || b.a < 1) {
    throw new Error('contrastRatio requires opaque colours');
  }
  const lf = relativeLuminance(f);
  const lb = relativeLuminance(b);
  const [hi, lo] = lf > lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a translucent colour over an opaque backdrop (sRGB, non-linear). */
export function flatten(fg: string | Rgba, bg: string | Rgba): Rgba {
  const f = typeof fg === 'string' ? parseHex(fg) : fg;
  const b = typeof bg === 'string' ? parseHex(bg) : bg;
  return {
    r: f.r * f.a + b.r * (1 - f.a),
    g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a),
    a: 1,
  };
}
