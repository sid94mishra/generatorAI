// Mobile-side registry checks (mobile 02 §5.4): the lucide maps follow the registry, every Material
// name has its SVG in @material-symbols/svg-400 (filled ones also a generated component).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_CONCEPTS, MOBILE_ICON_CONCEPTS, type IconConceptDef } from '@generatorai/design-tokens';

const here = dirname(new URL(import.meta.url).pathname);
const all = Object.entries({ ...ICON_CONCEPTS, ...MOBILE_ICON_CONCEPTS }) as Array<[string, IconConceptDef]>;
const svgDir = join(dirname(createRequire(import.meta.url).resolve('@material-symbols/svg-400/package.json')), 'outlined');

/** concept → lucide file, read from a generated map's import + entry lines. */
function mapOf(file: string): Map<string, string> {
  const src = readFileSync(join(here, file), 'utf8');
  const imports = new Map([...src.matchAll(/import (\w+) from 'lucide-react-native\/icons\/([a-z0-9-]+)';/g)].map((m) => [m[1]!, m[2]!]));
  return new Map([...src.matchAll(/^ {2}'([a-z0-9-]+)': (\w+),$/gm)].map((m) => [m[1]!, imports.get(m[2]!)!]));
}

describe('Icon registry, mobile side', () => {
  it('lucideAll.ts maps every concept to its registry lucide glyph', () => {
    expect(Object.fromEntries(mapOf('lucideAll.ts'))).toEqual(Object.fromEntries(all.map(([c, d]) => [c, d.lucide])));
  });

  it('lucide.ts maps exactly the lucideOnly concepts', () => {
    expect(Object.fromEntries(mapOf('lucide.ts'))).toEqual(
      Object.fromEntries(all.filter(([, d]) => d.lucideOnly).map(([c, d]) => [c, d.lucide])),
    );
  });

  it('every lucide glyph exists in lucide-react-native 1.x', () => {
    // lucide's `exports` hides package.json; the app links it under node_modules.
    const iconsDir = join(here, '../../../../node_modules/lucide-react-native/dist/esm/icons');
    for (const [c, d] of all) expect(existsSync(join(iconsDir, `${d.lucide}.mjs`)), c).toBe(true);
  });

  it('every Material name has its outlined SVG; filled ones the -fill SVG and a generated glyph', () => {
    for (const [c, d] of all) {
      if (!d.material) continue;
      expect(existsSync(join(svgDir, `${d.material}.svg`)), `${c} → ${d.material}`).toBe(true);
      if (d.materialFill) {
        expect(existsSync(join(svgDir, `${d.material}-fill.svg`)), c).toBe(true);
        expect(existsSync(join(here, 'material-filled', `${d.material}.tsx`)), c).toBe(true);
      }
    }
  });
});
