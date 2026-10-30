// ────────────────────────────────────────────────────────────────
// Vocabulary emitters (02 §10.2, 09 §2.4/§2.6).
//
//   css/vocabulary.css         `@theme inline` mapping design names to
//                              `--gai-*` variables. Platform-neutral: it holds
//                              no values, each platform supplies the variables
//                              (web: globals.css; mobile, next pass: Uniwind).
//   generated/vocabulary.json  the same name lists for Node tools that cannot
//                              import TypeScript (check-css-emission, the
//                              design-system ratchet, eslint.config.mjs).
//   css/vocabulary-mobile.css  mobile-only names (MD-70; mobile 02 §9.4),
//                              imported by apps/mobile's Uniwind global.css
//                              after vocabulary.css; web never imports it.
//   generated/vocabulary-mobile.json  the mobile lists for the mobile lint.
// ────────────────────────────────────────────────────────────────

import { HEIGHTS, TYPE_SCALE } from '../design.js';
import {
  CONTAINER_NAMES,
  DURATION_NAMES,
  EASE_NAMES,
  RADIUS_STEPS,
  SIZE_NAMES,
  Z_NAMES,
  COLOR_NAMES,
  LEGACY_UTILITY_NAMES,
  REQUIRED_UTILITIES,
  SHADOW_NAMES,
  SHARED_COLOR_NAMES,
  TEXT_COLOR_OVERRIDES,
  VOCABULARY_NAMESPACES,
} from '../vocabulary.js';
import {
  MOBILE_BANNED_SHARED_UTILITIES,
  MOBILE_BREAKPOINTS,
  MOBILE_CONTAINER_NAMES,
  MOBILE_HEIGHT_NAMES,
  MOBILE_RADIUS_STEPS,
  MOBILE_SHADOW_NAMES,
  MOBILE_SIZE_NAMES,
  MOBILE_SPACING_NAMES,
  MOBILE_TEXT_STEPS,
  MOBILE_VOCABULARY_NAMESPACES,
  MOBILE_WIDTH_NAMES,
} from '../vocabulary-mobile.js';

const HEADER = '/* GENERATED from packages/design-tokens (src/vocabulary.ts) — do not edit. Regenerate with `pnpm tokens:write`. */';

export function emitVocabularyCss(): string {
  const lines = [HEADER, '@theme inline {', '  /* Colour (02 §2.3). */'];
  for (const name of COLOR_NAMES) lines.push(`  --color-${name}: var(--gai-${name});`);
  lines.push('', '  /* text-<status> is the AA-safe text value; bg-/border-/fill-<status> stay the hue. */');
  for (const [name, variable] of Object.entries(TEXT_COLOR_OVERRIDES)) {
    lines.push(`  --text-color-${name}: var(--gai-${variable});`);
  }
  lines.push('', '  /* Elevation (02 §6.4). */');
  for (const name of SHADOW_NAMES) lines.push(`  --shadow-${name}: var(--gai-shadow-${name});`);
  lines.push('', '  /* Type (D-13). Weight and tracking only where a step sets them, so other steps inherit. */');
  for (const [step, t] of Object.entries(TYPE_SCALE)) {
    lines.push(`  --text-${step}: var(--gai-text-${step});`);
    lines.push(`  --text-${step}--line-height: var(--gai-leading-${step});`);
    if (t.weight !== 400) lines.push(`  --text-${step}--font-weight: var(--gai-weight-${step});`);
    if (t.tracking !== 0) lines.push(`  --text-${step}--letter-spacing: var(--gai-tracking-${step});`);
  }
  lines.push('', '  /* Radius (D-14), per theme. */');
  for (const step of RADIUS_STEPS) lines.push(`  --radius-${step}: var(--gai-radius-${step});`);
  lines.push('', '  /* Heights (D-15), per density. */');
  for (const name of Object.keys(HEIGHTS.comfortable)) lines.push(`  --height-${name}: var(--gai-h-${name});`);
  for (const name of SIZE_NAMES) lines.push(`  --size-${name}: var(--gai-h-${name});`);
  lines.push('', '  /* Stacking (D-41). */');
  for (const name of Z_NAMES) lines.push(`  --z-index-${name}: var(--gai-z-${name});`);
  lines.push('', '  /* Motion (D-20). */');
  for (const name of EASE_NAMES) lines.push(`  --ease-${name}: var(--gai-ease-${name});`);
  for (const name of DURATION_NAMES) lines.push(`  --transition-duration-${name}: var(--gai-duration-${name});`);
  lines.push('', '  /* Shell widths (02 §8): w-sidebar, max-w-dialog …. */');
  for (const name of CONTAINER_NAMES) lines.push(`  --container-${name}: var(--gai-w-${name});`);
  lines.push('', '  /* Shared layer: kept through P7 (02 §2.3 "Kept tokens"). */');
  for (const name of SHARED_COLOR_NAMES) lines.push(`  --color-${name}: var(--${name});`);
  lines.push('}', '');
  return lines.join('\n');
}

export interface VocabularyJson {
  requiredUtilities: readonly string[];
  legacyUtilityNames: readonly string[];
  namespaces: ReadonlyArray<{ id: string; prefixes: readonly string[]; names: readonly string[] }>;
}

export function vocabularyJson(): VocabularyJson {
  return {
    requiredUtilities: REQUIRED_UTILITIES,
    legacyUtilityNames: LEGACY_UTILITY_NAMES,
    namespaces: VOCABULARY_NAMESPACES,
  };
}

export function emitVocabularyJson(): string {
  return `${JSON.stringify(vocabularyJson(), null, 2)}\n`;
}

const MOBILE_HEADER =
  '/* GENERATED from packages/design-tokens (src/vocabulary-mobile.ts) — do not edit. Regenerate with `pnpm tokens:write`. */';

/** `css/vocabulary-mobile.css` (mobile 02 §9.4): mobile names → `--gai-*`, plus the window-size breakpoints. */
export function emitMobileVocabularyCss(): string {
  const lines = [MOBILE_HEADER, '@theme inline {', '  /* Mobile type steps (02 §3.1): absolute line height and tracking (MD-71). */'];
  for (const step of MOBILE_TEXT_STEPS) {
    lines.push(`  --text-${step}: var(--gai-text-${step});`);
    lines.push(`  --text-${step}--line-height: var(--gai-leading-${step});`);
    lines.push(`  --text-${step}--font-weight: var(--gai-weight-${step});`);
    lines.push(`  --text-${step}--letter-spacing: var(--gai-tracking-${step});`);
  }
  // vocabulary.css maps weight / tracking only where a WEB step sets them; on
  // mobile every step has both (micro is 500, heading tracks on iOS only), so
  // the remaining sub-variables of the shared steps are mapped here (MD-116).
  lines.push('', '  /* Shared steps: the weight / tracking sub-variables vocabulary.css leaves out (MD-116). */');
  for (const [step, t] of Object.entries(TYPE_SCALE)) {
    if (t.weight === 400) lines.push(`  --text-${step}--font-weight: var(--gai-weight-${step});`);
    if (t.tracking === 0) lines.push(`  --text-${step}--letter-spacing: var(--gai-tracking-${step});`);
  }
  lines.push('', '  /* Mobile radii (02 §3.2). */');
  for (const step of MOBILE_RADIUS_STEPS) lines.push(`  --radius-${step}: var(--gai-radius-${step});`);
  lines.push('', '  /* Mobile heights and hit sizes (02 §3.3). */');
  for (const name of MOBILE_HEIGHT_NAMES) lines.push(`  --height-${name}: var(--gai-h-${name});`);
  for (const name of MOBILE_SIZE_NAMES) lines.push(`  --size-${name}: var(--gai-h-${name});`);
  for (const name of MOBILE_WIDTH_NAMES) lines.push(`  --min-width-${name}: var(--gai-h-${name});`);
  lines.push('', '  /* Phone panels (02 §3.6). */');
  for (const name of MOBILE_CONTAINER_NAMES) lines.push(`  --container-${name}: var(--gai-w-${name});`);
  lines.push('', '  /* Named spacings (02 §3.5). */');
  for (const name of MOBILE_SPACING_NAMES) lines.push(`  --spacing-${name}: var(--gai-space-${name});`);
  lines.push('', '  /* Elevation (02 §8.4). */');
  for (const name of MOBILE_SHADOW_NAMES) lines.push(`  --shadow-${name}: var(--gai-shadow-${name});`);
  lines.push('', '  /* Families (02 §4.4), per OS in the Uniwind geometry blocks. */');
  lines.push('  --font-sans: var(--gai-font-sans);', '  --font-mono: var(--gai-font-mono);');
  lines.push('}', '@theme {', '  /* Window-size classes (MD-24): medium:, expanded:. */');
  for (const [name, px] of Object.entries(MOBILE_BREAKPOINTS)) lines.push(`  --breakpoint-${name}: ${px}px;`);
  lines.push('}', '');
  return lines.join('\n');
}

export interface MobileVocabularyJson {
  namespaces: ReadonlyArray<{ id: string; prefixes: readonly string[]; names: readonly string[] }>;
  bannedSharedUtilities: readonly string[];
  breakpoints: Readonly<Record<string, number>>;
}

export function mobileVocabularyJson(): MobileVocabularyJson {
  return {
    namespaces: MOBILE_VOCABULARY_NAMESPACES,
    bannedSharedUtilities: MOBILE_BANNED_SHARED_UTILITIES,
    breakpoints: MOBILE_BREAKPOINTS,
  };
}

export function emitMobileVocabularyJson(): string {
  return `${JSON.stringify(mobileVocabularyJson(), null, 2)}\n`;
}
