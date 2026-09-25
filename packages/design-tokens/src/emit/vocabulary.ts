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
// ────────────────────────────────────────────────────────────────

import {
  COLOR_NAMES,
  LEGACY_UTILITY_NAMES,
  REQUIRED_UTILITIES,
  SHADOW_NAMES,
  SHARED_COLOR_NAMES,
  TEXT_COLOR_OVERRIDES,
  VOCABULARY_NAMESPACES,
} from '../vocabulary.js';

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
