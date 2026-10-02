// Mobile-only vocabulary (MD-70; mobile 02 §3.8, §9.4).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { emitMobileVocabularyCss, emitMobileVocabularyJson } from '../emit/vocabulary.js';
import {
  MOBILE_BANNED_SHARED_UTILITIES,
  MOBILE_HEIGHT_NAMES,
  MOBILE_TEXT_STEPS,
  MOBILE_VOCABULARY_NAMESPACES,
  mobileTwMergeExtension,
} from '../vocabulary-mobile.js';
import { HEIGHT_NAMES, RADIUS_STEPS, TEXT_STEPS, VOCABULARY_NAMESPACES, twMergeExtension } from '../vocabulary.js';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('mobile vocabulary', () => {
  it('never re-declares a shared name in the same namespace (MD-12)', () => {
    const shared = new Set(VOCABULARY_NAMESPACES.flatMap((ns) => ns.prefixes.flatMap((p) => ns.names.map((n) => `${p}-${n}`))));
    for (const ns of MOBILE_VOCABULARY_NAMESPACES) {
      for (const p of ns.prefixes) for (const n of ns.names) expect(shared.has(`${p}-${n}`), `${p}-${n}`).toBe(false);
    }
    for (const name of MOBILE_HEIGHT_NAMES) expect(HEIGHT_NAMES as readonly string[]).not.toContain(name);
    for (const step of MOBILE_TEXT_STEPS) expect(TEXT_STEPS as readonly string[]).not.toContain(step);
  });

  it('bans only utilities the shared vocabulary defines', () => {
    const shared = new Set(VOCABULARY_NAMESPACES.flatMap((ns) => ns.prefixes.flatMap((p) => ns.names.map((n) => `${p}-${n}`))));
    for (const u of MOBILE_BANNED_SHARED_UTILITIES) expect(shared.has(u), u).toBe(true);
  });

  it('extends the shared tailwind-merge config without dropping a shared name', () => {
    const shared = twMergeExtension().extend;
    const mobile = mobileTwMergeExtension().extend;
    expect(mobile.theme.color).toEqual(shared.theme.color);
    expect(mobile.theme.text).toEqual([...TEXT_STEPS, ...MOBILE_TEXT_STEPS]);
    expect(mobile.theme.radius!.slice(0, RADIUS_STEPS.length)).toEqual([...RADIUS_STEPS]);
    expect(mobile.theme.spacing).toEqual(['gutter', 'gutter-title']);
    expect(mobile.classGroups['min-h']![0]!['min-h']).toEqual([...HEIGHT_NAMES, ...MOBILE_HEIGHT_NAMES]);
    expect(mobile.classGroups.size![0]!.size).toEqual(['control-sm', 'control', 'control-lg', 'hit', 'icon-button', 'icon-button-sm']);
    expect(mobile.classGroups['min-w']).toEqual([{ 'min-w': ['hit'] }]);
    expect(mobile.classGroups.z).toEqual(shared.classGroups.z);
  });

  it('css/vocabulary-mobile.css and generated/vocabulary-mobile.json are current', () => {
    expect(read('../../css/vocabulary-mobile.css')).toBe(emitMobileVocabularyCss());
    expect(read('../../generated/vocabulary-mobile.json')).toBe(emitMobileVocabularyJson());
  });

  it('maps every mobile name, the missing shared sub-variables (MD-116) and the breakpoints', () => {
    const css = emitMobileVocabularyCss();
    expect(css).toContain('--text-detail-title--font-weight: var(--gai-weight-detail-title);');
    expect(css).toContain('--text-micro--font-weight: var(--gai-weight-micro);');
    expect(css).not.toContain('--text-title--font-weight'); // vocabulary.css already maps it
    expect(css).toContain('--height-badge-sm: var(--gai-h-badge-sm);');
    expect(css).toContain('--size-icon-button-sm: var(--gai-h-icon-button-sm);');
    expect(css).toContain('--container-drawer: var(--gai-w-drawer);');
    expect(css).toContain('--spacing-gutter-title: var(--gai-space-gutter-title);');
    expect(css).toContain('--shadow-float: var(--gai-shadow-float);');
    expect(css).toMatch(/@theme \{\n[^}]*--breakpoint-medium: 600px;\n\s+--breakpoint-expanded: 840px;/);
  });
});
