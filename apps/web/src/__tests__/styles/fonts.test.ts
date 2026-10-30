// fonts.css copies the latin + latin-ext @font-face rules of the Fontsource
// variable packages (D-16). This fails when a package upgrade changes a file
// name, weight range or unicode-range, so the copy cannot silently drift.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLED_FONT_FAMILIES } from '@generatorai/design-tokens';

const require = createRequire(import.meta.url);

interface Face {
  family: string;
  weight: string;
  file: string;
  unicodeRange: string;
}

function faces(css: string): Face[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
    const get = (prop: string) => new RegExp(`${prop}:\\s*([^;]+);`).exec(body!)?.[1]?.trim() ?? '';
    return {
      family: get('font-family').replace(/['"]/g, ''),
      weight: get('font-weight'),
      file: /url\(['"]?([^'")]+)['"]?\)/.exec(body!)?.[1]?.split('/').pop() ?? '',
      unicodeRange: get('unicode-range'),
    };
  });
}

const packageFaces = (pkg: string): Face[] => {
  const dir = dirname(require.resolve(`@fontsource-variable/${pkg}/package.json`));
  return faces(readFileSync(join(dir, 'wght.css'), 'utf8')).filter((f) => /-latin(-ext)?-wght-normal\.woff2$/.test(f.file));
};

describe('bundled fonts (fonts.css)', () => {
  const ours = faces(readFileSync(join(__dirname, '..', '..', 'styles', 'fonts.css'), 'utf8'));

  it('declares exactly latin + latin-ext of the two bundled families', () => {
    expect(ours).toHaveLength(4);
    expect([...new Set(ours.map((f) => f.family))]).toEqual([...BUNDLED_FONT_FAMILIES]);
  });

  it.each(['instrument-sans', 'jetbrains-mono'])('%s matches the package descriptors', (pkg) => {
    const expected = packageFaces(pkg);
    expect(expected).toHaveLength(2);
    expect(ours.filter((f) => f.file.startsWith(pkg))).toEqual(expected);
  });
});
